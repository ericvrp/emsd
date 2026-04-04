import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const pidPath = resolve(repoRoot, "var/run/emsd.pid");

if (!existsSync(pidPath)) {
  console.log("EMSD daemon is not running.");
  process.exit(0);
}

const pid = Number.parseInt(readFileSync(pidPath, "utf8"), 10);

if (Number.isNaN(pid)) {
  rmSync(pidPath, { force: true });
  console.error("EMSD PID file was invalid and has been removed.");
  process.exit(1);
}

try {
  process.kill(pid, "SIGTERM");
  console.log(`Stopped EMSD daemon with PID ${pid}.`);
} catch {
  console.log(`EMSD daemon PID ${pid} was not running.`);
}

rmSync(pidPath, { force: true });
