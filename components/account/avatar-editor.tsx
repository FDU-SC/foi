"use client";

import {
  startTransition,
  useActionState,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  removeAvatarAction,
  updateAvatarAction,
  type SettingsState,
} from "@/app/(site)/settings/actions";
import { FormMessage } from "@/components/form";
import { Avatar, type AvatarSize, type AvatarSubject } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AVATAR_LIMITS } from "@/lib/accounts/avatar";
import { cn } from "@/lib/utils";
import { AvatarCropper } from "./avatar-cropper";
import { ACCEPTED_TYPES, sourceRejection } from "./encode";

/**
 * One result for two actions. They stay separate on the server — each has its
 * own gate and its own budget — but a single state is what stops "已更新" and
 * "已移除" from sitting on screen contradicting each other.
 */
function submitAvatar(
  prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  return formData.get("intent") === "remove"
    ? removeAvatarAction(prev, formData)
    : updateAvatarAction(prev, formData);
}

export interface AvatarEditorProps {
  current: AvatarSubject;
  size?: AvatarSize;

  /** Adds the wording and the remove button that a settings page wants. */
  withControls?: boolean;
}

/**
 * The avatar, and the whole path to replacing it: pick, crop, upload.
 *
 * The same component serves the settings page and a viewer's own profile, so
 * clicking a face means the same thing wherever it is shown.
 */
export function AvatarEditor({
  current,
  size = "lg",
  withControls = false,
}: AvatarEditorProps) {
  const [state, submit, pending] = useActionState<SettingsState, FormData>(
    submitAvatar,
    {},
  );

  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<ImageBitmap | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    // Cleared straight away, so picking the same file twice still reopens the
    // cropper — the input would otherwise report no change.
    event.target.value = "";
    if (!file) return;

    const rejected = sourceRejection(file);
    if (rejected) {
      setProblem(rejected);
      return;
    }

    setProblem(null);
    try {
      // Decoded here rather than in the dialog: an event handler owns the
      // bitmap's lifetime plainly, where an effect would have to survive the
      // setup/cleanup/setup that StrictMode puts every effect through.
      setPicked(await createImageBitmap(file));
    } catch {
      setProblem("这张图片读不出来，换一张试试。");
    }
  }

  function discard() {
    picked?.close();
    setPicked(null);
  }

  function send(entries: Record<string, string | File>) {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.append(key, value);
    startTransition(() => submit(data));
  }

  return (
    <div className={cn("space-y-3", withControls && "space-y-4")}>
      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={pending}
          aria-label="更换头像"
          className="group focus-visible:ring-ring relative shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
        >
          <Avatar of={current} size={size} />
          <span
            aria-hidden
            className={cn(
              "absolute inset-0 flex items-center justify-center rounded-full",
              "bg-black/55 text-xs font-medium text-white transition-opacity",
              pending
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
            )}
          >
            {pending ? "处理中…" : "更换"}
          </span>
        </button>

        <input
          ref={input}
          type="file"
          accept={ACCEPTED_TYPES}
          onChange={onPick}
          className="hidden"
        />

        {withControls ? (
          <div className="min-w-0 space-y-2">
            <p className="text-fg-muted text-sm leading-6">
              点击头像挑一张图片，裁好后会存成{" "}
              {AVATAR_LIMITS.edge}×{AVATAR_LIMITS.edge} 的 WebP。
            </p>
            {current.avatarUpdatedAt ? (
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() => send({ intent: "remove" })}
              >
                移除当前头像
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* A refusal needs words. A success does not: the new face is the notice,
          except where something invisible happened, which is the remove button. */}
      {problem ? <FormMessage tone="err">{problem}</FormMessage> : null}
      {state.error ? <FormMessage tone="err">{state.error}</FormMessage> : null}
      {withControls && state.message ? (
        <FormMessage tone="ok">{state.message}</FormMessage>
      ) : null}

      <AvatarCropper
        image={picked}
        onCancel={discard}
        onFailed={(reason) => {
          discard();
          setProblem(reason);
        }}
        onCropped={(file) => {
          discard();
          send({ avatar: file });
        }}
      />
    </div>
  );
}
