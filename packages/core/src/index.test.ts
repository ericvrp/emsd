import { afterEach, expect, test } from "bun:test";
import {
  discoverReportJsonSchema,
  getDatabasePath,
  parseGpsCoordinate,
} from "./index";

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

test("discoverReportJsonSchema exposes the discover report contract", () => {
  expect(discoverReportJsonSchema.properties.schema.const).toBe(
    "emsd.discover.report.v1",
  );
  expect(discoverReportJsonSchema.properties.devices.items.required).toContain(
    "discoveryId",
  );
});

test("parseGpsCoordinate parses normalized latitude longitude pairs", () => {
  expect(parseGpsCoordinate("52.367600, 4.904100")).toEqual({
    latitude: 52.3676,
    longitude: 4.9041,
  });
  expect(parseGpsCoordinate("invalid")).toBeNull();
  expect(parseGpsCoordinate("91, 4.9")).toBeNull();
});
