const SHORTCUTS: [string[], string][] = [
  [["j"], "Next chunk"],
  [["k"], "Previous chunk"],
  [["1", "2", "…"], "Go to chunk by its number"],
  [["o"], "Overview"],
  [["s"], "Send this chunk's messages & next"],
  [["a"], "Approve chunk & next (unapprove if approved)"],
  [["v"], "Show or hide “How it fits”"],
  [["f"], "Show a changed chunk's new changes or the whole chunk"],
  [["]"], "Show or hide the sidebar"],
  [["t"], "Threads"],
  [["c"], "Chat with the agent"],
  [["u"], "Undo the last send or delete"],
  [["⌘", "↵"], "Save a message"],
  [["Esc"], "Close a panel or cancel"],
  [["?"], "This list"],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keys-title"
        style={{ width: "min(380px, 100%)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-body">
          <h3 id="keys-title">Shortcuts</h3>
          <dl className="shortcut-list">
            {SHORTCUTS.map(([keys, label]) => (
              <div key={label} style={{ display: "contents" }}>
                <dt>
                  {keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
