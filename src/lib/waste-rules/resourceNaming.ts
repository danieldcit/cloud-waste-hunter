const NONPROD_NAME_PATTERN = /dev|test|poc|staging|qa/i;

export function resourceNameFromId(id: string): string {
  const segments = id.split("/");
  return segments[segments.length - 1] ?? id;
}

export function isNonProdResourceName(id: string): boolean {
  return NONPROD_NAME_PATTERN.test(resourceNameFromId(id));
}
