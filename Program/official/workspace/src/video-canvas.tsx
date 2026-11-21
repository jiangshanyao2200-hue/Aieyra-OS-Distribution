import React from "react";
import type { WorkflowNode } from "./core";
import type { VideoAsset, VideoTimeline } from "./video-editor";
import { ActionButton } from "./ui";

export type VideoNodeData = { asset?: VideoAsset; timeline?: VideoTimeline; };
export type VideoNode = Omit<WorkflowNode,"type"> & { type:"video"; video:VideoNodeData; };

export function videoNode(data:VideoNodeData, point:{x:number;y:number}, id=crypto.randomUUID()):VideoNode {
  return {id,title:data.timeline?.name||data.asset?.name||"视频",prompt:"",type:"video",status:"done",x:point.x,y:point.y,width:380,height:280,branch:"media",outputs:1,createdAt:new Date().toISOString(),video:data};
}

export function VideoCanvasNode({node,selected,onSelect,onOpen,onSave,onRemove,onPointerDown,onPointerMove,onPointerUp,onResize}:{
 node:VideoNode;selected:boolean;onSelect:()=>void;onOpen:()=>void;onSave:()=>void;onRemove:()=>void;
 onPointerDown:React.PointerEventHandler<HTMLDivElement>;onPointerMove:React.PointerEventHandler<HTMLDivElement>;onPointerUp:React.PointerEventHandler<HTMLDivElement>;onResize:React.PointerEventHandler<HTMLSpanElement>;
}){
 const data=node.video,duration=data.timeline?data.timeline.clips.reduce((n,c)=>n+c.end-c.start,0):data.asset?.duration||0;
 return <div className={`flow-node video done ${selected?"selected":""}`} data-node-id={node.id} data-ui-interactive="true" role="group" aria-label={node.title} tabIndex={0} style={{left:node.x,top:node.y,width:node.width||380,height:node.height||280}} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onClick={e=>{e.stopPropagation();onSelect();}} onDoubleClick={e=>{e.stopPropagation();onOpen();}} onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==="Enter"){e.preventDefault();e.stopPropagation();onOpen();}}}>
   <header className="node-head"><strong>{node.title}</strong><span>{duration.toFixed(2)} 秒</span></header>
   {data.asset?<video src={data.asset.src} controls preload="metadata" onPointerDown={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}/>:<p>{data.timeline?.clips.length||0} 个视频片段</p>}
   <footer onPointerDown={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}><ActionButton onClick={e=>{e.stopPropagation();onOpen();}}>剪辑</ActionButton>{data.asset?<ActionButton onClick={e=>{e.stopPropagation();onSave();}}>另存视频</ActionButton>:null}<ActionButton onClick={e=>{e.stopPropagation();onRemove();}}>移出画布</ActionButton></footer>
   <span className="node-resize-handle" onPointerDown={onResize} aria-hidden="true"/>
 </div>;
}
