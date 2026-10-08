import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ChatApi, Credentials } from '../../api/contracts';
import { validateCredentials } from '../../api/validation';
import { GreenApi } from '../../api/green-api';
import { errorMessage } from '../../api/errors';
import { Icon } from '../../shared/ui/Icon';
import './login.css';

interface Props {
  onConnected: (api: ChatApi, credentials: Credentials) => void;
}

export function LoginPage({ onConnected }: Props) {
  const [idInstance, setIdInstance] = useState('');
  const [token, setToken] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const credentials = validateCredentials({ idInstance, apiTokenInstance: token, apiUrl });
      const api = new GreenApi(credentials);
      await api.connect(controller.signal);
      controller.signal.throwIfAborted();
      onConnected(api, credentials);
    } catch (failure) {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      request.current = null;
    }
  }

  return (
    <main className="login-page">
      <div className="login-brand">
        <span className="brand-mark">
          <Icon name="plane" size={24} />
        </span>
        <span>
          Telegram <span className="brand-divider">/</span> GREEN-API
        </span>
      </div>
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-icon">
          <Icon name="plane" size={40} />
        </div>
        <h1 id="login-title">Вход в Telegram</h1>
        <p className="login-description">
          Подключите инстанс GREEN-API,
          <br />
          чтобы отправлять и получать сообщения.
        </p>
        <form onSubmit={(event) => void connect(event)} aria-busy={busy}>
          <fieldset disabled={busy}>
            <label htmlFor="instance">idInstance</label>
            <input
              id="instance"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Например, 4100123456"
              value={idInstance}
              onChange={(event) => setIdInstance(event.target.value)}
              required
              aria-describedby="credentials-help"
            />
            <label htmlFor="token">apiTokenInstance</label>
            <div className="password-field">
              <input
                id="token"
                type={showToken ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                placeholder="Токен вашего инстанса"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                required
              />
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowToken((value) => !value)}
                aria-label={showToken ? 'Скрыть токен' : 'Показать токен'}
                aria-pressed={showToken}
              >
                <Icon name="eye" size={20} />
              </button>
            </div>
            <p className="field-help" id="credentials-help">
              Данные инстанса Telegram из{' '}
              <a href="https://console.green-api.com/" target="_blank" rel="noreferrer">
                личного кабинета GREEN-API
              </a>
              .
            </p>
            <details className="advanced-settings">
              <summary>Указать адрес API</summary>
              <label htmlFor="api-url">apiUrl</label>
              <input
                id="api-url"
                type="url"
                autoComplete="off"
                placeholder="https://4100.api.green-api.com"
                value={apiUrl}
                onChange={(event) => setApiUrl(event.target.value)}
              />
              <p className="field-help">
                По умолчанию адрес определяется по первым четырём цифрам idInstance. Можно указать
                apiUrl из кабинета.
              </p>
            </details>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button login-submit" type="submit">
              {busy ? 'Подключаемся…' : 'Подключить Telegram'}
              {!busy && <Icon name="plane" size={18} />}
            </button>
          </fieldset>
        </form>
        <div className="privacy-note">
          <Icon name="lock" size={15} />
          <span>Токен хранится только до закрытия вкладки</span>
        </div>
      </section>
      <p className="login-footer">Простой чат для текстовых сообщений</p>
    </main>
  );
}
