import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const rootEnvPath = resolve(repoRoot, ".env");

export interface ManagedCommand {
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  label: string;
  prefixOutput?: boolean;
}

interface RunningChild {
  child: ReturnType<typeof spawn>;
  label: string;
}

export function getRepoRoot(): string {
  return repoRoot;
}

export function buildSupervisorEnv(mode: "development" | "production") {
  return {
    PORT: "3300",
    ...readDotEnvFile(rootEnvPath),
    ...process.env,
    EMSD_REPO_ROOT: repoRoot,
    EMSD_RUN_MODE: mode,
    NODE_ENV: mode,
  } satisfies NodeJS.ProcessEnv;
}

export async function runLabeledCommand(command: ManagedCommand): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("bun", command.args, {
      cwd: command.cwd ?? repoRoot,
      env: command.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    pipeChildOutput(child.stdout, process.stdout, command.label, true);
    pipeChildOutput(child.stderr, process.stderr, command.label, true);

    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(
        new Error(
          signal
            ? `${command.label} exited from signal ${signal}`
            : `${command.label} exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

export async function runManagedCommands(
  commands: ManagedCommand[],
): Promise<never> {
  await new Promise<never>((resolve, reject) => {
    const runningChildren: RunningChild[] = [];
    let shuttingDown = false;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      removeSignalHandlers();

      if (error) {
        reject(error);
        return;
      }

      resolve(process.exit(0) as never);
    };

    const terminateChildren = (signal: NodeJS.Signals) => {
      for (const { child } of runningChildren) {
        if (!child.killed) {
          child.kill(signal);
        }
      }
    };

    const handleSignal = (signal: NodeJS.Signals) => {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;
      terminateChildren(signal);
      setTimeout(() => finish(), 50).unref();
    };

    const sigintHandler = () => handleSignal("SIGINT");
    const sigtermHandler = () => handleSignal("SIGTERM");

    const removeSignalHandlers = () => {
      process.off("SIGINT", sigintHandler);
      process.off("SIGTERM", sigtermHandler);
    };

    process.on("SIGINT", sigintHandler);
    process.on("SIGTERM", sigtermHandler);

    for (const command of commands) {
      const child = spawn("bun", command.args, {
        cwd: command.cwd ?? repoRoot,
        env: command.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      runningChildren.push({ child, label: command.label });

      pipeChildOutput(
        child.stdout,
        process.stdout,
        command.label,
        command.prefixOutput ?? false,
      );
      pipeChildOutput(
        child.stderr,
        process.stderr,
        command.label,
        command.prefixOutput ?? false,
      );

      child.once("error", (error) => {
        if (shuttingDown) {
          return;
        }

        shuttingDown = true;
        terminateChildren("SIGTERM");
        finish(error);
      });

      child.once("close", (code, signal) => {
        if (settled) {
          return;
        }

        if (shuttingDown) {
          finish();
          return;
        }

        shuttingDown = true;
        terminateChildren("SIGTERM");
        finish(
          new Error(
            signal
              ? `${command.label} exited from signal ${signal}`
              : `${command.label} exited with code ${code ?? "unknown"}`,
          ),
        );
      });
    }
  });

  throw new Error("Supervisor exited unexpectedly");
}

function pipeChildOutput(
  stream: NodeJS.ReadableStream | null,
  target: NodeJS.WritableStream,
  label: string,
  prefixOutput: boolean,
) {
  if (!stream) {
    return;
  }

  let buffered = "";

  stream.on("data", (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");

    if (!prefixOutput) {
      target.write(text);
      return;
    }

    buffered += text;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";

    for (const line of lines) {
      target.write(`[${label}] ${line}\n`);
    }
  });

  stream.on("end", () => {
    if (prefixOutput && buffered) {
      target.write(`[${label}] ${buffered}\n`);
      buffered = "";
    }
  });
}

function readDotEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }

  const parsed: Record<string, string> = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    parsed[key] = unquoteEnvValue(rawValue);
  }

  return parsed;
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
