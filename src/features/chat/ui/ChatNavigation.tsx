import { Icon } from '../../../shared/ui/Icon';

export function ChatNavigation({
  unreadCount,
  onDisconnect,
}: {
  unreadCount: number;
  onDisconnect: () => void;
}) {
  return (
    <nav className="chat-navigation" aria-label="Навигация по чатам">
      <div className="navigation-item is-selected" aria-current="page">
        <span className="navigation-icon">
          <Icon name="chats" size={28} />
          {unreadCount > 0 && <span className="navigation-badge">{unreadCount}</span>}
        </span>
        <span>Чаты</span>
      </div>
      <button
        type="button"
        className="navigation-item navigation-logout"
        aria-label="Отключиться"
        title="Отключиться от Telegram"
        onClick={onDisconnect}
      >
        <span className="navigation-icon">
          <Icon name="logout" size={26} />
        </span>
        <span>Выйти</span>
      </button>
    </nav>
  );
}
