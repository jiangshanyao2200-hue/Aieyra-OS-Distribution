// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Program/official/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: fs; path; readRoutes; createTogetherProgram
// Impact: python -B scripts/code-atlas.py show Program/official/together/service.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';

const path = require('node:path');
const product = path.join(__dirname, 'product', 'desktop');

function createTogetherProgram({ privateBase, account, theme, legacyOffice, fetchImpl = fetch }) {
  let desktop, officeView;
  async function read(route) {
    const current = desktop;
    await current?.ready;
    if (!current?.origin || current !== desktop) throw Error('请先打开 Together 的本地办公室。');
    const response = await fetchImpl(current.origin + route, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error('办公室暂不可读（' + response.status + '）。');
    return response.json();
  }

  const status = () => read('/api/office');
  return {
    surface: {
      webPreferences: {
        preload: path.join(product, 'preload.cjs'),
        partition: 'aieyra-together',
        additionalArguments: ['--together-os'],
      },
      mount(window) {
        const current = require(path.join(product, 'main.cjs')).startDesktop({
          privateBase, window, account, legacyOffice,
          bindOffice(view) {
            officeView = view;
            let inset = 44;
            const fit = () => {
              const { width, height } = window.view.getBounds();
              const scale = window.webContents.getZoomFactor();
              const y = Math.round(inset * scale);
              view.webContents.setZoomFactor(scale);
              view.setBounds({ x: 0, y, width, height: Math.max(1, height - y) });
            };
            window.on('resize', fit);
            window.webContents.on('zoom-changed', fit);
            window.on('show', fit);
            fit();
            theme?.attach(view.webContents);
            return height => { inset = height; fit(); };
          },
        });
        desktop = current;
        theme?.attach(window.webContents);
        window.once('closed', () => {
          if (desktop === current) void this.release().catch(console.error);
        });
      },
      async release() {
        const current = desktop;
        desktop = null;
        officeView = null;
        await current?.close();
      },
    },
    captureContents() {
      if (!officeView?.getVisible()) return null;
      const contents = officeView.webContents;
      if (!desktop?.origin || !contents || contents.isDestroyed() ||
          contents.getURL() !== desktop.origin + '/') throw Error('Together 工位画面尚未就绪');
      return contents;
    },
    accountChanged: () => desktop?.accountChanged(),
    status,
    inspect() {
      if (!desktop) throw Error('请先打开 Together 工作区。');
      return desktop.inspectOS();
    },
    invoke(operation, args = {}) {
      if (operation === 'status') return status();
      if (operation === 'stations') return read('/api/registry');
      if (operation === 'task' && typeof args?.id === 'string' && args.id.trim() && args.id.length <= 256) {
        return read('/api/task?' + new URLSearchParams({ id: args.id }));
      }
      throw Error('Together 操作或参数无效。');
    },
  };
}

module.exports = { createTogetherProgram };
