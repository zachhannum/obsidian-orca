/**
 * A plugin has no origin to fetch the module from. The module arrives
 * in the first message, and the worker opens the engine from its bytes.
 */

import { createEngine, type Engine, type Request } from "fleuron";
import { isStart, type Started } from "@/engine/protocol";

/** The worker global, which this project's DOM lib does not describe. */
declare const self: {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

let engine: Promise<Engine> | undefined;

self.onmessage = ({ data }) => {
  if (isStart(data)) {
    engine = createEngine({ wasm: data.module });
    void engine.then(
      () => report({ orca: "ready" }),
      (cause: unknown) => report({ orca: "failed", message: String(cause) }),
    );
    return;
  }

  if (engine === undefined) {
    report({ orca: "failed", message: "a request arrived before the module" });
    return;
  }

  const request = data as Request;
  void engine.then(
    (ready) => {
      ready.submit(request, (response, transfer) =>
        self.postMessage(response, transfer),
      );
    },
    () => {
      // The failure went out with the start reply.
    },
  );
};

function report(message: Started): void {
  self.postMessage(message);
}
