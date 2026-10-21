"""Assemble the nine exported scene stills into a review contact sheet."""
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent / 'video-clone/tools'))
from PIL import Image,ImageDraw,ImageFont
times=['2-500','6-500','11-000','16-000','20-500','25-000','29-500','34-500','39-000']
sheet=Image.new('RGB',(1944,1200),'#181818')
draw=ImageDraw.Draw(sheet)
face=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',17)
for i,t in enumerate(times):
    x=8+(i%3)*648;y=8+(i//3)*400
    image=Image.open(ROOT / f'output/stills/frame-{t}.jpg').convert('RGB').resize((640,360),Image.Resampling.LANCZOS)
    sheet.paste(image,(x,y));draw.text((x+10,y+369),f'{i+1:02d} / {t.replace("-",".")} s',font=face,fill='#CBE960')
sheet.save(ROOT/'output/mellox-v2-storyboard.jpg',quality=96)
print(ROOT/'output/mellox-v2-storyboard.jpg')
