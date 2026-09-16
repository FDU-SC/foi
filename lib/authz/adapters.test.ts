import { describe, expect, it } from "vitest";
import { permissionFor } from "./adapters";

describe("客户端权限投影", () => {
  it("只传递公开拒绝原因，不传递策略来源或附加详情", () => {
    expect(permissionFor({ allow: false, via: "internal-policy", reason: {
      code: "not-entered", message: "不在参赛名单中", detail: { internal: "private" },
    } })).toEqual({ allowed: false, reason: { code: "not-entered", message: "不在参赛名单中" } });
    expect(permissionFor(null)).toEqual({ allowed: true });
  });
});
