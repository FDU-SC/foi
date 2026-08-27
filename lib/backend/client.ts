import { readTextBody } from "@/lib/body-limit";
import { envFragment } from "./env";
import { type ResolvedBackend } from "./resolve";
import { signedHeaders } from "./signature";
import { type BackendActionRequest } from "./types";

const MAX_RESPONSE_BYTES = 256 * 1024;

const NO_REDIRECT = "manual" as const;

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function signedRequest(
  backend: ResolvedBackend,
  method: string,
  path: string,
  body: string,
): { url: URL; headers: Record<string, string> } {
  if (!backend.url) {
    throw new Error(
      `题目后端 "${backend.id}" 声明了交互动作但没有地址，请设置 FOI_BACKEND_${envFragment(backend.id)}_URL`,
    );
  }

  const url = new URL(path, backend.url);
  return {
    url,
    headers: signedHeaders(backend.secret, {
      method,
      path: url.pathname + url.search,
      body,
    }),
  };
}

export interface BackendActionResponse {
  status: number;
  contentType: string;
  body: string;
}

const RELAYABLE_CONTENT_TYPES = [
  "application/json",
  "text/plain",
  "application/octet-stream",
] as const;

function relayableContentType(header: string | null): string {
  if (!header) return "application/json";

  const type = header.split(";")[0].trim().toLowerCase();
  return (RELAYABLE_CONTENT_TYPES as readonly string[]).includes(type)
    ? header
    : "application/octet-stream";
}

export async function callBackendAction(
  backend: ResolvedBackend,
  request: BackendActionRequest,
): Promise<BackendActionResponse> {
  const body = JSON.stringify(request);
  const { url, headers } = signedRequest(
    backend,
    "POST",
    `/action/${encodeURIComponent(request.action)}`,
    body,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body,
      redirect: NO_REDIRECT,
      signal: AbortSignal.timeout(backend.replyTimeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: timedOut ? "题目后端响应超时" : "无法连接题目后端",
      }),
    };
  }

  if (isRedirect(res.status)) {

    await res.body?.cancel().catch(() => {});
    return {
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "题目后端返回了重定向" }),
    };
  }

  const read = await readTextBody(res, MAX_RESPONSE_BYTES);
  if (!read.ok) {

    return {
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "题目后端响应过大" }),
    };
  }

  return {
    status: res.status,
    contentType: relayableContentType(res.headers.get("content-type")),
    body: read.text,
  };
}
