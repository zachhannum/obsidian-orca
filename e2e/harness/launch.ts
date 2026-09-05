/**
 * One Obsidian, opened on a copy of the fixture vault with the plugin
 * installed in it and the debugging port open. It starts before the
 * first spec and is killed after the last.
 */

import { execFileSync, type ChildProcess } from "node:child_process";
import { copyFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ObsidianLauncher from "obsidian-launcher";

/** The Obsidian the suite runs against, and the installer it runs on. */
export const OBSIDIAN = "1.13.7";
const INSTALLER = "1.13.7";

const PLUGIN = "orca";
const MODULE = "fleuron_bg.wasm";

const root = path.resolve(fileURLToPath(import.meta.url), "../../..");

/**
 * The vault as it is checked in. A spec that changes the copy puts it
 * back from here.
 */
export const FIXTURE = path.join(root, "fixture");

/** The environment a spec reads the debugging port from. */
export const CDP = "ORCA_E2E_CDP";

/** Timeout for Obsidian to open its debugging port, in milliseconds. */
const OPENING = 60_000;

export default async function launch(): Promise<() => Promise<void>> {
  const staged = path.join(root, "build/plugin");
  execFileSync(
    process.execPath,
    ["esbuild.config.mjs", "production", `--out=${staged}`],
    { cwd: root, stdio: "inherit" },
  );

  const launcher = new ObsidianLauncher();
  const vault = await launcher.setupVault({
    vault: FIXTURE,
    copy: true,
    plugins: [{ path: staged }],
  });
  // The launcher installs a plugin's manifest, bundle and stylesheet.
  // The engine module is the fourth file of orca's release, and is
  // copied beside them here.
  await copyFile(
    path.join(staged, MODULE),
    path.join(vault, ".obsidian/plugins", PLUGIN, MODULE),
  );

  const { proc, configDir } = await launcher.launch({
    appVersion: OBSIDIAN,
    installerVersion: INSTALLER,
    vault,
    copy: false,
    args: ["--remote-debugging-port=0"],
  });

  try {
    process.env[CDP] = `http://127.0.0.1:${await port(proc)}`;
  } catch (cause) {
    await stop(proc);
    throw cause;
  }

  return async () => {
    await stop(proc);
    await rm(vault, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  };
}

/**
 * The port Obsidian opened, read from the line Chromium writes when it
 * opens one. The harness asks for port 0, so two runs on one machine
 * cannot pick the same number.
 */
function port(proc: ChildProcess): Promise<number> {
  proc.stdout?.resume();
  return new Promise((resolve, reject) => {
    let said = "";
    const timer = setTimeout(() => {
      reject(new Error(`no debugging port in ${OPENING}ms\n${said}`));
    }, OPENING);
    timer.unref();

    proc.stderr?.on("data", (chunk: Buffer) => {
      said = (said + chunk.toString()).slice(-4096);
      const found = /ws:\/\/[\w.]+?:(\d+)/.exec(said)?.[1];
      if (found !== undefined) {
        clearTimeout(timer);
        resolve(Number(found));
      }
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Obsidian exited with ${code} before opening a debugging port\n${said}`,
        ),
      );
    });
  });
}

async function stop(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  const closed = new Promise<void>((resolve) =>
    proc.once("close", () => {
      resolve();
    }),
  );
  proc.kill("SIGTERM");
  await Promise.race([
    closed,
    new Promise<void>((resolve) => {
      setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, 10_000).unref();
    }),
  ]);
}
