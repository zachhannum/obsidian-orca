/**
 * A probe of a phone's font routes. It is not for main: it answers
 * whether the web view honours a range, and what a scan costs.
 */

import { MANAGED_FONTS, fontDirectories, scanFonts } from "@/assets/fonts";
import { phoneFonts, type PhoneRoutes } from "@/assets/phone";

const SYSTEM = "/System/Library/Fonts";
const ASKED = 12;

interface Count {
  ranged: number;
  whole: number;
  partial: number;
  full: number;
  other: number;
  bytes: number;
  files: Set<string>;
}

function counting(routes: PhoneRoutes, count: Count): PhoneRoutes {
  return {
    list: (url) => routes.list(url),
    fetch: async (path, range) => {
      if (range === undefined) count.whole += 1;
      else count.ranged += 1;
      count.files.add(path);
      const body = await routes.fetch(path, range);
      if (body.status === 206) count.partial += 1;
      else if (body.status === 200) count.full += 1;
      else count.other += 1;
      count.bytes += body.bytes.length;
      return body;
    },
  };
}

function fresh(): Count {
  return { ranged: 0, whole: 0, partial: 0, full: 0, other: 0, bytes: 0, files: new Set() };
}

function said(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The first font file under a directory, one folder deep. */
async function firstFont(routes: PhoneRoutes): Promise<string | undefined> {
  const files = phoneFonts(routes);
  const top = await files.list(SYSTEM);
  for (const directory of [SYSTEM, ...top.folders]) {
    const listing = directory === SYSTEM ? top : await files.list(directory);
    const font = listing.files.find((file) => /\.(ttf|otf|ttc)$/i.test(file));
    if (font !== undefined) return font;
  }
  return undefined;
}

async function oneRange(routes: PhoneRoutes, lines: string[]): Promise<void> {
  lines.push("## One range", "");
  try {
    const font = await firstFont(routes);
    if (font === undefined) {
      lines.push("no font file found to ask", "");
      return;
    }
    const began = performance.now();
    const ranged = await routes.fetch(font, { at: 0, length: ASKED });
    const took = Math.round(performance.now() - began);
    lines.push(
      `file: ${font}`,
      `asked: bytes=0-${ASKED - 1}`,
      `status: ${ranged.status}`,
      `bytes returned: ${ranged.bytes.length}`,
      `took: ${took} ms`,
    );
    const whole = await routes.fetch(font);
    lines.push(`whole file: status ${whole.status}, ${whole.bytes.length} bytes`, "");
  } catch (error) {
    lines.push(`failed: ${said(error)}`, "");
  }
}

async function oneScan(
  routes: PhoneRoutes,
  title: string,
  directories: readonly string[],
  byBytes: boolean,
  lines: string[],
): Promise<void> {
  lines.push(`## Scan of ${title}`, "");
  const count = fresh();
  try {
    const began = performance.now();
    const found = await scanFonts(
      phoneFonts(counting(routes, count)),
      directories,
      "platform",
      { byBytes },
    );
    const took = Math.round(performance.now() - began);
    lines.push(
      `took: ${took} ms`,
      `faces: ${found.faces.length}, refused: ${found.refused.length}`,
      `files fetched: ${count.files.size}`,
      `requests: ${count.ranged} ranged, ${count.whole} whole`,
      `answers: ${count.partial} with 206, ${count.full} with 200, ${count.other} other`,
      `bytes fetched: ${count.bytes}`,
      "",
    );
  } catch (error) {
    lines.push(`failed: ${said(error)}`, "");
  }
}

/** The probe's report, as the text of a note. */
export async function probeFonts(
  routes: PhoneRoutes | undefined,
  device: string,
): Promise<string> {
  const lines = ["# Orca font range probe", "", device, ""];
  if (routes === undefined) {
    lines.push("The window has no Capacitor routes.");
    return lines.join("\n");
  }
  await oneRange(routes, lines);
  await oneScan(routes, "the system fonts", fontDirectories("ios", ""), false, lines);
  await oneScan(routes, "the managed fonts", [MANAGED_FONTS], true, lines);
  return lines.join("\n");
}
