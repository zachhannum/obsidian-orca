import { setIcon } from "obsidian";
import { useEffect, useRef, type JSX } from "react";

/**
 * The preview's icon. The book note's page draws a different one, and
 * Obsidian's reading view toggle, beside it on a note, draws `book-open`.
 */
export const PREVIEW_ICON = "scan-eye";

/** Draws an Obsidian icon into the node after the commit. */
export function Icon({
  name,
  className,
}: {
  name: string;
  className?: string;
}): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current !== null) setIcon(ref.current, name);
  }, [name]);
  return <span ref={ref} className={className} />;
}
