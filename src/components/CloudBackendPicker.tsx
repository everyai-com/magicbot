// The Cloudflare / Self-hosted VPS segmented control shown under "Runs on"
// picker whenever a bot can end up on a cloud computer. One component, two
// homes (ComputerPanel and SettingsPanel), so the copy and the disabled
// rules can never drift apart.
import type { CloudBackend } from "../../server/contracts.ts";
import { cn } from "@/lib/cn";

export function CloudBackendPicker({
  value,
  vpsSupported,
  onChange,
}: {
  value: CloudBackend;
  vpsSupported: boolean;
  onChange: (backend: CloudBackend) => void;
}) {
  // "box" can arrive for one render while an older persisted bot is being
  // migrated by the server. Never offer the retired backend in the product.
  const selected = value === "box" ? "cloudflare" : value;
  return (
    <div className="mt-3 rounded-lg bg-inset p-3">
      <div className="text-[12px] font-medium text-ink">Cloud backend</div>
      <div className="mt-0.5 text-[11.5px] text-ink-secondary">
        {selected === "vps"
          ? "Auto only attaches to a VPS container that is already running — a stopped or missing one is never provisioned or started, and the bot quietly works as if no cloud computer existed. Choose Cloud to provision or start it. No interactive desktop tunnel is exposed."
          : "Cloudflare gives this bot a persistent headless Linux Sandbox. It supports shell, code, and files, but not a visual desktop."}
      </div>
      <div className="mt-2 flex overflow-hidden rounded-lg border border-hairline/40">
        {(["cloudflare", "vps"] as const).map((backend, i) => {
          const disabled = !vpsSupported;
          return (
            <button
              key={backend}
              disabled={disabled}
              title={disabled ? "This backend requires Claude or an ACP engine" : undefined}
              onClick={() => onChange(backend)}
              className={cn(
                "flex-1 py-1.5 text-[12px]",
                i > 0 && "border-l border-hairline/40",
                disabled && "cursor-not-allowed opacity-40",
                selected === backend ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
              )}
            >
              {backend === "vps" ? "Self-hosted VPS" : "Cloudflare"}
            </button>
          );
        })}
      </div>
    </div>
  );
}
