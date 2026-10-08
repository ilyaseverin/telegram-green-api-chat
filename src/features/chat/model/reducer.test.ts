import { describe, expect, it } from 'vitest';
import { chatReducer, initialChatState } from './reducer';
import { parseNotification } from './notifications';
import type { ChatEvent, Message } from './types';

const message = (chatId = '1'): Message => ({
  localId: 'local',
  serverId: 'server',
  chatId,
  text: 'Hello',
  timestamp: 1000,
  direction: 'outgoing',
  status: 'queued',
});
const event = (chatId = '1'): ChatEvent => ({
  type: 'message',
  contact: { id: chatId, name: 'Anna' },
  message: { ...message(chatId), direction: 'incoming' },
});
function withChats(...ids: string[]) {
  let state = initialChatState;
  for (const id of ids) state = chatReducer(state, { type: 'open', contact: { id, name: 'Anna' } });
  return chatReducer(state, { type: 'select', chatId: null });
}

describe('chatReducer', () => {
  it('merges history with live messages by server ID, keeps optimistic sends and read statuses, and does not create unread messages', () => {
    let state = chatReducer(initialChatState, { type: 'open', contact: { id: '1', name: 'Anna' } });
    state = chatReducer(state, {
      type: 'event',
      event: {
        type: 'message',
        contact: { id: '1', name: 'Anna' },
        message: { ...message(), status: 'read' },
      },
    });
    state = chatReducer(state, {
      type: 'sending',
      message: {
        ...message(),
        serverId: undefined,
        localId: 'pending',
        text: 'В процессе',
        status: 'sending',
      },
    });
    state = chatReducer(state, {
      type: 'historyLoaded',
      chatId: '1',
      messages: [
        { ...message(), serverId: 'server', status: 'delivered' },
        {
          ...message(),
          serverId: 'old',
          timestamp: 500,
          direction: 'incoming',
          text: 'Раньше',
          status: 'delivered',
        },
        {
          ...message(),
          serverId: 'old',
          timestamp: 500,
          direction: 'incoming',
          text: 'Раньше',
          status: 'delivered',
        },
        { ...message('other'), serverId: 'foreign', status: 'queued' },
      ],
    });
    expect(state.chats['1']?.messages).toHaveLength(3);
    expect(state.chats['1']?.messages[0]?.text).toBe('Раньше');
    expect(state.chats['1']?.messages.find((m) => m.serverId === 'server')?.status).toBe('read');
    expect(state.chats['1']?.messages.find((m) => m.localId === 'pending')?.status).toBe('sending');
    expect(state.chats['1']?.unread).toBe(0);
    expect(state.chats['1']?.history?.status).toBe('loaded');
  });
  it('shows failures without a message ID at chat level instead of guessing a send', () => {
    let state = chatReducer(withChats('1'), {
      type: 'event',
      event: { type: 'message', contact: { id: '1', name: 'Anna' }, message: message() },
    });
    state = chatReducer(state, {
      type: 'event',
      event: { type: 'delivery', chatId: '1', status: 'failed', error: 'Recipient unavailable' },
    });
    expect(state.chats['1']?.error).toBe('Recipient unavailable');
    expect(state.chats['1']?.messages[0]?.status).toBe('queued');
  });
  it('deduplicates redelivered notifications without increasing unread count', () => {
    const state = chatReducer(withChats('1'), { type: 'event', event: event() });
    const duplicate = chatReducer(state, { type: 'event', event: event() });
    expect(duplicate.chats['1']?.messages).toHaveLength(1);
    expect(duplicate.chats['1']?.unread).toBe(1);
  });

  it('keeps messages with identical server IDs in different chats', () => {
    const state = chatReducer(chatReducer(withChats('1', '2'), { type: 'event', event: event() }), {
      type: 'event',
      event: event('2'),
    });
    expect(Object.keys(state.chats)).toHaveLength(2);
  });

  it('handles delivery and an API echo arriving before the POST response', () => {
    let state = chatReducer(initialChatState, { type: 'open', contact: { id: '1', name: 'Anna' } });
    state = chatReducer(state, {
      type: 'sending',
      message: { ...message(), serverId: undefined, status: 'sending' },
    });
    state = chatReducer(state, {
      type: 'event',
      event: { type: 'delivery', chatId: '1', serverId: 'server', status: 'read' },
    });
    state = chatReducer(state, {
      type: 'event',
      event: {
        type: 'message',
        contact: { id: '1', name: 'Anna' },
        message: { ...message(), localId: 'echo' },
      },
    });
    state = chatReducer(state, { type: 'sent', chatId: '1', localId: 'local', serverId: 'server' });
    expect(state.chats['1']?.messages).toHaveLength(1);
    expect(state.chats['1']?.messages[0]).toMatchObject({ localId: 'local', status: 'read' });
  });

  it('does not regress a read message to delivered', () => {
    let state = chatReducer(withChats('1'), {
      type: 'event',
      event: { type: 'message', contact: { id: '1', name: 'Anna' }, message: message() },
    });
    state = chatReducer(state, {
      type: 'event',
      event: { type: 'delivery', chatId: '1', serverId: 'server', status: 'read' },
    });
    state = chatReducer(state, {
      type: 'event',
      event: { type: 'delivery', chatId: '1', serverId: 'server', status: 'delivered' },
    });
    expect(state.chats['1']?.messages[0]?.status).toBe('read');
  });

  it('marks uncertain sends separately and clears unread when selecting the chat', () => {
    let state = chatReducer(withChats('1'), { type: 'event', event: event() });
    state = chatReducer(state, {
      type: 'sending',
      message: { ...message(), localId: 'pending', serverId: undefined, status: 'sending' },
    });
    state = chatReducer(state, {
      type: 'sendFailed',
      chatId: '1',
      localId: 'pending',
      uncertain: true,
      error: 'Timeout',
    });
    state = chatReducer(state, { type: 'select', chatId: '1' });
    expect(state.chats['1']?.messages.at(-1)?.status).toBe('unknown');
    expect(state.chats['1']?.unread).toBe(0);
  });
  it('ignores other account chats and their delivery statuses', () => {
    const state = withChats('1');
    expect(chatReducer(state, { type: 'event', event: event('other') })).toBe(state);
    expect(
      chatReducer(state, {
        type: 'event',
        event: { type: 'delivery', chatId: 'other', serverId: 'server', status: 'read' },
      }),
    ).toBe(state);
  });
});

describe('notification parsing', () => {
  const incoming = {
    typeWebhook: 'incomingMessageReceived',
    instanceData: { typeInstance: 'telegram' },
    idMessage: '42',
    timestamp: 123,
    senderData: { chatId: '-10042', chatName: 'Group', senderPhoneNumber: 79991234567 },
    messageData: {
      typeMessage: 'extendedTextMessage',
      extendedTextMessageData: { text: 'https://example.com' },
    },
  };
  it('supports URL text and uses group chatId instead of sender phone', () => {
    expect(parseNotification(incoming)).toMatchObject({
      type: 'message',
      contact: { id: '-10042', name: 'Group', phone: undefined },
      message: { text: 'https://example.com', timestamp: 123000 },
    });
  });
  it.each(['incomingMessageReceived', 'outgoingMessageReceived', 'outgoingAPIMessageReceived'])(
    'handles messages from Telegram clients and API: %s',
    (typeWebhook) => {
      expect(parseNotification({ ...incoming, typeWebhook })).toMatchObject({
        type: 'message',
        message: { direction: typeWebhook === 'incomingMessageReceived' ? 'incoming' : 'outgoing' },
      });
    },
  );
  it('ignores unsupported media without blocking the queue', () =>
    expect(
      parseNotification({ ...incoming, messageData: { typeMessage: 'imageMessage' } }),
    ).toBeNull());
  it('does not silently discard malformed text', () =>
    expect(() =>
      parseNotification({ ...incoming, messageData: { typeMessage: 'textMessage' } }),
    ).toThrow());
  it('handles failure status without idMessage', () =>
    expect(
      parseNotification({ typeWebhook: 'outgoingMessageStatus', chatId: '1', status: 'noAccount' }),
    ).toMatchObject({ type: 'delivery', status: 'failed' }));
});
