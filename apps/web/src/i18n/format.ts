/** `{name}` placeholder interpolation (no dictionaries imported: safe for client bundles). */
export type Vars = Readonly<Record<string, string | number>>;

/** Fills `{name}` placeholders. Unknown placeholders are left visible to catch mistakes. */
export function format(template: string, vars: Vars = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.hasOwn(vars, key) ? String(vars[key]) : whole,
  );
}
