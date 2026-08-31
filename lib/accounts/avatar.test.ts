import { describe, expect, it } from "vitest";
import { SERVER_ACTION_BODY_LIMIT } from "@/lib/body-limit";
import {
  AVATAR_LIMITS,
  avatarRejection,
  identiconHue,
  identiconInitial,
  parseWebp,
} from "./avatar";

function ascii(bytes: Uint8Array, at: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) bytes[at + i] = text.charCodeAt(i);
}

function uint24(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff;
  bytes[at + 1] = (value >> 8) & 0xff;
  bytes[at + 2] = (value >> 16) & 0xff;
}

function container(fourCC: string, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(20 + payload.byteLength);
  const view = new DataView(bytes.buffer);

  ascii(bytes, 0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  ascii(bytes, 8, "WEBP");
  ascii(bytes, 12, fourCC);
  view.setUint32(16, payload.byteLength, true);
  bytes.set(payload, 20);

  return bytes;
}

/** Simple lossy, optionally padded out to a given payload size. */
function lossy(width: number, height: number, payloadBytes = 10): Uint8Array {
  const payload = new Uint8Array(Math.max(10, payloadBytes));
  const view = new DataView(payload.buffer);

  payload[3] = 0x9d;
  payload[4] = 0x01;
  payload[5] = 0x2a;
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);

  return container("VP8 ", payload);
}

function lossless(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(5);
  payload[0] = 0x2f;

  const bits = ((width - 1) | ((height - 1) << 14)) >>> 0;
  new DataView(payload.buffer).setUint32(1, bits, true);

  return container("VP8L", payload);
}

function extended(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(10);
  uint24(payload, 4, width - 1);
  uint24(payload, 7, height - 1);
  return container("VP8X", payload);
}

describe("parseWebp", () => {
  it("读得出简单有损帧的尺寸", () => {
    expect(parseWebp(lossy(256, 192))).toEqual({ width: 256, height: 192 });
  });

  it("读得出无损帧的尺寸", () => {
    expect(parseWebp(lossless(256, 192))).toEqual({ width: 256, height: 192 });
  });

  it("读得出扩展格式的画布尺寸", () => {
    expect(parseWebp(extended(256, 192))).toEqual({ width: 256, height: 192 });
  });

  it("三种 chunk 的宽高编码各不相同，不能互相顶替", () => {
    const asLossy = lossy(300, 100);
    const asLossless = lossless(300, 100);

    expect(parseWebp(asLossy)).toEqual({ width: 300, height: 100 });
    expect(parseWebp(asLossless)).toEqual({ width: 300, height: 100 });
    expect(asLossy).not.toEqual(asLossless);
  });

  it("不是 RIFF 就不认", () => {
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    expect(parseWebp(png)).toBeNull();
  });

  it("是 RIFF 但不是 WEBP 也不认", () => {
    const wav = container("VP8 ", new Uint8Array(10));
    ascii(wav, 8, "WAVE");

    expect(parseWebp(wav)).toBeNull();
  });

  it("SVG 一律不认，它能带脚本", () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
    );

    expect(parseWebp(svg)).toBeNull();
  });

  it("声明的长度超过实际字节数，说明文件被截断", () => {
    const truncated = lossy(256, 256).slice(0, 24);

    expect(parseWebp(truncated)).toBeNull();
  });

  it("chunk 声明的长度超出剩余字节也不认", () => {
    const bytes = lossy(256, 256);
    new DataView(bytes.buffer).setUint32(16, 4096, true);

    expect(parseWebp(bytes)).toBeNull();
  });

  it("认不出的 chunk 类型直接拒绝", () => {
    const bytes = lossy(256, 256);
    ascii(bytes, 12, "ANIM");

    expect(parseWebp(bytes)).toBeNull();
  });

  it("有损帧缺了关键帧起始码就是伪造的头", () => {
    const bytes = lossy(256, 256);
    bytes[23] = 0x00;

    expect(parseWebp(bytes)).toBeNull();
  });

  it("无损帧的签名字节对不上也不认", () => {
    const bytes = lossless(256, 256);
    bytes[20] = 0x00;

    expect(parseWebp(bytes)).toBeNull();
  });

  it("短得放不下文件头的直接拒绝", () => {
    expect(parseWebp(new Uint8Array(8))).toBeNull();
    expect(parseWebp(new Uint8Array(0))).toBeNull();
  });

  it("读的是视图自己的那一段，不是底层缓冲区的开头", () => {
    const source = lossy(256, 192);
    const padded = new Uint8Array(source.byteLength + 7);
    padded.set(source, 7);

    const view = padded.subarray(7);

    expect(parseWebp(view)).toEqual({ width: 256, height: 192 });
  });
});

describe("avatarRejection", () => {
  it("放行一张规规矩矩的 WebP", () => {
    expect(avatarRejection(lossy(AVATAR_LIMITS.edge, AVATAR_LIMITS.edge))).toBeNull();
  });

  it("空文件说的是「请选一张」而不是格式不对", () => {
    expect(avatarRejection(new Uint8Array(0))).toContain("选择");
  });

  it("超过字节上限的先被挡下", () => {
    const huge = lossy(256, 256, AVATAR_LIMITS.maxBytes);

    expect(huge.byteLength).toBeGreaterThan(AVATAR_LIMITS.maxBytes);
    expect(avatarRejection(huge)).toContain("过大");
  });

  it("不是 WebP 的一律拒绝", () => {
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47]);

    expect(avatarRejection(png)).toContain("格式");
  });

  it("边长超出上限的拒绝，哪怕字节数很小", () => {
    const wide = lossy(AVATAR_LIMITS.maxEdge + 1, 16);

    expect(wide.byteLength).toBeLessThan(AVATAR_LIMITS.maxBytes);
    expect(avatarRejection(wide)).toContain("尺寸");
  });

  it("零宽高读作格式不对，不是尺寸超限", () => {
    expect(avatarRejection(lossy(0, 0))).toContain("格式");
  });

  it("字节上限留在 Server Action 的天花板之下", () => {
    // 超过它，请求在抵达 action 之前就被框架挡掉，用户看到的是错误边界而不是理由。
    expect(AVATAR_LIMITS.maxBytes).toBeLessThan(SERVER_ACTION_BODY_LIMIT);
  });
});

describe("identicon", () => {
  it("同一个 uid 永远得到同一个色相", () => {
    expect(identiconHue(42)).toBe(identiconHue(42));
  });

  it("色相落在一圈之内", () => {
    for (const uid of [1, 2, 7, 42, 100, 99999]) {
      expect(identiconHue(uid)).toBeGreaterThanOrEqual(0);
      expect(identiconHue(uid)).toBeLessThan(360);
    }
  });

  it("相邻的 uid 不会撞成同一个颜色", () => {
    const hues = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(identiconHue));

    expect(hues.size).toBeGreaterThan(6);
  });

  it("取首字并转成大写", () => {
    expect(identiconInitial("alice")).toBe("A");
    expect(identiconInitial("  bob")).toBe("B");
  });

  it("按码点取，emoji 和汉字都不会被切碎", () => {
    expect(identiconInitial("👍 好评")).toBe("👍");
    expect(identiconInitial("张三")).toBe("张");
  });

  it("空昵称也有东西可画", () => {
    expect(identiconInitial("")).toBe("?");
    expect(identiconInitial("   ")).toBe("?");
  });
});
