/**
 * Tiny wrappers around localStorage. Storage can be unavailable (private
 * windows, blocked site data), so every access is best-effort.
 */
export function readPreference(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** `false` when the browser refused the write (no storage, quota exceeded). */
export function writePreference(key: string, value: string): boolean {
  try {
    if (!globalThis.localStorage) {
      return false;
    }
    globalThis.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removePreference(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

export function readJsonPreference<T>(key: string, fallback: T): T {
  const raw = readPreference(key);
  if (raw === null) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonPreference(key: string, value: unknown): boolean {
  return writePreference(key, JSON.stringify(value));
}
