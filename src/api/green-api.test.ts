import { describe, expect, it, vi } from 'vitest';
import { GreenApi } from './green-api';
import { validateCredentials, normalizeRecipient } from './validation';

const credentials = {
  idInstance: '4100123456',
  apiTokenInstance: 'test-token-12345678',
  apiUrl: '',
};
const signal = () => new AbortController().signal;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('GreenApi', () => {
  it('calls the browser fetch without binding it to the API client', async () => {
    const fetcher = vi.fn(function (this: unknown, input: RequestInfo | URL) {
      if (this !== undefined) throw new TypeError('Illegal invocation');
      return Promise.resolve(
        json(
          String(input).includes('/getSettings/')
            ? {
                typeInstance: 'telegram',
                webhookUrl: '',
                incomingWebhook: 'yes',
                outgoingMessageWebhook: 'yes',
              }
            : { stateInstance: 'authorized' },
        ),
      );
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(new GreenApi(credentials).connect(signal())).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('validates Telegram type and HTTP notification settings before connecting', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ stateInstance: 'authorized' }))
      .mockResolvedValueOnce(
        json({
          typeInstance: 'telegram',
          webhookUrl: '',
          incomingWebhook: 'yes',
          outgoingMessageWebhook: 'yes',
        }),
      );
    await new GreenApi(credentials, fetcher).connect(signal());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toContain(
      'https://4100.api.green-api.com/waInstance4100123456/getStateInstance/',
    );
  });

  it.each([
    {
      typeInstance: 'whatsapp',
      webhookUrl: '',
      incomingWebhook: 'yes',
      outgoingMessageWebhook: 'yes',
    },
    {
      typeInstance: 'telegram',
      webhookUrl: 'https://example.com',
      incomingWebhook: 'yes',
      outgoingMessageWebhook: 'yes',
    },
    {
      typeInstance: 'telegram',
      webhookUrl: '',
      incomingWebhook: 'no',
      outgoingMessageWebhook: 'yes',
    },
    {
      typeInstance: 'telegram',
      webhookUrl: '',
      incomingWebhook: 'yes',
      outgoingMessageWebhook: 'no',
    },
  ])('rejects an incompatible instance configuration: %o', async (settings) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ stateInstance: 'authorized' }))
      .mockResolvedValueOnce(json(settings));
    await expect(new GreenApi(credentials, fetcher).connect(signal())).rejects.toThrow();
  });

  it('resolves a formatted phone number to a canonical Telegram chat ID', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({ exist: true, chatId: '123456789', username: '@anna', phoneNumber: 79991234567 }),
      )
      .mockResolvedValueOnce(
        json({ chatId: '123456789', name: 'Анна', contactName: 'Анна Петрова' }),
      );
    const contact = await new GreenApi(credentials, fetcher).resolveContact(
      '+7 (999) 123-45-67',
      signal(),
    );
    expect(contact).toEqual({
      id: '123456789',
      name: 'Анна Петрова',
      username: '@anna',
      phone: '79991234567',
    });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      phoneNumber: 79991234567,
    });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ chatId: '123456789' });
  });

  it.each([
    { profile: json({ chatId: '42', name: 'Анна', contactName: '' }), name: 'Анна' },
    { profile: json({ chatId: '42', name: '', contactName: '' }), name: '@anna_test' },
    { profile: new Response('', { status: 500 }), name: '@anna_test' },
  ])(
    'uses a profile name or falls back to username when profile information is unavailable',
    async ({ profile, name }) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json({ exist: true, chatId: '42', username: 'anna_test' }))
        .mockResolvedValueOnce(profile);
      const contact = await new GreenApi(credentials, fetcher).resolveContact(
        '@anna_test',
        signal(),
      );
      expect(contact.id).toBe('42');
      expect(contact.name).toBe(name);
      expect(contact.username).toBe('@anna_test');
    },
  );

  it('sends the canonical chat ID with text and does not retry POST automatically', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ idMessage: 'message-1' }));
    await expect(
      new GreenApi(credentials, fetcher).sendMessage('123456789', '  Привет!  ', signal()),
    ).resolves.toBe('message-1');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      chatId: '123456789',
      message: 'Привет!',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('loads history from Telegram, preserves directions and statuses and excludes non-text, deleted and foreign-chat messages', async () => {
    const base = {
      idMessage: '1',
      chatId: '42',
      timestamp: 123,
      type: 'incoming',
      typeMessage: 'textMessage',
      textMessage: 'С телефона',
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json([
        base,
        {
          ...base,
          idMessage: '2',
          type: 'outgoing',
          statusMessage: 'read',
          textMessage: 'Из другого клиента',
        },
        { ...base, idMessage: '3', type: 'outgoing', statusMessage: 'sent' },
        { ...base, idMessage: '4', typeMessage: 'imageMessage' },
        { ...base, idMessage: '5', isDeleted: true },
        { ...base, idMessage: '6', chatId: 'other' },
      ]),
    );
    const history = await new GreenApi(credentials, fetcher).getChatHistory('42', signal());
    expect(history).toHaveLength(3);
    expect(history[0]).toMatchObject({
      serverId: '1',
      chatId: '42',
      text: 'С телефона',
      direction: 'incoming',
      timestamp: 123_000,
      status: 'delivered',
    });
    expect(history[1]).toMatchObject({ serverId: '2', direction: 'outgoing', status: 'read' });
    expect(history[2]?.status).toBe('queued');
    expect(fetcher.mock.calls[0]?.[0]).toContain('/getChatHistory/');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      chatId: '42',
      count: 100,
    });
  });

  it('treats an empty queue as normal and acknowledges the receipt using DELETE', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(null))
      .mockResolvedValueOnce(json({ result: true }));
    const api = new GreenApi(credentials, fetcher);
    await expect(api.receiveNotification(signal())).resolves.toBeNull();
    await api.deleteNotification(42, signal());
    expect(fetcher.mock.calls[0]?.[0]).toContain('?receiveTimeout=5');
    expect(fetcher.mock.calls[1]?.[0]).toContain('/deleteNotification/test-token-12345678/42');
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe('DELETE');
  });

  it('preserves cancellation instead of reporting an aborted session as a network failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(controller.signal.reason);
    await expect(
      new GreenApi(credentials, fetcher).receiveNotification(controller.signal),
    ).rejects.toBe(controller.signal.reason);
  });

  it('maps authentication failures without exposing the raw response or token', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ error: credentials.apiTokenInstance }, 401));
    await expect(new GreenApi(credentials, fetcher).connect(signal())).rejects.toMatchObject({
      retryable: false,
      message: 'Доступ отклонён. Проверьте idInstance и apiTokenInstance.',
    });
  });

  it('honors HTTP rate limiting', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    await expect(
      new GreenApi(credentials, fetcher).receiveNotification(signal()),
    ).rejects.toMatchObject({ retryable: true, retryAfterMs: 120_000 });
  });

  it('continues waiting after an empty long poll ends with HTTP 408', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 408 }));
    await expect(
      new GreenApi(credentials, fetcher).receiveNotification(signal()),
    ).resolves.toBeNull();
  });

  it('treats HTTP 408 on other methods as a retryable failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 408 }));
    await expect(
      new GreenApi(credentials, fetcher).getChatHistory('42', signal()),
    ).rejects.toMatchObject({ retryable: true });
  });

  it('rejects malformed successful responses and Telegram business errors', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ unexpected: true }))
      .mockResolvedValueOnce(json({ status: false, data: { reason: 'rate_limit_exceeded' } }));
    const api = new GreenApi(credentials, fetcher);
    await expect(api.sendMessage('123', 'Hello', signal())).rejects.toThrow('неожиданном формате');
    await expect(api.resolveContact('@username', signal())).rejects.toThrow('ограничил поиск');
  });
});

describe('input validation', () => {
  it.each([
    'https://evil.example',
    'http://4100.api.green-api.com',
    'https://api.green-api.com.evil.example',
    'https://token@api.green-api.com',
    'https://api.green-api.com/path',
  ])('rejects unsafe API host %s', (apiUrl) => {
    expect(() => validateCredentials({ ...credentials, apiUrl })).toThrow();
  });
  it.each(['123', 'hello', '+0001234567', '+7 999 123 45 67abc'])(
    'rejects invalid recipient %s',
    (recipient) => expect(() => normalizeRecipient(recipient)).toThrow(),
  );
  it('supports usernames when a phone is private', () =>
    expect(normalizeRecipient(' @anna_test ')).toEqual({ username: '@anna_test' }));
});
