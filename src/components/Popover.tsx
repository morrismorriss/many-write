import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const GAP = 4;
const EDGE = 8;

interface Props {
  /** The element the popover hangs from (usually the .menu-anchor around its button). */
  anchor: RefObject<HTMLElement | null>;
  /** "left": the popover's left edge lines up with the anchor's; "right": right edges line up. */
  align?: "left" | "right";
  className?: string;
  children: ReactNode;
  /** Set to the popover's own element, so outside-click handlers can ignore clicks inside it. */
  panelRef?: RefObject<HTMLDivElement | null>;
  onMouseLeave?: () => void;
  "data-testid"?: string;
}

/**
 * A menu or panel drawn on top of the whole window. It is rendered into
 * document.body, so the panes' own stacking and clipping (the editor is
 * isolated, the preview hides its overflow) can't put it behind a neighbour.
 * It stays inside the window and scrolls when it is taller than the space below its button.
 */
export function Popover({ anchor, align = "left", className = "", children, panelRef, onMouseLeave, ...rest }: Props) {
  const own = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? own;
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const w = el.offsetWidth;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = align === "right" ? a.right - w : a.left;
      left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
      const top = a.bottom + GAP;
      const maxHeight = Math.max(120, vh - top - EDGE);
      setStyle((s) => (s.top === top && s.left === left && s.maxHeight === maxHeight ? s : { position: "fixed", top, left, right: "auto", maxHeight, overflowY: "auto" }));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    if (ro && ref.current) ro.observe(ref.current);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      ro?.disconnect();
    };
  }, [anchor, align, ref]);

  return createPortal(
    <div ref={ref} className={`menu popover ${className}`} style={style} onMouseLeave={onMouseLeave} data-testid={rest["data-testid"]}>
      {children}
    </div>,
    document.body,
  );
}
