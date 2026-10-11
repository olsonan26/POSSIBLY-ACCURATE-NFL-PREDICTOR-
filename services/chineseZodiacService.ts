export const ZODIAC_SIGNS = ['Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig'] as const;
export type ZodiacSign = typeof ZODIAC_SIGNS[number];
export type ZodiacRelationship = 'direct_enemy' | 'same_sign' | 'same_friend_trine' | 'rat_ox_special_pair' | 'other_or_unclassified';
const STEMS = ['Jia', 'Yi', 'Bing', 'Ding', 'Wu', 'Ji', 'Geng', 'Xin', 'Ren', 'Gui'];
const BRANCHES = ['Zi', 'Chou', 'Yin', 'Mao', 'Chen', 'Si', 'Wu', 'Wei', 'Shen', 'You', 'Xu', 'Hai'];
const ELEMENTS = ['Wood', 'Fire', 'Earth', 'Metal', 'Water'];
const TRINES = [['Rat', 'Dragon', 'Monkey'], ['Ox', 'Snake', 'Rooster'], ['Tiger', 'Horse', 'Dog'], ['Rabbit', 'Goat', 'Pig']];
const mod = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;
const chineseCalendar = new Intl.DateTimeFormat('en-u-ca-chinese', { year: 'numeric', timeZone: 'Asia/Hong_Kong' });

export function validDate(iso: unknown): iso is string {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

export function normalizeZodiacSign(value: string): ZodiacSign | null {
  const name = value.trim().toLowerCase();
  if (name === 'cat') return 'Rabbit';
  if (name === 'sheep') return 'Goat';
  return ZODIAC_SIGNS.find(sign => sign.toLowerCase() === name) || null;
}

export function zodiacForDate(iso: string) {
  if (!validDate(iso)) return null;
  const year = Number(iso.slice(0, 4));
  if (year < 1901 || year > 2100) return null;
  const part = chineseCalendar.formatToParts(new Date(`${iso}T12:00:00Z`)).find(part => String(part.type) === 'relatedYear');
  const lunarYear = Number(part?.value);
  if (!Number.isInteger(lunarYear)) return null;
  const stem = mod(lunarYear - 4, 10);
  const branch = mod(lunarYear - 4, 12);
  return { sign: ZODIAC_SIGNS[branch], element: ELEMENTS[Math.floor(stem / 2)],
    polarity: stem % 2 === 0 ? 'Yang' : 'Yin', stem: STEMS[stem], branch: BRANCHES[branch],
    ganZhi: `${STEMS[stem]}-${BRANCHES[branch]}`, lunarYear, convention: 'lunar_new_year' as const };
}

export function zodiacRelationship(a: ZodiacSign, b: ZodiacSign): ZodiacRelationship {
  if (a === b) return 'same_sign';
  if (mod(ZODIAC_SIGNS.indexOf(a) - ZODIAC_SIGNS.indexOf(b), 12) === 6) return 'direct_enemy';
  if ((a === 'Rat' && b === 'Ox') || (a === 'Ox' && b === 'Rat')) return 'rat_ox_special_pair';
  if (TRINES.some(trine => trine.includes(a) && trine.includes(b))) return 'same_friend_trine';
  return 'other_or_unclassified';
}

export function zodiacCompatibilityMatrix(): Record<ZodiacSign, Record<ZodiacSign, ZodiacRelationship>> {
  return Object.fromEntries(ZODIAC_SIGNS.map(a => [a, Object.fromEntries(ZODIAC_SIGNS.map(b => [b, zodiacRelationship(a,b)]))])) as Record<ZodiacSign, Record<ZodiacSign, ZodiacRelationship>>;
}

export function digitSum(value: string | number): number {
  return [...String(value)].filter(char => /\d/.test(char)).reduce((sum, char) => sum + Number(char), 0);
}
export function reduceNumber(value: number, preserveMasters = false): number {
  while (value > 9 && !(preserveMasters && [11, 22, 33].includes(value))) value = digitSum(value);
  return value;
}
export function birthProfile(birthDate: string, gameDate: string) {
  if (!validDate(birthDate) || !validDate(gameDate) || birthDate > gameDate) return null;
  const originalDigitSum = digitSum(birthDate);
  const birthDay = Number(birthDate.slice(8, 10));
  return { originalDigitSum, lifePath: reduceNumber(originalDigitSum, true), birthDay,
    birthDayReduced: reduceNumber(birthDay),
    personalYear: reduceNumber(Number(birthDate.slice(5, 7)) + birthDay + Number(gameDate.slice(0, 4))),
    personalYearBoundary: 'january_1_experimental', masterConvention: 'preserve_11_22_33_at_each_reduction' };
}

export interface ZodiacSubject {
  id: string;
  name: string;
  role: string;
  birthDate: string | null;
  source: string;
  zodiac: ReturnType<typeof zodiacForDate>;
  relationshipToYear: ZodiacRelationship | null;
  numerology: ReturnType<typeof birthProfile>;
  warning: string | null;
}
export interface ZodiacTeamReport {
  abbr: string;
  name: string;
  franchise: ZodiacSubject;
  coach: ZodiacSubject | null;
  players: ZodiacSubject[];
  rosterWeek: number | null;
  warning: string | null;
}
export interface ZodiacReport {
  game: { id: string; date: string; home: string; away: string; completed: boolean; homeScore: number | null; awayScore: number | null };
  gameYear: NonNullable<ReturnType<typeof zodiacForDate>>;
  home: ZodiacTeamReport;
  away: ZodiacTeamReport;
  franchiseRelationship: ZodiacRelationship | null;
  record: Record<string, any> | null;
  recordUnavailableReason: string | null;
  limitations: string[];
}

export const relationshipLabel = (relationship: ZodiacRelationship | null) => ({
  direct_enemy: 'Enemy year', same_sign: 'Own sign year', same_friend_trine: 'Friend trine',
  rat_ox_special_pair: 'Rat–Ox special pair', other_or_unclassified: 'Unclassified / neutral'
}[relationship || ''] || 'Unavailable');

export async function fetchZodiacReport(home: string, away: string, date: string): Promise<ZodiacReport> {
  const response = await fetch('/api/zodiac-research', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ home, away, date }) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Chinese Zodiac research could not be loaded.');
  return payload;
}
