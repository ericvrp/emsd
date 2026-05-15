import { expect, test } from "bun:test";
import {
  buildLocalApiExcludeQuery,
  generateLocalApiYaml,
} from "./local-api-yaml";

test("generateLocalApiYaml includes all available entity categories", () => {
  const yaml = generateLocalApiYaml({
    entityPrefix: "ems",
    host: "ems.local:3300",
  });

  expect(yaml).toContain(
    "resource: http://ems.local:3300/api/local/v1/current",
  );
  expect(yaml).not.toContain("?exclude=");
  expect(yaml).toContain("scan_interval: 30");
  expect(yaml).toContain('name: "EMS API Schema"');
  expect(yaml).toContain('name: "EMS API Generated At"');
  expect(yaml).toContain('name: "EMS Daemon Running"');
  expect(yaml).toContain('name: "EMS Site Name"');
  expect(yaml).toContain('name: "EMS Import Price"');
  expect(yaml).toContain("- currentImportPriceCurrency");
  expect(yaml).toContain("- currentImportPriceStartsAt");
  expect(yaml).toContain('name: "EMS Import Price Currency"');
  expect(yaml).toContain('name: "EMS Import Price Starts At"');
  expect(yaml).toContain('name: "EMS Upcoming Prices"');
  expect(yaml).toContain("- upcoming");
  expect(yaml).toContain('name: "EMS Import Price Is Negative"');
  expect(yaml).toContain('name: "EMS Battery SOC"');
  expect(yaml).toContain('name: "EMS Battery Strategy"');
  expect(yaml).toContain('name: "EMS Battery Devices"');
  expect(yaml).toContain("- batteries");
  expect(yaml).toContain('name: "EMS Grid Power"');
  expect(yaml).toContain('name: "EMS Meter Devices"');
  expect(yaml).toContain("- meters");
  expect(yaml).toContain('name: "EMS Solar Forecast Generated At"');
  expect(yaml).toContain('name: "EMS Solar Forecast Period Minutes"');
  expect(yaml).toContain('name: "EMS Solar Forecast Provider"');
  expect(yaml).toContain('name: "EMS Upcoming Solar Forecast"');
  expect(yaml).toContain('name: "EMS Solar Devices"');
  expect(yaml).toContain("- solarEnergyProviders");
  expect(yaml).toContain('name: "EMS Today\'s Low Price Markers"');
  expect(yaml).toContain(
    "value_json.derivedMarkers.todayLowPriceMarkers | count",
  );
  expect(yaml).toContain("- todayLowPriceMarkers");
  expect(yaml).toContain('name: "EMS Today\'s Low Price Marker Start"');
  expect(yaml).toContain('name: "EMS Today\'s Low Price Marker Price"');
  expect(yaml).toContain('name: "EMS Today\'s High Price Markers"');
  expect(yaml).toContain(
    "value_json.derivedMarkers.todayHighPriceMarkers | count",
  );
  expect(yaml).toContain("- todayHighPriceMarkers");
  expect(yaml).toContain('name: "EMS Today\'s High Price Marker Start"');
  expect(yaml).toContain('name: "EMS Today\'s High Price Marker Price"');
  expect(yaml).toContain('name: "EMS Solar Surplus Start"');
  expect(yaml).toContain('name: "EMS Solar Surplus End"');
});

test("buildLocalApiExcludeQuery still supports explicit filtering", () => {
  const query = buildLocalApiExcludeQuery(
    new Set(["ems_price_now", "ems_derived_markers"]),
  );

  expect(query).toBe(
    "?exclude=ems_basic,ems_negative_price_now,ems_battery_info,ems_solar_forecast,ems_solar_power,ems_meter_power",
  );
});
