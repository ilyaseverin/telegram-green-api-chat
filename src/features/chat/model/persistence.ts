import { z } from 'zod';
import {
  readSessionValue,
  removeSessionValue,
  writeSessionValue,
} from '../../../shared/lib/session-storage';
import { initialChatState } from './reducer';
import type { ChatState } from './reducer';

const MAX_CHATS = 30;
const MAX_MESSAGES = 100;
const messageSchema = z.object({
  localId: z.string().min(1).max(256),
  serverId: z.string().max(256).optional(),
  chatId: z.string().min(1).max(256),
  text: z.string().max(4096),
  timestamp: z.number().finite().nonnegative(),
  direction: z.enum(['incoming', 'outgoing']),
  status: z.enum(['sending', 'queued', 'delivered', 'read', 'failed', 'unknown']),
  error: z.string().max(2048).optional(),
});
const snapshotSchema = z.object({
  version: z.literal(1),
  activeId: z.string().nullable(),
  chats: z
    .array(
      z.object({
        id: z.string().min(1).max(256),
        name: z.string().max(256),
        username: z.string().max(64).optional(),
        phone: z.string().max(32).optional(),
        messages: z.array(messageSchema).max(MAX_MESSAGES),
        unread: z.number().int().nonnegative(),
        error: z.string().max(2048).optional(),
      }),
    )
    .max(MAX_CHATS),
});
const storageKey = (receiverKey: string) => `telegram-green-chat:chats:${receiverKey}`;

export function loadChats(receiverKey?: string): ChatState {
  if (!receiverKey) return initialChatState;
  try {
    const raw = readSessionValue(storageKey(receiverKey));
    if (!raw || raw.length > 1_000_000) return initialChatState;
    const snapshot = snapshotSchema.parse(JSON.parse(raw));
    const chats = Object.fromEntries(
      snapshot.chats.map((chat) => [
        chat.id,
        {
          ...chat,
          messages: chat.messages
            .filter((message) => message.chatId === chat.id)
            .map((message) =>
              message.status === 'sending'
                ? {
                    ...message,
                    status: 'unknown' as const,
                    error:
                      'Страница была перезагружена во время отправки. Проверьте Telegram перед повтором.',
                  }
                : message,
            ),
        },
      ]),
    );
    return {
      chats,
      activeId:
        snapshot.activeId && Object.hasOwn(chats, snapshot.activeId) ? snapshot.activeId : null,
      deliveries: {},
    };
  } catch {
    return initialChatState;
  }
}

export function saveChats(receiverKey: string, state: ChatState): boolean {
  const chats = Object.values(state.chats).sort(
    (a, b) => (b.messages.at(-1)?.timestamp ?? 0) - (a.messages.at(-1)?.timestamp ?? 0),
  );
  // Keep the active chat even if it has no messages yet.
  const active = state.activeId ? state.chats[state.activeId] : undefined;
  const selected = (
    active ? [active, ...chats.filter((chat) => chat.id !== active.id)] : chats
  ).slice(0, MAX_CHATS);
  const messages = selected
    .flatMap((chat) => chat.messages)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_MESSAGES);
  const retained = new Set(messages);
  return writeSessionValue(
    storageKey(receiverKey),
    JSON.stringify({
      version: 1,
      activeId: state.activeId,
      chats: selected.map((chat) => ({
        id: chat.id,
        name: chat.name,
        username: chat.username,
        phone: chat.phone,
        unread: chat.unread,
        error: chat.error,
        messages: chat.messages.filter((message) => retained.has(message)),
      })),
    }),
  );
}

export function clearChats(receiverKey: string): void {
  removeSessionValue(storageKey(receiverKey));
}
