import { useEffect, useRef, useState } from "react";
import { Search } from "./studio-icons";
import { ActionButton, ButtonBase, DialogShell, InlineNotice, SearchField, SurfaceBody, SurfaceHeader } from "./ui";
import { imageAssetThumbnailSrc } from "./core";
import type { StyleLibrary, StyleReference } from "./core";

const categories: Record<string,string> = {person:"人物",anime:"角色",product:"产品",style:"风格",scene:"场景",preference:"偏好",other:"资料"};
// Historical manual drafts stay in localStorage. Browsing never clears them.
export default function StyleLibraryPanel({ projectId, canReference, onReference, onAgent, close }: {
  projectId:string; canReference:boolean; onReference:(value:StyleReference)=>void|Promise<void>;
  onAgent:(value:StyleReference)=>Promise<void>; close:()=>void;
}) {
  const [library,setLibrary]=useState<StyleLibrary>({version:1,folders:[],styles:[]});
  const [selectedId,setSelectedId]=useState("");
  const [query,setQuery]=useState("");
  const [error,setError]=useState("");
  const [loaded,setLoaded]=useState(false);
  const [busy,setBusy]=useState(false);
  const busyRef=useRef(false), projectRef=useRef(projectId);
  projectRef.current=projectId;
  useEffect(()=>{setSelectedId("");setQuery("");setError("");},[projectId]);
  useEffect(()=>{
    let disposed=false,sequence=0;
    const load=async()=>{
      const request=++sequence;
      try {
        const result=await window.aieyraConfig?.listStyles?.();
        if(disposed || request!==sequence)return;
        if(!result?.ok || !result.library)throw Error(result?.error || "数据库暂不可用。");
        setLibrary(result.library);setLoaded(true);setError("");
      }catch(caught){if(!disposed && request===sequence)setError(caught instanceof Error?caught.message:String(caught));}
    };
    void load();
    const off=window.aieyraMatrix?.onChanged(event=>{if(event.kind==="database")void load();});
    return()=>{disposed=true;off?.();};
  },[]);
  const records=library.styles.filter(record=>!record.projectId || record.projectId===projectId);
  const selected=records.find(record=>record.id===selectedId);
  const visible=records.filter(record=>JSON.stringify([record.name,record.summary,record.tags,record.descriptor,record.files?.map(file=>file.name)]).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  async function reference(agent=false) {
    if(!selected || !canReference || busyRef.current)return;
    busyRef.current=true;setBusy(true);setError("");
    const destination=projectId;
    try {
      const result=await window.aieyraConfig?.referenceStyle?.({styleId:selected.id,projectId:destination,recordRevision:selected.revision||1});
      if(!result?.ok || !result.reference)throw Error(result?.error || "引用失败。");
      if(projectRef.current!==destination)throw Error("项目已切换，请在目标项目重新引用。");
      await (agent?onAgent(result.reference):onReference(result.reference));
    }catch(caught){setError(caught instanceof Error?caught.message:String(caught));}
    finally{busyRef.current=false;setBusy(false);}
  }
  return <DialogShell surface="style-library" ariaLabel="数据库" className="style-library-panel" onRequestClose={close}>
    {({requestClose})=><>
      <SurfaceHeader title="数据库" onClose={()=>requestClose("close-button")}/>
      <SurfaceBody>
        <SearchField label="搜索数据库" icon={<Search size={16}/>} inputProps={{placeholder:"搜索资料、描述或文件",value:query,onChange:event=>setQuery(event.target.value)}}/>
        {error?<InlineNotice tone="danger">{error}</InlineNotice>:null}
        <div className="style-library-items">
          {visible.map(record=><ButtonBase key={record.id} className={`style-library-card ui-choice-row${selectedId===record.id?" selected current":""}`} disabled={busy} draggable={canReference&&!busy}
            aria-pressed={selectedId===record.id} onClick={()=>setSelectedId(record.id)}
            onDragStart={event=>{event.dataTransfer.setData("application/x-aieyra-database",JSON.stringify({id:record.id,revision:record.revision||1,projectId}));event.dataTransfer.effectAllowed="copy";}}>
            <span className="style-library-cover">{record.images[0]?<img src={imageAssetThumbnailSrc(record.images[0].asset,256)} alt="" loading="lazy" decoding="async"/>:<span className="database-cover-label">{categories[record.category||"other"]||"资料"}</span>}</span>
            <span>{record.name}</span><small>{record.images.length} 张图片 · {record.files?.length||0} 个文件</small>
          </ButtonBase>)}
        </div>
        {loaded&&!visible.length?<p className="style-library-empty">{query?"没有匹配的资料。":"暂无资料，可在右侧对话中让画布 Agent 整理。"}</p>:null}
        {selected?<section className="style-library-detail" aria-label={`资料 ${selected.name}`}>
          <header><strong>{selected.name}</strong><small>r{selected.revision||1}</small></header>
          <div className="style-library-toolbar"><ActionButton disabled={busy||!canReference} onClick={()=>void reference()}>放入画布</ActionButton><ActionButton disabled={busy||!canReference} onClick={()=>void reference(true)}>与 画布助手 聊</ActionButton></div>
          {selected.summary?<p className="database-summary">{selected.summary}</p>:null}
          {Object.keys(selected.descriptor||{}).length?<details><summary>结构资料</summary><pre className="database-structured">{JSON.stringify(selected.descriptor,null,2)}</pre></details>:null}
          {selected.files?.length?<ul className="database-file-list" aria-label="资料文件">{selected.files.map(file=><li key={file.id}><span>{file.name}</span><small>{Math.max(1,Math.ceil(file.size/1024))} KB</small></li>)}</ul>:null}
          {selected.images.map(item=><figure key={item.id}><img src={imageAssetThumbnailSrc(item.asset,768)} alt={item.name} loading="lazy"/><figcaption>{item.name}</figcaption>{item.prompt?<details><summary>原始提示词</summary><p>{item.prompt}</p></details>:null}</figure>)}
        </section>:null}
      </SurfaceBody>
    </>}
  </DialogShell>;
}
