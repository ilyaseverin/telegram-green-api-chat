import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatApi } from '../../../api/contracts';
import { ApiError } from '../../../api/errors';
import { useChat } from './useChat';

function mockApi(): ChatApi {
  return {
    receiverKey: 'test-instance',
    connect: vi.fn(),
    resolveContact: vi.fn().mockResolvedValue({ id: '42', name: 'Anna' }),
    getChatHistory: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue('sent-1'),
    receiveNotification: vi.fn(
      (signal: AbortSignal) =>
        new Promise<null>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    ),
    deleteNotification: vi.fn(),
  };
}

describe('chat session', () => {
  it('loads history on creation and synchronizes missed incoming and phone messages after returning to the tab', async () => {
    const api = mockApi();
    vi.mocked(api.getChatHistory)
      .mockResolvedValueOnce([
        {
          serverId: 'old',
          chatId: '42',
          text: 'Старая переписка',
          timestamp: 1000,
          direction: 'incoming',
          status: 'delivered',
        },
      ])
      .mockResolvedValueOnce([
        {
          serverId: 'old',
          chatId: '42',
          text: 'Старая переписка',
          timestamp: 1000,
          direction: 'incoming',
          status: 'delivered',
        },
        {
          serverId: 'phone',
          chatId: '42',
          text: 'С телефона',
          timestamp: 2000,
          direction: 'outgoing',
          status: 'read',
        },
        {
          serverId: 'reply',
          chatId: '42',
          text: 'Входящее',
          timestamp: 3000,
          direction: 'incoming',
          status: 'delivered',
        },
      ]);
    const { result } = renderHook(() => useChat(api));
    await act(() => result.current.createChat('@anna_test'));
    await waitFor(() => expect(result.current.state.chats['42']?.history?.status).toBe('loaded'));
    expect(api.getChatHistory).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(api.getChatHistory).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await waitFor(() =>
      expect(result.current.state.chats['42']?.messages.map((m) => m.text)).toEqual([
        'Старая переписка',
        'С телефона',
        'Входящее',
      ]),
    );
    expect(result.current.state.chats['42']?.unread).toBe(0);
    expect(api.getChatHistory).toHaveBeenCalledTimes(2);
  });

  it('retries failed history loading without losing the contact or blocking new messages', async () => {
    const api = mockApi();
    vi.mocked(api.getChatHistory)
      .mockRejectedValueOnce(new ApiError('История недоступна'))
      .mockResolvedValueOnce([]);
    const { result } = renderHook(() => useChat(api));
    await act(() => result.current.createChat('@anna_test'));
    await waitFor(() => expect(result.current.state.chats['42']?.history?.status).toBe('error'));
    await act(() => result.current.send('42', 'Можно отправлять'));
    await act(async () => result.current.retryHistory('42'));
    await waitFor(() => expect(result.current.state.chats['42']?.history?.status).toBe('loaded'), {
      timeout: 2000,
    });
    expect(result.current.state.chats['42']?.messages[0]?.text).toBe('Можно отправлять');
  });

  it('does not poll history periodically or overlap refreshes and aborts on unmount', async () => {
    vi.useFakeTimers();
    const api = mockApi();
    let finish: ((value: []) => void) | undefined;
    vi.mocked(api.getChatHistory).mockImplementation(
      () =>
        new Promise<[]>((resolve) => {
          finish = resolve;
        }),
    );
    const { result, unmount } = renderHook(() => useChat(api));
    await act(() => result.current.createChat('@anna_test'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      window.dispatchEvent(new Event('focus'));
    });
    expect(api.getChatHistory).toHaveBeenCalledTimes(1);
    await act(async () => finish?.([]));
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(api.getChatHistory).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(api.getChatHistory).toHaveBeenCalledTimes(2);
    const activeSignal = vi.mocked(api.getChatHistory).mock.calls[1]?.[1];
    unmount();
    expect(activeSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.getChatHistory).toHaveBeenCalledTimes(2);
  });
  it('receives live incoming and phone messages only in created chats and acknowledges old and unrelated receipts', async () => {
    const api = mockApi();
    let deliver: ((value: { receiptId: number; body: unknown }) => void) | undefined;
    vi.mocked(api.receiveNotification).mockImplementation(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const { result, unmount } = renderHook(() => useChat(api));
    await act(() => result.current.createChat('@anna_test'));
    await waitFor(() => expect(api.getChatHistory).toHaveBeenCalledTimes(1));
    const now = Math.floor(Date.now() / 1000);
    const receipts = [
      {
        chatId: '42',
        timestamp: now - 3600,
        typeWebhook: 'incomingMessageReceived',
        text: 'Старое уведомление',
      },
      {
        chatId: 'other',
        timestamp: now,
        typeWebhook: 'incomingMessageReceived',
        text: 'Другой диалог',
      },
      { chatId: '42', timestamp: now, typeWebhook: 'incomingMessageReceived', text: 'Входящее' },
      { chatId: '42', timestamp: now, typeWebhook: 'outgoingMessageReceived', text: 'С телефона' },
    ];
    for (const [index, receipt] of receipts.entries()) {
      await act(async () =>
        deliver?.({
          receiptId: index,
          body: {
            typeWebhook: receipt.typeWebhook,
            timestamp: receipt.timestamp,
            idMessage: String(index),
            senderData: { chatId: receipt.chatId, chatName: 'Anna' },
            messageData: {
              typeMessage: 'textMessage',
              textMessageData: { textMessage: receipt.text },
            },
          },
        }),
      );
      await waitFor(() => expect(api.receiveNotification).toHaveBeenCalledTimes(index + 2));
    }
    expect(Object.keys(result.current.state.chats)).toEqual(['42']);
    expect(
      result.current.state.chats['42']?.messages.map((message) => [
        message.text,
        message.direction,
      ]),
    ).toEqual([
      ['Входящее', 'incoming'],
      ['С телефона', 'outgoing'],
    ]);
    expect(api.deleteNotification).toHaveBeenCalledTimes(4);
    expect(api.getChatHistory).toHaveBeenCalledTimes(1);
    unmount();
  });
  it('keeps receiving when an old disconnect notification belongs to an authorized session', async () => {
    const api = mockApi();
    vi.mocked(api.connect).mockResolvedValue(undefined);
    vi.mocked(api.receiveNotification).mockResolvedValueOnce({
      receiptId: 17,
      body: { typeWebhook: 'stateInstanceChanged', stateInstance: 'notAuthorized' },
    });
    const { result, unmount } = renderHook(() => useChat(api));
    await waitFor(() => expect(api.receiveNotification).toHaveBeenCalledTimes(2));
    expect(api.connect).toHaveBeenCalledTimes(1);
    expect(api.deleteNotification).toHaveBeenCalledWith(17, expect.any(AbortSignal));
    expect(result.current.connection.status).toBe('connected');
    unmount();
  });

  it('acknowledges a disconnect and stops when the live instance is no longer authorized', async () => {
    const api = mockApi();
    vi.mocked(api.connect).mockRejectedValue(new ApiError('Telegram отключён'));
    vi.mocked(api.receiveNotification).mockResolvedValueOnce({
      receiptId: 18,
      body: { typeWebhook: 'stateInstanceChanged', stateInstance: 'notAuthorized' },
    });
    const { result, unmount } = renderHook(() => useChat(api));
    await waitFor(() => expect(result.current.connection.status).toBe('stopped'));
    expect(result.current.connection).toEqual({ status: 'stopped', message: 'Telegram отключён' });
    expect(api.deleteNotification).toHaveBeenCalledWith(18, expect.any(AbortSignal));
    expect(api.receiveNotification).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('uses valid Web Locks options and has one active receiver in StrictMode', async () => {
    const request = vi.fn(
      async (_name: string, options: LockOptions, callback: (lock: object) => Promise<void>) => {
        if (options.ifAvailable && options.signal)
          throw new DOMException('Invalid options', 'NotSupportedError');
        await Promise.resolve();
        await callback({ name: 'test', mode: 'exclusive' });
      },
    );
    vi.stubGlobal('navigator', { locks: { request } });
    const api = mockApi();
    const { unmount } = renderHook(() => useChat(api), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });
    await waitFor(() => expect(api.receiveNotification).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledWith(
      'telegram-green-chat:test-instance',
      { signal: expect.any(AbortSignal) },
      expect.any(Function),
    );
    const signal = vi.mocked(api.receiveNotification).mock.calls[0]?.[0];
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('preserves an uncertain send and only retries after an explicit action', async () => {
    const api = mockApi();
    vi.mocked(api.sendMessage)
      .mockRejectedValueOnce(new ApiError('Timeout', true))
      .mockResolvedValueOnce('sent-2');
    const { result } = renderHook(() => useChat(api));
    await act(() => result.current.createChat('+7 999 123-45-67'));
    await act(() => result.current.send('42', 'Hello'));
    expect(result.current.state.chats['42']?.messages[0]?.status).toBe('unknown');
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    const retry = result.current.state.chats['42']?.messages[0];
    await act(() => result.current.send('42', 'Hello', retry));
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(result.current.state.chats['42']?.messages).toHaveLength(1);
    expect(result.current.state.chats['42']?.messages[0]).toMatchObject({
      status: 'queued',
      serverId: 'sent-2',
    });
  });

  it('stops active requests before logout and cannot recreate the cleared chat cache', async () => {
    const api = mockApi();
    vi.mocked(api.getChatHistory).mockImplementation(() => new Promise(() => {}));
    const { result, unmount } = renderHook(() => useChat(api));
    await act(() => result.current.createChat('@anna_test'));
    await waitFor(() => expect(api.getChatHistory).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.stop();
      sessionStorage.clear();
      result.current.selectChat(null);
    });
    expect(vi.mocked(api.getChatHistory).mock.calls[0]?.[1].aborted).toBe(true);
    expect(vi.mocked(api.receiveNotification).mock.calls[0]?.[0].aborted).toBe(true);
    expect(sessionStorage.length).toBe(0);
    unmount();
  });
});
