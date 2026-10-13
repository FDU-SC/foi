/**
 * One judge file as it travels to the judge.
 *
 * This is a wire contract, not an interpretation of `backend.config`: the judge
 * parses exactly this pair, and `content/_shared/judge-files.ts` produces it for
 * a problem that ships its sources in the repository. An authored problem's
 * files are rows in `problem_files` and are assembled into the same array, so
 * both kinds of problem reach the judge with the same bytes.
 *
 * JSON has no byte string, so a file travels as a string plus a tag saying how
 * to read it: absent `encoding` means `content` is the file's text, `"base64"`
 * means it is the file's bytes encoded.
 */
export interface JudgeFile {
  path: string;
  content: string;
  encoding?: "base64";
}

export const JUDGE_FILE_ENCODING = "base64";

/**
 * The `content`/`encoding` pair for these bytes, preferring text.
 *
 * The same decision `content/_shared/judge-files.ts` makes and for the same
 * reason: the test is exact rather than a sample of characters — decode as
 * UTF-8, encode back, compare. Anything that does not survive would arrive at
 * the judge as U+FFFD.
 */
export function encodeJudgeBytes(bytes: Buffer): Pick<JudgeFile, "content" | "encoding"> {
  const text = bytes.toString("utf8");
  return Buffer.from(text, "utf8").equals(bytes)
    ? { content: text }
    : { content: bytes.toString("base64"), encoding: JUDGE_FILE_ENCODING };
}

/** The bytes a stored file stands for, whichever way it was carried. */
export function decodeJudgeFile(file: JudgeFile): Buffer {
  return file.encoding === JUDGE_FILE_ENCODING
    ? Buffer.from(file.content, "base64")
    : Buffer.from(file.content, "utf8");
}

/**
 * Why this path may not be stored, or null when it may.
 *
 * A judge file is code the judge runs on a machine that also holds the
 * contestant's program. Credentials and anything that steers where a file lands
 * are therefore refused here rather than at judging time: a `.env` or a private
 * key in a problem's file set is a credential handed to every contestant who can
 * submit.
 */
export function judgePathProblem(path: string): string | null {
  if (path.length === 0) return "文件路径不能为空";
  if (path.length > 200) return "文件路径过长";
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return "文件路径必须是相对路径";
  if (path.includes("\\")) return "文件路径只能用正斜杠";
  if (path.includes("\0")) return "文件路径不能包含空字符";

  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return "文件路径不能包含空段、. 或 ..";
  }

  const lowered = path.toLowerCase();
  const base = segments[segments.length - 1]!.toLowerCase();

  if (segments[0] === ".git" || segments[0] === ".ssh") {
    return `${segments[0]} 目录不能作为判题文件上传`;
  }
  if (base === ".env" || base.startsWith(".env.")) {
    return ".env 及其变体不能作为判题文件上传";
  }
  if (/\.(?:pem|key|p12|pfx|keystore|jks)$/.test(base)) {
    return "密钥文件不能作为判题文件上传";
  }
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)$/.test(base) || base === "authorized_keys") {
    return "私钥文件不能作为判题文件上传";
  }
  if (/^\.?netrc$/.test(base) || lowered.endsWith("/credentials")) {
    return "凭据文件不能作为判题文件上传";
  }

  return null;
}

/**
 * A judge file's own consistency, independent of where it is going.
 *
 * Replaces the byte-level round trip a repository problem gets from
 * `judge-files.test.ts`: the bytes are gone by the time this runs, so what is
 * checked is that the claim about them still holds. A `base64` claim must decode,
 * and a text claim must not carry the replacement character — which is what a
 * lossy decode leaves behind, and the only trace a binary file read as text
 * leaves in a JSON string.
 */
export function judgeFileProblem(file: JudgeFile): string | null {
  const named = judgePathProblem(file.path);
  if (named) return named;

  if (file.content.length === 0) return `${file.path} 的内容为空`;

  if (file.encoding === JUDGE_FILE_ENCODING) {
    const canonical = Buffer.from(file.content, "base64").toString("base64");
    return canonical.replace(/=+$/, "") === file.content.replace(/=+$/, "")
      ? null
      : `${file.path} 声明为 base64，但内容不是合法的 base64`;
  }

  if (file.content.includes("\uFFFD")) {
    return `${file.path} 含替换字符 U+FFFD，说明它以文本方式读入了二进制内容`;
  }

  return null;
}
