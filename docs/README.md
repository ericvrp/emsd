# Documentation

This folder collects product notes, operator docs, plugin guides, implementation plans, and device/provider reference material for EMSD.

## Start Here

- `../README.md`: repository overview, setup, and common commands
- `local-api.md`: local HTTP API for Home Assistant and other LAN consumers
- `price-selection.md`: shared low/high price marker selection behavior
- `strategies/README.md`: built-in battery strategy overview
- `plugins/README.md`: plugin authoring entrypoint and EMS-first integration rules
- `plans/README.md`: active implementation plan index

## Scripts

- `scripts/dynamic-price-target.md`: shared dynamic target estimator and evaluator used by `targetMethod: auto`

## Strategies

- `strategies/README.md`: overview of built-in battery strategy types and current status
- `strategies/priority.md`: daemon-owned strategy priority, blocking, and preemption rules
- `strategies/self-consumption.md`: default fallback behavior
- `strategies/export-surplus.md`: built-in export-surplus behavior
- `strategies/delayed-charge-prep.md`: bridge behavior between export surplus and delayed charging
- `strategies/delayed-charging.md`: delayed-charging rule behavior and implementation notes

## Plugins

- `plugins/README.md`: plugin overview, terminology notes, and integration checklist
- `plugins/battery/README.md`: adding battery plugins
- `plugins/meter/README.md`: adding meter plugins
- `plugins/solar-forecast/README.md`: adding solar forecast plugins
- `plugins/price/README.md`: adding dynamic price plugins
- `plugins/solar-energy-provider/README.md`: adding solar energy provider plugins

## Plans

- `plans/README.md`: plan index
- `plans/huawei-solar-energy-provider-plan.md`: Huawei SUN2000 Modbus provider support, shipped status, and remaining next steps

## Reference

- `reference/batteries/homewizard/README.md`: HomeWizard battery reference notes
- `reference/batteries/indevolt/README.md`: Indevolt battery reference notes
- `reference/meters/p1/README.md`: P1 meter reference notes
- `reference/solar-forecast/open-meteo.md`: Open-Meteo forecast provider reference
- `reference/price/tibber.md`: Tibber dynamic price provider reference
- `reference/solar-energy-provider/enphase.md`: Enphase local provider reference
- `reference/solar-energy-provider/huawei.md`: Huawei solar provider reference
- `reference/solar-energy-provider/solaredge.md`: SolarEdge local provider reference
