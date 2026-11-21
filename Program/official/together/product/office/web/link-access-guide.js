/* @file-map:start
文件: link/office/web/link-access-guide.js
位置: 一环·共享工位界面 | 工位页面与供shell/原生OS复用的模型、视觉和弹层规则。
约束: 共享原语优先复用，页面仅组装数据与事件；保持草稿、滚位和焦点，不在布局观察回调中重复同步写布局
下游: 无已解析的项目内静态导入
上游: link/office/tests/unit/link-access-guide.test.mjs, link/office/web/index.html, link/office/web/office-home.js
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: link/office/tests/unit/link-access-guide.test.mjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  linkAgentInstructions | function
  linkAgentInstructions.literal | function
  linkAgentInstructions.wslPath | function
  linkAgentInstructions.shellQuote | function
  setupLinkAccessGuide | function
  setupLinkAccessGuide.text | function
  setupLinkAccessGuide.node | function
  setupLinkAccessGuide.paint | function
  setupLinkAccessGuide.load | function
  setupLinkAccessGuide.close.onclick | handler
  setupLinkAccessGuide.button.onclick | handler
  setupLinkAccessGuide.copy.onclick | handler
  setupLinkAccessGuide.dispose | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
export /* @chain-region linkAgentInstructions | calls: guide.projects.find, Number.isInteger, Error, join, wslPath, shellQuote, JSON.stringify, literal */ function linkAgentInstructions(guide, projectId) {
  const project = guide.projects?.find((p) => p.id === projectId) || guide.projects?.[0];
  if (
    guide.protocol !== 'aieyra-office/1' ||
    !guide.origin ||
    !Number.isInteger(guide.port) ||
    !guide.station_script ||
    !guide.client_script
  )
    throw Error('Link 接入说明尚未就绪');
  const /* @chain-region linkAgentInstructions.literal | calls: JSON.stringify, String */ literal = (value) => JSON.stringify(String(value));
  const /* @chain-region linkAgentInstructions.wslPath | calls: test, value.0.toLowerCase, replaceAll, value.slice */ wslPath = (value) =>
    /^[A-Za-z]:[\\/]/.test(value || '')
      ? '/mnt/' + value[0].toLowerCase() + '/' + value.slice(3).replaceAll('\\', '/')
      : '';
  const /* @chain-region linkAgentInstructions.shellQuote | calls: value.replaceAll */ shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  return [
    'Aieyra Link · aieyra-office/1',
    '接入当前正在运行的办公室。使用本人真实 native 会话、独立私有 profile 与专属凭据；恢复时沿用本人 profile。',
    '办公室：' + guide.origin,
    '完整协议：' + guide.guide_url,
    'Agent API：' + guide.api_base,
    '原生 Python：' + (guide.python_executable || 'python'),
    ...(wslPath(guide.python_executable)
      ? [
          '',
          'WSL 可直接调用当前 Windows Python，以 Windows 侧的真实 loopback 访问办公室：',
          shellQuote(wslPath(guide.python_executable)) +
            ' -B -X utf8 -c ' +
            shellQuote(
              'import json,urllib.request; print(json.dumps(json.load(urllib.request.urlopen(' +
                JSON.stringify(guide.guide_url) +
                ')),ensure_ascii=False))',
            ),
          '接入脚本也用同一个 Windows Python 执行，station、client、root、profile 保持 Windows 路径。无需依赖 WSL 的 localhost 镜像。',
        ]
      : []),
    '',
    '先确认自己的宿主与原生会话 ID，然后用脚本所在操作系统的 Python 执行。Windows 路径请用 Windows Python。',
    '以下仅需填入本人名称、host 与 native；项目和端口已取自当前办公室。未知宿主用 generic。',
    'import json, subprocess, sys',
    'from pathlib import Path',
    `station = ${literal(guide.station_script)}`,
    `client = ${literal(guide.client_script)}`,
    'host = "generic"  # codex / claude / cursor / os / generic',
    'native = "<本人真实原生会话ID>"',
    'name = "<本人工位名称>"',
    `project = ${literal(project?.id || '<项目ID>')}`,
    `root = ${literal(project?.root || '<项目绝对工作目录>')}`,
    'profile = Path.home() / ".aieyra-link" / (host + "-" + native + ".json")',
    'base = [sys.executable, "-B", "-X", "utf8", station, "--profile", str(profile)]',
    'if profile.exists():',
    '    command = base + ["join", "--native-session-id", native, "--resume"]',
    'else:',
    `    command = base + ["create", "--name", name, "--project", project, "--root", root, "--host", host, "--native-session-id", native, "--port", ${literal(guide.port)}]`,
    'subprocess.run(command, check=True)',
    '',
    '已有本人 profile 请改成原路径，不另登记重复工位；创建结果未知时保留原参数，用 create --resume 回查恢复。',
    '从本人 profile 的 config_file 读取专属配置，经以下客户端调用 API：',
    'subprocess.run([sys.executable, "-B", "-X", "utf8", client, "--config", "<本人profile的config_file>", "call", "office/guide"], check=True)',
    '写调用：... call office/send --body-file <JSON文件>；正文包含本次 transport session_id 与 request_id。',
    '读取 registry、inbox、项目记忆后，按完整协议为自己的宿主安装 deliver 适配器；只向已有原生会话投递，不创建第二个模型执行器。',
    '先做 office/check 自收测试；实际阅读投递后，以本人令牌调用 office/ack，字段为 id、challenge、native_session_id（省略 receipt.endpoint）。',
    '与用户允许通信的工位双向验证；office/deliveries 查询原 request_id。queued/accepted 只表示已受理，不表示实际读到。结果未知不要换编号重投。',
    '结束：运行 base + ["finish", "--native-session-id", native]。不自动代写项目记忆或完成任务。',
    '127.0.0.1 只支持本机；异机先走 Link 设备配对，不复制他人工位/OS/模型 API Key。',
    '',
    '适配器协议：' + guide.adapter_contract,
    '验证要求：' + guide.verification,
  ].join('\n');
}

export /* @chain-region setupLinkAccessGuide | calls: fetch, navigator.clipboard.writeText, node, text, button.setAttribute, parent.append, dialog.setAttribute, heading.append … */ function setupLinkAccessGuide({
  parent,
  language = 'zh',
  fetchGuide = (signal) => fetch('/api/office/guide', { cache: 'no-store', signal }),
  copyText = (value) => navigator.clipboard.writeText(value),
}) {
  const english = language === 'en',
    /* @chain-region setupLinkAccessGuide.text */ text = (zh, en) => (english ? en : zh);
  const /* @chain-region setupLinkAccessGuide.node | calls: document.createElement */ node = (tag, value, cls) => {
    const el = document.createElement(tag);
    if (value !== undefined) el.textContent = value;
    if (cls) el.className = cls;
    return el;
  };
  const button = node('button', undefined, 'link-help-button');
  button.id = 'link-help';
  button.type = 'button';
  button.title = text('使用说明与 Agent 接入', 'Help and agent access');
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 11v6M12 7v1"/></svg>';
  parent.append(button);
  const dialog = node('dialog', undefined, 'link-access-guide');
  dialog.setAttribute('aria-labelledby', 'link-help-title');
  const heading = node('header', undefined, 'link-help-heading'),
    title = node('h2', text('使用说明与 Agent 接入', 'Help and agent access'));
  title.id = 'link-help-title';
  const close = node('button', text('关闭', 'Close'), 'link-guide-close');
  close.type = 'button';
  heading.append(title, close);
  dialog.append(heading);
  const status = node('p', '', 'link-guide-status');
  status.setAttribute('role', 'status');
  const actions = node('div', undefined, 'link-guide-actions'),
    select = node('select'),
    copy = node('button', text('复制给 Agent', 'Copy for agent')),
    retry = node('button', text('重新读取', 'Reload'));
  copy.id = 'link-guide-copy';
  select.setAttribute('aria-label', text('接入项目', 'Project'));
  copy.type = retry.type = 'button';
  actions.append(select, copy, retry);
  const pre = node('pre', '', 'link-guide-instructions');
  pre.tabIndex = 0;
  const contents=node('details',undefined,'link-guide-content');contents.append(node('summary',text('接入内容','Instructions')),pre);
  const credits = node('details', undefined, 'link-guide-content');
  credits.append(node('summary', text('头像素材署名', 'Portrait credits')),
    node('p', 'Viktor Hahn · Pixel Art Portraits · CC BY 4.0'),
    node('p', text('Aieyra 对角色图层、配色和眨眼、说话动画做了改编。', 'Aieyra adapted the layers, palettes, blink and speech frames.')),
    node('p', 'github.com/V-ktor/pixel-art-portraits · creativecommons.org/licenses/by/4.0/'));
  dialog.append(actions,status,contents,credits);
  document.body.append(dialog);
  let guide = null,
    epoch = 0,
    disposed = false,
    controller = null;
  const /* @chain-region setupLinkAccessGuide.paint | calls: linkAgentInstructions */ paint = () => {
    try {
      pre.textContent = linkAgentInstructions(guide, select.value);
      copy.disabled = false;
      status.textContent = '';
      retry.hidden = true;
    } catch (error) {
      copy.disabled = true;
      retry.hidden = false;
      status.textContent = error.message;
    }
  };
  /* @chain-region setupLinkAccessGuide.load | calls: controller.abort, AbortController, setTimeout, pending.abort, text, fetchGuide, Error, response.json … */ async function load() {
    controller?.abort();
    const pending = (controller = new AbortController()),
      timeout = setTimeout(() => pending.abort(), 8000);
    const revision = ++epoch;
    copy.disabled = true;
    retry.disabled = true;
    status.textContent = text('正在读取本机接入说明…', 'Reading local access instructions…');
    try {
      const response = await fetchGuide(pending.signal);
      if (!response.ok) throw Error('guide_unavailable');
      const value = await response.json();
      if (disposed || revision !== epoch || !dialog.open) return;
      guide = value;
      select.replaceChildren();
      for (const project of guide.projects || []) {
        const option = node('option', project.name || project.id);
        option.value = project.id;
        select.append(option);
      }
      select.hidden = !select.children.length;
      paint();
    } catch {
      if (!disposed && revision === epoch && dialog.open) {
        copy.disabled = true;
        retry.hidden = false;
        status.textContent = text(
          '接入说明暂时无法读取，请重新读取。',
          'Access instructions are unavailable. Try Reload.',
        );
      }
    } finally {
      clearTimeout(timeout);
      if (controller === pending) controller = null;
      if (!disposed && revision === epoch) retry.disabled = false;
    }
  }
  select.onchange = paint;
  retry.onclick = load;
  /* @chain-region setupLinkAccessGuide.close.onclick | calls: dialog.close */ close.onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    epoch++;
    controller?.abort();
    button.setAttribute('aria-expanded', 'false');
    retry.disabled = false;
    button.focus({ preventScroll: true });
  });
  /* @chain-region setupLinkAccessGuide.button.onclick | calls: dialog.showModal, button.setAttribute, load */ button.onclick = () => {
    if (dialog.open) return;
    dialog.showModal();
    button.setAttribute('aria-expanded', 'true');
    void load();
  };
  /* @chain-region setupLinkAccessGuide.copy.onclick | calls: copyText, text, pre.focus, document.createRange, range.selectNodeContents, removeAllRanges, getSelection, addRange */ copy.onclick = async () => {
    try {
      await copyText(pre.textContent);
      status.textContent = text(
        '已复制',
        'Copied',
      );
    } catch {
      contents.open = true;
      pre.focus({ preventScroll: true });
      const range = document.createRange();
      range.selectNodeContents(pre);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      status.textContent = text(
        '说明已选中，请按 Ctrl+C 复制。',
        'Instructions selected. Press Ctrl+C to copy.',
      );
    }
  };
  return {
    open: button.onclick,
    /* @chain-region setupLinkAccessGuide.dispose | calls: controller.abort, dialog.close, dialog.remove, button.remove */ dispose() {
      disposed = true;
      epoch++;
      controller?.abort();
      if (dialog.open) dialog.close();
      dialog.remove();
      button.remove();
    },
  };
}
