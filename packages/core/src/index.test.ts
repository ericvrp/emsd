import { afterEach, expect, test } from "bun:test";
import { getDatabasePath } from "./index";

const originalPath = process.env.EMSD_DB_PATH;

afterEach(() => {
  if (originalPath === undefined) {
    process.env.EMSD_DB_PATH = undefined;
    return;
  }

  process.env.EMSD_DB_PATH = originalPath;
});

test("getDatabasePath resolves repo-relative paths", () => {
  process.env.EMSD_DB_PATH = "data/test.sqlite";

  expect(getDatabasePath()).toEndWith("data/test.sqlite");
});
