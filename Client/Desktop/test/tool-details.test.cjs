// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/tool-details.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const test=require('node:test'),assert=require('node:assert/strict');
test('compaction and identity details show source, committed summary and concrete handoff',async()=>{
 const {activityDetails,activityLabel}=await import('../ui/activity.mjs');
 const compact={tool:'memory',action:'compact',state:'completed',detail:'压缩已提交',preview:{compaction:{state:'completed',first_message:0,covered_messages:3,compression:{before_tokens:1200,after_tokens:300}},before:'用户要求绘制鹈鹕SVG\n读取文件',after:'已生成SVG；验证待进行。',before_more:true}};
 const shown=JSON.stringify(activityDetails(compact));for(const text of ['用户要求绘制','验证待进行','1200 → 300','逐页阅读'])assert(shown.includes(text),text);
 const pending=JSON.stringify(activityDetails({...compact,state:'running',preview:{compaction:{state:'running'}}}));assert(pending.includes('尚无已提交'));assert(!pending.includes('已生成SVG'));
 const identity={tool:'agents',action:'identity_enter',input_preview:{task:'完成绘图及浏览器验证',reason:'多阶段实现',plan:['绘制文件','浏览器验证'],success:'可打开',exit:'完成后返回'},preview:{identity:{phase:'preparing',name:'Cota'},prompt:'private-personality'}};
 assert(!activityLabel(identity).includes('智能体操作'));const detail=JSON.stringify(activityDetails(identity));for(const text of ['多阶段实现','浏览器验证','完成后返回'])assert(detail.includes(text));assert(!detail.includes('private-personality'));
});
test('PAC snapshot and individual packet expose stored content in the current receipt',async()=>{
 const {activityDetails,activityLabel}=await import('../ui/activity.mjs');
 const item={tool:'memory',action:'snapshot',state:'completed',preview:{ok:true,summary_tokens:900,packets:[{title:'阶段一',content:'修复已完成，验证待进行。'}],profile:[{title:'阅读偏好',kind:'preference',content:'长正文保留阅读位置。',truncated:true}],profile_has_more:true,merge_recommended:true}};
 assert.equal(activityLabel(item),'查看当前记忆');const details=JSON.stringify(activityDetails(item));
 for(const value of ['阶段记忆','长期记忆','阶段一','修复已完成','阅读偏好','长正文保留阅读位置','900 tokens','部分内容','尚未修改'])assert.ok(details.includes(value),value);
 assert.match(JSON.stringify(activityDetails({tool:'memory',action:'packet',preview:{ok:true,packet:{title:'阶段二',content:'当前包完整内容'}}})),/当前包完整内容/);
 const empty=JSON.stringify(activityDetails({...item,preview:{ok:true,packets:[],profile:[]}}));assert.match(empty,/0 段阶段记忆/);assert.match(empty,/没有匹配记录/);
});
test('basic receipts expose useful bounded content, zero matches and pagination without arbitrary secrets',async()=>{
 const {activityDetails}=await import('../ui/activity.mjs');
 const memory=activityDetails({tool:'memory',action:'search',targets:['主题'],preview:{records:[{id:'m1',title:'偏好',content:'喜欢紧凑界面'}],api_key:'secret',next_cursor:'cursor'}});
 assert.match(JSON.stringify(memory),/喜欢紧凑界面/);assert.match(JSON.stringify(memory),/游标/);assert(!JSON.stringify(memory).includes('secret'));
 const project=activityDetails({tool:'project',action:'read',preview:{path:'a.go',lines:[{line:3,text:'func main() {}'}],total_lines:8}});
 assert.match(JSON.stringify(project),/func main/);assert.match(JSON.stringify(project),/总行数/);
 assert.match(JSON.stringify(activityDetails({tool:'project',preview:{matches:[]}})),/没有匹配/);
 const large=activityDetails({tool:'memory',preview:{records:Array.from({length:2000},(_,i)=>({title:String(i),content:'文'.repeat(2000)}))}});
 assert(JSON.stringify(large).length<14000);assert.match(JSON.stringify(large),/显示前 24/);
 assert.match(JSON.stringify(activityDetails({tool:'agents',preview:{spec:{title:'助手',model:'qwen'},state:'ready'}})),/qwen/);
});

test('stage seal shows actual estimates, scope and summary without inventing missing metrics',async()=>{
 const {activityDetails}=await import('../ui/activity.mjs');
 const item={tool:'memory',action:'seal',state:'completed',input_preview:{title:'阶段A',content:'完成修复；测试仍待执行。',keywords:'修复 测试'},preview:{ok:true,covered_messages:18,newly_covered_messages:6,compression:{before_tokens:8200,after_tokens:700},originals_preserved:true}};
 const text=JSON.stringify(activityDetails(item));
 for(const part of ['8200 → 700','减少 7500','本次 6 条','累计覆盖 18','完成修复；测试仍待执行','原文','估算'])assert.ok(text.includes(part),part);
 const legacy=JSON.stringify(activityDetails({...item,preview:{ok:true}}));assert.match(legacy,/未报告/);assert.ok(!legacy.includes('8200'));
 const failure=JSON.stringify(activityDetails({...item,state:'failed',preview:{ok:false,error:'保存失败'}}));assert.match(failure,/本次提交的摘要/);assert.ok(!failure.includes('保存的摘要'));
 const computer=JSON.stringify(activityDetails({tool:'computer',action:'scroll',preview:{identity:{title:'测试窗口'},performed:'scroll',effect:{delta_y:240,vertical_notches:2},api_key:'must-not-display'}}));assert.match(computer,/测试窗口/);assert.match(computer,/240/);assert.ok(!computer.includes('must-not-display'));
});

test('software receipts show module snapshots, catalogs and unconfirmed results without changing the source',async()=>{
 const {activityDetails,activityFacts,activityLabel,activityOutcome}=await import('../ui/activity.mjs');
 const snapshot={ok:true,main_open:true,active_page:'browser',modules:[{id:'home',title:'首页',placement:'attached',ready:true,visible:false},{id:'browser',title:'浏览器',placement:'detached',ready:false,visible:true,starting:true,error:'仍在载入',password:'module-secret'}],api_key:'snapshot-secret'};
 const row={tool:'software_api',action:'modules',state:'completed',preview:snapshot},before=JSON.stringify(row);
 assert.equal(activityLabel(row),'读取模块状态');assert.deepEqual(activityFacts(row).map(f=>f.label+'='+f.value),['模块=2 个','当前页面=浏览器','主窗口=已打开']);
 const shown=JSON.stringify(activityDetails(row));
 for(const expected of ['首页','浏览器','主窗口内','独立窗口','显示：已收起','显示：可见','就绪：已就绪','就绪：未就绪','正在启动','仍在载入'])assert(shown.includes(expected),expected);
 assert(!shown.includes('module-secret'));assert(!shown.includes('snapshot-secret'));assert.equal(JSON.stringify(row),before);
 const uncertain={...row,action:'receipt',state:'interrupted_unknown',preview:{ok:false,state:'unknown',error:'操作尚未确认',current:snapshot}};
 const current=JSON.stringify(activityDetails(uncertain));assert(current.includes('独立窗口'));assert(current.includes('结果未确认'));assert.equal(activityOutcome(uncertain),'结果未确认，请先核对原操作回执。');
 const catalog={...row,action:'describe',preview:{ok:true,catalog:[{id:'home',title:'首页',detachable:false},{id:'browser',title:'浏览器',detachable:true,token:'catalog-secret'}]}};
 const described=JSON.stringify(activityDetails(catalog));for(const expected of ['模块目录','首页','可独立：否','浏览器','可独立：是'])assert(described.includes(expected),expected);assert(!described.includes('catalog-secret'));
 const incomplete=JSON.stringify(activityDetails({...row,preview:{ok:true,modules:[{title:'只报告名字'}]}}));assert(incomplete.includes('位置：未报告'));assert(incomplete.includes('就绪：未报告'));
});

test('module and server lists distinguish empty, absent and bounded partial results',async()=>{
 const {activityDetails,activityFacts}=await import('../ui/activity.mjs');
 const row=(tool,action,preview)=>({tool,action,state:'completed',preview});
 assert.match(JSON.stringify(activityDetails(row('software_api','modules',{ok:true,modules:[]}))),/没有模块记录/);
 assert.match(JSON.stringify(activityDetails(row('software_api','describe',{ok:true,catalog:[]}))),/没有可用模块/);
 assert.match(JSON.stringify(activityDetails(row('server','list',{ok:true,servers:[]}))),/没有登记服务器/);
 assert.deepEqual(activityFacts(row('software_api','modules',{modules:[]})),[{label:'模块',value:'0 个'}]);
 assert.deepEqual(activityFacts(row('server','list',{servers:[]})),[{label:'服务器',value:'0 台'}]);
 for(const [tool,action,expected]of [['software_api','modules','未报告模块状态'],['server','list','未报告服务器列表']]){
  const text=JSON.stringify(activityDetails(row(tool,action,{ok:true})));assert(text.includes(expected));assert(!text.includes('没有模块记录'));assert(!text.includes('没有登记服务器'));
 }
 for(const [tool,action,key,label,entry]of [['software_api','modules','modules','模块',i=>({title:'模块 #'+i,placement:'closed',ready:false,visible:false})],['software_api','describe','catalog','目录',i=>({title:'目录 #'+i,detachable:false})],['server','list','servers','服务器',i=>({name:'服务器 #'+i,host:'host-'+i+'.test',port:22,user:'tester',probe:false})]]){
  const rows=Array.from({length:27},(_,i)=>({...entry(i),password:'never-show'})),preview={ok:true,[key]:rows,has_more:true};
  const text=JSON.stringify(activityDetails(row(tool,action,preview)));
  assert(text.includes(label+' #0'));assert(text.includes(label+' #23'));assert(!text.includes(label+' #24'));assert(text.includes('显示前 24'));assert(text.includes('27'));assert(text.includes('部分内容'));assert(!text.includes('never-show'));assert(text.length<14000);
 }
});

test('server receipts expose safe connection and probe facts while keeping zero and missing samples distinct',async()=>{
 const {activityDetails,activityFacts,activityOutcome}=await import('../ui/activity.mjs');
 const at=Date.UTC(2026,10,9,1,2,3),sample={host:'fixture-host',cpu:0,cores:2,mem_used_pct:12.5,disk_used_pct:0,rx_rate:null,tx_rate:0,at,api_key:'sample-secret',credentials:{password:'nested-secret'}};
 const server={name:'本机夹具',host:'fixture.example',port:2222,user:'tester',probe:false,last:sample,password:'password-secret',passphrase:'passphrase-secret',key_path:'private-key-file',image:'private-image-data'};
 const item={tool:'server',action:'connect',state:'completed',preview:{ok:true,server,sample}},before=JSON.stringify(item);
 assert.deepEqual(activityFacts(item).map(f=>f.label+'='+f.value),['服务器=本机夹具','地址=fixture.example','探针=未安装']);
 const shown=JSON.stringify(activityDetails(item));
 for(const expected of ['本机夹具','地址：fixture.example','端口：2222','用户：tester','探针：未安装','fixture-host','CPU · 0%','内存 · 12.5%','磁盘 · 0%','接收速率 · 尚无基线','发送速率 · 0 B/s','2026-11-09T01:02:03.000Z'])assert(shown.includes(expected),expected);
 for(const forbidden of ['sample-secret','nested-secret','password-secret','passphrase-secret','private-key-file','private-image-data'])assert(!shown.includes(forbidden),forbidden);
 assert.equal(JSON.stringify(item),before);
 const listed=JSON.stringify(activityDetails({...item,action:'list',preview:{ok:true,servers:[server,{name:'备用夹具',host:'second.test',probe:true,last:null}]}}));for(const expected of ['本机夹具','备用夹具','探针：已安装','最近采样','尚无样本'])assert(listed.includes(expected),expected);assert(!listed.includes('sample-secret'));
 const status={...item,action:'status',preview:{ok:true,sample}};assert(activityFacts(status).some(f=>f.label==='CPU'&&f.value==='0%'));
 const missing=JSON.stringify(activityDetails({...status,preview:{ok:true}}));assert(missing.includes('未报告采样数据'));assert(!missing.includes('CPU · 0%'));
 const partial=JSON.stringify(activityDetails({...status,preview:{ok:true,sample:{cpu:0,mem_used_pct:null}}}));assert(partial.includes('CPU · 0%'));assert(partial.includes('内存 · 未报告'));assert(!partial.includes('内存 · 0%'));
 const incomplete=JSON.stringify(activityDetails({...status,action:'list',preview:{ok:true,servers:[{name:'只报告名字',last:{}}]}}));assert(incomplete.includes('探针：未报告'));assert(incomplete.includes('样本未报告状态指标'));assert(!incomplete.includes('尚无样本'));
 const failed={...status,state:'failed',preview:{ok:false,error:'认证失败'}};assert.equal(activityOutcome(failed),'认证失败');assert(JSON.stringify(activityDetails(failed)).includes('认证失败'));
});
