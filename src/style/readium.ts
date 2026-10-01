import after from "@readium/css/css/dist/ReadiumCSS-after.css";
import before from "@readium/css/css/dist/ReadiumCSS-before.css";
import fallback from "@readium/css/css/dist/ReadiumCSS-default.css";

/**
 * The ReadiumCSS sheets. `before` goes ahead of the author's sheets and
 * `after` behind them. `fallback` is for a document with no sheet of
 * its own, and it goes nowhere else.
 */
export const READIUM: { before: string; fallback: string; after: string } = {
  before,
  fallback,
  after,
};
