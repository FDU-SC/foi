import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(import.meta.dirname, "docker-compose.yml"),
  "utf8",
);

interface ServiceBlock {
  name: string;
  source: string;
}

function serviceBlocks(compose: string): ServiceBlock[] {
  const lines = compose.split(/\r?\n/);
  const servicesAt = lines.findIndex((line) => line === "services:");
  if (servicesAt === -1) return [];

  const blocks: ServiceBlock[] = [];
  let current: ServiceBlock | undefined;

  for (const line of lines.slice(servicesAt + 1)) {
    if (/^\S/.test(line)) break;

    const service = /^  ([a-zA-Z0-9_-]+):\s*$/.exec(line);
    if (service) {
      current = { name: service[1], source: "" };
      blocks.push(current);
      continue;
    }

    if (current) current.source += `${line}\n`;
  }

  return blocks;
}

function requiredVariables(block: ServiceBlock): string[] {
  return [...block.source.matchAll(/\$\{([A-Z_][A-Z0-9_]*)(?::)?\?[^}]*\}/g)]
    .map((match) => match[1]);
}

describe("docker-compose.yml", () => {
  it("可选 profile 不在全局解析阶段强制读取变量", () => {
    const profiled = serviceBlocks(source).filter((service) =>
      /^\s{4}profiles:/m.test(service.source),
    );

    expect(profiled.map((service) => service.name)).toEqual([
      "stub-runner",
      "tunnel",
    ]);
    expect(
      profiled.flatMap((service) =>
        requiredVariables(service).map((variable) => ({
          service: service.name,
          variable,
        })),
      ),
    ).toEqual([]);
  });
});
