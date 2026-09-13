const NONPROD_NAME_PATTERN = /dev|test|poc|staging|qa/i;

export function vmssNameFromId(id: string): string {
  const segments = id.split("/");
  return segments[segments.length - 1] ?? id;
}

export function isNonProdVmssName(id: string): boolean {
  return NONPROD_NAME_PATTERN.test(vmssNameFromId(id));
}
