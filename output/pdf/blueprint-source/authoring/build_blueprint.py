from pathlib import Path
import json, re, html, hashlib, textwrap, zipfile, datetime
from reportlab.pdfgen import canvas
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak, Table, TableStyle, KeepTogether, Flowable
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
ROOT=Path.cwd(); OUT=ROOT/'output/pdf'; SRC=OUT/'blueprint-source'
D=json.loads((SRC/'implementation-inventory.json').read_text()); B=D['billing']; W,H=A4; WIDTH=W-96
NAVY=colors.HexColor('#102B3B'); TEAL=colors.HexColor('#087F8C'); LIME=colors.HexColor('#D7F27D'); LIGHT=colors.HexColor('#EDF4F6'); INK=colors.HexColor('#203B49'); MUTED=colors.HexColor('#5B6F78')
for name,file in [('Body','arial.ttf'),('Bold','arialbd.ttf'),('Italic','ariali.ttf')]:pdfmetrics.registerFont(TTFont(name,'C:/Windows/Fonts/'+file))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='Bold',italic='Italic',boldItalic='Bold')
ST={
'body':ParagraphStyle('body',fontName='Body',fontSize=10,leading=14.6,textColor=INK,spaceAfter=8),
'small':ParagraphStyle('small',fontName='Body',fontSize=8,leading=11,textColor=MUTED,spaceAfter=5),
'h1':ParagraphStyle('h1',fontName='Bold',fontSize=20,leading=25,textColor=NAVY,spaceBefore=17,spaceAfter=12,keepWithNext=True),
'h2':ParagraphStyle('h2',fontName='Bold',fontSize=12,leading=16,textColor=TEAL,spaceBefore=13,spaceAfter=7,keepWithNext=True),
'cell':ParagraphStyle('cell',fontName='Body',fontSize=8,leading=11,textColor=INK,spaceAfter=0),
'th':ParagraphStyle('th',fontName='Bold',fontSize=8,leading=11,textColor=colors.white),
'code':ParagraphStyle('code',fontName='Courier',fontSize=8,leading=11,backColor=LIGHT,borderPadding=8,spaceAfter=9),
'toc':ParagraphStyle('toc',fontName='Body',fontSize=10,leading=15,textColor=INK,spaceBefore=5),
}
def esc(s):
    s=html.escape(str(s));s=re.sub(r'\*\*(.*?)\*\*',r'<b>\1</b>',s);s=re.sub(r'`(.*?)`',r'<font name="Courier">\1</font>',s);return s.replace('\n','<br/>')
class Diagram(Flowable):
    def __init__(self,labels):Flowable.__init__(self);self.labels=labels;self.width=WIDTH;self.height=len(labels)*43+12
    def draw(self):
        c=self.canv
        for i,label in enumerate(self.labels):
            y=self.height-(i+1)*43;c.setFillColor(NAVY if i in (0,len(self.labels)-1) else LIGHT);c.roundRect(0,y,WIDTH,31,6,fill=1,stroke=0)
            c.setFillColor(colors.white if i in (0,len(self.labels)-1) else INK);c.setFont('Bold',9);c.drawCentredString(WIDTH/2,y+11,label)
            if i<len(self.labels)-1:c.setStrokeColor(TEAL);c.line(WIDTH/2,y,WIDTH/2,y-10);c.line(WIDTH/2,y-10,WIDTH/2-3,y-6);c.line(WIDTH/2,y-10,WIDTH/2+3,y-6)
class BlueprintPDF(BaseDocTemplate):
    def __init__(self,filename,book):
        super().__init__(str(filename),pagesize=A4,leftMargin=48,rightMargin=48,topMargin=58,bottomMargin=48,title='Mellox AI | '+book.title,author='Mellox AI - internal engineering documentation')
        self.book=book;self.addPageTemplates(PageTemplate('normal',Frame(48,48,WIDTH,H-106,id='content'),onPage=self.page_chrome));self.counter=0
    def beforeDocument(self):self.counter=0
    def page_chrome(self,c,doc):
        if doc.page==1:
            c.setFillColor(NAVY);c.rect(0,0,W,H,fill=1,stroke=0);c.setFillColor(LIME);c.rect(48,H-63,43,5,fill=1,stroke=0)
            c.setFillColor(colors.white);c.setFont('Bold',15);c.drawString(48,H-94,'MELLOX AI');c.setFillColor(LIME);c.setFont('Bold',74);c.drawString(44,H-215,self.book.num)
            y=H-285
            for line in textwrap.wrap(self.book.title,27):c.setFillColor(colors.white);c.setFont('Bold',29);c.drawString(48,y,line);y-=37
            c.setFillColor(colors.HexColor('#B9D2DC'));c.setFont('Body',12)
            for line in textwrap.wrap(self.book.subtitle,65):y-=23;c.drawString(48,y,line)
            c.setStrokeColor(colors.HexColor('#426170'));c.line(48,160,W-48,160);c.setFillColor(colors.white);c.setFont('Bold',10);c.drawString(48,136,'REBUILD BLUEPRINT SERIES  /  VOLUME '+self.book.num+' OF 06')
            c.setFont('Body',9);c.setFillColor(colors.HexColor('#B9D2DC'));c.drawString(48,115,'Source snapshot: 21 October 2026  |  Branch: '+D['branch']);c.drawString(48,98,'Commit: '+D['commit'][:12]+'  |  Internal working reference')
            c.drawString(48,65,'Code-derived implementation. Production activation requires separate evidence.')
        else:
            c.setStrokeColor(TEAL);c.setLineWidth(.6);c.line(48,H-40,W-48,H-40);c.setFillColor(NAVY);c.setFont('Bold',8);c.drawString(48,H-31,'MELLOX AI  /  '+self.book.num+'  '+self.book.short.upper());c.setFont('Body',8);c.setFillColor(MUTED);c.drawString(48,28,'21 OCT 2026  |  '+D['commit'][:12]);c.drawRightString(W-48,28,str(doc.page))
    def afterFlowable(self,f):
        if isinstance(f,Paragraph) and f.style.name=='h1':
            self.counter+=1;k='s'+str(self.counter);self.canv.bookmarkPage(k);self.canv.addOutlineEntry(f.getPlainText(),k,0);self.notify('TOCEntry',(0,f.getPlainText(),self.page,k))
class Book:
    def __init__(self,num,title,short,subtitle):self.num=num;self.title=title;self.short=short;self.subtitle=subtitle;self.story=[Spacer(1,8),PageBreak()];self.md=['# Mellox AI - '+title,'Snapshot: 2026-10-21 | commit '+D['commit']];self.sources=[];self.n=0
    def p(self,t,style='body'):self.story.append(Paragraph(esc(t),ST[style]));self.md.append(t+'\n')
    def h(self,t):self.story.append(Paragraph(esc(t),ST['h2']));self.md.append('### '+t)
    def section(self,title,text='',sources=(),new=False):
        if new:self.story.append(PageBreak())
        self.n+=1;self.story.append(Paragraph(f'{self.n:02d}  '+esc(title),ST['h1']));self.md.append('## '+title)
        if text:
            for p in text.strip().split('\n\n'):self.p(p.strip())
        if sources:self.source(*sources)
    def source(self,*paths):
        for p in paths:
            if not (ROOT/p).exists():raise FileNotFoundError(p)
            if p not in self.sources:self.sources.append(p)
        self.p('Implementation sources: '+'; '.join(paths),'small')
        if len(self.story)>1 and isinstance(self.story[-2],Paragraph) and self.story[-2].style.name in ('body','small'):
            citation=self.story.pop();previous=self.story.pop();self.story.append(KeepTogether([previous,citation]))
    def bullets(self,*items):
        for x in items:self.story.append(Paragraph('&#8226; '+esc(x),ST['body']));self.md.append('- '+x)
    def table(self,headers,rows,widths=None):
        if not rows:return
        widths=[WIDTH*x/sum(widths) for x in widths] if widths else [WIDTH/len(headers)]*len(headers)
        data=[[Paragraph(esc(v),ST['th']) for v in headers]]+[[Paragraph(esc(v),ST['cell']) for v in r] for r in rows]
        t=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT');t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),NAVY),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,LIGHT]),('LINEBELOW',(0,0),(-1,0),.4,TEAL)]));self.story.append(t);self.story.append(Spacer(1,9));self.md.append('| '+' | '.join(headers)+' |');self.md.append('| '+' | '.join(['---']*len(headers))+' |');self.md.extend('| '+' | '.join(str(x).replace('\n','; ') for x in r)+' |' for r in rows)
    def diagram(self,*labels):self.story.append(Diagram(labels));self.md.append('Flow: '+' -> '.join(labels))
    def code(self,t):self.p(t,'code')
    def external(self,title,url,note):
        self.story.append(Paragraph('<b>'+esc(title)+'</b> - '+esc(note)+'<br/><link href="'+html.escape(url,quote=True)+'" color="#087F8C">'+esc(url)+'</link>',ST['small']));self.md.append(f'[{title}]({url}) - {note}')
    def intro(self):
        self.section('How to use this volume',f'''This is volume {self.num} of six documents describing Mellox AI as represented in the local source snapshot on 21 October 2026. The owner confirmed that this repository is current, Railway is the hosting platform, codebase pricing should be used, and mellox.ai is the public website.

**Evidence labels:** Implemented means source exists and is mapped here; it does not prove that a production migration, credential, permission or feature switch is enabled. Owner-confirmed identifies facts supplied by the owner. External-verified identifies official web information checked on the snapshot date. Recommended identifies a rebuild or operating procedure. Unverified identifies missing deployment or commercial evidence.

Runtime code, migrations and current configuration outrank older guides. Model and price tables describe defaults unless explicitly stated otherwise. They are a dated reference, not a promise that vendors will retain them. No credentials or customer records are included.''')
        self.table(['Volume','Read it for'],[['01 Product & workflows','Feature behavior, journeys, approvals and module ownership'],['02 Architecture & engineering','Frontend, backend, integrations, APIs and implementation patterns'],['03 AI models & generation','Every task-model route, images, video, context and evaluations'],['04 Pricing & billing','Plans, feature gates, all action prices, wallets and economics'],['05 Railway & operations','Deployment, configuration, jobs, security, recovery and diagnostics'],['06 Rebuild & data reference','Build order, acceptance criteria, full typed schema and migration index']],[1,2])
        self.h('Contents');toc=TableOfContents();toc.levelStyles=[ST['toc']];self.story.extend([toc,PageBreak()])
    def finish(self):
        self.section('Source ledger and verification limits',new=True)
        self.p('Repository-relative paths below identify the owning implementation. The companion source folder includes an extracted inventory and SHA-256 hashes for source files and migrations. The inventory is a static extraction, not a database dump or a successful production test. Generated database types describe their checked-in state; migrations define actual SQL constraints, defaults and policies.')
        self.p('The Mellox connector failed with an internal error. The public site could not be fetched by the web tool or local network, and browser initialization was unavailable. Consequently public-site rendering, deployed commit, enabled credentials, vendor approvals, production schema, invoices, real usage and exact Railway service topology were not independently inspected. The local marketing implementation was used as a secondary source. No live provider generation or publication was triggered.')
        rows=[]
        for p in self.sources:
            pp=ROOT/p;hashv=hashlib.sha256(pp.read_bytes()).hexdigest()[:16] if pp.is_file() else 'directory reference';rows.append([p,hashv])
        self.table(['Source','SHA-256 prefix'],rows,[3,1])
        file=OUT/(self.num+'-Mellox-AI-'+self.short.replace(' ','-')+'.pdf');BlueprintPDF(file,self).multiBuild(self.story)
        (SRC/(file.stem+'.md')).write_text('\n\n'.join(self.md),encoding='utf8');return file

BOOKS=[]

if __name__=='__main__':
    for name in ['product','architecture','ai','billing','operations','rebuild']:
        print('Preparing',name,flush=True)
        exec((ROOT/'tmp/pdfs'/('volume_'+name+'.py')).read_text(encoding='utf8'),globals())
    files=[]
    for book in BOOKS:
        print('Rendering volume',book.num,flush=True);files.append(book.finish())
    manifest={'date':D['date'],'commit':D['commit'],'volumes':[{'file':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files],'counts':{k:len(D[k]) for k in ['apis','pages','tables','dbfunctions','tasks','migrations']},'scope':'Static source analysis; owner confirms Railway; production/account state not inspected.'}
    (SRC/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
    (SRC/'README.md').write_text('''# Mellox AI rebuild blueprint\n\nSix PDFs plus editable Markdown companions and a machine-readable implementation inventory.\n\nSnapshot: 21 October 2026. Owner-confirmed current repository and Railway host; use codebase pricing. See each PDF for verification limits.\n\nThe inventory contains names/contracts/defaults and SHA-256 source hashes, not credentials or customer data. It is not a full repository backup. Keep the application source and migrations separately.\n\nRead volumes in numerical order; use 06 for the schema and migration reference. Update the Markdown and inventories when code changes. Historical docs are not current authority.\n''',encoding='utf8')
    with zipfile.ZipFile(OUT/'Mellox-AI-Complete-Blueprint-2026-10-21.zip','w',zipfile.ZIP_DEFLATED) as z:
        for p in files:z.write(p,p.name)
        for p in SRC.iterdir():z.write(p,'blueprint-source/'+p.name)
    print(json.dumps(manifest,indent=2),flush=True)
