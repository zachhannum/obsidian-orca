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
  documentOf,
  fitted,
  leftOf,
  openingOf,
  rewriteDocument,
  screenOf,
  stepOf,
  turnedBy,
  type Anchor,
  type Box,
  type Document,
  type Laid,
  type Place,
} from "@/ui/frame";
import { Icon } from "@/ui/icon";
import { chapters, status, statusText, type Chapter, type Status } from "@/ui/progress";
import type { Sheet } from "@/ui/sheet";

/** A book's EPUB files, and what the render they were written from cost. */
export interface Reflowed {
  book: Reflowable;
  stages: Stages;
  /**
   * The place the frame opens the book at. Without one the frame keeps
   * the document and the screen it was on, which an edit can leave
   * holding other words.
   */
  at?: Anchor;
  /** Whether a reader asked for that place, which a place kept across an edit was not. */
  sought?: boolean;
}

/**
 * The end a turn to a place came to: the frame turned, or it holds
 * another generation than the place is of, or no document of it holds
 * the section.
 */
export type Sought = "turned" | "early" | "missing";

/** The reason a screen came up: a turn by screens, a turn to a place, or a layout of the place already held. */
export type Cause = "turn" | "seek" | "laid";

/** The screen the frame shows, by the engine's nodes. A node names a place only in its own generation. */
export interface Screen {
  generation: number;
  /** The node of the section the document holds. */
  section: number | undefined;
  /** The first block that begins on the screen, or the block the screen opens inside. */
  opens: number | undefined;
  /** The last block that begins on the screen, or the one it opens inside. */
  closes: number | undefined;
  /** The screen within the document, counting from 0. */
  screen: number;
  screens: number;
  cause: Cause;
}

/** The parts of the preview the EPUB view draws into besides its own host. */
export interface ReflowSlots {
  /** The node on the preview's bar that takes the view's controls. */
  controls: HTMLElement;
  /** Writes the chapter, page and percentage being read into the window's status bar. */
  reading(text: string): void;
  /** The device and the settings the view opens with. */
  stored: ReaderStored;
  /** Told the device and the settings after each change, so the plugin keeps them. */
  keeps(stored: ReaderStored): void;
  /** Told each screen once the frame has laid it out. */
  shows(screen: Screen): void;
  /**
   * Opens the sheet a phone draws the reader settings in. Without it
   * the settings hang from their button.
   */
  sheet?: (closed: () => void) => Sheet;
}

export interface MountedReflow {
  /** Draws a book's EPUB, or nothing, which releases every URL the last one was bound to. */
  draw(shown: Reflowed | undefined): void;
  /** Turns by `step` screens. */
  turn(step: number): void;
  /** Turns to the screen that holds a place. */
  seek(anchor: Anchor): Sought;
  unmount(): void;
}

/** The turns the mounted view answers, which the component sets once it has a place. */
interface Turner {
  turn: ((step: number) => void) | undefined;
  seek: ((anchor: Anchor) => Sought) | undefined;
}

/** The value the lists give a setting left to the publisher. */
const PUBLISHER = "publisher";

/** The room between the settings and the edge of the bar, in pixels. */
const GUTTER = 12;

/** Mounts the EPUB view in `host`, with its controls in the bar's slot. */
export function mountReflow(host: HTMLElement, slots: ReflowSlots): MountedReflow {
  const root = createRoot(host);
  const turner: Turner = { turn: undefined, seek: undefined };
  const draw = (shown: Reflowed | undefined): void => {
    root.render(<Reflow shown={shown} slots={slots} turner={turner} />);
  };
  draw(undefined);
  return {
    draw,
    turn: (step) => turner.turn?.(step),
    seek: (anchor) => turner.seek?.(anchor) ?? "early",
    unmount: () => {
      root.unmount();
    },
  };
}

/** The files of one generation, bound to URLs. */
interface Bound {
  generation: number;
  stages: Stages;
  documents: Document[];
  /** The title and length of each document, in the order of `documents`. */
  chapters: Chapter[];
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
  /** The reason the place came up, held until the frame has laid it out and said so. */
  const cause = useRef<Cause>("laid");
  /** The place last laid out, and the block a new layout of it finds its screen by. */
  const drawn = useRef<{ place: Place; generation: number; by: number | undefined } | undefined>(
    undefined,
  );

  const device = DEVICES.find((each) => each.id === deviceId);
  const sections = bound?.documents.length ?? 0;
  const src = bound?.documents[place.section]?.url;
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
      chapters: chapters(shown.book),
    });
    const to = shown.at?.generation === shown.book.generation ? shown.at : undefined;
    const document = to === undefined ? undefined : documentOf(made.documents, to.section);
    cause.current = document !== undefined && shown.sought === true ? "seek" : "laid";
    // An edit can leave the book with fewer sections than the reader
    // was into.
    setPlace((at) => {
      if (to !== undefined && document !== undefined) {
        return { section: document, screen: 0, by: to.nodes };
      }
      return at.section < made.documents.length
        ? at
        : { section: Math.max(made.documents.length - 1, 0), screen: 0 };
    });
    return made.revoke;
  }, [shown]);

  // The device fits the room the status line leaves it, so the room is
  // what is measured.
  const showing = shown !== undefined;
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
    const laid: Laid[] = [];
    for (const block of root.querySelectorAll("section[data-node] [data-node]")) {
      const box = block.getClientRects()[0];
      const node = Number(block.getAttribute("data-node"));
      if (box === undefined || !Number.isInteger(node)) continue;
      laid.push({ node, left: box.left + scroller.scrollLeft });
    }
    // A place asked for by its elements is found by them. A place laid
    // out before is found by the block its screen opened with, so a
    // device, a setting or a late face that moves the columns keeps the
    // words. Any other place is a screen by its number.
    const before = drawn.current;
    const again = before?.place === place && before.generation === bound.generation;
    const by = place.by ?? (again && before.by !== undefined ? [before.by] : undefined);
    const left = by === undefined ? undefined : leftOf(laid, by);
    const screen =
      left !== undefined
        ? screenOf(left, device.width, count)
        : place.screen === "last"
          ? count - 1
          : Math.min(place.screen, count - 1);
    scroller.scrollLeft = screen * device.width;
    setScreens(count);
    const opening = openingOf(laid, screen, device.width);
    if (screen !== place.screen) {
      // The next run lays the same screen out under the place that
      // names it, and reports it.
      const settled = { ...place, screen };
      drawn.current = {
        place: settled,
        generation: bound.generation,
        by: opening.begun ? opening.opens : undefined,
      };
      setPlace(settled);
      return;
    }
    drawn.current = {
      place,
      generation: bound.generation,
      by: opening.begun ? opening.opens : undefined,
    };
    const section = bound.documents[place.section]?.section ?? undefined;

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
    if (section === undefined) delete data["sectionNode"];
    else data["sectionNode"] = String(section);
    if (opening.opens === undefined) delete data["opens"];
    else data["opens"] = String(opening.opens);
    const brought = cause.current;
    cause.current = "laid";
    slots.shows({
      generation: bound.generation,
      section,
      opens: opening.opens,
      closes: opening.closes,
      screen,
      screens: count,
      cause: brought,
    });
    slots.reading(statusText(status(bound.chapters, place.section, screen + 1, count)));
  }, [ready, bound, settings, device, place, faces, slots]);

  const turn = (step: number): void => {
    if (!ready || place.screen === "last") return;
    const to = turnedBy({ section: place.section, screen: place.screen }, step, screens, sections);
    if (to === undefined) return;
    cause.current = "turn";
    setPlace(to);
  };
  const seek = (anchor: Anchor): Sought => {
    if (bound?.generation !== anchor.generation) return "early";
    const document = documentOf(bound.documents, anchor.section);
    if (document === undefined) return "missing";
    cause.current = "seek";
    setPlace({ section: document, screen: 0, by: anchor.nodes });
    return "turned";
  };
  const turns = (step: number): boolean =>
    ready &&
    place.screen !== "last" &&
    turnedBy({ section: place.section, screen: place.screen }, step, screens, sections) !==
      undefined;

  useEffect(() => {
    turner.turn = turn;
    turner.seek = seek;
    return () => {
      turner.turn = undefined;
      turner.seek = undefined;
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
          {ready && place.screen !== "last" && bound !== undefined ? (
            <Reading
              line={status(
                bound.chapters,
                place.section,
                Math.min(place.screen, screens - 1) + 1,
                screens,
              )}
            />
          ) : null}
        </div>
      </div>
      {createPortal(
        <>
          <Settings
            bar={slots.controls}
            {...(slots.sheet === undefined ? {} : { sheet: slots.sheet })}
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

/** Draws the status line. A long title is cut short so the page and percentage stay whole. */
function Reading({ line }: { line: Status }): JSX.Element {
  return (
    <>
      {line.title === undefined ? null : (
        <span className="orca-reflow-title" data-testid="orca-reflow-title">
          {line.title}
        </span>
      )}
      {line.title === undefined ? null : <span className="orca-reflow-dot">{" · "}</span>}
      <span className="orca-reflow-place" data-testid="orca-reflow-place">
        {line.place}
      </span>
    </>
  );
}

/** Draws the button that opens the reader settings, and the settings under it. */
function Settings({
  bar,
  settings,
  settle,
  sheet,
}: {
  bar: HTMLElement;
  settings: ReaderSettings;
  settle: (settings: ReaderSettings) => void;
  sheet?: (closed: () => void) => Sheet;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [hung, setHung] = useState<{ top?: number; right?: number } | undefined>(undefined);
  const [docked, setDocked] = useState<Sheet | undefined>(undefined);
  const opener = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  // A phone draws the settings in a sheet, which closes itself: from
  // its grabber, from a tap outside it and on Escape.
  useEffect(() => {
    if (!open || sheet === undefined) return;
    const made = sheet(() => {
      setOpen(false);
    });
    setDocked(made);
    return () => {
      made.close();
      setDocked(undefined);
    };
  }, [open, sheet]);

  // The e2e suite waits on how the settings are drawn, so the bar says
  // so once React has committed them.
  useEffect(() => {
    const drawn = sheet === undefined ? "popover" : docked === undefined ? "shut" : "sheet";
    bar.dataset["settings"] = open ? drawn : "shut";
  }, [bar, open, sheet, docked]);

  // The settings shut on Escape, and on a press in the window that is
  // neither on them nor on the button that opens them.
  useEffect(() => {
    if (!open || sheet !== undefined) return;
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
  }, [open, bar, sheet]);

  // The settings hang under their button with their right edges in
  // line. A bar too narrow for that keeps them inside itself, so a
  // narrow pane cuts none of them off.
  useLayoutEffect(() => {
    if (sheet !== undefined) return;
    const button = opener.current;
    const hanging = popover.current;
    const from = hanging?.offsetParent;
    // Under the page the settings open above their button, where the
    // stylesheet places them, so nothing is measured onto them.
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
  }, [open, bar, sheet]);

  const set = (change: Partial<ReaderSettings>): void => {
    settle({ ...settings, ...change });
  };
  const spacing = settings.spacing === undefined ? PUBLISHER : String(settings.spacing);
  const sized = readerSizeStep(settings.size);
  const drawn = sheet === undefined ? open : docked !== undefined;
  const rows = drawn ? (
        <div
          ref={popover}
          className="orca-reflow-popover"
          data-testid="orca-reflow-popover"
          {...(sheet === undefined ? { style: hung ?? { visibility: "hidden" } } : {})}
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
      ) : null;
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
      {docked === undefined ? rows : createPortal(rows, docked.el)}
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
