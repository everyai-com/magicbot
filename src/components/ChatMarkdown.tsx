// Real markdown for bot bubbles: react-markdown + GFM (tables, task lists,
// strikethrough, autolinks) with a chromed code block — language label, copy
// button, lazy Shiki highlighting. Model output never reaches the DOM as raw
// HTML: no rehype-raw, so HTML in the text renders as text; Shiki's output is
// generator-escaped. While a message is still streaming, a code block renders
// as plain <pre> until its content has held still for STREAM_SETTLE_MS (the
// fence is very likely complete), then highlights and caches — so the settled
// bubble, a fresh component instance, mounts straight from cache instead of
// popping from plain to highlighted.
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BarChart3, Check, Copy } from "lucide-react";

// tiny highlight cache so revisiting a thread doesn't re-tokenize settled
// blocks; keys are content-hashed and capped. Streamed partials may land here
// under their own hash — harmless (never collides with the final content's
// key, and the cap evicts it), and the final content's entry is exactly what
// makes the settled bubble render highlighted on mount.
const highlightCache = new Map<string, string>();
const CACHE_MAX = 200;
// how long a streaming block's content must be unchanged before we spend a
// tokenize on it — long enough to skip per-token churn mid-fence, short
// enough that the highlight lands before the stream settles
const STREAM_SETTLE_MS = 250;
const hash = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};

type ChartDatum = { label: string; value: number };
type ChartSpec = { type?: "bar" | "line"; title?: string; unit?: string; data: ChartDatum[] };

function chartSpec(code: string): ChartSpec | null {
  try {
    const raw = JSON.parse(code) as Partial<ChartSpec>;
    if (!Array.isArray(raw.data) || raw.data.length < 2 || raw.data.length > 40) return null;
    const data = raw.data.map((item) => ({ label: String(item?.label ?? "").slice(0, 80), value: Number(item?.value) }));
    if (data.some((item) => !item.label || !Number.isFinite(item.value))) return null;
    return {
      type: raw.type === "line" ? "line" : "bar",
      title: typeof raw.title === "string" ? raw.title.slice(0, 160) : undefined,
      unit: typeof raw.unit === "string" ? raw.unit.slice(0, 24) : undefined,
      data,
    };
  } catch {
    return null;
  }
}

function ChartBlock({ code }: { code: string }) {
  const spec = chartSpec(code);
  if (!spec) return <CodeBlock code={code} lang="json" streaming={false} />;
  const values = spec.data.map((item) => item.value);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const range = maximum - minimum || 1;
  const points = spec.data.map((item, index) => {
    const x = 28 + (index / Math.max(1, spec.data.length - 1)) * 504;
    const y = 186 - ((item.value - minimum) / range) * 148;
    return `${x},${y}`;
  }).join(" ");

  return (
    <figure className="structured-chart my-2 overflow-hidden rounded-xl border border-hairline/35 bg-inset">
      <figcaption className="flex items-center gap-2 border-b border-hairline/30 px-3 py-2">
        <BarChart3 size={14} className="text-accent" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{spec.title || "Chart"}</span>
        <span className="text-[10.5px] uppercase tracking-wide text-ink-secondary">{spec.type}</span>
      </figcaption>
      {spec.type === "line" ? (
        <div className="px-2 py-3">
          <svg viewBox="0 0 560 220" role="img" aria-label={spec.title || "Line chart"} className="h-auto w-full overflow-visible">
            <line x1="28" y1="186" x2="532" y2="186" className="chart-axis" />
            <polyline points={points} className="chart-line" />
            {spec.data.map((item, index) => {
              const [x, y] = points.split(" ")[index].split(",").map(Number);
              return <circle key={`${item.label}-${index}`} cx={x} cy={y} r="4" className="chart-point"><title>{`${item.label}: ${item.value}${spec.unit ?? ""}`}</title></circle>;
            })}
            {spec.data.map((item, index) => {
              if (spec.data.length > 12 && index % Math.ceil(spec.data.length / 8) !== 0 && index !== spec.data.length - 1) return null;
              const x = 28 + (index / Math.max(1, spec.data.length - 1)) * 504;
              return <text key={`${item.label}-label`} x={x} y="208" textAnchor="middle" className="chart-label">{item.label.slice(0, 12)}</text>;
            })}
          </svg>
        </div>
      ) : (
        <div className="chart-bars grid gap-2.5 px-3 py-3">
          {spec.data.map((item) => (
            <div key={item.label} className="grid grid-cols-[minmax(5rem,0.7fr)_minmax(7rem,2fr)_auto] items-center gap-2 text-[11.5px]">
              <span className="truncate text-ink-secondary" title={item.label}>{item.label}</span>
              <span className="h-2 overflow-hidden rounded-sm bg-control"><span className="block h-full origin-left bg-accent" style={{ transform: `scaleX(${Math.max(0.02, (item.value - minimum) / range)})` }} /></span>
              <span className="min-w-12 text-right font-mono tabular-nums text-ink">{item.value}{spec.unit ?? ""}</span>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}

function MarkdownTable({ children }: { children?: ReactNode }) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const rows = Array.from(tableRef.current?.rows ?? []).map((row) =>
      Array.from(row.cells).map((cell) => cell.innerText.replace(/\s+/g, " ").trim()).join("\t"),
    );
    void navigator.clipboard?.writeText(rows.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="group/table my-2 overflow-hidden rounded-lg border border-hairline/35 bg-inset">
      <div className="flex items-center justify-between border-b border-hairline/25 px-2.5 py-1 text-[10.5px] uppercase tracking-wide text-ink-secondary">
        <span>Table</span>
        <button type="button" onClick={copy} className="rounded p-1 hover:bg-raised hover:text-ink" title="Copy table">
          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
        </button>
      </div>
      <div className="max-h-[28rem] overflow-auto">
        <table ref={tableRef} className="structured-table w-full border-collapse text-[13.5px]">{children}</table>
      </div>
    </div>
  );
}

function CodeBlock({ code, lang, streaming }: { code: string; lang: string; streaming: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const key = `${lang}:${hash(code)}`;
    const cached = highlightCache.get(key);
    if (cached) return setHtml(cached);
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const highlight = () => {
      import("shiki")
        .then((shiki) =>
          shiki.codeToHtml(code, {
            lang: lang || "text",
            theme: "github-dark-default",
          }),
        )
        .then((out) => {
          if (!alive) return;
          if (highlightCache.size >= CACHE_MAX) {
            const first = highlightCache.keys().next().value;
            if (first) highlightCache.delete(first);
          }
          highlightCache.set(key, out);
          setHtml(out);
        })
        .catch(() => {
          /* unknown language or shiki failed — the plain <pre> stays */
        });
    };
    if (streaming) {
      // any earlier highlight is of a shorter snapshot — drop it so the
      // growing plain <pre> shows the real content, then wait for the block
      // to hold still. The effect re-runs (and this cleanup clears the timer)
      // on every content change, which is the debounce.
      setHtml(null);
      timer = setTimeout(highlight, STREAM_SETTLE_MS);
    } else {
      highlight();
    }
    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [code, lang, streaming]);

  const copy = () => {
    void navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-hairline/40 bg-inset">
      <div className="flex items-center justify-between border-b border-hairline/30 px-3 py-1">
        <span className="text-[11px] uppercase tracking-wide text-ink-secondary">{lang || "code"}</span>
        <button
          onClick={copy}
          className="rounded p-1 text-ink-secondary hover:bg-raised hover:text-ink"
          title="Copy code"
        >
          {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
        </button>
      </div>
      {html ? (
        <div
          className="overflow-x-auto text-[13px] leading-relaxed [&_pre]:!bg-transparent [&_pre]:m-0 [&_pre]:p-3"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed text-ink">{code}</pre>
      )}
    </div>
  );
}

// Spoiler spans: GFM parses ~~text~~ to <del>; in bot messages that content
// is usually a spoiler (answers, plot points, surprises), not a deletion —
// hide it behind a tap-to-reveal chip instead of striking it through.
// Display only: the stored markdown, exports, and the model's own context
// all keep the raw ~~text~~.
function Spoiler({ children }: { children?: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  if (!revealed) {
    return (
      <span className="relative mx-px inline-block rounded px-1 py-px">
        <span
          aria-hidden="true"
          className="pointer-events-none select-none bg-raised text-transparent [&_*]:!text-transparent [&_a]:!no-underline"
        >
          {children}
        </span>
        <button
          type="button"
          aria-label="Reveal spoiler"
          title="Reveal spoiler"
          onClick={() => setRevealed(true)}
          className="absolute inset-0 rounded bg-raised/90"
        />
      </span>
    );
  }
  return (
    <span className="mx-px inline rounded px-1 py-px text-[13px] leading-relaxed text-ink underline decoration-dotted decoration-hairline underline-offset-2">
      {children}
      <button
        type="button"
        aria-label="Hide spoiler"
        title="Hide spoiler"
        onClick={() => setRevealed(false)}
        className="ml-1 rounded px-0.5 text-[11px] text-ink-secondary hover:text-ink"
      >
        Hide
      </button>
    </span>
  );
}

function ChatMarkdownComponent({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div className="chat-md min-w-0 [&>*+*]:mt-2">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }: { children?: ReactNode }) {
            // fenced code arrives as <pre><code class="language-x">…</code></pre>
            const child: any = Array.isArray(children) ? children[0] : children;
            const className: string = child?.props?.className ?? "";
            const lang = /language-([\w-]+)/.exec(className)?.[1] ?? "";
            // children can be a string OR an array of strings/nodes — flatten
            // strings only, so String() never comma-joins an array
            const flat = (n: any): string =>
              typeof n === "string" ? n : Array.isArray(n) ? n.map(flat).join("") : (n?.props?.children ? flat(n.props.children) : "");
            const code = flat(child?.props?.children).replace(/\n$/, "");
            if (lang === "chart" && !streaming) return <ChartBlock code={code} />;
            return <CodeBlock code={code} lang={lang} streaming={streaming} />;
          },
          img({ src, alt }: { src?: string; alt?: string }) {
            return (
              <img
                src={src}
                alt={alt ?? ""}
                loading="lazy"
                className="max-h-96 max-w-full rounded-lg border border-hairline/30"
              />
            );
          },
          code({ children }: { children?: ReactNode }) {
            return (
              <code className="rounded bg-inset px-1 py-px text-[13px]">{children}</code>
            );
          },
          a({ href, children }: { href?: string; children?: ReactNode }) {
            const citation = typeof children === "string" && /^\d{1,3}$/.test(children.trim());
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className={citation
                  ? "mx-0.5 inline-flex min-w-4 -translate-y-0.5 items-center justify-center rounded-[4px] bg-accent/12 px-1 font-mono text-[9px] font-semibold leading-4 text-accent-text no-underline hover:bg-accent/20"
                  : "break-words text-accent underline decoration-accent/40 hover:decoration-accent"}
              >
                {children}
              </a>
            );
          },
          table({ children }: { children?: ReactNode }) {
            return <MarkdownTable>{children}</MarkdownTable>;
          },
          th({ children }: { children?: ReactNode }) {
            return (
              <th className="sticky top-0 z-[1] border-b border-hairline/40 bg-panel px-2.5 py-2 text-left text-[11.5px] font-semibold text-ink">{children}</th>
            );
          },
          td({ children }: { children?: ReactNode }) {
            return <td className="border-b border-hairline/20 px-2.5 py-2 align-top tabular-nums">{children}</td>;
          },
          ul({ children }: { children?: ReactNode }) {
            return <ul className="list-disc space-y-1 pl-5">{children}</ul>;
          },
          ol({ children }: { children?: ReactNode }) {
            return <ol className="list-decimal space-y-1 pl-5">{children}</ol>;
          },
          h1({ children }: { children?: ReactNode }) {
            return <div className="mt-2 text-[16px] font-semibold">{children}</div>;
          },
          h2({ children }: { children?: ReactNode }) {
            return <div className="mt-2 text-[15.5px] font-semibold">{children}</div>;
          },
          h3({ children }: { children?: ReactNode }) {
            return <div className="mt-1.5 font-semibold">{children}</div>;
          },
          h4({ children }: { children?: ReactNode }) {
            return <div className="mt-1.5 font-semibold">{children}</div>;
          },
          h5({ children }: { children?: ReactNode }) {
            return <div className="mt-1.5 text-[14px] font-semibold">{children}</div>;
          },
          h6({ children }: { children?: ReactNode }) {
            return <div className="mt-1.5 text-[13.5px] font-semibold text-ink-secondary">{children}</div>;
          },
          blockquote({ children }: { children?: ReactNode }) {
            return (
              <blockquote className="border-l-2 border-hairline pl-3 text-ink-secondary">{children}</blockquote>
            );
          },
          del({ children }: { children?: ReactNode }) {
            return <Spoiler>{children}</Spoiler>;
          },
          hr() {
            return <hr className="border-hairline/40" />;
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

export const ChatMarkdown = memo(ChatMarkdownComponent);
