import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAvatar, sourceRejection } from "./encode";

type Encoding = { size: number; type?: string } | null;

function file(type: string, size: number): File {
  return { type, size } as File;
}

function stubCanvases(results: Encoding[]) {
  const canvases: {
    canvas: HTMLCanvasElement;
    drawImage: ReturnType<typeof vi.fn>;
  }[] = [];
  const attempts: { type: string; quality: number }[] = [];

  vi.stubGlobal("document", {
    createElement(tag: string) {
      expect(tag).toBe("canvas");

      const drawImage = vi.fn();
      const canvas = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({ drawImage })),
        toBlob(callback: BlobCallback, type: string, quality: number) {
          attempts.push({ type, quality });

          const result = results.shift();
          if (result === undefined) throw new Error("缺少编码结果");

          callback(
            result === null
              ? null
              : new Blob([new Uint8Array(result.size)], {
                  type: result.type ?? "image/webp",
                }),
          );
        },
      } as unknown as HTMLCanvasElement;

      canvases.push({ canvas, drawImage });
      return canvas;
    },
  });

  return { attempts, canvases };
}

afterEach(() => vi.unstubAllGlobals());

describe("头像原图校验", () => {
  it("拒绝非图片和超过 20 MiB 的原图，边界值仍可处理", () => {
    const limit = 20 * 1024 * 1024;

    expect(sourceRejection(file("text/plain", 1))).toContain("图片文件");
    expect(sourceRejection(file("image/png", limit))).toBeNull();
    expect(sourceRejection(file("image/png", limit + 1))).toContain("原图过大");
  });
});

describe("头像编码", () => {
  const source = {} as CanvasImageSource;
  const crop = { x: 10, y: 20, size: 300 };
  const qualities = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];
  const oversized = { size: 32 * 1024 + 1 };

  it("质量降到最低仍过大时缩小尺寸，并返回首个达标 WebP", async () => {
    const { attempts, canvases } = stubCanvases([
      ...Array(qualities.length).fill(oversized),
      { size: 32 * 1024 },
    ]);

    const result = await encodeAvatar(source, crop);

    expect(result).toMatchObject({
      name: "avatar.webp",
      type: "image/webp",
      size: 32 * 1024,
    });
    expect(canvases.map(({ canvas }) => [canvas.width, canvas.height])).toEqual([
      [256, 256],
      [192, 192],
    ]);
    expect(attempts).toEqual([
      ...qualities.map((quality) => ({ type: "image/webp", quality })),
      { type: "image/webp", quality: 0.9 },
    ]);
    expect(canvases[0].drawImage).toHaveBeenCalledWith(
      source,
      10,
      20,
      300,
      300,
      0,
      0,
      256,
      256,
    );
  });

  it("浏览器返回其他格式或空结果时立即拒绝", async () => {
    stubCanvases([{ size: 1024, type: "image/png" }]);
    await expect(encodeAvatar(source, crop)).rejects.toThrow(
      "当前浏览器不支持 WebP",
    );

    stubCanvases([null]);
    await expect(encodeAvatar(source, crop)).rejects.toThrow("图片处理失败");
  });

  it("全部质量和尺寸均超限时拒绝，不上传过大的文件", async () => {
    const { attempts, canvases } = stubCanvases(
      Array.from({ length: qualities.length * 3 }, () => oversized),
    );

    await expect(encodeAvatar(source, crop)).rejects.toThrow(
      "这张图压缩后仍然过大",
    );
    expect(canvases.map(({ canvas }) => canvas.width)).toEqual([256, 192, 128]);
    expect(attempts).toHaveLength(qualities.length * 3);
  });
});
