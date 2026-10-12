import { createContext, useContext } from "react";

export const UNDO_MS = 5000;

/** Thrown into a save the user took back, so it stops without an error toast. */
export class Undone extends Error {}

const closeOnLeave = new Set<() => void>();
addEventListener("pagehide", () => [...closeOnLeave].forEach((close) => close()));

/** A pause before a save. `wait` rejects with `Undone` if `undo` runs first; `undo` returns false once the pause is over. */
export function undoWindow() {
  let settle!: (undone: boolean) => void;
  const settled = new Promise<boolean>((resolve) => (settle = resolve));
  let open = true;
  const close = (undone: boolean) => {
    if (!open) return false;
    open = false;
    clearTimeout(timer);
    closeOnLeave.delete(commit);
    settle(undone);
    return true;
  };
  const commit = () => close(false);
  const timer = setTimeout(commit, UNDO_MS);
  // Leaving the page sends at once rather than dropping the action.
  closeOnLeave.add(commit);
  const wait = settled.then((undone) => {
    if (undone) throw new Undone();
  });
  return { wait, undo: () => close(true) };
}

/** Runs `act` after a pause the user can undo, with a toast saying `message` and an Undo button. */
export type Undoable = (
  message: string,
  act: (wait: Promise<void>) => Promise<boolean>,
  doneMessage?: string,
) => void;

export const UndoContext = createContext<Undoable>((_message, act) => void act(Promise.resolve()));
export const useUndoable = () => useContext(UndoContext);
