import { z } from 'zod';
import { ApiError } from '../../../api/errors';
import type { ChatEvent, MessageStatus } from './types';

const baseSchema = z.object({
  typeWebhook: z.string(),
  instanceData: z.object({ typeInstance: z.string() }).optional(),
});
const messageSchema = z.object({
  idMessage: z.string().min(1),
  timestamp: z.number().nonnegative(),
  senderData: z.object({
    chatId: z.string().min(1),
    chatName: z.string().optional(),
    senderName: z.string().optional(),
    senderContactName: z.string().optional(),
    senderPhoneNumber: z.union([z.string(), z.number()]).optional(),
  }),
  messageData: z.object({
    typeMessage: z.string(),
    textMessageData: z.object({ textMessage: z.string() }).optional(),
    extendedTextMessageData: z.object({ text: z.string() }).optional(),
  }),
});
const deliverySchema = z.object({
  chatId: z.string().min(1),
  idMessage: z.string().optional(),
  status: z.string(),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new ApiError('Некорректное уведомление GREEN-API. Оно оставлено в очереди.');
  return result.data;
}

export function parseNotification(body: unknown): ChatEvent | null {
  const base = parse(baseSchema, body);
  if (base.instanceData && base.instanceData.typeInstance !== 'telegram') return null;
  if (base.typeWebhook === 'stateInstanceChanged') {
    const { stateInstance } = parse(z.object({ stateInstance: z.string() }), body);
    return { type: 'instance', state: stateInstance };
  }
  if (base.typeWebhook === 'outgoingMessageStatus') {
    const data = parse(deliverySchema, body);
    const statuses: Record<string, MessageStatus> = {
      sent: 'queued',
      delivered: 'delivered',
      read: 'read',
      failed: 'failed',
      noAccount: 'failed',
    };
    const status = statuses[data.status];
    if (!status) return null;
    return {
      type: 'delivery',
      chatId: data.chatId,
      serverId: data.idMessage,
      status,
      error:
        status === 'failed'
          ? 'Telegram не доставил сообщение. Проверьте получателя и попробуйте ещё раз.'
          : undefined,
    };
  }
  if (
    !['incomingMessageReceived', 'outgoingMessageReceived', 'outgoingAPIMessageReceived'].includes(
      base.typeWebhook,
    )
  )
    return null;
  const data = parse(messageSchema, body);
  let text: string | undefined;
  if (data.messageData.typeMessage === 'textMessage')
    text = data.messageData.textMessageData?.textMessage;
  else if (data.messageData.typeMessage === 'extendedTextMessage')
    text = data.messageData.extendedTextMessageData?.text;
  else return null;
  if (text === undefined)
    throw new ApiError('В текстовом уведомлении отсутствует текст. Оно оставлено в очереди.');
  const { senderData, idMessage } = data;
  const direction = base.typeWebhook === 'incomingMessageReceived' ? 'incoming' : 'outgoing';
  return {
    type: 'message',
    contact: {
      id: senderData.chatId,
      name:
        senderData.chatName ||
        senderData.senderContactName ||
        senderData.senderName ||
        senderData.chatId,
      phone:
        senderData.chatId.startsWith('-') || !senderData.senderPhoneNumber
          ? undefined
          : String(senderData.senderPhoneNumber),
    },
    message: {
      localId: `${senderData.chatId}:${idMessage}`,
      serverId: idMessage,
      chatId: senderData.chatId,
      text,
      timestamp: data.timestamp * 1000,
      direction,
      status: direction === 'incoming' ? 'delivered' : 'queued',
    },
  };
}
