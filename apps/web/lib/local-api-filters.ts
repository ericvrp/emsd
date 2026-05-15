import { LOCAL_API_ENTITY_OPTIONS } from "./local-api-yaml";

export function buildLocalApiEntityFilter(
  searchParams: URLSearchParams,
): Set<string> | undefined {
  const allEntityIds = LOCAL_API_ENTITY_OPTIONS.map((entity) => entity.id);
  const include = parseEntityList(searchParams.get("include"));
  const exclude = parseEntityList(searchParams.get("exclude"));
  const excluded = new Set<string>();

  if (include) {
    for (const entityId of allEntityIds) {
      if (!include.has(entityId)) {
        excluded.add(entityId);
      }
    }
  }

  if (exclude) {
    for (const entityId of exclude) {
      excluded.add(entityId);
    }
  }

  return excluded.size > 0 ? excluded : undefined;
}

function parseEntityList(value: string | null): Set<string> | null {
  if (!value) {
    return null;
  }

  const entityIds = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return entityIds.length > 0 ? new Set(entityIds) : null;
}
