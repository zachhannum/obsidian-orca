/**
 * The flip-through of the sample book. The pages are the book's own,
 * rasterized from the PDF the screenshot spec exports.
 *
 * A leaf carries the recto before it on its front and the verso after
 * it on its back, so turning one leaf moves the spread on by two pages.
 */

/** The page the flip-through opens on, which is the plate facing Chapter I. */
export const FIRST = 8;

/** How one leaf stands while a spread is being read. */
export interface Leaf {
  /** True once the leaf has been turned to the left. */
  turned: boolean;
  /** The stacking order, so the leaf on top is the one a reader sees. */
  z: number;
}

/**
 * Every leaf at one spread. Turned leaves stack upwards from the left,
 * untouched ones downwards from the right, and the leaf in the air
 * stands over both.
 */
export function layout(leaves: number, at: number, moving = -1): Leaf[] {
  return [...Array(leaves).keys()].map((k) => ({
    turned: k < at,
    z: k === moving ? leaves * 2 + 2 : k < at ? leaves + 1 + k : leaves - k,
  }));
}

/** The two pages a spread shows, counted from the page the book opens on. */
export function spread(at: number): [number, number] {
  return [FIRST + at * 2, FIRST + at * 2 + 1];
}

/** The line under the book, which names the pages on screen. */
export function folio(at: number): string {
  const [verso, recto] = spread(at);
  return `Pages ${String(verso)}–${String(recto)}`;
}

/** Turns the pages on a click, on the buttons and on the arrow keys. */
export function startFlip(root: HTMLElement): void {
  const leaves = [...root.querySelectorAll<HTMLElement>('[data-leaf]')];
  const turn = [...root.querySelectorAll<HTMLButtonElement>('[data-turn]')];
  const said = root.querySelector<HTMLElement>('[data-folio]');
  let at = 0;

  const paint = (moving: number) => {
    layout(leaves.length, at, moving).forEach((leaf, k) => {
      const element = leaves[k];
      if (element === undefined) return;
      element.classList.toggle('turned', leaf.turned);
      element.style.zIndex = String(leaf.z);
    });
    if (said !== null) said.textContent = folio(at);
    for (const button of turn) {
      const step = Number(button.dataset['turn'] ?? 0);
      button.disabled = at + step < 0 || at + step > leaves.length;
    }
    root.dataset['at'] = String(at);
  };

  const go = (step: number) => {
    const next = Math.min(Math.max(at + step, 0), leaves.length);
    if (next === at) return;
    // The leaf in the air is the one being turned, either way.
    const moving = step > 0 ? at : next;
    at = next;
    paint(moving);
  };

  leaves.forEach((leaf, k) => {
    leaf.addEventListener('click', () => {
      go(k < at ? -1 : 1);
    });
  });
  for (const button of turn) {
    button.addEventListener('click', () => {
      go(Number(button.dataset['turn'] ?? 0));
    });
  }
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    go(event.key === 'ArrowRight' ? 1 : -1);
  });

  paint(-1);
}
