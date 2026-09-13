import type { Warning } from "fleuron";
import { isGenerated } from "@/book/plan";
import { THEME_SHEET } from "@/style/theme";

/**
 * Whether a warning is against orca's own work rather than the
 * author's. The generated matter and the generated sheet are both
 * orca's, and an author has no file to open for either, so such a
 * warning goes to the console.
 */
export function isOrcas(warning: Warning): boolean {
  const origin = warning.origin;
  return (
    origin !== null && (isGenerated(origin) || origin.startsWith(THEME_SHEET))
  );
}
