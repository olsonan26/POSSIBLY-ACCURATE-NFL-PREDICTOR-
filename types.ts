export interface Person {
  name: string;
  birthday?: Date;
  source?: string;
  status?: string;
  position?: string;
}

export interface Team {
  name: string;
  abbr: string;
  birthday: Date;
  coach: Person;
  qb: Person;
  owner?: Person;
  blindsideTackle?: Person;
}

export type Role =
  | 'Team'
  | 'Coach'
  | 'Owner'
  | 'Qb'
  | 'Backup Qb'
  | 'Blindside Tackle'
  | 'Kicker'
  | 'Key Offense'
  | 'Key Defense';

export interface DisplayNumbers {
  yearEssence: number;
  personalYear: number;
  personalMonth: number;
  personalMonthEssence: number;
  dailyEssence: number;
}

export interface NumerologyPatterns {
  yrPersonalEss: string;
  py: string;
  pm: string;
  pme: string;
  monCombiner: string;
  yearCom: string;
  dayNum: string;
  /**
   * Provisional Lettrology Daily Environment = reduced(PM + calendar day).
   * Optional for compatibility with the legacy raw calculator; the research
   * wrapper fills this before exposing candidate daily signatures.
   */
  dailyEnvironmentFull?: string;
  dailyEssenceFull: string;
}

export interface EvalCounts {
  wins: number;
  losses: number;
  net: number;
}

export interface EvalResult {
  exact: EvalCounts;
  subset: EvalCounts;
}

export interface PatternStats {
  pattern: string;
  wins: number;
  losses: number;
  total: number;
  winPct: number;
  smoothedWinPct?: number;
}

export interface Breakdown {
  role: Role;
  name: string;
  patterns: NumerologyPatterns;
  evalResult?: EvalResult;
  deStats?: PatternStats;
  includedInScore?: boolean;
  source?: string;
}

export interface HistoricalGame {
  date: string;
  season?: number;
  week?: number | string;
  homeTeam: string;
  homeScore: number;
  awayTeam: string;
  awayScore: number;
  winnerTeam: string;
  loserTeam: string;
  winnerHomeAway: 'Home' | 'Away' | 'Tie';
  homeDE: string;
  homeDay: string;
  awayDE: string;
  awayDay: string;
  winnerDE: string;
  winnerDay: string;
  loserDE: string;
  loserDay: string;
  location?: 'Home' | 'Neutral';
  stadium?: string;
}

export interface DecisionFactor {
  title: string;
  name?: string;
  description: string;
  explanation?: string;
  advantage: 'winner' | 'loser' | 'neutral';
  winnerDetail?: string;
  loserDetail?: string;
  winnerScore?: number;
  loserScore?: number;
  edgeScore: number;
  category?: 'football' | 'personnel' | 'venue' | 'numerology' | 'data';
  includedInScore?: boolean;
}

export interface PersonnelSnapshot {
  team: string;
  teamAbbr: string;
  coach?: Person;
  startingQb?: Person;
  backupQb?: Person;
  blindsideTackle?: Person;
  kicker?: Person;
  keyOffense?: Person[];
  keyDefense?: Person[];
  injuries?: Array<{
    name: string;
    position?: string;
    status?: string;
    injury?: string;
    impact: number;
  }>;
  sourceStatus: 'live' | 'partial' | 'fallback';
}

export interface DataFreshness {
  historicalSource: string;
  livePersonnelSource: string;
  historicalGamesUsed: number;
  cutoffDate: string;
  leakageGuard: boolean;
  livePersonnelLoaded: boolean;
  injuryDataLoaded: boolean;
  scheduleMatched: boolean;
  neutralSite: boolean;
  notes: string[];
}

export interface ModelScores {
  baseHomeProbability: number;
  finalHomeProbability: number;
  eloHome: number;
  eloAway: number;
  footballLogitAdjustment: number;
  venueLogitAdjustment: number;
  personnelLogitAdjustment: number;
  numerologyLogitAdjustment: number;
  restLogitAdjustment: number;
  h2hLogitAdjustment: number;
}

export interface PredictionResult {
  winner: Team;
  loser: Team;
  confidence: number;
  reasoning: string;
  winnerStats: DisplayNumbers;
  loserStats: DisplayNumbers;
  winnerBreakdown: Breakdown[];
  loserBreakdown: Breakdown[];
  winnerDE: string;
  loserDE: string;
  winnerDay: string;
  loserDay: string;
  winnerDEStats?: PatternStats;
  loserDEStats?: PatternStats;
  winnerCoachDE?: string;
  loserCoachDE?: string;
  winnerCoachDEStats?: PatternStats;
  loserCoachDEStats?: PatternStats;
  winnerQbDE?: string;
  loserQbDE?: string;
  winnerQbDEStats?: PatternStats;
  loserQbDEStats?: PatternStats;
  winnerDayStats?: PatternStats;
  loserDayStats?: PatternStats;
  winnerComboWins?: number;
  loserComboWins?: number;
  winnerTotalPatternWins?: number;
  winnerTotalPatternLosses?: number;
  winnerTotalPatternPct?: number;
  loserTotalPatternWins?: number;
  loserTotalPatternLosses?: number;
  loserTotalPatternPct?: number;
  winnerOwnerDE?: string;
  loserOwnerDE?: string;
  winnerOwnerDEStats?: PatternStats;
  loserOwnerDEStats?: PatternStats;
  isChaosDay?: boolean;
  chaosType?: string;
  chaosWarning?: string;
  isWinnerHome?: boolean;
  historicalSeries?: {
    venueStreak?: string;
    allTimeRecord?: string;
    streakYears?: number;
    lastRoadWinDate?: string;
    narrativeNotes?: string;
    meetings?: number;
    homeWins?: number;
    awayWins?: number;
    ties?: number;
    recencyWeightedHomePct?: number;
  };
  decisionFactors: DecisionFactor[];
  precedentGames: HistoricalGame[];
  modelScores?: ModelScores;
  dataFreshness?: DataFreshness;
  homePersonnel?: PersonnelSnapshot;
  awayPersonnel?: PersonnelSnapshot;
  warnings?: string[];
  modelVersion?: string;
}
