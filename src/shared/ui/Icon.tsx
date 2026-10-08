import type { CSSProperties } from 'react';

const paths = {
  plane: 'm3 11 18-8-7 18-4-7-7-3Zm7 3L21 3',
  plus: 'M12 5v14M5 12h14',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  logout: 'M9 5H4v14h5M9 12h12m-4-4 4 4-4 4',
  back: 'm14 5-7 7 7 7',
  close: 'm6 6 12 12M6 18 18 6',
  check: 'm5 12 4 4L19 6',
  doubleCheck: 'm2 12 4 4L16 6m-5 9 1 1L22 6',
  clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  chat: 'M21 11a9 9 0 0 1-9 9H4l-3 2 2-6A9 9 0 1 1 21 11ZM7 10h10M7 14h6',
  chats: 'M5 3h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7l-4 3V5a2 2 0 0 1 2-2Zm5 16h8l4 3V10',
  lock: 'M6 10h12v11H6ZM8 10V6a4 4 0 0 1 8 0v4',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  retry: 'M20 7v5h-5M20 12a8 8 0 1 0-2 6',
} as const;

export function Icon({
  name,
  size = 22,
  style,
}: {
  name: keyof typeof paths;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
