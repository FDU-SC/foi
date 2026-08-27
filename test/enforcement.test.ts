import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "@/lib/permissions/policy";
import {
  PAGE_CHECKS,
  READ_GATES,
  WRITE_GATES,
  type Denied,
  type Gate,
} from "./enforcement";

const READS: Record<string, Gate> = READ_GATES;
const WRITES: Record<string, Gate> = WRITE_GATES;

const ALL_GATES: Record<string, Gate> = { ...READS, ...WRITES };

const ROOT = join(import.meta.dirname, "..");

const KERNEL = join("lib", "permissions");

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() ? [path] : [];
  });
}

function key(file: string): string {
  return relative(ROOT, file).split(sep).join("/");
}

function sources(...directories: string[]): string[] {
  return directories
    .flatMap((directory) => walk(join(ROOT, directory)))
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .filter((file) => !relative(ROOT, file).startsWith(KERNEL));
}

function closingParen(source: string, openAt: number): number {
  let depth = 0;
  for (let i = openAt; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parameters(source: string, openAt: number): string {
  const close = closingParen(source, openAt);
  return close === -1 ? "" : source.slice(openAt + 1, close);
}

function returnType(source: string, openAt: number): string {
  const close = closingParen(source, openAt);
  if (close === -1) return "";

  const opensBody = (at: number): boolean =>
    source[at] === "{" && /^[^\S\n]*\n/.test(source.slice(at + 1));

  let angle = 0;
  for (let i = close + 1; i < source.length; i += 1) {
    if (source[i] === "<") angle += 1;
    else if (source[i] === ">" && source[i - 1] !== "=") angle -= 1;
    else if (angle === 0 && opensBody(i)) {
      return source.slice(close + 1, i).trim();
    }
  }
  return "";
}

const DENIED_ADMITS: Partial<Record<Denied, RegExp>> = {
  undefined: /\bundefined\b/,
  null: /\bnull\b/,
  false: /\bboolean\b/,
  "empty-array": /\[\]/,
  "filtered-out": /\[\]/,
};

function declaredGates(): { key: string; file: string; returns: string }[] {
  return sources("lib").flatMap((file) => {
    const source = code(readFileSync(file, "utf8"));
    return [...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(/g)]
      .map((match) => ({ match, open: match.index + match[0].length - 1 }))
      .filter(({ open }) =>
        /\b(?:Viewer|ResolvedUser)\b/.test(parameters(source, open)),
      )
      .map(({ match, open }) => ({
        key: `${key(file)}#${match[1]}`,
        file,
        returns: returnType(source, open),
      }));
  });
}

interface Action {
  name: string;
  file: string;

  capability: string | null;
}

function declaredActions(): Action[] {
  return sources("app").flatMap((file) => {
    const source = code(readFileSync(file, "utf8"));
    if (!/^\s*["']use server["']/m.test(source)) return [];

    const exports = [...source.matchAll(/export\s+async\s+function\s+(\w+)/g)];
    return exports.map((match, index) => {
      const body = source.slice(
        match.index,
        exports[index + 1]?.index ?? source.length,
      );
      return {
        name: match[1],
        file: key(file),
        capability:
          /requireCapability\(\s*["']([^"']+)["']/.exec(body)?.[1] ?? null,
      };
    });
  });
}

function checksOutsideGates(): { file: string; capability: string }[] {
  const gateFiles = new Set(
    Object.keys(READ_GATES).map((entry) => entry.split("#")[0]),
  );

  return sources("app", "components", "lib")
    .concat(join(ROOT, "proxy.ts"))
    .filter((file) => !gateFiles.has(key(file)))
    .flatMap((file) => {
      const source = code(readFileSync(file, "utf8"));
      return [...source.matchAll(/\.can\(\s*["']([^"']+)["']/g)].map(
        (match) => ({ file: key(file), capability: match[1] }),
      );
    });
}

describe("授权地图", () => {
  it("每个取函数都在地图里登记过", () => {
    const missing = declaredGates()
      .filter((gate) => !(gate.key in READ_GATES))
      .map((gate) => gate.key);

    expect(
      missing,
      "新增了收 Viewer / ResolvedUser 的导出，但没有在 READ_GATES 里说明它守什么",
    ).toEqual([]);
  });

  it("地图里没有已经不存在的取函数", () => {
    const live = new Set(declaredGates().map((gate) => gate.key));
    const stale = Object.keys(READ_GATES).filter((entry) => !live.has(entry));

    expect(stale, "READ_GATES 里的条目在 lib/ 下已经找不到").toEqual([]);
  });

  it("每个查能力的 Server Action 都在地图里登记过", () => {
    const missing = declaredActions()
      .filter((action) => action.capability !== null)
      .filter((action) => !(action.name in WRITE_GATES))
      .map((action) => `${action.name}  (${action.file})`);

    expect(
      missing,
      "新增了 requireCapability 的 Server Action，但没有在 WRITE_GATES 里登记",
    ).toEqual([]);
  });

  it("WRITE_GATES 里的动作确实还在查它声称的那个能力", () => {
    const actions = new Map(
      declaredActions().map((action) => [action.name, action]),
    );

    const wrong = Object.entries(WRITE_GATES).flatMap(([name, gate]) => {
      const action = actions.get(name);
      if (!action) return [`${name}：已经找不到这个 Server Action`];
      if (action.capability === null) {
        return [`${name}：源码里已经没有 requireCapability 了`];
      }

      const declared: readonly string[] = gate.capabilities;
      return declared.includes(action.capability)
        ? []
        : [
            `${name}：地图写的是 ${declared.join("、")}，源码查的是 ${action.capability}`,
          ];
    });

    expect(wrong, "WRITE_GATES 与源码不一致").toEqual([]);
  });

  it("每一项能力都至少被一个门禁认领", () => {
    const claimed = new Set(
      Object.values(ALL_GATES).flatMap((gate) => gate.capabilities),
    );

    const orphans = CAPABILITIES.filter(
      (capability) => !claimed.has(capability),
    );

    expect(
      orphans,
      "这些能力没有任何门禁在问，它们是死词汇：要么忘了接上，要么最后一个使用者已经被改掉了",
    ).toEqual([]);
  });

  it("每个门禁外的能力检查都在 PAGE_CHECKS 里表过态", () => {
    const missing = [
      ...new Set(
        checksOutsideGates()
          .filter((check) => !(check.file in PAGE_CHECKS))
          .map((check) => `${check.file}  (${check.capability})`),
      ),
    ];

    expect(
      missing,
      "在门禁之外问了 viewer.can(…)，需要在 PAGE_CHECKS 里说明它是不是边界",
    ).toEqual([]);
  });

  it("PAGE_CHECKS 里没有已经不问能力的文件", () => {
    const live = new Set(checksOutsideGates().map((check) => check.file));
    const stale = Object.keys(PAGE_CHECKS).filter((file) => !live.has(file));

    expect(stale, "PAGE_CHECKS 里的文件已经不查任何能力了").toEqual([]);
  });

  it("没有能力覆盖的门禁都写了为什么", () => {
    for (const [name, gate] of Object.entries(ALL_GATES)) {
      if (gate.capabilities.length > 0) continue;
      expect(
        gate.noOverride,
        `${name} 没有能力覆盖，但也没写 noOverride`,
      ).toBeTruthy();
    }
  });

  it("denied 声称的形状，函数签名得容得下", () => {
    const signatures = new Map(
      declaredGates().map((gate) => [gate.key, gate.returns]),
    );

    const wrong = Object.entries(READS).flatMap(([name, gate]) => {
      const admits = DENIED_ADMITS[gate.denied];
      const signature = signatures.get(name);

      if (!admits || signature === undefined) return [];

      return admits.test(signature)
        ? []
        : [`${name}：denied 写的是 ${gate.denied}，但签名是「${signature}」`];
    });

    expect(wrong, "denied 这一列与函数签名对不上").toEqual([]);
  });

  it("动作的拒绝一律是抛出，取函数一律不是", () => {
    const wrong = [
      ...Object.entries(WRITES)
        .filter(([, gate]) => gate.denied !== "throws")
        .map(([name]) => `${name}：动作的 denied 应该是 throws`),
      ...Object.entries(READS)
        .filter(([, gate]) => gate.denied === "throws")
        .map(([name]) => `${name}：取函数不该用抛出表示拒绝`),
    ];

    expect(wrong, "两张表的 denied 应当是对称的两种形状").toEqual([]);
  });

  it("扫描确实找到了东西，而不是路径写错后空过", () => {

    expect(declaredGates().length).toBeGreaterThanOrEqual(15);
    expect(
      declaredActions().filter((action) => action.capability).length,
    ).toBeGreaterThanOrEqual(2);
    expect(checksOutsideGates().length).toBeGreaterThanOrEqual(4);

    expect(
      declaredGates().filter((gate) => gate.returns.length > 0).length,
    ).toBeGreaterThanOrEqual(15);
  });
});
