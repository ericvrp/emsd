import { buildSupervisorEnv, runManagedCommands } from "./process-supervisor";

const env = buildSupervisorEnv("development");

await runManagedCommands([
  {
    args: ["run", "--cwd", "apps/daemon", "dev"],
    env,
    label: "daemon",
  },
  {
    args: ["run", "--cwd", "apps/web", "next", "dev"],
    env,
    label: "web",
    prefixOutput: true,
  },
]);
