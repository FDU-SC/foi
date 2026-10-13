"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/form";

/**
 * Upload a problem's judge files.
 *
 * What is being uploaded is a directory, and the directory's *shape* is what the
 * judge sees: `run.sh` and `tests/3.in` are relative paths in a scratch
 * directory, not names to be flattened. So the drop handler walks the entries
 * rather than reading `File.name`, and the folder picker keeps
 * `webkitRelativePath`, and both then drop the one segment that is the folder's
 * own name.
 *
 * Bytes decide how a file travels: text goes as itself, anything that is not
 * valid UTF-8 goes as base64. That is the same rule the repository's own
 * problems get from `tools/judge-file-loader.cjs`, and the server re-checks the
 * claim rather than trusting it.
 */

interface UploadFile {
  path: string;
  content: string;
  encoding?: "base64";
}

/** Leaves room for JSON overhead under the proxy's 256 KiB. */
const TOTAL_BUDGET_BYTES = 200 * 1024;

const PER_FILE_BYTES = 64 * 1024;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  }
  return btoa(binary);
}

/**
 * The file as text when its bytes survive a UTF-8 round trip, and as base64
 * otherwise — the same decision the server makes, arrived at the same way.
 */
function encode(bytes: Uint8Array): Pick<UploadFile, "content" | "encoding"> {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (new TextEncoder().encode(text).length === bytes.length) return { content: text };
  } catch {
    // Not UTF-8, so it cannot travel as a JSON string.
  }
  return { content: toBase64(bytes), encoding: "base64" };
}

async function readFile(file: File): Promise<Pick<UploadFile, "content" | "encoding">> {
  return encode(new Uint8Array(await file.arrayBuffer()));
}

function relativePaths(files: { file: File; path: string }[]): { file: File; path: string }[] {
  const roots = new Set(
    files.map(({ path }) => path.slice(0, Math.max(path.indexOf("/"), 0))),
  );
  // One shared leading segment is the folder that was dropped or picked. Two
  // would mean several folders, and then the paths are already the shape the
  // judge should see.
  const strip = roots.size === 1 && files.every(({ path }) => path.includes("/"));

  return files.map(({ file, path }) => ({
    file,
    path: strip ? path.slice(path.indexOf("/") + 1) : path,
  }));
}

function filesFromDataTransfer(transfer: DataTransfer): Promise<{ file: File; path: string }[]> {
  const entries = [...transfer.items]
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => entry !== null && entry !== undefined);

  if (entries.length === 0) {
    return Promise.resolve(
      [...transfer.files].map((file) => ({ file, path: file.name })),
    );
  }

  async function walk(entry: FileSystemEntry, prefix: string): Promise<{ file: File; path: string }[]> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      return [{ file, path: prefix + entry.name }];
    }

    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children: FileSystemEntry[] = [];
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      children.push(...batch);
    }

    const nested = await Promise.all(
      children.map((child) => walk(child, `${prefix}${entry.name}/`)),
    );
    return nested.flat();
  }

  return Promise.all(entries.map((entry) => walk(entry, ""))).then((all) => all.flat());
}

export function ProblemFiles({ slug, files }: { slug: string; files: string[] }) {
  const router = useRouter();
  const pickerRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const picker = pickerRef.current;
    // Not in React's attribute types, and required for the picker to offer a
    // folder rather than a file.
    picker?.setAttribute("webkitdirectory", "");
    picker?.setAttribute("directory", "");
  }, []);

  async function upload(selected: { file: File; path: string }[]) {
    setError(null);
    setMessage(null);

    const flattened = relativePaths(selected);
    if (flattened.length === 0) {
      setError("没有选中任何文件。");
      return;
    }

    const oversized = flattened.filter(({ file }) => file.size > PER_FILE_BYTES);
    if (oversized.length > 0) {
      setError(
        `${oversized.map(({ path }) => path).join("、")} 超过 ${PER_FILE_BYTES / 1024} KiB。` +
          "测试数据不要上传，让判题脚本按种子现场生成。",
      );
      return;
    }

    const total = flattened.reduce((sum, { file }) => sum + file.size, 0);
    if (total > TOTAL_BUDGET_BYTES) {
      setError(
        `文件合计 ${Math.round(total / 1024)} KiB，超过 ${TOTAL_BUDGET_BYTES / 1024} KiB 的上限。` +
          "判题文件应当只有几 KB；测试数据请在脚本里现场生成。",
      );
      return;
    }

    setBusy(true);
    try {
      const payload: UploadFile[] = await Promise.all(
        flattened.map(async ({ file, path }) => ({ path, ...(await readFile(file)) })),
      );

      const response = await fetch(`/api/admin/problems/${encodeURIComponent(slug)}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: payload }),
      });

      const body = (await response.json().catch(() => null)) as
        | { error?: string; files?: string[] }
        | null;

      if (!response.ok) {
        setError(body?.error ?? `上传失败 (${response.status})`);
        return;
      }

      setMessage(`已上传 ${body?.files?.length ?? payload.length} 个文件。`);
      router.refresh();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void filesFromDataTransfer(event.dataTransfer).then(upload);
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={
          dragging
            ? "border-fg flex flex-wrap items-center gap-3 border border-dashed px-3 py-4"
            : "border-border flex flex-wrap items-center gap-3 border border-dashed px-3 py-4"
        }
      >
        <span className="text-fg-muted text-sm">把判题文件的文件夹拖到这里</span>
        <input
          ref={pickerRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            const chosen = [...(event.target.files ?? [])].map((file) => ({
              file,
              path: file.webkitRelativePath || file.name,
            }));
            void upload(chosen);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          size="sm"
          pending={busy}
          onClick={() => pickerRef.current?.click()}
        >
          选择文件夹
        </Button>
        <span className="text-fg-subtle text-xs">只放判题文件，几 KB 量级。</span>
      </div>

      {files.length === 0 ? (
        <p className="text-fg-subtle text-xs">还没有文件。</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((path) => (
            <li key={path}>
              <Badge mono>{path}</Badge>
            </li>
          ))}
        </ul>
      )}

      {error ? <FormMessage tone="err">{error}</FormMessage> : null}
      {message ? (
        <p className="text-ok text-xs">{message}</p>
      ) : null}
    </div>
  );
}
