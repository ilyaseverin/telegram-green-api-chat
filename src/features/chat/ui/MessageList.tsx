import { Fragment, useEffect, useRef, useState } from 'react';
import { Icon } from '../../../shared/ui/Icon';
import type { Message, MessageStatus } from '../model/types';

const timeFormat = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });
const labels: Record<MessageStatus, string> = {
  sending: 'Отправляется',
  queued: 'В очереди на отправку',
  delivered: 'Доставлено',
  read: 'Прочитано',
  failed: 'Не отправлено',
  unknown: 'Отправка не подтверждена',
};
function dateKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function MessageList({
  messages,
  showEmptyState = true,
  onRetry,
}: {
  messages: Message[];
  showEmptyState?: boolean;
  onRetry: (message: Message) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const [today, setToday] = useState(() => dateKey(Date.now()));
  useEffect(() => {
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 100);
    const timer = setTimeout(() => setToday(dateKey(Date.now())), midnight.getTime() - Date.now());
    return () => clearTimeout(timer);
  }, [today]);
  const last = messages.at(-1);
  useEffect(() => {
    if (nearBottom.current || last?.direction === 'outgoing') {
      const element = scroll.current;
      if (element) element.scrollTop = element.scrollHeight;
    }
  }, [last?.localId, last?.direction]);

  return (
    <div className="message-area">
      <div
        className="message-scroll"
        ref={scroll}
        role="log"
        aria-label="Сообщения"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={(event) => {
          const element = event.currentTarget;
          nearBottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 100;
          setShowLatest(!nearBottom.current);
        }}
      >
        <div className="message-content">
          {messages.length === 0 && showEmptyState && (
            <div className="conversation-start">
              <Icon name="chat" size={30} />
              <h2>Начните разговор</h2>
              <p>В переписке пока нет текстовых сообщений.</p>
            </div>
          )}
          {messages.map((message, index) => (
            <Fragment key={message.localId}>
              {(index === 0 ||
                dateKey(message.timestamp) !== dateKey(messages[index - 1]?.timestamp ?? 0)) && (
                <div className="date-separator">
                  <span>
                    {dateKey(message.timestamp) === today
                      ? 'Сегодня'
                      : dateFormat.format(message.timestamp)}
                  </span>
                </div>
              )}
              <div className={`message-row ${message.direction}`}>
                <div className={`message-bubble ${message.status === 'read' ? 'is-read' : ''}`}>
                  <p>{message.text}</p>
                  <div className="message-meta">
                    <time dateTime={new Date(message.timestamp).toISOString()}>
                      {timeFormat.format(message.timestamp)}
                    </time>
                    {message.direction === 'outgoing' && (
                      <span
                        className="message-status"
                        aria-label={labels[message.status]}
                        title={labels[message.status]}
                      >
                        {message.status === 'sending' ? (
                          <Icon name="clock" size={14} />
                        ) : message.status === 'failed' || message.status === 'unknown' ? (
                          <span className="delivery-warning">!</span>
                        ) : (
                          <Icon
                            name={
                              message.status === 'delivered' || message.status === 'read'
                                ? 'doubleCheck'
                                : 'check'
                            }
                            size={16}
                          />
                        )}
                      </span>
                    )}
                  </div>
                  {(message.status === 'failed' || message.status === 'unknown') && (
                    <div className="message-error">
                      <span>{message.error}</span>
                      {message.status === 'unknown' && (
                        <span>Повторная отправка может создать копию.</span>
                      )}
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => onRetry(message)}
                      >
                        <Icon name="retry" size={14} />
                        Повторить отправку
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </Fragment>
          ))}
        </div>
      </div>
      {showLatest && (
        <button
          type="button"
          className="latest-button"
          onClick={() => {
            const element = scroll.current;
            if (element) element.scrollTop = element.scrollHeight;
          }}
        >
          К новым сообщениям
        </button>
      )}
    </div>
  );
}
