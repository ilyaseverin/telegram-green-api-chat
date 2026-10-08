import { useEffect, useReducer, useState } from 'react';
import type { ChatApi, Credentials } from '../api/contracts';
import { GreenApi } from '../api/green-api';
import { errorMessage } from '../api/errors';
import { LoginPage } from '../features/auth/LoginPage';
import { clearCredentials, loadCredentials, saveCredentials } from '../features/auth/session';
import { clearChats } from '../features/chat/model/persistence';
import { ChatPage } from '../features/chat/ui/ChatPage';

interface Session {
  api: ChatApi;
  instanceId: string;
  storageAvailable: boolean;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [savedCredentials, setSavedCredentials] = useState(loadCredentials);
  const [restoreError, setRestoreError] = useState('');
  const [restoreAttempt, retryRestore] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    if (!savedCredentials) return;
    const controller = new AbortController();
    const api = new GreenApi(savedCredentials);
    void api
      .connect(controller.signal)
      .then(() => {
        controller.signal.throwIfAborted();
        setSession({
          api,
          instanceId: savedCredentials.idInstance,
          storageAvailable: true,
        });
        setSavedCredentials(null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setRestoreError(errorMessage(error));
      });
    return () => controller.abort();
  }, [savedCredentials, restoreAttempt]);

  function disconnect() {
    clearCredentials();
    if (session) clearChats(session.api.receiverKey);
    if (savedCredentials) clearChats(`${savedCredentials.apiUrl}:${savedCredentials.idInstance}`);
    setSession(null);
    setSavedCredentials(null);
    setRestoreError('');
  }

  function connected(api: ChatApi, credentials: Credentials) {
    const storageAvailable = saveCredentials(credentials);
    setSession({ api, instanceId: credentials.idInstance, storageAvailable });
  }

  if (savedCredentials)
    return (
      <main className="login-page">
        <section className="login-card" aria-labelledby="restore-title">
          <h1 id="restore-title">
            {restoreError ? 'Подключение прервано' : 'Восстанавливаем подключение'}
          </h1>
          <p className="login-description" role={restoreError ? 'alert' : 'status'}>
            {restoreError || 'Проверяем инстанс Telegram. Ваши чаты сохранены.'}
          </p>
          {restoreError && (
            <button
              className="primary-button login-submit"
              onClick={() => {
                setRestoreError('');
                retryRestore();
              }}
            >
              Повторить подключение
            </button>
          )}
          <button className="text-button restore-logout" onClick={disconnect}>
            Выйти из аккаунта
          </button>
        </section>
      </main>
    );

  return session ? (
    <ChatPage
      key={session.api.receiverKey}
      api={session.api}
      instanceId={session.instanceId}
      storageAvailable={session.storageAvailable}
      onDisconnect={disconnect}
    />
  ) : (
    <LoginPage onConnected={connected} />
  );
}
