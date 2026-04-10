import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const webRootPath = resolve(import.meta.dir, "../../web");
const forbiddenImportPattern =
  /from\s+["'][^"']*(?:daemon\/src\/|ems\/src\/)[^"']*["']/;

test("web runtime code does not import daemon or EMS internals", () => {
  const files = listWebSourceFiles(webRootPath);

  const offenders = files.filter((filePath) =>
    forbiddenImportPattern.test(readFileSync(filePath, "utf8")),
  );

  expect(offenders).toEqual([]);
});

function listWebSourceFiles(directoryPath: string): string[] {
  const entries = readdirSync(directoryPath, { withFileTypes: true });
  const filePaths: string[] = [];

  for (const entry of entries) {
    const entryPath = resolve(directoryPath, entry.name);

    if (entry.isDirectory()) {
      filePaths.push(...listWebSourceFiles(entryPath));
      continue;
    }

    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      filePaths.push(entryPath);
    }
  }

  return filePaths;
}
