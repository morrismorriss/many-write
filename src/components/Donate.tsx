// A small "support Many Write" popup. It opens from File › Support Many Write,
// and on its own once in a while: after a few launches, then no more than
// every couple of months, and never again after "Don't ask again".

import { openUrl } from "../lib/backend";
import type { AppSettings } from "../themes/themes";
import { Close, HeartIcon } from "./icons";

/** Where the Donate button goes (empty: the button is shown as not yet available). */
export const DONATE_URL = "https://buymeacoffee.com/morriss";

/** Launches before the popup first shows itself, and days between showings after that. */
const FIRST_AFTER_LAUNCHES = 5;
const EVERY_DAYS = 60;

export type DonateState = NonNullable<AppSettings["donate"]>;

/** Count this launch; returns the new state and whether the popup should show on its own. */
export function donateOnLaunch(s: DonateState | undefined, now = Date.now()): { next: DonateState; show: boolean } {
  const cur: DonateState = { launches: 0, ...s };
  const next: DonateState = { ...cur, launches: cur.launches + 1 };
  const due = !cur.never && !!DONATE_URL && next.launches >= FIRST_AFTER_LAUNCHES && (!cur.lastShown || now - cur.lastShown > EVERY_DAYS * 86400000);
  if (due) next.lastShown = now;
  return { next, show: due };
}

export function DonateDialog({ onClose, onNever }: { onClose: () => void; onNever: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small donate" role="dialog" aria-label="Support Many Write" data-testid="donate-dialog">
        <div className="modal-head">
          <h2>
            <HeartIcon width={20} height={20} className="donate-heart" /> Support Many Write
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </div>
        <p>Many Write is free, has no ads and no account, and keeps your writing in plain files on your own computer.</p>
        <p>If it helps you write, a donation of any size keeps it that way and pays for new features.</p>
        {!DONATE_URL && <p className="muted small-text">Donations aren't set up yet. Thank you for thinking of it!</p>}
        <div className="modal-foot">
          <button className="btn ghost" onClick={onNever} data-testid="donate-never">
            Don't ask again
          </button>
          <button className="btn ghost" onClick={onClose}>
            Not now
          </button>
          <button
            className="btn primary"
            disabled={!DONATE_URL}
            data-testid="donate-go"
            onClick={() => {
              void openUrl(DONATE_URL);
              onClose();
            }}
          >
            <HeartIcon /> Donate
          </button>
        </div>
      </div>
    </div>
  );
}
