import { describe, expect, it } from "vitest";
import { carried, readAll, readOne, toggled, withParam } from "./query";

describe("读参数", () => {
  it("缺席的键读出 undefined 和空数组", () => {
    expect(readOne({}, "q")).toBeUndefined();
    expect(readAll({}, "q")).toEqual([]);
  });

  it("单值和多值读出来是同一种形状", () => {
    expect(readAll({ t: "a" }, "t")).toEqual(["a"]);
    expect(readAll({ t: ["a", "b"] }, "t")).toEqual(["a", "b"]);
  });

  it("重复出现时 readOne 取第一个", () => {
    expect(readOne({ q: ["a", "b"] }, "q")).toBe("a");
  });

  it("readAll 去重，否则手写的重复值一次切换去不掉", () => {
    expect(readAll({ t: ["a", "a", "b"] }, "t")).toEqual(["a", "b"]);
  });
});

describe("toggled", () => {
  it("没有就加上，有了就去掉", () => {
    expect(toggled({}, "t", "x")).toBe("?t=x");
    expect(toggled({ t: "x" }, "t", "x")).toBe("");
  });

  it("同一个键上的取值可以并存", () => {
    expect(toggled({ t: "x" }, "t", "y")).toBe("?t=x&t=y");
  });

  it("别的键原样留着", () => {
    expect(toggled({ q: "a", t: "x" }, "t", "y")).toBe("?q=a&t=x&t=y");
  });

  it("键不因为改动而挪位，同一份状态总是同一个 URL", () => {
    expect(toggled({ t: ["x", "y"], q: "a" }, "t", "y")).toBe("?t=x&q=a");
  });

  it("非 ASCII 的取值写成编码，解析回来还是原值", () => {
    const query = toggled({}, "f.tags", "图论");

    expect(query).toBe(`?f.tags=${encodeURIComponent("图论")}`);
    expect(new URLSearchParams(query).get("f.tags")).toBe("图论");
  });
});

describe("withParam", () => {
  it("替换掉键上原有的全部取值", () => {
    expect(withParam({ s: ["a", "b"] }, "s", "c")).toBe("?s=c");
  });

  it("传 undefined 就把键整个去掉", () => {
    expect(withParam({ sort: "recent", q: "a" }, "sort", undefined)).toBe("?q=a");
  });

  it("清空到什么都不剩时不留一个孤零零的问号", () => {
    expect(withParam({ sort: "recent" }, "sort", undefined)).toBe("");
  });

  it("原本没有的键补在末尾", () => {
    expect(withParam({ q: "a" }, "sort", "recent")).toBe("?q=a&sort=recent");
  });
});

describe("carried", () => {
  it("列出表单自己不写、但得跟着一起发的字段", () => {
    expect(carried({ q: "a", t: ["x", "y"] }, "q")).toEqual([
      { name: "t", value: "x" },
      { name: "t", value: "y" },
    ]);
  });

  it("表单自己命名的键不重复携带", () => {
    expect(carried({ q: "a" }, "q")).toEqual([]);
  });

  it("缺席的键不产生字段", () => {
    expect(carried({ q: undefined, t: "x" })).toEqual([
      { name: "t", value: "x" },
    ]);
  });
});
