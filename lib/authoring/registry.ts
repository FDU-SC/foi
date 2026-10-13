import { authoring as declared } from "@/content/authoring";
import type { AuthoringConfig, UiField, ViewsPreset } from "./types";

/**
 * The deployment's authoring vocabulary, validated once at module load.
 *
 * A malformed declaration is a deployment mistake that would otherwise surface
 * as a form quietly writing a key nothing reads, so it refuses here — the same
 * shape as the other content registries.
 */

function fail(message: string): never {
  throw new Error(`content/authoring.ts 不合法：${message}`);
}

function validate(config: AuthoringConfig): AuthoringConfig {
  if (config.presets.length === 0) fail("至少需要一个展示 preset");

  const ids = new Set<string>();
  for (const preset of config.presets) {
    if (ids.has(preset.id)) fail(`展示 preset "${preset.id}" 重复`);
    ids.add(preset.id);
  }

  if (!ids.has(config.defaultPreset)) {
    fail(`defaultPreset "${config.defaultPreset}" 不在 preset 列表里`);
  }

  if (config.authoredBackend.trim().length === 0) {
    fail("authoredBackend 不能为空");
  }

  const keys = new Set<string>();
  for (const field of config.uiFields) {
    if (keys.has(field.key)) fail(`展示字段 "${field.key}" 重复`);
    keys.add(field.key);
  }

  return config;
}

export const authoring: AuthoringConfig = validate(declared);

export function listPresets(): readonly ViewsPreset[] {
  return authoring.presets;
}

export function listUiFields(): readonly UiField[] {
  return authoring.uiFields;
}

/**
 * The views for a preset id, or the default's when the id names none.
 *
 * A stored id survives a deployment dropping a preset: the problem keeps a
 * display shape rather than losing its submission box, and the authoring form
 * reports the id it can no longer offer.
 */
export function presetViews(id: string | null | undefined): ViewsPreset {
  const presets = authoring.presets;
  const named = id ? presets.find((preset) => preset.id === id) : undefined;
  return named ?? presets.find((preset) => preset.id === authoring.defaultPreset)!;
}

export function hasPreset(id: string): boolean {
  return authoring.presets.some((preset) => preset.id === id);
}
