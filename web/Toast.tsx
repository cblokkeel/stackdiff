import { useCallback, useEffect, useRef, useState } from "react";

interface ToastAction {
  label: string;
  key?: string;
  onClick: () => void;
}

interface ToastState {
  id: number;
  message: string;
  error: boolean;
  action?: ToastAction;
  leaving: boolean;
}

export interface ToastOptions {
  error?: boolean;
  action?: ToastAction;
  ms?: number;
}

type Hold = "hover" | "hidden";

const SHOW_MS = 3000;
const SHOW_ERROR_MS = 6000;
const EXIT_MS = 200;

let nextId = 0;

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const countdown = useRef({ remaining: 0, startedAt: 0, running: false });
  const holds = useRef(new Set<Hold>());

  const leave = useCallback(() => {
    countdown.current = { remaining: 0, startedAt: 0, running: false };
    setToast((t) => t && { ...t, leaving: true });
    timer.current = setTimeout(() => setToast(null), EXIT_MS);
  }, []);

  const run = useCallback(() => {
    const c = countdown.current;
    if (c.running || c.remaining <= 0 || holds.current.size > 0) return;
    c.running = true;
    c.startedAt = Date.now();
    timer.current = setTimeout(leave, c.remaining);
  }, [leave]);

  const current = useRef(0);

  const show = useCallback(
    (message: string, { error = false, action, ms }: ToastOptions = {}) => {
      clearTimeout(timer.current);
      holds.current.delete("hover");
      const id = ++nextId;
      current.current = id;
      setToast({ id, message, error, action, leaving: false });
      countdown.current = { remaining: ms ?? (error ? SHOW_ERROR_MS : SHOW_MS), startedAt: 0, running: false };
      run();
      return id;
    },
    [run],
  );

  /** Shows `message` only if toast `id` is still the one on screen, so a late update can't hide a newer toast. */
  const replace = useCallback(
    (id: number, message: string) => {
      if (current.current === id) show(message);
    },
    [show],
  );

  const hold = useCallback(
    (reason: Hold, on: boolean) => {
      const c = countdown.current;
      if (!on) {
        holds.current.delete(reason);
        run();
        return;
      }
      holds.current.add(reason);
      if (c.running) {
        clearTimeout(timer.current);
        c.running = false;
        c.remaining -= Date.now() - c.startedAt;
      }
    },
    [run],
  );

  useEffect(() => {
    const onVisibility = () => hold("hidden", document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [hold]);

  return { toast, show, replace, hold };
}

export function Toast({ toast, onHover }: { toast: ToastState | null; onHover: (on: boolean) => void }) {
  if (!toast) return null;
  return (
    <div
      key={toast.id}
      className={`toast ${toast.leaving ? "leaving" : ""} ${toast.error ? "toast-error" : ""}`}
      role="status"
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        <path
          className="draw"
          pathLength={1}
          d={toast.error ? "M4 4 10 10M10 4 4 10" : "M3 7.5 5.75 10 11 4"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {toast.message}
      {toast.action && (
        <button className="toast-action" onClick={toast.action.onClick}>
          {toast.action.label}
          {toast.action.key && <kbd>{toast.action.key}</kbd>}
        </button>
      )}
    </div>
  );
}
