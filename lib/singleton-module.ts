export interface SingletonModule {

  path: string;
  exports: Record<string, unknown>;
}

export function loadSingletonModule(
  modules: Record<string, unknown>,
  what: string,
): SingletonModule | null {
  const paths = Object.keys(modules).sort();
  if (paths.length === 0) return null;

  if (paths.length > 1) {
    throw new Error(`${what}只能声明一处，却找到了 ${paths.join("、")}`);
  }

  const path = paths[0]!;
  return { path, exports: modules[path] as Record<string, unknown> };
}

export function requiredExport(
  found: SingletonModule,
  name: string,
  hint: string,
): unknown {
  const value = found.exports[name];
  if (value === undefined) {
    throw new Error(`${found.path} 必须导出名为 ${name} 的常量，${hint}`);
  }
  return value;
}
