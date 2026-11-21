// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: createThoughtView
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/thought-view.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {motionAllowed,motionDuration} from './motion.mjs';
import {createThoughtView as create} from '../../../Theme/runtime/thinking.mjs';
export {thoughtSections,thoughtFrame,clean} from '../../../Theme/runtime/thinking.mjs';
// The host supplies its shared motion policy; Theme owns visible content.
export function createThoughtView(options={}){return create({...options,motion:{allowed:motionAllowed,duration:motionDuration}});}
