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
  category?: 'football' | 'personnel' | 'venue' | 'numerology' | 'data' | 'astrology' | 'epa' | 'weather' | 'travel' | 'divisional' | 'hfa' | 'prior' | 'pace' | 'special-teams' | 'turnover';
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
  // EXP-025 fields are optional so legacy/control model builders remain valid.
  epaLogitAdjustment?: number;
  weatherLogitAdjustment?: number;
  travelLogitAdjustment?: number;
  dynamicHfaLogitAdjustment?: number;
  divisionalLogitAdjustment?: number;
  preseasonPriorLogitAdjustment?: number;
  paceLogitAdjustment?: number;
  specialTeamsLogitAdjustment?: number;
  turnoverExpectationLogitAdjustment?: number;
}

export interface PureAstrologyResult {
  status: 'available' | 'limited' | 'unavailable' | 'source_incomplete';
  methodVersion: string;
  decisionStatus: 'decisive' | 'lean' | 'unresolved';
  winnerAbbr?: string;
  winnerName?: string;
  pickStabilityPct?: number;
  sourceSafe: boolean;
  coverage: {
    homeRoles: number;
    awayRoles: number;
    kickoffExact: boolean;
    venueExact: boolean;
    unknownTimeRoles: number;
    omittedTimeSensitiveClaims: number;
  };
  rationale: string[];
  warnings: string[];
}

export interface MatchupResolver {
  footballWinnerAbbr: string;
  pureWinnerAbbr?: string;
  agreement: 'agree' | 'conflict' | 'pure-unresolved' | 'pure-unavailable';
  combinedExperimentalWinnerAbbr?: string;
  combinedReason: string;
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
  pureAstrology?: PureAstrologyResult;
  matchupResolver?: MatchupResolver;
  warnings?: string[];
  modelVersion?: string;
  accuracyFeatures?: AccuracyFeatures;
  marketAware?: {
    shadowHomeProbability: number;
    marketHomeProbability: number;
    blendedHomeProbability: number;
    lineLabel: string;
  };
}

export interface AccuracyFeatures {
  epa?: {
    homeOffEpaPerPlay: number;
    homeDefEpaPerPlay: number;
    awayOffEpaPerPlay: number;
    awayDefEpaPerPlay: number;
    homeAdjNetEpa: number;
    awayAdjNetEpa: number;
    logitEdge: number;
  };
  weather?: {
    temperatureF: number;
    windSpeedMph: number;
    precipitation: number;
    isDome: boolean;
    logitEdge: number;
  };
  travel?: {
    awayTravelMiles: number;
    awayTzChange: number;
    isShortRest: boolean;
    logitEdge: number;
  };
  dynamicHfa?: {
    eloAdvantage: number;
    teamMultiplier: number;
    logitEdge: number;
  };
  divisional?: {
    isDivisional: boolean;
    divisionalGameNumber: number;
    logitEdge: number;
  };
  preseasonPrior?: {
    homeExpectedWinPct: number;
    awayExpectedWinPct: number;
    priorWeight: number;
    logitEdge: number;
  };
  pace?: {
    homePlaysPerGame: number;
    awayPlaysPerGame: number;
    logitEdge: number;
  };
  specialTeams?: {
    homeTotalStEpa: number;
    awayTotalStEpa: number;
    logitEdge: number;
  };
  turnoverExpectation?: {
    homeExpectedNet: number;
    awayExpectedNet: number;
    logitEdge: number;
  };
  ensemble?: {
    models: Array<{ name: string; homeProbability: number; weight: number }>;
    blendedHomeProbability: number;
  };
}
