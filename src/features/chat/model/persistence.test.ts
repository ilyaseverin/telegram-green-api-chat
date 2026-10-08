import { describe, expect, it, vi } from 'vitest';
import { clearChats, loadChats, saveChats } from './persistence';
import { initialChatState } from './reducer';
import type { ChatState } from './reducer';

const state: ChatState = {
  activeId: '42',
  chats: {
    '42': {
      id: '42',
      name: 'Анна',
      unread: 0,
      messages: [
        {
          chatId: '42',
          localId: 'pending',
          text: 'Привет',
          timestamp: 1,
          direction: 'outgoing',
          status: 'sending',
        },
      ],
    },
  },
  deliveries: {},
};

describe('chat persistence', () => {
  it('restores the active contact and marks interrupted sends as uncertain without resending them', () => {
    expect(saveChats('instance-a', state)).toBe(true);
    const restored = loadChats('instance-a');
    expect(restored.activeId).toBe('42');
    expect(restored.chats['42']?.name).toBe('Анна');
    expect(restored.chats['42']?.messages[0]).toMatchObject({
      localId: 'pending',
      status: 'unknown',
    });
    expect(state.chats['42']?.messages[0]?.status).toBe('sending');
    expect(loadChats('instance-b')).toEqual(initialChatState);
    expect(loadChats()).toEqual(initialChatState);
    clearChats('instance-a');
    expect(loadChats('instance-a')).toEqual(initialChatState);
  });

  it.each(['{invalid', '{"version":99}', '{"version":1,"activeId":"42","chats":null}'])(
    'ignores corrupt or incompatible cache: %s',
    (raw) => {
      sessionStorage.setItem('telegram-green-chat:chats:instance-a', raw);
      expect(loadChats('instance-a')).toEqual(initialChatState);
    },
  );

  it('bounds the cache while retaining the selected empty chat and newest messages', () => {
    const populated: ChatState = {
      ...state,
      chats: {
        ...state.chats,
        other: {
          id: 'other',
          name: 'Другой контакт',
          unread: 0,
          messages: Array.from({ length: 150 }, (_, i) => ({
            ...state.chats['42']!.messages[0]!,
            chatId: 'other',
            localId: String(i),
            timestamp: i + 2,
            status: 'read' as const,
          })),
        },
        '42': { id: '42', name: 'Анна', unread: 0, messages: [] },
      },
    };
    saveChats('instance-a', populated);
    const restored = loadChats('instance-a');
    expect(restored.activeId).toBe('42');
    expect(restored.chats['42']?.messages).toEqual([]);
    expect(restored.chats['other']?.messages).toHaveLength(100);
    expect(restored.chats['other']?.messages[0]?.localId).toBe('50');
  });

  it('does not crash the chat when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded');
    });
    expect(saveChats('instance-a', state)).toBe(false);
  });
});
