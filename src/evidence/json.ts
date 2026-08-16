export function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export function stringifyJson(value: unknown, space = 2): string {
  return JSON.stringify(value, jsonReplacer, space);
}
