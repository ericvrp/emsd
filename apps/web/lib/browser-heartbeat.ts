const ENABLE_BROWSER_INTERVAL_HEARTBEAT = true;

export function logBrowserIntervalHeartbeat(label: string): void {
  if (!ENABLE_BROWSER_INTERVAL_HEARTBEAT) {
    return;
  }

  console.log(
    `[browser-heartbeat] ${new Date().toLocaleTimeString()} ${window.location.pathname} ${label}`,
  );
}
