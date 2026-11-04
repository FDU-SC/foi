#!/usr/bin/env node
"use strict";

// Plain CommonJS: the runner image has no TypeScript runtime. The derivation
// comes from the same file lib/ uses, so the printed key is the one the
// platform verifies against.

const { deriveBackendSecret } = require("../lib/backend/keys.cjs");

// Mirrors SLUG_PATTERN in lib/utils.ts.
const SLUG = /^[a-z0-9-]+$/;

const USAGE = `用法:
  node scripts/backend-key.cjs <backendId>...

每个后端输出一行 FOI_BACKEND_<ID>_SECRET=<密钥>，即由 FOI_BACKEND_SECRET 派生的队列密钥，
可以直接写进评测机的 .env。需要环境变量 FOI_BACKEND_SECRET。

只领取评测任务的评测机，可以改用运维台签发的令牌：每台宿主一个，能单独吊销。`;

class CliError extends Error {}

function bail(message) {
  throw new CliError(message);
}

function envFragment(id) {
  return id.replace(/-/g, "_").toUpperCase();
}

function keyLines(ids, env) {
  if (ids.length === 0) bail(USAGE);

  const invalid = ids.filter((id) => !SLUG.test(id));
  if (invalid.length > 0) {
    bail(`后端 id 只能包含小写字母、数字和连字符：${invalid.join(" ")}`);
  }

  const master = env.FOI_BACKEND_SECRET;
  if (!master) bail("缺少环境变量 FOI_BACKEND_SECRET");

  return ids.map(
    (id) => `FOI_BACKEND_${envFragment(id)}_SECRET=${deriveBackendSecret(master, id)}`,
  );
}

function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE);
    return;
  }
  for (const line of keyLines(argv, env)) console.log(line);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}
