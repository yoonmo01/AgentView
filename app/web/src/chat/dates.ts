const DAY = 86_400_000;
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Session list group for a timestamp: 오늘, 어제, 지난 7일, then by month. */
export function dayGroup(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  if (days < 7) return '지난 7일';
  const d = new Date(t);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

/** Compact time: "오후 1:29" today, "11월 3일 (월)" this year, "2025. 11. 3." before. */
export function shortTime(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  if (startOfDay(d.getTime()) === startOfDay(now)) return d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === new Date(now).getFullYear()) return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  return d.toLocaleDateString('ko-KR');
}
