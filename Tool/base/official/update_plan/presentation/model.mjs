import {activityData} from '../../../../presentation/receipt.mjs';
export function planData(item) {
  const data=activityData(item),plan=data.plan||data.snapshot||(typeof data.state==='object'?data.state:null)||data;
  const steps=plan.phases?.flatMap(phase=>phase.steps||[])||plan.steps||(Array.isArray(plan)?plan:[]);
  return {...plan,objective:plan.objective||'',steps:Array.isArray(steps)?steps:[],phases:plan.phases||[{id:'P',title:'',steps:Array.isArray(steps)?steps:[]}]};
}
