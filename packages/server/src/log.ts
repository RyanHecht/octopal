const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function timestamp(): string {
  return new Date().toLocaleString();
}

/** Override console methods to prepend a localized timestamp. */
export function installTimestampedLogging(): void {
  console.log = (...args: unknown[]) =>
    originalLog(`[${timestamp()}]`, ...args);
  console.error = (...args: unknown[]) =>
    originalError(`[${timestamp()}]`, ...args);
  console.warn = (...args: unknown[]) =>
    originalWarn(`[${timestamp()}]`, ...args);
}
