/**
 * The shelf, drawn: every book in the vault and the reading order of
 * each, group by group.
 *
 * A section is organisational. It can be made, renamed, moved and
 * taken out, and none of that touches the roles of the entries under
 * it. Dragging is dnd-kit's sortable, nested: entries sort inside and
 * between sections, and a section sorts among its book's sections.
 */

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { setIcon, setTooltip } from "obsidian";
import { createRoot } from "react-dom/client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent as Pointed,
} from "react";
import type { Place } from "@/book/order";
import { ROLES } from "@/book/roles";
import type { Grouped, Row, Shelved } from "@/ui/shelf";

/** What a row of the shelf asks the view to do. */
export interface Acting {
  open(path: string): void;
  bookMenu(event: Pointed, book: Shelved): void;
  entryMenu(event: Pointed, book: Shelved, group: Grouped, row: Row): void;
  groupMenu(event: Pointed, book: Shelved, group: Grouped): void;
  /** The `+` a book row carries, which is the one way to add to it. */
  addMenu(event: Pointed, book: Shelved): void;
  newBook(): void;
  locate(book: Shelved, row: Row): void;
  removeEntry(book: Shelved, row: Row): void;
  moveEntry(book: Shelved, from: number, to: Place): void;
  moveGroup(book: Shelved, heading: string, at: number): void;
  renameGroup(book: Shelved, heading: string, named: string): void;
  /** The book the list has focus in, which a paste adds to. */
  focused(path: string): void;
}

/** A section a rename is open on. */
export interface Renaming {
  book: string;
  heading: string;
}

/** The shelf, and the generation of it the pane last painted. */
export interface Shelves {
  shelf: Shelved[];
  generation: number;
  acting: Acting;
  renaming: Renaming | undefined;
  renamed: (open: Renaming | undefined) => void;
}

/** The shelf as the view holds it: painted, renamed, and let go. */
export interface Mounted {
  paint(shelf: Shelved[], generation: number): void;
  /** Opens the rename on one section, which the menu asks for. */
  rename(book: string, heading: string): void;
  unmount(): void;
}

/**
 * The shelf, mounted under a view's own element. The view owns the
 * root: it makes one here and unmounts it when the leaf closes, and
 * nothing else empties the element underneath.
 */
export function mountShelf(el: HTMLElement, acting: Acting): Mounted {
  const host = el.createDiv();
  const root = createRoot(host);
  let shelf: Shelved[] = [];
  let generation = 0;
  let renaming: Renaming | undefined;

  const draw = (): void => {
    root.render(
      <Shelf
        shelf={shelf}
        generation={generation}
        acting={acting}
        renaming={renaming}
        renamed={(open) => {
          renaming = open;
          draw();
        }}
      />,
    );
  };
  draw();

  return {
    paint(next, at) {
      shelf = next;
      generation = at;
      draw();
    },
    rename(book, heading) {
      renaming = { book, heading };
      draw();
    },
    unmount() {
      root.unmount();
      host.remove();
    },
  };
}

const ENTRY = "e:";
const GROUP = "g:";

/**
 * A drag prefers the entries under the pointer to the section holding
 * them, because a section's own rectangle covers every one of its
 * rows. A section drag sees only sections.
 */
const detect: CollisionDetection = (args) => {
  const id = String(args.active.id);
  const only = (prefix: string): typeof args => ({
    ...args,
    droppableContainers: args.droppableContainers.filter((over) =>
      String(over.id).startsWith(prefix),
    ),
  });

  if (id.startsWith(GROUP)) return closestCenter(only(GROUP));
  const near = pointerWithin(args);
  const rows = near.filter((over) => String(over.id).startsWith(ENTRY));
  if (rows.length > 0) return rows;
  const sections = near.filter((over) => String(over.id).startsWith(GROUP));
  if (sections.length > 0) return sections;
  return closestCenter(args);
};

/** An Obsidian icon, which is drawn into the node after the commit. */
function Icon({ name, className }: { name: string; className?: string }): JSX.Element {
  const held = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (held.current !== null) setIcon(held.current, name);
  }, [name]);
  return <span ref={held} className={className} />;
}

/** An icon that does something, which never starts a drag. */
function Action({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: (event: Pointed) => void;
}): JSX.Element {
  const held = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (held.current !== null) setTooltip(held.current, label);
  }, [label]);
  return (
    <button
      ref={held}
      type="button"
      className="orca-nav-action"
      aria-label={label}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
    >
      <Icon name={icon} />
    </button>
  );
}

export function Shelf({
  shelf,
  generation,
  acting,
  renaming,
  renamed,
}: Shelves): JSX.Element {
  const pane = useRef<HTMLDivElement>(null);
  // The suite waits on the generation the pane has painted, so it is
  // written after the commit and never during one.
  useEffect(() => {
    if (pane.current !== null) pane.current.dataset["generation"] = String(generation);
  }, [generation, shelf]);

  return (
    <div className="orca-navigator" data-testid="orca-navigator" ref={pane}>
      <div className="orca-nav-header">
        <span className="orca-nav-title">Books</span>
        <Action
          icon="plus"
          label="New book"
          onClick={() => {
            acting.newBook();
          }}
        />
      </div>
      <div className="orca-shelves">
        {shelf.length === 0 ? (
          <div className="orca-nav-quiet">No books in this vault</div>
        ) : (
          shelf.map((book) => (
            <Book
              key={book.path}
              book={book}
              acting={acting}
              renaming={renaming}
              renamed={renamed}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Book({
  book,
  acting,
  renaming,
  renamed,
}: {
  book: Shelved;
  acting: Acting;
  renaming: Renaming | undefined;
  renamed: (open: Renaming | undefined) => void;
}): JSX.Element {
  const [folded, setFolded] = useState(false);
  const [dragged, setDragged] = useState<UniqueIdentifier | undefined>(undefined);
  /** The groups as the drag has them, until it lands. */
  const [moving, setMoving] = useState<Grouped[] | undefined>(undefined);

  // The groups the drag made stay up until the note has been written
  // and read back, so the list never snaps to the old order first.
  const painted = useRef(book.groups);
  useEffect(() => {
    if (painted.current === book.groups) return;
    painted.current = book.groups;
    if (dragged === undefined) setMoving(undefined);
  }, [book.groups, dragged]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const groups = moving ?? book.groups;

  const rowAt = (id: UniqueIdentifier): number => Number(String(id).slice(ENTRY.length));
  const headingOf = (id: UniqueIdentifier): string => String(id).slice(GROUP.length);
  const groupOf = (found: Grouped[], at: number): Grouped | undefined =>
    found.find((group) => group.rows.some((row) => row.at === at));

  function started({ active }: DragStartEvent): void {
    setDragged(active.id);
    setMoving(book.groups);
  }

  /** An entry crossing into another section, while the drag is still up. */
  function over({ active, over: under }: DragOverEvent): void {
    const id = String(active.id);
    if (under === null || !id.startsWith(ENTRY)) return;
    const at = rowAt(active.id);
    const to = String(under.id);
    const held = moving ?? book.groups;

    const from = groupOf(held, at);
    const target = to.startsWith(GROUP)
      ? held.find((group) => group.heading === headingOf(to))
      : groupOf(held, rowAt(to));
    if (from === undefined || target === undefined) return;

    const row = from.rows.find((found) => found.at === at);
    if (row === undefined) return;
    const landing = to.startsWith(GROUP)
      ? target.rows.length
      : target.rows.findIndex((found) => found.at === rowAt(to));
    if (from === target && from.rows.indexOf(row) === landing) return;

    setMoving(
      held.map((group) => {
        if (group !== from && group !== target) return group;
        const rows = group.rows.filter((found) => found.at !== at);
        if (group !== target) return { ...group, rows };
        const cut = landing < 0 ? rows.length : Math.min(landing, rows.length);
        return { ...group, rows: [...rows.slice(0, cut), row, ...rows.slice(cut)] };
      }),
    );
  }

  /**
   * Where the drag left it. An entry's place is read off the groups the
   * drag has been keeping, and a section's off its book's list.
   */
  function landed(event: DragEndEvent): void {
    setDragged(undefined);
    // A drop that changed nothing leaves no edit to wait on, so the
    // groups the drag was keeping are let go here instead.
    if (!edited(event)) setMoving(undefined);
  }

  function edited({ active, over: under }: DragEndEvent): boolean {
    const held = moving;
    if (held === undefined || under === null) return false;
    const id = String(active.id);

    if (id.startsWith(GROUP)) {
      const heading = headingOf(id);
      const from = held.findIndex((group) => group.heading === heading);
      const onto = held.findIndex(
        (group) => group.heading === headingOf(String(under.id)),
      );
      const section = held[from];
      if (section === undefined || onto < 0 || onto === from) return false;
      // Nothing moves above a group with no heading, because a heading
      // written above those entries would take them.
      const first = held[0]?.heading === "" ? 1 : 0;
      const to = Math.min(Math.max(onto, first), held.length - 1);
      if (to === from) return false;

      const next = held.filter((_, index) => index !== from);
      next.splice(to, 0, section);
      setMoving(next);
      acting.moveGroup(book, heading, to);
      return true;
    }

    const at = rowAt(active.id);
    const origin = groupOf(book.groups, at);
    const target = groupOf(held, at);
    if (origin === undefined || target === undefined) return false;
    const was = origin.rows.findIndex((row) => row.at === at);
    const now = target.rows.findIndex((row) => row.at === at);
    if (origin.heading === target.heading && was === now) return false;
    // A place names the index the group has now, so a move down inside
    // one group counts the row it is leaving.
    const to = origin.heading === target.heading && now > was ? now + 1 : now;
    acting.moveEntry(book, at, { heading: target.heading, at: to });
    return true;
  }

  return (
    <div
      className="orca-shelf"
      data-testid="orca-shelf"
      data-book={book.path}
      data-holds={String(book.holds)}
      tabIndex={0}
      onFocus={() => {
        acting.focused(book.path);
      }}
    >
      <div
        className={`orca-nav-item orca-shelf-name${book.holds ? " is-active" : ""}`}
        onClick={() => {
          acting.open(book.path);
        }}
        onContextMenu={(event) => {
          acting.bookMenu(event, book);
        }}
      >
        <span
          className="orca-fold"
          onClick={(event) => {
            event.stopPropagation();
            setFolded(!folded);
          }}
        >
          <Icon name={folded ? "chevron-right" : "chevron-down"} />
        </span>
        <span className="orca-label">{book.name}</span>
        <span className="orca-nav-actions">
          <Action
            icon="plus"
            label="Add to this book"
            onClick={(event) => {
              acting.addMenu(event, book);
            }}
          />
        </span>
      </div>

      {folded ? null : (
        <DndContext
          sensors={sensors}
          collisionDetection={detect}
          onDragStart={started}
          onDragOver={over}
          onDragEnd={landed}
          onDragCancel={() => {
            setDragged(undefined);
            setMoving(undefined);
          }}
        >
          <div className="orca-nav-children">
            <SortableContext
              items={groups.flatMap((group) =>
                group.heading === "" ? [] : [`${GROUP}${group.heading}`],
              )}
              strategy={verticalListSortingStrategy}
            >
              {groups.map((group) => (
                <Section
                  key={group.heading}
                  book={book}
                  group={group}
                  acting={acting}
                  renaming={
                    renaming?.book === book.path && renaming.heading === group.heading
                  }
                  rename={(open) => {
                    renamed(
                      open ? { book: book.path, heading: group.heading } : undefined,
                    );
                  }}
                />
              ))}
            </SortableContext>
          </div>
          <DragOverlay>
            {dragged === undefined ? null : (
              <Ghost id={dragged} groups={groups} rowAt={rowAt} headingOf={headingOf} />
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function Section({
  book,
  group,
  acting,
  renaming,
  rename,
}: {
  book: Shelved;
  group: Grouped;
  acting: Acting;
  renaming: boolean;
  rename: (open: boolean) => void;
}): JSX.Element {
  const named = group.heading !== "";
  const sortable = useSortable({ id: `${GROUP}${group.heading}`, disabled: !named });
  const style = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={`orca-section${sortable.isDragging ? " is-dragged" : ""}`}
      data-testid="orca-section"
    >
      {named ? (
        <div
          className="orca-nav-heading"
          data-testid="orca-group"
          data-heading={group.heading}
          {...sortable.attributes}
          {...(renaming ? undefined : sortable.listeners)}
          onContextMenu={(event) => {
            acting.groupMenu(event, book, group);
          }}
          onDoubleClick={() => {
            rename(true);
          }}
        >
          {renaming ? (
            <Rename
              name={group.heading}
              done={(named) => {
                rename(false);
                if (named !== "" && named !== group.heading) {
                  acting.renameGroup(book, group.heading, named);
                }
              }}
            />
          ) : (
            <span className="orca-heading-name">{group.heading}</span>
          )}
        </div>
      ) : null}
      <SortableContext
        items={group.rows.map((row) => `${ENTRY}${row.at}`)}
        strategy={verticalListSortingStrategy}
      >
        {group.rows.map((row) => (
          <Entry key={row.at} book={book} group={group} row={row} acting={acting} />
        ))}
      </SortableContext>
    </div>
  );
}

function Rename({
  name,
  done,
}: {
  name: string;
  done: (named: string) => void;
}): JSX.Element {
  const held = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    held.current?.focus();
    held.current?.select();
  }, []);
  return (
    <input
      ref={held}
      className="orca-rename"
      data-testid="orca-rename"
      defaultValue={name}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onBlur={(event) => {
        done(event.currentTarget.value.trim());
      }}
      onKeyDown={(event) => {
        // The sortable is up the tree and answers these keys too.
        event.stopPropagation();
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") done("");
      }}
    />
  );
}

function Entry({
  book,
  group,
  row,
  acting,
}: {
  book: Shelved;
  group: Grouped;
  row: Row;
  acting: Acting;
}): JSX.Element {
  const sortable = useSortable({ id: `${ENTRY}${row.at}` });
  const style = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={`orca-nav-item orca-entry${sortable.isDragging ? " is-dragged" : ""}`}
      data-testid="orca-entry"
      data-at={row.at}
      data-role={row.role}
      data-kind={row.kind}
      {...sortable.attributes}
      {...sortable.listeners}
      onClick={() => {
        if (row.path !== undefined) acting.open(row.path);
      }}
      onContextMenu={(event) => {
        acting.entryMenu(event, book, group, row);
      }}
    >
      <span className="orca-entry-mark">
        {row.kind === "missing" ? <Icon name="triangle-alert" /> : null}
        {row.kind === "generated" ? <Icon name="wand-sparkles" /> : null}
      </span>
      <span className="orca-label">{row.name}</span>
      {row.named ? (
        <span className="orca-chip">{ROLES[row.role].name.toLowerCase()}</span>
      ) : null}
      {row.kind === "missing" ? (
        <span className="orca-nav-actions">
          <Action
            icon="search"
            label="Locate"
            onClick={() => {
              acting.locate(book, row);
            }}
          />
          <Action
            icon="x"
            label="Remove"
            onClick={() => {
              acting.removeEntry(book, row);
            }}
          />
        </span>
      ) : null}
    </div>
  );
}

/** What follows the pointer: the row or the section being dragged. */
function Ghost({
  id,
  groups,
  rowAt,
  headingOf,
}: {
  id: UniqueIdentifier;
  groups: Grouped[];
  rowAt: (id: UniqueIdentifier) => number;
  headingOf: (id: UniqueIdentifier) => string;
}): JSX.Element | null {
  if (String(id).startsWith(GROUP)) {
    const heading = headingOf(id);
    const held = groups.find((group) => group.heading === heading);
    return (
      <div className="orca-ghost">
        <Icon name="grip-vertical" className="orca-ghost-grip" />
        <span>{heading}</span>
        <span className="orca-chip">
          {held === undefined || held.rows.length === 0
            ? "empty"
            : `${held.rows.length}`}
        </span>
      </div>
    );
  }
  const at = rowAt(id);
  const row = groups.flatMap((group) => group.rows).find((found) => found.at === at);
  return (
    <div className="orca-ghost">
      <Icon name="grip-vertical" className="orca-ghost-grip" />
      <span>{row?.name ?? ""}</span>
    </div>
  );
}
