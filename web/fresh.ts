import type { ViewState } from "../src/types";
import { stableKey } from "./tempIds";

const ENTER_ANIMATION_MS = 1000;
const recentlyAdded = new Set<string>();

function itemKeys(state: ViewState): string[] {
  const threadItems = state.comments.flatMap((c) => [c.id, ...c.messages.map((m) => m.id)]);
  return [...threadItems, ...state.chat.map((m) => m.id)].map(stableKey);
}

export function trackNewItems(prev: ViewState | null, next: ViewState) {
  const isFirstLoad = prev === null;
  if (isFirstLoad) return;
  const seen = new Set(itemKeys(prev));
  const added = itemKeys(next).filter((key) => !seen.has(key));
  for (const key of added) recentlyAdded.add(key);
  setTimeout(() => added.forEach((key) => recentlyAdded.delete(key)), ENTER_ANIMATION_MS);
}

export function isNewItem(id: string): boolean {
  return recentlyAdded.has(stableKey(id));
}
