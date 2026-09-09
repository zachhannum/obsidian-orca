import { Client, VERSION, WIRE_VERSION, type Response } from "fleuron";
import workerSource from "virtual:worker";
import { EngineError } from "@/engine/errors";
import { isStarted, type Start } from "@/engine/protocol";

/** The half of `Worker` orca uses. */
export interface WorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  /** The worker threw where nothing caught it, which is a worker orca cannot use again. */
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

/** Blob URLs and workers, so the Node tier can stand in for them. */
export interface WorkerHost {
  url(source: string): string;
  release(url: string): void;
  start(url: string): WorkerPort;
}

export interface EngineHandle {
  readonly client: Client;
  /**
   * Runs `told` once the worker dies. A worker that died before the
   * call tells at once, so a caller cannot miss the one report.
   */
  dies(told: (cause: EngineError) => void): void;
  /**
   * Terminates the worker and revokes its Blob URL. Every request the
   * worker was still holding is refused, because a terminated worker
   * answers none of them and a caller awaiting one would wait forever.
   */
  stop(): void;
}

export const browserHost: WorkerHost = {
  url: (source) =>
    URL.createObjectURL(new Blob([source], { type: "text/javascript" })),
  release: (url) => {
    URL.revokeObjectURL(url);
  },
  start: (url) => new Worker(url, { name: "orca" }),
};

/**
 * Starts the bundled worker and opens the engine from `module`, whose
 * bytes are moved rather than copied. A worker that cannot open one is
 * torn down before the error comes back.
 */
export async function startEngine(
  module: ArrayBuffer,
  host: WorkerHost = browserHost,
): Promise<EngineHandle> {
  const url = host.url(workerSource);
  const worker = host.start(url);
  /** The requests the worker has not answered, by the id each one carries. */
  const holding = new Set<number>();
  let stopped = false;
  let dead: EngineError | undefined;
  let told: ((cause: EngineError) => void) | undefined;

  const client = new Client({
    post: (request, transfer) => {
      if (stopped) {
        refuse(request.id, request.generation, gone());
        return;
      }
      holding.add(request.id);
      worker.postMessage(request, transfer);
    },
  });

  /** Answers one request the way the engine answers a request it refused. */
  const refuse = (id: number, generation: number, said: string): void => {
    queueMicrotask(() => {
      client.receive({ id, generation, error: said });
    });
  };

  const gone = (): string => dead?.message ?? "the engine stopped";

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    worker.terminate();
    host.release(url);
    const waiting = [...holding];
    holding.clear();
    for (const id of waiting) refuse(id, client.current, gone());
  };

  const died = (said: string): void => {
    if (dead !== undefined) return;
    dead = new EngineError(said);
    stop();
    told?.(dead);
  };

  const running = new Promise<void>((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (isStarted(data)) {
        if (data.orca === "failed") reject(new EngineError(data.message));
        else if (data.wire === WIRE_VERSION) resolve();
        else reject(new EngineError(mismatch(data.wire)));
        return;
      }
      const response = data as Response;
      holding.delete(response.id);
      client.receive(response);
    };
    worker.onerror = (event) => {
      const said = event.message === "" ? "the engine stopped" : event.message;
      reject(new EngineError(said));
      died(said);
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

  return {
    client,
    dies: (heard) => {
      told = heard;
      if (dead !== undefined) heard(dead);
    },
    stop,
  };
}

/**
 * The display structure is positional, so a bundle and a module that
 * disagree about it fail at the first byte. The failure this catches is
 * a plugin updated without its module beside it.
 */
function mismatch(wire: number): string {
  return (
    `orca is built against fleuron ${VERSION}, which reads wire ` +
    `${WIRE_VERSION}; the module beside it is wire ${wire}`
  );
}
