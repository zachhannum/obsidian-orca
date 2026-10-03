/**
 * A probe for the system share sheet: each way the mobile app could
 * hand a PDF to it is looked for, and the report says which ones the
 * web view has and what each one answers.
 *
 * The probe reaches past Obsidian's typed API on purpose, because the
 * question is what the web view can reach at all.
 */

import { ButtonComponent, Modal, Notice, apiVersion, type App } from "obsidian";

/** The file the probe writes into the vault, so a route that takes a path has one. */
const PROBE_FILE = "orca-share-probe.pdf";

/** One empty page, small enough to read in the report's source. */
const PDF = [
  "%PDF-1.4",
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj",
  "trailer<</Root 1 0 R>>",
  "%%EOF",
  "",
].join("\n");

/** Capacitor's Share plugin, none of it in Obsidian's types. */
interface Sharing {
  canShare?: () => Promise<{ value?: unknown }>;
  share?: (options: Record<string, unknown>) => Promise<unknown>;
}

/** The part of Capacitor the probe asks. */
interface Capacitor {
  isPluginAvailable?: (name: string) => boolean;
  Plugins?: Record<string, unknown> & {
    Share?: Sharing;
    Filesystem?: { getUri?: (options: Record<string, unknown>) => Promise<{ uri?: unknown }> };
    Device?: { getInfo(): Promise<Record<string, unknown>> };
    App?: { getInfo(): Promise<Record<string, unknown>> };
  };
}

/** The vault adapter, with the members the mobile one has beyond the typed ones. */
interface Adapter {
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  remove(path: string): Promise<void>;
  getFullPath?: (path: string) => string;
  getResourcePath?: (path: string) => string;
}

/** One way of handing the file over, run from a tap. */
interface Route {
  name: string;
  share(): Promise<unknown>;
}

function said(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  if (typeof cause === "string") return cause;
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

function capacitor(): Capacitor | undefined {
  return (window as unknown as { Capacitor?: Capacitor }).Capacitor;
}

function pdfFile(): File {
  return new File([PDF], PROBE_FILE, { type: "application/pdf" });
}

/** The names on an object and its prototypes that mention sharing or opening a file. */
function named(target: unknown, pattern: RegExp): string[] {
  const found = new Set<string>();
  let at: unknown = target;
  while (typeof at === "object" && at !== null && at !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(at)) if (pattern.test(name)) found.add(name);
    at = Object.getPrototypeOf(at);
  }
  return [...found].sort();
}

async function device(): Promise<string[]> {
  const lines = [`Obsidian API ${apiVersion}`];
  const plugins = capacitor()?.Plugins;
  for (const [name, plugin] of [
    ["Device", plugins?.Device],
    ["App", plugins?.App],
  ] as const) {
    try {
      if (plugin !== undefined) lines.push(`${name}: ${JSON.stringify(await plugin.getInfo())}`);
    } catch (cause) {
      lines.push(`${name}: refused, ${said(cause)}`);
    }
  }
  return lines;
}

/** The answers of the web view's own share calls before anything is shared. */
function webShare(): string[] {
  const lines = [
    "## navigator",
    `secure context: ${String(window.isSecureContext)}`,
    `typeof navigator.share: ${typeof navigator.share}`,
    `typeof navigator.canShare: ${typeof navigator.canShare}`,
  ];
  if (typeof navigator.canShare !== "function") return lines;
  const asked: [string, ShareData][] = [
    ["a PDF file", { files: [pdfFile()] }],
    ["a PDF file and a title", { files: [pdfFile()], title: PROBE_FILE }],
    ["a text file", { files: [new File(["probe"], "probe.txt", { type: "text/plain" })] }],
    ["text alone", { text: "probe" }],
  ];
  for (const [name, data] of asked) {
    try {
      lines.push(`canShare, ${name}: ${String(navigator.canShare(data))}`);
    } catch (cause) {
      lines.push(`canShare, ${name}: threw, ${said(cause)}`);
    }
  }
  return lines;
}

/** The share calls Capacitor and Obsidian's own objects offer by name. */
async function offered(app: App): Promise<string[]> {
  const lines = ["## Capacitor"];
  const host = capacitor();
  if (host === undefined) lines.push("no window.Capacitor");
  else {
    lines.push(`plugins: ${Object.keys(host.Plugins ?? {}).sort().join(", ")}`);
    try {
      lines.push(`isPluginAvailable("Share"): ${String(host.isPluginAvailable?.("Share"))}`);
    } catch (cause) {
      lines.push(`isPluginAvailable("Share"): threw, ${said(cause)}`);
    }
    const share = host.Plugins?.Share;
    lines.push(`typeof Plugins.Share: ${typeof share}`);
    try {
      if (share?.canShare !== undefined) {
        lines.push(`Share.canShare(): ${JSON.stringify(await share.canShare())}`);
      }
    } catch (cause) {
      lines.push(`Share.canShare(): refused, ${said(cause)}`);
    }
  }
  const pattern = /share|openWith|showInFolder|export/i;
  lines.push(
    "",
    "## Obsidian",
    `app: ${named(app, pattern).join(", ")}`,
    `vault: ${named(app.vault, pattern).join(", ")}`,
    `adapter: ${named(app.vault.adapter, pattern).join(", ")}`,
    `workspace: ${named(app.workspace, pattern).join(", ")}`,
    `window: ${named(window, /share/i).join(", ")}`,
  );
  return lines;
}

/** The probe file in the vault, and each address the device gives it. */
async function written(app: App): Promise<{ lines: string[]; addresses: string[] }> {
  const adapter = app.vault.adapter as unknown as Adapter;
  const lines = ["## The file in the vault"];
  const addresses: string[] = [];
  try {
    await adapter.writeBinary(PROBE_FILE, new TextEncoder().encode(PDF).buffer);
    lines.push(`wrote ${PROBE_FILE}`);
  } catch (cause) {
    lines.push(`write: refused, ${said(cause)}`);
    return { lines, addresses };
  }
  for (const [name, address] of [
    ["getFullPath", () => adapter.getFullPath?.(PROBE_FILE)],
    ["getResourcePath", () => adapter.getResourcePath?.(PROBE_FILE)],
  ] as const) {
    try {
      const at = address();
      lines.push(`adapter.${name}: ${String(at)}`);
      if (name === "getFullPath" && typeof at === "string") addresses.push(at);
    } catch (cause) {
      lines.push(`adapter.${name}: threw, ${said(cause)}`);
    }
  }
  const full = addresses[0];
  if (full !== undefined && !/^[a-z]+:\/\//i.test(full)) addresses.push(`file://${full}`);
  return { lines, addresses };
}

/** Each way of sharing the file that the device has, in the order the dialog offers them. */
function routes(addresses: readonly string[]): Route[] {
  const found: Route[] = [];
  if (typeof navigator.share === "function") {
    found.push(
      { name: "navigator.share, file", share: () => navigator.share({ files: [pdfFile()] }) },
      {
        name: "navigator.share, file and title",
        share: () => navigator.share({ files: [pdfFile()], title: PROBE_FILE }),
      },
    );
  }
  const share = capacitor()?.Plugins?.Share?.share;
  if (share !== undefined) {
    for (const address of addresses) {
      found.push(
        { name: `Capacitor Share, files ${address}`, share: () => share({ files: [address] }) },
        { name: `Capacitor Share, url ${address}`, share: () => share({ url: address }) },
      );
    }
  }
  return found;
}

/** The report up to the first tap, as text to paste into the issue. */
async function probeShare(app: App): Promise<{ report: string; found: Route[] }> {
  const lines = ["# Share probe", ...(await device()), "", ...webShare(), ""];
  lines.push(...(await offered(app)), "");
  const file = await written(app);
  lines.push(...file.lines, "", "## Shares");
  return { report: lines.join("\n"), found: routes(file.addresses) };
}

class Report extends Modal {
  constructor(
    app: App,
    private report: string,
    private found: readonly Route[],
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("Share probe");
    const text = this.contentEl.createEl("textarea", { text: this.report });
    text.readOnly = true;
    text.rows = 14;
    text.setCssProps({ width: "100%" });
    const add = (line: string): void => {
      this.report += `\n${line}`;
      text.value = this.report;
      text.scrollTop = text.scrollHeight;
    };
    if (this.found.length === 0) add("no route to try");
    // A share is only allowed from a tap, so each route has a button
    // of its own and the report grows by one line a tap.
    const tries = this.contentEl.createDiv();
    for (const route of this.found) {
      new ButtonComponent(tries).setButtonText(route.name).onClick(() => {
        const began = Date.now();
        const took = (): string => `${String(Date.now() - began)} ms`;
        let answer: Promise<unknown>;
        try {
          answer = route.share();
        } catch (cause) {
          add(`${route.name}: threw, ${said(cause)}`);
          return;
        }
        answer.then(
          (result) => {
            add(`${route.name}: resolved after ${took()}, ${said(result ?? "nothing")}`);
          },
          (cause: unknown) => {
            add(`${route.name}: rejected after ${took()}, ${said(cause)}`);
          },
        );
      });
    }
    const buttons = this.contentEl.createDiv("modal-button-container");
    new ButtonComponent(buttons)
      .setButtonText("Copy")
      .setCta()
      .onClick(() => {
        void navigator.clipboard.writeText(this.report).then(
          () => new Notice("Copied the report."),
          () => {
            text.select();
            new Notice("The clipboard refused. The report is selected.");
          },
        );
      });
  }

  override onClose(): void {
    this.contentEl.empty();
    const adapter = this.app.vault.adapter as unknown as Adapter;
    void adapter.remove(PROBE_FILE).catch(() => undefined);
  }
}

/** Runs the probe and shows what it found. */
export async function showProbe(app: App): Promise<void> {
  const { report, found } = await probeShare(app);
  new Report(app, report, found).open();
}
