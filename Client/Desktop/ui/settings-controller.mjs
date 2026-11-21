// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: TABS; checkSettings; setupProfileSettings; setupSettingsController
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/settings-controller.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setupConnection} from './connection.mjs';
import {setupPromptSettings} from './prompts.mjs';
import {setupProfileMedia,profileMedia} from './profile-media.mjs';
import {setupLook} from './look.mjs';
import {setupGlassSelects} from './glass-select.mjs';
import {tabKeyboard} from './interaction.mjs';
import {applyChatLayout} from './chat-layout.mjs';
import {setupRoleSettings} from './role-settings.mjs';
import {setupRequestRecords} from './request-records.mjs';

const TABS=[['profile-tab','profile-settings'],['appearance-tab','appearance-settings'],['aieyra-tab','aieyra-page'],['providers-tab','providers-page'],['connection-tab','links-page'],['requests-tab','request-settings'],['prompts-tab','prompt-settings']];
export function checkSettings(result){
  if(result?.ok===false)throw Error(result.error||(result.errors||[]).join('\n')||'操作未成功');
  return result;
}

// Saved layout and the unsaved personal form have separate owners. Saving one
// must never submit the other's draft, including a crop completed during save.
export function setupProfileSettings(api,{doc=document,media,mediaValue=profileMedia,roleMedia=null,check=checkSettings,onApply=()=>{}}){
  const $=id=>doc.getElementById(id);
  let profile={name:'',initialized:false},saving=false,pending=Promise.resolve();
  const draft=()=>{const media=mediaValue();return {...profile,...media,...(roleMedia?{roles:roleMedia.value(),mediaRotation:{...media.mediaRotation,...roleMedia.rotation?.()}}:{}),name:$('display-name').value,eyraName:$('eyra-display-name').value};};
  // Server normalization can reorder rotation targets and their fields.
  // Equal saved values must not look like an unsaved edit after a random pick.
  const personal=p=>JSON.stringify([p.name||'',p.eyraName||'',p.avatar||'',p.eyraAvatar||'',p.userRingColor||'#e6e9f0',Object.keys(p.roles||{}).sort().map(key=>{const r=p.roles[key];return [key,r.name||'',r.avatar||'',r.ring||'pulse'];}),p.background||'',p.backgroundBlur??0,p.backgroundOpacity??0,p.chatBlur??12,p.chatOpacity??.18,p.mediaRotation||{}],(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
  const dirty=()=>personal(draft())!==personal(profile);
  const apply=()=>{applyChatLayout(doc.body.style,profile.chatLayout);onApply({...profile});};
  const changed=()=>{$('profile-status').textContent=dirty()?'有未保存的修改':'';};
  function rebase(value){
    if(!value||value.version===profile.version)return;
    const previous=profile;
    media.rebase?.(previous,value);roleMedia?.rebase?.(previous,value);
    for(const [id,key]of [['display-name','name'],['eyra-display-name','eyraName']])if($(id).value===(previous[key]||''))$(id).value=value[key]||'';
    profile=value;apply();if(!saving)changed();
  }
  function refresh(value){
    // Notifications may arrive during a save. Re-read after the queued write
    // instead of installing an older event snapshot over its committed result.
    const operation=pending.then(async()=>rebase(api.profile?check(await api.profile()).profile:value));
    pending=operation.catch(()=>{});return operation;
  }
  function commit(make){
    const operation=pending.then(async()=>{if(api.profile){const fresh=check(await api.profile()).profile;media.rebase?.(profile,fresh);roleMedia?.rebase?.(profile,fresh);profile=fresh;}profile=check(await api.saveProfile(make())).profile;apply();return {...profile};});
    pending=operation.catch(()=>{});return operation;
  }
  for(const id of ['display-name','eyra-display-name'])$(id).addEventListener('input',changed);
  $('save-profile').onclick=async()=>{
    if(saving)return;saving=true;
    const controls=['display-name','eyra-display-name','save-profile'],submitted=draft();
    for(const id of controls)$(id).disabled=true;
    $('profile-status').textContent='正在保存…';
    try{
      const fields=Object.fromEntries(['name','eyraName','avatar','eyraAvatar','userRingColor','background','backgroundBlur','backgroundOpacity','chatBlur','chatOpacity'].filter(key=>JSON.stringify(submitted[key])!==JSON.stringify(profile[key])).map(key=>[key,submitted[key]]));
      const roles=Object.fromEntries(Object.entries(submitted.roles||{}).map(([role,row])=>[role,Object.fromEntries(Object.entries(row).filter(([key,value])=>value!==profile.roles?.[role]?.[key]))]).filter(([,patch])=>Object.keys(patch).length));
      const rotation=Object.fromEntries(['avatar','eyraAvatar','background','cotaAvatar','vayaAvatar'].filter(key=>JSON.stringify(submitted.mediaRotation?.[key])!==JSON.stringify(profile.mediaRotation?.[key])).map(key=>[key,submitted.mediaRotation?.[key]||{mode:'custom'}]));
      const saved=await commit(()=>({...profile,...fields,...(Object.keys(roles).length?{roles:{...profile.roles,...Object.fromEntries(Object.entries(roles).map(([role,patch])=>[role,{...profile.roles?.[role],...patch}]))}}:{}),...(Object.keys(rotation).length?{mediaRotation:{...profile.mediaRotation,...rotation}}:{})}));
      media.rebase?.(submitted,saved);roleMedia?.rebase?.(submitted,saved);
      // The store trims names. Keep any newer edits while reflecting that
      // normalization for the submitted, still-current input.
      for(const [id,key] of [['display-name','name'],['eyra-display-name','eyraName']])if($(id).value===submitted[key])$(id).value=saved[key]||'';
      $('profile-status').textContent=dirty()?'已保存，仍有未保存的修改。':'已保存。';
    }catch(error){$('profile-status').textContent=error.message+'；当前编辑内容已保留。';}
    finally{saving=false;for(const id of controls)$(id).disabled=false;}
  };
  return {
    changed,
    refresh,
    initialize(value){profile=value||profile;$('display-name').value=profile.name||'';$('eyra-display-name').value=profile.eyraName||'';media.load(profile);roleMedia?.load(profile);apply();if(profile.warning)$('profile-status').textContent=profile.warning;},
    get profile(){return {...profile};},
    get dirty(){return dirty();},
    saveLayout(chatLayout){return commit(()=>({...profile,chatLayout}));},
  };
}

// The same fixed settings DOM and existing versioned configuration editors are
// assembled here, independently of workspace bootstrap, chat and task views.
export function setupSettingsController(api,{notice=()=>{},doc=document}={}){
  const $=id=>doc.getElementById(id);let personal,selected='',connectionsOpened=false,visible=true,closed=false;
  const media=setupProfileMedia(api,checkSettings,{notice,changed:()=>personal.changed()});
  const roleMedia=setupRoleSettings(api,{doc,changed:()=>personal.changed(),notice});
  personal=setupProfileSettings(api,{doc,media,roleMedia});
  const connection=setupConnection(api,checkSettings,result=>{if(!result?.quiet&&result?.notice)notice(result.notice);});
  const prompts=setupPromptSettings(api,checkSettings,{doc});
  const requests=setupRequestRecords(api,{doc,check:checkSettings});
  setupGlassSelects($('onboarding'));
  const appearance=setupLook(api,{profile:()=>personal.profile,saveLayout:layout=>personal.saveLayout(layout)});
  // 键盘操作时才显示分类的焦点环；鼠标打开设置不该看到一个框。
  doc.addEventListener('keydown',event=>{if(event.key==='Tab'||event.key.startsWith('Arrow'))doc.body.dataset.inputMode='keys';},true);
  doc.addEventListener('pointerdown',()=>{delete doc.body.dataset.inputMode;},true);
  function selectTab(id){
    if(!TABS.some(([tab])=>tab===id))return;
    if(selected===id)return;
    selected=id;
    for(const [tab,section]of TABS){
      $(tab).setAttribute('role','tab');$(tab).setAttribute('aria-controls',section);$(tab).tabIndex=tab===id?0:-1;
      $(tab).setAttribute('aria-selected',String(tab===id));$(section).setAttribute('role','tabpanel');$(section).setAttribute('aria-labelledby',tab);$(section).hidden=tab!==id;
    }
    // 焦点跟随选中的分类：设置视图刚打开时，焦点会落在第一个分类上，看起来像另一个被选中的框。
    const focused=doc.activeElement;if(focused&&focused!==$(id)&&TABS.some(([tab])=>$(tab)===focused))$(id).focus({preventScroll:true});
    $('settings-body').scrollTop=0;
    // Pool inputs and their version stay in this renderer after first use.
    if(id==='requests-tab')void requests.open();
    appearance.visibility(visible&&id==='appearance-tab');
    if(!connectionsOpened&&['connection-tab','providers-tab','aieyra-tab'].includes(id)){connectionsOpened=true;void connection.open();}
  }
  for(const [tab]of TABS)$(tab).onclick=()=>selectTab(tab);
  tabKeyboard($('onboarding').querySelector('.settings-tabs'));
  return {
    async initialize(initial){
      checkSettings(initial);media.setPalette?.(initial.identityPalette);roleMedia.setFeatures?.(initial.features);personal.initialize(initial.profile);
      connection.initialize(initial.onboarding?.providers||[],initial.account);
      await appearance.initialize(initial.appearance);
      if(!selected)selectTab(initial.profile?.initialized?'connection-tab':'profile-tab');
    },
    selectTab,
    refreshProfile(value){return personal.refresh(value);},
    visibility(value){visible=value===true;appearance.visibility(visible&&selected==='appearance-tab');},
    close(){closed=true;appearance.close();prompts.close();media.close?.();roleMedia.close?.();},
    get tab(){return selected;},
  };
}
