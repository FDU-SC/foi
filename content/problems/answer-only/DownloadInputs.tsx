"use client";

import { Button } from "@/components/ui/button";
import { inputs } from "./data";

/**
 * 提交答案题的输入数据分发。
 *
 * 示例题的数据很小，直接内联在前端生成 Blob 下载；真实场景（数据可能
 * 上百 MB）应由题目自己的后端分发，就像 leaky-bucket 的 InstanceControl
 * 一样指向 NEXT_PUBLIC_* 服务。
 */
export function DownloadInputs() {
  const download = (name: string, content: string) => {
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="border-border bg-surface my-6 rounded-lg border">
      <div className="border-border bg-surface-2/50 border-b px-4 py-2.5">
        <span className="text-fg text-sm font-semibold">输入数据</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        {inputs.map((input, index) => (
          <Button
            key={input.name}
            size="sm"
            onClick={() => download(input.name, input.content)}
          >
            下载场景 {index + 1}（{input.name}）
          </Button>
        ))}
      </div>
    </div>
  );
}
