// Calls the actual production predictor, with a pinned game feed and no network.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { parseGamesCsv, parseTeamData, predictWinner } from '../../services/validatedPredictionService.ts';

const root = new URL('./', import.meta.url);
const bytes = gunzipSync(readFileSync(new URL('inputs/games.csv.gz', root)));
const manifest = JSON.parse(readFileSync(new URL('results/source-manifest.json', root)));
assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sources.games.sha256);
const csv = bytes.toString('utf8');
const requests = [];
globalThis.fetch = async input => {
  const url = String(input);
  requests.push(url);
  if (url === '/api/nfl-data?dataset=games' || url === manifest.sources.games.url) return new Response(csv);
  throw new Error(`Blocked non-games request in retrospective audit: ${url}`);
};

export function metrics(rows) {
  const n = rows.length;
  if (!n) return { games: 0, correct: 0, incorrect: 0, accuracy: null, ratio: null,
    brier: null, log_loss: null, home_pick_accuracy: null, away_pick_accuracy: null, calibration: [] };
  const correct = rows.filter(r => r.correct).length;
  const home = rows.filter(r => r.pick_home), away = rows.filter(r => !r.pick_home);
  const bands = [[0.5,0.55], [0.55,0.6], [0.6,0.65], [0.65,0.7], [0.7,1.000001]];
  return { games: n, correct, incorrect: n - correct, accuracy: correct / n,
    correct_incorrect: `${correct}:${n-correct}`, ratio: n === correct ? null : correct / (n-correct),
    brier: rows.reduce((s,r) => s + (r.p_home - r.actual_home)**2, 0)/n,
    log_loss: rows.reduce((s,r) => s - (r.actual_home ? Math.log(r.p_home) : Math.log1p(-r.p_home)),0)/n,
    home_picks: home.length, home_pick_accuracy: home.length ? home.filter(r=>r.correct).length/home.length : null,
    away_picks: away.length, away_pick_accuracy: away.length ? away.filter(r=>r.correct).length/away.length : null,
    calibration: bands.map(([lo,hi]) => {
      const selected = rows.filter(r => r.confidence >= lo && r.confidence < hi);
      return { band: `${Math.round(lo*100)}–${Math.min(100,Math.round(hi*100))}`, games: selected.length,
        accuracy: selected.length ? selected.filter(r=>r.correct).length/selected.length : null,
        mean_confidence: selected.length ? selected.reduce((s,r)=>s+r.confidence,0)/selected.length : null };
    }) };
}

const teams = new Map(parseTeamData().map(t=>[t.abbr,t]));
const games = parseGamesCsv(csv);
const selectedSeasons = process.argv.includes('--all-seasons') ? [2020,2021,2022,2023,2024,2025,2026] : [2025,2026];
const output = { baseline_commit: '9fe9c75', game_source_sha256: manifest.sources.games.sha256,
  probability_convention: 'Production displayed p_home (0.1 percentage point rounding); winner is production winner, never rederived from rounded final probability.',
  seasons: {}, requests: [] };
const ledger = [];
for (const season of selectedSeasons) {
  const all = games.filter(g => g.season === season && g.gameType === 'REG' &&
    Number.isFinite(g.homeScore) && Number.isFinite(g.awayScore) &&
    (season !== 2026 || g.gameday <= '2026-09-14'));
  const rows = [];
  for (const game of all.filter(g=>g.homeScore!==g.awayScore)) {
    assert(teams.has(game.homeTeam) && teams.has(game.awayTeam), `Unmapped team ${game.gameId}`);
    const result = await predictWinner(teams.get(game.homeTeam),teams.get(game.awayTeam),
      new Date(`${game.gameday}T12:00:00Z`),true,{ neutralSite: game.location === 'Neutral' });
    assert.equal(result.modelVersion, 'v2.2-validated-current-season');
    assert.equal(result.modelScores.personnelLogitAdjustment, 0);
    assert.equal(result.homePersonnel, undefined);
    assert.equal(result.awayPersonnel, undefined);
    assert.equal(result.dataFreshness.livePersonnelLoaded, false);
    assert.equal(result.dataFreshness.injuryDataLoaded, false);
    const p = result.modelScores.finalHomeProbability / 100;
    assert(Number.isFinite(p) && p > 0 && p < 1);
    const pickHome = result.winner.abbr === game.homeTeam;
    const actual = Number(game.homeScore > game.awayScore);
    const row = { game_id: game.gameId, season, week: game.week, date: game.gameday,
      home: game.homeTeam, away: game.awayTeam, p_home:p, pick_home:pickHome,
      actual_home:actual, correct:pickHome===Boolean(actual), confidence:result.confidence/100,
      elo_probability:result.modelScores.baseHomeProbability/100,
      form:result.modelScores.footballLogitAdjustment, venue:result.modelScores.venueLogitAdjustment,
      h2h:result.modelScores.h2hLogitAdjustment };
    rows.push(row); ledger.push(row);
  }
  output.seasons[season] = { role: season === 2026 ? 'locked observation only' : season === 2025 ? 'baseline reproduction only' : 'development/selection baseline',
    excluded_ties:all.filter(g=>g.homeScore===g.awayScore).map(g=>g.gameId),
    overall:metrics(rows), week_1:metrics(rows.filter(r=>r.week===1)),
    weeks_1_4:metrics(rows.filter(r=>r.week<=4)), weeks_5_8:metrics(rows.filter(r=>r.week>=5&&r.week<=8)),
    weeks_9_plus:metrics(rows.filter(r=>r.week>=9)) };
  console.log(season, JSON.stringify(output.seasons[season].overall));
}
// Fail even if a production service catches a rejected request and silently falls back.
assert(requests.every(u=>u==='/api/nfl-data?dataset=games'||u===manifest.sources.games.url));
output.requests = requests;
const validation = output.seasons[2025]?.overall;
if (validation) {
  output.baseline_parity = validation.games===271 && validation.correct===180 && validation.brier.toFixed(4)==='0.2250';
}
const observed = output.seasons[2026]?.overall;
if (observed) output.observation_parity = observed.games===16 && observed.correct===10;
writeFileSync(new URL('results/baseline.json',root),JSON.stringify(output,null,2)+'\n');
writeFileSync(new URL('results/baseline-predictions.json',root),'[\n'+ledger.map(r=>JSON.stringify(r)).join(',\n')+'\n]\n');
assert.equal(output.baseline_parity,true,'Production benchmark did not reproduce; stop all candidate research');
assert.equal(output.observation_parity,true,'Locked observation benchmark did not reproduce');
