#!/usr/bin/env node
"use strict";

// 把工作区改成公开 demo 站的样子。
//
// 每夜由 demo-nightly.yml 在 main 之上重新执行一次，结果强推到 nightly 分支。用
// 重放而不是长期分支合并：那份差异始终只有这里写的这几处，不会随时间累积冲突。
//
// 改不动就退出非零，绝不"尽力而为"。打不上的补丁意味着 main 动了这几处结构，
// 那需要人来看，不该让一个半改过的配置上线。

const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..");

const SITE = "content/site.ts";
const ENROLLMENT = "content/enrollment/example.ts";
const LEAKY_BUCKET = "content/problems/leaky-bucket/problem.ts";

function fail(message) {
  console.error(`demo 配置补丁打不上：${message}`);
  process.exit(1);
}

/**
 * 精确替换一处。命中零次或多次都算失败——多次命中说明这个模式已经不足以定位，
 * 继续替换只会改错地方。
 */
function replaceOnce(source, pattern, replacement, what) {
  const matches = source.match(new RegExp(pattern, "gm"));
  if (!matches) fail(`在 ${what} 里找不到要改的位置：${pattern}`);
  if (matches.length > 1) {
    fail(`${what} 里有 ${matches.length} 处匹配 ${pattern}，无法确定改哪一个`);
  }
  return source.replace(new RegExp(pattern, "m"), replacement);
}

function edit(relative, transform) {
  const path = join(ROOT, relative);
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    fail(`读不到 ${relative}`);
  }

  const next = transform(source, relative);
  if (next === source) fail(`${relative} 没有任何改动，补丁可能已经失效`);
  writeFileSync(path, next, "utf8");
  console.log(`  已改写 ${relative}`);
}

function demoAccountHint() {
  const password = process.env.FOI_DEMO_PASSWORD;
  const count = Number(process.env.FOI_DEMO_ACCOUNT_COUNT ?? 5);
  if (!password) fail("缺少环境变量 FOI_DEMO_PASSWORD，首页要公示演示账号的密码");
  if (!Number.isInteger(count) || count < 1) fail("FOI_DEMO_ACCOUNT_COUNT 不是正整数");

  return `用 demo1 到 demo${count} 登录，密码 ${password}。数据每晚重置。`;
}

function patchSite(source, what) {
  let next = source;

  next = replaceOnce(next, '^  name: ".*",$', '  name: "FOI Demo",', what);
  next = replaceOnce(
    next,
    '^  title: ".*",$',
    '  title: "FOI 竞赛平台 · 演示",',
    what,
  );
  next = replaceOnce(
    next,
    '^  description: ".*",$',
    '  description: "开源竞赛平台 FOI 的演示站点，数据每晚重置。",',
    what,
  );

  // 首页入口卡片是现成的位置，放演示账号说明不需要动平台的任何组件。
  next = replaceOnce(
    next,
    "^  homeEntries: \\[$",
    [
      "  homeEntries: [",
      "    {",
      '      href: "/login",',
      '      title: "演示账号",',
      `      description: "${demoAccountHint()}",`,
      "    },",
    ].join("\n"),
    what,
  );

  return next;
}

function patchLeakyBucket(source, what) {
  // 这道题要选手打一台真靶机才能拿到 flag，demo 上没有靶机编排器，流程走不完。
  return replaceOnce(
    source,
    "^(  maxScore: \\d+,)$",
    "$1\n  retired: true,",
    what,
  );
}

function patchEnrollment(source, what) {
  const pattern =
    '^  \\{\\n    label: "[^"\\n]+",\\n    uids: \\[[^\\]\\n]+\\],\\n' +
    "    groups: \\[[^\\]\\n]+\\],\\n  \\},\\n?";
  const matches = source.match(new RegExp(pattern, "gm"));
  if (!matches) fail(`在 ${what} 里找不到按 uid 分配的用户组`);
  return source.replace(new RegExp(pattern, "gm"), "");
}

function main() {
  console.log("套用 demo 配置补丁：");
  edit(SITE, patchSite);
  edit(ENROLLMENT, patchEnrollment);
  edit(LEAKY_BUCKET, patchLeakyBucket);
  console.log("完成。");
}

main();
