function formatMessage(label: string, message: string): string {
  return `[ems] ${label}${message}`;
}

export function logEmsInfo(message: string): void {
  console.error(formatMessage("", message));
}

export function logEmsWarn(message: string): void {
  console.warn(formatMessage("WARNING: ", message));
}

export function logEmsError(message: string): void {
  console.error(formatMessage("", message));
}
