/**
 * 每个场景的输入数据，选手可下载。
 *
 * 答案不在这里：它们只存在于 `problem.ts` 的 `backend.config` 中（该字段被
 * `toPublicConfig` 剥离，绝不下发浏览器）。输入数据本身是公开的——选手
 * 本来就要下载它们。
 */
export const inputs: { name: string; content: string }[] = [
  { name: "scene-1.txt", content: "255" },
  { name: "scene-2.txt", content: "1024" },
  { name: "scene-3.txt", content: "123456789" },
];
