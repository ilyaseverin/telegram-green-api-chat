import { useState } from 'react';
import type { ChatApi } from '../../../api/contracts';
import { Avatar } from '../../../shared/ui/Avatar';
import { Icon } from '../../../shared/ui/Icon';
import { useChat } from '../model/useChat';
import { ChatSidebar } from './ChatSidebar';
import { MessageComposer } from './MessageComposer';
import { MessageList } from './MessageList';
import { NewChatDialog } from './NewChatDialog';
import './chat.css';

export function ChatPage({
  api,
  instanceId,
  storageAvailable = true,
  onDisconnect,
}: {
  api: ChatApi;
  instanceId: string;
  storageAvailable?: boolean;
  onDisconnect: () => void;
}) {
  const {
    state,
    connection,
    createChat,
    send,
    selectChat,
    restartPolling,
    retryHistory,
    stop,
    storageAvailable: chatsSaved,
  } = useChat(api);
  const [showNewChat, setShowNewChat] = useState(false);
  const active = state.activeId ? state.chats[state.activeId] : undefined;
  const chats = Object.values(state.chats).sort(
    (a, b) => (b.messages.at(-1)?.timestamp ?? 0) - (a.messages.at(-1)?.timestamp ?? 0),
  );

  return (
    <main className={`chat-app ${active ? 'has-active-chat' : ''}`}>
      <ChatSidebar
        chats={chats}
        activeId={state.activeId}
        instanceId={instanceId}
        connection={connection}
        onSelect={selectChat}
        onNewChat={() => setShowNewChat(true)}
        onDisconnect={() => {
          stop();
          onDisconnect();
        }}
      />
      <section className="conversation" aria-label={active ? `Чат с ${active.name}` : 'Переписка'}>
        {(!storageAvailable || !chatsSaved) && (
          <div className="connection-banner" role="status">
            Хранилище вкладки недоступно. После перезагрузки подключение или чаты могут не
            сохраниться.
          </div>
        )}
        {'message' in connection && (
          <div className="connection-banner" role="status">
            <span>{connection.message}</span>
            {connection.status === 'stopped' && (
              <button type="button" className="text-button" onClick={restartPolling}>
                Возобновить получение
              </button>
            )}
          </div>
        )}
        {active ? (
          <>
            <header className="conversation-heading">
              <button
                type="button"
                className="icon-button conversation-back"
                onClick={() => selectChat(null)}
                aria-label="К списку чатов"
              >
                <Icon name="back" />
              </button>
              <Avatar name={active.name} id={active.id} />
              <div>
                <h2>{active.name}</h2>
                <p>{active.username || (active.phone ? `+${active.phone}` : 'Telegram')}</p>
              </div>
              <span className="conversation-label">Telegram</span>
            </header>
            {(!active.history || active.history.status === 'loading') && (
              <div className="connection-banner history-banner" role="status">
                Загружаем переписку из Telegram…
              </div>
            )}
            {active.history?.status === 'error' && (
              <div className="connection-banner" role="alert">
                <span>Не удалось загрузить историю. {active.history.message}</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => retryHistory(active.id)}
                >
                  Повторить загрузку
                </button>
              </div>
            )}
            {active.error && (
              <div className="connection-banner chat-error-banner" role="alert">
                {active.error}
              </div>
            )}
            <MessageList
              key={`messages:${active.id}`}
              messages={active.messages}
              showEmptyState={active.history?.status === 'loaded'}
              onRetry={(message) => void send(active.id, message.text, message)}
            />
            <MessageComposer
              key={`composer:${active.id}`}
              disabled={connection.status === 'stopped'}
              onSend={(text) => send(active.id, text)}
            />
          </>
        ) : (
          <div className="welcome">
            <div className="welcome-icon">
              <Icon name="chat" size={45} />
            </div>
            <h2>Начните общение</h2>
            <p>
              Выберите чат слева или создайте новый,
              <br />
              чтобы написать в Telegram.
            </p>
            <button type="button" className="primary-button" onClick={() => setShowNewChat(true)}>
              <Icon name="plus" size={20} />
              Новый чат
            </button>
            <span className="welcome-footnote">Telegram через GREEN-API</span>
          </div>
        )}
      </section>
      {showNewChat && <NewChatDialog onCreate={createChat} onClose={() => setShowNewChat(false)} />}
    </main>
  );
}
