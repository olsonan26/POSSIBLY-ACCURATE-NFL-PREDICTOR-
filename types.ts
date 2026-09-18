export interface Person {
  name: string;
  birthday: Date;
}

export interface Team {
  name: string;
  birthday: Date;
  coach: Person;
  qb: Person;
  owner: Person;
  blindsideTackle: Person;
}

export type Role = 'Team' | 'Coach' | 'Owner' | 'Qb' | 'Blindside Tackle';

// Simplified for top-level display card
export interface DisplayNumbers {
  yearEssence: number;
  personalYear: number;
  personalMonth: number;
  personalMonthEssence: number;
  dailyEssence: number;
}

// The full set of calculated patterns as strings from the user's formulas
export interface NumerologyPatterns {
  yrPersonalEss: string;
  py: string;
  pm: string;
  pme: string;
  monCombiner: string;
  yearCom: string;
  dayNum: string;
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

export interface Breakdown {
  role: Role;
  name: string;
  patterns: NumerologyPatterns;
  evalResult?: EvalResult;
  deStats?: PatternStats;
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
}

export interface PatternStats {
  pattern: string;
  wins: number;
  losses: number;
  total: number;
  winPct: number;
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
  // Calculated Pattern Analytics
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
  };
  decisionFactors: DecisionFactor[];
  precedentGames: HistoricalGame[];
}
