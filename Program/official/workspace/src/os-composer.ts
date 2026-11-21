import {useCallback,useEffect,useSyncExternalStore} from 'react';
import type {AgentFileAttachment} from './core';
import type {MatrixReference} from './matrix';
type DraftValue={prompt:string;files:AgentFileAttachment[];sources:unknown[];references:MatrixReference[]};
type Setter<T>=(value:T|((current:T)=>T))=>void;
import {createSharedDraftPersistence} from '../../../../Client/Desktop/ui/shared-draft.mjs';
const listeners=new Set<()=>void>();
const notify=()=>listeners.forEach(fn=>fn());
const entries=new Map<string,any>();
const empty=():DraftValue=>({prompt:'',files:[] as AgentFileAttachment[],sources:[],references:[]});
const call=(p:any)=>(window.aieyraAgent!.coding as any)(p).then((r:any)=>{if(r.ok===false)throw Error(r.error);return r;});
function decode(value:any):DraftValue{return {prompt:value.draft.value,files:value.draft.attachments.map((a:any)=>({id:a.sha256,name:a.name,path:a.asset,mimeType:a.mime,size:a.bytes,contentHash:a.sha256,kind:a.kind==='image'?'image':'other'})),sources:[],references:value.draft.context?.references||[]};}
function entryFor(projectId:string,_conversationId:string){
 // The backend binds every canvas project to this same program conversation.
 const key='workspace';let entry=entries.get(key);if(entry){entry.projectId=projectId;return entry;}
 entry={value:empty(),projectId,error:'',loaded:false,loading:null,context:null};entries.set(key,entry);
 entry.persistence=createSharedDraftPersistence(async(p:any)=>{
  const result=await call({projectId:entry.projectId,operation:'draft_save',revision:p.revision,prompt:p.draft.value,files:p.draft.files,context:p.draft.context});
  if(entry.value.prompt===p.draft.value&&JSON.stringify(entry.value.files)===JSON.stringify(p.draft.files)&&JSON.stringify(entry.value.references)===JSON.stringify(p.draft.context?.references||[])){entry.value=decode(result);notify();}
  return {...result,draft:p.draft};
 },{onError:(error:Error)=>{entry.error=error.message;notify();}});
 return entry;
}
async function load(entry:any){
 if(entry.loading)return entry.loading;
 entry.loading=call({projectId:entry.projectId,operation:'draft_load'}).then((result:any)=>{
  const value={...result,draft:{value:result.draft.value,files:decode(result).files,context:result.draft.context||null}};
  if(!entry.loaded){entry.persistence.initialize(value);entry.loaded=true;entry.value=decode(result);entry.context=value.draft.context;}
  else if(entry.persistence.accept(value)){entry.value=decode(result);entry.context=value.draft.context;}
  entry.error='';notify();return true;
 }).catch((error:Error)=>{entry.error=error.message;notify();return false;}).finally(()=>entry.loading=null);return entry.loading;
}
function schedule(entry:any){
 const context=entry.value.references.length?{...entry.context,program:'workspace',references:entry.value.references}:entry.context?.program==='workspace'?null:entry.context;
 entry.persistence.schedule({value:entry.value.prompt,files:entry.value.files,context});notify();
}
export async function flushComposerDrafts(){await Promise.all([...entries.values()].map(e=>e.persistence.drain()));}
export async function appendComposerDraft(projectId:string,conversationId:string,input:{prompt?:string;files?:AgentFileAttachment[];references?:MatrixReference[];removeReferenceIds?:string[];overflowAsReferences?:boolean}){
 const e=entryFor(projectId,conversationId);
 if(!await load(e)||!e.loaded)throw Error(e.error||'右侧对话草稿尚未读取，原输入已保留。');
 const removed=new Set(input.removeReferenceIds||[]);
 e.value={...e.value,prompt:[e.value.prompt,input.prompt].filter(Boolean).join('\n\n'),
  files:[...new Map([...e.value.files,...input.files||[]].map(f=>[f.contentHash||f.path||f.id,f])).values()],
  references:[...new Map([...e.value.references,...input.references||[]].filter(r=>!removed.has(r.id)).map(r=>[r.sourceProjectId+'\n'+r.id,r])).values()]};
 schedule(e);await e.persistence.drain();
}
export function useComposerDraft(projectId:string,conversationId:string):{draft:DraftValue;error:string;flush:()=>Promise<void>;setPrompt:Setter<string>;setFiles:Setter<AgentFileAttachment[]>;setSources:Setter<unknown[]>;setReferences:Setter<MatrixReference[]>;navigateHistory:()=>null;consume:(text:string)=>void}{
 const e=entryFor(projectId,conversationId);
 const draft=useSyncExternalStore(useCallback(fn=>{listeners.add(fn);return ()=>listeners.delete(fn);},[]),()=>e.value);
 const error=useSyncExternalStore(useCallback(fn=>{listeners.add(fn);return ()=>listeners.delete(fn);},[]),()=>e.error);
 useEffect(()=>{let disposed=false,timer:number;
  const refresh=async()=>{if(!disposed&&!document.hidden&&document.body.dataset.visible!=='false'&&!e.persistence.busy)await load(e);if(!disposed)timer=window.setTimeout(refresh,1000);};void refresh();
  return ()=>{disposed=true;clearTimeout(timer);};
 },[e]);
 const update=(field:string,next:any)=>{e.value={...e.value,[field]:typeof next==='function'?next(e.value[field]):next};schedule(e);};
 return {draft,error,flush:()=>e.persistence.drain(),setPrompt:(n:any)=>update('prompt',n),setFiles:(n:any)=>update('files',n),setSources:(n:any)=>update('sources',n),setReferences:(n:any)=>update('references',n),navigateHistory:()=>null,
 consume:(text:string)=>{if(e.value.prompt.trim()===text.trim()){e.value=empty();schedule(e);}}};
}
