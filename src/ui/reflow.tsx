/**
 * Draws the EPUB view: the engine's EPUB in a frame the size of a
 * device's screen, paged by ReadiumCSS, with the device, the reader
 * settings and the turns on the preview's bar.
 *
 * The frame is sandboxed without scripts, so nothing a book carries
 * runs. The device and the settings open as the plugin kept them, and
 * each change is reported for the plugin to keep. Nothing here writes.
 */

import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from "react";
import type { Reflowable, Stages } from "@/engine/session";
import {
  DEVICES,
  DEVICE_GROUPS,
  READER_ALIGNMENTS,
  READER_DEFAULTS,
  READER_FONTS,
  READER_LABELS,
  READER_MARGINS,
  READER_SIZE_MAX,
  READER_SIZE_MIN,
  READER_SIZE_STEP,
  READER_SPACINGS,
  READER_THEMES,
  READER_VERTICALS,
  deviceBox,
  readerInset,
  readerPage,
  readerSizeStep,
  readerVariables,
  type ReaderSettings,
  type ReaderStored,
} from "@/style/reader";
import { READIUM } from "@/style/readium";
import { Segment, Select, classes } from "@/ui/controls";
import {
  bindFiles,
  fitted,
  rewriteDocument,
  stepOf,
  swipeOf,
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
  /** The device and the settings the view opens with. */
  stored: ReaderStored;
  /** Told the device and the settings after each change, so the plugin keeps them. */
  keeps(stored: ReaderStored): void;
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

/** The room between the settings and the edge of the bar, in pixels. */
const GUTTER = 12;

/** Mounts the EPUB view in `host`, with its controls in the bar's slot. */
export function mountReflow(host: HTMLElement, slots: ReflowSlots): MountedReflow {
  const root = createRoot(host);
  const turner: Turner = { turn: undefined };
  const draw = (shown: Reflowed | undefined): void => {
    root.render(<Reflow shown={shown} slots={slots} turner={turner} />);
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
  slots,
  turner,
}: {
  shown: Reflowed | undefined;
  slots: ReflowSlots;
  turner: Turner;
}): JSX.Element | null {
  const [deviceId, setDeviceId] = useState(slots.stored.device);
  const [settings, setSettings] = useState<ReaderSettings>(slots.stored.settings);
  const [place, setPlace] = useState<Place>({ section: 0, screen: 0 });
  const [bound, setBound] = useState<Bound | undefined>(undefined);
  /** The URL of the document the frame has finished loading. */
  const [loaded, setLoaded] = useState<string | undefined>(undefined);
  /** Raised when the frame's faces arrive, which can move its screens. */
  const [faces, setFaces] = useState(0);
  const [screens, setScreens] = useState(1);
  const [well, setWell] = useState<Box>({ width: 0, height: 0 });
  const pane = useRef<HTMLDivElement>(null);
  const room = useRef<HTMLDivElement>(null);
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

  // The device fits the room the status line leaves it, so the room is
  // what is measured.
  const showing = shown !== undefined;
  const swipe = useRef<HTMLDivElement>(null);
  const from = useRef<{ x: number; y: number }>(undefined);
  // Obsidian reads touches for its drawers, so a touch that lands on the
  // overlay is kept from it.
  useEffect(() => {
    const element = swipe.current;
    if (element === null) return;
    const keep = (touched: Event): void => {
      touched.stopPropagation();
    };
    const names = ["touchstart", "touchmove", "touchend", "touchcancel"] as const;
    for (const name of names) element.addEventListener(name, keep);
    return () => {
      for (const name of names) element.removeEventListener(name, keep);
    };
  }, [showing, src]);
  useEffect(() => {
    const element = room.current;
    if (element === null) return;
    const watching = new ResizeObserver(() => {
      setWell({ width: element.clientWidth, height: element.clientHeight });
    });
    watching.observe(element);
    return () => {
      watching.disconnect();
    };
  }, [showing]);

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
    slots.reading(reading(place.section, bound.documents.length, screen, count));
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
  const body = deviceBox(device);
  const scale = fitted(body, well);
  const inset = readerInset(settings, device);
  const dark = settings.theme === "dark";
  return (
    <>
      <div ref={pane} className="orca-reflow" data-testid="orca-reflow">
        <div ref={room} className="orca-reflow-room">
          {src === undefined ? null : (
            <div
              className="orca-reflow-fit"
              style={{ width: body.width * scale, height: body.height * scale }}
            >
              <div
                className={`orca-reflow-body mod-${device.kind}`}
                data-testid="orca-reflow-body"
                style={{
                  width: body.width,
                  height: body.height,
                  padding:
                    `${String(device.bezel.top)}px ${String(device.bezel.right)}px ` +
                    `${String(device.bezel.bottom)}px ${String(device.bezel.left)}px`,
                  borderRadius: device.radius + device.bezel.left,
                  transform: `scale(${String(scale)})`,
                }}
              >
                {device.camera === "bezel" ? (
                  <div
                    className="orca-reflow-camera"
                    style={{ top: device.bezel.top / 2 }}
                  />
                ) : null}
                <div
                  className={classes("orca-reflow-screen", dark && "mod-dark")}
                  data-testid="orca-reflow-screen"
                  style={{
                    width: device.width,
                    height: device.height,
                    paddingTop: inset.top,
                    borderRadius: device.radius,
                    background: readerPage(settings),
                  }}
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
                      height: device.height - inset.top - inset.bottom,
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
                  <div
                    ref={swipe}
                    className="orca-reflow-swipe"
                    data-testid="orca-reflow-swipe"
                    onPointerDown={(pressed) => {
                      from.current = { x: pressed.clientX, y: pressed.clientY };
                      pressed.currentTarget.setPointerCapture(pressed.pointerId);
                      // The overlay takes the click, so the frame is given the
                      // focus its keys need.
                      frame.current?.contentWindow?.focus();
                    }}
                    onPointerUp={(released) => {
                      const start = from.current;
                      from.current = undefined;
                      if (start === undefined) return;
                      const step = swipeOf(released.clientX - start.x, released.clientY - start.y);
                      if (step !== undefined) turner.turn?.(step);
                    }}
                    onPointerCancel={() => {
                      from.current = undefined;
                    }}
                  />
                  {device.camera === "island" || device.camera === "hole" ? (
                    <div className={`orca-reflow-camera mod-${device.camera}`} />
                  ) : null}
                  {device.safe.bottom > 0 ? <div className="orca-reflow-home" /> : null}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="orca-reflow-status" data-testid="orca-reflow-status">
          {ready && place.screen !== "last"
            ? reading(place.section, sections, Math.min(place.screen, screens - 1), screens)
            : ""}
        </div>
      </div>
      {createPortal(
        <>
          <Settings
            bar={slots.controls}
            settings={settings}
            settle={(next) => {
              setSettings(next);
              slots.keeps({ device: deviceId, settings: next });
            }}
          />
          <select
            className="dropdown orca-reflow-device"
            aria-label="Device"
            data-testid="orca-reflow-device"
            value={device.id}
            onChange={(event) => {
              const chosen = DEVICES.find((each) => each.id === event.target.value);
              if (chosen === undefined) return;
              setDeviceId(chosen.id);
              slots.keeps({ device: chosen.id, settings });
            }}
          >
            {DEVICE_GROUPS.map((group) => (
              <optgroup key={group.kind} label={group.label}>
                {DEVICES.filter((each) => each.kind === group.kind).map((each) => (
                  <option key={each.id} value={each.id}>
                    {`${each.label} · ${String(each.width)} × ${String(each.height)}`}
                  </option>
                ))}
              </optgroup>
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

/** The reader's place as the status line says it, counting from 1. */
function reading(section: number, sections: number, screen: number, screens: number): string {
  return (
    `section ${String(section + 1)} of ${String(sections)} · ` +
    `screen ${String(screen + 1)} of ${String(screens)}`
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
  const [hung, setHung] = useState<{ top?: number; right?: number } | undefined>(undefined);
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
    // Under the page the settings are a sheet above their button, which
    // the stylesheet places, so nothing is measured onto them.
    if (open && bar.closest(".orca-preview-foot") !== null) {
      setHung({});
      return;
    }
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
  }, [open, bar]);

  const set = (change: Partial<ReaderSettings>): void => {
    settle({ ...settings, ...change });
  };
  const spacing = settings.spacing === undefined ? PUBLISHER : String(settings.spacing);
  const sized = readerSizeStep(settings.size);
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
          <Line label={READER_LABELS.font}>
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
          <Line label={READER_LABELS.size} testid="orca-reflow-setting-size">
            <div className="orca-panel-segment">
              <Sized by={-1} settings={settings} set={set} />
              <span
                className={classes(
                  "orca-reflow-step",
                  settings.size === READER_DEFAULTS.size && "is-default",
                )}
              >
                {`${String(sized.step)} of ${String(sized.steps)}`}
              </span>
              <Sized by={1} settings={settings} set={set} />
            </div>
          </Line>
          <Line label={READER_LABELS.spacing}>
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
          <Line label={READER_LABELS.margins}>
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
          <Line label={READER_LABELS.vertical}>
            <Segment
              value={settings.vertical}
              faint={settings.vertical === READER_DEFAULTS.vertical}
              choices={READER_VERTICALS}
              testid="orca-reflow-setting-vertical"
              settle={(value) => {
                const chosen = READER_VERTICALS.find((each) => each.value === value);
                if (chosen !== undefined) set({ vertical: chosen.value });
              }}
            />
          </Line>
          <Line label={READER_LABELS.align}>
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
          <Line label={READER_LABELS.theme}>
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

/** Draws the letter that sets the text one step smaller or larger. */
function Sized({
  by,
  settings,
  set,
}: {
  by: 1 | -1;
  settings: ReaderSettings;
  set: (change: Partial<ReaderSettings>) => void;
}): JSX.Element {
  const next = settings.size + by * READER_SIZE_STEP;
  return (
    <button
      type="button"
      className={classes("orca-panel-choice", by === 1 ? "orca-reflow-larger" : "orca-reflow-smaller")}
      data-testid={`orca-reflow-setting-size-${by === 1 ? "larger" : "smaller"}`}
      aria-label={by === 1 ? "Larger" : "Smaller"}
      disabled={next < READER_SIZE_MIN || next > READER_SIZE_MAX}
      onClick={() => {
        set({ size: next });
      }}
    >
      A
    </button>
  );
}

function Line({
  label,
  testid,
  children,
}: {
  label: string;
  testid?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="orca-panel-row" data-testid={testid}>
      <span className="orca-panel-label">{label}</span>
      <div className="orca-panel-controls">{children}</div>
    </div>
  );
}
