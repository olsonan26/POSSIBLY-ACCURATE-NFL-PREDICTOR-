import {
  filterTeamStatsBeforeWeek,
  hasRequiredTeamStatsFields,
  parseTeamStatsCsv,
} from '../services/pointInTimeTeamStats';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const sample = [
  'season,week,team,attempts,carries,passing_first_downs,rushing_first_downs,note',
  '2026,1,BUF,31,24,12,7,"quoted,comma"',
  '2026,2,BUF,28,27,10,8,ok',
  '2026,3,BUF,40,18,15,4,target-week-must-not-leak',
  '2026,1,MIA,29,22,11,6,other-team',
].join('\n');

const dataset = parseTeamStatsCsv(sample);

assert(dataset.rows.length === 4, 'Expected all sample rows to parse');
assert(dataset.rows[0].note === 'quoted,comma', 'Quoted commas must not shift CSV columns');
assert(
  hasRequiredTeamStatsFields(dataset, [
    'season',
    'week',
    'team',
    'attempts',
    'carries',
    'passing_first_downs',
    'rushing_first_downs',
  ]),
  'Expected required pace fields to be present',
);
assert(
  !hasRequiredTeamStatsFields(dataset, ['field_goal_epa']),
  'Missing source fields must remain missing instead of becoming zero evidence',
);

const beforeWeekThree = filterTeamStatsBeforeWeek(dataset, 'BUF', 2026, 3);
assert(beforeWeekThree.length === 2, 'Only weeks strictly before the target week are eligible');
assert(beforeWeekThree.every(row => Number(row.week) < 3), 'Target week leaked into point-in-time rows');
assert(!beforeWeekThree.some(row => row.note === 'target-week-must-not-leak'), 'Target-game week must be excluded');

const beforeWeekOne = filterTeamStatsBeforeWeek(dataset, 'BUF', 2026, 1);
assert(beforeWeekOne.length === 0, 'Week 1 must have no current-season pregame rows');

console.log('point-in-time integrity tests passed');
