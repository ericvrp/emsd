export function formatEnergyValue(valueWh: number): string {
  if (valueWh >= 1000) {
    return `${(valueWh / 1000).toFixed(1)} kWh`;
  }

  return `${Math.round(valueWh)} Wh`;
}

export function formatKilowattHoursFromWh(valueWh: number): string {
  return `${(valueWh / 1000).toFixed(1)} kWh`;
}
