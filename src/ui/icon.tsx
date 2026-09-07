import { setIcon } from "obsidian";
import { useEffect, useRef, type JSX } from "react";

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
