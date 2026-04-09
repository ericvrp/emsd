import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBatteryStrategyRuntime,
  stringifyBatteryStrategyPlan,
  stringifyBatteryStrategyRuntime,
} from "@emsd/core";
import { openDaemonDatabase } from "../../daemon/src/database";
import {
  setBatteryStrategy,
  setBatteryStrategyPlan,
} from "./managed-site-store";

test("setBatteryStrategy clears active scheduled runtime on manual change", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-ems-runtime-test-"));
  const databasePath = join(tempDir, "emsd.sqlite");
  const db = openDaemonDatabase(databasePath);

  try {
    db.query(
      "INSERT INTO sites (id, name, location, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).run(
      "home",
      "Home",
      "",
      "2026-04-09T00:00:00.000Z",
      "2026-04-09T00:00:00.000Z",
    );

    const strategyPlan = [
      {
        id: "default",
        kind: "default" as const,
        startTime: null,
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: null,
        triggerKind: null,
        strategyMode: "self-consumption" as const,
        manualState: null,
        manualPowerW: null,
        manualChargeTargetSoc: 100,
        manualDischargeTargetSoc: 10,
        manualTargetSoc: 100,
      },
      {
        id: "daily-1",
        kind: "daily" as const,
        startTime: "07:00",
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: "soc" as const,
        triggerKind: "daily-time" as const,
        strategyMode: "manual" as const,
        manualState: "discharging" as const,
        manualPowerW: 2400,
        manualChargeTargetSoc: null,
        manualDischargeTargetSoc: 40,
        manualTargetSoc: 40,
      },
    ];

    db.query(
      `
        INSERT INTO batteries (
          id,
          site_id,
          name,
          plugin,
          model,
          ip_address,
          enabled,
          status,
          connected,
          minimum_discharge_percent,
          strategy_mode,
          manual_state,
          manual_power_w,
          manual_charge_target_soc,
          manual_discharge_target_soc,
          manual_target_soc,
          now_mode_active,
          now_mode_started,
          strategy_plan_json,
          strategy_runtime_json,
          updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
      `,
    ).run(
      "battery-1",
      "home",
      "Battery",
      "indevolt-battery",
      "indevolt-battery",
      "192.168.1.10",
      1,
      "idle",
      1,
      10,
      "manual",
      "discharging",
      2400,
      100,
      40,
      40,
      0,
      0,
      stringifyBatteryStrategyPlan(
        strategyPlan,
        {
          strategyMode: "manual",
          manualState: "discharging",
          manualPowerW: 2400,
          manualChargeTargetSoc: 100,
          manualDischargeTargetSoc: 40,
          manualTargetSoc: 40,
        },
        10,
      ),
      stringifyBatteryStrategyRuntime({
        activeItemId: "daily-1",
        activeStartedAt: "2026-04-09T07:00:00.000Z",
        lastTriggeredAtByItemId: {
          "daily-1": "2026-04-09T07:00:00.000Z",
        },
      }),
      "2026-04-09T07:00:00.000Z",
    );

    const updated = setBatteryStrategy(
      "battery-1",
      {
        strategyMode: "manual",
        manualState: "charging",
        manualPowerW: 1800,
        manualChargeTargetSoc: 90,
        manualDischargeTargetSoc: 10,
        manualTargetSoc: 90,
        nowModeActive: true,
      },
      "home",
      databasePath,
    );

    expect(updated).not.toBeNull();
    expect(updated?.strategyRuntime).toEqual({
      activeItemId: null,
      activeStartedAt: null,
      lastTriggeredAtByItemId: {
        "daily-1": "2026-04-09T07:00:00.000Z",
      },
    });
  } finally {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setBatteryStrategyPlan clears stale scheduled runtime history", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "emsd-ems-runtime-test-"));
  const databasePath = join(tempDir, "emsd.sqlite");
  const db = openDaemonDatabase(databasePath);

  try {
    db.query(
      "INSERT INTO sites (id, name, location, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).run(
      "home",
      "Home",
      "",
      "2026-04-09T00:00:00.000Z",
      "2026-04-09T00:00:00.000Z",
    );

    const existingPlan = [
      {
        id: "default",
        kind: "default" as const,
        startTime: null,
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: null,
        triggerKind: null,
        strategyMode: "self-consumption" as const,
        manualState: null,
        manualPowerW: null,
        manualChargeTargetSoc: 100,
        manualDischargeTargetSoc: 10,
        manualTargetSoc: 100,
      },
      {
        id: "daily-1",
        kind: "daily" as const,
        startTime: "20:00",
        targetDurationMinutes: null,
        targetEndTime: null,
        targetMethod: "soc" as const,
        triggerKind: "daily-time" as const,
        strategyMode: "manual" as const,
        manualState: "discharging" as const,
        manualPowerW: 2400,
        manualChargeTargetSoc: null,
        manualDischargeTargetSoc: 20,
        manualTargetSoc: 20,
      },
    ];

    db.query(
      `
        INSERT INTO batteries (
          id,
          site_id,
          name,
          plugin,
          model,
          ip_address,
          enabled,
          status,
          connected,
          minimum_discharge_percent,
          strategy_mode,
          manual_state,
          manual_power_w,
          manual_charge_target_soc,
          manual_discharge_target_soc,
          manual_target_soc,
          now_mode_active,
          now_mode_started,
          strategy_plan_json,
          strategy_runtime_json,
          updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
      `,
    ).run(
      "battery-1",
      "home",
      "Battery",
      "indevolt-battery",
      "indevolt-battery",
      "192.168.1.10",
      1,
      "idle",
      1,
      10,
      "self-consumption",
      null,
      null,
      100,
      10,
      100,
      0,
      0,
      stringifyBatteryStrategyPlan(
        existingPlan,
        {
          strategyMode: "self-consumption",
          manualState: null,
          manualPowerW: null,
          manualChargeTargetSoc: 100,
          manualDischargeTargetSoc: 10,
          manualTargetSoc: 100,
        },
        10,
      ),
      stringifyBatteryStrategyRuntime({
        activeItemId: null,
        activeStartedAt: null,
        lastTriggeredAtByItemId: {
          "daily-1": "2026-04-09T20:00:00.000Z",
        },
      }),
      "2026-04-09T20:00:00.000Z",
    );

    const fallbackItem = existingPlan[0];
    const dailyItem = existingPlan[1];

    if (!fallbackItem || !dailyItem) {
      throw new Error("expected seeded strategy plan items");
    }

    const updated = setBatteryStrategyPlan(
      "battery-1",
      {
        strategyPlan: [
          fallbackItem,
          {
            ...dailyItem,
            startTime: "21:00",
          },
        ],
      },
      "home",
      databasePath,
    );

    expect(updated).not.toBeNull();
    expect(updated?.strategyRuntime).toEqual(createBatteryStrategyRuntime());
  } finally {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
