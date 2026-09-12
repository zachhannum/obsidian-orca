/**
 * The working part of the design panel, and the page it sets. The
 * controls are drawn from the plugin's own table, so this file names no
 * control of its own: it reads the design the page opens on, and the
 * ornaments on offer, off the markup.
 */

/** The marks a scene break prints, as the panel names them. */
export type Mark = 'space' | 'ornament' | 'word';

/** The word the demo's book sets a scene break in. */
export const WORD = '* * *';

/** The four keys the demo writes. */
export interface Design {
  /** `body-align`. */
  align: 'justify' | 'left';
  /** `body-hyphens`. */
  hyphens: boolean;
  /** `scene-break-mark`. */
  mark: Mark;
  /** `scene-break-ornament`, as an index into the ornaments on offer. */
  glyph: number;
}

/** The page a design sets, as the properties the page is drawn with. */
export interface Page {
  align: string;
  hyphens: 'auto' | 'manual';
  /** The scene break: what it prints, and the band it prints inside. */
  mark: { text: string; height: string; size: string; spacing: string };
}

/** Sets the page from a design, with the ornaments the panel offers. */
export function page(design: Design, ornaments: readonly string[]): Page {
  const mark =
    design.mark === 'space'
      ? { text: '', height: '10px', size: '8px', spacing: '0' }
      : design.mark === 'word'
        ? { text: WORD, height: '20px', size: '7px', spacing: '.3em' }
        : {
            text: ornaments[design.glyph] ?? ornaments[0] ?? '',
            height: '20px',
            size: '10px',
            spacing: '0',
          };
  return {
    align: design.align === 'justify' ? 'justify' : 'left',
    hyphens: design.hyphens ? 'auto' : 'manual',
    mark,
  };
}

/** The design the markup says the page opens on, which the book note sets. */
export function opens(root: HTMLElement): Design {
  const said = root.dataset;
  return {
    align: said['align'] === 'left' ? 'left' : 'justify',
    hyphens: said['hyphens'] === 'true',
    mark: said['mark'] === 'space' || said['mark'] === 'word' ? said['mark'] : 'ornament',
    glyph: Number(said['glyph'] ?? 0),
  };
}

/** The ornaments the glyph control offers, in the order it draws them. */
export function ornamentsOf(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('[data-set^="glyph="]')].map((control) =>
    (control.textContent ?? '').trim()
  );
}

/** Runs the controls, and sets the page from them. */
export function startDemo(root: HTMLElement): void {
  const design = opens(root);
  const ornaments = ornamentsOf(root);
  const text = root.querySelector<HTMLElement>('[data-demo-text]');
  const mark = root.querySelector<HTMLElement>('[data-demo-mark]');

  const paint = () => {
    const set = page(design, ornaments);
    if (text !== null) {
      text.style.setProperty('text-align', set.align);
      text.style.setProperty('hyphens', set.hyphens);
      text.style.setProperty('-webkit-hyphens', set.hyphens);
    }
    if (mark !== null) {
      mark.textContent = set.mark.text;
      mark.style.height = set.mark.height;
      mark.style.lineHeight = set.mark.height;
      mark.style.fontSize = set.mark.size;
      mark.style.letterSpacing = set.mark.spacing;
    }
    for (const control of root.querySelectorAll<HTMLElement>('[data-set]')) {
      const [key, value] = (control.dataset['set'] ?? '').split('=');
      const on =
        key === 'hyphens'
          ? design.hyphens
          : key === 'align'
            ? design.align === value
            : key === 'mark'
              ? design.mark === value
              : design.mark === 'ornament' && String(design.glyph) === value;
      control.classList.toggle('on', on);
      // A toggle shows its state the other way round: it is a switch,
      // not a choice among several.
      if (key === 'hyphens') control.classList.toggle('off', !on);
      if (control instanceof HTMLButtonElement) control.setAttribute('aria-pressed', String(on));
    }
  };

  for (const control of root.querySelectorAll<HTMLElement>('[data-set]')) {
    control.addEventListener('click', () => {
      const [key, value = ''] = (control.dataset['set'] ?? '').split('=');
      if (key === 'align') design.align = value === 'left' ? 'left' : 'justify';
      if (key === 'hyphens') design.hyphens = !design.hyphens;
      if (key === 'mark' && (value === 'space' || value === 'ornament' || value === 'word')) {
        design.mark = value;
      }
      if (key === 'glyph') {
        design.glyph = Number(value);
        design.mark = 'ornament';
      }
      paint();
    });
  }

  paint();
}
