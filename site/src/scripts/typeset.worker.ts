/**
 * The worker the demo's page is set in.
 *
 * The module finds its own `.wasm` beside the glue, which is what a
 * site that serves the package can do. Layout is hundreds of
 * milliseconds of work, and that much on the main thread is a page
 * that stops answering the controls beside it.
 */
import { createEngine } from 'fleuron';

/** The worker's own global, which the DOM's `self` does not describe. */
interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

const engine = createEngine();

scope.onmessage = ({ data }: MessageEvent) => {
  void engine.then((ready) =>
    ready.submit(data, (response, transfer) => {
      scope.postMessage(response, transfer);
    })
  );
};
