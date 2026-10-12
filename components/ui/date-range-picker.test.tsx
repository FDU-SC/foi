// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateRangePicker, rangeLabel, type DayRange } from "./date-range-picker";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-26T12:00:00+08:00"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(value: DayRange) {
  await act(async () => {
    root.render(
      <DateRangePicker
        action="/board"
        carried={[{ name: "board", value: "b" }]}
        names={{ from: "from", to: "to" }}
        value={value}
        label="时间"
        timeZone="Asia/Shanghai"
      />,
    );
  });
}

async function click(target: Element | null | undefined) {
  if (!target) throw new Error("缺少可点的元素");
  await act(async () => (target as HTMLElement).click());
}

async function choose(name: string, value: string) {
  const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${name}"]`);
  if (!select) throw new Error(`缺少下拉：${name}`);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const trigger = () => host.querySelector("button[aria-haspopup]");
const day = (iso: string) => host.querySelector(`[data-day="${iso}"]:not([data-outside]) button`);
const button = (text: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === text);
const hidden = () => Object.fromEntries(
  [...host.querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map((input) => [input.name, input.value]),
);

describe("日期范围选择器", () => {
  it("在同一个日历里先点开始、再点结束，提交时带上其余参数", async () => {
    await render({ from: "2026-09-01", to: "2026-09-02" });
    expect(host.querySelector("[role=dialog]")).toBeNull();

    await click(trigger());
    await click(day("2026-09-03"));
    await click(day("2026-09-10"));

    expect(hidden()).toEqual({ board: "b", from: "2026-09-03", to: "2026-09-10" });
    expect(host.querySelector('[data-day="2026-09-05"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("点年份、月份可以直接跳到那个月", async () => {
    await render({});
    await click(trigger());
    expect(host.querySelector('select[aria-label="选择年份"]')).not.toBeNull();
    expect(host.querySelector('select[aria-label="选择月份"]')).not.toBeNull();

    await choose("选择年份", "2025");
    await choose("选择月份", "2");
    await click(day("2025-03-14"));

    expect(hidden()).toMatchObject({ from: "2025-03-14" });
  });

  it("快捷范围以今天为终点", async () => {
    await render({});
    await click(trigger());

    await click(button("最近 7 天"));
    expect(hidden()).toMatchObject({ from: "2026-09-20", to: "2026-09-26" });

    await click(button("上个月"));
    expect(hidden()).toMatchObject({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("今天按站点时区算，而不是浏览器所在时区", async () => {
    vi.setSystemTime(new Date("2026-09-26T20:00:00Z"));
    await render({});
    await click(trigger());

    await click(button("最近 7 天"));
    expect(hidden()).toMatchObject({ from: "2026-09-21", to: "2026-09-27" });
  });

  it("点外面关闭，清除链接只保留其余参数", async () => {
    await render({ from: "2026-09-01", to: "2026-09-20" });
    await click(trigger());
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/board?board=b");

    await act(async () => document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(host.querySelector("[role=dialog]")).toBeNull();
  });

  it("按 Esc 关闭", async () => {
    await render({});
    await click(trigger());

    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(host.querySelector("[role=dialog]")).toBeNull();
  });

  it("按钮文字描述当前范围", () => {
    expect(rangeLabel({})).toBeUndefined();
    expect(rangeLabel({ from: "2026-09-01", to: "2026-09-01" })).toBe("2026/09/01");
    expect(rangeLabel({ from: "2026-09-01" })).toBe("2026/09/01 起");
    expect(rangeLabel({ to: "2026-09-20" })).toBe("至 2026/09/20");
  });
});
