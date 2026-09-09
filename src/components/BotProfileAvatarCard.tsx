import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";

import { type Bot } from "@/state/store";
import { imageAttachmentFromFile } from "@/lib/composer-attachments";
import { cn } from "@/lib/cn";
import {
  PICKABLE_EXPRESSIONS,
  MAUS_COLORS,
  MAUS_COLOR_NAMES,
  normalizeState,
  type MausMotion,
  type MausState,
} from "@/lib/mascot";
import {
  BOT_AVATAR_CROPS,
  botAvatarUrlFromStoredPath,
  type BotAvatarCrop,
} from "../../shared/bot-avatar";
import { BotAvatar, MausAvatar } from "./Avatar";
import {
  automaticBotAppearance,
  BOT_PERSONALITIES,
  BOT_PERSONALITY_DETAILS,
} from "../../shared/bot-personality";

type AvatarPatch = Partial<
  Pick<Bot, "avatarCrop" | "avatarUrl" | "color" | "mascotExpression" | "personality">
>;

const CROP_LABEL = {
  mascot: "Mascot",
  circle: "Circle",
  rounded: "Rounded",
  square: "Square",
} satisfies Record<BotAvatarCrop, string>;

export function BotProfileAvatarCard({
  bot,
  activeState,
  mascotMotion,
  onPatch,
}: {
  bot: Bot;
  activeState: MausState;
  mascotMotion: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
  onPatch: (patch: AvatarPatch) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const crop = bot.avatarCrop ?? "mascot";
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const selectedExpression = normalizeState(bot.mascotExpression) ?? activeState;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const saved = await imageAttachmentFromFile(file);
      if (!saved) throw new Error("Choose a PNG, JPEG, GIF, or WebP image");
      const avatarUrl = botAvatarUrlFromStoredPath(saved.path);
      if (!avatarUrl) throw new Error("The uploaded image could not be used as an avatar");
      const latestCrop = cropRef.current;
      onPatch({ avatarUrl, avatarCrop: latestCrop === "mascot" ? "circle" : latestCrop });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeImage = () => {
    setError(null);
    onPatch({ avatarUrl: null, avatarCrop: "mascot" });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-hairline/40 bg-card">
      <div className="flex items-center justify-between border-b border-hairline/40 px-3 py-2.5">
        <span className="rounded-lg bg-control px-3 py-1.5 text-[14px] font-medium text-ink">Avatar</span>
        <button
          onClick={() => onPatch({ avatarCrop: "mascot", avatarUrl: null, ...automaticBotAppearance(crypto.randomUUID()) })}
          className="rounded-md px-2 py-1.5 text-[13px] text-ink-secondary hover:bg-control hover:text-ink"
        >
          Shuffle look
        </button>
      </div>

      <div className="p-3">
        <div className="flex justify-center py-3">
          <BotAvatar
            bot={bot}
            state={selectedExpression}
            size={112}
            motion={mascotMotion?.kind ?? "none"}
            motionKey={mascotMotion?.nonce ?? 0}
          />
        </div>

        <div className="mt-2 flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="sr-only"
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            Upload image
          </button>
          {bot.avatarUrl && (
            <button
              type="button"
              onClick={removeImage}
              disabled={uploading}
              aria-label="Remove custom avatar image"
              title="Remove custom image"
              className="flex size-10 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-danger disabled:opacity-50"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <div className="mt-1.5 text-[11.5px] text-ink-secondary">PNG, JPEG, GIF, or WebP · up to 10 MB</div>

        <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
          Shape
        </div>
        <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-hairline/40">
          {BOT_AVATAR_CROPS.map((candidate, index) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={crop === candidate}
              onClick={() => onPatch({ avatarCrop: candidate })}
              className={cn(
                "py-1.5 text-[12.5px]",
                index > 0 && "border-l border-hairline/40",
                crop === candidate ? "bg-control text-ink" : "text-ink-secondary hover:bg-control/60 hover:text-ink",
              )}
            >
              {CROP_LABEL[candidate]}
            </button>
          ))}
        </div>

        {crop === "mascot" && (
          <>
            <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
              Motion personality
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {BOT_PERSONALITIES.map((personality) => {
                const details = BOT_PERSONALITY_DETAILS[personality];
                const selected = (bot.personality ?? "friendly") === personality;
                return (
                  <button
                    key={personality}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onPatch({ personality })}
                    className={cn(
                      "min-h-[58px] rounded-xl bg-inset px-2.5 py-2 text-left transition-colors hover:bg-control",
                      selected && "ring-2 ring-accent-border",
                    )}
                  >
                    <span className="block text-[12.5px] font-semibold text-ink">{details.label}</span>
                    <span className="mt-0.5 block text-[10.5px] leading-tight text-ink-secondary">{details.description}</span>
                  </button>
                );
              })}
            </div>

            <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
              Expression
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {PICKABLE_EXPRESSIONS.map(({ state: expression, label }) => (
                <button
                  key={expression}
                  type="button"
                  aria-pressed={selectedExpression === expression}
                  onClick={() => onPatch({ mascotExpression: expression })}
                  className={cn(
                    "flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl bg-inset px-1 transition-colors hover:bg-control",
                    selectedExpression === expression && "ring-2 ring-accent-border",
                  )}
                  title={label}
                  aria-label={`Use ${label.toLowerCase()} expression`}
                >
                  <MausAvatar color={bot.color} state={expression} size={40} animated={false} />
                  <span className="max-w-full truncate text-[10px] font-medium text-ink-secondary">{label}</span>
                </button>
              ))}
            </div>

            <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
              Color
            </div>
            <div className="flex flex-wrap gap-2.5">
              {MAUS_COLOR_NAMES.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-pressed={bot.color === color}
                  onClick={() => onPatch({ color })}
                  className={cn(
                    "size-10 rounded-full border-2 border-transparent transition-transform hover:scale-110",
                    bot.color === color && "ring-2 ring-accent-border ring-offset-2 ring-offset-card",
                  )}
                  style={{ backgroundColor: MAUS_COLORS[color] }}
                  title={color}
                  aria-label={`Use ${color} mascot color`}
                />
              ))}
            </div>
          </>
        )}

        {error && <div role="alert" className="mt-3 text-[12px] text-danger">{error}</div>}
      </div>
    </div>
  );
}
