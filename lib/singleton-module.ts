/**
 * The declarations a deployment makes in exactly one file.
 *
 * The backends, the statement components, the mail copy and the default table
 * of problem views are each matched by a glob that can only produce one path,
 * and each registry has the same three steps: nothing found means fall back to
 * whatever "no declaration" means for that slot, more than one means somebody
 * widened the glob without deciding which file wins, and the single file has
 * to carry the export the kernel is going to read.
 *
 * Only the first two are shared unconditionally. What counts as a satisfactory
 * export genuinely differs — mail needs two of them and needs both to be
 * functions, the backend registry validates every key it finds — so each
 * registry keeps that part, and `requiredExport` is for the three where it is
 * one name.
 */

export interface SingletonModule {
  /** The path the glob matched, for naming in an error. */
  path: string;
  exports: Record<string, unknown>;
}

/**
 * The one module the glob matched, or null when this deployment ships none.
 *
 * `what` is the thing being declared, in the deployment's own language, and
 * lands in the message as `${what}只能声明一处`.
 */
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

/**
 * The named export, or an error saying which file has to grow one.
 *
 * `hint` points at the type the export has to satisfy, because the message is
 * read by somebody writing `content/` who has no reason to know where the
 * kernel keeps that.
 */
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
