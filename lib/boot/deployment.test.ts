import { afterEach, describe, expect, it, vi } from "vitest";
import { isProd, releaseSha, tier, TIERS } from "./deployment";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("tier", () => {
  it("认 FOI_ENV 声明的那一层", () => {
    for (const declared of TIERS) {
      vi.stubEnv("FOI_ENV", declared);
      expect(tier()).toBe(declared);
    }
  });

  /**
   * The reason this is a fallback and not a default: the image sets
   * `NODE_ENV=production`, so a deployment that predates `FOI_ENV` keeps every
   * refusal it has today rather than quietly dropping to the softest tier the
   * moment this code ships.
   */
  it("没声明时回落到 NODE_ENV，生产镜像因此仍是 prod", () => {
    vi.stubEnv("FOI_ENV", undefined);
    vi.stubEnv("NODE_ENV", "production");

    expect(tier()).toBe("prod");
    expect(isProd()).toBe(true);
  });

  it("没声明且不是生产构建时是 dev", () => {
    vi.stubEnv("FOI_ENV", undefined);
    vi.stubEnv("NODE_ENV", "development");

    expect(tier()).toBe("dev");
  });

  /**
   * Fail closed, and loudly: a misspelling lands on the strictest tier rather
   * than the softest, and `assertEnv` refuses the boot over it so that nobody
   * has to notice the deployment is one tier stricter than they wrote.
   */
  it("拼错时按最严的一层算，不按最松的", () => {
    vi.stubEnv("NODE_ENV", "production");

    for (const typo of ["stagning", "Prod", "production", "", "local"]) {
      vi.stubEnv("FOI_ENV", typo);
      expect(tier()).toBe("prod");
    }
  });

  it("NODE_ENV 说 production 也盖不过显式声明的 staging", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FOI_ENV", "staging");

    expect(tier()).toBe("staging");
    expect(isProd()).toBe(false);
  });
});

describe("releaseSha", () => {
  it("CI 构建的镜像里是那次构建的 commit", () => {
    vi.stubEnv("FOI_RELEASE_SHA", "0123456789abcdef0123456789abcdef01234567");

    expect(releaseSha()).toBe("0123456789abcdef0123456789abcdef01234567");
  });

  /**
   * Null rather than a placeholder. The column it feeds is only worth anything
   * if a value in it names a real tree, so a hand-built image saying nothing is
   * the honest answer — and an empty build arg has to read the same way as an
   * absent one, because that is what a `docker build` with no `--build-arg`
   * produces.
   */
  it("没有构建参数时是 null，空串也算没有", () => {
    vi.stubEnv("FOI_RELEASE_SHA", undefined);
    expect(releaseSha()).toBeNull();

    vi.stubEnv("FOI_RELEASE_SHA", "");
    expect(releaseSha()).toBeNull();
  });
});
