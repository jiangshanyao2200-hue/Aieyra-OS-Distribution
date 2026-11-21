import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { GitBranch, Code2, Image, FileText, Search, Settings2, X, Plus } from "lucide-react";
import { ActionButton, ButtonBase, InlineNotice } from "./ui";
import { StreamingMarkdown } from "./coding-timeline";
import type { CodingRequest, CodingState } from "./coding-types";
import "./matrix-delegates.css";

type Task = { id: string; name: string; model: string; profileId: string; status: string; progress?: string; result?: string; error?: string; updatedAt: number;
  managedSeat?:boolean;inputVersion?:number;blockedReason?:string;seatId?:string;role?:string;generation?:number;deliveryError?:string;
  instructions?: string; acceptance?: string; prompt?: string; baseTools: string[]; toolNames: string[]; requests?: CodingRequest[];
  review?: { verdict: string; evidence: string } | null; usage?: { total?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number } } };
export type DelegateTask = Task;
type Reply = { requestId: string | number; decision?: string; answers?: Record<string, string> };
const active = (task: Task) => ["starting", "running", "waiting", "stopping"].includes(task.status);
const queued = (task:Task) => ["received","blocked"].includes(task.status);
const labels: Record<string, string> = { received:"已接单",blocked:"等待条件",starting: "准备中", running: "执行中", waiting: "等待回复", stopping: "正在停止", stopped: "已停止", interrupted: "结果待核对", completed: "待母体验收", error: "需要处理" };
type Seat = {seatId:string;name:string;role?:string;status:string;configVersion:number;modelMode:string;profileId:string;model:string;instructions?:string;baseTools:string[];toolNames:string[]};
type Role = {id:string;name:string;description:string;baseTools:string[];toolNames:string[];instructions:string};
type Model = {profileId:string;profileName?:string;model:string;available:boolean};
type Call = (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; task?: Task; tasks?: Task[]; error?: string;seats?:Seat[];roles?:Role[];models?:Model[];nextOffset?:number|null;epoch?:string;cursor?:number;reset?:boolean }>;

export function DelegateCard({ task, call, requestView, initiallyOpen = false }: { task: Task; call: Call; requestView: (request: CodingRequest, busy: boolean, reply: (value: Reply) => void) => ReactNode; initiallyOpen?:boolean }) {
  const [open, setOpen] = useState(initiallyOpen), [detail, setDetail] = useState<Task | null>(null), [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [recovery,setRecovery]=useState("");
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    void call("agents.status", { taskId: task.id }).then(result => { if (!disposed && result.task) setDetail(result.task); }).catch(caught => { if (!disposed) setError(caught.message); });
    return () => { disposed = true; };
  }, [open, task.id, task.updatedAt, call]);
  const shown = detail && detail.updatedAt >= task.updatedAt ? detail : task;
  async function act(name: string, args: Record<string, unknown> = {}) {
    setBusy(true); setError("");
    try { const result = await call(name, { taskId: task.id, ...(shown.managedSeat?{expectedVersion:shown.inputVersion}:{}), ...args }); if (result.task) setDetail(result.task); if (name === "agents.send") {setPrompt("");setRecovery("");} }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }
  const usage = shown.usage?.total;
  return <article className="matrix-delegate" data-task-id={task.id}>
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary><GitBranch size={14} /><strong>{task.name}</strong><span className="matrix-delegate-model" title={task.profileId}>{task.model}</span><span className={`matrix-delegate-state is-${task.status}`}>{task.review?.verdict === "accepted" ? "已核验" : task.review?.verdict === "rework" ? "待返工" : labels[task.status] || task.status}</span></summary>
      {open ? <div className="matrix-delegate-body">
        {(shown.requests || []).map(request => <div key={request.id}>{requestView(request, busy, value => void act("agents.reply", {...value,requestToken:(request as CodingRequest&{requestToken?:string}).requestToken}))}</div>)}
        {shown.error && ["error","interrupted"].includes(shown.status) ? <InlineNotice tone="danger">{shown.error}</InlineNotice> : null}
        {shown.deliveryError ? <InlineNotice tone="danger">成果已记录，通知母体待重试：{shown.deliveryError}</InlineNotice> : null}
        {shown.blockedReason&&queued(shown)?<p>{shown.blockedReason}</p>:null}
        {shown.result || shown.progress ? <StreamingMarkdown text={shown.result || shown.progress || ""} streaming={active(task)} /> : null}
        {shown.review ? <p><strong>{shown.review.verdict === "accepted" ? "核验结果" : "返工要求"}</strong> · {shown.review.evidence}</p> : null}
        <details className="matrix-delegate-context"><summary>任务与执行配置</summary>
        {shown.prompt ? <p className="matrix-delegate-goal">{shown.prompt}</p> : null}
        {shown.acceptance ? <p><strong>验收标准</strong> · {shown.acceptance}</p> : null}
        <p className="matrix-delegate-tools"><strong>分配工具</strong> · {[...task.baseTools, ...task.toolNames].join(" · ") || "直接分析任务"}</p>
        {shown.instructions ? <details><summary>专用提示词</summary><p>{shown.instructions}</p></details> : null}
        {shown.inputVersion?<p>任务版本 {shown.inputVersion} · {shown.id}</p>:null}
        </details>
        {usage ? <p className="matrix-delegate-usage">{shown.managedSeat?"工位原生会话累计 · ":""}输入 {((usage.inputTokens || 0) / 1000).toFixed(1)} K · 输出 {((usage.outputTokens || 0) / 1000).toFixed(1)} K · 缓存 {usage.inputTokens ? ((usage.cachedInputTokens || 0) / usage.inputTokens * 100).toFixed(0) : "0"}%</p> : null}
        <form className="matrix-delegate-followup" onSubmit={event => { event.preventDefault(); void act("agents.send", { prompt,...(shown.managedSeat?{version:(shown.inputVersion||1)+1,recoveryEvidence:recovery}:{}) }); }}>
          <textarea className="ui-control" rows={2} aria-label={`给${task.name}补充要求`} placeholder="补充要求、指出问题，或继续这个任务" value={prompt} onChange={event => setPrompt(event.target.value)} />
          {shown.managedSeat&&shown.status==="interrupted"?<textarea className="ui-control" rows={2} aria-label="恢复前核对依据" placeholder="先核对已有文件和副作用，再记录核对结果以继续" value={recovery} onChange={event=>setRecovery(event.target.value)}/>:null}
          <div><ActionButton type="submit" disabled={busy || !prompt.trim() || queued(shown) || shown.managedSeat&&active(shown) || shown.managedSeat&&shown.status==="interrupted"&&!recovery.trim() || shown.status === "starting" || shown.status === "stopping" || shown.status === "waiting"}>{active(shown) ? "补充要求" : "继续任务"}</ActionButton>{shown.managedSeat&&shown.status==="interrupted"?<ActionButton disabled={busy||!recovery.trim()} variant="ghost" onClick={()=>void act("agents.cancel",{recoveryEvidence:recovery})}>核对后结束</ActionButton>:null}{active(shown)||queued(shown) ? <ActionButton disabled={busy || shown.status === "stopping"} variant="ghost" onClick={() => void act("agents.cancel")}>{queued(shown)?"取消待执行任务":"停止执行者"}</ActionButton> : null}</div>
        </form>
      </div> : null}
    </details>
    {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
  </article>;
}

export function MatrixDelegates({ projectId, conversationId, requestView, onActivity }: { onActivity?: (agents: NonNullable<CodingState["agents"]>) => void; projectId: string; conversationId: string; requestView: (request: CodingRequest, busy: boolean, reply: (value: Reply) => void) => ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]), [seats,setSeats]=useState<Seat[]>([]), [error, setError] = useState("");
  const [opened,setOpened]=useState<string|null>(null),[manager,setManager]=useState(false),[expanded,setExpanded]=useState(false);
  const cursor=useRef<{epoch?:string;after?:number}>({});
  const call: Call = useCallback(async (name, args) => {
    const result = await window.aieyraMatrix.execute({ projectId, conversationId, name, arguments: args });
    if (!result.ok) throw Error(String(result.error || "执行者操作未完成。"));
    return result as Awaited<ReturnType<Call>>;
  }, [projectId, conversationId]);
  useEffect(() => {
    let disposed = false, busy=false, dirty=false, timer: ReturnType<typeof setTimeout> | undefined;
    cursor.current={};setTasks([]);setSeats([]);setOpened(null);setManager(false); setError("");
    const refresh = async () => {
      if(busy){dirty=true;return;}busy=true;
      try {
        const result=await call("agents.collaboration",{conversationId,...cursor.current});if(disposed)return;
        setTasks(previous=>{const merged=new Map((result.reset?[]:previous).map(task=>[task.id,task]));for(const task of result.tasks||[])merged.set(task.id,task);return [...merged.values()].sort((a,b)=>b.updatedAt-a.updatedAt);});
        setSeats(result.seats||[]);cursor.current={epoch:result.epoch,after:result.cursor};setError("");
      }catch(caught){if(!disposed)setError(caught instanceof Error?caught.message:String(caught));}
      finally{busy=false;if(dirty&&!disposed){dirty=false;void refresh();}}
    };
    void refresh();
    const off = window.aieyraMatrix.onChanged(event => {
      if (event.kind === "agents" && !timer) timer = setTimeout(() => { timer = undefined; refresh(); }, 300);
    });
    const interval=setInterval(()=>void refresh(),8000);
    return () => { disposed = true; clearTimeout(timer);clearInterval(interval); off(); };
  }, [call, conversationId]);
  const activity = JSON.stringify(tasks.filter(active).map(task => ({ id: task.id, name: task.name, status: task.status })));
  useEffect(() => { onActivity?.(JSON.parse(activity)); }, [activity, onActivity]);
  const selected=tasks.find(task=>task.id===opened);
  const priority=(task:Task)=>task.status==="waiting"?0:active(task)?1:queued(task)?2:["error","interrupted"].includes(task.status)?3:task.status==="completed"&&!task.review?4:5;
  const current=[...tasks].sort((a,b)=>priority(a)-priority(b)||b.updatedAt-a.updatedAt);
  const shown=expanded?current.slice(0,30):current.slice(0,4);
  const status=(task:Task)=>task.review?.verdict==="accepted"?"已核验":task.review?.verdict==="rework"?"待返工":labels[task.status]||task.status;
  return <section className="matrix-crew" aria-label="流窜 AI" data-ui-interactive="true" onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onWheel={event=>event.stopPropagation()} onKeyDown={event=>{event.stopPropagation();if(event.key==="Escape"){setOpened(null);setManager(false);setExpanded(false);}}}>
    {manager?<div className="matrix-crew-panel" role="region" aria-label="管理流窜 AI"><header><strong>流窜 AI · 配置</strong><ButtonBase aria-label="关闭执行者配置" onClick={()=>setManager(false)}><X size={16}/></ButtonBase></header><CrewManager call={call}/></div>:selected?<div className="matrix-crew-panel" role="region" aria-label={`${selected.name}任务详情`}><header><strong>执行记录</strong><ButtonBase aria-label="关闭任务详情" onClick={()=>setOpened(null)}><X size={16}/></ButtonBase></header><DelegateCard key={selected.id} task={selected} call={call} requestView={requestView} initiallyOpen/></div>:null}
    {error?<InlineNotice tone="danger">状态更新失败，保留上次记录：{error}</InlineNotice>:null}
    <div className="matrix-crew-orbits" aria-label="执行者进展">{shown.map(task=>{const Icon=roleIcon(task.role);return <ButtonBase key={task.id} className={`matrix-crew-agent is-${task.status}`} aria-label={`${task.name} · ${status(task)}`} title={`${task.name} · ${status(task)}${task.progress?`：${task.progress}`:""}`} aria-expanded={opened===task.id&&!manager} onClick={()=>{setManager(false);setOpened(opened===task.id?null:task.id);}}>
      <span className="matrix-crew-orb"><Icon size={17}/></span><span className="matrix-crew-bubble"><strong><span title={task.name}>{task.name}</span><small>{status(task)}</small></strong><span>{task.status==="waiting"?"有问题需要答复，点击查看":task.blockedReason&&queued(task)?task.blockedReason:["error","interrupted"].includes(task.status)?task.error:task.progress||task.result||"任务已接收"}</span></span>
    </ButtonBase>;})}</div>
    <div className="matrix-crew-bar"><ButtonBase onClick={()=>{setManager(!manager);setOpened(null);}} aria-label="管理流窜 AI" title={`流窜 AI · ${tasks.filter(active).length} 执行中`} aria-expanded={manager}><Settings2 size={14}/><span>流窜 AI</span></ButtonBase><span role="status">{tasks.filter(active).length} 执行中{seats.length?` · ${seats.filter(seat=>seat.status==="idle").length} 空闲`:""}</span>{current.length>4?<ButtonBase onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}>{expanded?"收起":`全部 ${current.length}`}</ButtonBase>:null}</div>
  </section>;
}

const roleIcons:Record<string,typeof GitBranch>={coding:Code2,image:Image,documents:FileText,research:Search};
const roleIcon=(role?:string)=>roleIcons[role||""]||GitBranch;
function CrewManager({call}:{call:Call}) {
  const [seats,setSeats]=useState<Seat[]>([]),[roles,setRoles]=useState<Role[]>([]),[models,setModels]=useState<Model[]>([]),[next,setNext]=useState<number|null|undefined>(null);
  const [draft,setDraft]=useState<Seat|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;void call("agents.seats",{operation:"list"}).then(result=>{if(alive.current){setSeats(result.seats||[]);setRoles(result.roles||[]);}}).catch(e=>{if(alive.current)setError(e.message);});return()=>{alive.current=false;};},[call]);
  const loadModels=async(offset=0)=>{setBusy(true);try{const result=await call("agents.models",{offset,limit:100});if(alive.current){setModels(previous=>offset?[...previous,...result.models||[]]:result.models||[]);setNext(result.nextOffset);}}catch(e){if(alive.current)setError(e instanceof Error?e.message:String(e));}finally{if(alive.current)setBusy(false);}};
  const changeRole=(role:Role)=>setDraft(current=>({...current!,role:role.id,name:role.name,instructions:role.instructions,baseTools:role.baseTools,toolNames:role.toolNames}));
  const save=async(remove=false)=>{if(!draft)return;setBusy(true);setError("");setNotice("");try{
    const {seatId,configVersion,name,role,modelMode,profileId,model,instructions,baseTools,toolNames}=draft;
    const result=await call("agents.seats",remove?{operation:"remove",seatId,expectedVersion:configVersion}:{operation:"save",seatId,expectedVersion:configVersion,name,...(role?{role}:{}),modelMode,...(modelMode==="fixed"?{profileId,model}:{}),instructions,baseTools,toolNames});
    if(alive.current){setSeats(result.seats||[]);setDraft(null);setNotice(remove?"执行者已移除，历史成果保留。":"配置已保存，下一次派单使用此配置。");}
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:String(e));}finally{if(alive.current)setBusy(false);}};
  return <div className="matrix-crew-manager"><p>母体按任务调用，空闲时不运行模型。默认沿用母体当前会话模型。</p>
    <div className="matrix-crew-seat-list">{seats.map(seat=><ButtonBase key={seat.seatId} onClick={()=>{setDraft(seat);setError("");setNotice("");if(seat.modelMode==="fixed")void loadModels();}}><strong>{seat.name}</strong><span>{seat.modelMode==="inherit"?"跟随母体":seat.model} · {seat.status==="idle"?"空闲":labels[seat.status]||seat.status}</span></ButtonBase>)}</div>
    <ActionButton variant="ghost" disabled={busy||!roles.length} onClick={()=>{const role=roles[0];setDraft({seatId:`crew-${Date.now().toString(36)}`,name:role.name,role:role.id,status:"idle",configVersion:0,modelMode:"inherit",profileId:"",model:"",instructions:role.instructions,baseTools:role.baseTools,toolNames:role.toolNames});setError("");setNotice("");}}><Plus size={14}/>添加执行者</ActionButton>
    {draft?<form onSubmit={event=>{event.preventDefault();void save();}} className="matrix-crew-config"><label>名称<input className="ui-control" value={draft.name} maxLength={100} required onChange={event=>setDraft({...draft,name:event.target.value})}/></label>
      <label>分工<select aria-label="分工" className="ui-control" value={draft.role||""} onChange={event=>{const role=roles.find(role=>role.id===event.target.value);if(role)changeRole(role);}}>{!draft.role?<option value="">自定义</option>:null}{roles.map(role=><option key={role.id} value={role.id}>{role.name} · {role.description}</option>)}</select></label>
      <label>模型<select aria-label="模型" className="ui-control" value={draft.modelMode} onChange={event=>{setDraft({...draft,modelMode:event.target.value});if(event.target.value==="fixed")void loadModels();}}><option value="inherit">跟随母体当前模型</option><option value="fixed">指定已保存的模型</option></select></label>
      {draft.modelMode==="fixed"?<><label>已启用模型<select aria-label="已启用模型" className="ui-control" value={JSON.stringify([draft.profileId,draft.model])} onChange={event=>{const [profileId,model]=JSON.parse(event.target.value) as string[];setDraft({...draft,profileId,model});}}><option value={JSON.stringify([draft.profileId,draft.model])}>{draft.model||"选择模型"}</option>{models.filter(model=>model.available&&!(model.profileId===draft.profileId&&model.model===draft.model)).map(model=><option key={`${model.profileId}/${model.model}`} value={JSON.stringify([model.profileId,model.model])}>{model.profileName||model.profileId} · {model.model}</option>)}</select></label>{next!=null?<ActionButton disabled={busy} variant="ghost" onClick={()=>void loadModels(next)}>更多模型</ActionButton>:null}</>:null}
      <details><summary>职责与工具范围</summary><label>专用提示词<textarea className="ui-control" rows={4} value={draft.instructions||""} maxLength={24000} onChange={event=>setDraft({...draft,instructions:event.target.value})}/></label><p>{[...draft.baseTools,...draft.toolNames].join(" · ")}</p><small>更细工具分配可交由 画布助手 使用 crew 修改。</small></details>
      {draft.status!=="idle"?<p>该执行者仍有未处理任务，请在任务详情结束或核对后再修改。</p>:null}
      <div className="matrix-crew-actions"><ActionButton type="submit" disabled={busy||draft.status!=="idle"||!draft.name.trim()||draft.modelMode==="fixed"&&(!draft.profileId||!draft.model)}>保存</ActionButton><ActionButton variant="ghost" disabled={busy} onClick={()=>setDraft(null)}>取消</ActionButton>{draft.configVersion>0?<ActionButton variant="ghost" disabled={busy||draft.status!=="idle"} onClick={()=>void save(true)}>移除执行者</ActionButton>:null}</div>
    </form>:null}{notice?<p role="status">{notice}</p>:null}{error?<InlineNotice tone="danger">{error}</InlineNotice>:null}</div>;
}
