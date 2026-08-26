import { describe, expect, it } from "vitest";
import { partitionFindings, type Check } from "./checks";

/**
 * The severity rule, on synthetic checks.
 *
 * Synthetic on purpose: the real checks read the live registries, so going
 * through `assertBootConfiguration` would pin whatever `content/` this
 * deployment happens to ship instead of the thing that used to be written four
 * times in four modules and can now only be wrong once.
 */
function saying(...complaints: string[]): () => string[] {
  return () => complaints;
}

const refusable = (...complaints: string[]): Check => ({
  complaints: saying(...complaints),
  fatalIn: ["prod"],
});

const advisory = (...complaints: string[]): Check => ({
  complaints: saying(...complaints),
  fatalIn: [],
});

describe("按环境分级", () => {
  it("prod 上会拒绝启动的那些，在 dev 与 staging 上只是告警", () => {
    const checks = [refusable("共用密钥")];

    expect(partitionFindings(checks, "prod")).toEqual({
      refusals: ["共用密钥"],
      warnings: [],
    });

    for (const tier of ["dev", "staging"] as const) {
      expect(partitionFindings(checks, tier)).toEqual({
        refusals: [],
        warnings: ["共用密钥"],
      });
    }
  });

  /**
   * The tier that could not exist before. On `NODE_ENV` staging is prod — the
   * image pins it — so every refusal applied there and a staging box could not
   * be stood up without a relay and a per-backend key for each queue.
   */
  it("staging 与 prod 分得开", () => {
    const checks = [refusable("缺少中继")];

    expect(partitionFindings(checks, "staging").refusals).toEqual([]);
    expect(partitionFindings(checks, "prod").refusals).toEqual(["缺少中继"]);
  });

  it("从不致命的那些，在 prod 上也只是告警", () => {
    const checks = [advisory("没有人能管理这套部署")];

    expect(partitionFindings(checks, "prod")).toEqual({
      refusals: [],
      warnings: ["没有人能管理这套部署"],
    });
  });

  it("什么都没发现时两边都是空的", () => {
    const checks = [refusable(), advisory()];

    expect(partitionFindings(checks, "prod")).toEqual({
      refusals: [],
      warnings: [],
    });
  });
});

/**
 * The reason this was worth restructuring at all.
 *
 * The four asserts ran in a row and threw, so the first one to fail hid the
 * other three: a fresh deployment missing a relay, a per-backend key and an
 * action URL learned about them one deploy at a time. `assertEnv` already
 * aggregated its own findings for exactly this reason; the aggregation just
 * stopped at its own edge.
 */
describe("一次报完", () => {
  it("多条拒绝理由一起收齐，不是第一条就停", () => {
    const checks = [
      refusable("缺少中继"),
      refusable("共用密钥"),
      refusable("交互动作的后端没有地址"),
    ];

    expect(partitionFindings(checks, "prod").refusals).toEqual([
      "缺少中继",
      "共用密钥",
      "交互动作的后端没有地址",
    ]);
  });

  it("一条检查报出多项时每一项都留下", () => {
    const checks = [refusable("变量 A 未设置", "变量 B 未设置")];

    expect(partitionFindings(checks, "prod").refusals).toHaveLength(2);
  });

  it("拒绝与告警同时存在时互不吞没", () => {
    const checks = [refusable("共用密钥"), advisory("没有报名规则")];
    const findings = partitionFindings(checks, "prod");

    expect(findings.refusals).toEqual(["共用密钥"]);
    expect(findings.warnings).toEqual(["没有报名规则"]);
  });
});
