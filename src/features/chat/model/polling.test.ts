import { describe, expect, it, vi } from 'vitest';
import type { ChatApi } from '../../../api/contracts';
import { ApiError } from '../../../api/errors';
import { pollNotifications } from './polling';

function mockApi(): ChatApi {
  return {
    receiverKey: 'test',
    connect: vi.fn(),
    resolveContact: vi.fn(),
    getChatHistory: vi.fn(),
    sendMessage: vi.fn(),
    receiveNotification: vi.fn(),
    deleteNotification: vi.fn(),
  };
}

describe('notification polling', () => {
  it('drains pending receipts immediately instead of delaying each one by 400 ms', async () => {
    vi.useFakeTimers();
    const api = mockApi();
    const controller = new AbortController();
    let receiptId = 0;
    vi.mocked(api.receiveNotification).mockImplementation(async () => ({
      receiptId: ++receiptId,
      body: {},
    }));
    const process = vi.fn();
    const running = pollNotifications(api, controller.signal, process, () => {
      if (receiptId === 3) controller.abort();
    });
    await vi.advanceTimersByTimeAsync(20);
    await running;
    expect(process).toHaveBeenCalledTimes(3);
    expect(api.deleteNotification).toHaveBeenCalledTimes(3);
  });
  it('processes a receipt before acknowledging it and stops after cancellation', async () => {
    const api = mockApi();
    const order: string[] = [];
    const controller = new AbortController();
    vi.mocked(api.receiveNotification).mockImplementation(async () => {
      order.push('receive');
      return { receiptId: 7, body: { text: 'Hello' } };
    });
    vi.mocked(api.deleteNotification).mockImplementation(async () => {
      order.push('delete');
    });
    await pollNotifications(
      api,
      controller.signal,
      () => {
        order.push('process');
      },
      () => controller.abort(),
    );
    expect(order).toEqual(['receive', 'process', 'delete']);
    expect(api.deleteNotification).toHaveBeenCalledWith(7, controller.signal);
  });

  it('leaves malformed notifications unacknowledged and reports a stopped connection', async () => {
    const api = mockApi();
    vi.mocked(api.receiveNotification).mockResolvedValue({ receiptId: 7, body: {} });
    const onConnection = vi.fn();
    await pollNotifications(
      api,
      new AbortController().signal,
      () => {
        throw new ApiError('Malformed');
      },
      onConnection,
    );
    expect(api.deleteNotification).not.toHaveBeenCalled();
    expect(onConnection).toHaveBeenLastCalledWith({ status: 'stopped', message: 'Malformed' });
  });

  it('retries a failed acknowledgment and processes the repeated receipt safely', async () => {
    vi.useFakeTimers();
    const api = mockApi();
    const controller = new AbortController();
    const process = vi.fn();
    vi.mocked(api.receiveNotification).mockResolvedValue({ receiptId: 7, body: {} });
    vi.mocked(api.deleteNotification)
      .mockRejectedValueOnce(new ApiError('Offline', true))
      .mockResolvedValue(undefined);
    const connection = vi.fn((value) => {
      if (value.status === 'connected') controller.abort();
    });
    const running = pollNotifications(api, controller.signal, process, connection);
    await vi.advanceTimersByTimeAsync(1000);
    await running;
    expect(process).toHaveBeenCalledTimes(2);
    expect(api.deleteNotification).toHaveBeenCalledTimes(2);
    expect(connection).toHaveBeenCalledWith({ status: 'reconnecting', message: 'Offline' });
  });

  it('honors Retry-After and cancels the backoff when the session closes', async () => {
    vi.useFakeTimers();
    const api = mockApi();
    const controller = new AbortController();
    vi.mocked(api.receiveNotification).mockRejectedValue(new ApiError('Rate limit', true, 60_000));
    const running = pollNotifications(api, controller.signal, vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(59_000);
    expect(api.receiveNotification).toHaveBeenCalledTimes(1);
    controller.abort();
    await running;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('acknowledges a state-change notification before stopping', async () => {
    const api = mockApi();
    vi.mocked(api.receiveNotification).mockResolvedValue({ receiptId: 7, body: {} });
    const onConnection = vi.fn();
    await pollNotifications(
      api,
      new AbortController().signal,
      () => ({ status: 'stopped', message: 'Disconnected' }),
      onConnection,
    );
    expect(api.deleteNotification).toHaveBeenCalledTimes(1);
    expect(onConnection).toHaveBeenLastCalledWith({ status: 'stopped', message: 'Disconnected' });
  });

  it('does not acknowledge a receipt received after logout', async () => {
    const api = mockApi();
    const controller = new AbortController();
    vi.mocked(api.receiveNotification).mockImplementation(async () => {
      controller.abort();
      return { receiptId: 7, body: {} };
    });
    const process = vi.fn();
    await pollNotifications(api, controller.signal, process, vi.fn());
    expect(process).not.toHaveBeenCalled();
    expect(api.deleteNotification).not.toHaveBeenCalled();
  });
});
