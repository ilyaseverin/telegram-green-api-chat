import { z } from 'zod';
import type { ChatApi, Contact, Credentials, HistoryMessage, Notification } from './contracts';
import { ApiError } from './errors';
import { normalizeRecipient, validateCredentials, validateMessage } from './validation';

const stateSchema = z.object({ stateInstance: z.string() });
const settingsSchema = z.object({
  typeInstance: z.string(),
  webhookUrl: z.string(),
  incomingWebhook: z.string(),
  outgoingMessageWebhook: z.string(),
});
const contactSchema = z.object({
  exist: z.boolean(),
  chatId: z.string(),
  username: z.string().optional(),
  phoneNumber: z.number().optional(),
});
const sentSchema = z.object({ idMessage: z.string().min(1) });
const profileSchema = z.object({
  chatId: z.string().min(1),
  name: z.string().optional(),
  contactName: z.string().optional(),
});
const notificationSchema = z
  .object({ receiptId: z.number().int().nonnegative(), body: z.unknown() })
  .nullable();
const deletedSchema = z.object({ result: z.boolean() });
const historySchema = z.array(
  z.object({
    idMessage: z.string().min(1),
    chatId: z.string().min(1),
    timestamp: z.number().finite().nonnegative(),
    type: z.enum(['incoming', 'outgoing']),
    typeMessage: z.string(),
    textMessage: z.string().optional(),
    statusMessage: z.string().optional(),
    description: z.string().optional(),
    isDeleted: z.boolean().optional(),
  }),
);

export class GreenApi implements ChatApi {
  private readonly credentials: Credentials;
  readonly receiverKey: string;

  constructor(
    credentials: Credentials,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.credentials = validateCredentials(credentials);
    this.receiverKey = `${this.credentials.apiUrl}:${this.credentials.idInstance}`;
  }

  async connect(signal: AbortSignal): Promise<void> {
    const { stateInstance } = await this.request('getStateInstance', stateSchema, { signal });
    if (stateInstance !== 'authorized')
      throw new ApiError(
        'Инстанс не готов к работе. Проверьте авторизацию и состояние Telegram в личном кабинете GREEN-API.',
      );
    const settings = await this.request('getSettings', settingsSchema, { signal });
    if (settings.typeInstance !== 'telegram')
      throw new ApiError(
        'Нужен инстанс Telegram. Выбранный инстанс относится к другому мессенджеру.',
      );
    if (settings.webhookUrl || settings.incomingWebhook !== 'yes')
      throw new ApiError(
        'В настройках инстанса очистите Webhook URL и включите уведомления о входящих сообщениях. После сохранения подождите минуту.',
      );
    if (settings.outgoingMessageWebhook !== 'yes')
      throw new ApiError(
        'В настройках инстанса включите уведомления о сообщениях, отправленных с телефона, чтобы переписка синхронизировалась.',
      );
  }

  async resolveContact(recipient: string, signal: AbortSignal): Promise<Contact> {
    const query = normalizeRecipient(recipient);
    const result = await this.request('checkAccount', contactSchema, {
      method: 'POST',
      body: query,
      signal,
    });
    if (!result.exist || !result.chatId)
      throw new ApiError(
        'Аккаунт не найден или номер скрыт. Попробуйте найти получателя по @username.',
      );
    const contact: Contact = {
      id: result.chatId,
      name: result.username ? `@${result.username.replace(/^@/, '')}` : recipient.trim(),
      username: result.username ? `@${result.username.replace(/^@/, '')}` : undefined,
      phone: result.phoneNumber
        ? String(result.phoneNumber)
        : 'phoneNumber' in query
          ? String(query.phoneNumber)
          : undefined,
    };
    try {
      const profile = await this.request('getContactInfo', profileSchema, {
        method: 'POST',
        body: { chatId: contact.id },
        signal,
      });
      if (profile.chatId === contact.id)
        contact.name = profile.contactName?.trim() || profile.name?.trim() || contact.name;
    } catch {
      // Profile information is optional; a resolved account can still receive messages.
      signal.throwIfAborted();
    }
    return contact;
  }

  async sendMessage(chatId: string, message: string, signal: AbortSignal): Promise<string> {
    const result = await this.request('sendMessage', sentSchema, {
      method: 'POST',
      body: { chatId, message: validateMessage(message) },
      signal,
    });
    return result.idMessage;
  }

  async getChatHistory(chatId: string, signal: AbortSignal): Promise<HistoryMessage[]> {
    const history = await this.request('getChatHistory', historySchema, {
      method: 'POST',
      body: { chatId, count: 100 },
      signal,
    });
    return history.flatMap((message): HistoryMessage[] => {
      if (
        message.chatId !== chatId ||
        message.isDeleted ||
        !['textMessage', 'extendedTextMessage'].includes(message.typeMessage) ||
        !message.textMessage
      )
        return [];
      const status =
        message.type === 'incoming'
          ? 'delivered'
          : message.statusMessage === 'read'
            ? 'read'
            : message.statusMessage === 'delivered'
              ? 'delivered'
              : message.statusMessage === 'failed'
                ? 'failed'
                : 'queued';
      return [
        {
          serverId: message.idMessage,
          chatId: message.chatId,
          text: message.textMessage,
          timestamp: message.timestamp * 1000,
          direction: message.type,
          status,
          error:
            status === 'failed'
              ? message.description || 'Telegram не смог отправить сообщение.'
              : undefined,
        },
      ];
    });
  }

  receiveNotification(signal: AbortSignal): Promise<Notification | null> {
    return this.request('receiveNotification', notificationSchema, {
      signal,
      suffix: '?receiveTimeout=5',
    });
  }

  async deleteNotification(receiptId: number, signal: AbortSignal): Promise<void> {
    // A false result means this receipt has already been acknowledged by another consumer.
    await this.request('deleteNotification', deletedSchema, {
      method: 'DELETE',
      suffix: `/${receiptId}`,
      signal,
    });
  }

  private async request<T>(
    methodName: string,
    schema: z.ZodType<T>,
    options: {
      signal: AbortSignal;
      method?: 'POST' | 'DELETE';
      body?: unknown;
      suffix?: string;
      timeoutMs?: number;
    },
  ): Promise<T> {
    const { apiUrl, idInstance, apiTokenInstance } = this.credentials;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), options.timeoutMs ?? 20_000);
    const signal = AbortSignal.any([options.signal, timeout.signal]);
    try {
      const response = await this.fetcher(
        `${apiUrl}/waInstance${idInstance}/${methodName}/${encodeURIComponent(apiTokenInstance)}${options.suffix ?? ''}`,
        {
          method: options.method ?? 'GET',
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
          signal,
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        },
      );
      if (!response.ok) {
        const status = response.status;
        const retryAfter = Number(response.headers.get('Retry-After'));
        if (status === 401 || status === 403)
          throw new ApiError('Доступ отклонён. Проверьте idInstance и apiTokenInstance.');
        // Some GREEN-API gateways end an empty long poll with HTTP 408.
        // No receipt was received; continue waiting without acknowledging anything.
        if (status === 408 && methodName === 'receiveNotification') return schema.parse(null);
        if (status === 408)
          throw new ApiError('Сервер прервал ожидание ответа. Восстанавливаем соединение.', true);
        if (status === 429 || status === 469)
          throw new ApiError(
            'Достигнут лимит запросов. Ожидаем возможности повторить запрос.',
            true,
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000,
          );
        if (status >= 500)
          throw new ApiError(
            'GREEN-API временно недоступен. Пробуем восстановить соединение.',
            true,
          );
        throw new ApiError(
          `GREEN-API отклонил ${methodName} (HTTP ${status}). Проверьте настройки инстанса и получателя.`,
        );
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new ApiError('GREEN-API вернул ответ в неожиданном формате.');
      }
      const failure = z
        .object({
          status: z.literal(false),
          data: z
            .object({ reason: z.string().optional(), retryAfter: z.number().optional() })
            .optional(),
        })
        .safeParse(raw);
      if (failure.success) {
        if (failure.data.data?.reason === 'rate_limit_exceeded')
          throw new ApiError(
            'Telegram временно ограничил поиск контактов. Повторите попытку позже.',
          );
        throw new ApiError(
          'Telegram не смог выполнить запрос. Проверьте состояние инстанса и повторите попытку позже.',
        );
      }
      const result = schema.safeParse(raw);
      if (!result.success) throw new ApiError('GREEN-API вернул ответ в неожиданном формате.');
      return result.data;
    } catch (error) {
      if (options.signal.aborted) throw options.signal.reason;
      if (error instanceof ApiError) throw error;
      if (timeout.signal.aborted)
        throw new ApiError('Сервер не ответил вовремя. Проверьте соединение.', true);
      throw new ApiError('Не удалось связаться с GREEN-API. Проверьте интернет и apiUrl.', true);
    } finally {
      clearTimeout(timer);
    }
  }
}
