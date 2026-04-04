const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "emsd",
      cwd: path.join(__dirname, "apps/daemon"),
      script: "src/index.ts",
      interpreter: "bun",
      exec_mode: "fork",
      instances: 1,
      env: {
        EMSD_REPO_ROOT: __dirname,
      },
    },
  ],
};
