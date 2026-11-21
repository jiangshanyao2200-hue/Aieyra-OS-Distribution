import { useRef, useState } from "react";
import { ChevronRight, Copy, MoveRight } from "lucide-react";
import { MenuItem } from "./ui";
export function ProjectTransferMenu({ projects, sourceId, onTransfer }: { projects: { id: string; name: string; kind?: string }[]; sourceId: string; onTransfer: (id: string, mode: "copy" | "move") => void }) {
  const [mode, setMode] = useState<"copy" | "move" | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  function open(value: "copy" | "move") {
    const rect = host.current?.getBoundingClientRect();
    if (rect) setPosition({ left: rect.right + 225 > innerWidth ? Math.max(8, rect.left - 218) : rect.right - 2, top: Math.max(8, Math.min(rect.top, innerHeight - 350)) });
    setMode(value);
  }
  const targets = projects.filter(project => project.id !== sourceId && ["agent", "image", "writing"].includes(project.kind || "image"));
  return <div ref={host} className="project-transfer-menu" onMouseLeave={() => setMode(null)}>
    {(["copy", "move"] as const).map(value => <div key={value} className="project-transfer-branch" onMouseEnter={() => open(value)}>
      <MenuItem icon={value === "copy" ? <Copy size={14} /> : <MoveRight size={14} />} disabled={!targets.length} onFocus={() => open(value)} onClick={() => open(value)} onKeyDown={event => {
        if (event.key === "ArrowRight") { event.preventDefault(); open(value); requestAnimationFrame(() => host.current?.querySelector<HTMLButtonElement>(".project-transfer-targets button")?.focus()); }
        if (event.key === "ArrowLeft") { event.preventDefault(); setMode(null); }
      }} aria-haspopup="menu" aria-expanded={mode === value}>{value === "copy" ? "复制到" : "移动到"}<ChevronRight size={12} /></MenuItem>
      {mode === value && targets.length ? <div className="project-transfer-targets" style={position} role="menu" aria-label={value === "copy" ? "复制到项目" : "移动到项目"}>{targets.map(project => <MenuItem key={project.id} data-transfer-project={project.id} title={project.name} onClick={() => onTransfer(project.id, value)}><span>{project.name}</span><small>{project.kind === "agent" ? "画布助手 · 引用" : project.kind === "writing" ? "写作" : "绘画"}</small></MenuItem>)}</div> : null}
    </div>)}
  </div>;
}
