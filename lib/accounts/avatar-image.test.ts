import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { AVATAR_LIMITS } from "./avatar";
import { normalizeAvatar } from "./avatar-image";

async function webp(width: number, height: number): Promise<Uint8Array> {
  const image = sharp({ create: { width, height, channels: 3, background: "#3366ff" } });
  return new Uint8Array(await image.webp().toBuffer());
}

describe("normalizeAvatar", () => {
  it("放行一张规规矩矩的 WebP，交回重新编码的字节", async () => {
    const result = await normalizeAvatar(await webp(AVATAR_LIMITS.edge, AVATAR_LIMITS.edge));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { format, width, height } = await sharp(result.bytes).metadata();
    expect({ format, width, height }).toEqual({
      format: "webp",
      width: AVATAR_LIMITS.edge,
      height: AVATAR_LIMITS.edge,
    });
  });

  it("去掉上传里附带的元数据", async () => {
    const tagged = await sharp(await webp(64, 64))
      .withMetadata({ exif: { IFD0: { Copyright: "someone" } } })
      .webp()
      .toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();

    const result = await normalizeAvatar(new Uint8Array(tagged));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await sharp(result.bytes).metadata()).exif).toBeUndefined();
  });

  it("空文件说的是「请选一张」而不是格式不对", async () => {
    expect(await normalizeAvatar(new Uint8Array(0))).toEqual({
      ok: false,
      error: expect.stringContaining("选择"),
    });
  });

  it("超过字节上限的先被挡下，不去解码", async () => {
    const huge = new Uint8Array(AVATAR_LIMITS.maxBytes + 1);

    expect(await normalizeAvatar(huge)).toEqual({ ok: false, error: expect.stringContaining("过大") });
  });

  it("不是 WebP 的一律拒绝", async () => {
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#000" } })
      .png()
      .toBuffer();

    expect(await normalizeAvatar(new Uint8Array(png))).toEqual({
      ok: false,
      error: expect.stringContaining("格式"),
    });
  });

  it("边长超出上限的拒绝，哪怕字节数很小", async () => {
    const wide = await webp(AVATAR_LIMITS.maxEdge + 1, 16);
    expect(wide.byteLength).toBeLessThan(AVATAR_LIMITS.maxBytes);

    expect(await normalizeAvatar(wide)).toEqual({ ok: false, error: expect.stringContaining("尺寸") });
  });

  it("文件头完好但像素数据损坏的也拒绝", async () => {
    const broken = await webp(64, 64);
    broken.fill(7, 40);

    expect(await normalizeAvatar(broken)).toEqual({ ok: false, error: expect.stringContaining("格式") });
  });

  it("只有文件头、没有内容的拒绝", async () => {
    const header = new TextEncoder().encode("RIFF\x10\x00\x00\x00WEBPVP8 ");

    expect(await normalizeAvatar(header)).toEqual({ ok: false, error: expect.stringContaining("格式") });
  });
});
