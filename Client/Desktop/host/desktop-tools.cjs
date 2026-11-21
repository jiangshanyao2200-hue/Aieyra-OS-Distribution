// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: createDesktopTools
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/desktop-tools.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';

// Current-session module operations share the public runtime; legacy Link and
// Eyra composer actions remain compatible. Removed canvas/editor actions reject.
function createDesktopTools({surface,link,control,softwareAPI,modPackages,sessionId,authorizeSession=()=>false,authorizeLink=fn=>fn()}={}){
 const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
 return {async call(p,callerSession,signal){
  if(callerSession!==sessionId&&!await authorizeSession(callerSession))fail('SESSION_CONFLICT','桌面能力需要当前 OS 或已绑定的程序会话。');
  if(!p||typeof p!=='object'||Array.isArray(p)||typeof p.action!=='string')fail('INVALID_REQUEST','桌面工具参数无效。');
  const navigate=page=>{if(signal?.aborted)fail('CANCELLED','操作在执行前已取消。');return surface.navigate(page);};
  if(p.action==='package'||p.action==='program'){
   if(!modPackages)fail('HOST_NOT_READY','包运行时尚未就绪。');
   const allowed=p.action==='package'?['capabilities','list','inspect','install','enable','disable','rollback','remove']:['open','close','describe','snapshot','invoke'];
   if(!allowed.includes(p.operation))fail('INVALID_REQUEST','未知包或程序操作。');
   if(p.action==='program'){
    const args=p.arguments;
    if(!args||typeof args.id!=='string'||!args.id.trim())fail('INVALID_PROGRAM_ARGUMENTS','请在 arguments.id 提供程序包 ID，例如 aieyra.center。');
    if(p.operation==='invoke'&&(typeof args.operation!=='string'||!args.operation.trim()||!args.arguments||typeof args.arguments!=='object'||Array.isArray(args.arguments)))
      fail('INVALID_PROGRAM_ARGUMENTS','program invoke 需要 arguments.operation 和对象 arguments.arguments。');
   }
   return modPackages.call({...p.arguments,action:'mod_'+p.operation},undefined,{signal});
  }
  if(['describe','modules','module','order','receipt'].includes(p.action)){
   if(!softwareAPI)fail('HOST_NOT_READY','软件操作接口尚未就绪。');
   return softwareAPI.call(p,callerSession,signal);
  }
  if(p.action==='link_status')return authorizeLink(async()=>{
   const [connection,office]=await Promise.all([link.status(),control.status()]);
   // Invitation codes and identity keys belong only to the local display.
   const publicConnection={};for(const key of ['installed','available','hub_state','cloud_state','connected','online','running','version','checked_at'])if(['string','boolean','number'].includes(typeof connection?.[key]))publicConnection[key]=connection[key];
   return {ok:true,connection:publicConnection,office:office.office,available:office.available};
  });
  if(p.action==='link_open'&&softwareAPI)return softwareAPI.call({action:'module',module:'link',operation:'open',request_id:p.request_id},callerSession,signal);
  if(p.action==='link_open')return authorizeLink(()=>navigate('link'));
  if(p.action==='eyra_open')return navigate('eyra');
  if(p.action==='eyra_close')return navigate('collapse-eyra');
  if(/^(canvas|editor)_/.test(p.action))fail('UNAVAILABLE','此旧画布或编辑接口已退役。Workspace 请使用 software_api 的 program 接口，id=aieyra.workspace；独立 IDE 尚未接入。');
  fail('UNKNOWN_ACTION','未知的桌面工具。');
 }};
}
module.exports={createDesktopTools};
