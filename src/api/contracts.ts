export interface Credentials {
  idInstance: string;
  apiTokenInstance: string;
  apiUrl: string;
}

export interface Contact {
  id: string;
  name: string;
  username?: string;
  phone?: string;
}

export interface Notification {
  receiptId: number;
  body: unknown;
}

export interface HistoryMessage {
  serverId: string;
  chatId: string;
  text: string;
  timestamp: number;
  direction: 'incoming' | 'outgoing';
  status: 'queued' | 'delivered' | 'read' | 'failed';
  error?: string;
}

export interface ChatApi {
  readonly receiverKey: string;
  connect(signal: AbortSignal): Promise<void>;
  resolveContact(recipient: string, signal: AbortSignal): Promise<Contact>;
  getChatHistory(chatId: string, signal: AbortSignal): Promise<HistoryMessage[]>;
  sendMessage(chatId: string, message: string, signal: AbortSignal): Promise<string>;
  receiveNotification(signal: AbortSignal): Promise<Notification | null>;
  deleteNotification(receiptId: number, signal: AbortSignal): Promise<void>;
}
