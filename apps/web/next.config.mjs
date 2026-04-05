import { hostname, networkInterfaces } from "node:os";

function getAllowedDevOrigins() {
  const origins = new Set([
    "localhost",
    "127.0.0.1",
    "macmini-eric",
    "macmini-eric.local",
  ]);
  const currentHostname = hostname();
  const normalizedHostname = currentHostname.toLowerCase();
  const shortHostname = normalizedHostname.split(".")[0];

  if (currentHostname) {
    origins.add(currentHostname);
    origins.add(`${currentHostname}.local`);
    origins.add(normalizedHostname);
    origins.add(`${normalizedHostname}.local`);
    origins.add(shortHostname);
    origins.add(`${shortHostname}.local`);
  }

  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) {
        continue;
      }

      origins.add(entry.address);
    }
  }

  return [...origins];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: getAllowedDevOrigins(),
};

export default nextConfig;
