let counter = 0;

/** Unique id that also works in non-secure contexts (where crypto.randomUUID is missing). */
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}
