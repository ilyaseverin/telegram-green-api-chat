import { useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { MAX_MESSAGE_LENGTH } from '../../../api/validation';
import { Icon } from '../../../shared/ui/Icon';

export function MessageComposer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const canSend = !disabled && draft.trim().length > 0 && draft.trim().length <= MAX_MESSAGE_LENGTH;

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [draft]);

  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!canSend) return;
    const text = draft;
    setDraft('');
    void onSend(text);
    input.current?.focus();
  }

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="composer-wrap">
      <form className="message-composer" onSubmit={submit}>
        <textarea
          ref={input}
          aria-label="Текст сообщения"
          placeholder="Сообщение"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKey}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={disabled}
        />
        <button
          className="send-button"
          type="submit"
          disabled={!canSend}
          aria-label="Отправить сообщение"
          title="Отправить сообщение"
        >
          <Icon name="plane" size={22} />
        </button>
      </form>
      <div className="composer-hint">
        <span>Enter — отправить · Shift + Enter — новая строка</span>
        <span>
          {draft.length > MAX_MESSAGE_LENGTH - 256
            ? `${draft.length} / ${MAX_MESSAGE_LENGTH}`
            : 'Только текстовые сообщения'}
        </span>
      </div>
    </div>
  );
}
