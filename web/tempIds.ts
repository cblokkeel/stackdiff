let count = 0;
const tempOf = new Map<string, string>();
const realOf = new Map<string, string>();
const created = new Map<string, { promise: Promise<string>; resolve: (id: string) => void; reject: (e: Error) => void }>();

export function tempId(): string {
  const id = `tmp-${++count}`;
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  promise.catch(() => {}); // A failed create already shows its own error.
  created.set(id, { promise, resolve, reject });
  return id;
}

export const isTemp = (id: string) => id.startsWith("tmp-");

export function rememberRealId(realId: string, temp: string) {
  tempOf.set(realId, temp);
  realOf.set(temp, realId);
  created.get(temp)?.resolve(realId);
}

export function forgetTempId(temp: string, error: Error) {
  created.get(temp)?.reject(error);
}

export function stableKey(id: string): string {
  return tempOf.get(id) ?? id;
}

/** The id the shown state uses now: the real one once the server has answered. */
export function currentId(id: string): string {
  return realOf.get(id) ?? id;
}

/** The server's id, waiting for the create to finish if needed, so you can act on a thread the moment it shows. */
export function serverId(id: string): Promise<string> {
  if (!isTemp(id)) return Promise.resolve(id);
  return created.get(id)?.promise ?? Promise.reject(new Error(`Unknown id ${id}`));
}
