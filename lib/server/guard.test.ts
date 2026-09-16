import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardRequest, SOURCE_GATE } from "./guard";

afterEach(() => {
  vi.unstubAllEnvs();
});

function post(
  url: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, { method: "POST", headers });
}

const SUBMIT = "POST /api/submissions" as const;

describe("guardRequest 的来源检查", () => {
  it("同源的 POST 放行", () => {
    const gated = guardRequest(
      post("http://foi.example.edu/api/submissions", {
        origin: "http://foi.example.edu",
        "content-type": "application/json",
      }),
      SUBMIT,
    );

    expect(gated).toBeNull();
  });

  it("同站兄弟子域的 POST 被拒", async () => {
    const gated = guardRequest(
      post("http://foi.example.edu/api/submissions", {
        origin: "http://wiki.example.edu",
        "content-type": "application/json",
      }),
      SUBMIT,
    );

    expect(gated?.status).toBe(403);
  });

  it("端口不同也算不同来源", () => {
    const gated = guardRequest(
      post("http://foi.example.edu/api/submissions", {
        origin: "http://foi.example.edu:8080",
        "content-type": "application/json",
      }),
      SUBMIT,
    );

    expect(gated?.status).toBe(403);
  });

  it("Origin 不是合法 URL 时按不匹配处理", () => {
    const gated = guardRequest(
      post("http://foi.example.edu/api/submissions", {
        origin: "null",
        "content-type": "application/json",
      }),
      SUBMIT,
    );

    expect(gated?.status).toBe(403);
  });

  it("按请求自身的 Host 比对，不看 FOI_PUBLIC_URL", () => {
    vi.stubEnv("FOI_PUBLIC_URL", "http://localhost:3000");

    const gated = guardRequest(
      post("http://127.0.0.1:3000/api/submissions", {
        origin: "http://127.0.0.1:3000",
        "content-type": "application/json",
      }),
      SUBMIT,
    );

    expect(gated).toBeNull();
  });

  it("Host 头优先于请求 URL，因为反代转发的是它", () => {
    const gated = guardRequest(
      post("http://internal-container:3000/api/submissions", {
        host: "foi.example.edu",
        origin: "http://foi.example.edu",
        "content-type": "application/json",
      }),
      SUBMIT,
    );

    expect(gated).toBeNull();
  });

  it("协议不同不算不同来源", () => {
    const gated = guardRequest(
      post("http://foi.example.edu/api/submissions", {
        origin: "https://foi.example.edu",
        "content-type": "application/json",
      }),
      SUBMIT,
    );

    expect(gated).toBeNull();
  });

  it("没有 Origin 头时放行", () => {
    const gated = guardRequest(
      post("http://foi.example.edu/api/submissions", {
        "content-type": "application/json",
      }),
      SUBMIT,
    );

    expect(gated).toBeNull();
  });
});

describe("guardRequest 的 Content-Type 检查", () => {

  it.each([
    "text/plain",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
  ])("拒绝表单能发出的 %s", (media) => {
    const gated = guardRequest(
      post("http://foi.example.edu/api/submissions", {
        origin: "http://foi.example.edu",
        "content-type": media,
      }),
      SUBMIT,
    );

    expect(gated?.status).toBe(415);
  });

  it("带参数的 text/plain 同样被拒", () => {
    const gated = guardRequest(
      post("http://foi.example.edu/api/submissions", {
        origin: "http://foi.example.edu",
        "content-type": "text/plain;charset=UTF-8",
      }),
      SUBMIT,
    );

    expect(gated?.status).toBe(415);
  });

  it("application/json 带 charset 参数仍然放行", () => {
    const gated = guardRequest(
      post("http://foi.example.edu/api/submissions", {
        origin: "http://foi.example.edu",
        "content-type": "application/json; charset=utf-8",
      }),
      SUBMIT,
    );

    expect(gated).toBeNull();
  });

  it("没有 Content-Type 时放行，因为无参数的 action 就是这么发的", () => {
    const gated = guardRequest(
      post(
        "http://foi.example.edu/api/contests/a-contest/problems/a-problem/action/some-action",
        { origin: "http://foi.example.edu" },
      ),
      "POST /api/contests/[slug]/problems/[problem]/action/[action]",
    );

    expect(gated).toBeNull();
  });
});

describe("guardRequest 的两道检查顺序", () => {

  it("超出来源闸时先答 429，而不是先判来源", () => {
    const from = { "x-forwarded-for": "203.0.113.7" };
    const url = "http://foi.example.edu/api/submissions";

    for (let i = 0; i < 300; i += 1) {
      guardRequest(
        post(url, {
          ...from,
          origin: "http://foi.example.edu",
          "content-type": "application/json",
        }),
        SUBMIT,
      );
    }

    const gated = guardRequest(
      post(url, {
        ...from,
        origin: "http://wiki.example.edu",
        "content-type": "text/plain",
      }),
      SUBMIT,
    );

    expect(gated?.status).toBe(429);
  });
});

describe("guardRequest 的豁免", () => {

  it("评测机上报不要求 Origin", () => {
    const gated = guardRequest(
      new Request("http://foi.example.edu/api/runner/jobs/sub_1", {
        method: "PUT",
        headers: { "content-type": "text/plain" },
      }),
      "PUT /api/runner/jobs/[id]",
    );

    expect(gated).toBeNull();
  });

  it.each([
    ["GET /api/submissions", "http://foi.example.edu/api/submissions"],
    ["GET /api/health", "http://foi.example.edu/api/health"],
  ] as const)("只读路由 %s 不检查来源", (route, url) => {
    const gated = guardRequest(
      new Request(url, {
        method: "GET",
        headers: { origin: "http://wiki.example.edu" },
      }),
      route,
    );

    expect(gated).toBeNull();
  });

  it("Auth.js 的表单 POST 不会被 Content-Type 规则拒掉", () => {
    const gated = guardRequest(
      new Request("http://foi.example.edu/api/auth/callback/credentials", {
        method: "POST",
        headers: {
          origin: "http://foi.example.edu",
          "content-type": "application/x-www-form-urlencoded",
        },
      }),
      "POST /api/auth/[...nextauth]",
    );

    expect(gated).toBeNull();
  });
});

describe("每个 api 路由都取来源闸", () => {
  const ROOT = join(import.meta.dirname, "..", "..");

  function walk(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.isFile() ? [path] : [];
    });
  }

  const routes = walk(join(ROOT, "app", "api")).filter((file) =>
    file.endsWith("route.ts"),
  );

  it("扫描确实找到了东西，而不是路径写错后空过", () => {
    expect(routes.length).toBeGreaterThanOrEqual(8);
  });

  it("没有一个 route.ts 少了 guardRequest", () => {
    const missing = routes
      .filter((file) => !readFileSync(file, "utf8").includes("guardRequest("))
      .map((file) => relative(ROOT, file));

    expect(missing, "这些路由不在 proxy 的 matcher 里，也没有自己取来源闸").toEqual(
      [],
    );
  });
});

describe("SOURCE_GATE", () => {
  it("来源闸的数值仍然是个闸", () => {
    expect(SOURCE_GATE.max).toBeGreaterThan(0);
    expect(SOURCE_GATE.max).toBeLessThanOrEqual(1_000);
  });
});
