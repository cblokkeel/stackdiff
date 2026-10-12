export function pluralWord(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

export function plural(n: number, word: string): string {
  return `${n} ${pluralWord(n, word)}`;
}

export function lineLabel(start: number, end: number): string {
  return start === end ? `L${start}` : `L${start}–${end}`;
}

export function timeAgo(iso: string): string {
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}
