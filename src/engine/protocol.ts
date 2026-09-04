/**
 * Orca's own frames on the worker wire. They carry an `orca` key;
 * fleuron's requests and responses do not, and pass through untouched.
 */

/** The module, moved rather than copied. */
export interface Start {
  orca: "start";
  module: ArrayBuffer;
}

/** A worker's first reply. */
export type Started = { orca: "ready" } | { orca: "failed"; message: string };

export function isStart(message: unknown): message is Start {
  return keyed(message) === "start";
}

export function isStarted(message: unknown): message is Started {
  const key = keyed(message);
  return key === "ready" || key === "failed";
}

function keyed(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const orca = (message as { orca?: unknown }).orca;
  return typeof orca === "string" ? orca : undefined;
}
