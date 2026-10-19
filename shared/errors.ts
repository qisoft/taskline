export function asError(value: unknown): Error & { code?: string } {
  return value instanceof Error ? value : new Error(String(value));
}
