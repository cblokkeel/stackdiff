import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const highlightOffMainThread = { workerFactory: () => new DiffsWorker(), poolSize: 4 };

createRoot(document.getElementById("root")!).render(
  <WorkerPoolContextProvider poolOptions={highlightOffMainThread} highlighterOptions={{ lineDiffType: "word-alt" }}>
    <App />
  </WorkerPoolContextProvider>,
);
