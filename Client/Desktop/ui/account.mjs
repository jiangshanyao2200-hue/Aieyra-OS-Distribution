// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: $; setupAccountStatus; setupAccount
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/account.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const $=id=>document.getElementById(id);
export function setupAccountStatus(api,{onError=()=>{}}={}){
 const button=$('account-status');if(!button||!api.account)return ()=>{};
 const avatar=button.querySelector('.account-status-avatar');let state={},profile={},timer=0,busy=false,closed=false,revision=0,avatarKey='';
 function paint(){
  if(closed)return;button.hidden=!state.signedIn;
  const name=state.user?.name||'Aieyra';button.setAttribute('aria-label',name+' · API 账号');
  const image=profile.avatar||'',key=image||[...name][0]||'A';if(key===avatarKey)return;avatarKey=key;avatar.replaceChildren();
  if(image.startsWith('data:image/png;base64,')){const img=document.createElement('img');img.src=image;img.alt='';avatar.append(img);}else avatar.textContent=key.toUpperCase();
 }
 async function open(passive){
  clearTimeout(timer);if(closed||busy||!state.signedIn)return;busy=true;button.setAttribute('aria-expanded','true');
  try{const b=button.getBoundingClientRect(),bar=button.closest('#status-anchor,.module-bar')?.getBoundingClientRect(),r=await api.account({action:'menu',x:Math.min(b.right,innerWidth-16)-334,y:Math.max(b.bottom,bar?.bottom||0)+14,passive});if(r?.ok===false)throw Error(r.error||'账号暂不可用');}
  catch(e){onError(e.message);}finally{busy=false;button.setAttribute('aria-expanded','false');}
 }
 const stop=api.onAccountChanged?.(next=>{revision++;state=next;paint();});
 const refreshProfile=()=>api.profile?.().then(r=>{profile=r.profile||{};paint();}).catch(()=>{});
 const stopProfile=api.onSettingsChanged?.(event=>{if(event?.method==='saveProfile')void refreshProfile();});
 const ticket=revision;void api.account({action:'status'}).then(next=>{if(ticket===revision){state=next;paint();}}).catch(e=>onError(e.message));void refreshProfile();
 button.onclick=()=>void open(false);button.onpointerenter=()=>{timer=setTimeout(()=>void open(true),0);};button.onpointerleave=()=>clearTimeout(timer);
 return ()=>{closed=true;clearTimeout(timer);stop?.();stopProfile?.();};
}
import { poolArea } from './pool-ui.mjs';
import { hoverCard, keyRow, openModelPicker } from './model-ui.mjs';
// Aieyra API 页（用户 2026-10-16）：登录后列出账号里全部 Key，每把一行：名称 · 截断 Key · 启用开关 · 获取模型列表（弹窗）。
// Key 原文由宿主取回写进配置（aieyra_key_drafts）；渲染层只拿到名称和截断显示。禁用一把 Key 时它加进池子的模型一并移出。
export function setupAccount(api,check,ctx){
 let state={signedIn:false},busy=false,operation=0,generation=0,keysLoaded=false,keysLoading=null,keySignature='',avatar='',avatarKey='',modelPicker=null;
 const fetching=new Set();
 const identity=s=>s.signedIn?String(s.user?.id||''):'';
 function accept(next){
  const id=identity(next),changed=id!==identity(state);
  if(changed){
   generation++;operation++;busy=false;keysLoaded=false;keysLoading=null;fetching.clear();state={signedIn:false};
   modelPicker?.close();modelPicker=null;
  }
  state={...state,...next};
  if(changed)ctx.accountChanged(id);
 }
 const money=v=>v!=null&&Number.isFinite(Number(v))?(Number(v)/500000).toFixed(2):'—';
 const status=(text,error=false)=>{$('aieyra-status').textContent=text||'';$('aieyra-status').classList.toggle('error',!!error);};
 function paintAccount(){
  const signed=!!state.signedIn,u=state.user||{},name=u.name||'Aieyra',initial=signed?[...name][0].toUpperCase():'A';
  $('aieyra-account').dataset.signedIn=String(signed);
  const image=signed&&avatar.startsWith('data:image/png;base64,')?avatar:'',key=image||initial;
  if(key!==avatarKey){avatarKey=key;const face=$('aieyra-avatar');face.replaceChildren();if(image){const img=document.createElement('img');img.src=image;img.alt='';face.append(img);}else face.textContent=initial;}
  $('aieyra-name').textContent=signed?name:'Aieyra 账号';
  $('aieyra-meta').textContent=signed?[u.username&&u.username!==name?'@'+u.username:'',u.email,u.group?u.group+' 分组':''].filter(Boolean).join(' · '):'尚未登录';
  $('aieyra-stats').hidden=!signed;
  $('aieyra-balance').textContent=money(u.quota);$('aieyra-used').textContent=money(u.usedQuota);
  $('aieyra-requests').textContent=u.requestCount!=null&&Number.isFinite(Number(u.requestCount))?Number(u.requestCount).toLocaleString('zh-CN'):'—';
  $('aieyra-login').hidden=signed;$('aieyra-logout').hidden=!signed;
  const sync=$('aieyra-sync');sync.hidden=!signed;sync.disabled=busy||!!keysLoading||fetching.size>0;sync.setAttribute('aria-busy',String(!!keysLoading));sync.querySelector('span').textContent=keysLoading?'同步中…':'同步 Key';
  sync.title=state.keysSyncedAt?'上次同步 '+new Date(state.keysSyncedAt).toLocaleTimeString('zh-CN')+' · 重新同步当前账号':'同步当前登录账号的 Key 和可用状态';
  for(const e of [$('aieyra-login'),$('aieyra-logout')])e.disabled=busy||!!keysLoading;
 }
 const refreshAvatar=()=>api.profile?.().then(r=>{avatar=(r.profile||r).avatar||'';paintAccount();}).catch(()=>{});
 api.onSettingsChanged?.(event=>{if(event?.method==='saveProfile')void refreshAvatar();});
 void refreshAvatar();
 const connectionOf=token=>ctx.view()?.connections.find(c=>c.token_id===String(token.id)&&(!c.account_id||c.account_id===identity(state)));
 function paintKeys(){
  const box=$('aieyra-keys');
  const signature=JSON.stringify([state.signedIn,state.tokens,state.keyMasks,ctx.view()?.connections,busy,!!keysLoading,keysLoaded,[...fetching]]);if(signature===keySignature)return;keySignature=signature;
  if(!state.signedIn){box.replaceChildren();box.hidden=true;return;}
  box.hidden=false;
  const tokens=state.tokens||[],masks=state.keyMasks||{};
  if(!tokens.length){box.replaceChildren(Object.assign(document.createElement('p'),{className:'key-empty',textContent:keysLoaded?'账号里还没有 Key，请在 Aieyra 网站创建。':'正在读取 Key…'}));return;}
  box.replaceChildren(...tokens.map(t=>{
   const c=connectionOf(t),enabled=!!(t.usable&&c&&c.enabled!==false),unavailable=t.unavailableReason||'云端不可用';
   return keyRow({id:'account:'+t.id,name:t.name,mask:masks[t.id]||c?.key_mask||'',enabled,meta:!t.usable?unavailable:!c?(masks[t.id]?'待启用':'待同步'):!enabled?'本机已关闭':c.models?c.models+' 个在池':'',hint:!t.usable?unavailable+'，请在账号网站处理后点“同步 Key”':undefined,disabled:busy||!!keysLoading||!t.usable,fetching:fetching.has(t.id),
    onToggle:()=>toggle(t,c,!enabled),onFetch:()=>fetchKey(t)});
  }));
 }
 function paint(){
  paintAccount();paintKeys();
  const view=ctx.view();if(!view)return;
  const models=state.signedIn?view.models.filter(m=>m.source==='aieyra'):[];
  $('aieyra-pool').replaceChildren(poolArea({title:'Aieyra 模型池',models,disabled:busy,empty:state.signedIn?'暂无模型':'登录后可获取模型',onRemove:m=>ctx.remove(m,'aieyra-status'),decorate:hoverCard}));
 }
 async function run(fn){if(busy)return;busy=true;paint();const op=++operation;try{await fn(()=>op===operation);}catch(e){if(op===operation)status(e.message,true);}finally{if(op===operation){busy=false;paint();}}}
 async function loadKeys(force=false,tokenID=''){
  if(!state.signedIn)return;
  const captured=generation;
  if(keysLoading){await keysLoading;if(captured!==generation||!tokenID||state.keyMasks?.[tokenID])return;}
  if(keysLoaded&&!force&&!tokenID)return;
  const task=Promise.resolve().then(async()=>{try{
   const r=check(await api.account({action:force?'sync':'keys',...(tokenID?{token_id:tokenID}:{})}));
   if(captured!==generation)return;
   accept(r);keysLoaded=true;
   await ctx.call({op:'view'});
  }finally{if(keysLoading===task){keysLoading=null;paint();}}});
  keysLoading=task;paint();return task;
 }
 // 每把 Key 第一次用到时由后端收成连接 user-aieyra-<编号>，再取列表。
 async function catalogFor(t){
  await loadKeys();
  const r=await ctx.call({op:'catalog',token_id:String(t.id),refresh:true});
  if(r.ok===false)throw Error(r.errors?.[0]||'模型列表获取失败');
  return {id:r.connection_id,label:t.name,models:r.models};
 }
 async function fetchKey(t){
  if(fetching.has(t.id)||busy||keysLoading)return;const captured=generation;fetching.add(t.id);status('正在获取 '+t.name+' 的模型列表…');paint();
  try{const source=await catalogFor(t);if(captured!==generation)return;status(source.models.length?'':'这把 Key 暂无可用模型');picker('Aieyra · '+t.name,[source],String(t.id));}
  catch(e){if(captured===generation)status(e.message,true);}finally{if(captured===generation){fetching.delete(t.id);paint();}}
 }
 function picker(title,sources,id){
  modelPicker=openModelPicker({title,sources,opener:()=>[...document.querySelectorAll('.key-line')].find(n=>n.dataset.keyId==='account:'+id)?.querySelector('.key-line-fetch'),ctx:{
   test:(s,m)=>ctx.call({op:'test',connection_id:s.id,profile_id:m.pool_id||undefined,model:m.id,kind:m.kind}),
   add:async(s,m)=>{await ctx.call({op:'add',connection_id:s.id,model:m.id,kind:m.kind});},
   remove:async(s,m)=>{const entry=ctx.view().models.find(x=>x.connection_id===s.id&&x.model===m.id);if(entry)await ctx.call({op:'remove',id:entry.id});},
   onSave:()=>ctx.save?.('aieyra-status'),
  }});
 }
 async function toggle(t,c,enabled){
  await run(async current=>{
   let connection=c;
   if(enabled){await loadKeys(false,String(t.id));if(!current())return;const r=await ctx.call({op:'aieyra_key',token_id:String(t.id)});connection=r.connections?.find(x=>x.token_id===String(t.id));}
   if(!current())return;
   if(!connection)throw Error('这把 Key 暂时读不到，请重试');
   const removed=!enabled?ctx.view().models.filter(m=>m.connection_id===connection.id).length:0;
   await ctx.call({op:'key_enabled',connection_id:connection.id,enabled});
   if(current())status(enabled?'已启用 '+t.name:'已禁用 '+t.name+(removed?'，移出 '+removed+' 个模型':''));
  });
 }
 $('aieyra-login').onclick=()=>run(async current=>{check(await api.account({action:'login'}));if(current())status('已在内置浏览器打开登录页，登录后自动同步账号。');});
 $('aieyra-logout').onclick=()=>run(async current=>{const r=check(await api.account({action:'logout'}));if(current()){accept(r);status('');}});
 $('aieyra-sync').onclick=()=>run(async current=>{status('正在同步账号 Key…');await loadKeys(true);if(current())status(state.keysNotice||'已同步 '+(state.tokens||[]).length+' 把 Key');});
 api.onAccountChanged?.(next=>{
  const before=identity(state);accept(next);paint();
  if(next.error)status(next.error,true);else if(identity(next)!==before)status('');
  if(next.signedIn&&identity(next)!==before){
   const captured=generation;
   void loadKeys().catch(e=>{if(captured===generation)status(e.message,true);});
  }
 });
 return {
  initialize(next){if(next)accept(next);paint();},
  paint,
  async refresh(){return run(async current=>{if(state.signedIn){await loadKeys(true);return;}const r=check(await api.account({action:'refresh'}));if(!current())return;accept(r);if(r.error)throw Error(r.error);if(r.signedIn)await loadKeys();});},
 };
}
