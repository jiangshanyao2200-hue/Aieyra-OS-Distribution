// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: active; failures; createThemeSounds; setupThemeSounds
// Impact: python -B scripts/code-atlas.py show Theme/runtime/sounds.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {assetURL,validateSounds} from '../contract/assets.mjs';

const active=new Set(['queued','running','waiting_user','cancelling']);
const failures=new Set(['failed','timed_out','interrupted','interrupted_unknown','persistence_failed']);

// One owner in the primary workspace. Native projections never create players.
// No queues: missed/hidden/replayed events are deliberately consumed silently.
export function createThemeSounds({createAudio=()=>new Audio(),now=()=>performance.now()}={}){
 let settings=null,key='',scope='',baseline=true,visible=true,closed=false;
 let roles=new Map(),questions=new Set(),cursor=-1,revision=-1,lastPlayed=-Infinity,player=null;
 function stop(){const old=player;player=null;if(old){old.onended=null;old.onerror=null;old.pause();old.removeAttribute('src');old.load();}}
 function configure(value){
  const selection=value?.layout_theme,sounds=selection?.definition?.sounds||{},preferences=value?.sounds;
  let next=null;
  try{validateSounds(sounds,selection?.definition?.assets);if(selection&&preferences?.enabled===true&&Number.isInteger(preferences.volume)&&preferences.volume>0&&preferences.volume<=100){for(const id of Object.values(sounds))assetURL(selection,id);next={selection:structuredClone(selection),sounds:structuredClone(sounds),volume:preferences.volume/100};}}catch{}
  const signature=JSON.stringify(next);
  if(key!==signature){key=signature;settings=next;stop();baseline=true;}
 }
 function play(event){
  if(closed||!visible||!settings?.sounds[event]||now()-lastPlayed<1200)return;
  lastPlayed=now();stop();
  const audio=createAudio();player=audio;
  const finish=()=>{if(player===audio)stop();};
  audio.preload='none';audio.volume=settings.volume;audio.onended=finish;audio.onerror=finish;
  audio.src=assetURL(settings.selection,settings.sounds[event]);
  try{Promise.resolve(audio.play()).catch(finish);}catch{finish();}
 }
 function observe(next){
  if(closed||!next?.session_id||!next.core_epoch||!Array.isArray(next.roles))return;
  const own=JSON.stringify([next.session_id,next.core_epoch]);
  if(scope!==own){scope=own;roles.clear();questions.clear();cursor=-1;revision=-1;baseline=true;stop();}
  // Feed cursor and message revision never go backwards within a scope.
  if(Number(next.cursor)<cursor||Number(next.revision)<revision)return;
  cursor=Math.max(cursor,Number(next.cursor)||0);revision=Math.max(revision,Number(next.revision)||0);
  const events=new Set(),pending=[];
  for(const role of next.roles){
   if(!role.id||!Number.isSafeInteger(role.generation)||role.generation<1)continue;
   const old=roles.get(role.id);
   if(old&&role.generation<old.generation)continue;
   // A delayed working snapshot cannot reopen a consumed terminal generation.
   if(old&&old.generation===role.generation&&old.terminal)continue;
   const terminal=role.state==='completed'||failures.has(role.state)||role.state==='cancelled';
   if(terminal&&(!old||role.generation>old.generation||active.has(old.state)))events.add(role.state==='completed'?'task.completed':failures.has(role.state)?'task.failed':'');
   roles.set(role.id,{generation:role.generation,state:role.state,terminal});
   const humans=(role.human_requests||[]).filter(q=>q.state==='waiting_user'&&q.generation===role.generation&&q.id);
   for(const q of humans)pending.push(role.id+':'+role.generation+':'+q.id);
   if(role.state==='waiting_user'&&!humans.length)pending.push('waiting:'+role.id+':'+role.generation);
  }
  const primary=next.roles.find(r=>r.role==='matrix'),generation=roles.get(primary?.id)?.generation;
  for(const q of next.ask_requests||[])if(q.state==='pending'&&q.id&&q.generation===generation)pending.push('ask:'+q.generation+':'+q.id);
  for(const id of pending)if(!questions.has(id)){questions.add(id);events.add('attention.pending');}
  // Bound lifetime state. Exhaustion rearms silently instead of replaying it.
  if(questions.size>1024||roles.size>256){questions=new Set(pending);roles.clear();baseline=true;}
  const suppress=baseline;baseline=false;
  if(!suppress)for(const name of ['task.failed','attention.pending','task.completed'])if(events.has(name)){play(name);break;}
 }
 return {configure,observe,setVisible(value){const next=value===true;if(next!==visible){visible=next;baseline=true;stop();}},dispose(){closed=true;stop();roles.clear();questions.clear();settings=null;}};
}

export function setupThemeSounds({document:doc=document,subscribeVisibility}={}){
 const runtime=createThemeSounds();let hostVisible=true;
 const sync=()=>runtime.setVisible(hostVisible&&!doc.hidden);
 const unsubscribe=subscribeVisibility?.(value=>{hostVisible=value===true||value?.visible===true;sync();});
 doc.addEventListener('visibilitychange',sync);sync();
 const dispose=()=>{unsubscribe?.();doc.removeEventListener('visibilitychange',sync);runtime.dispose();};
 doc.defaultView.addEventListener('pagehide',dispose,{once:true});
 return runtime;
}
