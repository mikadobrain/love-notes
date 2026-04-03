export function useClientOnlyValue<T>(web: T, native: T): T {
  return native;
}
