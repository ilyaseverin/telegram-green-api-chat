import { describe, expect, it } from 'vitest';
import { clearCredentials, loadCredentials, saveCredentials } from './session';

describe('saved credentials', () => {
  it('normalizes credentials, stores them only for this tab and removes them on logout', () => {
    saveCredentials({
      idInstance: ' 4100123456 ',
      apiTokenInstance: 'test-token-12345678',
      apiUrl: '',
    });
    expect(loadCredentials()).toEqual({
      idInstance: '4100123456',
      apiTokenInstance: 'test-token-12345678',
      apiUrl: 'https://4100.api.green-api.com',
    });
    expect(localStorage.length).toBe(0);
    clearCredentials();
    expect(loadCredentials()).toBeNull();
  });

  it('never restores credentials targeting an untrusted API host', () => {
    sessionStorage.setItem(
      'telegram-green-chat:session',
      JSON.stringify({
        version: 1,
        credentials: {
          idInstance: '4100123456',
          apiTokenInstance: 'test-token-12345678',
          apiUrl: 'https://example.com',
        },
      }),
    );
    expect(loadCredentials()).toBeNull();
  });
});
