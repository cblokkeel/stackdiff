import { useEffect, useState } from "react";
import type { ViewScreenshot } from "../src/types";

/** The chunk's screenshots as thumbnails; a click shows one full size. */
export function ChunkScreenshots({ shots }: { shots: ViewScreenshot[] }) {
  const [zoomed, setZoomed] = useState<number | null>(null);

  return (
    <section className="shots" aria-label="Screenshots">
      <div className="shots-row">
        {shots.map((shot, i) => (
          <figure key={shot.url} className="shot">
            <button className="shot-thumb" title="Show full size" onClick={() => setZoomed(i)}>
              <img src={shot.url} alt={shot.caption || `Screenshot ${i + 1}`} loading="lazy" />
            </button>
            {shot.caption && <figcaption>{shot.caption}</figcaption>}
          </figure>
        ))}
      </div>
      {zoomed !== null && shots[zoomed] && (
        <Zoomed shots={shots} index={zoomed} onGo={setZoomed} onClose={() => setZoomed(null)} />
      )}
    </section>
  );
}

function Zoomed(props: { shots: ViewScreenshot[]; index: number; onGo: (i: number) => void; onClose: () => void }) {
  const { shots, index, onGo, onClose } = props;
  const shot = shots[index]!;

  // Caught before the page's shortcuts, so `j`, `a` or Esc don't act on the chunk behind.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onGo((index + 1) % shots.length);
      else if (e.key === "ArrowLeft") onGo((index - 1 + shots.length) % shots.length);
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [index, shots.length, onGo, onClose]);

  return (
    <div className="overlay shot-zoom" role="dialog" aria-modal="true" aria-label={shot.caption || "Screenshot"} onClick={onClose}>
      <img src={shot.url} alt={shot.caption || `Screenshot ${index + 1}`} />
      <p className="shot-zoom-caption">
        {shots.length > 1 && (
          <span className="num">
            {index + 1}/{shots.length}
          </span>
        )}
        {shot.caption}
        {shots.length > 1 && <span className="hint">← → to switch, Esc to close</span>}
      </p>
    </div>
  );
}
