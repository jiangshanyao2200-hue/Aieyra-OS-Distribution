// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: shapes; busyStates; statusLabels; mountProgramIcon; paintProgramStatus
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/program-icons.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const shapes = {
  home: '<path d="m3 11 9-8 9 8M5 9v12h5v-7h4v7h5V9"/>',
  center: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  coding: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="m8 10 2.5 2L8 14M13 15h3"/>',
  browser: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  link: '<path d="m9 15 6-6M10 7l2-2a5 5 0 0 1 7 7l-2 2M14 17l-2 2a5 5 0 0 1-7-7l2-2"/>',
  servers: '<rect x="4" y="4" width="16" height="6.5" rx="2"/><rect x="4" y="13.5" width="16" height="6.5" rx="2"/><path d="M8 7.2h.01M8 16.8h.01"/>',
  workspace: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 3v18M8 9h13"/>',
  together: '<path d="m6 17.4 6-11.4 6 11.4M8.4 13.2h7.2"/><circle cx="17.4" cy="6.6" r="1.2" fill="currentColor" stroke="none"/>',
  contacts: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/>',
};

const busyStates = new Set(['queued', 'running', 'cancelling']);
const statusLabels = {
  queued: '排队中',
  running: '工作中',
  cancelling: '正在停止',
  waiting_user: '等待你的回复',
  failed: '执行失败',
  interrupted: '执行中断',
  cancelled: '已停止',
};

export function mountProgramIcon(target, program) {
  if (!target?.ownerDocument || !Object.hasOwn(shapes, program)) return false;
  if (target.dataset.programIcon === program) return true;

  const icon = target.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  if (program === 'center') {
    icon.setAttribute('stroke-width', '1.7');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
  }
  icon.innerHTML = shapes[program];
  target.querySelector(':scope > svg')?.remove();
  target.prepend(icon);
  target.dataset.programIcon = program;
  return true;
}

export function paintProgramStatus(target, contact, session) {
  if (!target) return;
  if (!contact) {
    if (!target.hasAttribute('data-agent-state')) return;
    delete target.dataset.agentState;
    delete target.dataset.agentWorking;
    target.removeAttribute('aria-description');
    return;
  }

  const state = session?.state || 'idle';
  const drawing = contact.program_activity?.active === true;
  target.dataset.agentState = drawing && !busyStates.has(state) ? 'running' : state;
  target.dataset.agentWorking = String(drawing || busyStates.has(state));
  target.setAttribute('aria-description', contact.name + ' · ' + (drawing ? '绘图中' : statusLabels[state] || '空闲'));
}
