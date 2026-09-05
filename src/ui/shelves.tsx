/**
 * The shelf, drawn: every book in the vault and the reading order of
 * each, group by group.
 *
 * A section is organisational. It can be made, renamed, moved and
 * taken out, and none of that touches the roles of the entries under
 * it. A book's reading order is one flat sortable list, and there is
 * no overlay: the row under the pointer is the row that lands.
 */

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Collision,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
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
  useMemo,
  useRef,
  useState,
  type JSX,
  type MouseEvent as Pointed,
  type RefObject,
} from "react";
import type { Place } from "@/book/order";
import { ROLES } from "@/book/roles";
import {
  collapse,
  flatten,
  groupId,
  headingOf,
  isGroup,
  moveRow,
  moveSection,
  places,
  rowId,
  type Item,
} from "@/ui/list";
import type { Row, Shelved } from "@/ui/shelf";

/** What a row of the shelf asks the view to do. */
export interface Acting {
  open(path: string): void;
  bookMenu(event: Pointed, book: Shelved): void;
  /** The entry's own menu. `after` is where `New chapter here` goes. */
  entryMenu(event: Pointed, book: Shelved, row: Row, after: Place): void;
  groupMenu(event: Pointed, book: Shelved, heading: string): void;
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

/**
 * A row goes to its new place at once: the drag has already shown the
 * author where it lands.
 */
const animates = (): boolean => false;

/**
 * What the pointer is over, by where it is down the list. A rectangle
 * holding the pointer wins, and otherwise the nearest one does, so a
 * drop past the last row lands on the last row.
 */
const detect: CollisionDetection = ({
  droppableContainers,
  droppableRects,
  pointerCoordinates,
  collisionRect,
}) => {
  const y = pointerCoordinates?.y ?? collisionRect.top;
  let found: Collision | undefined;
  let gap = Number.POSITIVE_INFINITY;
  for (const container of droppableContainers) {
    const rect = droppableRects.get(container.id);
    if (rect === undefined) continue;
    const away = Math.max(rect.top - y, y - rect.bottom, 0);
    if (away >= gap) continue;
    gap = away;
    found = { id: container.id, data: { droppableContainer: container, value: away } };
  }
  return found === undefined ? [] : [found];
};

/**
 * A dragged row stays inside its list. Past the last row it would
 * stretch the pane's scrollable area, and the auto-scroll following it
 * would stretch it again.
 *
 * The rect plus the transform is where the row is now: dnd-kit adds
 * back the distance the pane has scrolled since it measured the row,
 * so neither term wants correcting here. What does move is the list,
 * which is why it is measured on every move rather than once.
 */
const inside =
  (list: RefObject<HTMLDivElement | null>): Modifier =>
  ({ transform, draggingNodeRect }) => {
    const bounds = list.current?.getBoundingClientRect();
    if (draggingNodeRect === null || bounds === undefined) return transform;
    return {
      ...transform,
      x: clamp(transform.x, bounds.left - draggingNodeRect.left, bounds.right - draggingNodeRect.right),
      y: clamp(transform.y, bounds.top - draggingNodeRect.top, bounds.bottom - draggingNodeRect.bottom),
    };
  };

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

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
  const [dragged, setDragged] = useState<string | undefined>(undefined);
  /** The section a drag is carrying, whose entries travel with it. */
  const [carried, setCarried] = useState<string | undefined>(undefined);
  /** The list the drop left, until the note has been written and read back. */
  const [dropped, setDropped] = useState<Item[] | undefined>(undefined);

  // The list the drop left stays up until the note has been written
  // and read back, so it never snaps to the old order first.
  const painted = useRef(book.groups);
  useEffect(() => {
    if (painted.current === book.groups) return;
    painted.current = book.groups;
    setDropped(undefined);
  }, [book.groups]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const list = useRef<HTMLDivElement>(null);
  const modifiers = useMemo(() => [inside(list)], []);

  // dnd-kit reads the item list by identity, so a list rebuilt on every
  // render would look to it like an edit on every render.
  const base = useMemo(
    () => dropped ?? flatten(book.groups),
    [dropped, book.groups],
  );
  const items = useMemo(
    () => (carried === undefined ? base : collapse(base, carried)),
    [base, carried],
  );
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const where = useMemo(() => places(items), [items]);

  function started({ active }: DragStartEvent): void {
    const id = String(active.id);
    setDragged(id);
    if (isGroup(id)) setCarried(headingOf(id));
  }

  function landed({ active, over }: DragEndEvent): void {
    const id = String(active.id);
    setDragged(undefined);
    setCarried(undefined);
    if (over === null) return;
    const onto = String(over.id);

    if (isGroup(id)) {
      const moved = moveSection(base, headingOf(id), onto);
      if (moved === undefined) return;
      setDropped(moved.items);
      acting.moveGroup(book, headingOf(id), moved.at);
      return;
    }
    const moved = moveRow(base, id, onto);
    if (moved === undefined) return;
    setDropped(moved.items);
    acting.moveEntry(book, moved.from, moved.to);
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
        data-testid="orca-book"
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
          modifiers={modifiers}
          onDragStart={started}
          onDragEnd={landed}
          onDragCancel={() => {
            setDragged(undefined);
            setCarried(undefined);
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="orca-nav-children" ref={list}>
              {items.map((item, at) =>
                item.kind === "group" ? (
                  <Heading
                    key={item.id}
                    book={book}
                    heading={item.heading}
                    carrying={dragged === item.id ? item.rows : undefined}
                    acting={acting}
                    renaming={
                      renaming?.book === book.path && renaming.heading === item.heading
                    }
                    rename={(open) => {
                      renamed(open ? { book: book.path, heading: item.heading } : undefined);
                    }}
                  />
                ) : (
                  <Entry
                    key={item.id}
                    book={book}
                    row={item.row}
                    after={next(where[at], item.heading)}
                    acting={acting}
                  />
                ),
              )}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

/** The place just after a row, which is where a new chapter goes. */
function next(place: Place | undefined, heading: string): Place {
  return place === undefined ? { heading, at: 0 } : { ...place, at: place.at + 1 };
}

function Heading({
  book,
  heading,
  carrying,
  acting,
  renaming,
  rename,
}: {
  book: Shelved;
  heading: string;
  /** How many entries travel with it, while it is the one being dragged. */
  carrying: number | undefined;
  acting: Acting;
  renaming: boolean;
  rename: (open: boolean) => void;
}): JSX.Element {
  const sortable = useSortable({
    id: groupId(heading),
    animateLayoutChanges: animates,
  });
  const style = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={`orca-nav-heading${sortable.isDragging ? " is-dragged" : ""}`}
      data-testid="orca-group"
      data-heading={heading}
      {...sortable.attributes}
      {...(renaming ? undefined : sortable.listeners)}
      onContextMenu={(event) => {
        acting.groupMenu(event, book, heading);
      }}
      onDoubleClick={() => {
        rename(true);
      }}
    >
      {renaming ? (
        <Rename
          name={heading}
          done={(named) => {
            rename(false);
            if (named !== "" && named !== heading) {
              acting.renameGroup(book, heading, named);
            }
          }}
        />
      ) : (
        <span className="orca-heading-name">{heading}</span>
      )}
      {carrying === undefined ? null : (
        <span className="orca-chip">{carrying === 0 ? "empty" : `${carrying}`}</span>
      )}
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
  // Taking the input off the page blurs it, so Escape would be answered
  // twice: once cancelled, and once with the name it was cancelling.
  const answered = useRef(false);
  const once = (named: string): void => {
    if (answered.current) return;
    answered.current = true;
    done(named);
  };
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
        once(event.currentTarget.value.trim());
      }}
      onKeyDown={(event) => {
        // The sortable is up the tree and answers these keys too.
        event.stopPropagation();
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") once("");
      }}
    />
  );
}

function Entry({
  book,
  row,
  after,
  acting,
}: {
  book: Shelved;
  row: Row;
  after: Place;
  acting: Acting;
}): JSX.Element {
  const sortable = useSortable({
    id: rowId(row.at),
    animateLayoutChanges: animates,
  });
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
        acting.entryMenu(event, book, row, after);
      }}
    >
      <span className="orca-entry-mark">
        {row.kind === "missing" ? <Icon name="triangle-alert" /> : null}
        {row.kind === "generated" ? <Icon name="wand-sparkles" /> : null}
      </span>
      <span className="orca-label">{row.name}</span>
      {row.kind === "generated" ? (
        <span className="orca-chip">generated</span>
      ) : row.named ? (
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
