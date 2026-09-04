import { Client, type Response } from "fleuron";
import workerSource from "virtual:worker";
import { EngineError } from "@/engine/errors";
import { isStarted, type Start } from "@/engine/protocol";

/** The half of `Worker` orca uses. */
export interface WorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

/** Blob URLs and workers, so the Node tier can stand in for them. */
export interface WorkerHost {
  url(source: string): string;
  release(url: string): void;
  start(url: string): WorkerPort;
}

/**
 * An engine that started. `startEngine` tears down a worker that could
 * not open one.
 */
export interface EngineHandle {
  readonly client: Client;
  /** Terminates the worker and revokes its Blob URL. */
  stop(): void;
}

/** A browser's own. */
export const browserHost: WorkerHost = {
  url: (source) =>
    URL.createObjectURL(new Blob([source], { type: "text/javascript" })),
  release: (url) => {
    URL.revokeObjectURL(url);
  },
  start: (url) => new Worker(url, { name: "orca" }),
};

/**
 * Starts a worker on the source the build inlined, and opens the engine
 * over `module`, whose bytes are moved rather than copied. A worker that
 * cannot open one is torn down before the error comes back.
 */
export async function startEngine(
  module: ArrayBuffer,
  host: WorkerHost = browserHost,
): Promise<EngineHandle> {
  const url = host.url(workerSource);
  const worker = host.start(url);
  const stop = (): void => {
    worker.terminate();
    host.release(url);
  };

  const client = new Client({
    post: (request, transfer) => {
      worker.postMessage(request, transfer);
    },
  });

  const running = new Promise<void>((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (isStarted(data)) {
        if (data.orca === "ready") resolve();
        else reject(new EngineError(data.message));
        return;
      }
      client.receive(data as Response);
    };
  });

  const start: Start = { orca: "start", module };
  worker.postMessage(start, [module]);

  try {
    await running;
  } catch (cause) {
    stop();
    throw cause;
  }

  return { client, stop };
}
