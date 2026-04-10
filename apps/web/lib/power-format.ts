export function formatPowerValue(value: number): string {
  const absoluteValue = Math.abs(value);

  if (absoluteValue >= 1000) {
    return `${value < 0 ? "-" : ""}${(absoluteValue / 1000).toFixed(2)} kW`;
  }

  return `${Math.round(value)} W`;
}

export function formatAbsolutePowerValue(value: number): string {
  return formatPowerValue(Math.abs(value));
}

export function formatShortPowerValue(value: number): string {
  const absoluteValue = Math.abs(value);

  if (absoluteValue >= 1000) {
    return `${value < 0 ? "-" : ""}${(absoluteValue / 1000).toFixed(1)}k`;
  }

  return `${Math.round(value)}`;
}
