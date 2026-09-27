import {
  MatchupResolver,
  Person,
  PersonnelSnapshot,
  PureAstrologyResult,
  Team
} from '../types';

export interface PureAstrologyRequestOptions {
  neutralSite?: boolean;
  gameId?: string;
  gameTime?: string;
  stadium?: string;
  retrospective?: boolean;
}

interface PublicPersonInput {
  role: string;
  name: string;
  birthDate?: string;
  position?: string;
  source?: string;
}

const dateOnly = (date?: Date): string | undefined => {
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
};

function person(role: string, value?: Person): PublicPersonInput | undefined {
  if (!value?.name) return undefined;
  return {
    role,
    name: value.name,
    birthDate: dateOnly(value.birthday),
    position: value.position,
    source: value.source
  };
}

function uniquePeople(values: Array<PublicPersonInput | undefined>): PublicPersonInput[] {
  const seen = new Set<string>();
  return values.filter((value): value is PublicPersonInput => {
    if (!value) return false;
    const key = `${value.role}|${value.name}|${value.birthDate || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function participants(team: Team, snapshot?: PersonnelSnapshot): PublicPersonInput[] {
  const offense = snapshot?.keyOffense || [];
  const defense = snapshot?.keyDefense || [];
  return uniquePeople([
    {
      role: 'Franchise',
      name: team.name,
      birthDate: dateOnly(team.birthday),
      source: 'team registry'
    },
    person('Head Coach', snapshot?.coach || team.coach),
    person('Starting QB', snapshot?.startingQb || team.qb),
    person('Backup QB', snapshot?.backupQb),
    person('Blindside Tackle', snapshot?.blindsideTackle || team.blindsideTackle),
    ...offense.map(value => person(value.position === 'WR' || value.position === 'TE' ? 'Primary Receiver' : 'Key Offense', value)),
    ...defense.map(value => person('Key Defense', value)),
    person('Kicker', snapshot?.kicker),
    person('Owner', team.owner)
  ]);
}

function unavailable(message: string): PureAstrologyResult {
  return {
    status: 'unavailable',
    methodVersion: 'pure-private-unavailable',
    decisionStatus: 'unresolved',
    sourceSafe: true,
    coverage: {
      homeRoles: 0,
      awayRoles: 0,
      kickoffExact: false,
      venueExact: false,
      unknownTimeRoles: 0,
      omittedTimeSensitiveClaims: 0
    },
    rationale: [],
    warnings: [message]
  };
}

export async function getPureAstrologyPrediction(
  homeTeam: Team,
  awayTeam: Team,
  gameDate: Date,
  homePersonnel: PersonnelSnapshot | undefined,
  awayPersonnel: PersonnelSnapshot | undefined,
  options: PureAstrologyRequestOptions = {}
): Promise<PureAstrologyResult> {
  const payload = {
    matchup: {
      homeTeam: homeTeam.abbr,
      awayTeam: awayTeam.abbr,
      gameDate: gameDate.toISOString().slice(0, 10),
      gameId: options.gameId,
      gameTime: options.gameTime,
      stadium: options.stadium,
      neutralSite: Boolean(options.neutralSite),
      retrospective: Boolean(options.retrospective)
    },
    homeParticipants: participants(homeTeam, options.retrospective ? undefined : homePersonnel),
    awayParticipants: participants(awayTeam, options.retrospective ? undefined : awayPersonnel)
  };

  try {
    const response = await fetch('/api/pure-astrology', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      const reason = data?.reason || data?.error || `HTTP ${response.status}`;
      return unavailable(`PURE Astrology private engine unavailable: ${reason}. Football control was unaffected.`);
    }
    return data as PureAstrologyResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return unavailable(`PURE Astrology private engine could not be reached: ${message}. Football control was unaffected.`);
  }
}

export function resolveFootballAndPure(
  footballWinner: Team,
  pure: PureAstrologyResult
): MatchupResolver {
  if (pure.status === 'unavailable') {
    return {
      footballWinnerAbbr: footballWinner.abbr,
      agreement: 'pure-unavailable',
      combinedReason: 'Football control is available; the private PURE Astrology engine was unavailable. No substitute or generic astrology was used.'
    };
  }

  if (!pure.winnerAbbr || pure.decisionStatus === 'unresolved') {
    return {
      footballWinnerAbbr: footballWinner.abbr,
      agreement: 'pure-unresolved',
      combinedReason: 'PURE Astrology did not support a source-safe directional winner for this matchup. The system preserves the unresolved state instead of inventing a pick.'
    };
  }

  if (pure.winnerAbbr === footballWinner.abbr) {
    return {
      footballWinnerAbbr: footballWinner.abbr,
      pureWinnerAbbr: pure.winnerAbbr,
      agreement: 'agree',
      combinedExperimentalWinnerAbbr: footballWinner.abbr,
      combinedReason: 'Football control and the independent PURE Astrology analysis agree on the same team.'
    };
  }

  return {
    footballWinnerAbbr: footballWinner.abbr,
    pureWinnerAbbr: pure.winnerAbbr,
    agreement: 'conflict',
    combinedExperimentalWinnerAbbr: pure.sourceSafe && pure.decisionStatus === 'decisive'
      ? pure.winnerAbbr
      : undefined,
    combinedReason: pure.sourceSafe && pure.decisionStatus === 'decisive'
      ? 'Football and PURE Astrology conflict. The experimental resolver preserves the football control separately and records the source-safe decisive PURE call as the experimental combined pick; no arbitrary percentage blend is applied.'
      : 'Football and PURE Astrology conflict. PURE is not decisive enough to override the control, so the combined state remains no-edge rather than forcing a blended winner.'
  };
}
