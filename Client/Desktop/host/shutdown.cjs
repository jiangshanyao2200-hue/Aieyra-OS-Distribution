// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: releaseServices; createShutdown
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/shutdown.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';

// Window close, app quit and repeated clicks join the same drain. Services
// remain available until CORE returns a terminal receipt (including failures).
async function releaseServices(services) {
  const entries = Object.entries(services);
  const results = await Promise.allSettled(entries.map(async ([, service]) => service?.close()));
  const failures = {};
  for (let i = 0; i < results.length; i++)
    if (results[i].status === 'rejected') failures['host.' + entries[i][0]] = 'service_release_unconfirmed';
  return {failures};
}

function createShutdown({request, release, exit, report = () => {}, pause = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  let pending, finished = false, exitCode = 0;
  function start(code = 0) {
    if (code) exitCode = 1;
    if (pending) return pending;
    pending = (async () => {
      let receipt;
      try {
        do {
          receipt = await request('workspace.shutdown', {});
          if (!['stopping', 'stopped'].includes(receipt?.phase)) throw Error('shutdown_receipt_invalid');
          if (receipt.phase !== 'stopped') await pause(100);
        } while (receipt.phase !== 'stopped');
      } catch {
        receipt = {phase:'unconfirmed', failures:{host:'core_shutdown_unconfirmed'}};
      }
      try {
        const released = await release();
        if (Object.keys(released?.failures || {}).length)
          receipt = {...receipt, failures:{...receipt.failures, ...released.failures}};
      } catch {
        receipt = {...receipt, failures:{...receipt.failures, host:'host_release_unconfirmed'}};
      }
      if (Object.keys(receipt.failures || {}).length) {
        exitCode = 1;
        // A diagnostic sink failure must not interrupt the drain or final exit.
        try { report(receipt); } catch {}
      }
      finished = true;
      exit(exitCode);
      return receipt;
    })();
    return pending;
  }
  return {start, intercept(event) { if (!finished) { event.preventDefault(); void start(); } }, get started() { return !!pending; }, get finished() { return finished; }};
}

module.exports = {createShutdown, releaseServices};
