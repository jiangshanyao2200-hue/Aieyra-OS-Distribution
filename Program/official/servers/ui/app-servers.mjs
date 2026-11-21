import {Terminal} from '../../../../Client/Desktop/ui/vendor/xterm.mjs';
import {mountProgramToolbar} from '../../../../Theme/runtime/program-toolbar.mjs';
import {FitAddon} from '../../../../Client/Desktop/ui/vendor/xterm-fit.mjs';
import {openTerminal as mountTerminal} from '../../../../Client/Desktop/ui/terminal-host.mjs';
import {cropImage} from '../../../../Client/Desktop/ui/image-crop.mjs';
import {app,$,call,say,setupShell,setupRail,orb,el} from '../../../../Client/Desktop/ui/app-shell.mjs';
setupShell();
const FAST=4000,SLOW=10000,HISTORY=40,REVEAL_MS=20000;
const ICON={
 servers:'<rect x="4" y="4" width="16" height="6.5" rx="2"/><rect x="4" y="13.5" width="16" height="6.5" rx="2"/><path d="M8 7.2h.01M8 16.8h.01"/>',
 manage:'<path d="M5 7h14M5 12h14M5 17h14"/><circle cx="9" cy="7" r="1.8" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="8" cy="17" r="1.8" fill="currentColor" stroke="none"/>',
 vault:'<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5M12 14.2v2.2"/>',
 terminal:'<rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="m8 10 2.5 2L8 14M13 15h3"/>',
 probe:'<path d="M12 3v5M12 16v5M3 12h5M16 12h5"/><circle cx="12" cy="12" r="4"/>',
 refresh:'<path d="M20 11a8 8 0 0 0-14.3-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.3l1.7-1.8M20 20v-4.5h-4.5"/>',
 picture:'<rect x="4" y="5" width="16" height="14" rx="3"/><circle cx="9" cy="10" r="1.5"/><path d="m5 17 4.5-4 3 2.5 3-3 3.5 3.5"/>',
 remove:'<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
 eye:'<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.5"/>',
 copy:'<rect x="8" y="8" width="11" height="11" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
 edit:'<path d="m5 19 1-4L16 5l3 3L9 18zM14 7l3 3"/>',
};
let servers=[],entries=[],selected='',view='list',visible=true;
const rail=setupRail($('rail'),[{id:'list',label:'服务器',icon:ICON.servers},{id:'manage',label:'管理',icon:ICON.manage},{id:'vault',label:'密码本',icon:ICON.vault}],id=>show(id));
rail.setVisible('manage',false);
const histories=new Map(),rows=new Map(),inflight=new Set(),charts=new Map();
const bytes=kb=>{const n=Number(kb)||0;return n>=1073741824?(n/1073741824).toFixed(1)+' TB':n>=1048576?(n/1048576).toFixed(1)+' GB':(n/1024).toFixed(0)+' MB';};
const rate=v=>v==null?'—':v>=1048576?(v/1048576).toFixed(1)+' MB/s':(v/1024).toFixed(v>=102400?0:1)+' KB/s';
const total=v=>{const n=Number(v)||0;return n>=1099511627776?(n/1099511627776).toFixed(1)+' TB':(n/1073741824).toFixed(1)+' GB';};
const uptime=s=>{const d=Math.floor(s/86400),h=Math.floor(s%86400/3600);return d?d+' 天 '+h+' 小时':h+' 小时 '+Math.floor(s%3600/60)+' 分';};
const percent=v=>v==null?'—':Math.round(v)+'%';
const level=p=>p>=90?'critical':p>=75?'high':'';
const osName=s=>[s.facts?.os,s.facts?.cores?s.facts.cores+' 核':''].filter(Boolean).join(' · ');
function bar(pct){const b=el('span','sv-bar'),i=el('i');i.style.transform=`scaleX(${Math.min(100,Math.max(0,pct||0))/100})`;const l=level(pct);if(l)i.dataset.level=l;b.append(i);return b;}
function hash(text){let h=2166136261;for(const c of String(text)){h^=c.codePointAt(0);h=Math.imul(h,16777619);}return h>>>0;}

// 默认图：OS 的玻璃圆里一台线条服务器。颜色全部来自主题文字色，不用彩色块；
// 每台的机位数和指示灯位置由编号决定，同一台永远一样。
function art(id){
 const h=hash(id),slots=2+h%2,top=slots===2?27:21,lamp=i=>(h>>>(i*2))&1;
 let body='';
 for(let i=0;i<slots;i++){const y=top+i*13;body+=`<rect x="22" y="${y}" width="36" height="9.5" rx="3"/><circle class="lamp" cx="${lamp(i)?28:52}" cy="${y+4.75}" r="1.4"/><path d="M${lamp(i)?34:28} ${y+4.75}h${8+(h>>>(i+3))%7}"/>`;}
 return `<svg viewBox="0 0 80 80" aria-hidden="true"><g class="sv-art">${body}</g></svg>`;
}
function paintCover(node,s){
 node.dataset.state=s.error?'error':s.last?'ok':'';
 const key=s.image?s.image.length+':'+s.image.slice(-32):'art:'+s.id;if(node.dataset.key===key)return;node.dataset.key=key;
 if(s.image){const img=el('img');img.alt='';img.src=s.image;node.replaceChildren(img);}else node.innerHTML=art(s.id);
}
function remember(id,s){const h=histories.get(id)||{cpu:[],mem:[],rx:[],io:[]};h.cpu.push(s.cpu);h.mem.push(s.mem_used_pct);h.rx.push((s.rx_rate||0)+(s.tx_rate||0));h.io.push((s.read_rate||0)+(s.write_rate||0));for(const k of ['cpu','mem','rx','io'])if(h[k].length>HISTORY)h[k].shift();h.seq=(h.seq||0)+1;histories.set(id,h);}

// 走势图：平滑曲线加淡淡的面积；每来一个新点，整条线在一个采样周期里匀速向左滑一格，
// 看起来是连续流动而不是一跳一跳。页面看不见时浏览器会暂停动画。
const SVG='http://www.w3.org/2000/svg',W=100,H=30,STEP=W/(HISTORY-1);
function smooth(points){
 if(points.length<2)return points.length?`M${points[0][0]} ${points[0][1]}`:'';
 let d=`M${points[0][0]} ${points[0][1]}`;
 for(let i=0;i<points.length-1;i++){const [x0,y0]=points[Math.max(0,i-1)],[x1,y1]=points[i],[x2,y2]=points[i+1],[x3,y3]=points[Math.min(points.length-1,i+2)];
  d+=` C${(x1+(x2-x0)/6).toFixed(2)} ${(y1+(y2-y0)/6).toFixed(2)} ${(x2-(x3-x1)/6).toFixed(2)} ${(y2-(y3-y1)/6).toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`;}
 return d;
}
function chart(key){
 let c=charts.get(key);if(c)return c;
 const svg=document.createElementNS(SVG,'svg'),g=document.createElementNS(SVG,'g'),area=document.createElementNS(SVG,'path'),line=document.createElementNS(SVG,'path');
 svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');svg.classList.add('sv-chart');
 area.classList.add('area');line.classList.add('line');g.append(area,line);svg.append(g);
 c={svg,g,area,line,seq:0,top:1};charts.set(key,c);return c;
}
function paintChart(key,values=[],max=100,seq=0){
 const c=chart(key),peak=Math.max(...values.map(v=>v||0),0);
 // 速率类按最近峰值留出空间，并缓慢回落，避免刻度一跳一跳。
 c.top=max===100?100:Math.max(max,peak*1.2,c.top*.92);
 const start=W-(values.length-1)*STEP,pts=values.map((v,i)=>[start+i*STEP,H-1-(Math.max(0,v||0)/c.top)*(H-3)]);
 const d=smooth(pts);c.line.setAttribute('d',d);c.area.setAttribute('d',pts.length?d+` L${pts.at(-1)[0]} ${H} L${pts[0][0]} ${H} Z`:'');
 if(seq>c.seq&&c.seq>0&&values.length>1&&!matchMedia('(prefers-reduced-motion: reduce)').matches)c.g.animate([{transform:`translateX(${STEP}px)`},{transform:'translateX(0)'}],{duration:view==='detail'?FAST:SLOW,easing:'linear'});
 c.seq=seq;return c.svg;
}

function cell(label,value,detail,pct){const c=el('div','sv-cell');c.append(el('small','',label),el('b','',value));if(pct!==undefined)c.append(bar(pct));c.append(el('em','',detail||' '));return c;}
function metrics(l){return [
 cell('CPU',percent(l?.cpu),l?(l.cores||'—')+' 核 · 负载 '+String(l.load||'').split(' ')[0]:'',l?.cpu),
 cell('内存',percent(l?.mem_used_pct),l?bytes(l.mem_total_kb-l.mem_avail_kb)+' / '+bytes(l.mem_total_kb):'',l?.mem_used_pct),
 cell('硬盘',percent(l?.disk_used_pct),l?bytes(l.disk_used_kb)+' / '+bytes(l.disk_total_kb):'',l?.disk_used_pct),
 cell('带宽',l?'↓ '+rate(l.rx_rate):'—',l?'↑ '+rate(l.tx_rate):''),
 cell('运行',l?uptime(l.uptime_s):'—',l?(l.containers?.length?l.containers.length+' 容器 · ':'')+(l.procs||0)+' 进程':''),
];}
// IP 是敏感信息：列表和管理页一律不显示。
function paintRows(){
 const box=$('rows'),ids=new Set(servers.map(s=>s.id));
 for(const [id,row] of rows)if(!ids.has(id)){row.node.remove();rows.delete(id);}
 for(const s of servers){
  let row=rows.get(s.id);
  if(!row){
   const node=el('button','sv-row');node.type='button';const cover=el('span','sv-cover'),copy=el('span','sv-copy'),name=el('strong'),meta=el('span','sv-sub'),state=el('span','sv-state'),cells=el('span','sv-cells');
   copy.append(name,meta,state);node.append(cover,copy,cells);node.onclick=()=>openDetail(s.id);box.append(node);row={node,cover,name,meta,state,cells};rows.set(s.id,row);
  }
  paintCover(row.cover,s);row.name.textContent=s.name;row.meta.textContent=osName(s)||'服务器';
  row.state.textContent=s.error||(s.last?'在线':'正在连接…');row.state.dataset.state=s.error?'error':s.last?'ok':'';row.node.setAttribute('aria-label',s.name+' · '+row.state.textContent);
  row.cells.replaceChildren(...metrics(s.last));
 }
}
function tile(label,value,foot,graph){const t=el('div','sv-tile'),head=el('div','sv-tile-head');head.append(el('small','',label),el('b','',value));t.append(head);if(graph)t.append(graph);const f=el('div','sv-tile-foot');for(const part of foot)f.append(el('span','',part));t.append(f);return t;}
function line(name,value,detail,pct){const row=el('div','sv-line'),top=el('div','sv-line-top');top.append(el('span','',name),el('b','',value));row.append(top);if(pct!==undefined)row.append(bar(pct));if(detail)row.append(el('em','',detail));return row;}
function paintActions(s){
 $('d-actions').replaceChildren(
  orb('终端',ICON.terminal,()=>void openTerminal()),
 );
}
let revealTimer=0;
function hideAddress(){clearTimeout(revealTimer);$('d-address').textContent='地址已隐藏';$('d-address').dataset.hidden='true';$('d-reveal').textContent='查看 IP';}
$('d-reveal').onclick=()=>{
 const s=servers.find(x=>x.id===selected);if(!s)return;
 if($('d-address').dataset.hidden!=='true'){hideAddress();return;}
 $('d-address').textContent=s.user+'@'+s.host+(s.port!==22?':'+s.port:'');$('d-address').dataset.hidden='false';$('d-reveal').textContent='隐藏';
 clearTimeout(revealTimer);revealTimer=setTimeout(hideAddress,REVEAL_MS);
};
function paintDetail(){
 const s=servers.find(x=>x.id===selected);if(!s)return;
 paintCover($('d-cover'),s);$('d-name').textContent=s.name;
 $('d-os').textContent=[s.facts?.os,s.facts?.kernel,s.facts?.model].filter(Boolean).join(' · ');
 $('d-error').textContent=s.error||'';$('d-error').hidden=!s.error;
 const l=s.last,h=histories.get(s.id);if(!l){for(const id of ['d-tiles','d-disks','d-procs','d-boxes'])$(id).replaceChildren();return;}
 const tiles=[
  tile('CPU',percent(l.cpu),[(l.cores||'—')+' 核','负载 '+String(l.load||'—').split(' ')[0]],paintChart('cpu',h?.cpu,100,h?.seq)),
  tile('内存',percent(l.mem_used_pct),[bytes(l.mem_total_kb-l.mem_avail_kb)+' / '+bytes(l.mem_total_kb),l.swap_total_kb?'Swap '+percent(l.swap_used_pct):'缓存 '+bytes(l.mem_cached_kb)],paintChart('mem',h?.mem,100,h?.seq)),
  tile('带宽','↓ '+rate(l.rx_rate),['↑ '+rate(l.tx_rate),(l.conns||0)+' 连接'],paintChart('net',h?.rx,1024,h?.seq)),
  tile('硬盘读写','读 '+rate(l.read_rate),['写 '+rate(l.write_rate),'累计 ↓ '+total(l.net_rx)],paintChart('io',h?.io,1024,h?.seq)),
 ];
 $('d-tiles').replaceChildren(...tiles);
 $('d-disks').replaceChildren(...(l.disks||[]).map(d=>{const p=d.total_kb?d.used_kb*100/d.total_kb:0;return line(d.mount,percent(p),bytes(d.used_kb)+' / '+bytes(d.total_kb),p);}));
 $('d-procs').replaceChildren(...(l.top||[]).map(p=>line(p.name,p.cpu+'% CPU','内存 '+p.mem+'% · PID '+p.pid)));
 $('d-boxes').replaceChildren(...(l.containers?.length?l.containers.map(c=>line(c.name,'',c.status)):[el('p','sv-none','没有运行中的容器')]));
}
// 换图：和头像同一个裁切弹窗，保存后所有位置立刻换上。
const imageChoices=new Map();
const imageChoice=s=>{const ticket=(imageChoices.get(s.id)||0)+1;imageChoices.set(s.id,ticket);return ()=>imageChoices.get(s.id)===ticket&&servers.some(row=>row.id===s.id);};
async function changeImage(s){
 const current=imageChoice(s);try{
  const picked=await call({action:'image_pick',id:s.id});if(picked.cancelled||!current())return;
  const image=await cropImage(picked.source,{title:'裁切 '+s.name+' 的图',frame:[320,320],round:true,output:[256,256],previews:[{size:72,label:'列表里'},{size:40,label:'小图'}]});
  if(!image||!current())return;
  const saved=await call({action:'image_data',id:s.id,data:image});s.image=saved.image;paint();if(view==='manage')paintManage();say('已换上新图');
 }catch(e){say(e.message,true);}
}
async function resetImage(s){const current=imageChoice(s);try{await call({action:'image_clear',id:s.id});if(!current())return;s.image='';paint();paintManage();}catch(e){if(current())say(e.message,true);}}
async function randomImage(s){const current=imageChoice(s);try{const result=await call({action:'image_random',id:s.id});if(!current())return;s.image=result.image;paint();paintManage();say('已随机选择头像');}catch(e){if(current())say(e.message,true);}}
function armed(button,label,run){
 button.onclick=()=>{
  if(button.dataset.armed!=='true'){button.dataset.armed='true';button.querySelector('span').textContent='确认'+label;setTimeout(()=>{if(button.isConnected){button.dataset.armed='false';button.querySelector('span').textContent=label;}},3000);return;}
  run();
 };
 return button;
}
function paintManage(){
 $('m-rows').replaceChildren(...servers.map(s=>{
  const row=el('div','sv-manage-row'),cover=el('button','sv-cover sv-cover-edit'),copy=el('span','sv-copy'),actions=el('div','sv-actions');
  cover.type='button';cover.setAttribute('aria-label','更换 '+s.name+' 的图');cover.onclick=()=>void changeImage(s);paintCover(cover,s);
  const name=el('input','sv-name-field');name.value=s.name;name.maxLength=60;name.spellcheck=false;name.setAttribute('aria-label','名称');
  const commit=()=>{const next=name.value.trim();if(!next){name.value=s.name;return;}if(next===s.name)return;void call({action:'rename',id:s.id,name:next}).then(r=>{s.name=r.server.name;paint();}).catch(e=>{name.value=s.name;say(e.message,true);});};
  name.onblur=commit;name.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();name.blur();}if(e.key==='Escape'){name.value=s.name;name.blur();}};
  copy.append(name,el('span','sv-sub',[osName(s),({key:'密钥',password:'密码',agent:'SSH Agent'})[s.auth]].filter(Boolean).join(' · ')));
  const remove=armed(orb('移除服务器',ICON.remove),'移除服务器',()=>void call({action:'remove',id:s.id}).then(()=>{histories.delete(s.id);if(selected===s.id){closeTerminal();selected='';}return refresh();}).catch(e=>say(e.message,true)));remove.dataset.danger='true';
  actions.append(orb('上传',ICON.picture,()=>void changeImage(s)),orb('随机',ICON.refresh,()=>void randomImage(s)));
  const clearImage=orb('移除',ICON.remove,()=>void resetImage(s));clearImage.setAttribute('aria-label','移除头像');clearImage.disabled=!s.image;actions.append(clearImage);
  actions.append(remove);
  row.append(cover,copy,actions);return row;
 }));
}

// 密码本：密码默认遮住，点“查看”显示 20 秒；复制直接进剪贴板，不显示出来。
const revealed=new Map();
function paintVault(){
 $('vault-rows').replaceChildren(...entries.map(e=>{
  const row=el('div','sv-vault-row'),mark=el('span','sv-vault-mark'),copy=el('span','sv-copy'),secret=el('span','sv-secret'),actions=el('div','sv-actions');
  mark.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${ICON.vault}</svg>`;
  const title=el('strong','',e.title);
  copy.append(title,el('span','sv-sub',[e.account,e.url].filter(Boolean).join(' · ')||(e.by==='agent'?'Eyra 记下的':'')));
  const shown=revealed.get(e.id);secret.textContent=e.has_secret?shown?.secret??'••••••••':'';secret.dataset.shown=String(!!shown);
  const tag=el('span','sv-tag',e.agent?'Agent 可读':'仅自己');tag.dataset.on=String(e.agent);
  if(e.has_secret)actions.append(orb(shown?'遮住':'查看',ICON.eye,()=>void toggleSecret(e)),orb('复制',ICON.copy,()=>void copySecret(e)));
  const remove=armed(orb('删除',ICON.remove),'删除',()=>void call({action:'vault_remove',id:e.id}).then(loadVault).catch(err=>say(err.message,true)));remove.dataset.danger='true';
  actions.append(orb('编辑',ICON.edit,()=>void editEntry(e)),remove);
  row.append(mark,copy,secret,tag,actions);return row;
 }));
}
async function loadVault(){const r=await call({action:'vault_list'});entries=r.entries;for(const id of revealed.keys())if(!entries.some(e=>e.id===id))revealed.delete(id);if(view==='vault')paintVault();}
async function toggleSecret(e){
 if(revealed.has(e.id)){clearTimeout(revealed.get(e.id).timer);revealed.delete(e.id);paintVault();return;}
 try{const r=await call({action:'vault_reveal',id:e.id});revealed.set(e.id,{secret:r.secret,timer:setTimeout(()=>{revealed.delete(e.id);paintVault();},REVEAL_MS)});paintVault();}catch(err){say(err.message,true);}
}
async function copySecret(e){try{const r=await call({action:'vault_reveal',id:e.id});await navigator.clipboard.writeText(r.secret);say('已复制');}catch(err){say(err.message||'复制没有成功',true);}}
let editing=null,editEpoch=0,noteLoaded=false;
function setSwitch(on){$('v-agent').setAttribute('aria-checked',String(!!on));}
$('v-agent').onclick=()=>setSwitch($('v-agent').getAttribute('aria-checked')!=='true');
$('v-show').onclick=()=>{const f=$('v-secret');f.type=f.type==='password'?'text':'password';$('v-show').textContent=f.type==='password'?'显示':'隐藏';};
async function editEntry(e){
 const own=++editEpoch;noteLoaded=!e?.has_note;$('v-save').disabled=false;
 editing=e||null;$('vault-heading').textContent=e?'编辑':'记一条';$('v-status').textContent='';
 $('v-title').value=e?.title||'';$('v-account').value=e?.account||'';$('v-url').value=e?.url||'';$('v-secret').value='';$('v-note').value='';$('v-secret').type='password';$('v-show').textContent='显示';setSwitch(e?.agent);
 $('v-secret').placeholder=e?.has_secret?'不改就留空':'';
 if(e?.has_note)try{const r=await call({action:'vault_reveal',id:e.id});if(own!==editEpoch)return;$('v-note').value=r.note;noteLoaded=true;}catch(error){if(own===editEpoch){editing=null;say('备注读取失败：'+error.message,true);}return;}
 if(own!==editEpoch)return;
 $('vault-dialog').showModal();$('v-title').focus();
}
$('vault-new').onclick=()=>void editEntry(null);
$('v-cancel').onclick=()=>$('vault-dialog').close();
$('vault-form').onsubmit=async event=>{
 event.preventDefault();if($('v-save').disabled)return;if(!noteLoaded){$('v-status').textContent='备注尚未读取，请重新打开此条目';return;}const own=editEpoch;$('v-save').disabled=true;
 try{
  const p={action:'vault_save',title:$('v-title').value,account:$('v-account').value,url:$('v-url').value,note:$('v-note').value,agent:$('v-agent').getAttribute('aria-checked')==='true'};
  if(editing)p.id=editing.id;if($('v-secret').value||!editing)p.secret=$('v-secret').value;
  if(editing&&!editing.has_note&&!p.note)delete p.note;
  await call(p);if(own!==editEpoch)return;$('vault-dialog').close();$('v-secret').value='';await loadVault();say('已保存');
 }catch(e){if(own===editEpoch)$('v-status').textContent=e.message;}
 finally{if(own===editEpoch)$('v-save').disabled=false;}
};
$('vault-dialog').addEventListener('close',()=>{editEpoch++;editing=null;noteLoaded=false;$('v-secret').value='';$('v-note').value='';});

function paint(){
 if(!servers.length&&view==='manage')view='list';rail.setVisible('manage',servers.length>0);
 for(const [id,name]of [['v-list','list'],['v-detail','detail'],['v-manage','manage'],['v-vault','vault']])$(id).hidden=view!==name;
 rail.select(view==='detail'?'list':view);
 if(view==='list')paintRows();else if(view==='detail')paintDetail();
}
function show(next){
 if(next==='manage'&&!servers.length)next='list';
 if(next!=='detail'){closeTerminal();hideAddress();selected=view==='detail'?'':selected;}
 view=next;paint();
 if(next==='manage')paintManage();else if(next==='list')sampleAll();else if(next==='vault')void loadVault().catch(e=>say(e.message,true));
}
function openDetail(id){selected=id;charts.clear();const s=servers.find(x=>x.id===id);if(s)paintActions(s);hideAddress();show('detail');void sample(id);}
async function refresh(){const r=await call({action:'list'});servers=r.servers;for(const s of servers)if(s.last&&!histories.has(s.id))remember(s.id,s.last);if(selected&&!servers.some(s=>s.id===selected)){selected='';view='list';}paint();if(view==='manage')paintManage();}
async function sample(id){
 if(inflight.has(id))return;inflight.add(id);
 try{const r=await app.invoke({action:'status',id}),s=servers.find(x=>x.id===id);if(!s)return;if(r.ok){s.last=r.sample;s.error='';s.facts={host:r.sample.host,kernel:r.sample.kernel,cores:r.sample.cores,os:r.sample.os,model:r.sample.model};remember(id,r.sample);}else s.error=r.error;paint();}
 finally{inflight.delete(id);}
}
function sampleAll(){for(const s of servers)void sample(s.id);}
// 后台规则：页面看不见时不连服务器、不刷新；回到页面先补一次。
setInterval(()=>{if(visible&&view==='detail'&&selected)void sample(selected);},FAST);
setInterval(()=>{if(visible&&view==='list')sampleAll();},SLOW);
app.onVisibility?.(value=>{visible=value?.visible===true;if(!visible){if(!$('vault-dialog').open)editEpoch++;hideAddress();for(const [id,r] of revealed){clearTimeout(r.timer);revealed.delete(id);}if(view==='vault')paintVault();return;}if(view==='list')sampleAll();else if(view==='detail'&&selected)void sample(selected);});
async function deployProbe(id){try{const r=await call({action:'probe',id}),s=servers.find(x=>x.id===id);if(s){s.probe=true;s.last=r.sample;remember(id,r.sample);paintActions(s);}say('探针已装好');paint();}catch(e){say(e.message,true);}}
$('ask-add').onclick=()=>void call({scope:'eyra',action:'compose',text:'帮我添加一台服务器：'}).catch(e=>say(e.message,true));
const toolbar=$('rail');
mountProgramToolbar(toolbar);
// 终端
let term,fit,termKey='',observer,terminalEpoch=0;
app.on(event=>{
 if(event?.type==='servers_changed'){void refresh().then(()=>{if(view==='list')sampleAll();}).catch(()=>{});if(view==='vault')void loadVault().catch(()=>{});return;}
 if(event.key!==termKey||!event.key)return;if(event.type==='terminal')term?.write(event.data);if(event.type==='terminal_closed')closeTerminal(true);
});
async function openTerminal(){
 const s=servers.find(x=>x.id===selected);if(!s||term)return;const own=++terminalEpoch;
 $('terminal').hidden=false;$('t-title').textContent=s.name+' · 终端';
 term=new Terminal({allowTransparency:true,scrollback:5000,fontSize:13,fontFamily:'Consolas, "Cascadia Mono", monospace',cursorBlink:true,theme:{background:'#00000000',foreground:'#dce2ee',cursor:'#c9d6ff',selectionBackground:'#a9c0ec38'}});
 const current=term;fit=new FitAddon();current.loadAddon(fit);const ownFit=fit,host=mountTerminal(current,$('t-screen'));ownFit.fit();
 try{
  const r=await call({action:'terminal_open',id:s.id,cols:current.cols,rows:current.rows});
  if(own!==terminalEpoch||term!==current){await call({action:'terminal_close',key:r.key}).catch(e=>say('终端关闭未确认：'+e.message,true));return;}
  termKey=r.key;app.keepAwake?.(true);
  current.onData(data=>{if(own===terminalEpoch)void call({action:'terminal_input',key:r.key,data}).catch(e=>say(e.message,true));});
  current.onResize(({cols,rows:lines})=>{if(own===terminalEpoch)void call({action:'terminal_resize',key:r.key,cols,rows:lines}).catch(e=>say(e.message,true));});
  observer=new ResizeObserver(()=>{if(own===terminalEpoch)ownFit.fit();});observer.observe(host);current.focus();
 }catch(e){if(own===terminalEpoch){closeTerminal();say(e.message,true);}}
}
function closeTerminal(remote){
 terminalEpoch++;
 if(termKey&&!remote)void call({action:'terminal_close',key:termKey}).catch(e=>say(e.message,true));
 if(termKey)app.keepAwake?.(false);termKey='';observer?.disconnect();observer=null;term?.dispose();term=null;fit=null;$('terminal').hidden=true;
}
$('t-close').onclick=()=>closeTerminal();
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&view==='detail'&&!termKey&&!document.querySelector('dialog[open]')){event.preventDefault();show('list');}});
window.addEventListener('beforeunload',()=>{editEpoch++;closeTerminal();});
void refresh().then(()=>{paint();sampleAll();}).catch(e=>say(e.message,true));
