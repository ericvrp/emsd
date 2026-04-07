import { expect, test } from "bun:test";
import { formatDaemonHelpText, parseDaemonOptions } from "./daemon-options";

test("parseDaemonOptions enables verbose mode from flags", () => {
  expect(parseDaemonOptions(["--verbose"])).toEqual({ verbose: true });
  expect(parseDaemonOptions(["-v"])).toEqual({ verbose: true });
});

test("parseDaemonOptions enables verbose mode from EMSD_VERBOSE", () => {
  expect(parseDaemonOptions([], { EMSD_VERBOSE: "true" })).toEqual({
    verbose: true,
  });
});

test("parseDaemonOptions returns null for help", () => {
  expect(parseDaemonOptions(["--help"])).toBeNull();
  expect(parseDaemonOptions(["-h"])).toBeNull();
  expect(parseDaemonOptions(["help"])).toBeNull();
});

test("parseDaemonOptions rejects unknown flags", () => {
  expect(() => parseDaemonOptions(["--debug"])).toThrow(
    "Unknown daemon option: --debug",
  );
});

test("formatDaemonHelpText documents verbose and help", () => {
  expect(formatDaemonHelpText()).toContain("--verbose");
  expect(formatDaemonHelpText()).toContain("--help");
});
