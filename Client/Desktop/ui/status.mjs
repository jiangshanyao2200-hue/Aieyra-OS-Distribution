// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: projectLive; count; formatTokens; usageReadouts; formatContext; usageSummary; workspaceStatus; ThoughtSampler
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/status.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import { activeStates, attentionStates } from './model.mjs';

// 核心保留原始流事实；显示时限使用 Unix 毫秒，不混用动画的 performance 时钟。
export function projectLive(live = {}, now = Date.now()) {
  if (live.thought && live.phase !== 'thinking' && live.thought_at > 0 && now - live.thought_at >= 4000)
    return { ...live, thought: '' };
  return live;
}

const count = value => Number.isFinite(value) && value > 0 ? value : 0;
export const formatTokens = value => (count(value) / 1e6).toFixed(2) + 'M';
// Compact values share the same unknown/partial rules as the full usage view.
export function usageReadouts(usage,context){
 const known=!usage.samples||usage.reported>0||usage.estimated>0;
 const tokens=value=>known?formatTokens(value):'—';
 const hover=value=>known?(count(value)/1e6).toLocaleString('en-US',{useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:6})+'M':'未报告';
 const cache=usage.cacheRate==null?'—':usage.cacheRate+'%';
 const rows=[
  {label:'累计',value:hover(usage.input+usage.output)},
  {label:'输入',value:hover(usage.input)},
  {label:'输出',value:hover(usage.output)},
  {label:'缓存命中',value:usage.cacheRate==null?'未报告':cache},
  {label:'上下文',value:formatContext(context)}
 ];
 const tip=row=>row.label+'　'+row.value;
 return {total:tokens(usage.input+usage.output),tip:tip(rows[0]),rows,items:[
  {key:'input',label:'输入',value:tokens(usage.input),tip:tip(rows[1])},
  {key:'output',label:'输出',value:tokens(usage.output),tip:tip(rows[2])},
  {key:'cache',label:'缓存',value:cache,tip:tip(rows[3])},
  {key:'context',label:'上下文',value:formatContext(context),tip:tip(rows[4])}
 ]};
}
// CTX follows the user's compression target. Provider capacity and the actual
// safeguarded threshold remain separate facts in the detail text.
export function formatContext(context) {
  const tokens=context?.tokens, window=count(context?.target)||count(context?.model_window)||count(context?.window);
  return window>0&&Number.isFinite(tokens)&&tokens>=0?(tokens/window*100).toFixed(2)+'%':'—';
}

// 只显示核心收据；缺失测量不能冒充零消耗或完整命中率。
export function usageSummary(roles = []) {
  const samples = roles.map((role) => role.usage).filter((usage) => usage?.samples > 0);
  const input = samples.reduce((sum, usage) => sum + (usage.input_tokens || 0), 0);
  const output = samples.reduce((sum, usage) => sum + (usage.output_tokens || 0), 0);
  const complete = samples.length > 0 && samples.every((usage) => usage.complete === true);
  const reported = samples.reduce((sum, usage) => sum + (usage.reported || 0), 0);
  const cacheKnown = samples.length > 0 &&
    samples.every((usage) => usage.cached_known === true);
  const cached = samples.reduce((sum, usage) => sum + (usage.cached_tokens || 0), 0);
  const cacheInput=samples.reduce((sum,u)=>sum+(u.cache_input_tokens??(u.cached_known?u.input_tokens:0)??0),0);
  const cacheReported=samples.reduce((sum,u)=>sum+(u.cache_reported??(u.cached_known?u.reported:0)??0),0);
  const compression = roles.map((role) => role.compression).filter((value) =>
    Number.isFinite(value?.before_tokens) && value.before_tokens > 0 &&
    Number.isFinite(value?.after_tokens) && value.after_tokens >= 0 &&
    value.after_tokens < value.before_tokens);
  const before = compression.reduce((sum, value) => sum + value.before_tokens, 0);
  const after = compression.reduce((sum, value) => sum + value.after_tokens, 0);
  return {
    ...(samples.some(u=>u.image_samples>0)?{image:{samples:samples.reduce((n,u)=>n+(u.image_samples||0),0),reported:samples.reduce((n,u)=>n+(u.image_reported||0),0),unknown:samples.reduce((n,u)=>n+(u.image_unknown||0),0),input:samples.reduce((n,u)=>n+(u.image_input_tokens||0),0),output:samples.reduce((n,u)=>n+(u.image_output_tokens||0),0)}}:{}),
    input, output, complete, reported, samples: samples.reduce((n,u)=>n+u.samples,0),
    estimated:samples.reduce((n,u)=>n+(u.estimated||0),0),unknown:samples.reduce((n,u)=>n+(u.unknown||0),0),
    reasoning: samples.some(u=>u.reasoning_reported>0) ? samples.reduce((sum,u)=>sum+(u.reasoning_tokens||0),0) : null,
    reasoningComplete: samples.length>0 && samples.every(u=>u.reasoning_known===true),
    cached,cacheReported,cacheComplete:cacheKnown,
    cacheRate: cacheReported>0 && cacheInput>0 ? Math.min(100, Math.round(cached/cacheInput*100)) : null,
    compression: before > 0 ? Math.round((1 - after / before) * 100) : null,
  };
}

export function workspaceStatus(snapshot, disconnected = false) {
  const roles = snapshot?.roles || [];
  const active = roles.some((role) => activeStates.has(role.state));
  const phase = snapshot?.live?.matrix?.phase || (active ? 'working' : 'settled');
  if (disconnected) return { phase: 'error', title: '连接暂时中断' };
  if (roles.some((role) => role.state === 'waiting_user'))
    return { phase: 'waiting_user', title: '等待你的答复' };
  if (roles.some((role) => role.state === 'cancelling'))
    return { phase: 'cancelling', title: '正在停止' };
  if (roles.some((role) => attentionStates.has(role.state)))
    return { phase: 'error', title: roles.find(role=>attentionStates.has(role.state))?.failure?.title||'本次工作未完成' };
  if (!snapshot?.ready || !active) return { phase: 'settled', title: 'Aieyra' };
  return { phase, title: phase === 'retry' ? '连接中断，正在重试' : '收到，我们现在开始工作。' };

}

// 每次只抽取最新真实片段；动画不延迟内容，也不保留思考队列。
export class ThoughtSampler {
  sample(live) {
    if (live?.phase !== 'thinking' || !live.thought) return '';
    const text = live.thought.trim();
    const sentences = text.match(/[^。！？.!?\n]+[。！？.!?]?/g) || [];
    return Array.from((sentences.at(-1) || text).trim()).slice(-90).join('');
  }
}
