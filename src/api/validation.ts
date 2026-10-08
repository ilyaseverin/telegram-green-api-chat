import { ApiError } from './errors';
import type { Credentials } from './contracts';

export const MAX_MESSAGE_LENGTH = 4096;

export function defaultApiUrl(idInstance: string): string {
  return /^\d{4,20}$/.test(idInstance) ? `https://${idInstance.slice(0, 4)}.api.green-api.com` : '';
}

export function validateCredentials(values: Credentials): Credentials {
  const idInstance = values.idInstance.trim();
  const apiTokenInstance = values.apiTokenInstance.trim();
  if (!/^\d{4,20}$/.test(idInstance))
    throw new ApiError('idInstance должен содержать от 4 до 20 цифр.');
  if (!/^[a-zA-Z0-9_-]{8,256}$/.test(apiTokenInstance))
    throw new ApiError('Проверьте apiTokenInstance: скопируйте токен целиком из GREEN-API.');

  let url: URL;
  try {
    url = new URL(values.apiUrl.trim() || defaultApiUrl(idInstance));
  } catch {
    throw new ApiError('Укажите корректный apiUrl из личного кабинета GREEN-API.');
  }
  if (
    url.protocol !== 'https:' ||
    !/^(?:[a-z0-9-]+\.)?api\.green-api\.com$/.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new ApiError('apiUrl должен быть HTTPS-адресом API GREEN-API без пути и параметров.');
  }
  return { idInstance, apiTokenInstance, apiUrl: url.origin };
}

export function normalizeRecipient(value: string): { phoneNumber: number } | { username: string } {
  const recipient = value.trim();
  if (/^@[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(recipient)) return { username: recipient };
  if (!/^\+?[\d\s()-]+$/.test(recipient))
    throw new ApiError('Введите номер с кодом страны или @username.');
  const phone = recipient.replace(/[^\d]/g, '');
  if (!/^[1-9]\d{6,14}$/.test(phone))
    throw new ApiError('Номер должен содержать от 7 до 15 цифр, включая код страны.');
  return { phoneNumber: Number(phone) };
}

export function validateMessage(message: string): string {
  const text = message.trim();
  if (!text) throw new ApiError('Введите текст сообщения.');
  if (text.length > MAX_MESSAGE_LENGTH)
    throw new ApiError(`Сообщение не должно превышать ${MAX_MESSAGE_LENGTH} символов.`);
  return text;
}
