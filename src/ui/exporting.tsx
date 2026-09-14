/**
 * Draws the export dialog: where the file goes, the preflight, and the
 * write. The PDF comes from the session that drew the preview, so the
 * dialog lays nothing out.
 */

import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState, type JSX } from "react";
import type { Destination } from "@/assets/destination";
import type { ExportResult } from "@/engine/export";
import { Icon } from "@/ui/icon";
import { standing, type Blocker, type Checked } from "@/ui/preflight";

export type Stage = "preflight" | "refused" | "ready" | "writing" | "written" | "failed";

/** The actions the dialog asks the modal to perform. */
export interface Exporter {
  /** The file name and the vault path the dialog starts from. */
  prepare(): Promise<{ name: string; path: string }>;
  /** Runs the preflight on the book as it stands now. */
  check(): Promise<Checked>;
  /** Told after each render of the book lands. Returns the way to stop. */
  watch(changed: () => void): () => void;
  /** Asks the OS for a path on disk. Undefined when the author cancels. */
  choose(name: string): Promise<string | undefined>;
  write(destination: Destination): Promise<ExportResult>;
  /** Opens a file the export wrote into the vault. */
  open(path: string): void;
  /** Goes to the place an error names. */
  fix(blocker: Blocker): void;
  close(): void;
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
  const [name, setName] = useState("");
  const [destination, setDestination] = useState<Destination>({ kind: "vault", path: "" });
  const [checked, setChecked] = useState<Checked | undefined>(undefined);
  const [result, setResult] = useState<ExportResult | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const staged = useRef<Stage>(stage);
  staged.current = stage;

  useEffect(() => {
    let live = true;
    const check = async (): Promise<void> => {
      const found = await exporter.check();
      if (!live) return;
      const now = staged.current;
      if (now === "writing" || now === "written") return;
      setChecked(found);
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
      setFailure(said(cause));
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

  // The suite waits on these, so they are written after the commit.
  useEffect(() => {
    marked.dataset["state"] = stage;
    marked.dataset["errors"] = String(checked?.errors.length ?? 0);
    if (result === undefined) {
      delete marked.dataset["leaves"];
      delete marked.dataset["bytes"];
    } else {
      marked.dataset["leaves"] = String(result.leaves);
      marked.dataset["bytes"] = String(result.bytes);
    }
  }, [marked, stage, checked, result]);

  const write = async (): Promise<void> => {
    setFailure(undefined);
    setStage("writing");
    try {
      setResult(await exporter.write(destination));
      setStage("written");
    } catch (cause) {
      setFailure(said(cause));
      setStage("failed");
    }
  };

  const choose = async (): Promise<void> => {
    const chosen = await exporter.choose(name);
    if (chosen !== undefined) setDestination({ kind: "disk", path: chosen });
  };

  const writing = stage === "writing";
  const errors = checked?.errors ?? [];
  const file = fileName(destination.path);

  if (stage === "written" && result !== undefined) {
    return (
      <div className="orca-export" data-testid="orca-export-written">
        <div className="orca-export-done">
          <Icon name="check" className="orca-export-done-icon" />
          <div className="orca-export-done-name">{file}</div>
          <div className="orca-export-done-size">
            {pages(result.leaves)} · {size(result.bytes)}
          </div>
          <div className="orca-export-done-said">
            Drawn from the pages already on screen. The book was not typeset again.
          </div>
        </div>
        <div className="modal-button-container orca-export-footer">
          {destination.kind === "vault" ? (
            <button
              type="button"
              data-testid="orca-export-open"
              onClick={() => {
                exporter.open(destination.path);
                exporter.close();
              }}
            >
              Open
            </button>
          ) : null}
          <button type="button" className="mod-cta" onClick={() => exporter.close()}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="orca-export">
      <div className="orca-export-group">
        <div className="orca-export-row">
          <span className="orca-export-label">Save to</span>
          <input
            type="text"
            className="orca-export-destination"
            data-testid="orca-export-destination"
            data-kind={destination.kind}
            spellCheck={false}
            value={destination.path}
            disabled={writing}
            onChange={(event) => {
              setDestination({ kind: "vault", path: event.currentTarget.value });
            }}
          />
          <button
            type="button"
            data-testid="orca-export-choose"
            disabled={writing}
            onClick={() => {
              void choose();
            }}
          >
            Choose…
          </button>
        </div>
        <div className="orca-export-hint">
          A path in the vault, or a path on disk from the Choose button. The name comes from the book's title.
        </div>
      </div>

      <div className="orca-export-divider" />

      <div className="orca-export-group" data-testid="orca-export-preflight">
        <div className="orca-export-heading">Preflight</div>
        {checked === undefined ? (
          <div className="orca-export-checking">Checking the book.</div>
        ) : null}
        {errors.map((blocker, at) => (
          <Card key={at} blocker={blocker} exporter={exporter} />
        ))}
        {checked?.fine === undefined ? null : (
          <div className="orca-export-fine" data-testid="orca-export-fine">
            <Icon name="check" className="orca-export-fine-icon" />
            <span>{checked.fine}</span>
          </div>
        )}
      </div>

      {writing ? (
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
          ) : writing ? (
            <>
              Writing <span className="orca-export-mono">{file}</span> from the pages on screen.
            </>
          ) : null}
        </div>
        <button type="button" disabled={writing} onClick={() => exporter.close()}>
          Cancel
        </button>
        <button
          type="button"
          className="mod-cta"
          data-testid="orca-export-write"
          disabled={stage !== "ready" && !(stage === "failed" && errors.length === 0 && checked !== undefined)}
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

/** The line a failed export shows. A typed error carries words meant for the author. */
function said(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return `The export did not write: ${message}`;
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
