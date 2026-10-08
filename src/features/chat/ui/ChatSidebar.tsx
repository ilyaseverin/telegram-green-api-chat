import { useState } from 'react';
import { Avatar } from '../../../shared/ui/Avatar';
import { Icon } from '../../../shared/ui/Icon';
import type { Chat, Connection } from '../model/types';
import { ChatNavigation } from './ChatNavigation';

const timeFormat = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });

interface Props {
  chats: Chat[];
  activeId: string | null;
  instanceId: string;
  connection: Connection;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDisconnect: () => void;
}

export function ChatSidebar({
  chats,
  activeId,
  instanceId,
  connection,
  onSelect,
  onNewChat,
  onDisconnect,
}: Props) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const filtered = chats.filter((chat) =>
    `${chat.name} ${chat.username ?? ''} ${chat.phone ?? ''}`.toLowerCase().includes(query),
  );
  const unreadCount = chats.reduce((total, chat) => total + chat.unread, 0);
  return (
    <div className="chat-panel">
      <ChatNavigation unreadCount={unreadCount} onDisconnect={onDisconnect} />
      <aside className="chat-sidebar" aria-label="Список чатов">
        <div className="sidebar-heading">
          <h1>Чаты</h1>
          <button
            type="button"
            className="new-chat-button"
            onClick={onNewChat}
            aria-label="Новый чат"
            title="Новый чат"
          >
            <Icon name="plus" size={24} />
          </button>
        </div>
        <div className="sidebar-tools">
          <div className="search-field">
            <input
              aria-label="Поиск чатов"
              type="search"
              placeholder="Найти"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        <div className="chat-list">
          {filtered.map((chat) => {
            const last = chat.messages.at(-1);
            return (
              <button
                type="button"
                key={chat.id}
                className={`chat-row ${activeId === chat.id ? 'is-active' : ''}`}
                onClick={() => onSelect(chat.id)}
                aria-current={activeId === chat.id ? 'true' : undefined}
              >
                <Avatar name={chat.name} id={chat.id} />
                <span className="chat-row-body">
                  <span className="chat-row-top">
                    <strong>{chat.name}</strong>
                    {last && (
                      <time dateTime={new Date(last.timestamp).toISOString()}>
                        {timeFormat.format(last.timestamp)}
                      </time>
                    )}
                  </span>
                  <span className="chat-row-bottom">
                    <span className="chat-preview">
                      {last
                        ? `${last.direction === 'outgoing' ? 'Вы: ' : ''}${last.text}`
                        : 'Начните разговор'}
                    </span>
                    {chat.unread > 0 && (
                      <span
                        className="unread-count"
                        aria-label={`${chat.unread} непрочитанных сообщений`}
                      >
                        {chat.unread}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="sidebar-empty">
              <Icon name={query ? 'search' : 'chat'} size={32} />
              <p>{query ? 'Чаты не найдены' : 'Здесь будут ваши чаты'}</p>
              <span>
                {query ? 'Попробуйте другое имя или номер' : 'Создайте чат по номеру или @username'}
              </span>
              {!query && (
                <button type="button" className="text-button" onClick={onNewChat}>
                  Начать разговор
                </button>
              )}
            </div>
          )}
        </div>
        <footer className="sidebar-footer">
          <span
            className={`connection-dot ${connection.status === 'connected' ? 'is-online' : ''}`}
          />
          <div>
            <strong>Инстанс {instanceId}</strong>
            <span>
              {connection.status === 'connected'
                ? 'Подключено'
                : connection.status === 'connecting'
                  ? 'Подключаемся…'
                  : connection.status === 'reconnecting'
                    ? 'Восстанавливаем соединение…'
                    : 'Получение приостановлено'}
            </span>
          </div>
          <span className="green-api-label">Telegram</span>
        </footer>
      </aside>
    </div>
  );
}
