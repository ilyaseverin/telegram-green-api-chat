import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import {
  isSessionStorageAvailable,
  subscribeSessionStorage,
} from '../../../shared/lib/session-storage';
import type { ChatApi } from '../../../api/contracts';
import { ApiError, errorMessage } from '../../../api/errors';
import { validateMessage } from '../../../api/validation';
import { parseNotification } from './notifications';
import { pollNotifications } from './polling';
import { chatReducer } from './reducer';
import type { Connection, Message } from './types';
import { loadChats, saveChats } from './persistence';
import { abortableDelay } from '../../../shared/lib/abortable-delay';

export function useChat(api: ChatApi) {
  const receiverKey = api.receiverKey;
  const [state, dispatch] = useReducer(chatReducer, receiverKey, loadChats);
  const storageAvailable = useSyncExternalStore(subscribeSessionStorage, isSessionStorageAvailable);
  const [connection, setConnection] = useState<Connection>({ status: 'connecting' });
  const [pollVersion, restartPolling] = useReducer((version: number) => version + 1, 0);
  const session = useRef<AbortController | null>(null);
  const sending = useRef(new Set<string>());
  const [historyVersion, refreshHistory] = useReducer((version: number) => version + 1, 0);
  const historyRequestedAt = useRef(0);
  const receiveFrom = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    session.current = controller;
    receiveFrom.current = Math.floor(Date.now() / 1000) * 1000;
    return () => {
      controller.abort();
      session.current = null;
    };
  }, [api]);

  useEffect(() => {
    if (session.current && !session.current.signal.aborted) saveChats(receiverKey, state);
  }, [receiverKey, state]);

  useEffect(() => {
    const chatId = state.activeId;
    if (!chatId || !session.current) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.current.signal]);
    let loading = true;
    const load = async () => {
      try {
        // GetChatHistory permits one request per second per instance.
        await abortableDelay(Math.max(0, 1000 - (Date.now() - historyRequestedAt.current)), signal);
        signal.throwIfAborted();
        historyRequestedAt.current = Date.now();
        const messages = await api.getChatHistory(chatId, signal);
        signal.throwIfAborted();
        dispatch({ type: 'historyLoaded', chatId, messages });
      } catch (error) {
        if (!signal.aborted)
          dispatch({ type: 'historyFailed', chatId, error: errorMessage(error) });
      } finally {
        loading = false;
      }
    };
    const refresh = () => {
      if (!loading && document.visibilityState !== 'hidden') refreshHistory();
    };
    void load();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [api, state.activeId, historyVersion]);

  useEffect(() => {
    if (!session.current) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.current.signal]);
    const onNotification = async (body: unknown): Promise<Connection | void> => {
      const event = parseNotification(body);
      // Old receipts belong to the account's queue, not this live session.
      // Existing correspondence is loaded separately for the selected chat.
      if (event?.type === 'message' && event.message.timestamp < receiveFrom.current) return;
      if (event?.type === 'instance') {
        if (event.state === 'authorized') return;
        // Queued state events may predate the current authorized session.
        try {
          await api.connect(signal);
          signal.throwIfAborted();
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          if (!(error instanceof ApiError) || error.retryable) throw error;
          return { status: 'stopped', message: errorMessage(error) };
        }
        return;
      }
      if (event) dispatch({ type: 'event', event });
    };
    const run = () => pollNotifications(api, signal, onNotification, setConnection);
    let waitingTimer: ReturnType<typeof setTimeout> | undefined;
    // A notification queue has one consumer. Avoid stealing receipts between tabs.
    if ('locks' in navigator) {
      waitingTimer = setTimeout(() => {
        if (!signal.aborted)
          setConnection({
            status: 'reconnecting',
            message:
              'Получение сообщений ожидает освобождения очереди. Закройте другую вкладку с этим инстансом.',
          });
      }, 1000);
      void navigator.locks
        .request(`telegram-green-chat:${api.receiverKey}`, { signal }, async () => {
          clearTimeout(waitingTimer);
          if (signal.aborted) return;
          setConnection({ status: 'connected' });
          await run();
        })
        .catch(() => {
          clearTimeout(waitingTimer);
          if (!signal.aborted)
            setConnection({
              status: 'stopped',
              message: 'Не удалось запустить получение сообщений. Попробуйте возобновить его.',
            });
        });
    } else void run();
    return () => {
      clearTimeout(waitingTimer);
      controller.abort();
    };
  }, [api, pollVersion]);

  const createChat = useCallback(
    async (recipient: string) => {
      const controller = session.current;
      if (!controller || controller.signal.aborted) return;
      const contact = await api.resolveContact(recipient, controller.signal);
      controller.signal.throwIfAborted();
      dispatch({ type: 'open', contact });
      refreshHistory();
    },
    [api],
  );

  const send = useCallback(
    async (chatId: string, text: string, retry?: Message) => {
      const controller = session.current;
      if (!controller || controller.signal.aborted) return;
      const localId = retry?.localId ?? crypto.randomUUID();
      if (sending.current.has(localId)) return;
      const message: Message = {
        localId,
        chatId,
        text: validateMessage(text),
        timestamp: Date.now(),
        direction: 'outgoing',
        status: 'sending',
      };
      sending.current.add(localId);
      dispatch({ type: 'sending', message });
      try {
        const serverId = await api.sendMessage(chatId, message.text, controller.signal);
        controller.signal.throwIfAborted();
        dispatch({ type: 'sent', chatId, localId, serverId });
      } catch (error) {
        if (!controller.signal.aborted)
          dispatch({
            type: 'sendFailed',
            chatId,
            localId,
            uncertain: error instanceof ApiError && error.retryable,
            error: errorMessage(error),
          });
      } finally {
        sending.current.delete(localId);
      }
    },
    [api],
  );

  const selectChat = useCallback((chatId: string | null) => {
    dispatch({ type: 'select', chatId });
    if (chatId) refreshHistory();
  }, []);
  const retryHistory = useCallback((chatId: string) => {
    dispatch({ type: 'historyStarted', chatId });
    refreshHistory();
  }, []);
  return {
    state,
    connection,
    createChat,
    send,
    selectChat,
    restartPolling,
    retryHistory,
    stop: () => session.current?.abort(),
    storageAvailable,
  };
}
