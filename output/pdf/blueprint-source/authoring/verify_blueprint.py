from pathlib import Path
import json, subprocess, hashlib
import pdfplumber
from pypdf import PdfReader
from PIL import Image,ImageOps,ImageDraw
ROOT=Path.cwd();OUT=ROOT/'output/pdf';QA=ROOT/'tmp/pdfs/qa';QA.mkdir(parents=True,exist_ok=True)
POP=Path('C:/Users/JUNCTION/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe')
reports=[]
for pdf in sorted(OUT.glob('[0-9][0-9]-*.pdf')):
    reader=PdfReader(pdf);n=len(reader.pages);txt='\n'.join(p.extract_text() or '' for p in reader.pages)
    issues=[]
    if 'Placeholder for table of contents' in txt:issues.append('unresolved TOC')
    if '\ufffd' in txt or '\u25a0' in txt:issues.append('replacement/missing glyph')
    with pdfplumber.open(pdf) as p:
        for i,page in enumerate(p.pages):
            bad=[c for c in page.chars if c['x0'] < 30 or c['x1'] > page.width-29 or c['top'] < 10 or c['bottom'] > page.height-15]
            if bad:issues.append(f'page {i+1}: text outside outer safe bounds ({len(bad)} chars)')
    folder=QA/pdf.stem;folder.mkdir(exist_ok=True)
    subprocess.run([str(POP),'-r','55','-png',str(pdf),str(folder/'page')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    pngs=sorted(folder.glob('page-*.png'),key=lambda x:int(x.stem.split('-')[-1]));sheets=[]
    for s in range(0,len(pngs),9):
        sheet=Image.new('RGB',(1080,1584),'#d8e1e5');draw=ImageDraw.Draw(sheet)
        for j,p in enumerate(pngs[s:s+9]):
            im=Image.open(p).convert('RGB');im.thumbnail((344,492));x=(j%3)*360+8;y=(j//3)*528+8;sheet.paste(im,(x,y));draw.text((x,y+496),f'{pdf.stem[:2]} / page {s+j+1}',fill='#102b3b')
        dest=QA/(pdf.stem+f'-contact-{s//9+1:02d}.png');sheet.save(dest);sheets.append(str(dest))
    reports.append({'file':pdf.name,'pages':n,'words':len(txt.split()),'bytes':pdf.stat().st_size,'issues':issues,'contactSheets':sheets})
    print(pdf.name,n,'pages',len(txt.split()),'words','issues:',issues,flush=True)
(OUT/'blueprint-source/quality-report.json').write_text(json.dumps(reports,indent=2),encoding='utf8')
print('TOTAL PAGES',sum(x['pages'] for x in reports),'WORDS',sum(x['words'] for x in reports))
