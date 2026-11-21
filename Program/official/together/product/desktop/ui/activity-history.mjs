/* @file-map:start
文件: link/desktop/ui/activity-history.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: 无已解析的项目内静态导入
上游: link/desktop/ui/workspace.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test AIDEBUG/controls.test.mjs, AIDEBUG/live-review.cjs, link/DOCS/AIDEBUG-LIVE.md
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  ActivityPages | class
  ActivityPages.constructor | method
  ActivityPages.reset | method
  ActivityPages.page | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
export /* @chain-region ActivityPages */ class ActivityPages {
 /* @chain-region ActivityPages.constructor */ constructor(load){this.load=load;this.cursors=[];this.index=0;this.next=null;this.busy=false;this.epoch=0;}
 /* @chain-region ActivityPages.reset */ reset(before){this.epoch++;this.cursors=[before];this.index=0;this.next=null;this.busy=false;}
 /* @chain-region ActivityPages.page | calls: load, Array.isArray, Error */ async page(delta=0){
  if(this.busy)return null;
  const index=this.index+delta;
  if(index<0||delta>0&&!this.next)return null;
  const before=delta>0?this.next:this.cursors[index],epoch=this.epoch;
  this.busy=true;
  try{
   const value=await this.load(before);
   if(epoch!==this.epoch)return null;
   if(!Array.isArray(value.items)||value.items.length>30)throw Error('操作记录格式无效');
   this.cursors[index]=before;this.index=index;this.next=value.next_before;
   return {value,index,previous:index>0,next:!!this.next};
  }finally{if(epoch===this.epoch)this.busy=false;}
 }
}
