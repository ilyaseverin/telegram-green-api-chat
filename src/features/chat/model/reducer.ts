import type { Contact, HistoryMessage } from '../../../api/contracts';
import type { Chat, ChatEvent, Message, MessageStatus } from './types';

type Delivery = { status: MessageStatus; error?: string };
export interface ChatState {
  chats: Record<string, Chat>;
  activeId: string | null;
  deliveries: Record<string, Delivery>;
}

export const initialChatState: ChatState = { chats: {}, activeId: null, deliveries: {} };

export type ChatAction =
  | { type: 'open'; contact: Contact }
  | { type: 'select'; chatId: string | null }
  | { type: 'historyStarted'; chatId: string }
  | { type: 'historyLoaded'; chatId: string; messages: HistoryMessage[] }
  | { type: 'historyFailed'; chatId: string; error: string }
  | { type: 'event'; event: ChatEvent }
  | { type: 'sending'; message: Message }
  | { type: 'sent'; chatId: string; localId: string; serverId: string }
  | { type: 'sendFailed'; chatId: string; localId: string; uncertain: boolean; error: string };

const priority: Record<MessageStatus, number> = {
  sending: 0,
  unknown: 0,
  queued: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};
const deliveryKey = (chatId: string, serverId: string) => `${chatId}:${serverId}`;
const sortMessages = (messages: Message[]) => messages.sort((a, b) => a.timestamp - b.timestamp);

function applyDelivery(message: Message, delivery?: Delivery): Message {
  return delivery && priority[delivery.status] >= priority[message.status]
    ? { ...message, status: delivery.status, error: delivery.error }
    : message;
}

function updateChat(state: ChatState, chatId: string, change: (chat: Chat) => Chat): ChatState {
  const chat = state.chats[chatId];
  return chat ? { ...state, chats: { ...state.chats, [chatId]: change(chat) } } : state;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'open': {
      const existing = state.chats[action.contact.id];
      return {
        ...state,
        activeId: action.contact.id,
        chats: {
          ...state.chats,
          [action.contact.id]: existing
            ? { ...existing, ...action.contact, unread: 0, history: { status: 'loading' } }
            : { ...action.contact, messages: [], unread: 0, history: { status: 'loading' } },
        },
      };
    }
    case 'select':
      return action.chatId
        ? {
            ...updateChat(state, action.chatId, (chat) => ({
              ...chat,
              unread: 0,
              history: chat.history?.status === 'loaded' ? chat.history : { status: 'loading' },
            })),
            activeId: action.chatId,
          }
        : { ...state, activeId: null };
    case 'historyStarted':
      return updateChat(state, action.chatId, (chat) => ({
        ...chat,
        history: { status: 'loading' },
      }));
    case 'historyFailed':
      return updateChat(state, action.chatId, (chat) => ({
        ...chat,
        history: { status: 'error', message: action.error },
      }));
    case 'historyLoaded':
      return updateChat(state, action.chatId, (chat) => {
        const messages = [...chat.messages];
        const positions = new Map<string, number>();
        messages.forEach((message, index) => {
          if (message.serverId) positions.set(message.serverId, index);
        });
        for (const item of action.messages) {
          if (item.chatId !== chat.id) continue;
          const index = positions.get(item.serverId);
          const existing = index === undefined ? undefined : messages[index];
          const imported = applyDelivery(
            {
              ...item,
              localId: existing?.localId ?? `history:${item.chatId}:${item.serverId}`,
            },
            state.deliveries[deliveryKey(item.chatId, item.serverId)],
          );
          if (existing && index !== undefined) {
            messages[index] = applyDelivery(imported, {
              status: existing.status,
              error: existing.error,
            });
          } else {
            positions.set(item.serverId, messages.length);
            messages.push(imported);
          }
        }
        return { ...chat, messages: sortMessages(messages), history: { status: 'loaded' } };
      });
    case 'sending':
      return updateChat(state, action.message.chatId, (chat) => ({
        ...chat,
        error: undefined,
        messages: sortMessages([
          ...chat.messages.filter((message) => message.localId !== action.message.localId),
          action.message,
        ]),
      }));
    case 'sent':
      return updateChat(state, action.chatId, (chat) => {
        const local = chat.messages.find((message) => message.localId === action.localId);
        if (!local) return chat;
        const echoed = chat.messages.find((message) => message.serverId === action.serverId);
        const confirmed = applyDelivery(
          applyDelivery(
            {
              ...local,
              serverId: action.serverId,
              status: local.status === 'sending' ? 'queued' : local.status,
            },
            echoed,
          ),
          state.deliveries[deliveryKey(action.chatId, action.serverId)],
        );
        return {
          ...chat,
          messages: sortMessages([
            ...chat.messages.filter(
              (message) =>
                message.localId !== action.localId && message.serverId !== action.serverId,
            ),
            confirmed,
          ]),
        };
      });
    case 'sendFailed':
      return updateChat(state, action.chatId, (chat) => ({
        ...chat,
        messages: chat.messages.map((message) =>
          message.localId === action.localId && message.status === 'sending'
            ? { ...message, status: action.uncertain ? 'unknown' : 'failed', error: action.error }
            : message,
        ),
      }));
    case 'event': {
      const event = action.event;
      if (event.type === 'instance') return state;
      if (event.type === 'delivery') {
        if (!state.chats[event.chatId]) return state;
        // Without a message ID there is no reliable way to identify the failed send.
        if (!event.serverId) {
          return event.status === 'failed'
            ? updateChat(state, event.chatId, (chat) => ({ ...chat, error: event.error }))
            : state;
        }
        let next = state;
        if (event.serverId) {
          const key = deliveryKey(event.chatId, event.serverId);
          const previous = state.deliveries[key];
          const delivery =
            !previous || priority[event.status] >= priority[previous.status]
              ? { status: event.status, error: event.error }
              : previous;
          next = { ...state, deliveries: { ...state.deliveries, [key]: delivery } };
        }
        return updateChat(next, event.chatId, (chat) => {
          return {
            ...chat,
            messages: chat.messages.map((message) =>
              message.direction === 'outgoing' && message.serverId === event.serverId
                ? applyDelivery(message, event)
                : message,
            ),
          };
        });
      }
      const existing = state.chats[event.contact.id];
      if (!existing) return state;
      const chat = existing;
      if (chat.messages.some((message) => message.serverId === event.message.serverId))
        return state;
      const message = applyDelivery(
        event.message,
        state.deliveries[deliveryKey(event.contact.id, event.message.serverId ?? '')],
      );
      return {
        ...state,
        chats: {
          ...state.chats,
          [chat.id]: {
            ...chat,
            name: event.contact.name,
            phone: event.contact.phone ?? chat.phone,
            messages: sortMessages([...chat.messages, message]),
            unread:
              chat.unread +
              (message.direction === 'incoming' && state.activeId !== chat.id ? 1 : 0),
          },
        },
      };
    }
  }
}
