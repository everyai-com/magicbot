import { useEffect, useRef, useState } from "react";
import { Database, FileText, RefreshCw, Trash2 } from "lucide-react";
import { api, type Bot } from "@/state/store";

type Source = { id: string; label: string; source_type: string; scope_type: string; scope_id: string; status: string; item_count: number; last_error?: string | null };
type Tool = { name: string; description?: string; parameters?: Record<string, unknown> };

export function ContextSourcesCard({ bot }: { bot: Bot }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [tool, setTool] = useState("");
  const [args, setArgs] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [sourceResult, toolResult] = await Promise.all([
      api("/api/context/sources") as Promise<{ sources: Source[] }>,
      api("/api/context/tools") as Promise<{ tools: Tool[] }>,
    ]);
    setSources((sourceResult.sources ?? []).filter((source) => source.scope_type === "bot" && source.scope_id === bot.id));
    setTools(toolResult.tools ?? []);
  };
  useEffect(() => { void load().catch(() => undefined); }, []);

  const addFile = async (file: File) => {
    setBusy(true); setError(null);
    try {
      const uploaded = await api(`/api/file-attachments?name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "content-type": file.type || "text/plain" }, body: file }) as { path: string };
      const attachmentId = uploaded.path.split("/").pop();
      await api("/api/context/sources", { method: "POST", body: JSON.stringify({ sourceType: "attachment", attachmentId, label: file.name, scopeType: "bot", scopeId: bot.id }) });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  };

  const addConnector = async () => {
    setBusy(true); setError(null);
    try {
      const parsed = JSON.parse(args) as Record<string, unknown>;
      const lower = tool.toLowerCase();
      const sourceType = lower.includes("github") ? "github" : lower.includes("gmail") || lower.includes("email") ? "email" : "connector";
      await api("/api/context/sources", { method: "POST", body: JSON.stringify({ sourceType, connectorTool: tool, arguments: parsed, label: tool.replaceAll("_", " "), scopeType: "bot", scopeId: bot.id }) });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  return (
    <section className="rounded-xl bg-card p-4">
      <div className="flex items-start gap-3"><Database size={18} className="mt-0.5 text-accent" /><div><h3 className="text-[15px] font-medium text-ink">Knowledge sources</h3><p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-secondary">Index selected files or read-only connected-app results for this bot.</p></div></div>
      <div className="mt-3 flex flex-col gap-2">
        <input ref={inputRef} type="file" className="hidden" accept=".txt,.md,.markdown,.json,.csv,.tsv,.xml,.yaml,.yml,text/*,application/json" onChange={(event) => event.target.files?.[0] && void addFile(event.target.files[0])} />
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-control px-3 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"><FileText size={15} />Add text file</button>
        {tools.length > 0 && <>
          <select value={tool} onChange={(event) => setTool(event.target.value)} className="min-h-10 w-full rounded-lg border border-hairline/40 bg-inset px-3 text-[12px] text-ink"><option value="">Choose a read-only app action…</option>{tools.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select>
          {tool && <textarea value={args} onChange={(event) => setArgs(event.target.value)} aria-label="Connected app query arguments" className="min-h-20 w-full resize-y rounded-lg border border-hairline/40 bg-inset p-3 font-mono text-[11px] text-ink" />}
          <button type="button" disabled={busy || !tool} onClick={() => void addConnector()} className="min-h-10 rounded-lg bg-control px-3 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50">Add connected source</button>
        </>}
      </div>
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
      {sources.length > 0 && <div className="mt-3 divide-y divide-hairline/30 border-t border-hairline/30">{sources.filter((source) => source.label).map((source) => <div key={source.id} className="flex min-w-0 items-center gap-2 py-2"><div className="min-w-0 flex-1"><div className="truncate text-[12.5px] text-ink">{source.label}</div><div className="text-[10.5px] text-ink-secondary">{source.status} · {source.item_count} chunks{source.last_error ? ` · ${source.last_error}` : ""}</div></div><button aria-label={`Refresh ${source.label}`} className="flex size-10 items-center justify-center rounded-lg text-ink-secondary hover:bg-control" onClick={() => void api(`/api/context/sources/${source.id}/refresh`, { method: "POST" }).then(load)}><RefreshCw size={14} /></button><button aria-label={`Remove ${source.label}`} className="flex size-10 items-center justify-center rounded-lg text-ink-secondary hover:bg-danger/10 hover:text-danger" onClick={() => void api(`/api/context/sources/${source.id}`, { method: "DELETE" }).then(load)}><Trash2 size={14} /></button></div>)}</div>}
    </section>
  );
}
