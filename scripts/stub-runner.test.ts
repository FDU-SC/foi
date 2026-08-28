import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { sign as platformSign } from "@/lib/backend/signature";

const require = createRequire(import.meta.url);
const stub = require("./stub-runner.cjs") as {
  sign: (
    secret: string,
    timestamp: number,
    method: string,
    path: string,
    body: string,
  ) => string;
  verdictFor: (details: unknown) => {
    result: { status: string; score: number; maxScore: number; accepted: boolean };
    detail: { tests?: { name: string; status: string; score: number; maxScore: number }[]; message?: string };
  };
  SIMULATION_NOTE: string;
  STATUSES: string[];
};

const SECRET = "9f2c1b7e4a6d8035fe1c2b3a4d5e6f70";

function job(payload: unknown, config?: unknown) {
  return {
    id: "sub_1",
    user: { uid: 1, groups: [] },
    problem: { slug: "maze-runner", config },
    contestSlug: null,
    payload,
  };
}

describe("stub-runner 的签名", () => {
  // 这份实现是手抄的——生产镜像里没有 TypeScript 运行时，没法直接 import
  // lib/backend/signature.ts。抄错的后果是每个请求都 401，而那只有部署之后才看得见。
  it("与平台的实现逐字一致", () => {
    const cases = [
      { method: "POST", path: "/api/runner/jobs/request", body: '{"backendId":"traditional"}' },
      { method: "GET", path: "/api/runner/jobs/abc?lease=lea_1", body: "" },
      { method: "PUT", path: "/api/runner/jobs/abc", body: '{"lease":"lea_1","state":"alive"}' },
    ];

    for (const { method, path, body } of cases) {
      const timestamp = 1_800_000_000;
      expect(stub.sign(SECRET, timestamp, method, path, body)).toBe(
        platformSign(SECRET, timestamp, { method, path, body }),
      );
    }
  });

  it("小写方法名也归一化成同一个摘要", () => {
    expect(stub.sign(SECRET, 1_800_000_000, "post", "/x", "")).toBe(
      platformSign(SECRET, 1_800_000_000, { method: "POST", path: "/x", body: "" }),
    );
  });
});

describe("stub-runner 的判定", () => {
  // 不 import content：抽空 content 之后平台仍要能通过检查，测试也不例外。这里验证
  // 的是「产出没有超出自己声明的集合」，那个集合与 content 判定表的对齐是部署时的事。
  it("status 不超出自己声明的集合", () => {
    const sources = ["a", "bb", "ccc", "dddd", "eeeee", "ffffff", "ggggggg"];
    for (const source of sources) {
      const { result } = stub.verdictFor(job({ source }));
      expect(stub.STATUSES).toContain(result.status);
    }
  });

  it("同一份提交每次得到同样的结果", () => {
    const first = stub.verdictFor(job({ source: "int main(){}" }));
    const second = stub.verdictFor(job({ source: "int main(){}" }));
    expect(second).toEqual(first);
  });

  it("不同提交不会全都一样", () => {
    const seen = new Set(
      Array.from({ length: 24 }, (_, i) =>
        JSON.stringify(stub.verdictFor(job({ source: `solution-${i}` })).detail.tests),
      ),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it("空提交判编译错误", () => {
    const { result } = stub.verdictFor(job({ source: "   " }));
    expect(result.status).toBe("compile_error");
    expect(result.accepted).toBe(false);
  });

  it("按题目声明的子任务出测试点，分数对得上", () => {
    const config = {
      subtasks: [
        { name: "样例", score: 20 },
        { name: "小数据", score: 30 },
        { name: "大数据", score: 50 },
      ],
    };
    const { result, detail } = stub.verdictFor(job({ source: "x" }, config));

    expect(detail.tests).toHaveLength(3);
    expect(detail.tests?.map((t) => t.name)).toEqual(["样例", "小数据", "大数据"]);
    expect(result.maxScore).toBe(100);
    expect(result.score).toBe(
      detail.tests?.reduce((sum, t) => sum + t.score, 0),
    );
  });

  it("没有子任务声明时退回单个测试点", () => {
    const { detail, result } = stub.verdictFor(job({ source: "x" }));
    expect(detail.tests).toHaveLength(1);
    expect(result.maxScore).toBe(100);
  });

  it("accepted 与满分一致", () => {
    for (let i = 0; i < 24; i++) {
      const { result } = stub.verdictFor(job({ source: `s-${i}` }));
      expect(result.accepted).toBe(result.score === result.maxScore);
    }
  });

  it("每份判定都声明自己是模拟的", () => {
    for (const source of ["x", "   ", "int main(){}"]) {
      const { detail } = stub.verdictFor(job({ source }));
      expect(detail.message).toContain(stub.SIMULATION_NOTE);
    }
  });

  it("flag 型提交也能判", () => {
    const { result } = stub.verdictFor(job({ flag: "FOI{abc}" }));
    expect(stub.STATUSES).toContain(result.status);
  });
});
