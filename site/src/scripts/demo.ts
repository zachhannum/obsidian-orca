/**
 * The working part of the design panel, and the page the engine sets
 * from it.
 *
 * Every control writes one design key, the key the plugin's panel
 * writes, and the design reaches the engine as the sheets the plugin
 * generates. So a control here does to the page what the same control
 * does in Obsidian.
 */
import { atLevel, stepped, typed, withKey } from '@/ui/groups';
import {
  readDesign,
  writeDesign,
  type Design,
  type Level,
  type Written,
} from '@/style/design';
import type { Setting } from '@/style/generated';
import type { Source, Typeset } from './typeset';

/** What the demo needs to set a page, which the page hands it. */
export interface Demo {
  /** The design the book note sets, as its properties. */
  design: Record<string, Written>;
  /** The sections the book crosses, which a running head names. */
  setting: Setting;
  /** The chapter the page is set from. */
  source: Source;
}

/**
 * The controls the demo offers: the ones that change the page it shows.
 *
 * The panel offers more, and the rest are no use here. A scene break
 * needs a scene break in the chapter, mirrored margins and a running
 * head need the facing page, and a chapter that begins on the right
 * needs a chapter before it. A test sets the page with each of these
 * changed and fails on one the page does not answer.
 */
export const WORKS: readonly string[] = [
  'trim',
  'margin-inside',
  'margin-outside',
  'margin-top',
  'margin-bottom',
  'body-size',
  'body-line-spacing',
  'body-align',
  'body-first-line-indent',
  'body-hyphens',
  'heading-1-size',
  'heading-1-align',
  'chapter-space-above',
  'chapter-space-below',
  'chapter-drop-cap',
  'suppress-head-on-openings',
];

/** Calls `load` when the demo is worth the several megabytes it costs. */
export type Mount = (load: () => void) => void;

/** The design the demo opens on, which is the book note's own. */
export function opens(demo: Demo): Design {
  return readDesign(demo.design);
}

/**
 * The value a control writes when it is clicked. A choice writes the
 * value it stands for, and a switch writes the opposite of the one the
 * design holds.
 */
export function clicked(
  design: Design,
  key: string,
  value: string | undefined
): Written | undefined {
  if (value !== undefined) return value;
  return writeDesign(design)[key] === true ? false : true;
}

/** Runs the controls over a page the engine sets. */
export function startDemo(root: HTMLElement, demo: Demo, mount: Mount): void {
  let design = opens(demo);
  let typeset: Typeset | undefined;
  const controls = [...root.querySelectorAll<HTMLElement>('[data-key]')];
  const levels = [...root.querySelectorAll<HTMLElement>('[data-levels]')];

  /**
   * Points the heading controls at one level. Their keys name the level
   * they are for, so the rows edit H2 once H2 is the one chosen.
   */
  const editing = (level: Level): void => {
    for (const control of controls) {
      const template = control.dataset['level'];
      if (template === undefined) continue;
      control.dataset['key'] = atLevel(template, level);
    }
    for (const choice of levels) {
      choice.classList.toggle('on', choice.dataset['levels'] === String(level));
    }
  };

  /** Draws every control in the state the design holds. */
  const shown = (): void => {
    const properties = writeDesign(design);
    for (const control of controls) {
      const key = control.dataset['key'] ?? '';
      const value = control.dataset['value'];
      // A select shows its value through the option that is chosen.
      const held = properties[key];
      const on = value === undefined ? held === true : String(held) === value;
      control.classList.toggle('on', on);
      // A switch shows its state the other way round: it is not a
      // choice among several.
      if (control.dataset['kind'] === 'flag') control.classList.toggle('off', !on);
      if (control instanceof HTMLButtonElement) {
        control.setAttribute('aria-pressed', String(on));
      }
      const said = held === undefined ? '' : String(held);
      if (
        (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) &&
        control.value !== said
      ) {
        control.value = said;
      }
    }
  };

  const write = (key: string, value: Written | undefined): void => {
    const next = withKey(design, key, value);
    if (next === design) return;
    design = next;
    shown();
    void typeset?.set(design);
  };

  /** The measure a number field holds, or nothing for a word. */
  const measure = (field: HTMLInputElement): 'length' | 'count' | undefined => {
    const kind = field.dataset['kind'];
    return kind === 'length' || kind === 'count' ? kind : undefined;
  };

  /** Steps a number field by one step of its unit, or ten with shift. */
  const step = (field: HTMLInputElement, by: 1 | -1, times: number): void => {
    const held = measure(field);
    if (held === undefined) return;
    const unit = field.dataset['page'] === 'in' ? 'in' : 'pt';
    const next = stepped(held, field.value, by, times, unit);
    if (next === undefined) return;
    write(field.dataset['key'] ?? '', next);
  };

  for (const control of controls) {
    const key = control.dataset['key'] ?? '';
    if (control instanceof HTMLSelectElement) {
      control.addEventListener('change', () => {
        // The key a heading control writes follows the level on screen,
        // so it is read now rather than when the control was found.
        write(control.dataset['key'] ?? key, control.value);
      });
      continue;
    }
    if (control instanceof HTMLInputElement) {
      // A field settles when it is left or the reader presses enter,
      // which is where the panel settles one too. Half-typed text is
      // not a value.
      control.addEventListener('change', () => {
        const at = control.dataset['key'] ?? key;
        const said = control.value.trim();
        if (said === '') {
          write(at, undefined);
          return;
        }
        const held = measure(control);
        const read = held === undefined ? { value: said } : typed(held, said);
        if ('wrong' in read) {
          control.setAttribute('aria-invalid', 'true');
          return;
        }
        control.removeAttribute('aria-invalid');
        write(at, read.value);
      });
      control.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        step(control, event.key === 'ArrowUp' ? 1 : -1, event.shiftKey ? 10 : 1);
      });
      continue;
    }
    if (control.dataset['step'] !== undefined) continue;
    control.addEventListener('click', () => {
      const at = control.dataset['key'] ?? key;
      write(at, clicked(design, at, control.dataset['value']));
    });
  }

  // A stepper moves the field it stands beside.
  for (const button of root.querySelectorAll<HTMLElement>('[data-step]')) {
    const field = button.closest('.o-num')?.querySelector('input');
    if (field === null || field === undefined) continue;
    button.addEventListener('click', (event) => {
      step(field, button.dataset['step'] === '1' ? 1 : -1, event.shiftKey ? 10 : 1);
    });
  }

  for (const choice of levels) {
    choice.addEventListener('click', () => {
      editing(Number(choice.dataset['levels']) as Level);
      shown();
    });
  }

  shown();

  const into = root.querySelector<HTMLElement>('[data-demo-page]');
  if (into === null) return;
  mount(() => {
    void import('./typeset').then(async ({ startTypeset }) => {
      typeset = await startTypeset(into, demo.source, demo.setting, design);
    });
  });
}

/**
 * Loads the demo when it comes into view, and straight away where the
 * browser cannot say. The module is several megabytes, and a reader who
 * never reaches the demo should not pay for it.
 */
export function whenSeen(root: HTMLElement): Mount {
  return (load) => {
    if (typeof IntersectionObserver !== 'function') {
      load();
      return;
    }
    const watch = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      watch.disconnect();
      load();
    });
    watch.observe(root);
  };
}
