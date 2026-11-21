// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Halo/official/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: COUNT; pulsarBurst
// Impact: python -B scripts/code-atlas.py show Halo/official/pulsar-burst.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 脉冲星换形态（用户 2026-10-16 夜）：Eyra 从一个位置“散开”，在新位置“聚拢”成形。
// 起点：一圈细环向外扩散，十几颗光点沿径向飞散并淡出；终点：光点从四周飞回圆心，最后放出一圈脉冲环。
// 只用一个固定在顶层、不接收指针的覆盖层，WAAPI 驱动，结束即移除；减少动态效果时什么都不做。
const COUNT = 14;
export function pulsarBurst(doc, from, to, { reduced = false, duration = 640, ringDuration, animateUI, motionAllowed, motionDuration } = {}) {
  if (reduced || !motionAllowed(doc) || !from?.width || !to?.width || !doc.body.animate) return Object.assign(() => {}, { finished: Promise.resolve() });
  const layer = doc.createElement('div');
  layer.className = 'pulsar-layer';
  layer.setAttribute('aria-hidden', 'true');
  doc.body.append(layer);
  const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 });
  const a = center(from),
    b = center(to);
  const anims = [];
  const ring = (c, delay, grow) => {
    const n = doc.createElement('i');
    n.className = 'pulsar-ring';
    Object.assign(n.style, { left: c.x - c.r + 'px', top: c.y - c.r + 'px', width: c.r * 2 + 'px', height: c.r * 2 + 'px' });
    layer.append(n);
    anims.push(animateUI(n,[{ opacity: 0.85, scale: grow ? 0.86 : 1 }, { opacity: 0, scale: grow ? 1.36 : 1.5 }], { duration: ringDuration ?? motionDuration(n,'move'), delay, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'both' }));
  };
  ring(a, 0, false);
  for (let i = 0; i < COUNT; i++) {
    const angle = (i / COUNT) * Math.PI * 2 + (i % 2) * 0.22,
      spread = a.r * (1.25 + (i % 3) * 0.22),
      gather = b.r * (1.5 + ((i + 1) % 3) * 0.25),
      size = 2 + (i % 3);
    const dot = doc.createElement('i');
    dot.className = 'pulsar-dot';
    Object.assign(dot.style, { width: size + 'px', height: size + 'px', left: -size / 2 + 'px', top: -size / 2 + 'px' });
    layer.append(dot);
    const out = { x: a.x + Math.cos(angle) * spread, y: a.y + Math.sin(angle) * spread },
      back = { x: b.x + Math.cos(angle + 0.5) * gather, y: b.y + Math.sin(angle + 0.5) * gather };
    const at = (p) => `translate(${p.x}px, ${p.y}px)`;
    anims.push(
      animateUI(dot,
        [
          { transform: at(a), opacity: 0 },
          { transform: at(a), opacity: 1, offset: 0.06 },
          { transform: at(out), opacity: 0.9, offset: 0.36, easing: 'cubic-bezier(.4,0,.6,1)' },
          { transform: at(back), opacity: 0.9, offset: 0.7, easing: 'cubic-bezier(.3,.7,.3,1)' },
          { transform: at(b), opacity: 0 },
        ],
        { duration, delay: (i % 4) * 14, fill: 'both' },
      ),
    );
  }
  ring(b, duration * 0.78, true);
  const finished = Promise.allSettled(anims.filter(Boolean).map((x) => x.finished)).then(() => layer.remove());
  const cancel = () => {
    for (const x of anims) x?.cancel();
    layer.remove();
  };
  return Object.assign(cancel, { finished });
}
