import { useState } from "react";
import { createPortal } from "react-dom";
import { Close } from "./icons";

interface Props {
  title: string;
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

/** The text of a footnote or endnote, with the same inline markdown the editor uses. */
export function NoteDialog({ title, initial, onSave, onCancel, onDelete }: Props) {
  const [text, setText] = useState(initial);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="modal small"
        role="dialog"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(text);
        }}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Close">
            <Close />
          </button>
        </div>
        <label className="field">
          <span>Note</span>
          <textarea autoFocus rows={5} value={text} placeholder="The note text" onChange={(e) => setText(e.target.value)} data-testid="note-text" />
        </label>
        <p className="muted small-text">*italic*, **bold** and _underline_ work here.</p>
        <div className="modal-foot">
          {onDelete && (
            <button className="btn" style={{ marginRight: "auto" }} onClick={onDelete} data-testid="note-delete">
              Delete
            </button>
          )}
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onSave(text)} data-testid="note-save">
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
