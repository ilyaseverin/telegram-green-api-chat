import type { ChatApi } from '../../../api/contracts';
import { ApiError, errorMessage } from '../../../api/errors';
import type { Connection } from './types';
import { abortableDelay } from '../../../shared/lib/abortable-delay';

export async function pollNotifications(
  api: ChatApi,
  signal: AbortSignal,
  onNotification: (body: unknown) => Connection | void | Promise<Connection | void>,
  onConnection: (connection: Connection) => void,
): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    try {
      const started = Date.now();
      const notification = await api.receiveNotification(signal);
      signal.throwIfAborted();
      if (notification) {
        const nextConnection = await onNotification(notification.body);
        signal.throwIfAborted();
        await api.deleteNotification(notification.receiptId, signal);
        if (nextConnection?.status === 'stopped') {
          onConnection(nextConnection);
          return;
        }
      }
      signal.throwIfAborted();
      failures = 0;
      onConnection({ status: 'connected' });
      // Drain queued receipts promptly, within GREEN-API's 100 requests/second limit.
      // Only fast empty responses need a longer pause to avoid a busy loop.
      await abortableDelay(Math.max(0, (notification ? 10 : 400) - (Date.now() - started)), signal);
    } catch (error) {
      if (signal.aborted) return;
      if (!(error instanceof ApiError) || !error.retryable) {
        onConnection({ status: 'stopped', message: errorMessage(error) });
        return;
      }
      onConnection({ status: 'reconnecting', message: error.message });
      const backoff = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
      try {
        await abortableDelay(Math.max(backoff, error.retryAfterMs), signal);
      } catch {
        return;
      }
    }
  }
}
