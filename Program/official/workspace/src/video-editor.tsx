import { useEffect, useRef, useState } from "react";
import { ActionButton, DialogShell, Field, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./ui";
import "./video-editor.css";

export type VideoAsset = { id: string; name: string; src: string; duration: number; width: number; height: number; codec: string; };
export type VideoClip = { assetId: string; start: number; end: number; };
export type VideoTimeline = { id: string; revision: number; name: string; clips: VideoClip[]; width: number; height: number; fps: number; };
type VideoJob = { id: string; state: string; progress: number; error?: string; assetId?: string; timeline: VideoTimeline; };
export type VideoReply = { ok: boolean; error?: string; cancelled?: boolean; assets?: VideoAsset[]; asset?: VideoAsset; timeline?: VideoTimeline; timelines?: VideoTimeline[]; job?: VideoJob; jobs?: VideoJob[]; };
export type VideoCall = (action: string, args?: Record<string, unknown>) => Promise<VideoReply>;
const active = (job?: VideoJob) => !!job && ["queued", "running", "cancelling"].includes(job.state);

export default function VideoEditor({ call, initialAssetId, initialTimelineId, close, registerFlush }: {
  call: VideoCall; initialAssetId?: string; initialTimelineId?: string; close: () => void;
  registerFlush: (save: (()=>Promise<void>) | null) => void;
}) {
  const [assets, setAssets] = useState<VideoAsset[]>([]), [timeline, setTimeline] = useState<VideoTimeline | null>(null);
  const [clips, setClips] = useState<VideoClip[]>([]), [name, setName] = useState("视频剪辑"), [size, setSize] = useState("1280x720"), [fps, setFPS] = useState(30);
  const [selected, setSelected] = useState(0), [busy, setBusy] = useState(true), [dirty, setDirty] = useState(false), [error, setError] = useState("");
  const [job, setJob] = useState<VideoJob>(), [output, setOutput] = useState<VideoAsset>();
  const video = useRef<HTMLVideoElement>(null), playingSequence = useRef(false), alive = useRef(true);
  const clip = clips[selected], asset = assets.find(a => a.id === clip?.assetId), total = clips.reduce((n,c) => n + c.end-c.start, 0);
  async function checked(action: string, args?: Record<string, unknown>) { const r = await call(action,args); if(r.ok === false) throw Error(r.error || "视频操作未完成"); return r; }
  function install(t: VideoTimeline) { setTimeline(t); setClips(t.clips); setName(t.name); setSize(`${t.width}x${t.height}`); setFPS(t.fps); setDirty(false); }
  useEffect(() => {
    alive.current = true;
    void checked("list").then(r => {
      if(!alive.current) return;
      const rows=r.assets||[];setAssets(rows);
      const existing=r.timelines?.find(t=>t.id===initialTimelineId);
      if(existing)install(existing);
      else {const first=rows.find(a=>a.id===initialAssetId);if(first){setClips([{assetId:first.id,start:0,end:first.duration}]);setName(first.name.replace(/\.[^.]+$/,""));setDirty(true);}}
      const previous=[...(r.jobs||[])].reverse().find(j=>!initialTimelineId||j.timeline.id===initialTimelineId);setJob(previous);setOutput(rows.find(a=>a.id===previous?.assetId));
    }).catch(e=>{if(alive.current)setError(e.message);}).finally(()=>{if(alive.current)setBusy(false);});
    return ()=>{alive.current=false;playingSequence.current=false;};
  }, []);
  useEffect(() => {
    if(!active(job))return;
    let cancelled=false,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try {const r=await checked("status",{requestId:job!.id});if(cancelled)return;setJob(r.job);
        if(r.asset){setOutput(r.asset);setAssets(rows=>rows.some(a=>a.id===r.asset!.id)?rows:[...rows,r.asset!]);}
        if(active(r.job))timer=setTimeout(poll,750);
      }catch(e){if(!cancelled)setError((e as Error).message);}
    };
    timer=setTimeout(poll,100);return()=>{cancelled=true;clearTimeout(timer);};
  }, [job?.id, active(job)]);
  function modify(next: VideoClip[]) { playingSequence.current=false;video.current?.pause();setClips(next);setSelected(i=>Math.min(i,Math.max(0,next.length-1)));setDirty(true); }
  async function action(work:()=>Promise<void>) { if(busy)return;setBusy(true);setError("");try{await work();}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);} }
  async function save() {
    if(!clips.length&&!timeline)return null;
    if(timeline&&!dirty)return timeline;
    const [width,height]=size.split("x").map(Number),r=await checked(timeline?"update":"create",{id:timeline?.id,revision:timeline?.revision,name,clips,width,height,fps});
    if(!r.timeline)throw Error("剪辑保存结果未确认");install(r.timeline);return r.timeline;
  }
  useEffect(()=>{
    registerFlush(async()=>{if(busy)throw Error("视频操作仍在进行，请完成后再关闭窗口。");if(dirty)await save();});
    return()=>registerFlush(null);
  });
  async function importMedia() { const r=await checked("pick");if(r.cancelled)return;const incoming=r.assets||[];setAssets(rows=>[...rows,...incoming.filter(a=>!rows.some(x=>x.id===a.id))]);modify([...clips,...incoming.map(a=>({assetId:a.id,start:0,end:a.duration}))]); }
  function advance(){if(!playingSequence.current)return;if(selected+1<clips.length)setSelected(selected+1);else{playingSequence.current=false;video.current?.pause();}}
  function seek(){const el=video.current;if(!el||!clip)return;el.currentTime=clip.start;if(playingSequence.current)void el.play().catch(e=>setError(e.message));}
  useEffect(()=>{if(video.current&&video.current.readyState>=1)seek();},[selected,clip?.assetId]);
  async function preview(){if(!clips.length)return;playingSequence.current=true;setSelected(0);if(selected===0&&video.current){video.current.currentTime=clips[0].start;await video.current.play();}}
  function reorder(i:number,delta:number){const next=[...clips],target=i+delta;if(target<0||target>=next.length)return;[next[i],next[target]]=[next[target],next[i]];modify(next);setSelected(target);}
  const requestClose=()=>void action(async()=>{if(dirty)await save();close();});
  return <DialogShell surface="video-editor" ariaLabel="视频剪辑" className="video-editor" busy={busy} closePolicy={{escape:"when-idle",backdrop:"never","close-button":"when-idle"}} onRequestClose={requestClose}>
    {({requestClose:request})=><>
      <SurfaceHeader title="视频剪辑" onClose={()=>request("close-button")} closeLabel="保存并关闭视频剪辑" closeDisabled={busy}/>
      <SurfaceBody className="video-editor-body">
        <fieldset className="video-editor-fields" disabled={busy}>
        <div className="video-preview">{asset?<video ref={video} key={asset.id} src={asset.src} controls preload="metadata" onLoadedMetadata={seek} onTimeUpdate={()=>{if(playingSequence.current&&video.current&&clip&&video.current.currentTime>=clip.end)advance();}} onEnded={advance} onError={()=>setError("此格式暂不能直接预览，可以导出为 MP4 后播放。")} />:<p>导入视频，添加片段开始剪辑</p>}</div>
        <div className="video-editor-actions"><ActionButton disabled={busy} onClick={()=>void action(importMedia)}>导入视频</ActionButton><ActionButton disabled={busy||!clips.length} onClick={()=>void action(preview)}>预览顺序</ActionButton><span>{Number.isFinite(total)?total.toFixed(2):"—"} 秒</span></div>
        <div className="video-clip-list" aria-label="视频片段顺序">
          {clips.map((c,i)=>{const media=assets.find(a=>a.id===c.assetId);return <div key={i} className="video-clip" data-selected={i===selected}>
            <ActionButton variant="ghost" aria-pressed={i===selected} onClick={()=>{playingSequence.current=false;setSelected(i);if(i===selected)seek();}}>{i+1}. {media?.name||"素材不可用"}</ActionButton>
            <Field label="起点（秒）"><input type="number" min={0} max={media?.duration} step="0.01" value={c.start} onChange={e=>modify(clips.map((x,n)=>n===i?{...x,start:Number(e.target.value)}:x))}/></Field>
            <Field label="终点（秒）"><input type="number" min={0} max={media?.duration} step="0.01" value={c.end} onChange={e=>modify(clips.map((x,n)=>n===i?{...x,end:Number(e.target.value)}:x))}/></Field>
            <ActionButton disabled={i===0} onClick={()=>reorder(i,-1)}>上移</ActionButton><ActionButton disabled={i===clips.length-1} onClick={()=>reorder(i,1)}>下移</ActionButton><ActionButton onClick={()=>modify(clips.filter((_,n)=>n!==i))}>移除片段</ActionButton>
          </div>;})}
        </div>
        {assets.length>0?<Field label="添加已有素材"><select value="" onChange={e=>{const a=assets.find(a=>a.id===e.target.value);if(a)modify([...clips,{assetId:a.id,start:0,end:a.duration}]);}}><option value="">选择视频</option>{assets.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>:null}
        <div className="video-export-options"><Field label="剪辑名称"><input value={name} maxLength={120} onChange={e=>{setName(e.target.value);setDirty(true);}}/></Field><Field label="画面"><select value={size} onChange={e=>{setSize(e.target.value);setDirty(true);}}>{["1280x720","1920x1080","720x1280","1080x1920"].map(s=><option key={s} value={s}>{s.replace("x"," × ")}</option>)}</select></Field><Field label="帧率"><select value={fps} onChange={e=>{setFPS(Number(e.target.value));setDirty(true);}}><option value={24}>24</option><option value={30}>30</option></select></Field></div>
        {job?<p role="status">{active(job)?`正在导出 ${Math.round(job.progress*100)}%`:job.state==="completed"?"导出完成，视频已加入画布":job.error||"导出已取消"}</p>:null}
        {error?<p role="alert">{error}</p>:null}
        </fieldset>
      </SurfaceBody>
      <SurfaceFooter>
        {active(job)?<ActionButton disabled={busy} onClick={()=>void action(async()=>{const r=await checked("cancel",{requestId:job!.id});setJob(r.job);})}>取消导出</ActionButton>:null}
        {output?<ActionButton disabled={busy} onClick={()=>void action(async()=>{await checked("save_file",{assetId:output.id});})}>保存视频到文件</ActionButton>:null}
        <ActionButton disabled={busy||!clips.length&&!timeline} onClick={()=>void action(async()=>{await save();})}>保存剪辑</ActionButton>
        <ActionButton variant="primary" disabled={busy||active(job)||!clips.length} onClick={()=>void action(async()=>{const t=await save();if(!t)return;const r=await checked("export",{id:t.id,revision:t.revision,requestId:crypto.randomUUID()});setJob(r.job);setOutput(undefined);})}>导出 MP4</ActionButton>
      </SurfaceFooter>
    </>}
  </DialogShell>;
}
