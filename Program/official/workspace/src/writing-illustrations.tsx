import { useEffect, useState, useRef } from "react";
import { ActionButton, DialogShell, SurfaceHeader, SurfaceBody, SurfaceFooter, ButtonBase } from "./ui";
import RichMarkdownMessage from "./markdown";
import type { WritingArtifactRecord, WritingIllustrationInput } from "./writing-schema";
import type { WritingIllustrationSource } from "./core";
const urls = new Map<string, string>();
let cachedCharacters = 0;
function cacheUrl(key: string, url: string) {
  const previous=urls.get(key);if(previous){cachedCharacters-=previous.length;urls.delete(key);}
  if(url.length>24*1024*1024)return;
  while(urls.size && (urls.size>=20 || cachedCharacters+url.length>24*1024*1024)) {
    const first=urls.keys().next().value!;cachedCharacters-=urls.get(first)!.length;urls.delete(first);
  }
  urls.set(key,url);cachedCharacters+=url.length;
}
function IllustrationImage({ projectId, artifact, id }: {projectId:string;artifact:WritingArtifactRecord;id:string}) {
  const image=artifact.provenance.illustrations?.find(i=>i.id===id), key=`${projectId}:${artifact.id}:${image?.sha256}`;
  const host=useRef<HTMLElement>(null),[visible,setVisible]=useState(false);
  useEffect(()=>{if(!host.current)return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:"200px"});observer.observe(host.current);return()=>observer.disconnect();},[]);
  const [url,setUrl]=useState(urls.get(key)||""),[error,setError]=useState("");
  useEffect(()=>{let active=true;setUrl(urls.get(key)||"");setError("");
    if(visible && image && !urls.has(key))void window.aieyraWriting?.illustrations({projectId,artifactId:artifact.id,illustrationId:id,action:"read"}).then(result=>{
      if(!active)return;
      if(!result.ok||!result.url||result.sha256!==image.sha256){setError(result.error||"配图已更新，请重新打开。");return;}
      cacheUrl(key,result.url);setUrl(result.url);
    }).catch(()=>{if(active)setError("配图暂时无法读取。");});
    return()=>{active=false;};
  },[key,projectId,artifact.id,id,visible]);
  return image ? <figure ref={host} className="writing-illustration"><div>{url?<img src={url} alt={image.caption} loading="lazy"/>:<span>{error||"正在读取配图…"}</span>}</div><figcaption>{image.caption}</figcaption></figure> : <p role="alert">此处配图已移除，请核对正文。</p>;
}
export function WritingReadingContent({ projectId, artifact, text }: {projectId:string;artifact:WritingArtifactRecord;text:string}) {
  const preserveLineBreaks = artifact.provenance.source?.format === "txt" || Boolean(artifact.attributes?.novelId || artifact.attributes?.novelRole === "root");
  const parts: {text?:string;id?:string}[]=[];let offset=0;
  for(const match of text.matchAll(/!\[[^\]\n]*\]\(workspace-image:([A-Za-z0-9_-]{1,100})\)/g)){if(match.index!>offset)parts.push({text:text.slice(offset,match.index)});parts.push({id:match[1]});offset=match.index!+match[0].length;}
  if(offset<text.length)parts.push({text:text.slice(offset)});
  return <>{parts.map((part,index)=>part.id?<IllustrationImage key={`${part.id}:${index}`} projectId={projectId} artifact={artifact} id={part.id}/>:<RichMarkdownMessage key={index} content={part.text||""} preserveLineBreaks={preserveLineBreaks}/>)}</>;
}
export function WritingIllustrationDialog({ projectId, artifact, close, change }: {projectId:string;artifact:WritingArtifactRecord;close:()=>void;change:(input:WritingIllustrationInput)=>Promise<WritingArtifactRecord>}) {
  const [projects,setProjects]=useState<{id:string;name:string}[]>([]),[sourceProjectId,setSourceProjectId]=useState("");
  const [images,setImages]=useState<WritingIllustrationSource[]>([]),[offset,setOffset]=useState(0),[total,setTotal]=useState(0);
  const [replacement,setReplacement]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{let active=true;setImages([]);setError("");void window.aieyraWriting?.illustrations({projectId,action:"sources",sourceProjectId,offset}).then(result=>{if(!active)return;if(!result.ok){setError(result.error||"图片列表读取失败。");return;}setProjects(result.projects||[]);setImages(result.images||[]);setTotal(result.total||0);}).catch(()=>{if(active)setError("图片列表读取失败。");});return()=>{active=false;};},[projectId,sourceProjectId,offset]);
  async function apply(input:Partial<WritingIllustrationInput>) {
    if(busy)return;setBusy(true);setError("");
    try {await change({action:replacement?"replace":"add",artifactId:artifact.id,expectedRevision:artifact.revision,...(replacement?{illustrationId:replacement}:{}),...input});setReplacement("");}
    catch(failure){setError(failure instanceof Error?failure.message:String(failure));}
    finally{setBusy(false);}
  }
  return <DialogShell layerLevel="nested" surface="writing-illustrations" ariaLabel="文档配图" className="writing-illustrations-dialog" busy={busy} onRequestClose={close}>{({requestClose})=><>
    <SurfaceHeader title={replacement?"替换配图":"文档配图"} onClose={()=>requestClose("close-button")} closeDisabled={busy}/>
    <SurfaceBody>
      {(artifact.provenance.illustrations||[]).length?<div className="writing-illustration-current">{artifact.provenance.illustrations!.map(image=><article key={image.id} data-writing-illustration={image.id}>
        <IllustrationImage projectId={projectId} artifact={artifact} id={image.id}/><small>{image.source.projectName?`${image.source.projectName} · ${image.source.originTitle||image.source.name}`:image.source.name}</small>
        <div><ActionButton disabled={busy} onClick={()=>setReplacement(image.id)}>{replacement===image.id?"正在替换":"替换"}</ActionButton><ActionButton disabled={busy} onClick={()=>void apply({action:"remove",illustrationId:image.id})}>移除</ActionButton></div>
      </article>)}</div>:null}
      <div className="writing-illustration-source-tools"><select className="ui-control" aria-label="配图来源项目" disabled={busy} value={sourceProjectId} onChange={event=>{setSourceProjectId(event.target.value);setOffset(0);}}><option value="">选择绘图项目</option>{projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select>
        <ActionButton disabled={busy} onClick={()=>void apply({})}>从文件选择</ActionButton></div>
      {sourceProjectId?<div className="writing-illustration-picker">{images.map(image=><ButtonBase key={`${image.nodeId}:${image.occurrenceId||image.assetIndex}`} type="button" disabled={busy} onClick={()=>void apply({sourceProjectId,nodeId:image.nodeId,occurrenceId:image.occurrenceId,assetIndex:image.assetIndex,expectedSourceStamp:image.sourceStamp,caption:image.title})}><img src={image.url} alt={image.title} loading="lazy" decoding="async"/><span>{image.title}</span></ButtonBase>)}</div>:null}
      {sourceProjectId&&!images.length?<p>此项目暂无可用图片。</p>:null}
      {total>60?<div className="writing-illustration-pagination"><ActionButton disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-60))}>上一页</ActionButton><span>{offset+1}–{Math.min(total,offset+60)} / {total}</span><ActionButton disabled={busy||offset+60>=total} onClick={()=>setOffset(offset+60)}>下一页</ActionButton></div>:null}
      {error?<p role="alert" className="writing-editor-error">{error}</p>:null}
    </SurfaceBody><SurfaceFooter>{replacement?<ActionButton disabled={busy} onClick={()=>setReplacement("")}>取消替换</ActionButton>:null}<ActionButton disabled={busy} onClick={()=>requestClose("close-button")}>完成</ActionButton></SurfaceFooter>
  </>}</DialogShell>;
}
