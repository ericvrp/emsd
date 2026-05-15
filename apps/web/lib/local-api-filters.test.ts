import { expect, test } from "bun:test";
import { buildLocalApiEntityFilter } from "./local-api-filters";

test("buildLocalApiEntityFilter supports include filters", () => {
  const filter = buildLocalApiEntityFilter(
    new URLSearchParams("include=ems_price_now,ems_derived_markers"),
  );

  expect(filter).toEqual(
    new Set([
      "ems_basic",
      "ems_negative_price_now",
      "ems_battery_info",
      "ems_solar_forecast",
      "ems_solar_power",
      "ems_meter_power",
    ]),
  );
});

test("buildLocalApiEntityFilter lets exclude override include", () => {
  const filter = buildLocalApiEntityFilter(
    new URLSearchParams(
      "include=ems_price_now,ems_meter_power&exclude=ems_meter_power",
    ),
  );

  expect(filter?.has("ems_price_now")).toBe(false);
  expect(filter?.has("ems_meter_power")).toBe(true);
});
