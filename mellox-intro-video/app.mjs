const canvas = document.getElementById('film');
const ctx = canvas.getContext('2d', {alpha:false});
const audio = document.getElementById('master');
const isRender = new URLSearchParams(location.search).has('render');
document.body.classList.toggle('render',isRender);
let config,currentTime=0,playing=false,lastConfig='';
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const ease=x=>1-Math.pow(1-clamp(x),3);
const expo=x=>x>=1?1:1-Math.pow(2,-10*clamp(x));
const C={};
const status=document.getElementById('status');
const mediumFontReady=document.fonts.load('500 28px "Google Sans Flex"');
const images={};
const imageSources={logo:'/assets/mellox-logo.svg',brand:'/assets/brains/brand.svg',customer:'/assets/brains/customer.svg',competitor:'/assets/brains/competitor.svg',market:'/assets/brains/market.svg'};
for(const [key,src] of Object.entries(imageSources)){const image=new Image();image.src=src;images[key]=image;}

function font(size=24,weight=400,tracking=0,family='Google Sans Flex'){
  ctx.font=`${weight} ${size}px "${family}"`;ctx.letterSpacing=`${tracking}px`;ctx.textBaseline='alphabetic';
}
function text(value,x,y,size=24,color=C.white,weight=400,tracking=0,align='left',family='Google Sans Flex'){
  font(size,weight,tracking,family);ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(value,x,y);
}
function line(x1,y1,x2,y2,color=C.border,width=1){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
function circle(x,y,r,color,fill=false,width=1){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.lineWidth=width;if(fill){ctx.fillStyle=color;ctx.fill();}else{ctx.strokeStyle=color;ctx.stroke();}}
function rounded(x,y,w,h,r=16,fill=C.card,stroke=C.border){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}}
function pill(label,x,y,{size=15,fill=C.lime,color='#000000',stroke=null,pad=18,height=38}={}){
  font(size,600,.3);const width=ctx.measureText(label).width+pad*2;
  rounded(x,y,width,height,height/2,fill,stroke);text(label,x+pad,y+height/2+size*.34,size,color,600,.3);return width;
}
function arrow(x,y,size=22,color=C.lime){line(x-size*.45,y+size*.45,x+size*.45,y-size*.45,color,2.5);line(x-size*.35,y-size*.45,x+size*.45,y-size*.45,color,2.5);line(x+size*.45,y-size*.45,x+size*.45,y+size*.35,color,2.5);}
function check(x,y,color=C.lime){ctx.beginPath();ctx.moveTo(x-7,y);ctx.lineTo(x-1,y+6);ctx.lineTo(x+10,y-8);ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();}
function lockup(x,y,height=42,center=false){
  const markW=height*1.8,gap=height*.45,size=height*.67;
  font(size,400,0,'Michroma');const word='Mellox';const first=ctx.measureText(word).width,tail=ctx.measureText(' AI').width;
  const width=markW+gap+first+tail;if(center)x-=width/2;
  ctx.drawImage(images.logo,x,y-height*.51,markW,height*.98);
  text(word,x+markW+gap,y+size*.34,size,C.white,400,0,'left','Michroma');
  text(' AI',x+markW+gap+first,y+size*.34,size,C.lime,400,0,'left','Michroma');return width;
}
function chrome(scene,index,time){
  lockup(132,94,34);text('YOUR AI MARKETING TEAM',1788,101,14,C.muted,600,2,'right');line(132,145,1788,145,'#1C1C1C');
  text('MELLOX.AI / BUILT AROUND YOUR BRAND',132,1003,12,'#666664',600,2);text(`${String(index+1).padStart(2,'0')} / 09`,1788,1003,12,C.muted,600,2,'right');
  line(132,1033,1788,1033,'#202020');line(132,1033,132+1656*clamp(time/config.duration),1033,C.lime,2);
}
function eyebrow(label,x,y,age){ctx.save();ctx.globalAlpha=ease(age/.32);circle(x+4,y-5,3.5,C.lime,true);text(label,x+20,y,15,C.muted,600,2.2);ctx.restore();}
function headline(lines,x,y,{size=124,leading=132,width=820,accent='',age=2,stagger=.095,delay=.10,align='left'}={}){
  lines.forEach((value,index)=>{
    const p=expo((age-delay-index*stagger)/.68);font(size,600,-size*.045);const natural=ctx.measureText(value).width;
    const used=size*Math.min(1,width/natural);
    ctx.save();ctx.beginPath();const top=y+index*leading-size*1.1;ctx.rect(x-(align==='center'?width/2:0)-5,top,width+12,size*1.45);ctx.clip();
    ctx.globalAlpha=p;ctx.translate(0,(1-p)*size*.85);font(used,600,-used*.045);const full=ctx.measureText(value).width;
    let left=align==='center'?x-full/2:x;const at=accent?value.indexOf(accent):-1;
    if(at>=0){const prefix=value.slice(0,at),tail=value.slice(at+accent.length);text(prefix,left,y+index*leading,used,C.white,600,-used*.045);font(used,600,-used*.045);left+=ctx.measureText(prefix).width;text(accent,left,y+index*leading,used,C.lime,600,-used*.045);font(used,600,-used*.045);left+=ctx.measureText(accent).width;text(tail,left,y+index*leading,used,C.white,600,-used*.045);}
    else text(value,left,y+index*leading,used,C.white,600,-used*.045);ctx.restore();
  });
}
function caption(value,x,y,age,delay=.65,maxWidth=850){ctx.save();const p=ease((age-delay)/.5);ctx.globalAlpha=p;ctx.translate(0,(1-p)*14);font(27,400,-.3);const size=27*Math.min(1,maxWidth/ctx.measureText(value).width);text(value,x,y,size,C.muted,400,-.3);ctx.restore();}
function productPanel(x,y,w,h,title,age,delay=.28){const p=ease((age-delay)/.7);ctx.save();ctx.globalAlpha=p;ctx.translate(0,(1-p)*42);rounded(x,y,w,h,18);circle(x+26,y+26,3,C.lime,true);text(title,x+43,y+32,16,C.white,600,.2);text('MELLOX',x+w-26,y+31,11,'#686866',600,1.5,'right');line(x+1,y+55,x+w-1,y+55,'#222222');return ()=>ctx.restore();}

function hero(scene,age,time){
  eyebrow(scene.eyebrow,132,242,age);headline(scene.lines,132,439,{size:182,leading:181,width:1110,accent:scene.accent,age,delay:.24});caption(scene.body,141,744,age,1.05,1060);
  const p=ease((age-.45)/1.2),x=1470,y=521;ctx.save();ctx.globalAlpha=p;
  for(let i=0;i<5;i++){ctx.save();ctx.translate(x,y);ctx.rotate(-.30+i*.035+Math.sin(time*.6)*.025);rounded(-152-i*17,-158-i*17,304+i*34,316+i*34,28,null,i===0?'#434B2C':'#1B1D16');ctx.restore();}
  ctx.save();ctx.translate(x,y);ctx.rotate(-.18+Math.sin(time*.8)*.035);ctx.drawImage(images.logo,-169,-91,338,183);ctx.restore();circle(x+205,y-225,7,C.lime,true);line(x+205,y-205,x+205,y-156,'#424A2C');text('BUILT AROUND YOU',x,815,13,C.muted,600,2,'center');ctx.restore();
}
function introduce(scene,age){
  ctx.save();ctx.globalAlpha=ease(age/.3);text(scene.eyebrow,960,239,15,C.muted,600,3,'center');ctx.restore();
  headline(scene.lines,960,429,{size:168,leading:172,width:1530,accent:scene.accent,age,delay:.15,align:'center'});
  ['Strategy','Content','Visibility'].forEach((label,index)=>{const p=ease((age-.62-index*.10)/.5);ctx.save();ctx.globalAlpha=p;const x=432+index*366,y=706+(1-p)*28;rounded(x,y,324,90,12,'#080808','#2A2A2A');circle(x+36,y+45,5,C.lime,true);text(label,x+61,y+54,29,C.white,500,-.7);arrow(x+279,y+46,17);ctx.restore();});
  ctx.save();ctx.globalAlpha=ease((age-1.05)/.5);text(scene.body,960,881,25,C.muted,400,-.3,'center');ctx.restore();
}
function dna(scene,age){
  eyebrow(scene.eyebrow,132,235,age);headline(scene.lines,132,390,{size:129,leading:139,accent:scene.accent,age});caption(scene.body,136,636,age,.7,790);
  const done=productPanel(1030,240,758,619,'Brand DNA',age);
  rounded(1062,329,694,64,10,'#111111','#292929');circle(1086,361,5,C.muted);line(1090,365,1097,372,C.muted);const url='yourbrand.com';text(url.slice(0,Math.floor(clamp((age-.55)/.65)*url.length)),1114,370,22,C.white,400,-.3);
  const rows=[['VOICE','Clear. Human. Confident.'],['AUDIENCE','The people you want to reach.'],['POSITIONING','What makes your brand different.']];
  rows.forEach(([label,value],i)=>{const p=ease((age-1.05-i*.24)/.45);ctx.save();ctx.globalAlpha=p;const yy=455+i*106;line(1064,yy+49,1756,yy+49,'#222222');text(label,1064,yy-13,12,C.muted,600,1.5);text(value,1064,yy+21,23,C.white,400,-.4);check(1738,yy+8);ctx.restore();});
  if(age>1.85){ctx.save();ctx.globalAlpha=ease((age-1.85)/.4);pill('Brand DNA ready',1062,778,{height:42,size:16});ctx.restore();}done();
}
function brains(scene,age){
  eyebrow(scene.eyebrow,132,229,age);headline(scene.lines,132,380,{size:146,leading:150,width:1450,accent:scene.accent,age});
  const names=['Brand','Customer','Competitor','Market'],details=['Your identity.','Your audience.','Your landscape.','Your opportunities.'];
  names.forEach((name,i)=>{const p=ease((age-.5-i*.12)/.65),x=132+i*418,y=644+(1-p)*40;ctx.save();ctx.globalAlpha=p;rounded(x,y,402,260,14,C.card,i===Math.floor(Math.max(0,age-1)*1.2)%4?'#5E6B31':C.border);ctx.drawImage(images[name.toLowerCase()],x+28,y+29,68,68);text(name,x+29,y+155,35,C.white,600,-1);text(details[i],x+29,y+205,21,C.muted,400,-.2);const active=clamp((age-.7-i*.15)/1.3);line(x+29,y+235,x+29+344*active,y+235,i===Math.floor(Math.max(0,age-1)*1.2)%4?C.lime:'#42423C',2);ctx.restore();});
}
function create(scene,age,time){
  eyebrow(scene.eyebrow,132,235,age);headline(scene.lines,132,382,{size:126,leading:130,width:790,accent:scene.accent,age});caption(scene.body,136,824,age,.8,795);
  const p=ease((age-.3)/.65);ctx.save();ctx.globalAlpha=p;ctx.save();ctx.translate(1475,536);ctx.rotate(.09);rounded(-280,-225,560,524,18,'#060606','#242424');ctx.restore();ctx.save();ctx.translate(1438,529);ctx.rotate(-.035);rounded(-280,-234,560,524,18,'#090909','#343434');ctx.restore();
  rounded(1094,270,640,558,18,'#0D0D0D','#3B3B3B');text('Content Studio',1125,317,17,C.white,600);pill('On brand',1593,291,{size:12,height:32,pad:12});line(1095,341,1733,341,'#282828');rounded(1124,368,580,316,10,'#11140C',null);
  for(let i=0;i<5;i++){ctx.save();ctx.globalAlpha=.18;ctx.translate(1610,521);ctx.rotate(.35+i*.06+time*.025);rounded(-104-i*12,-104-i*12,208+i*24,208+i*24,10,null,C.lime);ctx.restore();}
  text('Ideas into',1156,454,45,C.white,600,-1.8);text('impact.',1156,509,61,C.lime,600,-2.5);text('YOUR BRAND / YOUR VOICE',1158,640,11,C.muted,600,2);text('One idea. A whole content direction.',1125,730,21,C.white,400,-.3);
  ['Post','Carousel','Video'].forEach((label,i)=>{const q=ease((age-.85-i*.16)/.4);ctx.save();ctx.globalAlpha=q;pill(label,1125+i*139,761,{size:15,height:36,fill:'#1C1C1C',color:C.white,stroke:'#373737'});ctx.restore();});ctx.restore();
}
function publish(scene,age){
  eyebrow(scene.eyebrow,132,235,age);headline(scene.lines,132,385,{size:140,leading:147,width:1510,accent:scene.accent,age});caption(scene.body,138,616,age,.6,1400);
  ['LinkedIn','Instagram','TikTok','YouTube','X'].forEach((label,i)=>{const p=ease((age-.6-i*.09)/.5),x=132+i*334,y=711+(1-p)*35;ctx.save();ctx.globalAlpha=p;rounded(x,y,320,172,13,C.card,C.border);text(label,x+25,y+55,28,C.white,600,-.6);line(x+25,y+81,x+295,y+81,'#2B2B2B');const on=age>1.2+i*.19;circle(x+30,y+123,4,on?C.lime:'#424242',true);text(on?'Ready to publish':'Preparing',x+44,y+130,17,on?C.lime:C.muted,400,-.2);arrow(x+281,y+41,14,on?C.lime:C.muted);ctx.restore();});
}
function visibility(scene,age){
  eyebrow(scene.eyebrow,132,235,age);headline(scene.lines,132,378,{size:124,leading:130,width:815,accent:scene.accent,age});caption(scene.body,136,824,age,.75,810);
  const done=productPanel(1030,248,758,594,'AI Visibility',age);text('Understand where your brand shows up.',1064,362,25,C.white,500,-.5);
  ['ChatGPT','Gemini','Perplexity'].forEach((name,i)=>{const yy=406+i*99,p=ease((age-.65-i*.18)/.5);ctx.save();ctx.globalAlpha=p;rounded(1063,yy,692,80,10,'#101010','#262626');circle(1096,yy+40,14,'#333333');circle(1096,yy+40,4,C.lime,true);text(name,1129,yy+48,23,C.white,500,-.4);const n=Math.floor(clamp((age-1.05-i*.2)/.8)*5);for(let b=0;b<5;b++)rounded(1537+b*36,yy+43-(b+1)*4,20,17+(b+1)*4,3,b<n?C.lime:'#2B2B2B',null);ctx.restore();});
  ctx.save();ctx.globalAlpha=ease((age-1.7)/.5);pill('Track prompts. Find your next opportunity.',1063,753,{size:16,fill:'#151A0B',color:C.lime,stroke:'#3E4921',height:43});ctx.restore();done();
}
function autopilot(scene,age){
  eyebrow(scene.eyebrow,132,235,age);headline(scene.lines,132,378,{size:126,leading:130,width:815,accent:scene.accent,age});caption(scene.body,136,827,age,.75,810);
  const done=productPanel(1030,248,758,604,'Autopilot',age);text('Marketing, moving forward.',1065,365,28,C.white,500,-.7);const progress=ease((age-.75)/.45);rounded(1647,337,102,49,25,progress>.5?C.lime:'#292929',null);circle(1672+52*progress,361.5,17,'#000000',true);
  const rows=[['Plan','A direction built around your goals.'],['Create','Content grounded in your brand.'],['Publish','Your workflow, moving ahead.']];
  rows.forEach(([name,detail],i)=>{const yy=434+i*108,active=ease((age-.8-i*.45)/.45);ctx.save();ctx.globalAlpha=.35+.65*active;circle(1091,yy+14,21,active>.5?C.lime:'#292929',active>.5);if(active>.5)check(1090,yy+14,'#000000');else text(String(i+1),1091,yy+20,16,C.muted,500,0,'center');if(i<2)line(1091,yy+38,1091,yy+82,'#333333',1.5);text(name,1135,yy+12,26,C.white,600,-.6);text(detail,1135,yy+44,19,C.muted,400,-.2);ctx.restore();});
  ctx.save();ctx.globalAlpha=ease((age-2.0)/.5);pill('Your brand. Your goals. Your control.',1063,775,{size:16,fill:'#151A0B',color:C.lime,stroke:'#3E4921',height:43});ctx.restore();done();
}
function end(scene,age){
  const p=expo(age/.8);ctx.save();ctx.globalAlpha=p;ctx.translate(0,(1-p)*35);text(scene.eyebrow,960,260,14,C.muted,600,3,'center');lockup(960,468,124,true);
  ctx.globalAlpha=ease((age-.35)/.65);text(scene.lines[0],960,632,49,C.white,400,-1.4,'center');ctx.globalAlpha=ease((age-.75)/.5);
  font(21,600,-.3);const label=scene.body,w=ctx.measureText(label).width+100;rounded(960-w/2,718,w,64,32,C.lime,null);text(label,960-w/2+27,759,21,'#000000',600,-.3);arrow(960+w/2-31,750,17,'#000000');text(config.website,960,881,23,C.muted,400,.5,'center');ctx.restore();
}
const drawScene={hero,introduce,dna,brains,create,publish,visibility,autopilot,end};
function draw(time){
  ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.filter='none';ctx.letterSpacing='0px';ctx.fillStyle='#000000';ctx.fillRect(0,0,1920,1080);
  const index=Math.max(0,config.scenes.findIndex(scene=>time>=scene.start&&time<scene.end)),scene=config.scenes[index],age=time-scene.start;
  if(scene.type!=='end')chrome(scene,index,time);drawScene[scene.type](scene,age,time);
  if(index>0&&age<.23&&scene.type!=='end'){const p=clamp(age/.23);ctx.save();ctx.globalAlpha=1-p;line(132+1656*ease(p),145,Math.min(1788,300+1656*ease(p)),145,C.lime,2);ctx.restore();}
}
function updateUI(){document.getElementById('time').textContent=`00:${currentTime.toFixed(3).padStart(6,'0')}`;document.getElementById('scrubber').value=currentTime;document.getElementById('toggle').textContent=playing?'Pause':'Play';document.body.classList.toggle('playing',playing);}
function applyConfig(next){config=next;Object.assign(C,config.palette);window.FILM_CONFIG=config;lastConfig=JSON.stringify(config);}
window.seekFilm=async seconds=>{currentTime=clamp(Number(seconds),0,config.duration-1/config.fps);draw(currentTime);updateUI();return{time:currentTime};};
window.exportFilmFrame=async seconds=>{await window.seekFilm(seconds);return canvas.toDataURL('image/jpeg',.99).split(',')[1];};
window.filmReady=(async()=>{const response=await fetch('/config.json',{cache:'no-store'});if(!response.ok)throw new Error('Unable to load film config.');applyConfig(await response.json());await Promise.all([mediumFontReady,document.fonts.load('400 28px "Google Sans Flex"'),document.fonts.load('600 140px "Google Sans Flex"'),document.fonts.load('400 70px Michroma'),...Object.values(images).map(image=>image.decode())]);await document.fonts.ready;await window.seekFilm(0);status.textContent='Mellox brand film · black / white / Ultra Moss';return config;})();
window.filmReady.catch(error=>{status.textContent=error.message;console.error(error);});
function pause(){playing=false;audio.pause();updateUI();}
async function play(){await window.filmReady;if(playing){pause();return;}if(currentTime>config.duration-.08)currentTime=0;audio.currentTime=currentTime;playing=true;updateUI();try{await audio.play();}catch(error){pause();throw error;}}
function tick(){if(playing){currentTime=Math.min(audio.currentTime,config.duration-1/config.fps);draw(currentTime);updateUI();if(audio.ended)pause();}requestAnimationFrame(tick);}
if(!isRender){
  document.getElementById('toggle').onclick=()=>play().catch(console.error);document.getElementById('stagePlay').onclick=()=>play().catch(console.error);
  document.getElementById('restart').onclick=()=>{pause();window.seekFilm(0);};
  document.getElementById('scrubber').oninput=event=>{const seconds=Number(event.target.value);pause();document.body.classList.add('seeking');window.seekFilm(seconds);};
  document.getElementById('mute').onclick=()=>{audio.muted=!audio.muted;document.getElementById('mute').textContent=audio.muted?'Sound off':'Sound on';};
  for(const button of document.querySelectorAll('[data-time]'))button.onclick=()=>{pause();document.body.classList.add('seeking');window.seekFilm(Number(button.dataset.time));};
  document.addEventListener('keydown',event=>{if(event.code==='Space'&&event.target.tagName!=='INPUT'){event.preventDefault();play().catch(console.error);}});
  setInterval(async()=>{if(!config)return;try{const next=await(await fetch('/config.json',{cache:'no-store'})).json();if(JSON.stringify(next)!==lastConfig){pause();applyConfig(next);window.seekFilm(currentTime);status.textContent='Film copy and timing updated';}}catch(error){status.textContent=error.message;}},1000);
  requestAnimationFrame(tick);
}
