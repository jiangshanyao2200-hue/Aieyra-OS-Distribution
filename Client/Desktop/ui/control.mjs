// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupControl
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/control.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {workspaceBounds} from './workspace-slide.mjs';
// Shared desktop primitives are injected; Link presentation belongs to Program.
import {el} from './views.mjs';
import {setupRemoteLink} from './remote-link.mjs';
import {setupControl as setup} from '../../../Program/official/link/ui/control.mjs';
export {controlSummary} from '../../../Program/official/link/ui/control.mjs';
export function setupControl(api,navigation,doc=document){return setup(api,navigation,doc,{el,setupRemoteLink,bounds:workspaceBounds});}
