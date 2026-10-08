import { z } from 'zod';
import type { Credentials } from '../../api/contracts';
import { validateCredentials } from '../../api/validation';
import {
  readSessionValue,
  removeSessionValue,
  writeSessionValue,
} from '../../shared/lib/session-storage';

const SESSION_KEY = 'telegram-green-chat:session';
const schema = z.object({
  version: z.literal(1),
  credentials: z.object({
    idInstance: z.string(),
    apiTokenInstance: z.string(),
    apiUrl: z.string(),
  }),
});

export function loadCredentials(): Credentials | null {
  try {
    const raw = readSessionValue(SESSION_KEY);
    if (!raw) return null;
    return validateCredentials(schema.parse(JSON.parse(raw)).credentials);
  } catch {
    return null;
  }
}

export function saveCredentials(credentials: Credentials): boolean {
  return writeSessionValue(
    SESSION_KEY,
    JSON.stringify({ version: 1, credentials: validateCredentials(credentials) }),
  );
}

export function clearCredentials(): void {
  removeSessionValue(SESSION_KEY);
}
