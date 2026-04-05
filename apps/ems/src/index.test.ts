import { expect, test } from "bun:test";
import { formatHelpText, runEms } from "./index";

test("formatHelpText includes help and discover usage", () => {
  const output = formatHelpText();

  expect(output).toContain("help");
  expect(output).toContain("device <subcommand>");
  expect(output).toContain("discover [--all] [--verbose] [--host <ipv4>]");
});

test("runEms returns success for help command", async () => {
  expect(await runEms(["help"])).toBe(0);
  expect(await runEms(["--help"])).toBe(0);
});
