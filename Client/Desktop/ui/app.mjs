// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: mountWorkspace
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/app.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {previewWebReference} from './attachments.mjs';
import {setupMotion,bindSurfaceVisibility} from './motion.mjs';
setupMotion();
import {mountComposer} from './composer-surface.mjs';
import {mountEyraInstrument} from './eyra-instrument.mjs';
import {setupComposerKeys,setupComposerHistory} from './composer-keyboard.mjs';
import {
  WorkspacePresentation,
  activeStates,
  attentionStates,
} from './model.mjs';
import { artifactChips, setArtifactError } from './chat-column.mjs';
import { el, messageView } from './views.mjs';
import { setupCompanion } from './companion.mjs';
import { setupReportCircles } from './reports.mjs';
import { usageSummary, workspaceStatus } from './status.mjs';
import { syncChildren } from './interaction.mjs';
import { setupScrollEdges } from './scroll-edges.mjs';
import { setupHistory } from './history.mjs';
import { setupPasteBlocks } from './paste-blocks.mjs';
import { SendQueue } from './send-queue.mjs';
import { TaskView } from './task-view.mjs';
import { setupNavigation } from './navigation.mjs';
import { setupViewportScale } from './viewport.mjs';
import { setupTerminals } from './terminals.mjs';
import { setupBrowser } from './browser.mjs';
import { setupControl } from './control.mjs';
import { setupAccountStatus } from './account.mjs';
import { setupLink } from './link.mjs';
import { applyAppearance } from './appearance.mjs';
import { subscribeSettingsUpdates } from './settings-sync.mjs';
import { setupAttachments, setupAttachmentIntake } from './attachments.mjs';
import { setupAskUser, setupPendingSupplements } from './ask-user.mjs';
import { setupSendRecovery } from './send-recovery.mjs';
import { setupRecoveredSends } from './recovered-sends.mjs';
import { setupDesktopShell } from './desktop-shell.mjs';
import { setupEmbeddedPages } from './embedded-pages.mjs';
import { setupModulePreview } from './module-preview.mjs';
import {setupModulePage} from './module-page.mjs';
import { setupModuleDock } from './module-dock.mjs';
import { setupAppsMenu } from './apps-menu.mjs';
import { setupGlassSelects } from './glass-select.mjs';
import { setupAppPages } from './app-pages.mjs';
import { configureTooltips } from './tooltip.mjs';
import {setupConversationSurface} from './conversation-surface.mjs';
import {setupContacts} from './contacts.mjs';
import {roleIdentity} from './role-identity.mjs';
import { setupExitAsk } from './exit-ask.mjs';
import { setupReveal, typingOpens } from './reveal.mjs';
import { setupSubconscious } from './subconscious.mjs';
import { setupFoldedSurface } from './folded-surface.mjs';
import {setupProgramAgentSurface} from './program-agent-surface.mjs';
import {setupDockAgents} from './dock-agents.mjs';
import {setupSessionStatus,setupStatusIndicators} from './session-status.mjs';
import { setupSettingsPage } from './settings-page.mjs';
import { bindDoubleClickCopy, clipboardWriter } from './copy-gesture.mjs';
import { bindEscStop } from './esc-stop.mjs';
import {setupThemeSounds} from '../../../Theme/runtime/sounds.mjs';
import {setupMediaViewer,canPreviewMedia} from '../../../Theme/runtime/media.mjs';
import {setupImageGallery} from './image-gallery.mjs';
import {setupComposerMention} from './composer-mention.mjs';
import {createDraftPersistence} from './draft-persistence.mjs';
import {createReadFailureTracker} from './failure-notice.mjs';

export async function mountWorkspace(api) {
  let coreLand=document.body.dataset.land==='core';
  const stopSurfaceVisibility=bindSurfaceVisibility(api);
  window.addEventListener('beforeunload',stopSurfaceVisibility,{once:true});
  mountComposer();mountEyraInstrument();
  setupScrollEdges();
  const $ = (id) => document.getElementById(id);
  // Restore the authoritative session and its draft before accepting input.
  $('message').disabled=$('send').disabled=$('add-attachment').disabled=true;
  const navigation=setupNavigation();
  let presentation = new WorkspacePresentation(),
    snapshot = null,
    cursor = 0,
    panelSignature = '',
    sceneSignature = '',
    composing = false,
    sending = false,
    polling = false,
    closed = false,
    previousActive = null;
  let activityCursors = {}, liveCursors = {};
  let readsPaused=false,readEpoch=0,pollTimer=0;
  const snapshotReadFailure=createReadFailureTracker('workspace-snapshot');
  let composerPreference = 'auto', reveal = null, viewportScaleHost = null;
  let previousWorking = null;
  let disconnected = false;
  let anchorSignature = '', themeSignature = '';
  let sendAttempt = null, sendQueue = null, awaitingComposer = '';
  let returnComposerFocus = false,foldedSurface=null,foldedEscape=null,asks=null;
  const taskView=new TaskView(),taskButtons=new Map();
  let switchingTask=false,taskSignature='';
  let attachmentReferenceToken='',attachmentReferenceSequence=0;
  let gallery=null,primaryDraftSession='',contacts=null,sessionStatus=null,shownSession=null,programAgents=null,dockAgents=null;
  const statusIndicators=setupStatusIndicators(document);
  window.addEventListener('beforeunload',()=>statusIndicators.close(),{once:true});
  const themeSounds=setupThemeSounds({subscribeVisibility:api.onSurfaceVisibility});
  const mediaViewer=setupMediaViewer({read:attachment=>api.attachmentMedia({attachment}),subscribeVisibility:api.onSurfaceVisibility});
  document.addEventListener('eyra-media',event=>void mediaViewer.show(event.detail.attachment));
  let primaryDraft={value:'',pastes:'',attachments:[]};
  const outbox=new Map();
  const durableDraft=createDraftPersistence(p=>api.saveComposerDraft({...p,session_id:primaryDraftSession}),{onError:error=>notice('草稿暂未保存到本地：'+error.message,true)});
  const paste=setupPasteBlocks($('message'),{onChange:saveDraft,onError:text=>notice(text,true)});
  const attachments=setupAttachments($('composer-attachments'),$('add-attachment'),{choose:kind=>api.chooseAttachments({kind}),compact:()=>requestCompaction(),stagePaths:p=>api.stageAttachmentPaths(p),stageBytes:p=>api.stageAttachmentBytes(p),stageFileBytes:p=>api.stageFileBytes(p),preview:(a,all)=>a.web_reference?previewWebReference(a,{locate:reference=>api.browserReference({action:'reveal',reference})}):canPreviewMedia(a)?mediaViewer.show(a):gallery?.previewAttachment(a,all),thumbnail:a=>gallery?.thumbnail(a),onChange:()=>{saveDraft();reveal?.refresh();},onSettled:receipt=>syncAttachmentReferences([receipt]),onError:text=>notice(text,true)});
  document.addEventListener('eyra-web-reference',event=>previewWebReference(event.detail.attachment,{locate:reference=>api.browserReference({action:'reveal',reference})}));
  api.onBrowserReference?.(async event=>{
    try{
      if(event.session_id!==snapshot?.session_id)throw Error('输入会话已切换，请重新引用');
      const result=await attachments.addResult(async()=>{if(event.session_id!==snapshot?.session_id)throw Error('输入会话已切换');return event.result;});
      if(!result?.accepted)throw Error('引用未能加入，已有草稿已保留');
      saveDraft();await durableDraft.drain();foldedSurface?.paint();
      await api.browserReference({action:'accepted',id:event.id,ok:true});
      if(event.detached)notice('网页区域已加入主页输入框');
    }catch(error){void api.browserReference({action:'accepted',id:event.id,ok:false,error:error.message});notice(error.message,true);}
  });
  function openNormalInput(){if(asks?.active)void asks.action('later');navigation.home();toggleComposer(true);}
  if(api.imageLibrary)gallery=setupImageGallery(api,{navigation,attachments,openInput:text=>{openNormalInput();if(text&&!$('message').value.trim()){$('message').value=text;$('message').dispatchEvent(new Event('input',{bubbles:true}));}$('message').focus({preventScroll:true});},onError:text=>notice(text,true)});
  setupComposerMention($('message'),{attachments,thumbnail:a=>gallery?.thumbnail(a)});
  setupAttachmentIntake($('message'),{api,attachments,paste,open:openNormalInput,onError:text=>notice(text,true)});
  // 用户主动压缩：作为一条普通请求交给 Eyra，由它在完整工具边界封存；草稿不受影响。
  const requestCompaction=()=>void sendCommand('请现在整理并压缩上下文：把到目前为止的内容封存成阶段摘要，然后简短告诉我已完成。');
  bindDoubleClickCopy(document,{copy:clipboardWriter(api)});
  // R64：消息上的复制与“编辑后重新发送”。编辑只把原文放回输入框，发送仍是普通新消息，不截断上下文。

  // 程序交给 Eyra 的一句话：放进输入框末尾，不覆盖用户已经写的内容。
  api.onComposeDraft?.(p=>{openNormalInput();const m=$('message'),text=String(p?.text||'');m.value=m.value.trim()?m.value.replace(/\s*$/,'\n')+text:text;m.dispatchEvent(new Event('input',{bubbles:true}));m.focus();m.setSelectionRange(m.value.length,m.value.length);companion.resizeInput();});
  document.addEventListener('aieyra:message-resend',event=>{event.detail.submit=async()=>{if(!await sendCommand(event.detail.text,event.detail.request_id))throw Error('消息尚未加入发送队列，编辑内容已保留。');};});
  document.addEventListener('aieyra:chat-retry',event=>{const {id,session_id,generation,attempt}=event.detail;event.detail.submit=async()=>{const value=await api.retryChat({id,session_id,generation,attempt});if(value?.ok===false)throw Error(value.error||'重试未受理');await refreshSnapshot();};});
  api.onAttachmentDrop?.(async p=>{openNormalInput();if(p.paths?.length)await attachments.addPaths(p.paths);if(p.files?.length)await attachments.addFiles(p.files.map(f=>new File([f.bytes],f.name)));});
  asks=setupAskUser(api,{check,onError:text=>notice(text,true),onReply:refreshSnapshot,openChat:()=>{navigation.home();companion.expandChat();},openInput:()=>toggleComposer(true,false),
   getEditor:()=>({value:$('message').value,pastes:paste.save(),selection:[$('message').selectionStart,$('message').selectionEnd,$('message').selectionDirection],scroll:$('message').scrollTop}),
   setEditor:d=>{paste.restore(d.value||'',d.pastes||'');companion.resizeInput();const m=$('message'),s=d.selection||[m.value.length,m.value.length,'none'];m.setSelectionRange(Math.min(s[0],m.value.length),Math.min(s[1],m.value.length),s[2]||'none');m.scrollTop=d.scroll||0;},readText:()=>paste.expand(),isComposing:()=>composing,onChange:()=>foldedSurface?.paint()});
  const supplements=setupPendingSupplements(api,{check,onError:text=>notice(text,true),onChange:refreshSnapshot});
  const sendRecovery=setupSendRecovery($('bottom-bar'),{getQueue:()=>sendQueue,onRetry:queue=>drainSends(queue),onCheck:queue=>queue.check(confirmQueuedSend),onChange:()=>{sceneSignature='';paintScene();},onError:text=>notice(text,true)});
  const recoveredChecks=new Map();let checkingRecovered=false;
  async function confirmRecovered(entry){
    if(!api.sendReceipt)return false;
    const receipt=check(await api.sendReceipt({request_id:entry.request_id,message:entry.text,attachments:entry.attachments||[]}));
    if(receipt.request_id!==entry.request_id)return false;
    const rows=outbox.get(entry.session_id)||[];
    // A missing historical receipt is unknown, even after its runtime ended.
    // Keep the original pending record; only a positive receipt retires it.
    if(receipt.accepted!==true)return false;
    outbox.set(entry.session_id,rows.filter(row=>row.request_id!==entry.request_id));persistComposer();await durableDraft.flush();recoveredSends.paint();return true;
  }
  async function checkRecovered(){
    if(checkingRecovered||closed||readsPaused||!api.sendReceipt)return;checkingRecovered=true;
    try{for(const entry of [...outbox.values()].flat()){
      if(entry.session_id===snapshot?.session_id||entry.delivery==='prepared'||entry.rejection)continue;
      const key=entry.session_id+'/'+entry.request_id;if(Date.now()-(recoveredChecks.get(key)||0)<30000)continue;
      recoveredChecks.set(key,Date.now());try{await confirmRecovered(entry);}catch{}
    }}finally{checkingRecovered=false;}
  }
  const recoveredSends=setupRecoveredSends($('bottom-bar'),{entries:()=>[...outbox.values()].flat().filter(e=>e.session_id!==snapshot?.session_id&&!snapshot?.tasks?.some(t=>t.id===e.session_id)),onRestore:restorePending,onDiscard:discardPending,onCheck:confirmRecovered,onError:text=>notice(text,true)});
  const history=setupHistory(api,check,notice,(id,task)=>companion.openDocument(id,undefined,task),()=>companion.viewProfile);
  document.body.classList.add('composer-open');
  function notice(text, error = false, options) {
    companion.notice(text,error,options);
  }
  function check(result) {
    if (result?.ok === false) {
      const error=Error(
        result.error || (result.errors || []).join('\n') || '操作未成功',
      );
      if(result.send_rejection)error.send_rejection=result.send_rejection;
      throw error;
    }
    return result;
  }
  function stored(key, fallback = '') {
    try {
      return sessionStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {}
  }
  function draftKey() {
    return 'draft:' + (snapshot?.session_id || 'initial');
  }
  function saveDraft(){
    $('eyra-trigger').classList.toggle('has-draft',!!$('message').value||!!attachments.length);
    const decision=asks?.active;if(decision)asks.input();const editor=decision?asks.normalDraft:{value:$('message').value,pastes:paste.save()};
    if(!editor)return;
    try{sessionStorage.setItem(draftKey()+':pastes',editor.pastes);sessionStorage.setItem(draftKey()+':attachments',attachments.save());sessionStorage.setItem(draftKey(),editor.value);}
    catch{notice('草稿暂未保存，请保留当前窗口或复制原文。',true);}
    if(snapshot?.session_id===primaryDraftSession)primaryDraft={value:editor.value,pastes:editor.pastes,attachments:attachments.values()};
    persistComposer();
    syncAttachmentReferences();
  }
  function persistComposer(){durableDraft.schedule({...primaryDraft,outbox:[...outbox.values()].flat()});}
  function removePending(entry){
    const rows=outbox.get(entry.session_id)||[];
    if(!rows.includes(entry)||!(entry.delivery==='prepared'||entry.rejection))throw Error('这条消息状态已变化，请重新查看。');
    const next=rows.filter(e=>e!==entry);sessionStorage.setItem('send-attempt:'+entry.session_id,JSON.stringify(next));outbox.set(entry.session_id,next);persistComposer();
  }
  async function discardPending(entry){removePending(entry);await durableDraft.flush();syncAttachmentReferences();}
  async function restorePending(entry){
    if(snapshot?.session_id!==primaryDraftSession)throw Error('请先切回 Eyra 主输入框。');
    if($('message').value||attachments.length||attachments.pending||sending)throw Error('请先处理当前输入，已为你保留上次的消息。');
    // The new draft and removal share one durable document. Restoring never sends.
    navigation.home();toggleComposer(true);$('message').focus({preventScroll:true});
    paste.insert(entry.text);attachments.restore(JSON.stringify(entry.attachments||[]));
    saveDraft();removePending(entry);saveDraft();await durableDraft.flush();
    companion.resizeInput();restoreComposer();$('message').focus();
  }
  function syncAttachmentReferences(receipts=[]){
    if(!api.attachmentReferences||!attachmentReferenceToken)return;
    try{
      const hashes=new Set(attachments.values().map(a=>a.sha256));
      for(let i=0;i<sessionStorage.length;i++){
        const key=sessionStorage.key(i);if(!key)continue;
        if(/^draft:.*:attachments$/u.test(key))for(const a of JSON.parse(sessionStorage.getItem(key)||'[]'))hashes.add(a.sha256);
        else if(key.startsWith('send-attempt:')){const value=JSON.parse(sessionStorage.getItem(key)||'[]');for(const e of Array.isArray(value)?value:value?[value]:[])for(const a of e.attachments||[])hashes.add(a.sha256);}
      }
      const payload={token:attachmentReferenceToken,sequence:++attachmentReferenceSequence,hashes:[...hashes],receipts};
      Promise.resolve(api.attachmentReferences(payload)).then(check).catch(()=>notice('附件保留记录暂未同步，快照会继续保留。',true));
    }catch{notice('附件草稿记录暂不可读，快照会继续保留。',true);}
  }
  function toggleComposer(open = $('composer').hidden, userInitiated = true) {
    if(document.body.dataset.chatLayer==='true')open=true;
    if(!open)saveDraft();
    $('composer').hidden = !open;
    if(open)reveal?.arm();else reveal?.suppress();
    document.body.classList.toggle('composer-open', open);
    $('eyra-trigger').setAttribute('aria-expanded', String(open));
    requestAnimationFrame(()=>companion.resizeInput());
    if(userInitiated){composerPreference=open?'open':'closed';save(draftKey()+':composer',composerPreference);}
    if (open && userInitiated) {
      $('message').focus();
    } else if (!open && document.activeElement === $('message')) $('eyra-trigger').focus();
  }
  function restoreComposer() {
    // 输入框默认收起，靠近即出现（reveal.mjs）；这里不再自动打开，只在它开着时把键盘焦点还给发送者。
    if ($('composer').hidden) { returnComposerFocus = false; return; }
    // Restore the sender's keyboard path, unless they moved to a different
    // control or selected reply text while the model was working.
    const focus = document.activeElement;
    if (returnComposerFocus && !document.querySelector('dialog[open]') &&
        !getSelection()?.toString() &&
        [document.body, $('eyra-trigger'), $('send'), $('message')].includes(focus)) {
      $('message').focus({preventScroll:true});
    }
    returnComposerFocus = false;
  }
  function openPanel() {
    if(navigation.is('panel'))return;
    panelSignature = '';
    $('panel').hidden = false;
    navigation.open('panel','历史记录',{viewKey:'history'});
    document.body.classList.add('panel-open');
    $('panel-title').textContent = '历史';
    $('panel-content').hidden = false;
    $('eyra-trigger').setAttribute('aria-expanded', 'true');
    paintPanel();
    $('panel-content').focus({ preventScroll: true });
    // A human request can arrive between polling ticks. Refresh before the
    // user has to hunt through the panel, then paint against the newest
    // authenticated snapshot.
    refreshSnapshot()
      .catch((error) => notice(error.message, true))
      .finally(() => {
        if (!closed && !$('panel').hidden) paintPanel();
      });
  }
  function closePanel() {
    if(navigation.is('panel'))navigation.home();
    cleanupPanel();
    $('eyra-trigger').focus();
  }
  function cleanupPanel() {
    // Capture the reading anchor while layout and scrollTop still exist.
    history.close();
    $('panel').hidden = true;
    document.body.classList.remove('panel-open');
    $('panel-content').hidden = false;
    $('eyra-trigger').setAttribute('aria-expanded', 'false');
    panelSignature='';$('panel-content').replaceChildren();
  }
  function applyTheme(theme) {
    if (!theme) return;
    const signature = JSON.stringify(theme);
    if (signature === themeSignature) return;
    themeSignature = signature;
    if (theme.scale >= 0.85 && theme.scale <= 1.4)
      document.documentElement.style.setProperty('--scale', theme.scale);
    document.body.classList.toggle(
      'reduce-motion',
      theme.reduced_motion === true,
    );
    if(theme.reduced_motion)for(const animation of document.getAnimations())animation.cancel();
  }

  // The model lives beside the live request counters in the title bar. Keep
  // provider names recognizable, add spacing around compact model IDs, and
  // reserve the full value in title for long names that are ellipsized in the
  // narrow title bar.
  // 标题栏模型名（用户 2026-10-16）：AI · Qwen 3.8 FLASH 这样——厂商名按官方大小写，档位词（Flash / Pro / Max…）全大写，
  // 去掉 openrouter/anthropic/ 这类路径前缀，过长时按词截断并加省略号，完整名放在 title 里。
  function modelLabel(raw) {
    let value = String(raw || '').trim();
    if (!value) return { text: '', title: '' };
    value = value.split('/').filter(Boolean).pop() || value;
    value = value.replace(/[_]+/g, ' ').replace(/\s+/g, ' ');
    const names = new Map([
      ['ai', 'AI'], ['gpt', 'GPT'], ['claude', 'Claude'], ['qwen', 'Qwen'], ['qwq', 'QwQ'],
      ['deepseek', 'DeepSeek'], ['gemini', 'Gemini'], ['gemma', 'Gemma'], ['glm', 'GLM'],
      ['kimi', 'Kimi'], ['minimax', 'MiniMax'], ['mistral', 'Mistral'], ['grok', 'Grok'],
      ['llama', 'Llama'], ['openai', 'OpenAI'], ['anthropic', 'Anthropic'], ['doubao', 'Doubao'],
      ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['codex', 'Codex'], ['coder', 'Coder'],
    ]);
    const tiers = new Set(['flash', 'pro', 'max', 'mini', 'nano', 'air', 'turbo', 'lite', 'plus', 'ultra']);
    const words = value.split(/[\s-]+/).filter(Boolean).map((word) => {
      const lower = word.toLowerCase();
      if (names.has(lower)) return names.get(lower);
      if (tiers.has(lower)) return lower.toUpperCase();
      // qwen3.8 → Qwen 3.8；v4、k2.5、m3 这类短型号保持连写并大写首字母。
      const compact = word.match(/^([a-z]{2,})(\d[\w.]*)$/i);
      if (compact) {
        const head = names.get(compact[1].toLowerCase()) || (compact[1][0].toUpperCase() + compact[1].slice(1).toLowerCase());
        return `${head} ${compact[2]}`;
      }
      if (/^[a-z]\d[\w.]*$/i.test(word)) return word[0].toUpperCase() + word.slice(1);
      if (/^\d/.test(word)) return word;
      if (/^[A-Z0-9.]+$/.test(word)) return word;
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    });
    const title = `AI · ${words.join(' ')}`;
    const visibleWords = [];
    let length = 5; // "AI · "
    for (const word of words) {
      const next = length + word.length + (visibleWords.length ? 1 : 0);
      if (visibleWords.length >= 4 || next > 30) break;
      visibleWords.push(word);
      length = next;
    }
    if (!visibleWords.length) visibleWords.push([...words[0]].slice(0, 22).join(''));
    const text = `AI · ${visibleWords.join(' ')}${visibleWords.join(' ').length < words.join(' ').length ? '…' : ''}`;
    return { text, title };
  }

  function paintAnchors(next) {
    const active = next.roles.some((role) => activeStates.has(role.state));
    const status = workspaceStatus(next);
    const displayed=shownSession||next;
    const usage = usageSummary([...(displayed.roles||[]), {usage:displayed.greeting_usage}]);
    const context = displayed.context||displayed.roles?.find((role) => role.role === 'matrix')?.context;
    const model = modelLabel(displayed.model_name);
    const signature = JSON.stringify([active,status.phase,next.ready,displayed.session_id,usage,context,model.title]);
    if (signature === anchorSignature) return;
    anchorSignature = signature;
    $('status-anchor').dataset.ready = String(next.ready);
    // 启动计时：第一次就绪打一个性能标记，验收和排查启动慢时直接读 performance。
    if (next.ready && !performance.getEntriesByName('aieyra:ready').length) performance.mark('aieyra:ready');
    $('status-anchor').dataset.active = String(active);
    $('status-anchor').dataset.phase = status.phase;
    document.body.dataset.phase = status.phase;
    // Keep the legacy brand node synchronized for older embedded shells, but
    // the visible title-bar location is the chip after In / Out / Ctx below.
    $('brand-model').textContent = model.text;
    $('brand-model').title = model.title;
    $('brand-model').hidden = !model.text;
    // 品牌与实时状态由陪伴呈现层统一更新，使用同一状态来源。
    $('api-slot').hidden = false;
    $('stop').hidden = !active;
    $('api-bubble').classList.toggle('attention', !next.ready);
    statusIndicators.update({usage,context,unconfigured:displayed.kind==='program'&&displayed.configured===false,model:displayed.model_name||'',title:displayed.title,scope:displayed.session_id||displayed.id||next.session_id,active:(displayed.roles||[]).some(r=>activeStates.has(r.state))});
  }

  function accept(next) {
    if (!next || next.version !== 1) throw Error('核心返回了不兼容的工作区版本');
    const changed = snapshot?.session_id !== next.session_id || snapshot?.core_epoch !== next.core_epoch;
    const keepComposerOpen = snapshot?.session_id === next.session_id && !$('composer').hidden;
    if (!changed) {
      if (next.messages_unchanged) next.messages = snapshot.messages;
      next.live = { ...snapshot.live, ...next.live };
    } else {
      activityCursors = {};
      liveCursors = {};
    }
    if(history.reset(next)){panelSignature='';if(changed&&!$('panel').hidden)closePanel();}
    history.update(next);
    for (const role of next.roles)
      if (role.activity) activityCursors[role.role] = role.activity.cursor;
    for (const [role, value] of Object.entries(next.live || {}))
      liveCursors[role] = value.revision;
    themeSounds.observe(next);
    asks.prepare(next);
    snapshot = next;
    supplements.update(next,sendQueue?.entries||[]);
    terminals.update(next);
    subconscious.update(next);
    if(!taskView.id)taskView.select(next.session_id);
    disconnected = false;
    if($('status-anchor').dataset.sessionId!==next.session_id)$('status-anchor').dataset.sessionId=next.session_id;
    cursor = next.cursor;
    applyTheme(next.theme);
    if (changed) {
      presentation = new WorkspacePresentation();
      sceneSignature = '';
      panelSignature = '';
      $('panel-content').hidden = false;
      previousActive = null;
      previousWorking = null;
      awaitingComposer = '';
      returnComposerFocus = false;
      let savedAttempts;try{savedAttempts=JSON.parse(stored('send-attempt:'+next.session_id,'null'));}catch{savedAttempts=null;}
      const queueSession=next.session_id;
      sendQueue=new SendQueue(queueSession,Array.isArray(savedAttempts)?savedAttempts:savedAttempts?[savedAttempts]:[],entries=>{
        sessionStorage.setItem('send-attempt:'+queueSession,JSON.stringify(entries));
        outbox.set(queueSession,entries);persistComposer();
        syncAttachmentReferences();
        if(snapshot?.session_id===queueSession)sendAttempt=entries[0]||null;
      });
      outbox.set(queueSession,sendQueue.entries);
      sendAttempt=sendQueue.entries[0]||null;
      composerPreference = stored(draftKey()+':composer','auto');
      const metadata=stored(draftKey()+':pastes');let draft=stored(draftKey());
      try{if(metadata)draft=JSON.parse(metadata).value;}catch{}
      paste.restore(typeof draft==='string'?draft:'',metadata);
      attachments.restore(stored(draftKey()+':attachments','[]'));
      syncAttachmentReferences();
      $('eyra-trigger').classList.toggle('has-draft',!!$('message').value||!!attachments.length);
      toggleComposer(keepComposerOpen||!!$('message').value||attachments.length>0, false);
    }
    asks.update(next);
    presentation.ingest(next);
    if(!sendQueue?.running)try{sendQueue?.reconcile(next.messages);}catch{notice('发送记录暂未保存，待确认消息仍保留。',true);}
    sendRecovery.paint();
    recoveredSends.paint();
    void checkRecovered();
    if(changed&&sendQueue?.entries.length)notice(sendQueue.entries[0].rejection?'未发送消息已恢复，可修改后重试。':'正在核对消息的发送结果，原文和附件已保留。',true);
    const active = next.roles.some((r) => activeStates.has(r.state));
    const becameIdle = previousActive === true && !active;
    $('eyra-trigger').classList.toggle('busy', active);
    $('eyra-trigger').classList.toggle(
      'attention',
      next.roles.some(
        (role) =>
          role.state === 'waiting_user' || attentionStates.has(role.state),
      ),
    );
    const eventKey = 'events:' + next.session_id + ':' + next.core_epoch,
      seen = Number(stored(eventKey, '0'));
    for (const event of next.events || []) {
      if (event.cursor <= seen) continue;
      if (event.kind === 'error')
        notice(event.data?.message || '工作区操作未完成', true);
      if (event.kind === 'connect') showOnboarding();
      if (event.kind === 'control')
        control.open().catch((error) => notice(error.message, true));
      // Session navigation is an explicit user action, never an agent-side jump.
    }
    save(eventKey, String(next.cursor));
    paintAnchors(next);
    paintTasks(next);
    paintScene();
    paintPanel();
    desktop.update(next,false,{compact:companion.compact,mode:companion.conversationMode});
    const working = ['work','team'].includes(companion.conversationMode);
    // 实际派发才折叠；输入焦点、草稿、附件、选区和 IME 优先保留。
    if (working && previousWorking !== true && !composing && document.activeElement!==$('message') && !$('message').value && !attachments.length && !getSelection()?.toString())
      toggleComposer(false, false);
    if (!navigation.current && !companion.compact && (becameIdle || previousWorking === true && !working)) restoreComposer();
    if (awaitingComposer && !sending && !active && next.messages.some(m => m.id === awaitingComposer && !['queued', 'dispatched'].includes(m.state))) {
      awaitingComposer = '';
      if(!navigation.current&&!companion.compact)restoreComposer();
    }
    previousActive = active;
    previousWorking = working;
    $('message').disabled=$('send').disabled=$('add-attachment').disabled=false;
  }

  let refreshInFlight = null;
  function refreshSnapshot() {
    if (closed||readsPaused) return Promise.resolve(snapshot);
    const readTicket=readEpoch;
    const ticket=taskView.ticket();
    if (refreshInFlight?.epoch===ticket.epoch) return refreshInFlight.promise;
    const entry={epoch:ticket.epoch,promise:null};
    entry.promise = (async () => {
      const next = check(
        await api.snapshot({
          task_id:ticket.id,
          cursor:snapshot?.session_id===ticket.id?cursor:0,
          revision: snapshot?.session_id===ticket.id?snapshot.revision:0,
          activity_cursors:snapshot?.session_id===ticket.id?activityCursors:{},
          live_cursors:snapshot?.session_id===ticket.id?liveCursors:{},
        }),
      );
      if(!closed&&!readsPaused&&readTicket===readEpoch&&taskView.accepts(ticket,next)){
        accept(next);snapshotReadFailure.recovered();
      }
      return next;
    })().catch(error=>{
      if(!closed&&!readsPaused&&readTicket===readEpoch&&taskView.accepts(ticket))throw error;
      return null;
    }).finally(() => {
      if(refreshInFlight===entry)refreshInFlight = null;
    });
    refreshInFlight=entry;
    return entry.promise;
  }

  async function switchTask(id){
    if(id===taskView.id||switchingTask)return;
    if(sending||sendQueue?.running||composing){notice('等待发送确认后即可切换任务');return;}
    saveDraft();
    const previous=taskView.id;
    switchingTask=true;taskView.select(id);
    try{await refreshSnapshot();}
    catch(error){taskView.select(previous);notice(error.message,true);}
    finally{switchingTask=false;paintTasks(snapshot);}
  }
  api.onSelectTask?.(p=>{if(typeof p?.id==='string')void switchTask(p.id);});
  function paintTasks(next){
    const root=$('task-tabs'),tasks=next?.tasks||[],visible=tasks.length>1;
    const signature=JSON.stringify([next?.session_id,switchingTask,tasks.map(task=>[task.id,task.title,task.state])]);
    if(signature===taskSignature)return;taskSignature=signature;
    root.hidden=!visible;document.body.classList.toggle('has-task-tabs',visible);
    const nodes=[];
    for(const task of tasks){
      let button=taskButtons.get(task.id);
      if(!button){button=el('button');button.type='button';button.setAttribute('role','tab');button.onclick=()=>switchTask(task.id);taskButtons.set(task.id,button);}
      button.textContent=task.title||'分裂任务';button.setAttribute('aria-label',task.title||'分裂任务');button.title=(task.title||'分裂任务')+' · '+task.state;
      button.dataset.state=task.state;button.setAttribute('aria-selected',String(task.id===next.session_id));
      button.tabIndex=task.id===next.session_id?0:-1;button.setAttribute('aria-disabled',String(switchingTask));
      nodes.push(button);
    }
    syncChildren(root,nodes);
    const retained=new Set(tasks.map(task=>task.id));for(const id of taskButtons.keys())if(!retained.has(id))taskButtons.delete(id);
  }
  $('task-tabs').onkeydown=event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const buttons=[...$('task-tabs').children],index=buttons.indexOf(document.activeElement);
    if(index<0)return;event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
    buttons[next].focus();buttons[next].click();
  };

  // 光圈托着的最新回复（C1）还没进聊天列：它的产物卡片挂在正文下面（README.md 运行时 · 产物 B1）。按回复编号找消息，内容没变就不重画。
  let voiceArtifactsKey = '';
  function paintVoiceArtifacts() {
    const stage = $('answer-stage'), voice = $('voice'), box = $('voice-artifacts');
    const id = !stage.hidden && stage.dataset.kind === 'final' ? voice.dataset.bodyId || '' : '';
    const list = id ? snapshot.messages?.find(m => m.id === id)?.artifacts || [] : [];
    const key = JSON.stringify([id, list.map(a => a.path)]);
    if (key === voiceArtifactsKey) return;
    voiceArtifactsKey = key;
    box.replaceChildren(...(list.length ? artifactChips(list).childNodes : []));
    box.hidden = !list.length;
  }

  function paintScene() {
    if (!snapshot) return;
    foldedSurface?.paint();
    const signature = JSON.stringify([snapshot.session_id,snapshot.core_epoch,snapshot.revision,snapshot.ready,snapshot.greeting?.revision,snapshot.identity,snapshot.link,snapshot.roles.map(r=>[r.id,r.generation,r.state,r.execution_started,r.activity?.cursor]),Object.values(snapshot.live||{}).map(v=>v.revision),disconnected]);
    if (signature === sceneSignature && !companion.needsAnimation) return;
    sceneSignature = signature;
    presentation.tick();
    const wasCompact=companion.compact;
    companion.paint(snapshot, presentation, disconnected,sendQueue?.entries||[]);
    // 内页字幕读 companion 刚算好的这一帧；签名不变时 paint 自身不发帧。
    if(navigation.current)foldedSurface?.paint();
    gallery?.paint(snapshot);
    supplements.update(snapshot,sendQueue?.entries||[]);
    paintVoiceArtifacts();
    desktop?.update(snapshot,disconnected,{compact:companion.compact,mode:companion.conversationMode});
    sessionStatus?.update();
    if(wasCompact&&!companion.compact&&!navigation.current)restoreComposer();
  }

  function paintPanel() {
    if ($('panel').hidden || !snapshot) return;
    const signature=JSON.stringify([snapshot.core_epoch,snapshot.session_id,snapshot.history_segment,snapshot.roles.flatMap(r=>(r.human_requests||[]).map(q=>[q.id,q.state,q.version]))]);
    if(signature===panelSignature){history.open();return;}
    if($('panel-content').contains(document.activeElement)&&document.activeElement.matches('input,textarea,select'))return;
    panelSignature=signature;
    // Pending decisions use the same composer as Home and the native layer.
    // History owns readback, never a second answer editor or submission path.
    const root=$('panel-content'),scroll=root.scrollTop,children=[history.root];
    syncChildren(root,children);
    root.scrollTop = scroll;
    history.open();
  }

  async function poll() {
    if (polling || closed || readsPaused) return;
    clearTimeout(pollTimer);pollTimer=0;const readTicket=readEpoch;
    polling = true;
    try {
      await refreshSnapshot();
    } catch (error) {
      if(closed||readsPaused||readTicket!==readEpoch)return;
      disconnected = true;
      desktop.update(snapshot,true);
      anchorSignature = '';
      document.body.dataset.phase = 'error';
      $('status-anchor').dataset.ready = 'false';
      $('status-anchor').dataset.active = 'false';
      $('status-anchor').dataset.phase = 'error';
      // 固定品牌字标；动态状态只属于画布光圈。
      $('api-slot').hidden = false;
      $('api-bubble').classList.add('attention');
      const eventKey=snapshotReadFailure.failed(error,taskView.id||snapshot?.session_id||'initial');
      if(eventKey)notice(error.message,true,snapshot?.session_id?{eventKey}:undefined);
    } finally {
      polling = false;
      // Native views can remain document-visible while their owner is minimized.
      if(!closed&&!readsPaused)pollTimer=setTimeout(poll, document.hidden || document.body.dataset.visible==='false' ? 700 : snapshot?.live?.matrix?.phase==='thinking' ? 120 : 250);
    }
  }
  async function send() {
    if (composing||switchingTask||!snapshot) return;
    if(asks?.active){await asks.submit();return;}
    if(attachments.pending){notice('附件正在保存，请稍候。');return;}
    if (!snapshot?.ready) {
      showOnboarding();
      return;
    }
    const queue=sendQueue;if(!queue)return;
    if(queue.entries.some(x=>x.rejection)){notice('请先处理未发送消息，当前输入已保留。',true);sendRecovery.paint();return;}
    if(!$('message').value.trim()&&!attachments.length){if(queue.entries.length&&!queue.running)await drainSends(queue);return;}
    let text;try{text=paste.expand();}catch(error){notice(error.message,true);return;}
    if(!$('panel').hidden)closePanel();
    let request_id;try{({request_id}=queue.add(text,crypto.randomUUID(),attachments.values()));}catch(error){notice('无法保存待发送消息，输入已保留：'+error.message,true);return;}
    awaitingComposer = request_id;
    returnComposerFocus = [ $('message'), $('send') ].includes(document.activeElement);
    companion.beginSend(text,request_id,attachments.values(),queue.entries.find(e=>e.request_id===request_id)?.at);
    attachments.clear();paste.clear();companion.resizeInput();
    // 每次提交开始新一轮自动行为；随后用户的展开和收起都优先于轮询。
    composerPreference='auto';save(draftKey()+':composer','auto');
    if(['work','team'].includes(companion.conversationMode))toggleComposer(false,false);
    paintScene();
    if(!queue.running)await drainSends(queue);
  }
  async function sendCommand(text,id=crypto.randomUUID()){
    if (switchingTask||!snapshot) return false;
    if (!snapshot?.ready) { showOnboarding(); return false; }
    const queue=sendQueue;if(!queue)return false;
    if(queue.entries.some(x=>x.rejection)){notice('请先处理未发送消息，当前输入已保留。',true);sendRecovery.paint();return false;}
    let request_id;try{({request_id}=queue.add(text,id,[]));}catch(error){notice('无法发送：'+error.message,true);return false;}
    companion.beginSend(text,request_id,[]);paintScene();
    if(!queue.running)await drainSends(queue);
    if(queue.entries.some(e=>e.request_id===request_id&&(e.rejection||['pending','unknown'].includes(e.delivery))))return false;
    return {accepted:true,request_id};
  }
  async function confirmQueuedSend(entry){
    await refreshSnapshot().catch(()=>{});
    if(snapshot?.session_id===entry.session_id&&snapshot.messages.some(m=>m.id===entry.request_id))return true;
    const receipt=await api.sendReceipt?.({request_id:entry.request_id,message:entry.text,attachments:entry.attachments||[]}).catch(()=>null);
    return receipt?.accepted===true&&receipt.request_id===entry.request_id;
  }
  async function drainSends(queue){
    sending=true;
    const generations=new Map();
    try{
      // The queue persists each transition before dispatch, and distinguishes
      // failure at this local boundary from an uncertain network receipt.
      await queue.drain(async entry=>{
        const generation=generations.get(entry.request_id)||0;
        const receipt=check(await api.send({request_id:entry.request_id,message:entry.text,attachments:entry.attachments||[],session_id:entry.session_id,generation}));
        // Transport can drop its durable outbox entry now. Keep the visible row
        // until the next authoritative snapshot carries this same request ID.
        if(sendQueue===queue)companion.acceptSend(entry);
        return receipt;
      },confirmQueuedSend,async entry=>{
        // A failed preflight has sent nothing. Keep it at the reversible queue
        // boundary so an ordinary snapshot timeout cannot become an unknown send.
        const current=check(await api.snapshot({task_id:entry.session_id,cursor:0}));generations.set(entry.request_id,current.roles.find(r=>r.role==='matrix')?.generation||0);
        persistComposer();await durableDraft.flush();
      });
    }catch(error){
      if(sendQueue===queue){awaitingComposer='';sceneSignature='';restoreComposer();sendRecovery.failed(queue,error);notice(error.message,true,{quiet:true});}
    }finally{sending=!!sendQueue?.running;sceneSignature='';paintScene();sendRecovery.paint();refreshSnapshot().catch(()=>{});}
  }

  const settingsPage=setupSettingsPage(api,navigation,{onError:text=>notice(text,true)});
  window.addEventListener('beforeunload',()=>settingsPage.close(),{once:true});
  async function showOnboarding(options={}) {try{await settingsPage.open(options);}catch(error){notice(error.message,true);}}


  $('api-bubble').onclick = () => showOnboarding({toggle:true});
  const extensionContext=()=>void api.extensionContext({page:navigation.is('conversation-view')?'conversation:'+document.body.dataset.conversationId:navigation.is('settings-view')?'settings':navigation.is('browser-view')?'browser':/-module-view$/.test(navigation.current||'')?navigation.current.replace(/-module-view$/,''):['control-view','link-view'].includes(navigation.current)?'link':navigation.current?'detail':'home'}).catch(error=>notice(error.message,true));
  document.addEventListener('workspace-view-change',extensionContext);extensionContext();
  window.addEventListener('beforeunload',()=>document.removeEventListener('workspace-view-change',extensionContext),{once:true});
  $('minimize-window').onclick = () => api.minimizeWindow();
  $('maximize-window').onclick = async () => {
    const result = await api.toggleMaximize();
    $('maximize-window').classList.toggle('maximized',result?.maximized===true);
    $('maximize-window').setAttribute('aria-label',result?.maximized?'还原':'最大化');
  };
  $('close-window').onclick = () => api.closeWindow();
  $('close-panel').onclick = closePanel;
  // The history page is a normal OS surface section.  Navigation can leave it
  // through the OS button, Escape, or another left-side entry, so clean its
  // live history state on every page transition rather than relying on a
  // dialog close event.
  document.addEventListener('workspace-view-before-change',()=>{
    if(navigation.is('panel'))cleanupPanel();
  });
  $('message').addEventListener('compositionstart', () => (composing = true));
  $('message').addEventListener('compositionend', () => {
    composing = false;
    saveDraft();
  });
  $('message').addEventListener('input', saveDraft);
  // 保留条件变化后重新评估输入框是否该留（AIDEBUG I1 P3：组字结束、清空草稿后，原来要等鼠标再动才收起）。
  $('message').addEventListener('input', () => reveal?.refresh());
  $('message').addEventListener('compositionend', () => reveal?.refresh());
  window.addEventListener('resize', () => reveal?.refresh());
  // 窗口比例：缩窗口时整体等比收一点（用户 2026-10-13 第 2 项，viewport.mjs）。
  viewportScaleHost = setupViewportScale();
  // 回车换行；Ctrl+回车发送；快速连按两次回车也发送（撤回第一次留下的换行）。
  setupComposerKeys($('message'),{send,isComposing:()=>composing});
  setupComposerHistory($('message'),{isComposing:()=>composing||asks?.active,entries:()=>[...(snapshot?.messages||[]).filter(m=>m.from==='user'&&!m.origin).map(m=>m.text),...(sendQueue?.entries||[]).map(e=>e.text)],onChange:()=>{saveDraft();companion.resizeInput();}});
  $('send').onclick = send;
  $('stop').onclick = async () => {
    $('stop').disabled = true;
    const task_id=snapshot?.session_id,generation=snapshot?.roles.find(r=>r.role==='matrix')?.generation||0;
    try { check(await api.cancel({task_id,generation})); await refreshSnapshot(); }
    catch (error) { notice(error.message, true); }
    finally { $('stop').disabled = false; }
  };
  document.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(!link||!link.closest('.markdown'))return;event.preventDefault();api.openLink({url:link.href}).then(check).catch(e=>notice(e.message,true));});
  // Handle a pending question before the desktop capture handler folds input.
  // Window-level plan and diary handlers still get Escape first.
  document.addEventListener('keydown',event=>{
    if(!event.defaultPrevented&&!event.isComposing&&asks.escape(event))event.stopPropagation();
  },true);
  document.addEventListener('keydown', (event) => {
    if(event.defaultPrevented)return;
    // 键入即唤出：首页没有输入控件聚焦时直接打字，焦点在 keydown 里移进输入框，字随之落进去。
    const editable=!!event.target.closest?.('input,textarea,select,[contenteditable=""],[contenteditable="true"]');
    if(typingOpens(event,{editable,dialogOpen:!!document.querySelector('dialog[open]'),away:!!navigation.current,composerHidden:true})){
      companion.expandChat();
      if($('composer').hidden)toggleComposer(true);else $('message').focus({preventScroll:true});
      return;
    }
    if(event.ctrlKey&&event.key.toLowerCase()==='h'&&!composing){event.preventDefault();openPanel();return;}
    if (document.querySelector('dialog[open]')&&!event.target.closest('#bottom-bar')&&event.key!=='Escape'&&!(event.ctrlKey&&event.key==='Enter')) return;
    if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229 && !composing && !document.querySelector('#composer-menu:not([hidden])')) {
      if (!$('panel').hidden) closePanel();
      else if (!navigation.current && companion.chatExpanded) {event.preventDefault();companion.toggleChat();}
      else if (!$('composer').hidden && !composing) {event.preventDefault();toggleComposer(false);}
    }
    if (event.ctrlKey && event.key === 'Enter' && ($('composer').hidden || !companion.chatExpanded) && !navigation.current) {
      event.preventDefault();
      companion.expandChat();
      toggleComposer(true);
    }
  });
  window.addEventListener('beforeunload', () => {
    closed = true;
    readEpoch++;clearTimeout(pollTimer);
    saveDraft();
  });
  let updateFrozen=false,composerClosing=null;
  function suspendReaders(){readsPaused=true;readEpoch++;clearTimeout(pollTimer);pollTimer=0;refreshInFlight=null;sessionStatus?.suspend();programAgents?.suspend();dockAgents?.suspend();contacts?.store?.suspend();contacts?.groups?.suspend();}
  function resumeReaders(){if(closed||updateFrozen||composerClosing)return;readsPaused=false;sessionStatus?.resume();programAgents?.resume();dockAgents?.resume();if(!coreLand){contacts?.store?.resume();contacts?.groups?.resume();}void poll();}
  function resumeComposerClose(id){if(!composerClosing||composerClosing.id!==id)return;document.body.inert=composerClosing.wasInert||updateFrozen;composerClosing=null;resumeReaders();}
  api.onNotice?.(text=>notice(text,true));
  api.onComposerCloseResume?.(({id})=>resumeComposerClose(id));
  api.onComposerPrepareClose?.(async({id})=>{
   if(composerClosing)return;
   composerClosing={id,wasInert:document.body.inert};document.body.inert=true;suspendReaders();
   let ok=false;
   try{
    if(composing)throw Error('输入法仍在编辑，请完成当前输入后再关闭。');
    const deadline=Date.now()+12000;
    while(attachments.pending){if(Date.now()>deadline)throw Error('附件仍在保存，请稍后再关闭。');await new Promise(resolve=>setTimeout(resolve,25));if(composerClosing?.id!==id)return;}
    saveDraft();await contacts?.flushDrafts?.();await programAgents?.flush();await durableDraft.drain();ok=true;
   }catch(error){notice('草稿保存未完成，窗口已保留：'+error.message,true);}
   if(composerClosing?.id!==id)return;
   try{const receipt=await api.composerCloseReady({id,ok});if(!ok||receipt?.accepted===false)resumeComposerClose(id);}
   catch(error){resumeComposerClose(id);notice('关闭确认未完成，窗口已保留：'+error.message,true);}
  });
  api.onUpdatePrepare?.(async({id})=>{
   // 首页草稿会写盘并在重启后恢复，所以有草稿也能无感更新；其他会话的草稿只在会话缓存里，仍要等清空。
   const text=$('message').value.trim();
   let ready=!sending&&!composing&&!sendAttempt&&!attachments.length&&!attachments.pending&&!document.querySelector('dialog[open]')&&(!text||snapshot?.session_id===primaryDraftSession);
   if(ready){try{saveDraft();await durableDraft.drain();await contacts?.flushDrafts?.();await programAgents?.flush();}catch{ready=false;}}
   if(ready){updateFrozen=true;document.body.inert=true;suspendReaders();}
   await api.updateAcknowledge({id,ready});
  });
  api.onUpdateResume?.(()=>{updateFrozen=false;document.body.inert=!!composerClosing;resumeReaders();});
  dockAgents=setupDockAgents(api);
  const companion = setupCompanion(api,check,{openSettings:showOnboarding,openHistory:openPanel,navigation,onFlow:value=>dockAgents.home(value),beforeLayout:flow=>desktop?.rememberRing?.({mode:flow.mode})});
  programAgents=setupProgramAgentSurface(api,{navigation,profile:()=>companion.profile,epoch:()=>snapshot?.core_epoch||'',onError:text=>notice(text,true)});
  window.addEventListener('beforeunload',()=>{programAgents.close();dockAgents.close();},{once:true});
  foldedSurface=setupFoldedSurface(api,{navigation,companion,decisions:asks,programs:programAgents,snapshot:()=>snapshot,toggle:toggleComposer,history:()=>navigation.is('panel')?closePanel():openPanel(),send,resend:sendCommand,stop:()=>$('stop').click(),escape:()=>foldedEscape?.(),attachments,attach:kind=>attachments.choose(kind||'file'),compact:requestCompaction,onError:text=>notice(text,true)});
  window.addEventListener('beforeunload',()=>foldedSurface.close(),{once:true});
  window.addEventListener('beforeunload',()=>companion.close(),{once:true});
  // 协同时右上角收成轮播胶囊，悬停 / 点开看各角色消耗（最终搬家 R23、R24）。

  const reportCircles = setupReportCircles(handle=>companion.openDocument(handle),{onError:text=>notice(text,true)});
  window.addEventListener('beforeunload',()=>reportCircles.close(),{once:true});
  const stopSettings=subscribeSettingsUpdates(api,{
    profile:p=>{companion.updateProfile(p);programAgents.paint();},
    appearance:r=>{themeSounds.configure(r.settings);applyAppearance(document.body,r.settings,r.fields);companion.resizeInput();},
    connection:refreshSnapshot,
    onError:text=>notice(text,true),
  });
  window.addEventListener('beforeunload',stopSettings,{once:true});
  const terminals = setupTerminals(api);
  const subconscious = setupSubconscious(api,{check,notice});
  const browser = setupBrowser(api,navigation,document,()=>snapshot?.session_id);
  const control = setupControl(api,navigation);
  const stopAccountStatus=setupAccountStatus(api,{onError:text=>notice(text,true)});
  window.addEventListener('beforeunload',stopAccountStatus,{once:true});
  const link = setupLink(api,navigation);
  const desktop = setupDesktopShell(navigation,{nativeEyra:()=>foldedSurface.ownsPresence,openLink:()=>api.openLinkApp().then(check),openHome:()=>api.openHome().then(check),collapseEyra:()=>api.collapseEyra().then(check),onDesktopMode:api.onDesktopMode,onSessionFocus:api.onSessionFocus,desktopMode:()=>api.desktopMode().then(check),openInput:()=>toggleComposer(true),pendingQuestion:()=>companion.pendingQuestion,toggleChat:()=>companion.toggleChat(),expandChat:()=>companion.expandChat(),toggleHistory:()=>navigation.is('panel')?closePanel():openPanel(),closeInput:()=>{if(!composing)toggleComposer(false);},openHistory:openPanel,openSettings:showOnboarding,canFold:()=>!composing&&!$('message').value&&!attachments.length&&document.activeElement!==$('message')&&!getSelection()?.toString(),foldInput:()=>toggleComposer(false,false),restoreInput:restoreComposer,openControl:()=>control.open(),openDocument:(...args)=>companion.openDocument(...args),onError:text=>notice(text,true)});
  // 鼠标停在光圈上时输入框不收（光圈和输入框是一体的；收起会让光圈下沉，头顶按钮从鼠标下滑走）。
  reveal = setupReveal({composer:$('composer'),isOpen:()=>!$('composer').hidden,open:()=>toggleComposer(true,false),close:()=>toggleComposer(false,false),
    keep:()=>composing||!!$('message').value||attachments.length>0||$('composer').contains(document.activeElement)||!!document.querySelector('.presence-header:hover'),
    allow:()=>!navigation.current&&document.body.dataset.chatLayer!=='true'});
  const pinComposer=()=>{if(!navigation.current)toggleComposer(true,false);};document.addEventListener('workspace-view-change',pinComposer);pinComposer();
  const contactsPage=setupModulePage(api,navigation,{key:'contacts',title:'联系人',onError:text=>notice(text,true)});
  const appPages=setupAppPages(api,navigation,{onError:text=>notice(text,true)});
  const embedded = setupEmbeddedPages(api,navigation,{link,control,desktop,openSettings:showOnboarding,openContacts:()=>contactsPage.open(),apps:appPages,onError:text=>notice(text,true)});
  window.addEventListener('beforeunload',()=>embedded.close(),{once:true});
  // 顶栏标签可拖出为独立 Link / Workspace；外嵌期间对应标签隐藏。
  setupExitAsk(api);
  // 产物卡片的动作（README.md 运行时 · 产物 B1）：打开、预览、在文件夹中显示；文件已被删除或移走时卡片变暗，悬停提示原因。
  document.addEventListener('eyra-artifact', async event => {
    const {path, action, chip} = event.detail || {};
    try {
      // 宿主把失败包成 {ok:false,error} 返回，不一定抛出。
      const result = await api.artifact({path, action});
      if (result?.ok === false) throw Error(result.error || '无法打开这个文件');
      if(result?.image)await gallery?.showArtifact(result.image,result.name);
      setArtifactError(chip);
    }
    catch (error) { setArtifactError(chip,String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  });
  // 联系人与会话侧栏：同一份联系人数据供侧栏、左缘头像列和联系人页使用。
  contacts=setupContacts(api,navigation,{profile:()=>companion.profile,onError:text=>notice(text,true)});
  if(coreLand){contacts.setDrawer(false,{remember:false});contacts.store.suspend();contacts.groups?.suspend();}
  programAgents.connectStore(contacts.store);dockAgents.connectStore(contacts.store);
  const conversationSurface=setupConversationSurface(api,navigation,{onError:text=>notice(text,true),title:id=>contacts.store.find(id)?.name||'智能体'});
  sessionStatus=setupSessionStatus(api,navigation,{home:()=>snapshot,changed:value=>{shownSession=value;if(snapshot)paintAnchors(snapshot);},notice:text=>notice(text,true)});sessionStatus.start();
  document.addEventListener('aieyra:model-changed',refreshSnapshot);
  window.addEventListener('beforeunload',()=>sessionStatus.close(),{once:true});
  const stopConversationNames=contacts.store.subscribe(()=>conversationSurface.refresh());
  window.addEventListener('beforeunload',()=>{stopConversationNames();conversationSurface.close();contacts.close();},{once:true});
  $('dock-contacts').onclick=()=>void contactsPage.open().catch(e=>notice(e.message,true));
  api.onModuleState?.(s=>{document.body.dataset.homeDetached=String(s.modules?.home?.detached===true);});
  if(!coreLand)setupAppsMenu(api,{onError:message=>notice(message,true)});
  setupGlassSelects(document.getElementById('view-content'));setupGlassSelects(document.getElementById('screen'));
  // 顶栏的按钮悬停会展开名字，不用再提示；顶栏下面是原生视图，提示框由宿主的小窗画。
  configureTooltips(document,{skip:node=>!!node.closest('#desktop-dock')&&!node.dataset.previewTooltip,native:node=>node.closest('#status-anchor,#desktop-dock')?api.tip:null});
  const moduleDock = setupModuleDock(api,{tabs:{home:$('dock-home'),browser:$('browser-bubble'),contacts:$('dock-contacts'),link:$('dock-link'),settings:$('api-bubble'),...appPages.tabs},current:()=>document.body.dataset.view||document.body.dataset.desktopPage,goHome:()=>navigation.resume(),onError:text=>notice(text,true)});
  window.addEventListener('beforeunload',()=>moduleDock.close(),{once:true});
  const modulePreview = setupModulePreview(api,moduleDock);
  window.addEventListener('beforeunload',()=>modulePreview.close(),{once:true});
  window.addEventListener('beforeunload',()=>desktop.close(),{once:true});
  window.addEventListener('beforeunload',()=>link.close(),{once:true});
  // 停止只在输入框里；另可连按两次 Esc。放在各层（计划、日记、报告、提问）的 Esc 处理之后注册，它们先拿到自己的 Esc。
  const escStop=bindEscStop({stop:$('stop'),token:()=>(snapshot?.session_id||'')+':'+(snapshot?.roles?.find(r=>r.role==='matrix')?.generation||0),
    blocked:event=>{const target=event.target;return composing||!!document.querySelector('dialog[open],#composer-menu:not([hidden]):not([data-state=closing]),:popover-open,.ask-user:not([hidden])')||!$('panel').hidden||!!target?.closest?.('#terminal-pop,.xterm')||(!!target?.closest?.('input,textarea,select,[contenteditable=""],[contenteditable="true"]')&&target.id!=='message');}});
  foldedEscape=()=>escStop?.press();
  window.addEventListener('beforeunload',()=>escStop?.close(),{once:true});
  window.addEventListener('beforeunload',()=>control.close(),{once:true});
  window.addEventListener('beforeunload',()=>browser.close(),{once:true});
  setInterval(paintScene, 150);
  try {
    const initial = check(await api.bootstrap());
    // Keep first-stage geometry until the authenticated host declares this land.
    if(initial.features?.os_first_ring===true){
      coreLand=false;document.body.dataset.land='ring';
      contacts.store.resume();contacts.groups?.resume();
    }
    attachmentReferenceToken=initial.attachment_reference_token||'';
    primaryDraftSession=initial.snapshot.session_id;
    durableDraft.initialize(initial.composer_draft,initial.composer_draft_error);
    primaryDraft=initial.composer_draft?{value:initial.composer_draft.draft.value,pastes:initial.composer_draft.draft.pastes,attachments:initial.composer_draft.draft.attachments}:{value:'',pastes:'',attachments:[]};
    if(initial.composer_draft){
      const key='draft:'+primaryDraftSession,d=initial.composer_draft.draft;
      // Reload keeps its newer session draft; a fresh OS launch receives the persisted one.
      if(sessionStorage.getItem(key)===null){sessionStorage.setItem(key,d.value);sessionStorage.setItem(key+':pastes',d.pastes);sessionStorage.setItem(key+':attachments',JSON.stringify(d.attachments));}
      for(const entry of d.outbox||[]){const rows=outbox.get(entry.session_id)||[];rows.push(entry);outbox.set(entry.session_id,rows);}
      for(const [id,rows] of outbox){const key='send-attempt:'+id;if(sessionStorage.getItem(key)===null)sessionStorage.setItem(key,JSON.stringify(rows));}
    }
    for(let i=0;i<sessionStorage.length;i++){const key=sessionStorage.key(i);if(key?.startsWith('send-attempt:'))try{const rows=JSON.parse(sessionStorage.getItem(key));if(Array.isArray(rows))outbox.set(key.slice(13),rows);}catch{notice('部分待发记录暂不可读，原记录已保留。',true);}}
    accept(initial.snapshot);
    await companion.initialize(initial.profile);
    if(initial.composer_draft_error)notice(initial.composer_draft_error,true);
    if(initial.appearance){themeSounds.configure(initial.appearance.settings);applyAppearance(document.body,initial.appearance.settings,initial.appearance.fields);}
    poll();
    await api.updateReady?.();
  } catch (error) {
    notice(error.message, true);
    $('status-anchor').dataset.ready = 'false';
    // 固定品牌字标；动态状态只属于画布光圈。
    $('api-slot').hidden = false;
    $('api-bubble').classList.add('attention');
    poll();
  }

}
