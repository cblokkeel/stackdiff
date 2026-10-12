export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    // A send that ends an undo window on page leave must outlive the page.
    keepalive: init?.method !== undefined || init?.body !== undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
  return data as T;
}
