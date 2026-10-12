import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ViewState } from "../src/types";
import { api } from "./api";
import { trackNewItems } from "./fresh";
import { Undone } from "./undo";

const POLL_FOR_CHANGES_MS = 1500;

export type Update = (state: ViewState) => ViewState;

export type OptimisticSave = (showNow: Update, save: () => Promise<unknown>, failMessage: string) => Promise<boolean>;

export const OptimisticSaveContext = createContext<OptimisticSave>(async () => false);
export const useOptimisticSave = () => useContext(OptimisticSaveContext);

export function useReviewState(onSaveFailed: (message: string) => void) {
  const [state, setState] = useState<ViewState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  const serverState = useRef<ViewState | null>(null);
  const lastServerJson = useRef("");
  const unconfirmedUpdates = useRef<Update[]>([]);
  const shownState = useRef<ViewState | null>(null);
  const onSaveFailedRef = useRef(onSaveFailed);
  onSaveFailedRef.current = onSaveFailed;

  const showServerStateWithUnconfirmedUpdates = useCallback(() => {
    if (!serverState.current) return;
    const next = applyUpdatesThatStillFit(serverState.current, unconfirmedUpdates.current);
    trackNewItems(shownState.current, next);
    shownState.current = next;
    setState(next);
  }, []);

  const loadServerState = useCallback(
    async ({ evenIfUnchanged = false } = {}) => {
      try {
        const next = await api<ViewState>("/api/state");
        setLoadError(null);
        const json = JSON.stringify(next);
        const unchanged = json === lastServerJson.current;
        if (unchanged && !evenIfUnchanged) return;
        lastServerJson.current = json;
        serverState.current = next;
        showServerStateWithUnconfirmedUpdates();
      } catch (e) {
        setLoadError((e as Error).message);
      }
    },
    [showServerStateWithUnconfirmedUpdates],
  );

  const optimisticSave = useCallback<OptimisticSave>(
    async (showNow, save, failMessage) => {
      unconfirmedUpdates.current.push(showNow);
      showServerStateWithUnconfirmedUpdates();
      let saved = true;
      try {
        await save();
        await loadServerState({ evenIfUnchanged: true });
      } catch (e) {
        saved = false;
        if (!(e instanceof Undone)) onSaveFailedRef.current(`${failMessage} ${(e as Error).message}`);
      }
      unconfirmedUpdates.current = unconfirmedUpdates.current.filter((update) => update !== showNow);
      showServerStateWithUnconfirmedUpdates();
      return saved;
    },
    [loadServerState, showServerStateWithUnconfirmedUpdates],
  );

  usePollForChanges(loadServerState, setOnline);

  return { state, loadError, online, optimisticSave };
}

function applyUpdatesThatStillFit(state: ViewState, updates: Update[]): ViewState {
  return updates.reduce((current, update) => {
    try {
      return update(current);
    } catch {
      return current;
    }
  }, state);
}

function usePollForChanges(onChange: () => Promise<void>, setOnline: (online: boolean) => void) {
  useEffect(() => {
    let lastVersion = "";
    let timer: ReturnType<typeof setTimeout>;
    let polling = false;

    const poll = async () => {
      if (polling) return;
      polling = true;
      clearTimeout(timer);
      if (document.visibilityState === "visible") {
        try {
          const { version } = await api<{ version: string }>("/api/version");
          setOnline(true);
          if (version !== lastVersion) {
            lastVersion = version;
            await onChange();
          }
        } catch {
          setOnline(false);
        }
      }
      polling = false;
      timer = setTimeout(poll, POLL_FOR_CHANGES_MS);
    };

    poll();
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [onChange, setOnline]);
}
