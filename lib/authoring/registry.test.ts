import { describe, expect, it } from "vitest";
import { authoring, hasPreset, listPresets, listUiFields, presetViews } from "./registry";

/**
 * The deployment's authoring vocabulary, read as data.
 *
 * What the platform needs from it is small and total: a preset for a problem
 * that named one, a default for a problem that named none or named one that is
 * gone, and the field list the form and the validator both work from.
 */

describe("展示 preset 的解析", () => {
  it("有名就用名的", () => {
    expect(presetViews("fixture-bare").id).toBe("fixture-bare");
  });

  it("没有名、或者名字不认识，都退回默认", () => {
    expect(presetViews(null).id).toBe(authoring.defaultPreset);
    expect(presetViews("never-existed").id).toBe(authoring.defaultPreset);
  });

  it("默认 preset 一定在列表里，解析不会返回 undefined", () => {
    expect(hasPreset(authoring.defaultPreset)).toBe(true);
    expect(presetViews(undefined).views).toBeDefined();
  });

  it("列出来的 preset 和字段都是有内容的", () => {
    expect(listPresets().length).toBeGreaterThan(0);
    expect(listUiFields().length).toBeGreaterThan(0);
  });

  it("部署声明了在线出的题由哪个后端评测", () => {
    expect(authoring.authoredBackend.length).toBeGreaterThan(0);
  });
});
