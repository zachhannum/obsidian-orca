/**
 * The demo's page, set by the engine the plugin ships.
 *
 * The controls beside it write design keys, and the sheets those keys
 * generate are the plugin's own, so the page here is set the way the
 * plugin sets one. Nothing about the page is drawn by the browser.
 */
import { Client, paintPage, styleOp, type Op } from 'fleuron';
import { Session, documentFaces, serialized, type EngineClient } from '@/engine/session';
import type { Design } from '@/style/design';
import type { Setting } from '@/style/generated';
import { designSheets } from '@/style/sheet';

/** The chapter the demo sets, as the engine takes it. */
export interface Source {
  name: string;
  text: string;
}

/** The page on screen, and the way to set it again. */
export interface Typeset {
  /** Sets the page from a design and paints it. */
  set(design: Design): Promise<void>;
  /** Stops the worker. */
  stop(): void;
}

/**
 * Starts a session over one chapter and paints its first page into
 * `into`. The module is fetched on the first call, so a caller that
 * wants the page later starts this later.
 */
export async function startTypeset(
  into: HTMLElement,
  source: Source,
  setting: Setting,
  design: Design
): Promise<Typeset> {
  const worker = new Worker(new URL('./typeset.worker.ts', import.meta.url), {
    type: 'module',
  });
  const client = new Client({
    post: (request, transfer) => {
      worker.postMessage(request, transfer);
    },
  });
  worker.addEventListener('message', ({ data }: MessageEvent) => {
    client.receive(data);
  });

  // The faces the engine shaped with are registered on the document, so
  // the glyphs the painter places are drawn in the face they were
  // measured in.
  const session = new Session(serialized(client as EngineClient), documentFaces(document));

  /** The book, as the three ops one chapter takes. */
  const opened = (sets: Design): Op[] => [
    { op: 'dialect', dialect: 'obsidian' },
    { op: 'markdown', name: source.name, text: source.text },
    styleOp(designSheets(sets, setting)),
  ];

  const paint = async (): Promise<void> => {
    const reading = await session.read(0, 1);
    if (reading === undefined) return;
    const page = reading.pages[0];
    if (page === undefined) return;
    into.innerHTML = paintPage(page, { fonts: reading.fonts, assets: reading.assets });
    into.dataset['set'] = 'yes';
  };

  await session.open(opened(design));
  await paint();

  return {
    async set(next: Design): Promise<void> {
      // Only the styling changed, so the engine re-fragments over lines
      // it has already broken rather than reading the chapter again.
      await session.render([styleOp(designSheets(next, setting))]);
      await paint();
    },
    stop(): void {
      worker.terminate();
    },
  };
}
