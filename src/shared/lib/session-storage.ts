// Browser storage can be disabled or full. The chat must still work in memory.
let available = true;
const listeners = new Set<() => void>();

export const isSessionStorageAvailable = () => available;
export function subscribeSessionStorage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function reportAvailability(value: boolean): boolean {
  if (available !== value) {
    available = value;
    listeners.forEach((listener) => listener());
  }
  return value;
}

export function readSessionValue(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSessionValue(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value);
    return reportAvailability(true);
  } catch {
    return reportAvailability(false);
  }
}

export function removeSessionValue(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Nothing to remove when storage is unavailable.
  }
}
