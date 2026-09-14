import { setIcon } from "obsidian";
import { useEffect, useRef, type JSX } from "react";

/** The preview's icon. The book note's page draws a different one. */
export const PREVIEW_ICON = "book-open";

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
