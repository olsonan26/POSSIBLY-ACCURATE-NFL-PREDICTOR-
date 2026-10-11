function datePartsInZone(date: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const out: Record<string, number> = {};
  for (const part of parts) {
    if (part.type === 'literal') continue;
    const n = Number(part.value);
    if (Number.isFinite(n)) out[part.type] = n;
  }
  return out;
}

export function easternKickoffIso(gameday: string, gametime: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gameday) || !/^\d{1,2}:\d{2}$/.test(gametime)) return null;
  const [year, month, day] = gameday.split('-').map(Number);
  const [hour, minute] = gametime.split(':').map(Number);
  if (
    !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) ||
    !Number.isInteger(hour) || !Number.isInteger(minute) ||
    month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59
  ) return null;

  const targetLocalMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guessMs = targetLocalMs;
  for (let i = 0; i < 3; i++) {
    const parts = datePartsInZone(new Date(guessMs), 'America/New_York');
    if (!parts.year || !parts.month || !parts.day || parts.hour == null || parts.minute == null) return null;
    const representedLocalMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second || 0
    );
    guessMs += targetLocalMs - representedLocalMs;
  }

  const resolved = new Date(guessMs);
  return Number.isFinite(resolved.getTime()) ? resolved.toISOString() : null;
}

