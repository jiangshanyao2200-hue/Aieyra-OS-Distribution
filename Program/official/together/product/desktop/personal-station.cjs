/* @file-map:start
文件: link/desktop/personal-station.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: AIDEBUG/personal-station.test.cjs, link/desktop/onboarding.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: AIDEBUG/personal-station.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  take | function
  personalStation | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
// Only this account's verified actor crosses the renderer boundary.
const /* @chain-region take | calls: Object.fromEntries, map, keys.filter */ take=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
/* @chain-region personalStation | calls: Date.now, filter, includes, Set, seats.map, map, take, slice … */ function personalStation(actor,registry,snapshot,now=Date.now()) {
  const seats=(registry.seats||[]).filter(s=>s.actor_id===actor&&s.membership_state!=='removed'&&!['removed','retired','archived'].includes(s.desired_state));
  const ids=new Set(seats.map(s=>s.id));
  const agents=(snapshot.agents||[]).filter(a=>a.id===actor).map(a=>({
    ...take(a,['id','name','last_seen','platform']),
    presence:take(a.presence,['state','source','at','host']),
    runtime:take(a.runtime,['adapter','bound','state','stale','seat_id','lease_until','runtime_reported_at','observed_at','last_activity_at','last_reported_state','evidence','session_state','platform','work_report']),
  }));
  const messages=(snapshot.messages||[]).filter(m=>m.sender===actor||m.target===actor)
    .sort((a,b)=>new Date(typeof a.created==='number'?a.created*1000:a.created)-new Date(typeof b.created==='number'?b.created*1000:b.created))
    .slice(-80).map(m=>({...take(m,['id','sender','target','created']),body:String(m.body||'').slice(0,3000),
      sender_name:m.sender===actor?(agents[0]?.name||'我的 Agent'):(snapshot.agents||[]).find(a=>a.id===m.sender)?.name||'协作者'}));
  return {observed_at:now,actor,registry:{seats:seats.map(s=>take(s,['id','name','actor_id','project','membership_state','desired_state','ownership'])),governance:[]},snapshot:{
    connection:take(snapshot.connection,['state']),agents,messages,
    tasks:(snapshot.tasks||[]).filter(t=>t.owner===actor).slice(0,40).map(t=>take(t,['id','title','owner','status','state','updated','updated_at','created','lease_until'])),
    watchdog:{seats:(snapshot.watchdog?.seats||[]).filter(s=>ids.has(s.seat_id)).map(s=>take(s,['seat_id','state','last_activity_at','last_error_at']))},
  }};
}
module.exports={personalStation};
