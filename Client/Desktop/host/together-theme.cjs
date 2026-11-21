// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; path; createTogetherTheme
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/together-theme.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createWindowTheme } = require('./window-theme.cjs');

function createTogetherTheme(config, theme = createWindowTheme(config)) {
  const foundation = fs.readFileSync(path.join(__dirname, '../../../Theme/official/default/ui-foundation.css'), 'utf8');
  return {
    attach(contents) {
      let current, revision = 0;
      const render = async () => {
        if (contents.isDestroyed() || contents.isLoadingMainFrame()) return;
        const css = theme.read().settings?.theme_css || '';
        if (current === css) return;
        const ticket = ++revision;
        current = css;
        try {
          await contents.executeJavaScript(`(() => {
            let style = document.getElementById('aieyra-os-together-theme');
            if (!style) {
              style = document.createElement('style');
              style.id = 'aieyra-os-together-theme';
              document.head.append(style);
            }
            style.textContent = ${JSON.stringify(foundation + '\n' + css)};
          })()`);
        } catch {
          if (ticket === revision) current = undefined;
        }
      };
      const stop = theme.watch(render);
      contents.on('did-finish-load', () => {
        current = undefined;
        void render();
      });
      contents.once('destroyed', stop);
      if (contents.getURL()) void render();
    },
  };
}

module.exports = { createTogetherTheme };
