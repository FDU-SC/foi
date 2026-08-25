import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardRequest } from "./gate";

/**
 * The cross-origin half of the gate, exercised directly rather than through a
 * route.
 *
 * Going through a handler would need a session, a database and a content
 * registry to reach a check that reads two headers, and the assertions would be
 * about status codes several layers away from the decision. What is worth
 * pinning here is the decision itself — in particular the two places it
 * deliberately does *not* refuse, since those are the ones a later tightening
 * would quietly break.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * No `x-forwarded-for`, so `sourceFrom` resolves to no source and the flood cap
 * stands aside. That leaves each case asserting about the origin check alone
 * rather than about whichever of the two happened to fire.
 */
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

  /**
   * The attack this whole change exists for. `SameSite=Lax` is scoped to the
   * registrable domain, so the browser attaches the session to this request;
   * nothing but the origin check tells the two subdomains apart.
   */
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

  /**
   * #22 shipped this comparison against `FOI_PUBLIC_URL` and 403'd anyone who
   * reached a dev server by address instead of by name. Comparing against the
   * request's own host is what makes the configured URL irrelevant here, and
   * the stub is set to the wrong answer on purpose to prove it is unread.
   */
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

  /**
   * TLS terminates at the reverse proxy, so a correct HTTPS deployment sees
   * `http` on the inside. Comparing schemes would refuse every request it
   * makes, which is why only hosts are compared.
   */
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

  /**
   * Browsers send `Origin` on every POST, so absent means the caller is not one
   * and has no ambient cookie to abuse. Refusing it would break `curl` and
   * every integration test for a threat in which no browser takes part.
   */
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
  /**
   * The three CORS-safelisted types, which is to say the three an HTML form can
   * produce — the only cross-origin POST that carries a chosen body with no
   * preflight. `text/plain` is the one that matters: it shapes a form body into
   * something `JSON.parse` accepts.
   */
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

  /**
   * an action taking no arguments is posted with no body, which is the natural way
   * to write an action that takes no arguments. Demanding a header of every
   * problem author would stop nothing — a bodiless cross-origin `fetch` still
   * has to pass the origin check.
   */
  it("没有 Content-Type 时放行，因为无参数的 action 就是这么发的", () => {
    const gated = guardRequest(
      post("http://foi.example.edu/api/problems/some-problem/action/some-action", {
        origin: "http://foi.example.edu",
      }),
      "POST /api/problems/[slug]/action/[action]",
    );

    expect(gated).toBeNull();
  });
});

describe("guardRequest 的两道检查顺序", () => {
  /**
   * The flood cap runs first, and the ordering is load-bearing twice over: a
   * stream of refused cross-origin attempts still spends the source's budget,
   * and the runner endpoints keep the property that nothing reads a body before
   * the bound it depends on.
   */
  it("超出来源闸时先答 429，而不是先判来源", () => {
    const from = { "x-forwarded-for": "203.0.113.7" };
    const url = "http://foi.example.edu/api/submissions";

    // The cap is 300 per minute; spend it with requests that would otherwise
    // be allowed, so the next verdict can only come from the bound.
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
  /**
   * Machine-to-machine. A runner proves itself with an HMAC it had to be given;
   * requiring an `Origin` of it would refuse every legitimate caller and stop
   * nothing, because no browser can produce the signature in the first place.
   */
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

  /**
   * A cross-site read can be caused but not seen: nothing here answers with a
   * CORS header, so the response stays unreadable by the origin that asked.
   * Guarding these would cost the health probe for no gain.
   */
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

  /**
   * The refusal that made wrapping Auth.js's handlers look impossible, and the
   * reason it was not.
   *
   * Every Auth.js POST is `application/x-www-form-urlencoded`, so a
   * `same-origin` declaration really would answer 415 to every sign-in. But
   * the guard is read off `ROUTE_LIMITS`, and that entry says `framework` —
   * the check exists and is Auth.js's double-submit cookie. So the wrapper
   * this asserts about adds the flood cap and leaves the origin question where
   * it already had an answer.
   *
   * Asserted here rather than left to the route's comment because the whole
   * argument turns on `originGate` standing aside, and a future entry changing
   * its guard would break sign-in with nothing else to say so.
   */
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

/**
 * The assumption that turned out to be false.
 *
 * `/api/*` sits outside the `proxy.ts` matcher on purpose, so the per-source
 * bound every other path gets from proxy has to be taken by each handler on
 * its own first line. That is a rule nothing enforced: `/api/auth` went
 * unmetered for as long as it did because re-exporting `handlers` whole left
 * no first line, and the omission read as ordinary syntax rather than as a
 * missing defence.
 *
 * A source scan rather than an import, for the reason `policy.test.ts` gives:
 * importing a route handler drags in the database, the content registries and
 * Auth.js, and a test that expensive is a test that gets skipped.
 */
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
