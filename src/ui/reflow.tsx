/**
 * Draws the EPUB view: the engine's EPUB in a frame the size of a
 * device's screen, paged by ReadiumCSS, with the device, the reader
 * settings and the turns on the preview's bar.
 *
 * The frame is sandboxed without scripts, so nothing a book carries
 * runs. The device, the settings and the place are state here and
 * nowhere else, so they last as long as the pane.
 */

import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from "react";
import type { Reflowable, Stages } from "@/engine/session";
import {
  DEVICES,
  READER_ALIGNMENTS,
  READER_DEFAULTS,
  READER_FONTS,
  READER_MARGINS,
  READER_SIZE_MAX,
  READER_SIZE_MIN,
  READER_SIZE_STEP,
  READER_SPACINGS,
  READER_THEMES,
  readerVariables,
  type Device,
  type ReaderSettings,
} from "@/style/reader";
import { READIUM } from "@/style/readium";
import { Segment, Select, classes } from "@/ui/controls";
import {
  bindFiles,
  fitted,
  rewriteDocument,
  stepOf,
  turnedBy,
  type Box,
  type Place,
} from "@/ui/frame";
import { Icon } from "@/ui/icon";

/** A book's EPUB files, and what the render they were written from cost. */
export interface Reflowed {
  book: Reflowable;
  stages: Stages;
}

/** The parts of the preview the EPUB view draws into besides its own host. */
export interface ReflowSlots {
  /** The node on the preview's bar that takes the view's controls. */
  controls: HTMLElement;
  /** Writes the section and screen being read into the window's status bar. */
  reading(text: string): void;
}

export interface MountedReflow {
  /** Draws a book's EPUB, or nothing, which releases every URL the last one was bound to. */
  draw(shown: Reflowed | undefined): void;
  /** Turns by `step` screens. */
  turn(step: number): void;
  unmount(): void;
}

/** The turn the mounted view answers, which the component sets once it has a place. */
interface Turner {
  turn: ((step: number) => void) | undefined;
}

/** The value the lists give a setting left to the publisher. */
const PUBLISHER = "publisher";

/** The device a pane opens on. */
const OPENS_ON: Device["id"] = "reader";

/** The room between the settings and the edge of the bar, in pixels. */
const GUTTER = 12;

/** Mounts the EPUB view in `host`, with its controls in the bar's slot. */
export function mountReflow(host: HTMLElement, slots: ReflowSlots): MountedReflow {
  const root = createRoot(host);
  const turner: Turner = { turn: undefined };
  const draw = (shown: Reflowed | undefined): void => {
    root.render(<Reflow shown={shown} host={host} slots={slots} turner={turner} />);
  };
  draw(undefined);
  return {
    draw,
    turn: (step) => turner.turn?.(step),
    unmount: () => {
      root.unmount();
    },
  };
}

/** The files of one generation, bound to URLs. */
interface Bound {
  generation: number;
  stages: Stages;
  documents: string[];
}

function Reflow({
  shown,
  host,
  slots,
  turner,
}: {
  shown: Reflowed | undefined;
  host: HTMLElement;
  slots: ReflowSlots;
  turner: Turner;
}): JSX.Element | null {
  const [deviceId, setDeviceId] = useState(OPENS_ON);
  const [settings, setSettings] = useState<ReaderSettings>(READER_DEFAULTS);
  const [place, setPlace] = useState<Place>({ section: 0, screen: 0 });
  const [bound, setBound] = useState<Bound | undefined>(undefined);
  /** The URL of the document the frame has finished loading. */
  const [loaded, setLoaded] = useState<string | undefined>(undefined);
  /** Raised when the frame's faces arrive, which can move its screens. */
  const [faces, setFaces] = useState(0);
  const [screens, setScreens] = useState(1);
  const [well, setWell] = useState<Box>({ width: 0, height: 0 });
  const pane = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const device = DEVICES.find((each) => each.id === deviceId);
  const sections = bound?.documents.length ?? 0;
  const src = bound?.documents[place.section];
  const ready = src !== undefined && loaded === src;

  // A blob URL holds its bytes until it is released, so the URLs of one
  // generation go when the next is bound and when the view is left.
  useEffect(() => {
    if (shown === undefined) {
      setBound(undefined);
      return;
    }
    const made = bindFiles(
      shown.book,
      READIUM,
      (body, type) =>
        URL.createObjectURL(
          new Blob([typeof body === "string" ? body : new Uint8Array(body)], { type }),
        ),
      (url) => {
        URL.revokeObjectURL(url);
      },
      rewriteDocument,
    );
    setBound({
      generation: shown.book.generation,
      stages: shown.stages,
      documents: made.documents,
    });
    // An edit can leave the book with fewer sections than the reader
    // was into.
    setPlace((at) =>
      at.section < made.documents.length
        ? at
        : { section: Math.max(made.documents.length - 1, 0), screen: 0 },
    );
    return made.revoke;
  }, [shown]);

  useEffect(() => {
    const watching = new ResizeObserver(() => {
      setWell({ width: host.clientWidth, height: host.clientHeight });
    });
    watching.observe(host);
    return () => {
      watching.disconnect();
    };
  }, [host]);

  // ReadiumCSS lays a document out as columns one screen wide, so a
  // screen is a scroll of one frame width. The count is read after the
  // settings are on the root, since each of them can move it. The e2e
  // suite waits on the attributes, so they are written here, once
  // React has committed the frame they describe.
  useLayoutEffect(() => {
    const element = pane.current;
    const root = frame.current?.contentDocument?.documentElement;
    if (!ready || element === null || root === undefined || device === undefined) return;
    if (bound === undefined) return;
    for (const [name, value] of readerVariables(settings)) {
      if (value === undefined) root.style.removeProperty(name);
      else root.style.setProperty(name, value);
    }
    const scroller = root.ownerDocument.scrollingElement ?? root;
    const count = Math.max(Math.round(scroller.scrollWidth / device.width), 1);
    const screen = place.screen === "last" ? count - 1 : Math.min(place.screen, count - 1);
    scroller.scrollLeft = screen * device.width;
    setScreens(count);
    if (screen !== place.screen) setPlace({ section: place.section, screen });

    const data = element.dataset;
    data["generation"] = String(bound.generation);
    data["stageStyle"] = String(bound.stages.style);
    data["stageLines"] = String(bound.stages.lines);
    data["stageFlow"] = String(bound.stages.flow);
    data["stagePaint"] = String(bound.stages.paint);
    data["device"] = device.id;
    data["section"] = String(place.section + 1);
    data["sections"] = String(bound.documents.length);
    data["screen"] = String(screen + 1);
    data["screens"] = String(count);
    slots.reading(
      `section ${String(place.section + 1)} of ${String(bound.documents.length)} · ` +
        `screen ${String(screen + 1)} of ${String(count)}`,
    );
  }, [ready, bound, settings, device, place, faces, slots]);

  const turn = (step: number): void => {
    if (!ready || place.screen === "last") return;
    const to = turnedBy({ section: place.section, screen: place.screen }, step, screens, sections);
    if (to !== undefined) setPlace(to);
  };
  const turns = (step: number): boolean =>
    ready &&
    place.screen !== "last" &&
    turnedBy({ section: place.section, screen: place.screen }, step, screens, sections) !==
      undefined;

  useEffect(() => {
    turner.turn = turn;
    return () => {
      turner.turn = undefined;
    };
  });

  if (shown === undefined || device === undefined) return null;
  const scale = fitted(device, well);
  return (
    <>
      <div ref={pane} className="orca-reflow" data-testid="orca-reflow">
        {src === undefined ? null : (
          <div
            className="orca-reflow-screen"
            style={{ width: device.width * scale, height: device.height * scale }}
          >
            <iframe
              ref={frame}
              className="orca-reflow-frame"
              data-testid="orca-reflow-frame"
              title="EPUB"
              sandbox="allow-same-origin"
              src={src}
              style={{
                width: device.width,
                height: device.height,
                transform: `scale(${String(scale)})`,
              }}
              onLoad={(event) => {
                const inside = event.currentTarget.contentDocument;
                if (inside === null) return;
                // The frame takes the focus on a click, and its keys
                // never reach the pane.
                inside.addEventListener("keydown", (pressed) => {
                  const step = stepOf(pressed.key);
                  if (step === undefined) return;
                  pressed.preventDefault();
                  turner.turn?.(step);
                });
                void inside.fonts.ready.then(() => {
                  setFaces((seen) => seen + 1);
                });
                setLoaded(inside.URL);
              }}
            />
          </div>
        )}
      </div>
      {createPortal(
        <>
          <Settings bar={slots.controls} settings={settings} settle={setSettings} />
          <select
            className="dropdown orca-reflow-device"
            aria-label="Device"
            data-testid="orca-reflow-device"
            value={device.id}
            onChange={(event) => {
              const chosen = DEVICES.find((each) => each.id === event.target.value);
              if (chosen !== undefined) setDeviceId(chosen.id);
            }}
          >
            {DEVICES.map((each) => (
              <option key={each.id} value={each.id}>
                {`${each.label} · ${String(each.width)} × ${String(each.height)}`}
              </option>
            ))}
          </select>
          <div className="orca-preview-divider" />
          <button
            type="button"
            className="clickable-icon"
            aria-label="Previous screen"
            data-testid="orca-reflow-previous"
            disabled={!turns(-1)}
            onClick={() => {
              turn(-1);
            }}
          >
            <Icon name="chevron-left" className="orca-reflow-icon" />
          </button>
          <button
            type="button"
            className="clickable-icon"
            aria-label="Next screen"
            data-testid="orca-reflow-next"
            disabled={!turns(1)}
            onClick={() => {
              turn(1);
            }}
          >
            <Icon name="chevron-right" className="orca-reflow-icon" />
          </button>
        </>,
        slots.controls,
      )}
    </>
  );
}

/** Draws the button that opens the reader settings, and the settings under it. */
function Settings({
  bar,
  settings,
  settle,
}: {
  bar: HTMLElement;
  settings: ReaderSettings;
  settle: (settings: ReaderSettings) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [hung, setHung] = useState<{ top: number; right: number } | undefined>(undefined);
  const opener = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  // The settings shut on Escape, and on a press in the window that is
  // neither on them nor on the button that opens them.
  useEffect(() => {
    if (!open) return;
    const page = bar.ownerDocument;
    const pressed = (event: PointerEvent): void => {
      const at = event.target;
      if (!(at instanceof Node)) return;
      if (popover.current?.contains(at) === true || opener.current?.contains(at) === true) return;
      setOpen(false);
    };
    const keyed = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setOpen(false);
      opener.current?.focus();
    };
    page.addEventListener("pointerdown", pressed);
    page.addEventListener("keydown", keyed);
    return () => {
      page.removeEventListener("pointerdown", pressed);
      page.removeEventListener("keydown", keyed);
    };
  }, [open, bar]);

  // The settings hang under their button with their right edges in
  // line. A bar too narrow for that keeps them inside itself, so a
  // narrow pane cuts none of them off.
  useLayoutEffect(() => {
    const button = opener.current;
    const hanging = popover.current;
    const from = hanging?.offsetParent;
    if (!open || button === null || hanging === null || from === null || from === undefined) {
      return;
    }
    const edge = from.getBoundingClientRect();
    const under = button.getBoundingClientRect();
    const room = Math.max(edge.width - hanging.offsetWidth - GUTTER, GUTTER);
    setHung({
      top: under.bottom - edge.top + 4,
      right: Math.min(Math.max(edge.right - under.right, GUTTER), room),
    });
  }, [open]);

  const set = (change: Partial<ReaderSettings>): void => {
    settle({ ...settings, ...change });
  };
  const spacing = settings.spacing === undefined ? PUBLISHER : String(settings.spacing);
  return (
    <>
      <button
        ref={opener}
        type="button"
        className={classes("clickable-icon", open && "is-active")}
        aria-label="Reader settings"
        aria-expanded={open}
        data-testid="orca-reflow-settings"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <Icon name="sliders-horizontal" className="orca-reflow-icon" />
      </button>
      {open ? (
        <div
          ref={popover}
          className="orca-reflow-popover"
          data-testid="orca-reflow-popover"
          style={hung ?? { visibility: "hidden" }}
        >
          <Line label="Font">
            <Select
              value={settings.font}
              faint={settings.font === READER_DEFAULTS.font}
              choices={READER_FONTS}
              testid="orca-reflow-setting-font"
              settle={(value) => {
                const font = READER_FONTS.find((each) => each.value === value);
                if (font !== undefined) set({ font: font.value });
              }}
            />
          </Line>
          <Line label="Size">
            <div className="orca-panel-number">
              <input
                type="text"
                readOnly
                className={classes(
                  "orca-panel-text",
                  settings.size === READER_DEFAULTS.size && "is-default",
                )}
                aria-label="Size"
                data-testid="orca-reflow-setting-size"
                value={`${String(settings.size)}%`}
              />
              <div className="orca-panel-stepper">
                {([1, -1] as const).map((by) => {
                  const next = settings.size + by * READER_SIZE_STEP;
                  return (
                    <button
                      key={by}
                      type="button"
                      className="orca-panel-step"
                      data-testid={`orca-reflow-setting-size-${by === 1 ? "up" : "down"}`}
                      aria-label={by === 1 ? "Larger" : "Smaller"}
                      disabled={next < READER_SIZE_MIN || next > READER_SIZE_MAX}
                      onClick={() => {
                        set({ size: next });
                      }}
                    >
                      <Icon
                        name={by === 1 ? "chevron-up" : "chevron-down"}
                        className="orca-panel-icon"
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </Line>
          <Line label="Line spacing">
            <Select
              value={spacing}
              faint={settings.spacing === undefined}
              choices={READER_SPACINGS.map((each) => ({
                value: each.value === undefined ? PUBLISHER : String(each.value),
                label: each.label,
              }))}
              testid="orca-reflow-setting-spacing"
              settle={(value) => {
                const chosen = READER_SPACINGS.find((each) => String(each.value) === value);
                set({ spacing: chosen?.value });
              }}
            />
          </Line>
          <Line label="Margins">
            <Segment
              value={settings.margins}
              faint={settings.margins === READER_DEFAULTS.margins}
              choices={READER_MARGINS}
              testid="orca-reflow-setting-margins"
              settle={(value) => {
                const chosen = READER_MARGINS.find((each) => each.value === value);
                if (chosen !== undefined) set({ margins: chosen.value });
              }}
            />
          </Line>
          <Line label="Alignment">
            <Segment
              value={settings.align ?? PUBLISHER}
              faint={settings.align === undefined}
              choices={READER_ALIGNMENTS.map((each) => ({
                value: each.value ?? PUBLISHER,
                label: each.label,
              }))}
              testid="orca-reflow-setting-align"
              settle={(value) => {
                const chosen = READER_ALIGNMENTS.find((each) => each.value === value);
                set({ align: chosen?.value });
              }}
            />
          </Line>
          <Line label="Theme">
            <Segment
              value={settings.theme}
              faint={settings.theme === READER_DEFAULTS.theme}
              choices={READER_THEMES}
              testid="orca-reflow-setting-theme"
              settle={(value) => {
                const chosen = READER_THEMES.find((each) => each.value === value);
                if (chosen !== undefined) set({ theme: chosen.value });
              }}
            />
          </Line>
        </div>
      ) : null}
    </>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="orca-panel-row">
      <span className="orca-panel-label">{label}</span>
      <div className="orca-panel-controls">{children}</div>
    </div>
  );
}
