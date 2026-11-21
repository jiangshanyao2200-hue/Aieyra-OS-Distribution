'use strict';
// Leases are invalidated even by a quick take/release cycle. Display timing is
// independent of these dispatch checks and never gates an Agent response.
const {AsyncLocalStorage}=require('node:async_hooks');
const current=new AsyncLocalStorage();
function initialize(group){group.control='agent';group.epoch=0;group.needsSnapshot=false;}
function lease(group){return {actor:'agent',epochs:new Map(group?[[group,group.epoch]]:[])};}
function assert(group){const scope=current.getStore();if(scope?.actor!=='agent')return;
 if(scope.cancelled)throw Error('operation_cancelled: already dispatched effects may have occurred; inspect the preserved page before retrying');
 if(!scope.epochs.has(group))scope.epochs.set(group,group.epoch);
 if(group.control==='human'||scope.epochs.get(group)!==group.epoch)throw Error('human_control: browser taken over; this operation is interrupted. Already dispatched effects may have occurred. Wait for handback, then take a new snapshot.');
}
function take(group){group.control='human';group.epoch++;group.needsSnapshot=true;}
function release(group){group.control='agent';group.epoch++;group.needsSnapshot=true;}
function dispatch(group,action){assert(group);if(current.getStore()?.actor==='agent'&&group.needsSnapshot&&!['snapshot','find'].includes(action))throw Error('snapshot_required: human interaction changed the page; take a new snapshot before acting.');}
module.exports={initialize,lease,assert,take,release,dispatch,run:(scope,fn)=>current.run(scope,fn),actor:()=>current.getStore()?.actor};
