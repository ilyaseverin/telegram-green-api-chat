import type { Contact } from '../../../api/contracts';

export type MessageStatus = 'sending' | 'queued' | 'delivered' | 'read' | 'failed' | 'unknown';

export interface Message {
  localId: string;
  serverId?: string;
  chatId: string;
  text: string;
  timestamp: number;
  direction: 'incoming' | 'outgoing';
  status: MessageStatus;
  error?: string;
}

export interface Chat extends Contact {
  messages: Message[];
  unread: number;
  error?: string;
  history?: { status: 'loading' | 'loaded' } | { status: 'error'; message: string };
}

export type ChatEvent =
  | { type: 'message'; contact: Contact; message: Message }
  | { type: 'delivery'; chatId: string; serverId?: string; status: MessageStatus; error?: string }
  | { type: 'instance'; state: string };

export type Connection =
  { status: 'connecting' | 'connected' } | { status: 'reconnecting' | 'stopped'; message: string };
