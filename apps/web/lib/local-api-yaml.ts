export const LOCAL_API_ROUTE_PATH = "/api/local/v1/current";
export const LOCAL_API_REFRESH_SECONDS = 30;

export interface EntitySensor {
  id: string;
  label: string;
  template: string;
  unit: string;
  deviceClass: string;
  jsonAttributes?: string[];
  jsonAttributesPath?: string;
  stateClass?: string;
  binary?: boolean;
}

export interface EntityOption {
  id: string;
  label: string;
  description?: string;
  template: string;
  unit: string;
  deviceClass: string;
  jsonAttributes?: string[];
  jsonAttributesPath?: string;
  stateClass?: string;
  binary?: boolean;
  meta?: boolean;
  sensors?: EntitySensor[];
}

export const LOCAL_API_ENTITY_OPTIONS: EntityOption[] = [
  {
    id: "ems_basic",
    label: "Basic info",
    description: "daemon, site, devices",
    template: "",
    unit: "",
    deviceClass: "",
    sensors: [
      {
        id: "api_schema",
        label: "API Schema",
        template: "{{ value_json.schema }}",
        unit: "",
        deviceClass: "",
      },
      {
        id: "api_generated_at",
        label: "API Generated At",
        template: "{{ value_json.generatedAt }}",
        unit: "",
        deviceClass: "timestamp",
      },
      {
        id: "daemon_running",
        label: "Daemon Running",
        template: "{{ value_json.daemonRunning }}",
        unit: "",
        deviceClass: "",
        binary: true,
      },
      {
        id: "site_name",
        label: "Site Name",
        template: "{{ value_json.site.name }}",
        unit: "",
        deviceClass: "",
        jsonAttributesPath: "$.site",
        jsonAttributes: ["id", "location"],
      },
      {
        id: "battery_devices",
        label: "Battery Devices",
        template: "{{ value_json.devices.batteries | count }}",
        unit: "",
        deviceClass: "",
        jsonAttributesPath: "$.devices",
        jsonAttributes: ["batteries"],
      },
      {
        id: "meter_devices",
        label: "Meter Devices",
        template: "{{ value_json.devices.meters | count }}",
        unit: "",
        deviceClass: "",
        jsonAttributesPath: "$.devices",
        jsonAttributes: ["meters"],
      },
      {
        id: "solar_devices",
        label: "Solar Devices",
        template: "{{ value_json.devices.solarEnergyProviders | count }}",
        unit: "",
        deviceClass: "",
        jsonAttributesPath: "$.devices",
        jsonAttributes: ["solarEnergyProviders"],
      },
    ],
  },
  {
    id: "ems_price_now",
    label: "Import Price",
    description: "current and upcoming prices",
    template: "{{ value_json.summary.currentImportPrice }}",
    unit: "EUR/kWh",
    deviceClass: "",
    sensors: [
      {
        id: "ems_price_now",
        label: "Import Price",
        template: "{{ value_json.summary.currentImportPrice }}",
        unit: "EUR/kWh",
        deviceClass: "",
        jsonAttributesPath: "$.summary",
        jsonAttributes: [
          "currentExportPrice",
          "currentImportPriceReduction",
          "currentImportPriceCurrency",
          "currentImportPriceStartsAt",
        ],
      },
      {
        id: "export_price_now",
        label: "Export Price",
        template: "{{ value_json.summary.currentExportPrice }}",
        unit: "EUR/kWh",
        deviceClass: "",
      },
      {
        id: "import_price_reduction",
        label: "Import Price Reduction",
        template: "{{ value_json.summary.currentImportPriceReduction }}",
        unit: "EUR/kWh",
        deviceClass: "",
      },
      {
        id: "price_currency",
        label: "Import Price Currency",
        template: "{{ value_json.summary.currentImportPriceCurrency }}",
        unit: "",
        deviceClass: "",
      },
      {
        id: "price_starts_at",
        label: "Import Price Starts At",
        template: "{{ value_json.summary.currentImportPriceStartsAt }}",
        unit: "",
        deviceClass: "timestamp",
      },
      {
        id: "upcoming_prices",
        label: "Upcoming Prices",
        template: "{{ value_json.pricing.upcoming | count }}",
        unit: "",
        deviceClass: "",
        jsonAttributesPath: "$.pricing",
        jsonAttributes: ["current", "upcoming"],
      },
    ],
  },
  {
    id: "ems_negative_price_now",
    label: "Export Price Is Negative",
    template: "{{ value_json.summary.currentExportPriceIsNegative }}",
    unit: "",
    deviceClass: "",
    binary: true,
  },
  {
    id: "ems_battery_info",
    label: "Battery Info",
    description: "soc, strategy, power",
    template: "",
    unit: "",
    deviceClass: "",
    sensors: [
      {
        id: "battery_soc",
        label: "Battery SOC",
        template: "{{ value_json.summary.totalBatterySocPercent }}",
        unit: "%",
        deviceClass: "battery",
      },
      {
        id: "battery_power",
        label: "Battery Power",
        template: "{{ value_json.summary.totalBatteryPowerW }}",
        unit: "W",
        deviceClass: "power",
        stateClass: "measurement",
      },
      {
        id: "battery_state",
        label: "Battery State",
        template: "{{ value_json.devices.batteries[0].state }}",
        unit: "",
        deviceClass: "",
      },
      {
        id: "battery_strategy",
        label: "Battery Strategy",
        template: "{{ value_json.summary.batteryStrategySummary }}",
        unit: "",
        deviceClass: "",
      },
    ],
  },
  {
    id: "ems_solar_forecast",
    label: "Solar Forecast",
    description: "current and upcoming forecast periods",
    template: "{{ value_json.summary.currentForecastSolarPowerW }}",
    unit: "W",
    deviceClass: "power",
    stateClass: "measurement",
    sensors: [
      {
        id: "ems_solar_forecast",
        label: "Solar Forecast",
        template: "{{ value_json.summary.currentForecastSolarPowerW }}",
        unit: "W",
        deviceClass: "power",
        stateClass: "measurement",
        jsonAttributesPath: "$.solarForecast",
        jsonAttributes: [
          "generatedAt",
          "periodMinutes",
          "provider",
          "providerLabel",
          "current",
          "upcoming",
        ],
      },
      {
        id: "solar_forecast_generated_at",
        label: "Solar Forecast Generated At",
        template: "{{ value_json.solarForecast.generatedAt }}",
        unit: "",
        deviceClass: "timestamp",
      },
      {
        id: "solar_forecast_period_minutes",
        label: "Solar Forecast Period Minutes",
        template: "{{ value_json.solarForecast.periodMinutes }}",
        unit: "min",
        deviceClass: "",
      },
      {
        id: "solar_forecast_provider",
        label: "Solar Forecast Provider",
        template: "{{ value_json.solarForecast.providerLabel }}",
        unit: "",
        deviceClass: "",
        jsonAttributesPath: "$.solarForecast",
        jsonAttributes: ["provider"],
      },
      {
        id: "upcoming_solar_forecast",
        label: "Upcoming Solar Forecast",
        template: "{{ value_json.solarForecast.upcoming | count }}",
        unit: "",
        deviceClass: "",
        jsonAttributesPath: "$.solarForecast",
        jsonAttributes: ["current", "upcoming"],
      },
    ],
  },
  {
    id: "ems_solar_power",
    label: "Solar Power",
    template: "{{ value_json.summary.totalSolarPowerW }}",
    unit: "W",
    deviceClass: "power",
    stateClass: "measurement",
  },
  {
    id: "ems_meter_power",
    label: "Grid Power",
    template: "{{ value_json.summary.totalMeterPowerW }}",
    unit: "W",
    deviceClass: "power",
    stateClass: "measurement",
  },
  {
    id: "ems_derived_markers",
    label: "Derived Markers",
    description: "price lows/highs, solar surplus",
    template: "",
    unit: "",
    deviceClass: "",
    sensors: [
      {
        id: "today_low_price_markers",
        label: "Today's Low Price Markers",
        template:
          "{{ value_json.derivedMarkers.todayLowPriceMarkers | count }}",
        unit: "",
        deviceClass: "",
        jsonAttributesPath: "$.derivedMarkers",
        jsonAttributes: [
          "todayLowPriceMarkerStartsAt",
          "todayLowPriceMarkerImportPrice",
          "todayLowPriceMarkers",
        ],
      },
      {
        id: "today_high_price_markers",
        label: "Today's High Price Markers",
        template:
          "{{ value_json.derivedMarkers.todayHighPriceMarkers | count }}",
        unit: "",
        deviceClass: "",
        jsonAttributesPath: "$.derivedMarkers",
        jsonAttributes: [
          "todayHighPriceMarkerStartsAt",
          "todayHighPriceMarkerImportPrice",
          "todayHighPriceMarkers",
        ],
      },
      {
        id: "today_low_price_marker_start",
        label: "Today's Low Price Marker Start",
        template: "{{ value_json.derivedMarkers.todayLowPriceMarkerStartsAt }}",
        unit: "",
        deviceClass: "timestamp",
      },
      {
        id: "today_low_price_marker_price",
        label: "Today's Low Price Marker Price",
        template:
          "{{ value_json.derivedMarkers.todayLowPriceMarkerImportPrice }}",
        unit: "EUR/kWh",
        deviceClass: "",
      },
      {
        id: "today_high_price_marker_start",
        label: "Today's High Price Marker Start",
        template:
          "{{ value_json.derivedMarkers.todayHighPriceMarkerStartsAt }}",
        unit: "",
        deviceClass: "timestamp",
      },
      {
        id: "today_high_price_marker_price",
        label: "Today's High Price Marker Price",
        template:
          "{{ value_json.derivedMarkers.todayHighPriceMarkerImportPrice }}",
        unit: "EUR/kWh",
        deviceClass: "",
      },
      {
        id: "solar_surplus_start",
        label: "Solar Surplus Start",
        template: "{{ value_json.derivedMarkers.solarSurplusStartAt }}",
        unit: "",
        deviceClass: "timestamp",
      },
      {
        id: "solar_surplus_end",
        label: "Solar Surplus End",
        template: "{{ value_json.derivedMarkers.solarSurplusEndAt }}",
        unit: "",
        deviceClass: "timestamp",
      },
    ],
  },
];

export function buildLocalApiExcludeQuery(
  selectedEntityIds: Set<string>,
): string {
  const excludedEntities = LOCAL_API_ENTITY_OPTIONS.map(
    (entity) => entity.id,
  ).filter((id) => !selectedEntityIds.has(id));

  if (excludedEntities.length === 0) {
    return "";
  }

  return `?exclude=${excludedEntities.join(",")}`;
}

export function generateLocalApiYaml(input: {
  entityPrefix: string;
  host: string;
}): string {
  const entities = LOCAL_API_ENTITY_OPTIONS.filter((entity) => !entity.meta);
  const allSensors: EntitySensor[] = [];
  const allBinaries: EntitySensor[] = [];

  for (const entity of entities) {
    if (entity.sensors) {
      for (const sub of entity.sensors) {
        if (sub.binary) {
          allBinaries.push(sub);
        } else {
          allSensors.push(sub);
        }
      }
    } else if (entity.binary) {
      const entry: EntitySensor = {
        id: entity.id,
        label: entity.label,
        template: entity.template,
        unit: entity.unit,
        deviceClass: entity.deviceClass,
        binary: true,
      };

      if (entity.jsonAttributesPath) {
        entry.jsonAttributesPath = entity.jsonAttributesPath;
      }

      if (entity.jsonAttributes) {
        entry.jsonAttributes = entity.jsonAttributes;
      }

      if (entity.stateClass) {
        entry.stateClass = entity.stateClass;
      }

      allBinaries.push(entry);
    } else {
      const entry: EntitySensor = {
        id: entity.id,
        label: entity.label,
        template: entity.template,
        unit: entity.unit,
        deviceClass: entity.deviceClass,
      };

      if (entity.jsonAttributesPath) {
        entry.jsonAttributesPath = entity.jsonAttributesPath;
      }

      if (entity.jsonAttributes) {
        entry.jsonAttributes = entity.jsonAttributes;
      }

      if (entity.stateClass) {
        entry.stateClass = entity.stateClass;
      }

      allSensors.push(entry);
    }
  }

  let sensorLines = "";

  for (const sensor of allSensors) {
    const prefix = input.entityPrefix || "ems";
    const cleanId = sensor.id.replace(/^ems_/, "");
    sensorLines += `      - name: "EMS ${sensor.label}"\n`;
    sensorLines += `        unique_id: ${prefix}_${cleanId}\n`;
    sensorLines += `        value_template: "${sensor.template}"\n`;

    if (sensor.unit) {
      sensorLines += `        unit_of_measurement: "${sensor.unit}"\n`;
    }

    if (sensor.deviceClass) {
      sensorLines += `        device_class: ${sensor.deviceClass}\n`;
    }

    if (sensor.stateClass) {
      sensorLines += `        state_class: ${sensor.stateClass}\n`;
    }

    if (sensor.jsonAttributesPath) {
      sensorLines += `        json_attributes_path: "${sensor.jsonAttributesPath}"\n`;
    }

    if (sensor.jsonAttributes && sensor.jsonAttributes.length > 0) {
      sensorLines += "        json_attributes:\n";
      for (const attribute of sensor.jsonAttributes) {
        sensorLines += `          - ${attribute}\n`;
      }
    }

    sensorLines += "\n";
  }

  let binaryLines = "";

  for (const binarySensor of allBinaries) {
    const prefix = input.entityPrefix || "ems";
    const cleanId = binarySensor.id.replace(/^ems_/, "");
    binaryLines += `      - name: "EMS ${binarySensor.label}"\n`;
    binaryLines += `        unique_id: ${prefix}_${cleanId}\n`;
    binaryLines += `        value_template: "${binarySensor.template}"\n`;

    if (binarySensor.deviceClass) {
      binaryLines += `        device_class: ${binarySensor.deviceClass}\n`;
    }

    binaryLines += "\n";
  }

  return `rest:
  - resource: http://${input.host}${LOCAL_API_ROUTE_PATH}
    scan_interval: ${LOCAL_API_REFRESH_SECONDS}
    timeout: 10
    headers:
      Authorization: !secret ems_local_api_token
    sensor:
${sensorLines.trimEnd() || "      []"}
    binary_sensor:
${binaryLines.trimEnd() || "      []"}
`;
}
