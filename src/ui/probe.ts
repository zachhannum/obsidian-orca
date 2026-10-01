/**
 * A probe for the fonts a phone carries: each way the mobile app could
 * list and read a file outside the vault is tried against the system's
 * font directory, and the report says which ones answered.
 *
 * The probe reaches past Obsidian's typed API on purpose, because the
 * question is what the web view can reach at all.
 */

import { ButtonComponent, Modal, Notice, apiVersion, type App } from "obsidian";

/** The directory iOS keeps its own faces in. */
const SYSTEM_FONTS = "/System/Library/Fonts";

/**
 * Files iOS has kept under the directory. A route that reads but
 * cannot list is still tried against these.
 */
const KNOWN_FILES = [
  "Core/Helvetica.ttc",
  "Core/HelveticaNeue.ttc",
  "Core/Times.ttc",
  "Core/Courier.ttc",
  "Core/Menlo.ttc",
  "Core/SFUI.ttf",
  "CoreUI/SFUI.ttf",
  "CoreAddition/Georgia.ttf",
];

/**
 * Folders a font installed on the phone might be kept in. None is
 * documented, so a refusal on all of them settles nothing by itself.
 */
const INSTALLED = [
  "/private/var/mobile/Library/Fonts",
  "/private/var/mobile/Library/UserFonts",
  "/Library/Fonts",
  "/private/var/MobileAsset/AssetsV2/com_apple_MobileAsset_Font7",
  "/private/var/MobileAsset/AssetsV2/com_apple_MobileAsset_Font8",
  "/private/var/containers/Shared/SystemGroup",
  "/private/var/mobile/Library/ConfigurationProfiles",
  "/private/var/mobile/Library",
];

const FONT_FILE = /\.(ttf|otf|ttc|otc)$/i;

/** The depth a listing follows folders to, and the entries a route's report shows. */
const DEPTH = 2;
const SHOWN = 12;

/** One way of reaching a file outside the vault. */
interface Route {
  name: string;
  /** The paths under a directory, a folder marked by a trailing slash where the route can tell. */
  list(directory: string): Promise<string[]>;
  read(file: string): Promise<Uint8Array>;
}

/** The part of Capacitor the probe asks, none of it in Obsidian's types. */
interface Capacitor {
  convertFileSrc?: (path: string) => string;
  Plugins?: {
    Filesystem?: {
      readdir(options: { path: string }): Promise<{ files: unknown[] }>;
      readFile(options: { path: string }): Promise<{ data: unknown }>;
    };
    Device?: { getInfo(): Promise<Record<string, unknown>> };
    App?: { getInfo(): Promise<Record<string, unknown>> };
  };
}

/** The vault adapter, with the members the mobile one has beyond the typed ones. */
interface Adapter {
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  readBinary(path: string): Promise<ArrayBuffer>;
  getFullPath?: (path: string) => string;
  getBasePath?: () => string;
  fs?: {
    readdir?: (path: string) => Promise<unknown>;
    readBinary?: (path: string) => Promise<ArrayBuffer>;
    read?: (path: string) => Promise<unknown>;
  };
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

function fromBase64(data: string): Uint8Array {
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at++) bytes[at] = text.charCodeAt(at);
  return bytes;
}

async function bytesOf(data: unknown): Promise<Uint8Array> {
  if (typeof data === "string") return fromBase64(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new Error(`the read answered with ${typeof data}`);
}

/** The names in a directory listing, whichever shape the route answers in. */
function names(listing: unknown): string[] {
  const entries = Array.isArray(listing)
    ? (listing as unknown[])
    : ((listing as { files?: unknown[] } | null)?.files ?? []);
  return entries.map((entry) => {
    if (typeof entry === "string") return entry;
    const { name, type } = entry as { name?: string; type?: string };
    return `${name ?? "?"}${type === "directory" ? "/" : ""}`;
  });
}

/** The vault adapter's own path, climbed out of the vault with `..`. */
function climbing(adapter: Adapter): Route | undefined {
  const base = adapter.getBasePath?.() ?? adapter.getFullPath?.("");
  if (base === undefined) return undefined;
  const depth = base.replace(/^[a-z]+:\/\//i, "").split("/").filter(Boolean).length;
  const out = (path: string): string => `${"../".repeat(depth)}${path.replace(/^\//, "")}`;
  return {
    name: `adapter, climbing ${String(depth)} folders out of ${base}`,
    list: async (directory) => {
      const { files, folders } = await adapter.list(out(directory));
      return [...folders.map((folder) => `${folder}/`), ...files];
    },
    read: async (file) => new Uint8Array(await adapter.readBinary(out(file))),
  };
}

function routes(app: App): Route[] {
  const adapter = app.vault.adapter as unknown as Adapter;
  const capacitor = (window as unknown as { Capacitor?: Capacitor }).Capacitor;
  const found: Route[] = [
    {
      name: "adapter, absolute path",
      list: async (directory) => {
        const { files, folders } = await adapter.list(directory);
        return [...folders.map((folder) => `${folder}/`), ...files];
      },
      read: async (file) => new Uint8Array(await adapter.readBinary(file)),
    },
  ];
  const climbed = climbing(adapter);
  if (climbed !== undefined) found.push(climbed);
  const inner = adapter.fs;
  if (inner !== undefined) {
    found.push({
      name: "adapter.fs",
      list: async (directory) => {
        if (inner.readdir === undefined) throw new Error("adapter.fs has no readdir");
        return names(await inner.readdir(directory)).map((name) => `${directory}/${name}`);
      },
      read: async (file) => {
        if (inner.readBinary !== undefined) return new Uint8Array(await inner.readBinary(file));
        if (inner.read === undefined) throw new Error("adapter.fs has no read");
        return bytesOf(await inner.read(file));
      },
    });
  }
  const files = capacitor?.Plugins?.Filesystem;
  if (files !== undefined) {
    for (const scheme of ["", "file://"]) {
      found.push({
        name: `Capacitor Filesystem, ${scheme === "" ? "bare path" : "file URL"}`,
        list: async (directory) =>
          names(await files.readdir({ path: scheme + directory })).map(
            (name) => `${directory}/${name}`,
          ),
        read: async (file) => bytesOf((await files.readFile({ path: scheme + file })).data),
      });
    }
  }
  const source = capacitor?.convertFileSrc;
  if (source !== undefined) {
    found.push({
      name: "request of convertFileSrc",
      list: () => Promise.reject(new Error("a request lists nothing")),
      // The web view's own loader is the route under test, and
      // `requestUrl` leaves the web view for the native client.
      read: (file) =>
        new Promise((resolve, reject) => {
          const request = new XMLHttpRequest();
          request.open("GET", source(file));
          request.responseType = "arraybuffer";
          request.onload = () => {
            if (request.status >= 200 && request.status < 300) {
              resolve(new Uint8Array(request.response as ArrayBuffer));
            } else reject(new Error(`status ${String(request.status)}`));
          };
          request.onerror = () => {
            reject(new Error("the request failed"));
          };
          request.send();
        }),
    });
  }
  return found;
}

/** The font files a route lists under the directory, and every entry it saw. */
async function listed(
  route: Route,
  root = SYSTEM_FONTS,
  deep = DEPTH,
): Promise<{ seen: string[]; fonts: string[] }> {
  const seen: string[] = [];
  let folders = [root];
  for (let depth = 0; depth <= deep; depth++) {
    const next: string[] = [];
    for (const folder of folders) {
      let entries: string[];
      try {
        entries = await route.list(folder);
      } catch (cause) {
        // The top folder's failure is the route's answer. A folder
        // under it that will not list leaves the rest standing.
        if (depth === 0) throw cause;
        continue;
      }
      for (const entry of entries) {
        seen.push(entry);
        const path = entry.replace(/\/$/, "");
        if (!FONT_FILE.test(path)) next.push(path);
      }
    }
    folders = next;
  }
  return { seen, fonts: seen.filter((entry) => FONT_FILE.test(entry)) };
}

/** The size of a file and its first four bytes, which name the font format. */
async function reading(route: Route, file: string): Promise<string> {
  const bytes = await route.read(file);
  const head = [...bytes.subarray(0, 4)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${String(bytes.length)} bytes, opens ${head}`;
}

async function tried(route: Route): Promise<string[]> {
  const lines = [`## ${route.name}`];
  let fonts: string[] = [];
  try {
    const { seen, fonts: found } = await listed(route);
    fonts = found;
    lines.push(`list: ${String(seen.length)} entries, ${String(found.length)} font files`);
    for (const entry of seen.slice(0, SHOWN)) lines.push(`  ${entry}`);
  } catch (cause) {
    lines.push(`list: refused, ${said(cause)}`);
  }
  const files = [
    ...fonts.slice(0, 2),
    ...KNOWN_FILES.map((file) => `${SYSTEM_FONTS}/${file}`),
  ];
  let read = 0;
  for (const file of files) {
    try {
      lines.push(`read ${file}: ${await reading(route, file)}`);
      // Two files that read settle the route.
      if (++read === 2) break;
    } catch (cause) {
      lines.push(`read ${file}: refused, ${said(cause)}`);
    }
  }
  return lines;
}

/**
 * Each folder an installed font might be in, listed through the routes
 * that reach outside the vault.
 */
async function installed(found: readonly Route[]): Promise<string[]> {
  const lines = ["## Installed fonts"];
  const readers = found.filter((each) => /file URL|convertFileSrc/.test(each.name));
  for (const route of found.filter((each) => each.name.includes("file URL"))) {
    lines.push(`through ${route.name}`);
    for (const folder of INSTALLED) {
      try {
        const { seen, fonts } = await listed(route, folder, 3);
        lines.push(
          `list ${folder}: ${String(seen.length)} entries, ${String(fonts.length)} font files`,
        );
        const shown = fonts.length > 0 ? fonts : seen;
        for (const entry of shown.slice(0, SHOWN)) lines.push(`  ${entry}`);
        // An installed face is kept under a name with no extension,
        // so a file with none is read to see what it opens with.
        const files =
          fonts.length > 0
            ? fonts
            : seen.filter((entry) => !entry.endsWith("/") && !/\.\w+$/.test(entry));
        for (const file of files.slice(0, 2)) {
          for (const reader of readers) {
            try {
              lines.push(`read ${file} by ${reader.name}: ${await reading(reader, file)}`);
            } catch (cause) {
              lines.push(`read ${file} by ${reader.name}: refused, ${said(cause)}`);
            }
          }
        }
      } catch (cause) {
        lines.push(`list ${folder}: refused, ${said(cause)}`);
      }
    }
  }
  return lines;
}

/**
 * True when the web view draws text in the family rather than in a
 * fallback. The family's text is measured over each generic face, and
 * a width that differs from the generic's own means the family drew.
 */
function draws(family: string): boolean {
  const context = createEl("canvas").getContext("2d");
  if (context === null) return false;
  const width = (font: string): number => {
    context.font = `72px ${font}`;
    return context.measureText("mmmmmmmmlliWQ@ 0123").width;
  };
  return ["monospace", "serif", "sans-serif"].some(
    (generic) => width(`"${family}", ${generic}`) !== width(generic),
  );
}

async function device(): Promise<string[]> {
  const lines = [`Obsidian API ${apiVersion}`];
  const plugins = (window as unknown as { Capacitor?: Capacitor }).Capacitor?.Plugins;
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

/** The report, as text to paste into the issue. */
export async function probeFonts(app: App): Promise<string> {
  const lines = ["# System fonts probe", ...(await device())];
  const found = routes(app);
  for (const route of found) lines.push("", ...(await tried(route)));
  lines.push("", ...(await installed(found)));
  return lines.join("\n");
}

class Report extends Modal {
  constructor(
    app: App,
    private report: string,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("System fonts probe");
    const text = this.contentEl.createEl("textarea", { text: this.report });
    text.readOnly = true;
    text.rows = 16;
    text.setCssProps({ width: "100%" });
    const family = this.contentEl.createEl("input", {
      type: "text",
      placeholder: "A family installed on the phone",
    });
    family.setCssProps({ width: "100%" });
    const buttons = this.contentEl.createDiv("modal-button-container");
    new ButtonComponent(buttons).setButtonText("Check the family").onClick(() => {
      const name = family.value.trim();
      if (name === "") return;
      const answer = draws(name) ? "drawn" : "not drawn, the fallback showed";
      this.report += `\nweb view, family "${name}": ${answer}`;
      text.value = this.report;
    });
    new ButtonComponent(buttons).setButtonText("Copy").setCta().onClick(() => {
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
  }
}

/** Runs the probe and shows what it found. */
export async function showProbe(app: App): Promise<void> {
  new Report(app, await probeFonts(app)).open();
}
