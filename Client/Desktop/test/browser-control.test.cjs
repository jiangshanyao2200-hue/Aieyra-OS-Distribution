// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/browser-control.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),control=require('../src/browser-control.cjs');
test('human takeover immediately blocks queued and resumed Agent dispatch',async()=>{const group={};control.initialize(group);const pending=control.lease(group);await control.run(pending,async()=>{control.assert(group);await Promise.resolve();control.take(group);assert.throws(()=>control.assert(group),/human_control/);});control.release(group);assert.throws(()=>control.run(pending,()=>control.assert(group)),/human_control/);assert.throws(()=>control.run(control.lease(group),()=>control.dispatch(group,'click')),/snapshot_required/);control.run(control.lease(group),()=>control.dispatch(group,'snapshot'));});
test('human actions and unrelated profiles do not inherit an Agent lease',()=>{const group={},other={};control.initialize(group);control.initialize(other);control.take(group);control.run({actor:'human'},()=>control.dispatch(group,'navigate'));control.run(control.lease(other),()=>control.dispatch(other,'navigate'));assert.equal(group.needsSnapshot,true);});
test('cancellation blocks further dispatched effects without altering human ownership',()=>{const group={};control.initialize(group);const scope=control.lease(group);scope.cancelled=true;assert.throws(()=>control.run(scope,()=>control.assert(group)),/operation_cancelled/);assert.equal(group.control,'agent');control.run(control.lease(group),()=>control.assert(group));});
