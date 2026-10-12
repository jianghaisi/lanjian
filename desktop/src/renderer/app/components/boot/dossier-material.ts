import * as THREE from 'three'
import fallbackTexture from '../../../assets/visuals/archive-observatory.png'
import type { ProjectSummary } from '../../../../contracts/index'
const textures=import.meta.glob<string>('../../../assets/visuals/lanjian-quartet-workbench-v2.png',{eager:true,query:'?url',import:'default'})
const coverUrl=textures['../../../assets/visuals/lanjian-quartet-workbench-v2.png']||fallbackTexture

/** Same information hierarchy and truthful metadata as the full continue-writing face. */
export function dossierTexture(project:ProjectSummary|undefined):THREE.CanvasTexture {
  const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=720
  const c=canvas.getContext('2d')!,ink='#f5f3eb',muted='#aabdb2',edge='#83bea7'
  const background=c.createLinearGradient(0,0,1536,720)
  background.addColorStop(0,'#303d37');background.addColorStop(.65,'#1c2923');background.addColorStop(1,'#354139')
  c.fillStyle=background;c.fillRect(0,0,1536,720)
  c.strokeStyle='#ccdcca10';c.lineWidth=1
  for(let x=0;x<1536;x+=94){c.beginPath();c.moveTo(x,0);c.lineTo(x,720);c.stroke()}
  for(let y=0;y<720;y+=90){c.beginPath();c.moveTo(0,y);c.lineTo(1536,y);c.stroke()}
  c.strokeStyle=edge;c.lineWidth=3;c.strokeRect(8,8,1520,704)
  c.lineWidth=1;c.strokeStyle='#a5c9b866';c.strokeRect(25,26,1486,670)
  c.fillStyle='#eaa247';c.fillRect(58,68,6,108)
  c.font='600 24px sans-serif';c.fillText('// CONTINUE WRITING',74,75)
  c.fillStyle=ink;c.font='600 80px serif';c.fillText(project?'继续创作  ↘':'你的第一部作品',69,157)
  c.fillStyle=muted;c.font='600 16px sans-serif';c.fillText('A DIFFERENT',1224,98);c.fillText('WORLD AWAITS.',1224,121)
  c.fillStyle=edge;c.font='54px sans-serif';c.fillText('→',1425,122)
  c.strokeStyle='#b4c3ba40';c.beginPath();c.moveTo(40,206);c.lineTo(1495,206);c.stroke()
  const title=project?.title??'每一个世界，始于一页。'
  const fit=(text:string,width:number)=>{const chars=Array.from(text);while(chars.length>1&&c.measureText(chars.join('')+'…').width>width)chars.pop();return chars.length===Array.from(text).length?text:chars.join('')+'…'}
  const tone=Array.from(title).reduce((sum,letter)=>sum+letter.charCodeAt(0),0)%3
  c.fillStyle=['#285a4c','#773e39','#354f60'][tone]!;c.fillRect(54,233,296,433)
  c.strokeStyle='#c8d6ce55';c.strokeRect(54,233,296,433)
  const coverTitle=()=>{c.fillStyle=ink;c.font='600 32px serif';c.textAlign='center';const chars=Array.from(title);for(let i=0;i<Math.min(4,Math.ceil(chars.length/8));i++)c.fillText(chars.slice(i*8,i*8+8).join(''),202,292+i*46);c.textAlign='start'}
  coverTitle()
  c.fillStyle=ink;c.font='600 65px serif';c.fillText(fit(title,1080),395,298)
  c.fillStyle=muted;c.font='29px sans-serif'
  const last=project?.manuscript.lastEditedChapter
  c.fillText(fit(last?`第 ${last.position} 章 · ${last.title}`:project?`${project.genre||'未分类'} · 已有 ${project.manuscript.chapterCount} 章正文`:'创建一部新作品，或从已有文稿接续。',1060),398,346)
  c.strokeStyle='#b4c3ba35';c.beginPath();c.moveTo(395,451);c.lineTo(1485,451);c.moveTo(960,463);c.lineTo(960,530);c.stroke()
  const words=project?.manuscript.wordCount,wordLabel=words==null?'打开后查看':`${words.toLocaleString('zh-CN')} 字`
  c.fillStyle=ink;c.font='600 53px sans-serif';c.fillText(wordLabel,395,521)
  const countWidth=c.measureText(wordLabel).width
  c.fillText(`${project?.manuscript.chapterCount??0} 章`,996,521)
  const chapterWidth=c.measureText(`${project?.manuscript.chapterCount??0} 章`).width
  c.fillStyle=muted;c.font='25px sans-serif';c.fillText('正文字数',408+countWidth,519);c.fillText('已写章节',1010+chapterWidth,519)
  const state=project?.manuscript.status,index=state==='ready'?100:state==='chapter-review'?66:33
  const label=state==='ready'?'索引完整':state==='chapter-review'?'章节待核对':'身份待核对'
  c.fillStyle=muted;c.font='16px sans-serif';c.fillText(`LOCAL MANUSCRIPT INDEX · ${label}`,397,566)
  c.fillStyle=ink;c.font='600 27px sans-serif';c.textAlign='right';c.fillText(`${project?index:0}%`,1485,570);c.textAlign='start'
  c.fillStyle='#65867544';c.fillRect(397,580,1088,15);c.fillStyle='#68b99a';c.fillRect(397,580,1088*(project?index/100:0),15)
  c.strokeStyle='#b4c3ba22';c.beginPath();c.moveTo(395,620);c.lineTo(1485,620);c.stroke()
  c.fillStyle=muted;c.font='22px serif';c.fillText('“ 故事仍在继续，而你，正创造它。 ”',397,662)
  const date=new Date(project?.updated_at??'')
  const modified=Number.isNaN(date.getTime())?'暂无记录':date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})
  c.textAlign='right';c.font='15px sans-serif';c.fillText('LAST EDIT',1485,644);c.fillText(modified,1485,669);c.textAlign='start'
  for(const [x,y] of [[31,31],[1505,31],[31,689],[1505,689]]){c.beginPath();c.arc(x!,y!,4,0,Math.PI*2);c.fillStyle=edge;c.fill()}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace
  // glTF UVs already use the required vertical orientation.
  texture.flipY=false;texture.anisotropy=4
  const art=new Image()
  art.onload=()=>{c.save();c.beginPath();c.rect(54,233,296,433);c.clip();c.globalCompositeOperation='soft-light';c.globalAlpha=.58;const w=433*art.width/art.height;c.drawImage(art,350-w,233,w,433);c.restore();coverTitle();texture.needsUpdate=true}
  art.src=coverUrl
  return texture
}
