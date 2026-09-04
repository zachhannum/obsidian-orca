import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import workerSource from "virtual:worker";
import {
  browserHost,
  startEngine,
  type WorkerHost,
  type WorkerPort,
} from "@/engine/bootstrap";
import { EngineError } from "@/engine/errors";

const root = process.env["ORCA_ROOT"] ?? process.cwd();

class FakeWorker implements WorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly received: unknown[] = [];
  terminated = false;

  constructor(private readonly reply: unknown) {}

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.received.push(structuredClone(message, { transfer: transfer ?? [] }));
    queueMicrotask(() =>
      this.onmessage?.(new MessageEvent("message", { data: this.reply })),
    );
  }

  terminate(): void {
    this.terminated = true;
  }
}

function fakeHost(reply: unknown): WorkerHost & {
  wrapped: string[];
  started: string[];
  released: string[];
  worker: () => FakeWorker;
} {
  const wrapped: string[] = [];
  const started: string[] = [];
  const released: string[] = [];
  let worker: FakeWorker | undefined;
  return {
    wrapped,
    started,
    released,
    worker: () => {
      assert.ok(worker, "no worker was started");
      return worker;
    },
    url: (source) => {
      wrapped.push(source);
      return `blob:orca/${wrapped.length - 1}`;
    },
    release: (url) => {
      released.push(url);
    },
    start: (url) => {
      started.push(url);
      worker = new FakeWorker(reply);
      return worker;
    },
  };
}

test("the worker starts from a Blob URL built out of the bundle", async () => {
  // Anything esbuild left behind for a second file would be an import,
  // and `new Function` would throw.
  assert.doesNotThrow(() => new Function(workerSource));
  assert.ok(workerSource.length > 0);

  const host = fakeHost({ orca: "ready" });
  const handle = await startEngine(new ArrayBuffer(8), host);

  assert.deepEqual(host.wrapped, [workerSource]);
  assert.deepEqual(host.started, ["blob:orca/0"]);
  handle.stop();

  const url = browserHost.url(workerSource);
  assert.match(url, /^blob:/);
  browserHost.release(url);
});

test("the release is one JavaScript file, with the module beside it", async () => {
  const outdir = await mkdtemp(path.join(tmpdir(), "orca-release-"));
  try {
    await run(process.execPath, [
      path.join(root, "esbuild.config.mjs"),
      "production",
      `--out=${outdir}`,
    ]);

    const written = (await readdir(outdir)).sort();
    assert.deepEqual(written, ["fleuron_bg.wasm", "main.js"]);
    assert.ok((await stat(path.join(outdir, "fleuron_bg.wasm"))).size > 0);

    // The worker travels inside the bundle rather than beside it.
    const bundle = await readFile(path.join(outdir, "main.js"), "utf8");
    assert.ok(bundle.includes("createObjectURL"));
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
});

test("the module crosses as a transferable rather than a copy", async () => {
  const host = fakeHost({ orca: "ready" });
  const module = new ArrayBuffer(1024);
  const handle = await startEngine(module, host);

  assert.equal(module.byteLength, 0, "the module was copied, not moved");
  const [start] = host.worker().received as [{ orca: string; module: ArrayBuffer }];
  assert.equal(start.orca, "start");
  assert.equal(start.module.byteLength, 1024);
  handle.stop();
});

test("stopping terminates the worker and revokes the Blob URL", async () => {
  const host = fakeHost({ orca: "ready" });
  const handle = await startEngine(new ArrayBuffer(8), host);

  assert.equal(host.worker().terminated, false);
  assert.deepEqual(host.released, []);

  handle.stop();

  assert.equal(host.worker().terminated, true);
  assert.deepEqual(host.released, ["blob:orca/0"]);
});

test("a worker that cannot open the engine is torn down", async () => {
  const host = fakeHost({ orca: "failed", message: "bad module" });

  await assert.rejects(
    startEngine(new ArrayBuffer(8), host),
    (error: unknown) =>
      error instanceof EngineError && error.message === "bad module",
  );

  assert.equal(host.worker().terminated, true);
  assert.deepEqual(host.released, ["blob:orca/0"]);
});

test("the bundled worker opens the engine from the bytes it is posted", async () => {
  // A Node thread with `self` shimmed runs the same source a Blob URL
  // would, with the same module.
  const shim = `
    import { parentPort, workerData } from "node:worker_threads";
    globalThis.self = {
      set onmessage(handler) {
        parentPort.on("message", (data) => handler({ data }));
      },
      postMessage: (message, transfer) =>
        parentPort.postMessage(message, transfer),
    };
    new Function(workerData.source)();
  `;
  const worker = new Worker(shim, {
    eval: true,
    workerData: { source: workerSource },
  });
  try {
    const started = new Promise<unknown>((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
    });
    const module = await moduleBytes();
    worker.postMessage({ orca: "start", module }, [module]);
    assert.deepEqual(await started, { orca: "ready" });
  } finally {
    await worker.terminate();
  }
});

test("the manifest keeps the plugin off mobile", async () => {
  const manifest: unknown = JSON.parse(
    await readFile(path.join(root, "manifest.json"), "utf8"),
  );
  assert.equal((manifest as { isDesktopOnly?: unknown }).isDesktopOnly, true);
});

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

async function moduleBytes(): Promise<ArrayBuffer> {
  const require = createRequire(import.meta.url);
  const bytes = await readFile(require.resolve("fleuron/fleuron_bg.wasm"));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

// What this tier does not reach: the plugin's own load and unload, which
// needs Obsidian around it, and a render crossing the wire, which waits
// on a page.
