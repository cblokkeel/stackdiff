import { Markdown } from "./Markdown";

export function ChunkVisual(props: { source: string; open: boolean; onToggle: () => void }) {
  return (
    <section className="visual">
      <button className="visual-head" aria-expanded={props.open} onClick={props.onToggle}>
        <svg className="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path
            d="M3 4.5 6 7.5 9 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>How it fits</span>
        <span className="spacer" />
        <kbd>v</kbd>
      </button>
      {props.open && <Markdown className="visual-body" source={props.source} />}
    </section>
  );
}
