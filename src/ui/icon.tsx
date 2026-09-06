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
  const held = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (held.current !== null) setIcon(held.current, name);
  }, [name]);
  return <span ref={held} className={className} />;
}
