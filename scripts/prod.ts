import {
  buildSupervisorEnv,
  runLabeledCommand,
  runManagedCommands,
} from "./process-supervisor";

const env = buildSupervisorEnv("production");

await runLabeledCommand({
  args: ["run", "build"],
  env,
  label: "build",
});

await runManagedCommands([
  {
    args: ["apps/daemon/dist/index.js"],
    env,
    label: "daemon",
  },
  {
    args: ["run", "--cwd", "apps/web", "next", "start"],
    env,
    label: "web",
    prefixOutput: true,
  },
]);
