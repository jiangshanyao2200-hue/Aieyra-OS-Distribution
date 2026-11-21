// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: channel; visible; send; motion; silentWav; media; terminal; report; dispose
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/theme-showcase-frame.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {applyAppearance} from '../../../Theme/runtime/appearance.mjs';
import {applyLayoutTheme} from '../../../Theme/runtime/layout.mjs';
import {coverage,scenes,states} from '../../../Theme/showcase/catalog.mjs';
import {mountScene,setSampleState} from '../../../Theme/showcase/fixtures.mjs';
import {setupMediaViewer} from '../../../Theme/runtime/media.mjs';
import {setupImageViewer} from './image-viewer.mjs';
import {createAttachmentCards,renderAttachmentList} from './attachments.mjs';
import {Terminal} from './vendor/xterm.mjs';
import {FitAddon} from './vendor/xterm-fit.mjs';
import {openTerminal} from './terminal-host.mjs';
import {motionAllowed,motionDuration,setupMotion} from './motion.mjs';
const channel=location.hash.slice(1),host=document.querySelector('main');let mounted=null,scene='',selectedState='',appearance=null;
let visible=true;const visibilityListeners=new Set();
const send=data=>parent.postMessage({channel,...data},'*');
const motion=setupMotion(document);
function silentWav(){const bytes=new Uint8Array(16044),v=new DataView(bytes.buffer),put=(at,text)=>[...text].forEach((c,i)=>{bytes[at+i]=c.charCodeAt(0);});put(0,'RIFF');v.setUint32(4,bytes.length-8,true);put(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);put(36,'data');v.setUint32(40,16000,true);return bytes;}
function media(root){
 const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');ctx.fillStyle='#20334c';ctx.fillRect(0,0,640,360);ctx.fillStyle='#aec6e6';ctx.font='32px sans-serif';ctx.fillText('主题图片示例 · Sample',72,180);const picture={data:canvas.toDataURL('image/png'),width:640,height:360};
 const image=setupImageViewer({call:async()=>picture,attachItems:async()=>{},onError:error=>send({type:'error',error})});
 const player=setupMediaViewer({read:async()=>({mime:'audio/wav',bytes:silentWav()}),document,subscribeVisibility:fn=>{visibilityListeners.add(fn);fn({visible});return ()=>visibilityListeners.delete(fn);}});
 const imageEntry={kind:'image',asset:'sample-picture',name:'示例图片.png',mime:'image/png',sha256:'1'.repeat(64),bytes:1024,label:'图1'},audioEntry={kind:'file',asset:'sample-audio',name:'静音示例.wav',mime:'application/octet-stream',sha256:'2'.repeat(64),bytes:16044,label:'文件1'};
 const showImage=()=>image.show([{...imageEntry,image:picture}]),showMedia=()=>player.show(audioEntry);
 root.querySelector('[data-open-image]').onclick=()=>void showImage();root.querySelector('[data-open-media]').onclick=()=>void showMedia();
 root.querySelector('.chat-artifacts').append(createAttachmentCards([imageEntry,audioEntry]));
 const list=root.querySelector('.sample-attachments');let entries=[imageEntry,audioEntry];const render=()=>renderAttachmentList(list,entries,(_a,index)=>{entries=entries.filter((_,i)=>i!==index);render();},{preview:a=>a.kind==='image'?showImage():showMedia(),thumbnail:async()=>picture});render();
 const imageEvent=()=>void showImage(),mediaEvent=()=>void showMedia();document.addEventListener('eyra-attachment',imageEvent);document.addEventListener('eyra-media',mediaEvent);
 return ()=>{document.removeEventListener('eyra-attachment',imageEvent);document.removeEventListener('eyra-media',mediaEvent);image.close();image.viewer.remove();player.dispose();};
}
function terminal(root){
 const term=new Terminal({disableStdin:true,cursorBlink:false,fontSize:13,scrollback:100,convertEol:true,allowTransparency:true}),fit=new FitAddon();term.loadAddon(fit);openTerminal(term,root);
 term.write('示例终端 · 无真实命令\r\n$ node example.js\r\n数量: 42\r\n完成\r\n');
 const resize=()=>{if(root.isConnected)fit.fit();},observer=new ResizeObserver(resize);observer.observe(root);document.addEventListener('workspace-theme-change',resize);resize();
 return ()=>{observer.disconnect();document.removeEventListener('workspace-theme-change',resize);term.dispose();};
}
function report(){send({type:'coverage',scene,...coverage(document)});}
function dispose(){applyLayoutTheme(document,null);mounted?.dispose();mounted=null;scene='';}
window.addEventListener('message',event=>{
 if(event.source!==parent||event.data?.channel!==channel)return;const message=event.data;if(message.type!=='render')return;
 try{
  if(!scenes.some(([id])=>id===message.scene)||!Object.hasOwn(states,message.state))throw Error('展示选项无效');
  appearance=message.appearance;document.body.classList.toggle('reduce-motion',!!message.reduced);
  visible=message.visible!==false;document.body.dataset.visible=String(visible);for(const listener of visibilityListeners)listener({visible});
  const changed=scene!==message.scene;
  if(changed){dispose();scene=message.scene;mounted=mountScene(document,host,scene,{media,terminal,motion:{allowed:motionAllowed,duration:motionDuration}});}
  applyAppearance(document.body,appearance.settings,appearance.fields);
  if(changed||selectedState!==message.state){setSampleState(document,message.state);selectedState=message.state;}
  if(changed)for(const node of [document.scrollingElement,document.body,host])node.scrollTo(0,0);
  report();
 }catch(error){send({type:'error',error:error.message});}
});
document.addEventListener('click',()=>queueMicrotask(report));document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing&&!document.querySelector('dialog[open],[popover]:popover-open'))send({type:'close'});});
window.addEventListener('pagehide',()=>{dispose();motion?.close();});
send({type:'ready',privileged:!!window.aieyraApp});
