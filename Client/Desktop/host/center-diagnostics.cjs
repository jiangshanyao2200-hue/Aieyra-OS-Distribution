// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: inspectSurface; readCenterSurface
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/center-diagnostics.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';

function inspectSurface({action,neuron}) {
 const toggle=document.getElementById('center-health-toggle');
 const graph=document.getElementById('center-neurons');
 const group=document.getElementById('center-nodes');
 const health=document.getElementById('center-health-points');
 const canvas=document.getElementById('center-topology');
 if(!toggle||!graph||!group||!health||!canvas?.dataset.rendering)throw Error('中枢页面尚未就绪');
 if(action==='expand'&&group.hidden||action==='collapse'&&!group.hidden)toggle.click();
 if(action==='select'){
  const button=[...graph.children].find(item=>item.dataset.neuron===neuron);
  if(!button)throw Error('未知中枢节点');
  if(button.getAttribute('aria-pressed')!=='true')button.click();
 }
 const updateToggle=document.getElementById('center-update-toggle');
 const updateMenu=document.getElementById('update-settings');
 if(action==='updates_open'&&updateMenu?.hidden||action==='updates_close'&&updateMenu&&!updateMenu.hidden)updateToggle?.click();
 const target=(container)=>[...container.querySelectorAll('[data-neuron]')].map(item=>({
  id:item.dataset.neuron,tone:item.dataset.tone,selected:item.getAttribute('aria-pressed')==='true'||item.dataset.selected==='true',
 }));
 const trimRect=(element)=>{
  const {x,y,width,height}=element.getBoundingClientRect();
  return {x,y,width,height};
 };
 const selected=target(graph).find(item=>item.selected)?.id||'';
 return {
  rendered:canvas.dataset.rendering,expanded:!group.hidden,selected,attention:graph.dataset.attention||'',
  tone:document.querySelector('.center-situation')?.dataset.tone,
  message:document.getElementById('center-situation-message')?.textContent,
  score:document.getElementById('center-score-value')?.textContent,
  updates:updateMenu&&updateToggle?{
   expanded:!updateMenu.hidden,button:trimRect(updateToggle),panel:trimRect(updateMenu),
   phase:document.getElementById('update-phase')?.textContent,
   status:document.getElementById('update-status')?.textContent,
   integrity:document.getElementById('update-integrity')?.textContent,
   applyDisabled:document.getElementById('update-now')?.disabled===true,
  }:null,
  detail:!document.getElementById('center-selection')?.hidden,
  graph:target(graph),health:target(health),categories:target(group),
  viewport:{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight},
  bounds:{topology:trimRect(graph),bar:trimRect(toggle),labels:[...graph.querySelectorAll('button span')].map(item=>trimRect(item))},
 };
}

async function readCenterSurface(contents,{action='inspect',neuron}){
 if(!['inspect','expand','collapse','select','updates_open','updates_close'].includes(action)||
    action==='select'&&!(typeof neuron==='string'&&/^[a-z_]{1,24}$/.test(neuron)))throw Error('无效的中枢界面检查操作');
 const options={action,...action==='select'?{neuron}:{}};
 return contents.executeJavaScript('('+inspectSurface.toString()+')('+JSON.stringify(options)+')');
}

module.exports={readCenterSurface};
