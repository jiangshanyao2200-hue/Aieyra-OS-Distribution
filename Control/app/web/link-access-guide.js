// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Control/app/web/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: linkAgentInstructions; setupLinkAccessGuide
// Impact: python -B scripts/code-atlas.py show Control/app/web/link-access-guide.js
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

export function linkAgentInstructions(guide, projectId) {
  const project = guide.projects?.find((p) => p.id === projectId && p.root) || guide.projects?.find((p) => p.root);
  if (
    guide.protocol !== 'aieyra-office/1' ||
    !guide.origin ||
    !Number.isInteger(guide.port) ||
    !guide.station_script ||
    !guide.client_script
  )
    throw Error('Link 接入说明尚未就绪');
  const literal = (value) => JSON.stringify(String(value));
  const wslPath = (value) =>
    /^[A-Za-z]:[\\/]/.test(value || '')
      ? '/mnt/' + value[0].toLowerCase() + '/' + value.slice(3).replaceAll('\\', '/')
      : '';
  const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  return [
    'Aieyra Link · aieyra-office/1',
    '接入用户当前办公室，沿用本人的原生 Agent 会话。先查本人已有 profile 并恢复；首次接入再登记本人名称、宿主和真实 native ID。',
    '办公室：' + guide.origin,
    '协议与完整操作目录：' + guide.guide_url,
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
    '按以下最小示例连接，在脚本所在系统运行 Python；Windows 路径使用上面列出的 Windows Python。',
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

export function setupLinkAccessGuide({
  button,
  status,
  fallback,
  project = () => undefined,
  language = 'zh',
  fetchGuide = (signal) => fetch('/api/office/guide', { cache: 'no-store', signal }),
}) {
  const text = (zh, en) => language === 'en' ? en : zh;
  const field = fallback.querySelector('textarea');
  let guide, controller, loading, disposed = false, copying = false;

  async function load() {
    if (controller || disposed) return;
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 8000);
    button.setAttribute('aria-busy', 'true');
    try {
      const response = await fetchGuide(controller.signal);
      if (!response.ok) throw Error('guide_unavailable');
      const value = await response.json();
      linkAgentInstructions(value, project());
      if (!disposed) guide = value;
    } catch {
      if (!disposed)
        status.textContent = text('接入说明暂不可用', 'Access instructions unavailable');
    } finally {
      clearTimeout(timeout);
      controller = null;
      if (!disposed) button.removeAttribute('aria-busy');
    }
  }

  button.onclick = async () => {
    if (disposed || copying) return;
    copying = true;
    if (!guide) {
      status.textContent = text('正在读取接入说明…', 'Loading access instructions…');
      if (!controller) loading = load();
      await loading;
      if (!guide || disposed) { copying = false; return; }
    }
    const instructions = linkAgentInstructions(guide, project());
    let copied = false;
    try {
      await navigator.clipboard.writeText(instructions);
      copied = true;
    } catch {
      if (disposed) return;
      fallback.hidden = false;
      field.value = instructions;
      field.focus();
      field.select();
      try { copied = field.ownerDocument.execCommand('copy'); } catch {}
    } finally {
      copying = false;
    }
    if (disposed) return;
    if (copied && !fallback.hidden) {
      fallback.hidden = true;
      button.focus();
    }
    status.textContent = copied ? text('已复制', 'Copied') : text('自动复制受限，接入信息已选中', 'Access instructions selected');
  };
  fallback.querySelector('button').onclick = () => { fallback.hidden = true; button.focus(); };
  loading = load();
  return {
    dispose() {
      disposed = true;
      controller?.abort();
    },
  };
}
