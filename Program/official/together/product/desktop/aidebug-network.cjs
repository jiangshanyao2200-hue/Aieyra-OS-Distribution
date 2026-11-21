/* @file-map:start
文件: link/desktop/aidebug-network.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: AIDEBUG/network-probe.test.cjs, link/desktop/aidebug-live.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: AIDEBUG/network-probe.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  wait | function
  wait.abort | function
  NetworkProbe | class
  NetworkProbe.constructor | method
  NetworkProbe.constructor.wrapped | handler
  NetworkProbe.configure | method
  NetworkProbe.state | method
  NetworkProbe.close | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
// Temporary, bounded read faults. Requests and credentials are never replayed.
const /* @chain-region wait | calls: Promise, setTimeout, signal.removeEventListener, resolve, abort, signal.addEventListener */ wait=(ms,signal)=>new Promise((resolve,reject)=>{
 const /* @chain-region wait.abort | calls: clearTimeout, reject, Object.assign, Error */ abort=()=>{clearTimeout(timer);reject(Object.assign(Error('Aborted'),{name:'AbortError'}));};
 const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
});
/* @chain-region NetworkProbe */ class NetworkProbe{
 /* @chain-region NetworkProbe.constructor | calls: Object.assign */ constructor(cloud,log=()=>{},now=Date.now){
  Object.assign(this,{cloud,log,now});this.rules=[];this.original=cloud.fetch;
  /* @chain-region NetworkProbe.constructor.wrapped | calls: now, URL, toUpperCase, String, includes, rules.find, address.pathname.startsWith, r.route.endsWith … */ this.wrapped=async(url,options={})=>{
   const started=this.now(),address=new URL(url),method=String(options.method||'GET').toUpperCase(),route=address.origin+address.pathname;
   try{
    const rule=address.origin===cloud.origin&&['GET','HEAD'].includes(method)?this.rules.find(r=>r.expires>this.now()&&r.remaining>0&&address.pathname.startsWith(r.route)&&(r.route.endsWith('/')||address.pathname.length===r.route.length||address.pathname[r.route.length]==='/')&&(!r.method||r.method===method)):null;
    let response;
    if(rule){
     rule.remaining--;this.log('network-fault',{route,method,effect:rule.effect,remaining:rule.remaining});
     if(rule.delay)await wait(rule.delay,options.signal);
     if(rule.effect==='offline')throw Object.assign(Error('AIDEBUG connection interrupted'),{code:'diagnostic_offline'});
     if(rule.effect==='status')response=Response.json({error:rule.message,code:rule.code},{status:rule.status});
    }
    response||=await this.original.call(cloud,url,options);
    this.log('cloud-http',{route,method,duration:this.now()-started,status:response.status});return response;
   }catch(error){this.log('cloud-http',{route,method,duration:this.now()-started,error:error.message,code:error.cause?.code||error.code||error.name});throw error;}
  };
  cloud.fetch=this.wrapped;
 }
 /* @chain-region NetworkProbe.configure | calls: log, state, Array.isArray, Error, command.rules.map, test, includes, Number … */ configure(command={}){
  if(command.clear){this.rules=[];this.log('network-fault-clear',{});return this.state();}
  if(!Array.isArray(command.rules)||command.rules.length>8)throw Error('invalid_fault_rules');
  this.rules=command.rules.map(rule=>{
   if(typeof rule.route!=='string'||!/^\/api\/v1\/[A-Za-z0-9_./-]*$/.test(rule.route)||!['offline','status','latency'].includes(rule.effect)||rule.method&&!['GET','HEAD'].includes(rule.method))throw Error('invalid_fault_rule');
   const status=Number(rule.status??503),count=Number(rule.count??20),ttl=Number(rule.ttl??30000),delay=Number(rule.delay??0);
   if(!Number.isInteger(status)||status<400||status>599||!Number.isInteger(count)||count<1||count>100||!Number.isFinite(ttl)||ttl<100||ttl>120000||!Number.isFinite(delay)||delay<0||delay>5000)throw Error('invalid_fault_limits');
   return {route:rule.route,effect:rule.effect,method:rule.method,status,remaining:count,expires:this.now()+ttl,delay,message:String(rule.message||'服务暂不可用').slice(0,200),code:/^[a-z_]{1,60}$/.test(rule.code||'')?rule.code:'diagnostic_fault'};
  });
  this.log('network-fault-set',{rules:this.state().rules});return this.state();
 }
 /* @chain-region NetworkProbe.state | calls: map, rules.filter, now, Math.max */ state(){return {rules:this.rules.filter(r=>r.expires>this.now()&&r.remaining>0).map(({expires,...r})=>({...r,remainingMs:Math.max(0,expires-this.now())}))};}
 /* @chain-region NetworkProbe.close */ close(){this.rules=[];if(this.cloud.fetch===this.wrapped)this.cloud.fetch=this.original;}
}
module.exports={NetworkProbe};
