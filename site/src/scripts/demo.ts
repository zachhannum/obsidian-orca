/**
 * The working part of the design panel, and the page it sets. The four
 * controls here are the ones the panel offers under Text and Scene
 * breaks, and each writes the same design key the panel writes.
 */

/** The marks a scene break prints, as the panel names them. */
export type Mark = 'space' | 'ornament' | 'word';

/** The ornaments the panel's glyph picker offers. */
export const GLYPHS = ['❧', '⁂', '§', '✦'];

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

/** The design the demo opens on, which is the sample book's own. */
export const OPENS: Design = { align: 'justify', hyphens: true, mark: 'ornament', glyph: 1 };

/** Sets the page from a design. */
export function page(design: Design): Page {
  const mark =
    design.mark === 'space'
      ? { text: '', height: '10px', size: '8px', spacing: '0' }
      : design.mark === 'word'
        ? { text: WORD, height: '20px', size: '7px', spacing: '.3em' }
        : {
            text: GLYPHS[design.glyph] ?? (GLYPHS[0] as string),
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

/** Runs the controls, and sets the page from them. */
export function startDemo(root: HTMLElement): void {
  const design: Design = { ...OPENS };
  const text = root.querySelector<HTMLElement>('[data-demo-text]');
  const mark = root.querySelector<HTMLElement>('[data-demo-mark]');

  const paint = () => {
    const set = page(design);
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
