export type SearchParamValue = string | string[] | undefined;

export function getSearchParamValue(value: SearchParamValue): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (Array.isArray(value)) {
    return typeof value[0] === "string" && value[0].length > 0
      ? value[0]
      : null;
  }

  return null;
}
