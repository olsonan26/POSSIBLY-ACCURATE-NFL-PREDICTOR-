import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TEAM_BY_ABBR, normalizeTeamAbbr } from '../data/teamRegistry.js';
import { parseScheduleCsv, type ScheduledGame } from '../services/scheduleService.js';
import { easternKickoffIso } from '../api/prediction-ledger.js';
import { zodiacForDate, zodiacRelationship, birthProfile, digitSum, reduceNumber, type ZodiacReport, type ZodiacSubject, type ZodiacTeamReport } from '../services/chineseZodiacService.js';
import { validateZodiacRecord } from './zodiacValidation.js';

const registry = JSON.parse(readFileSync(new URL('../zodiac/rule_registry.json', import.meta.url), 'utf8'));
const SCHEDULE = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const cache = new Map<string, { expires: number; value: Promise<string> }>();
async function download(url: string): Promise<string> {
  const found = cache.get(url);
  if (found && found.expires > Date.now()) return found.value;
  const value = fetch(url, { signal: AbortSignal.timeout(18000), headers: { 'User-Agent': 'NFL-Zodiac-Research/0.1.0', Accept: 'application/json,text/csv,*/*' } }).then(async response => {
    if (!response.ok) throw new Error(`NFL research source unavailable (HTTP ${response.status}).`);
    return response.text();
  }).catch(error => { cache.delete(url); throw error; });
  if (cache.size >= 12) cache.delete(cache.keys().next().value!);
  cache.set(url, { expires: Date.now() + 300_000, value });
  return value;
}

export function parseRosterCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (c === '\n' && !quoted) { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const headers = (rows.shift() || []).map(value => value.replace(/^\uFEFF/, ''));
  return rows.filter(row => row.length > 1).map(row => Object.fromEntries(headers.map((header, i) => [header, row[i] || ''])));
}

function subject(id: string, name: string, role: string, birthDate: string | null, gameDate: string, source: string, warning: string | null = null): ZodiacSubject {
  const zodiac = birthDate && birthDate <= gameDate ? zodiacForDate(birthDate) : null;
  const gameYear = zodiacForDate(gameDate)!;
  return { id, name, role, birthDate, source, zodiac, relationshipToYear: zodiac ? zodiacRelationship(zodiac.sign, gameYear.sign) : null,
    numerology: birthDate ? birthProfile(birthDate, gameDate) : null,
    warning: warning || (!zodiac ? 'Birth date missing, invalid or outside supported calendar range.' : null) };
}
export function buildTeamReport(abbr: string, game: ScheduledGame, rows: Record<string, string>[], rosterSource: string): ZodiacTeamReport {
  const team = TEAM_BY_ABBR.get(abbr)!;
  const eligible = rows.filter(row => normalizeTeamAbbr(row.team) === abbr && Number(row.season) === game.season && Number(row.week) === game.week);
  const seen = new Set<string>();
  const players = eligible.flatMap(row => {
    const key = row.gsis_id || row.espn_id;
    if (!key || seen.has(key) || !row.full_name) return [];
    seen.add(key);
    return [subject(`player:${key}`, row.full_name, row.position || 'Player', row.birth_date || null, game.gameday, rosterSource)];
  }).sort((a, b) => (a.role === 'QB' ? -1 : 0) - (b.role === 'QB' ? -1 : 0) || a.name.localeCompare(b.name));
  return { abbr, name: team.name,
    franchise: subject(`team:${abbr}`, team.name, 'Existing app franchise date', team.birthday.toISOString().slice(0, 10), game.gameday, 'data/teamRegistry.ts',
      'Preview of the existing app date only. Its historical milestone is unaudited; franchise features are unavailable in the contract.'),
    // Never reuse today's coaching fallback as historical personnel.
    coach: null, players, rosterWeek: eligible.length ? game.week : null,
    warning: players.length ? 'Weekly roster reconstructed from nflverse; starters and pregame publication timing are unverified. Counts are unweighted.' : 'No matching weekly roster with stable player identifiers. Current personnel were not substituted.' };
}

// Resolve timezone from the actual event's venue address, never the nominal home
// team (which would be wrong for neutral, international and relocated games).
export function venueTimezone(city: string, country: string): string | null {
  const c = city.toLowerCase().trim(); const nation = country.toLowerCase().trim();
  if (['usa','united states','us'].includes(nation)) {
    const groups: Record<string, string[]> = {
      'America/New_York': ['philadelphia','pittsburgh','baltimore','landover','east rutherford','foxborough','foxboro','orchard park','buffalo','miami gardens','miami','jacksonville','tampa','charlotte','atlanta','detroit','cincinnati','cleveland','indianapolis','pontiac'],
      'America/Chicago': ['arlington','irving','houston','new orleans','nashville','minneapolis','green bay','chicago','kansas city','st. louis','st louis','san antonio','memphis'],
      'America/Denver': ['denver'], 'America/Phoenix': ['glendale','tempe'],
      'America/Los_Angeles': ['inglewood','los angeles','santa clara','san francisco','oakland','san diego','seattle','las vegas','paradise']
    };
    return Object.entries(groups).find(([, cities]) => cities.includes(c))?.[0] || null;
  }
  if (['england','united kingdom','uk'].includes(nation) && c === 'london') return 'Europe/London';
  if (['germany','deu'].includes(nation) && ['munich','frankfurt','berlin'].includes(c)) return 'Europe/Berlin';
  if (['brazil','bra'].includes(nation) && ['sao paulo','são paulo'].includes(c)) return 'America/Sao_Paulo';
  if (['mexico','mex'].includes(nation) && ['mexico city','ciudad de méxico'].includes(c)) return 'America/Mexico_City';
  if (['canada','can'].includes(nation) && c === 'toronto') return 'America/Toronto';
  if (['spain','esp'].includes(nation) && c === 'madrid') return 'Europe/Madrid';
  return null;
}

export function buildZodiacRecord(report: ZodiacReport, event: { kickoff: string; timezone: string; venue: string; source: string }, now = new Date().toISOString()): Record<string, any> {
  const snapshotId = randomUUID();
  const sources = [
    { source_id: 'schedule', type: 'sports_data', title: 'nflverse NFL schedule and results', locator: SCHEDULE, retrieved_at_utc: now },
    { source_id: 'rules', type: 'internal_registry', title: 'Zodiac experimental rule registry', locator: 'zodiac/rule_registry.json', retrieved_at_utc: now },
    { source_id: 'calendar', type: 'internal_registry', title: 'Lunar New Year calendar convention', locator: 'zodiac/calendar_rules.json', retrieved_at_utc: now },
    { source_id: 'venue', type: 'sports_data', title: 'ESPN event venue', locator: event.source, retrieved_at_utc: now }
  ];
  for (const team of [report.home, report.away]) if (team.players.length) sources.push({ source_id: `roster:${team.abbr}`, type: 'sports_data', title: `${team.abbr} weekly roster`, locator: team.players[0].source, retrieved_at_utc: now });
  const observations: any[] = [];
  const add = (ruleId: string, subjectId: string, value: any, sourceIds: string[], interpretation: string, reason: string | null = null, extra = {}) => {
    const rule = registry.rules.find((rule: any) => rule.rule_id === ruleId);
    observations.push({ feature_id: `${subjectId}:${ruleId}`, rule_id: ruleId, rule_version: rule.version, subject_ids: [subjectId], category: rule.category,
      value: reason ? null : value, availability: reason ? 'unavailable' : 'available', unavailable_reason: reason,
      provenance_category: rule.provenance_category, attribution_confidence: rule.attribution_confidence, validation_status: 'untested',
      used_in_published_probability: false, source_ids: sourceIds,
      calculation: reason ? null : { backend_calculation_id: randomUUID(), method_id: rule.method_id, method_version: '0.1.0', input_snapshot_id: snapshotId, available_at_utc: now,
        calendar_convention: ['year_sign','year_element','year_ganzhi','year_relationship','opponent_relationship'].includes(ruleId) ? 'lunar_new_year' : 'not_applicable', ...extra },
      interpretation, limitations: ['Experimental observation; no contribution to any published probability.'] });
  };
  const eventId = `event:${report.game.id}`;
  add('year_sign', eventId, report.gameYear.sign, ['schedule','calendar'], 'Chinese zodiac year at the venue-local game date.', null, { canonical_zodiac_signs: [report.gameYear.sign] });
  add('year_element', eventId, report.gameYear.element, ['schedule','calendar'], 'Year element.');
  add('year_ganzhi', eventId, report.gameYear.ganZhi, ['schedule','calendar'], 'Sexagenary year pair.');
  add('game_date_number', eventId, reduceNumber(digitSum(report.game.date), true), ['schedule'], 'Master-preserving venue-local date number.', null,
    { original_digit_sum: digitSum(report.game.date), reduced_number: reduceNumber(digitSum(report.game.date), true), master_number_convention: 'preserve_11_22_33_at_each_reduction' });
  for (const team of [report.home, report.away]) {
    add('year_sign', team.franchise.id, null, [], 'Franchise sign unavailable until a fixed historical milestone is audited.', team.franchise.warning);
    add('year_relationship', team.franchise.id, null, [], 'Franchise versus year unavailable.', team.franchise.warning);
    add('year_sign', `coach:${team.abbr}`, null, [], 'Coach birth sign unavailable without verified historical personnel.', 'No verified coach identity and birthday in the selected weekly roster.');
    for (const player of team.players) {
      const ids = [`roster:${team.abbr}`, 'calendar'];
      const missing = player.zodiac ? null : player.warning;
      add('year_sign', player.id, player.zodiac?.sign, ids, `${player.name}: birth-year sign.`, missing, { canonical_zodiac_signs: player.zodiac ? [player.zodiac.sign] : [] });
      add('year_element', player.id, player.zodiac?.element, ids, `${player.name}: birth-year element.`, missing);
      add('year_ganzhi', player.id, player.zodiac?.ganZhi, ids, `${player.name}: year Gan-Zhi pair.`, missing);
      add('year_relationship', player.id, player.relationshipToYear, ids, `${player.name}: relationship to game year.`, missing);
      for (const [ruleId, value] of [['life_path', player.numerology?.lifePath], ['birth_day_raw', player.numerology?.birthDay], ['birth_day_reduced', player.numerology?.birthDayReduced], ['personal_year', player.numerology?.personalYear]] as const) {
        add(ruleId, player.id, value, [`roster:${team.abbr}`], `${player.name}: ${ruleId}.`, player.numerology ? null : 'Birth date unavailable or invalid.',
          ruleId === 'life_path' ? { original_digit_sum: player.numerology?.originalDigitSum, reduced_number: value, master_number_convention: 'preserve_11_22_33_at_each_reduction' } : {});
      }
    }
  }
  const historic = report.game.completed;
  const record: Record<string, any> = {
    schema_version: '0.1.0', record_id: randomUUID(), mode: historic ? 'historical_audit' : 'research', status: 'partial',
    event: { event_id: report.game.id, sport: 'American football', league: 'NFL', participants: [
      { participant_id: report.home.franchise.id, name: report.home.name, role: 'home' },
      { participant_id: report.away.franchise.id, name: report.away.name, role: 'away' }],
      scheduled_start_utc: event.kickoff, venue_timezone: event.timezone, venue_name: event.venue, source_ids: ['schedule','venue'] },
    // For retrospective audit these are today's audit snapshot times, never
    // invented original forecast times. Unknown originals stay null below.
    timing: { record_created_utc: now, prediction_as_of_utc: now, information_cutoff_utc: now, forecast_stage: 'pregame' },
    target: { target_id: `${report.game.id}:home_win`, type: 'win', selection: report.home.franchise.id, line: null, overtime_treatment: 'included',
      tie_draw_treatment: 'excluded', push_treatment: 'not_applicable', settlement_rules: 'Home outright victory including overtime; ties excluded from binary evaluation, voids excluded. No wager.' },
    model_metadata: { feature_registry_version: '0.1.0', calendar_rules_version: '0.1.0', baseline: null, hybrid: null },
    prediction: { probability_definition: 'Home win conditional on a non-tied completed game.', published_probability: null, published_model: null, baseline_probability: null,
      approved_hybrid_probability: null, probability_origin: 'unavailable', recommendation: 'research_only' },
    sports_factors: [], symbolic_observations: observations, evaluation: [],
    data_quality: { snapshot_id: snapshotId, missing_fields: ['approved_model_manifest','calibration_artifact','verified_franchise_milestones','historical_coach_birthdays','pregame_roster_publication_timestamps'],
      warnings: report.limitations, cutoff_check_status: 'not_checked', identity_check_status: 'passed', calendar_check_status: 'passed' },
    sources, limitations: report.limitations,
    explanation: { summary: `${report.away.name} at ${report.home.name}: ${historic ? 'retrospective research audit' : 'research report'}; no probability published.`,
      sports_reasoning: ['The existing football model was not invoked or changed by this research operation.'],
      symbolic_reasoning: [`Game year: ${report.gameYear.element} ${report.gameYear.sign}. All symbolic features are untested and unused in published probabilities.`],
      validation_note: 'No approved Zodiac model or evaluation report exists. Historical roster retrieval does not establish pregame availability.' }
  };
  if (historic) record.historical_audit = { original_record_id: null, original_record_available: false, original_prediction_timestamp_utc: null, original_information_cutoff_utc: null,
    outcome: { settlement: report.game.homeScore === report.game.awayScore ? 'void' : report.game.homeScore! > report.game.awayScore! ? 'success' : 'failure', observed_at_utc: now, source_ids: ['schedule'] },
    post_prediction_information: [{ description: 'Final result and historical roster retrieved during this audit; no original Zodiac forecast supplied.', available_at_utc: now, source_ids: ['schedule'] }],
    retrospective_explanation: 'Reconstructed after the game. Original forecast is unavailable; no historical probability or timestamp was manufactured.' };
  const subjects = [eventId, ...[report.home, report.away].flatMap(team => [team.franchise.id, `coach:${team.abbr}`, ...team.players.map(player => player.id)])];
  const errors = validateZodiacRecord(record, { rules: registry.rules, subjectIds: subjects });
  if (errors.length) throw new Error(`Zodiac contract validation failed: ${errors.slice(0, 3).join(' ')}`);
  return record;
}

export async function researchZodiacGame(home: string, away: string, date: string): Promise<ZodiacReport> {
  const games = parseScheduleCsv(await download(SCHEDULE));
  const game = games.find(game => game.homeTeam === home && game.awayTeam === away && game.gameday === date);
  if (!game) throw new Error('No exact NFL schedule match. Select the official date and home/away roles.');
  const rosterSource = `https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_${game.season}.csv`;
  let roster: Record<string, string>[] = []; let rosterError: string | null = null;
  try { roster = parseRosterCsv(await download(rosterSource)); } catch (e) { rosterError = e instanceof Error ? e.message : 'Weekly roster unavailable.'; }
  const report: ZodiacReport = {
    game: { id: game.gameId, date, home, away, completed: game.completed, homeScore: game.homeScore ?? null, awayScore: game.awayScore ?? null },
    gameYear: zodiacForDate(date)!, home: buildTeamReport(home, game, roster, rosterSource), away: buildTeamReport(away, game, roster, rosterSource),
    franchiseRelationship: null, record: null, recordUnavailableReason: null,
    limitations: ['No approved Zodiac model or evaluation report exists.', 'Franchise-date previews use unchanged app dates; historical milestones are unaudited.',
      'Weekly rosters do not establish starting roles, pregame availability or projected participation. No current coach or player is substituted for a historical roster.',
      'All relationship and numerology rules are experimental; no proprietary GG33 formula or calibrated probability is claimed.']
  };
  if (rosterError) report.limitations.push(rosterError);
  if (report.home.franchise.zodiac && report.away.franchise.zodiac) report.franchiseRelationship = zodiacRelationship(report.home.franchise.zodiac.sign, report.away.franchise.zodiac.sign);
  try {
    if (!report.gameYear) throw new Error('Game date outside supported Chinese-calendar range.');
    const kickoff = game.gametime ? easternKickoffIso(game.gameday, game.gametime) : null;
    if (!kickoff) throw new Error('Verified kickoff time unavailable; JSON contract cannot be completed.');
    if (!game.completed && Date.parse(kickoff) <= Date.now()) throw new Error('Kickoff passed with no final result. A live record needs a separate contract.');
    if (!game.espnId) throw new Error('Verified event venue unavailable; JSON export cannot invent a timezone.');
    const source = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${game.espnId}`;
    const summary = JSON.parse(await download(source));
    const competition = summary.header?.competitions?.[0];
    if (String(summary.header?.id) !== game.espnId || !competition?.competitors?.some((p: any) => p.homeAway === 'home' && normalizeTeamAbbr(p.team?.abbreviation || '') === home)
      || !competition?.competitors?.some((p: any) => p.homeAway === 'away' && normalizeTeamAbbr(p.team?.abbreviation || '') === away)) throw new Error('Event identity check failed.');
    const venue = summary.gameInfo?.venue;
    const timezone = venueTimezone(venue?.address?.city || '', venue?.address?.country || '');
    if (!timezone || !venue?.fullName) throw new Error('Venue timezone unresolved; JSON export unavailable.');
    if (competition.date && Date.parse(competition.date) !== Date.parse(kickoff)) throw new Error('Schedule and event kickoff disagree; export unavailable.');
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(kickoff));
    const part = (type: string) => parts.find(p => p.type === type)?.value;
    report.game.date = `${part('year')}-${part('month')}-${part('day')}`;
    report.gameYear = zodiacForDate(report.game.date)!;
    // Recompute player timing at the verified venue-local date.
    const localGame = { ...game, gameday: report.game.date };
    report.home = buildTeamReport(home, localGame, roster, rosterSource);
    report.away = buildTeamReport(away, localGame, roster, rosterSource);
    report.record = buildZodiacRecord(report, { kickoff, timezone, venue: venue.fullName, source });
  } catch (e) { report.recordUnavailableReason = e instanceof Error ? e.message : 'Structured report unavailable.'; }
  return report;
}
