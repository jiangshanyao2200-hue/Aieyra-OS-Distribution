import {ActionButton,DialogShell,SurfaceBody,SurfaceHeader} from './ui';
export default function ConnectionCenter({connection,close}:any){
 const configure=(section:string)=>(window as any).aieyraApp.invoke({scope:'workspace',channel:'aieyra:os:configure',payload:{section}});
 return <DialogShell surface="connection" ariaLabel="Workspace 连接" className="connection-center" onRequestClose={close}>
  {({requestClose})=><><SurfaceHeader title="连接" onClose={()=>requestClose('close-button')}/><SurfaceBody>
   <h3>画布 Agent</h3><p>{connection?.aiReady?connection.agentModel:'未配置'}</p><p>在联系人中设置模型、提示词、头像、名称和工具。</p>
   <ActionButton onClick={()=>void configure('agent')}>编辑画布 Agent</ActionButton>
   <h3>Image Gen</h3><p>{connection?.imageModel||'未配置'}</p><p>使用 OS 图像服务生成、编辑和恢复图片。</p>
   <ActionButton onClick={()=>void configure('images')}>图像服务设置</ActionButton>
  </SurfaceBody></>}
 </DialogShell>;
}
