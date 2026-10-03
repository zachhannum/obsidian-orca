/**
 * Draws the export dialog: the formats, where the files go, the
 * preflight, and the writes. The file comes from the session that drew
 * the preview, so the dialog lays nothing out.
 */

import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState, type JSX } from "react";
import type { Destination } from "@/assets/destination";
import type { ExportResult, ExportTarget } from "@/engine/export";
import { Icon } from "@/ui/icon";
import { folderOf } from "@/ui/kept";
import { standing, type Blocker, type Checked } from "@/ui/preflight";
import type { Shareable, Shared } from "@/ui/share";

export type Stage =
  | "preflight"
  | "refused"
  | "ready"
  | "writing"
  | "written"
  /** The files are made and wait for a tap on Share. Nothing is written. */
  | "made"
  | "failed";

export type Format = ExportTarget<Record<string, never>>;

/** The actions the dialog asks the modal to perform. */
export interface Exporter {
  /** The formats the dialog lists, each ticked when it opens. */
  formats: readonly Format[];
  /**
   * The name the files share and the vault path they start from, both
   * without an extension. Each format adds its own.
   */
  prepare(): Promise<{ name: string; path: string }>;
  /** Runs the preflight on the book as it stands now. */
  check(): Promise<Checked>;
  /** Told after each render of the book lands. Returns the way to stop. */
  watch(changed: () => void): () => void;
  /**
   * Asks the OS for a folder on disk. Undefined when the author cancels.
   * Absent where the app has no disk to write to, and the dialog then
   * offers the vault path alone.
   */
  choose?(): Promise<string | undefined>;
  write(destination: Destination, format: Format): Promise<ExportResult>;
  /**
   * The share sheet. Absent on a device that cannot share a PDF, and
   * the dialog then has no Share.
   */
  share?: {
    /** True when the device shares this format's files. */
    takes(format: Format): boolean;
    /** Makes a format's file under the book's name. It is written nowhere. */
    make(name: string, format: Format): Promise<{ file: Shareable; result: ExportResult }>;
    /** Hands the files to the share sheet. Called inside a tap, it starts inside that tap. */
    hand(files: readonly Shareable[]): Promise<Shared>;
  };
  /** Opens a file the export wrote into the vault. */
  open(path: string): void;
  /** Goes to the place an error names. */
  fix(blocker: Blocker): void;
  close(): void;
}

/** One file an export wrote. */
interface Written {
  format: Format;
  destination: Destination;
  result: ExportResult;
}

/** One file made for the share sheet. */
interface Made {
  format: Format;
  file: Shareable;
  result: ExportResult;
}

export interface Mounted {
  unmount(): void;
}

/**
 * Mounts the dialog under a modal's content. `marked` is the modal's own
 * element, which carries the state the e2e suite waits on.
 */
export function mountExport(
  el: HTMLElement,
  marked: HTMLElement,
  exporter: Exporter,
): Mounted {
  const host = el.createDiv({ cls: "orca-export-host" });
  const root = createRoot(host);
  root.render(<Exporting exporter={exporter} marked={marked} />);
  return {
    unmount() {
      root.unmount();
      host.remove();
    },
  };
}

function Exporting({
  exporter,
  marked,
}: {
  exporter: Exporter;
  marked: HTMLElement;
}): JSX.Element {
  const [stage, setStage] = useState<Stage>("preflight");
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set(exporter.formats.map((format) => format.id)),
  );
  const [name, setName] = useState("");
  const [destination, setDestination] = useState<Destination>({ kind: "vault", path: "" });
  const [checked, setChecked] = useState<Checked | undefined>(undefined);
  const [writing, setWriting] = useState<string | undefined>(undefined);
  const [written, setWritten] = useState<Written[]>([]);
  const [made, setMade] = useState<Made[]>([]);
  const [handing, setHanding] = useState(false);
  // Counts the preflights, each of which follows a render of the book.
  const [edition, setEdition] = useState(0);
  const [held, setHeld] = useState<
    { edition: number; files: ReadonlyMap<string, Made> } | undefined
  >(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const staged = useRef<Stage>(stage);
  staged.current = stage;

  useEffect(() => {
    let live = true;
    const check = async (): Promise<void> => {
      const found = await exporter.check();
      if (!live) return;
      const now = staged.current;
      if (now === "writing" || now === "written" || now === "made") return;
      setChecked(found);
      setEdition((at) => at + 1);
      if (now !== "failed") setStage(found.errors.length > 0 ? "refused" : "ready");
    };
    void (async () => {
      const prepared = await exporter.prepare();
      if (!live) return;
      setName(prepared.name);
      setDestination({ kind: "vault", path: prepared.path });
      await check();
    })().catch((cause: unknown) => {
      if (!live) return;
      setFailure(said("Export", cause));
      setStage("failed");
    });
    // An author who fixes an error with the dialog open sees it go once
    // the render with the fix lands.
    const unwatch = exporter.watch(() => {
      void check().catch(() => undefined);
    });
    return () => {
      live = false;
      unwatch();
    };
  }, [exporter]);

  const formats = exporter.formats.filter((format) => ticked.has(format.id));
  const ids = formats.map((format) => format.id).join(" ");

  // The suite waits on these, so they are written after the commit.
  useEffect(() => {
    marked.dataset["state"] = stage;
    marked.dataset["formats"] = ids;
    marked.dataset["errors"] = String(checked?.errors.length ?? 0);
  }, [marked, stage, ids, checked]);

  // Each format writes in turn, because the engine holds one book and
  // answers one render at a time.
  const write = async (): Promise<void> => {
    setFailure(undefined);
    setWritten([]);
    setStage("writing");
    const done: Written[] = [];
    try {
      for (const format of formats) {
        const file = { ...destination, path: `${destination.path}.${format.extension}` };
        setWriting(fileName(file.path));
        done.push({ format, destination: file, result: await exporter.write(file, format) });
        setWritten([...done]);
      }
      setStage("written");
    } catch (cause) {
      setFailure(said("Export", cause));
      setStage("failed");
    } finally {
      setWriting(undefined);
    }
  };

  const sharing = exporter.share;
  const clean = checked !== undefined && checked.errors.length === 0;

  // The web view opens the share sheet from a tap alone, and a tap is
  // spent by the time a book is made. So the files are made as soon as
  // the book passes, and again after each render of it.
  useEffect(() => {
    if (sharing === undefined || !clean || name === "") return;
    let live = true;
    void (async () => {
      const files = new Map<string, Made>();
      try {
        for (const format of exporter.formats) {
          if (!sharing.takes(format)) continue;
          const made = await sharing.make(name, format);
          if (!live) return;
          files.set(format.id, { format, ...made });
        }
      } catch {
        // A tap on Share makes the rest, and says what failed.
      }
      if (live) setHeld({ edition, files });
    })();
    return () => {
      live = false;
    };
  }, [exporter, sharing, clean, name, edition]);

  // The share sheet's answer, in either state Share is tapped from.
  // `before` is the state a cancelled share goes back to.
  const hand = async (files: readonly Made[], before: Stage): Promise<void> => {
    if (exporter.share === undefined) return;
    setHanding(true);
    try {
      const end = await exporter.share.hand(files.map(({ file }) => file));
      if (end === "shared") exporter.close();
      else if (end === "cancelled") setStage(before);
      else {
        // The tap was spent while the files were made, so they wait
        // for one more.
        setMade([...files]);
        setStage("made");
      }
    } catch (cause) {
      setFailure(said("Share", cause));
      setStage("failed");
    } finally {
      setHanding(false);
    }
  };

  // Share hands over the same files Export writes, and writes none of
  // them. Files made ahead go to the share sheet inside the tap.
  const share = async (): Promise<void> => {
    if (exporter.share === undefined) return;
    const ahead = formats.flatMap((format) => held?.files.get(format.id) ?? []);
    if (ahead.length === formats.length) {
      await hand(ahead, stage);
      return;
    }
    setFailure(undefined);
    setStage("writing");
    const done: Made[] = [];
    try {
      for (const format of formats) {
        setWriting(`${name}.${format.extension}`);
        done.push({ format, ...(await exporter.share.make(name, format)) });
      }
    } catch (cause) {
      setFailure(said("Share", cause));
      setStage("failed");
      return;
    } finally {
      setWriting(undefined);
    }
    await hand(done, "ready");
  };

  const choose = async (): Promise<void> => {
    const folder = await exporter.choose?.();
    if (folder === undefined) return;
    const separator = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
    const trimmed = folder.endsWith(separator) ? folder.slice(0, -1) : folder;
    setDestination({ kind: "disk", path: `${trimmed}${separator}${name}` });
  };

  const tick = (format: Format, on: boolean): void => {
    const next = new Set(ticked);
    if (on) next.add(format.id);
    else next.delete(format.id);
    setTicked(next);
  };

  const busy = stage === "writing";
  const errors = checked?.errors ?? [];
  const stem = fileName(destination.path);
  // An app with no disk to choose keeps every file in the vault, and
  // the dialog says so.
  const vaulted = exporter.choose === undefined;

  const exportable =
    formats.length > 0 &&
    (stage === "ready" || (stage === "failed" && errors.length === 0 && checked !== undefined));

  if (stage === "made") {
    return (
      <div className="orca-export orca-export-written" data-testid="orca-export-made">
        {made.map(({ format, file, result }) => (
          <div
            key={format.id}
            className="orca-export-done"
            data-testid="orca-export-file"
            data-format={format.id}
            data-bytes={String(result.bytes)}
            data-leaves={result.leaves === undefined ? undefined : String(result.leaves)}
          >
            <Icon name="check" className="orca-export-done-icon" />
            <div className="orca-export-done-name">{file.name}</div>
            <div className="orca-export-done-size">{measure(result)}</div>
          </div>
        ))}
        <div className="modal-button-container orca-export-footer">
          <button
            type="button"
            className="mod-cta orca-export-share"
            data-testid="orca-export-share"
            disabled={handing}
            onClick={() => {
              void hand(made, "made");
            }}
          >
            <Icon name="share" className="orca-export-share-icon" />
            Share
          </button>
          <button type="button" data-testid="orca-export-done" onClick={() => exporter.close()}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (stage === "written") {
    const pdf = written.find(
      ({ format, destination: file }) => file.kind === "vault" && format.id === "pdf",
    );
    return (
      <div className="orca-export orca-export-written" data-testid="orca-export-written">
        {written.map(({ format, destination: file, result }) => (
          <div
            key={format.id}
            className="orca-export-done"
            data-testid="orca-export-file"
            data-format={format.id}
            data-bytes={String(result.bytes)}
            data-leaves={result.leaves === undefined ? undefined : String(result.leaves)}
          >
            <Icon name="check" className="orca-export-done-icon" />
            <div className="orca-export-done-name">{fileName(file.path)}</div>
            <div className="orca-export-done-size">
              {measure(result)}
              {vaulted ? <Kept path={file.path} /> : null}
            </div>
            {!vaulted && file.kind === "vault" && format.id === "pdf" ? (
              <button
                type="button"
                className="orca-export-done-open"
                data-testid="orca-export-open"
                onClick={() => {
                  exporter.open(file.path);
                  exporter.close();
                }}
              >
                Open
              </button>
            ) : null}
          </div>
        ))}
        <div className="modal-button-container orca-export-footer">
          {vaulted && pdf !== undefined ? (
            <button
              type="button"
              data-testid="orca-export-open"
              onClick={() => {
                exporter.open(pdf.destination.path);
                exporter.close();
              }}
            >
              Open the PDF
            </button>
          ) : null}
          <button
            type="button"
            className={vaulted ? undefined : "mod-cta"}
            data-testid="orca-export-done"
            onClick={() => exporter.close()}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="orca-export">
      <div className="orca-export-group">
        <div className="orca-export-row orca-export-formats" data-testid="orca-export-formats">
          <span className="orca-export-label">Formats</span>
          {exporter.formats.map((format) => (
            <label key={format.id} className="orca-export-format">
              <input
                type="checkbox"
                data-testid={`orca-export-format-${format.id}`}
                checked={ticked.has(format.id)}
                disabled={busy}
                onChange={(event) => {
                  tick(format, event.currentTarget.checked);
                }}
              />
              {format.label}
            </label>
          ))}
        </div>
        <div className="orca-export-row">
          <span className="orca-export-label" data-testid="orca-export-label">
            {vaulted ? "Save to this vault" : "Save to"}
          </span>
          <input
            type="text"
            className="orca-export-destination"
            data-testid="orca-export-destination"
            data-kind={destination.kind}
            spellCheck={false}
            value={destination.path}
            disabled={busy}
            onChange={(event) => {
              setDestination({ kind: "vault", path: event.currentTarget.value });
            }}
          />
          {exporter.choose === undefined ? null : (
            <button
              type="button"
              data-testid="orca-export-choose"
              disabled={busy}
              onClick={() => {
                void choose();
              }}
            >
              Choose…
            </button>
          )}
        </div>
        <div className="orca-export-files" data-testid="orca-export-files">
          {formats.map((format) => `${stem}.${format.extension}`).join(", ")}
        </div>
      </div>

      <div className="orca-export-divider" />

      <div
        className="orca-export-group orca-export-preflight"
        data-testid="orca-export-preflight"
      >
        <div className="orca-export-heading">Preflight</div>
        {checked === undefined ? (
          <div className="orca-export-checking">Checking…</div>
        ) : null}
        {errors.length === 0 ? null : (
          <div className="orca-export-list" data-testid="orca-export-list">
            {errors.map((blocker, at) => (
              <Card key={at} blocker={blocker} exporter={exporter} />
            ))}
          </div>
        )}
        {checked?.fine === undefined ? null : (
          <div className="orca-export-fine" data-testid="orca-export-fine">
            <Icon name="check" className="orca-export-fine-icon" />
            <span>{checked.fine}</span>
          </div>
        )}
      </div>

      {busy ? (
        <div className="orca-export-progress" data-testid="orca-export-progress">
          <div className="orca-export-progress-bar" />
        </div>
      ) : null}

      <div className="modal-button-container orca-export-footer">
        <div
          className={
            stage === "refused" || stage === "failed"
              ? "orca-export-said mod-error"
              : "orca-export-said"
          }
          data-testid="orca-export-said"
        >
          {stage === "refused" ? (
            standing(errors.length)
          ) : stage === "failed" ? (
            failure
          ) : writing !== undefined ? (
            <>
              Exporting <span className="orca-export-mono">{writing}</span>…
            </>
          ) : formats.length === 0 ? (
            "Pick a format to export"
          ) : null}
        </div>
        {exporter.share === undefined ? null : (
          <button
            type="button"
            className="orca-export-share"
            data-testid="orca-export-share"
            disabled={
              !exportable ||
              handing ||
              held?.edition !== edition ||
              !formats.every((format) => exporter.share?.takes(format))
            }
            onClick={() => {
              void share();
            }}
          >
            <Icon name="share" className="orca-export-share-icon" />
            Share
          </button>
        )}
        <button
          type="button"
          data-testid="orca-export-cancel"
          disabled={busy}
          onClick={() => exporter.close()}
        >
          Cancel
        </button>
        <button
          type="button"
          className="mod-cta"
          data-testid="orca-export-write"
          disabled={!exportable}
          onClick={() => {
            void write();
          }}
        >
          Export
        </button>
      </div>
    </div>
  );
}

function Card({ blocker, exporter }: { blocker: Blocker; exporter: Exporter }): JSX.Element {
  return (
    <div
      className="orca-preview-issue orca-export-error"
      data-testid="orca-export-error"
      data-kind={blocker.kind}
    >
      <Icon name="alert-circle" className="orca-export-error-icon" />
      <div>
        <div className="orca-preview-issue-said">{blocker.said}</div>
        {blocker.engine === undefined ? null : (
          <div className="orca-export-engine">{blocker.engine}</div>
        )}
        <div className="orca-export-at">
          {blocker.place} ·{" "}
          <button
            type="button"
            className="orca-preview-issue-open"
            data-testid="orca-export-fix"
            onClick={() => {
              exporter.fix(blocker);
            }}
          >
            {blocker.fix}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Says where in the vault a written file is. */
function Kept({ path }: { path: string }): JSX.Element {
  const folder = folderOf(path);
  return folder === undefined ? (
    <> · saved to this vault</>
  ) : (
    <>
      {" "}
      · saved to <span className="orca-export-mono">{folder}</span> in this vault
    </>
  );
}

/** The line a failed export or share shows. A typed error carries words meant for the author. */
function said(what: "Export" | "Share", cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return `${what} failed: ${message}`;
}

/** A file's pages, when its format has them, and its size. */
function measure(result: ExportResult): string {
  return result.leaves === undefined
    ? size(result.bytes)
    : `${pages(result.leaves)} · ${size(result.bytes)}`;
}

function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

function pages(count: number): string {
  return count === 1 ? "1 page" : `${count.toLocaleString("en")} pages`;
}

/** A file size in the unit that keeps it under a thousand. */
function size(bytes: number): string {
  if (bytes < 1000) return `${String(bytes)} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
