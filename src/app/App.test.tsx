import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { MessageComposer } from '../features/chat/ui/MessageComposer';
import { loadCredentials, saveCredentials } from '../features/auth/session';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

describe('Telegram chat workflow', () => {
  it('connects, loads a name, exchanges text, restores the session and chat after reload and clears them on logout', async () => {
    const user = userEvent.setup();
    let reply: ((response: Response) => void) | undefined;
    let receivingSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const path = String(url);
      if (path.includes('/getStateInstance/')) return json({ stateInstance: 'authorized' });
      if (path.includes('/getSettings/'))
        return json({
          typeInstance: 'telegram',
          webhookUrl: '',
          incomingWebhook: 'yes',
          outgoingMessageWebhook: 'yes',
        });
      if (path.includes('/checkAccount/'))
        return json({ exist: true, chatId: '42', username: 'anna_test', phoneNumber: 79991234567 });
      if (path.includes('/getContactInfo/')) return json({ chatId: '42', name: 'Анна' });
      if (path.includes('/getChatHistory/'))
        return json([
          {
            idMessage: 'old-1',
            chatId: '42',
            timestamp: 1_700_000_000,
            type: 'outgoing',
            typeMessage: 'textMessage',
            textMessage: 'Старая переписка из Telegram',
            statusMessage: 'read',
          },
        ]);
      if (path.includes('/sendMessage/')) return json({ idMessage: 'sent-1' });
      if (path.includes('/deleteNotification/')) return json({ result: true });
      if (path.includes('/receiveNotification/')) {
        receivingSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve, reject) => {
          reply = resolve;
          receivingSignal?.addEventListener('abort', () => reject(receivingSignal?.reason), {
            once: true,
          });
        });
      }
      throw new Error('Unexpected endpoint');
    });
    vi.stubGlobal('fetch', fetcher);
    const mounted = render(<App />);
    await user.type(screen.getByLabelText('idInstance'), '4100123456');
    await user.type(screen.getByLabelText('apiTokenInstance'), 'test-token-12345678');
    await user.click(screen.getByRole('button', { name: 'Подключить Telegram' }));
    await screen.findByRole('heading', { name: 'Чаты' });
    await user.click(
      within(screen.getByLabelText('Список чатов')).getByRole('button', {
        name: 'Новый чат',
      }),
    );
    await user.type(screen.getByLabelText('Номер телефона или @username'), '+7 (999) 123-45-67');
    await user.click(screen.getByRole('button', { name: 'Создать чат' }));
    await screen.findByRole('heading', { name: 'Анна' });
    await screen.findByText('Старая переписка из Telegram', { selector: '.message-bubble p' });
    await user.type(screen.getByLabelText('Текст сообщения'), 'Привет!');
    await user.click(screen.getByRole('button', { name: 'Отправить сообщение' }));
    await screen.findByText('Привет!');
    const sentRequest = fetcher.mock.calls.find(([url]) => String(url).includes('/sendMessage/'));
    expect(JSON.parse(String(sentRequest?.[1]?.body))).toEqual({
      chatId: '42',
      message: 'Привет!',
    });
    await act(async () =>
      reply?.(
        json({
          receiptId: 9,
          body: {
            typeWebhook: 'incomingMessageReceived',
            instanceData: { typeInstance: 'telegram' },
            timestamp: Math.floor(Date.now() / 1000),
            idMessage: 'reply-1',
            senderData: { chatId: '42', chatName: 'Анна', senderPhoneNumber: 79991234567 },
            messageData: {
              typeMessage: 'textMessage',
              textMessageData: { textMessage: 'Ответ из Telegram' },
            },
          },
        }),
      ),
    );
    await screen.findByText('Ответ из Telegram', { selector: '.message-bubble p' });
    expect(screen.getAllByRole('button', { name: /Анна/ })).toHaveLength(1);
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/deleteNotification/') && init?.method === 'DELETE',
        ),
      ).toBe(true),
    );
    const currentSignal = receivingSignal;
    mounted.unmount();
    expect(currentSignal?.aborted).toBe(true);
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByRole('heading', { name: 'Анна' });
    expect(screen.getByText('Привет!', { selector: '.message-bubble p' })).toBeInTheDocument();
    expect(
      screen.getByText('Ответ из Telegram', { selector: '.message-bubble p' }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('Старая переписка из Telegram', { selector: '.message-bubble p' }),
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes('/checkAccount/')),
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes('/sendMessage/')),
    ).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Отключиться' }));
    expect(screen.getByLabelText('apiTokenInstance')).toHaveValue('');
    expect(Object.keys(sessionStorage)).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it('keeps a saved session after a failed restore so it can be retried or explicitly removed', async () => {
    const user = userEvent.setup();
    saveCredentials({
      idInstance: '4100123456',
      apiTokenInstance: 'test-token-12345678',
      apiUrl: '',
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Доступ отклонён');
    expect(loadCredentials()?.idInstance).toBe('4100123456');
    await user.click(screen.getByRole('button', { name: 'Повторить подключение' }));
    await screen.findByRole('alert');
    expect(fetcher).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Выйти из аккаунта' }));
    expect(loadCredentials()).toBeNull();
    expect(screen.getByLabelText('apiTokenInstance')).toHaveValue('');
  });

  it('shows authentication errors without opening a chat', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    render(<App />);
    await user.type(screen.getByLabelText('idInstance'), '4100123456');
    await user.type(screen.getByLabelText('apiTokenInstance'), 'test-token-12345678');
    await user.click(screen.getByRole('button', { name: 'Подключить Telegram' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Доступ отклонён');
    expect(screen.queryByLabelText('Список чатов')).not.toBeInTheDocument();
  });

  it('does not send empty messages, Shift+Enter or IME composition', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<MessageComposer disabled={false} onSend={onSend} />);
    const input = screen.getByLabelText('Текст сообщения');
    expect(screen.getByRole('button', { name: 'Отправить сообщение' })).toBeDisabled();
    await user.type(input, 'Hello');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onSend).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue('');
  });
});
