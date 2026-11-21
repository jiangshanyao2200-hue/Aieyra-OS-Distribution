// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: loginFields
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/browser-page-preload.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Electron没有原生prompt输入框。页面只获得这个标准同步对话框能力，不能访问壳IPC。
const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.executeInMainWorld({func:()=>{delete window.prompt;}});
contextBridge.exposeInMainWorld('prompt',(message='',value='')=>ipcRenderer.sendSync('agent-browser:page-prompt',{message:String(message).slice(0,8000),defaultPrompt:String(value).slice(0,4000)}));

function loginFields(form) {
 if (!(form instanceof HTMLFormElement) || form.method !== 'post' ||
     (form.target && form.target !== '_self') ||
     (!form.target && document.querySelector('base[target]:not([target="_self"])')) ||
     new URL(form.action).origin !== location.origin) return null;
 const inputs = [...form.elements].filter(field => field instanceof HTMLInputElement && !field.disabled);
 const passwords = inputs.filter(field => field.type === 'password');
 if (passwords.length !== 1 || passwords[0].autocomplete === 'new-password' ||
     !passwords[0].name || !passwords[0].getClientRects().length) return null;
 const password = passwords[0];
 const identifiers = inputs.slice(0, inputs.indexOf(password)).filter(field =>
  ['email','text','tel'].includes(field.type) && field.name && field.getClientRects().length);
 const username = identifiers.find(field => field.autocomplete === 'username') || identifiers.at(-1);
 return {username,password};
}

if (process.isMainFrame && isSecureContext && /^https?:$/.test(location.protocol) &&
    !location.hostname.endsWith('.artifact.aieyra.invalid')) {
 const edited = new WeakMap();
 let applying = false;
 document.addEventListener('input', event => {
  if(event.isTrusted && event.target instanceof HTMLInputElement &&
     event.target.type === 'password' && event.target.value.length <= 4096) {
   edited.set(event.target, event.target.value);
  }
 }, true);
 document.addEventListener('submit', event => {
  if (applying || !event.isTrusted) return;
  const fields = loginFields(event.target);
  if (!fields || !fields.password.value || edited.get(fields.password) !== fields.password.value) return;
  const submitter = event.submitter;
  if (submitter && ['formaction','formtarget','formmethod'].some(name => submitter.hasAttribute(name))) return;
  const username = fields.username?.value || '';
  if (username.length > 320) return;
  ipcRenderer.sendSync('agent-browser:password-candidate',{username,password:fields.password.value,action:event.target.action});
 }, true);
 document.addEventListener('DOMContentLoaded', () => {
  if(!document.querySelector('input[type=password]'))ipcRenderer.send('agent-browser:password-page');
 }, {once:true});
 ipcRenderer.on('agent-browser:password-fill', (_event, value) => {
  const done = submitted => ipcRenderer.send('agent-browser:password-fill-complete',{id:value.id,submitted});
  if (value.origin !== location.origin) {done(false);return;}
  const forms = Array.from(document.forms).filter(candidate => loginFields(candidate));
  if (forms.length !== 1) {done(false);return;}
  const form = forms[0], fields = loginFields(form);
  if (!fields || fields.password.value || (value.username && !fields.username)) {done(false);return;}
  const previous = fields.username?.value;
  applying = true;
  let timer;
  const clear = submitted => {
   clearTimeout(timer);
   form.removeEventListener('formdata', serialized);
   fields.password.value = '';
   if (fields.username) fields.username.value = previous;
   applying = false;
   done(submitted);
  };
  const serialized = () => queueMicrotask(()=>clear(true));
  try {
   if (fields.username) fields.username.value = value.username;
   fields.password.value = value.password;
   form.addEventListener('formdata', serialized, {once:true});
   timer = setTimeout(()=>clear(false), 500);
   HTMLFormElement.prototype.requestSubmit.call(form);
  } catch {
   clear(false);
  }
 });
}

// Only Core-authorized local artifact origins are registered by the host. A
// dropped file is handed to the shared composer; no file API reaches the page.
if(/^https:\/\/[a-f0-9]{36}\.artifact\.aieyra\.invalid$/.test(location.origin)){
 window.addEventListener('dragover',event=>{if(Array.from(event.dataTransfer?.types||[]).includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
 window.addEventListener('drop',async event=>{
  const items=Array.from(event.dataTransfer?.files||[]);if(!items.length)return;event.preventDefault();event.stopImmediatePropagation();
  if(items.length>10)return;
  const paths=items.map(file=>webUtils.getPathForFile(file));if(paths.some(p=>!p))return;
  await ipcRenderer.invoke('workspace:dropFiles',{paths,files:[]}).catch(()=>{});
 },true);
}
