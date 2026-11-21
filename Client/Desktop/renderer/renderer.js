// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/renderer/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: api; S; tr; $; allKeys; labels; el; status; inactive; maxDefault; options; selection; set; renderSelect; renderField; providerAction; renderCatalog; maskKey; renderApiKeyField; refreshDisabled; renderPane; poolAction; renderPool; renderMatrix; payload; action; doSave; doTest; pendingChanges; doReset; confirmLeave; bootstrap
// Impact: python -B scripts/code-atlas.py show Client/Desktop/renderer/renderer.js
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 字段规则来自主进程；本页只定义易读的标签与快捷档位，不改变未展示的配置。
const api = window.aieyra;
const S = {settings:{},defaults:{},groups:[],models:[],limits:{},dirty:false,busy:false,view:'matrix',baseline:null,savedFields:[],leaving:false,allowExit:false};
const tr=(zh,en)=>S.settings.language==='en-US'?en:zh;
const $ = id => document.getElementById(id);
const allKeys = ['api_key','model','max_tokens','thinking_type','reasoning_effort','show_reasoning','stream','response_format','request_timeout_seconds','user_id','compact_percent','compact_keep_turns'];
const labels = {compact_percent:['自动压缩','Compact'],compact_keep_turns:['保留原文轮次','Keep Turns'],api_key:['API Key',''],model:['模型','Models'],max_tokens:['最大输出','Max Output'],thinking_type:['思考模式','Thinking'],reasoning_effort:['思考强度','Reasoning Effort'],show_reasoning:['思考片段','Reasoning Display'],stream:['流式传输','SSE'],stream_include_usage:['用量统计','Include Usage'],response_format:['输出格式','Response Format'],request_timeout_seconds:['请求超时','Timeout'],user_id:['用户标识','User ID']};
function el(tag,cls,text) {const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;}
function status(text='',kind='') {const translations={'正在保存…':'Saving…','已保存':'Saved','正在连接…':'Connecting…','请先输入 API Key':'Enter an API key first','Key 已加入，保存后生效':'Key added; save to apply','请先选择要移除的 Key':'Select a key to remove','Key 已移除，保存后生效':'Key removed; save to apply'};const n=$('action-status');n.textContent=S.settings.language==='en-US'?(translations[text]||text):text;n.dataset.kind=kind;n.hidden=!text;}
function inactive(field) {
 const r=field.inactiveRule,s=S.settings;
 if(!r)return false;
 if(r.whenEquals)return s[r.whenEquals.key]===r.whenEquals.value;
 if(r.unlessEquals)return s[r.unlessEquals.key]!==r.unlessEquals.value;
 if(r.whenOff)return ![true,1,'enabled','on'].includes(s[r.whenOff]);
 if(r.whenOn)return [true,1,'enabled','on'].includes(s[r.whenOn]);
 return false;
}
function maxDefault() {return S.settings.thinking_type==='enabled'?(S.settings.reasoning_effort==='max'?S.limits.maxTokensMaxEffort:S.limits.maxTokensThink):S.limits.maxTokensPlain;}
function options(key) {
 const native=S.nativeFields?.find(f=>f.key===key);if(native?.options.length)return native.options.map(o=>[o.value,o.label]);
 switch(key) {
  case 'compact_percent':return [[50,'50%'],[65,'65%'],[75,'75%'],[85,'85%'],[0,'关闭']];
  case 'compact_keep_turns':return [[2,'2 轮'],[4,'4 轮'],[8,'8 轮'],[12,'12 轮']];
  case 'model':return S.models.map(m=>[m.id,m.id==='deepseek-flash'?'DeepSeek Flash':'DeepSeek V4 Pro']);
  case 'max_tokens':return [[S.limits.maxTokensPlain,'8K · 8,192'],[S.limits.maxTokensThink,'64K · 65,536'],[S.limits.maxTokensMaxEffort,'128K · 131,072']];
  case 'thinking_type':return [['enabled','开启'],['disabled','关闭']];
  case 'reasoning_effort':return [['low','低 Low'],['high','高 High'],['max','最高 Max']];
  case 'show_reasoning':case 'stream':case 'stream_include_usage':return [[true,'开启'],[false,'关闭']];
  case 'response_format':return [['text','普通文本'],['json_object','JSON']];
  case 'request_timeout_seconds':return [[60,'1 分钟'],[300,'5 分钟'],[600,'10 分钟']];
  default:return null;
 }
}
function selection(key) {
 const value=S.settings[key];
 return value;
}
function set(key,value) {
 if(S.settings[key]===value)return;
 if(key==='__matrix_model'){poolAction('select',value);return;}
 if(key==='__provider'||key==='model'&&S.nativeFields?.some(f=>f.key==='__provider')) {action(async()=>{const r=await api.providerAction(key==='__provider'?'select':'choose',S.settings,value);if(!r.ok)throw Error(r.errors?.join('; '));S.settings=r.settings;S.nativeFields=r.nativeFields;S.dirty=true;renderPane();});return;}
 if(key==='active_profile') {action(async()=>{const r=await api.draftProfile(S.settings,value);if(!r.ok)throw Error(r.errors?.join('; '));S.settings=r.settings;S.nativeFields=r.nativeFields;S.dirty=true;renderPane();});return;}
 S.settings[key]=value;S.dirty=true;status();
 refreshDisabled();
 // 自动最大输出跟随思考模式；旧的 0 值只做展示映射，保存时仍保留服务端默认语义。
 if((key==='thinking_type'||key==='reasoning_effort')&&Number(S.settings.max_tokens)===0)renderSelect($('field-max_tokens'),'max_tokens');
}
function renderSelect(input,key) {
 const opts=options(key),current=selection(key);
 input.replaceChildren();
 if(!opts.some(([v])=>String(v)===String(current))) {
  const legacy=el('option',null,tr('当前 · ','Current · ')+current);legacy.value=String(current);legacy.disabled=true;input.appendChild(legacy);
 }
 for(const [value,label] of opts) {const opt=el('option',null,label);opt.value=String(value);opt.disabled=S.nativeFields?.find(f=>f.key===key)?.options.find(o=>o.value===value)?.disabled===true;input.appendChild(opt);}
 input.value=String(current);
}
function renderField(field) {
 if(field.type==='model_grid')return renderCatalog(field);
 const key=field.key,box=el('div','field');box.dataset.key=key;
 const label=el('label','field__label',field.label||key);label.htmlFor='field-'+key;
 if(key==='api_key') return renderApiKeyField(field);
 const opts=options(key),input=el(opts?'select':field.multiline?'textarea':'input','input');input.id=label.htmlFor;
 if(opts) {
  renderSelect(input,key);
  input.addEventListener('change',()=>{const opt=options(key).find(([v])=>String(v)===input.value);if(opt)set(key,opt[0]);});
 } else {
  input.type=key==='api_key'?'password':'text';input.autocomplete='off';input.spellcheck=false;
  input.value=S.settings[key]??'';input.placeholder=field.placeholder||tr('可选','Optional');input.readOnly=!!field.readonly;
  if(key==='api_key')input.addEventListener('focus',()=>input.select());
  input.addEventListener('input',()=>set(key,input.value));
 }
 box.append(label,input);
 if(field.action){const b=el('button','key-action',tr('搜索','Search'));b.id='provider-filter';b.type='button';b.addEventListener('click',()=>providerAction('filter'));box.appendChild(b);}

 return box;
}
async function providerAction(name){
 return action(async()=>{const r=await api.providerAction(name,S.settings);if(!r.ok)throw Error(r.errors?.join('; '));S.settings=r.settings;S.nativeFields=r.nativeFields;S.dirty=true;renderPane();status(name==='add'?tr('已加入模型池','Added to model pool'):'','ok');});
}
function renderCatalog(field){
 const box=el('section','catalog'),fetch=el('button','key-action',tr('获取模型列表','Fetch models'));
 fetch.id='provider-discover';fetch.type='button';fetch.addEventListener('click',()=>providerAction('discover'));box.appendChild(fetch);
 if(!field.options.length)return box;
 const grid=el('div','catalog-grid');grid.id='catalog-models';grid.setAttribute('role','group');grid.setAttribute('aria-label',tr('选择模型','Select models'));
 const selected=new Set(S.settings.__catalog_selected||[]);
 for(const option of field.options){
  const card=el('button','model-card',option.label);card.type='button';card.dataset.model=option.value;card.dataset.unavailable=String(!!option.disabled);card.disabled=!!option.disabled;
  card.setAttribute('aria-pressed',String(selected.has(option.value)));card.title=option.value;
  card.addEventListener('click',()=>{if(selected.has(option.value))selected.delete(option.value);else selected.add(option.value);set('__catalog_selected',[...selected]);card.setAttribute('aria-pressed',String(selected.has(option.value)));});grid.appendChild(card);
 }
 const add=el('button','key-action',tr('加入模型池','Add to model pool'));add.id='provider-add';add.type='button';add.addEventListener('click',()=>providerAction('add'));
 box.append(grid,add);return box;
}
function maskKey(key) {
 const k=String(key||'').trim();
 return k.length<=8?'*'.repeat(k.length):k.slice(0,4)+'********'+k.slice(-4);
}
function renderApiKeyField() {
 const box=el('div','field field--api-key');box.dataset.key='api_key';
 const label=el('label','field__label',tr('接口密钥','API key'));label.htmlFor='field-api_key';
 const row=el('div','api-key-row'),actions=el('div','api-key-actions');
 const input=el('input','input');input.id=label.htmlFor;input.type='password';input.autocomplete='off';input.spellcheck=false;input.value=S.settings.api_key||'';input.placeholder=tr('输入接口密钥','Enter an API key');
 const history=el('select','key-history');history.id='field-api_key_history';history.setAttribute('aria-label',tr('已保存的密钥','Saved keys'));
 let editingKey='';
 const list=()=>Array.isArray(S.settings.api_key_history)?S.settings.api_key_history:[];
 const refresh=()=>{
  history.replaceChildren();
  const placeholder=el('option',null,tr('选择已保存的密钥','Select a saved key'));placeholder.value='';history.appendChild(placeholder);
  list().forEach((k,i)=>{const o=el('option',null,`${tr('密钥','Key')} ${i+1} · ${maskKey(k)}`);o.value=String(i);history.appendChild(o)});
  const index=list().indexOf(S.settings.api_key);history.value=index<0?'':String(index);
 };
 const updateHistory=keys=>{S.settings.api_key_history=[...new Set(keys.filter(Boolean))].slice(0,8);S.dirty=true;refresh();};
 input.addEventListener('focus',()=>input.select());
 input.addEventListener('input',()=>{
  const k=input.value.trim();set('api_key',k);
  if(editingKey&&list().includes(editingKey)&&k){updateHistory(list().map(old=>old===editingKey?k:old));editingKey=k;}
  refresh();
 });
 history.addEventListener('change',()=>{
  if(history.value==='')return;
  const k=list()[Number(history.value)];if(typeof k==='string'){editingKey='';set('api_key',k);input.value=k;}
 });
 const button=(id,text,title,run)=>{const b=el('button','key-action',tr(text,{add:'Add',edit:'Edit',remove:'Remove'}[id]));b.id='key-'+id;b.type='button';b.title=tr(title,{add:'Add the entered key',edit:'Edit the selected key',remove:'Remove the selected key'}[id]);b.addEventListener('click',run);actions.appendChild(b);return b;};
 button('add','添加','将输入的 Key 加入列表',()=>{
  const k=input.value.trim();if(!k)return status('请先输入 API Key','err');
  set('api_key',k);input.value=k;editingKey='';updateHistory([k,...list().filter(old=>old!==k)]);status('Key 已加入，保存后生效','ok');
 });
 button('edit','编辑','修改当前 Key，保存后生效',()=>{editingKey=list().includes(S.settings.api_key)?S.settings.api_key:'';input.focus();input.select();});
 button('remove','移除','移除选中的 Key，保存后生效',()=>{
  if(history.value==='')return status('请先选择要移除的 Key','err');
  const removed=list()[Number(history.value)],remaining=list().filter(k=>k!==removed);editingKey='';
  if(S.settings.api_key===removed){set('api_key',remaining[0]||'');input.value=S.settings.api_key;}
  updateHistory(remaining);status('Key 已移除，保存后生效','ok');
 });
 row.append(input,actions,history);box.append(label,row);refresh();return box;
}
function refreshDisabled() {
 for(const field of S.nativeFields||S.groups.flatMap(g=>g.fields)) {
  const input=$('field-'+field.key);if(!input)continue;
  const off=inactive(field);input.disabled=S.busy||off;
  input.closest('.field').classList.toggle('field--inactive',off);
 }
 for(const n of document.querySelectorAll('.api-key-actions button,.key-history,#provider-discover,#provider-filter,#provider-add,.model-card,.pool-actions button,.pool-editor button'))n.disabled=S.busy||n.dataset.unavailable==='true';
 for(const id of ['act-save','act-test','act-reset'])$(id).disabled=S.busy;
}
function renderPane() {
 const fields=(S.nativeFields||S.groups.flatMap(g=>g.fields).filter(f=>allKeys.includes(f.key))).filter(f=>(f.section||'api')===S.view);
 $('all-fields').replaceChildren(...(S.view==='pool'?renderPool():S.view==='matrix'?renderMatrix(fields):fields.map(renderField)));

 document.documentElement.lang=S.settings.language||'zh-CN';
 const tr=(zh,en)=>S.settings.language==='en-US'?en:zh;
 document.querySelector('.sidebar__heading').textContent=tr('配置中心','Settings');
 document.querySelector('#api-tab span').textContent=tr('API 配置','API settings');
 document.querySelector('#pool-tab span').textContent=tr('模型池','Model pool');
 document.querySelector('#matrix-tab span').textContent=tr('Matrix 配置','Matrix settings');
 document.querySelector('#display-tab span').textContent=tr('字体与显示','Font and display');
 for(const view of ['matrix','api','pool','display'])$(view+'-tab').setAttribute('aria-selected',String(S.view===view));
 document.querySelector('.eyebrow').textContent=S.view==='pool'?tr('模型与参数','MODELS & PARAMETERS'):tr('供应商连接','PROVIDER CONNECTION');
 document.querySelector('.intro h1').textContent=S.view==='pool'?tr('模型池','Model pool'):({deepseek:'DeepSeek',openrouter:'OpenRouter',opencode:'OpenCode Zen','opencode-go':'OpenCode Go',custom:tr('自定义接口','Custom endpoint')})[S.settings.__provider]||'DeepSeek';
 document.querySelector('.provider-badge').textContent=S.view==='pool'?String(S.settings.api_profiles?.length||0):tr('连接配置','Connection');
 if(S.view==='matrix'){document.querySelector('.intro h1').textContent=tr('Matrix 配置','Matrix settings');document.querySelector('.eyebrow').textContent=tr('模型与参数','MODEL & PARAMETERS');document.querySelector('.provider-badge').textContent='Matrix';}
 if(S.view==='display'){document.querySelector('.intro h1').textContent=tr('字体与显示','Font and display');document.querySelector('.eyebrow').textContent=tr('界面','INTERFACE');document.querySelector('.provider-badge').textContent=tr('显示','Display');}
 for(const [id,zh,en] of [['act-save','保存','Save'],['act-test','测试连接','Test connection'],['act-reset','重置','Reset'],['toast-reload','重新载入','Reload']])$(id).textContent=tr(zh,en);
 $('act-test').textContent=tr('验证供应商','Verify provider');$('act-test').hidden=S.view!=='api';$('act-reset').hidden=false;
 for(const [selector,zh,en] of [['[data-win=minimize]','最小化','Minimize'],['[data-win=maximize]','最大化','Maximize'],['[data-win=close]','关闭','Close'],['#toast-close','忽略','Dismiss'],['[role=tablist]','设置','Settings'],['#all-fields','接口参数','API parameters']])document.querySelector(selector).setAttribute('aria-label',tr(zh,en));
 refreshDisabled();
}
async function poolAction(name,id){
 return action(async()=>{const r=await api.poolAction(name,S.settings,id);if(!r.ok)throw Error(r.errors?.join('; '));if(name==='test'){status(tr('模型调用成功','Model request succeeded'),'ok');return;}S.settings=r.settings;S.nativeFields=r.nativeFields;if(!['edit','cancel'].includes(name))S.dirty=true;renderPane();if(name==='edit')document.querySelector('.pool-editor')?.scrollIntoView({block:'nearest'});status();});
}
function renderPool(){
 const nodes=[];
 if(!S.settings.api_profiles?.length)nodes.push(el('p','pool-empty',tr('模型池为空，请在API 配置选择模型并加入。','The pool is empty. Select and add models on the API settings.')));
 for(const p of S.settings.api_profiles||[]){
  const row=el('article','pool-row');row.dataset.profile=p.id;
  const info=el('div','pool-info'),title=el('div','pool-name',(S.settings.matrix_profile===p.id?'★ ':'')+p.name);
  const details=[p.provider,p.model,p.free===true?tr('免费','FREE'):'',S.settings.active_profile===p.id?tr('当前','Current'):'',p.enabled===false?tr('已禁用','Disabled'):''].filter(Boolean).join(' · ');
  info.append(title,el('div','pool-meta',details));
  const actions=el('div','pool-actions');
  for(const [name,label]of [['toggle',p.enabled===false?tr('启用','Enable'):tr('禁用','Disable')],['test',tr('测试','Test')],['remove',tr('移除','Remove')]]){const b=el('button','key-action',label);b.type='button';b.dataset.action=name;b.addEventListener('click',()=>poolAction(name,p.id));actions.appendChild(b);}
  for(const b of actions.querySelectorAll('button'))if(['test'].includes(b.dataset.action))b.dataset.unavailable=String(p.enabled===false);
  row.append(info,actions);nodes.push(row);
 }
 return nodes;
}
function renderMatrix(fields){
 const editor=el('section','pool-editor');editor.append(...fields.map(renderField));return [editor];
}
function payload() {return {...S.settings};}
async function action(run) {
 if(S.busy)return;
 S.busy=true;refreshDisabled();
 try {await run();}catch(err){status(tr('操作失败：','Operation failed: ')+err.message,'err');}
 finally {S.busy=false;refreshDisabled();}
}
async function doSave() {
 return action(async()=>{
  if(!(await pendingChanges())){status('已保存','ok');return;}
  status('正在保存…');const r=await api.save(payload(),S.version);
  if(!r.ok){status((r.errors||['保存失败']).join('；'),'err');return;}
  S.settings=r.settings;S.nativeFields=r.nativeFields;S.version=r.version;S.dirty=false;S.baseline=structuredClone(r.settings);S.savedFields=structuredClone(r.nativeFields);renderPane();status('已保存','ok');
 });
}
async function doTest() {
 return action(async()=>{
  status('正在连接…');const r=await api.ping(payload());
  if(r.settings){S.settings=r.settings;S.nativeFields=r.nativeFields;renderPane();}
  status(r.ok?(r.notice||tr('连接成功','Connected')):(r.errors||[tr('连接失败','Connection failed')]).join('; ')+(r.hint?`; ${r.hint}`:''),r.ok?'ok':'err');
 });
}
async function pendingChanges(){
 if(!S.baseline||!S.dirty)return false;
 const r=await api.draftState(S.settings,S.baseline);S.dirty=r.dirty;return r.dirty;
}
async function doReset(){
 return action(async()=>{S.settings=structuredClone(S.baseline);S.nativeFields=structuredClone(S.savedFields);S.dirty=false;renderPane();status();});
}
async function confirmLeave(){
 if(S.leaving||S.busy)return;
 S.leaving=true;S.busy=true;refreshDisabled();
 try{if(await pendingChanges() && !(await api.confirmDiscard(S.settings.language)))return;S.allowExit=true;await api.closeWindow();}
 catch(e){status(e.message,'err');}
 finally{S.leaving=false;S.busy=false;refreshDisabled();}
}
// 主进程先拦住关闭事件，再等待真实修改比较和用户选择，避免 beforeunload 重入。
api.onCloseRequested?.(confirmLeave);
async function bootstrap() {
 const data=await api.bootstrap();
 Object.assign(S,{groups:data.groups,models:data.models,limits:data.limits,defaults:data.defaults,nativeFields:data.nativeFields,version:data.version,officialBaseURL:data.officialBaseURL,settings:{...data.settings},dirty:false});
 S.baseline=structuredClone(S.settings);S.savedFields=structuredClone(S.nativeFields);
 renderPane();status();
}
for(const b of document.querySelectorAll('[data-win]'))b.addEventListener('click',()=>api.win(b.dataset.win));
$('api-tab').addEventListener('click',()=>{S.view='api';renderPane();});$('pool-tab').addEventListener('click',()=>{S.view='pool';renderPane();});
$('display-tab').addEventListener('click',()=>{S.view='display';renderPane();});
$('matrix-tab').addEventListener('click',()=>{S.view='matrix';renderPane();});
$('api-form').addEventListener('submit',e=>{e.preventDefault();doSave();});
$('act-test').addEventListener('click',doTest);$('act-reset').addEventListener('click',doReset);
$('toast-reload').addEventListener('click',async()=>{try{await bootstrap();$('toast').hidden=true;}catch(err){status(err.message,'err');}});
$('toast-close').addEventListener('click',()=>{$('toast').hidden=true;});
window.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey))return;const k=e.key.toLowerCase();if(k==='s'||k==='t'){e.preventDefault();k==='s'?doSave():doTest();}});
api.onExternalChange(async()=>{
 if(S.busy)return;
 try{
  if(await pendingChanges()){$('toast-text').textContent=tr('配置已在外部更改，重新载入将覆盖未保存的修改。','Settings changed externally. Reloading will discard unsaved changes.');$('toast').hidden=false;return;}
  await bootstrap();
 }catch(err){status(tr('热重载失败：','Reload failed: ')+err.message,'err');}
});
bootstrap().catch(err=>status(tr('读取失败：','Load failed: ')+err.message,'err'));
