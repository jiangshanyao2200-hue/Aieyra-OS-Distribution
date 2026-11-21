// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/official/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: definitions
// Impact: python -B scripts/code-atlas.py show Agent/official/definitions.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const definitions=require('./definitions.cjs');
const {setRoles}=require('../../Client/Desktop/src/model-setup.cjs');

test('official Agent tools feed real settings, retain narrowing, and never reopen disabled members',()=>{
 const choices=definitions.toolChoices();
 const config={api_profiles:[],vision_enabled:false,execution_enabled:false};
 setRoles(config,{vision_tools:['project'],execution_tools:['exec_command']});
 assert.deepEqual(config.vision_tools,['project']);
 assert.deepEqual(config.execution_tools,['terminal','exec_command','write_stdin','read_shell_output']);
 assert.equal(config.vision_enabled,false);assert.equal(config.execution_enabled,false);
 setRoles(config,{execution_tools:['memory'],vision_tools:['memory']});
 assert.deepEqual(config.execution_tools,['memory']);assert.deepEqual(config.vision_tools,['memory']);
 choices.execution_tools.push('not_a_tool');
 assert(!definitions.toolChoices().execution_tools.includes('not_a_tool'));
 assert.throws(()=>setRoles(config,{execution_tools:['not_a_tool']}),/只能从/);
 setRoles(config,{execution_tools:[]});assert.deepEqual(config.execution_tools,[]);
 setRoles(config,{execution_tools:null});assert(!Object.hasOwn(config,'execution_tools'));
});
