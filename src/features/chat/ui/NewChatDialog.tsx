import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { errorMessage } from '../../../api/errors';
import { Icon } from '../../../shared/ui/Icon';

export function NewChatDialog({
  onCreate,
  onClose,
}: {
  onCreate: (recipient: string) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const recipientInput = useRef<HTMLInputElement>(null);
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    recipientInput.current?.focus();
    return () => element?.close();
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await onCreate(recipient);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="new-chat-dialog"
      aria-labelledby="new-chat-title"
      onCancel={onClose}
    >
      <div className="dialog-heading">
        <h2 id="new-chat-title">Новый чат</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть">
          <Icon name="close" />
        </button>
      </div>
      <p className="muted">Найдите человека в Telegram и начните разговор.</p>
      <form onSubmit={(event) => void create(event)} aria-busy={busy}>
        <label htmlFor="recipient">Номер телефона или @username</label>
        <input
          ref={recipientInput}
          id="recipient"
          type="text"
          autoComplete="off"
          placeholder="+7 999 123-45-67"
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          required
          disabled={busy}
          aria-describedby="recipient-help"
        />
        <p id="recipient-help" className="field-help">
          Номер с кодом страны. Если он скрыт, используйте @username.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? 'Ищем получателя…' : 'Создать чат'}
        </button>
      </form>
    </dialog>
  );
}
