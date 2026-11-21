// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: loadTerminal; createTerminalView
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/desktop/terminal-view.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Platform rendering adapters only; transcript and lifecycle belong to the Tool.
import {openTerminal} from '../terminal-host.mjs';
import {createTerminalView as createView} from '../../../../Tool/base/official/terminal/presentation/desktop.mjs';
export {TerminalTranscript,checkTerminalPage} from '../../../../Tool/base/official/terminal/presentation/desktop.mjs';
async function loadTerminal(){const [{Terminal},{FitAddon}]=await Promise.all([import('../vendor/xterm.mjs'),import('../vendor/xterm-fit.mjs')]);return {Terminal,FitAddon};}
export function createTerminalView(options={}){return createView({...options,loadTerminal,openTerminal,vendorStyle:new URL('../vendor/xterm.css',import.meta.url).href});}
