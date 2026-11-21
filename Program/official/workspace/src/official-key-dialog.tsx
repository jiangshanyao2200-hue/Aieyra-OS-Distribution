import { useEffect, useRef, useState } from "react";
import { Check, Search } from "./studio-icons";
import { KeyRound, RefreshCw } from "./studio-icons-lazy";
import type { OfficialTokenMeta } from "./core";
import { ActionButton, DialogShell, IconActionButton, InlineNotice, SearchField, SurfaceBody, SurfaceFooter, SurfaceHeader } from "./ui";

export default function OfficialKeyDialog({ tokens: initialTokens, selectedIds, onConfirm, onClose }: {
  tokens: OfficialTokenMeta[];
  selectedIds: string[];
  onConfirm: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [tokens, setTokens] = useState(initialTokens);
  const [selected, setSelected] = useState(selectedIds);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const selectAll = useRef<HTMLInputElement>(null);
  const usable = tokens.filter((token) => token.usable);
  const allChecked = usable.length > 0 && usable.every((token) => selected.includes(token.id));
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = !allChecked && selected.length > 0;
  }, [allChecked, selected]);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const result = await window.aieyraServer?.officialTokens({ forceRefresh: true });
      if (!mounted.current) return;
      if (!result?.ok) throw new Error(result?.error || "Key 列表获取失败");
      setTokens(result.tokens || []);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, []);

  const validSelected = selected.filter((id) => usable.some((token) => token.id === id));
  return <DialogShell surface="official-keys" className="official-key-dialog" ariaLabel="管理 Key" layerLevel="nested" onRequestClose={onClose}>
    <SurfaceHeader title="管理 Key" onClose={onClose} closeLabel="关闭 Key 列表" />
    <SurfaceBody className="official-key-body">
      <div className="official-key-search">
        <SearchField label="搜索 Key" icon={<Search size={15} />} inputProps={{ value: query, placeholder: "搜索 Key", onChange: (event) => setQuery(event.target.value) }} />
        <IconActionButton label="刷新 Key 列表" title="刷新 Key 列表" icon={<RefreshCw size={16} className={loading ? "spin" : ""} />} disabled={loading} onClick={() => void refresh()} />
      </div>
      <div className="official-key-list-heading">
        <label><input ref={selectAll} type="checkbox" checked={allChecked} disabled={loading || !usable.length} onChange={() => setSelected(allChecked ? [] : usable.map((token) => token.id))} />选择全部 Key</label>
        <span aria-live="polite">已选 {validSelected.length} / {usable.length}</span>
      </div>
      <div className="official-key-list" aria-busy={loading}>
        {tokens.filter((token) => `${token.name} ${token.id}`.toLowerCase().includes(query.toLowerCase().trim())).map((token) => <label key={token.id} className={`official-key-row${selected.includes(token.id) ? " is-selected" : ""}${token.usable ? "" : " is-unavailable"}`}>
          <input type="checkbox" aria-label={`选择 Key ${token.name}`} checked={selected.includes(token.id)} disabled={loading || (!token.usable && !selected.includes(token.id))} onChange={() => setSelected((current) => current.includes(token.id) ? current.filter((id) => id !== token.id) : [...current, token.id])} />
          <span className="official-key-symbol"><KeyRound size={18} /></span>
          <span className="official-key-copy"><strong>{token.name}</strong><small>{token.unlimitedQuota ? "不限额度" : "按 Key 额度计费"}</small></span>
          <span className={`official-key-status${token.usable ? " is-ready" : ""}`}>{token.usable ? "可用" : token.status === "expired" ? "已过期" : token.status === "exhausted" ? "额度不足" : "已停用"}</span>
        </label>)}
        {!tokens.length ? <p className="connection-model-empty">{loading ? "正在获取 Key" : "暂无 Key"}</p> : null}
        {tokens.length > 0 && !tokens.some((token) => `${token.name} ${token.id}`.toLowerCase().includes(query.toLowerCase().trim())) ? <p className="connection-model-empty">没有匹配的 Key</p> : null}
      </div>
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
    </SurfaceBody>
    <SurfaceFooter>
      <ActionButton onClick={onClose}>取消</ActionButton>
      <ActionButton variant="primary" icon={<Check size={16} />} disabled={loading || !validSelected.length} onClick={() => onConfirm(validSelected)}>确定</ActionButton>
    </SurfaceFooter>
  </DialogShell>;
}
