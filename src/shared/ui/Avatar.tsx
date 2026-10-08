const colors = ['#438cca', '#6579b8', '#429e96', '#b17d58', '#9871b6'];

export function Avatar({ name, id }: { name: string; id: string }) {
  const colorIndex =
    Array.from(id).reduce((total, character) => total + character.charCodeAt(0), 0) % colors.length;
  const initials = name
    .replace(/^@/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  return (
    <span className="avatar" style={{ backgroundColor: colors[colorIndex] }} aria-hidden="true">
      {initials}
    </span>
  );
}
