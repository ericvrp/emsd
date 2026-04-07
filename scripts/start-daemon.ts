import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { openSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatDaemonHelpText,
  parseDaemonOptions,
} from "../apps/daemon/src/daemon-options";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const daemonDir = resolve(repoRoot, "apps/daemon");
const runDir = resolve(repoRoot, "var/run");
const logDir = resolve(repoRoot, "var/log");
const pidPath = resolve(runDir, "emsd.pid");
const lockPath = resolve(runDir, "emsd.lock");
const options = parseDaemonOptions(process.argv.slice(2));

if (options === null) {
  console.log(formatDaemonHelpText("daemon:start"));
  process.exit(0);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readRunningPid(filePath: string): number | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const pid = Number.parseInt(readFileSync(filePath, "utf8"), 10);

  if (Number.isNaN(pid)) {
    rmSync(filePath, { force: true });
    return null;
  }

  if (isProcessRunning(pid)) {
    return pid;
  }

  rmSync(filePath, { force: true });
  return null;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

mkdirSync(runDir, { recursive: true });
mkdirSync(logDir, { recursive: true });

const runningPid = readRunningPid(pidPath);

if (runningPid !== null) {
  console.error(`EMSD daemon already running with PID ${runningPid}.`);
  process.exit(1);
}

const runningLockPid = readRunningPid(lockPath);

if (runningLockPid !== null) {
  console.error(`EMSD daemon already running with PID ${runningLockPid}.`);
  process.exit(1);
}

const stdout = openSync(resolve(logDir, "emsd.log"), "a");
const stderr = openSync(resolve(logDir, "emsd.error.log"), "a");

const child = spawn(
  "bun",
  ["run", "src/index.ts", ...(options.verbose ? ["--verbose"] : [])],
  {
    cwd: daemonDir,
    detached: true,
    env: {
      ...process.env,
      EMSD_REPO_ROOT: repoRoot,
    },
    stdio: ["ignore", stdout, stderr],
  },
);

if (child.pid === undefined) {
  console.error(
    "EMSD daemon failed to start because no child PID was returned.",
  );
  process.exit(1);
}

const childPid = child.pid;

await sleep(300);

if (!isProcessRunning(childPid)) {
  rmSync(pidPath, { force: true });

  const lockPid = readRunningPid(lockPath);

  if (lockPid !== null) {
    console.error(`EMSD daemon already running with PID ${lockPid}.`);
    process.exit(1);
  }

  console.error(
    "EMSD daemon failed to start. Check var/log/emsd.error.log for details.",
  );
  process.exit(1);
}

child.unref();
writeFileSync(pidPath, `${childPid}\n`);

console.log(`Started EMSD daemon with PID ${childPid}.`);
console.log(`Logs: ${resolve(logDir, "emsd.log")}`);

if (options.verbose) {
  console.log("Verbose strategy logging enabled.");
}
