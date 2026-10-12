import { useState } from "react";

export function usePref<T extends string>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? fallback;
    } catch {
      return fallback;
    }
  });
  const save = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {}
  };
  return [value, save];
}
