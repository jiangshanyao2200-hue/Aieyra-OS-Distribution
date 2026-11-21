'use strict';
// A short-lived capability for one already-open browser group. The supplied
// executor is the existing runtime; this module owns no pages or model loop.
const http=require('node:http'),crypto=require('node:crypto'),path=require('node:path');
const ACTIONS=Object.freeze({
 tabs:[],open:['url'],navigate:['url'],search:['query','engine'],back:[],forward:[],reload:[],stop:[],activate:[],close:[],
 snapshot:['frame_id','selector','text','name','role','exact','offset','limit','text_offset','text_limit'],find:['frame_id','selector','text','name','role','exact','offset','limit','text_offset','text_limit'],
 wait_for:['frame_id','selector','text','url','name','role','exact','state','timeout_ms'],screenshot:[],handle_dialog:['accept','prompt_text'],
 clear_site_data:['origin','data_types'],
 click:['frame_id','revision','element_id'],fill:['frame_id','revision','element_id','value'],select:['frame_id','revision','element_id','value'],
 key:['frame_id','revision','key'],scroll:['frame_id','revision','element_id','delta_x','delta_y'],hover:['frame_id','revision','element_id'],
});
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const failure=(code,status=400)=>Object.assign(Error(code),{status});
function argumentsFor(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(ACTIONS,value.action))throw failure('unsupported_browser_action');
 const allowed=new Set(['action','tab_id',...ACTIONS[value.action]]);
 if(Object.keys(value).some(k=>!allowed.has(k)))throw failure('unsupported_browser_argument');
 if(value.tab_id!==undefined&&(typeof value.tab_id!=='string'||!/^[a-f0-9]{16}$/.test(value.tab_id)))throw failure('invalid_tab_id');
 return value;
}
function createBrowserExternalAccess({execute,describe,alive=()=>true,onChange=()=>{},lifetimeMs=30*60*1000,operationTimeoutMs=90000}){
 let server=null,starting=null,token='',origin='',expiresAt=0,timer=null,closed=false;
 const requests=new Map(),controllers=new Set();let pending=0;
 function summary(){return {enabled:!!token&&!closed&&Date.now()<expiresAt,starting:!!starting&&!closed,expires_at:expiresAt?new Date(expiresAt).toISOString():null};}
 function guide(){
  const powershell=process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'):'';
  return {protocol:'aieyra-browser/1',...summary(),base_url:origin,token:summary().enabled?token:null,scope:describe(),actions:ACTIONS,wsl_client:powershell?'/mnt/'+powershell[0].toLowerCase()+'/'+powershell.slice(3).replaceAll('\\','/'):null};
 }
 function send(response,status,value){
  if(response.destroyed)return;
  const body=JSON.stringify(value);response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Connection':'close'});response.end(body);
 }
 async function body(request){
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']||''))throw failure('json_content_type_required',415);
  if(request.headers['content-encoding'])throw failure('encoded_body_not_supported',415);
  if(Number(request.headers['content-length'])>64*1024)throw failure('request_too_large',413);
  const chunks=[];let size=0;for await(const part of request){size+=part.length;if(size>64*1024)throw failure('request_too_large',413);chunks.push(part);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw failure('invalid_json');}
 }
 function authorize(request){
  if(request.socket.remoteAddress!=='127.0.0.1'||request.headers.host!==origin.slice(7)||request.headers.origin!==undefined||request.headers['sec-fetch-site']!==undefined)throw failure('native_loopback_client_required',403);
  const supplied=Buffer.from(request.headers.authorization||''),expected=Buffer.from('Bearer '+token);
  if(!token||supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected))throw failure('unauthorized',401);
  if(closed||Date.now()>=expiresAt||!alive())throw failure('browser_access_expired',410);
 }
 function receipt(row){return {request_id:row.request_id,state:row.state,...(row.result===undefined?{}:{result:row.result}),next:row.state==='running'?'GET the same request_id; do not submit another operation.':undefined};}
 async function handle(request,response){
  try{
   authorize(request);
   const base='/api/browser/v1',route=request.url;
   if(request.method==='GET'&&route===base+'/status')return send(response,200,{protocol:'aieyra-browser/1',...summary(),scope:describe(),actions:ACTIONS});
   const lookup=request.method==='GET'&&/^\/api\/browser\/v1\/requests\/([A-Za-z0-9_.:-]{1,100})$/.exec(route);
   if(lookup){const row=requests.get(lookup[1]);return row?send(response,200,receipt(row)):send(response,404,{ok:false,error:'request_not_found'});}
   if(request.method!=='POST'||route!==base+'/execute')throw failure('route_not_found',404);
   const value=await body(request);authorize(request);
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['request_id','arguments'].includes(k))||typeof value.request_id!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(value.request_id))throw failure('request_id_required');
   const args=argumentsFor(value.arguments),digest=crypto.createHash('sha256').update(canonical(args)).digest('hex'),old=requests.get(value.request_id);
   if(old){if(old.digest!==digest)throw failure('request_id_conflict',409);return send(response,old.state==='running'?202:200,receipt(old));}
   if(requests.size>=64)throw failure('grant_request_limit_reached_generate_new_access',429);
   if(pending>=4)throw failure('browser_access_busy',429);
   const row={request_id:value.request_id,digest,state:'running'},controller=new AbortController();requests.set(value.request_id,row);controllers.add(controller);pending++;
   // Losing the caller connection never replays or cancels a possibly-dispatched
   // action. Its receipt remains queryable with the original request_id.
   let timedOut=false,interrupted;
   const interruption=new Promise((_resolve,reject)=>{interrupted=()=>reject(Error(timedOut?'operation_timed_out_outcome_unknown_inspect_before_retry':'browser_access_revoked_outcome_unknown'));controller.signal.addEventListener('abort',interrupted,{once:true});});
   const timeout=setTimeout(()=>{timedOut=true;controller.abort();},operationTimeoutMs);timeout.unref?.();
   try{
    const result=await Promise.race([Promise.resolve().then(()=>execute(args,controller.signal)),interruption]);
    row.result=Buffer.byteLength(JSON.stringify(result))<=1024*1024?result:{ok:false,error:'browser_result_too_large_use_a_narrower_snapshot'};
    row.state=timedOut?'unknown':'completed';
    if(timedOut)row.result={ok:false,error:'operation_timed_out_outcome_unknown_inspect_before_retry'};
   }catch(error){row.state=controller.signal.aborted?'unknown':'failed';row.result={ok:false,error:String(error.message||error).slice(0,1500)};}
   finally{clearTimeout(timeout);controller.signal.removeEventListener('abort',interrupted);controllers.delete(controller);pending--;}
   send(response,200,receipt(row));
  }catch(error){send(response,error.status||500,{ok:false,error:error.status?error.message:'browser_access_unavailable'});}
 }
 async function start(){
  if(closed)throw Error('Browser access closed');
  if(summary().enabled)return guide();
  if(starting)return starting;
  starting=(async()=>{
   const instance=http.createServer((request,response)=>{void handle(request,response);});
   instance.headersTimeout=5000;instance.requestTimeout=10000;instance.keepAliveTimeout=1000;instance.maxConnections=12;
   server=instance;token=crypto.randomBytes(32).toString('hex');
   try{await new Promise((resolve,reject)=>{instance.once('error',reject);instance.listen(0,'127.0.0.1',resolve);});}
   catch(error){token='';server=null;throw error;}
   if(closed){instance.close();throw Error('Browser access closed');}
   origin='http://127.0.0.1:'+instance.address().port;expiresAt=Date.now()+lifetimeMs;
   timer=setTimeout(close,lifetimeMs);timer.unref?.();onChange();return guide();
  })();
  try{return await starting;}finally{starting=null;}
 }
 function close(){
  if(closed)return;closed=true;token='';clearTimeout(timer);for(const controller of controllers)controller.abort();
  server?.close();server?.closeAllConnections?.();requests.clear();onChange();
 }
 return {start,guide,summary,close};
}
module.exports={createBrowserExternalAccess,argumentsFor,ACTIONS};
