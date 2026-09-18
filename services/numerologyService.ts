import { Team, Person, PredictionResult, Role, Breakdown, NumerologyPatterns, DisplayNumbers, EvalResult, EvalCounts, DecisionFactor, PatternStats, HistoricalGame } from '../types';
import { winningPatternsCSV } from '../data/winning_patterns';
import { losingPatternsCSV } from '../data/losing_patterns';
import { getDEPatternStats, getDayPatternStats, getComboWins, findPrecedents, OFFICIAL_WINNING_DE_STATS, OFFICIAL_WINNING_DAY_STATS, HISTORICAL_GAMES } from '../data/historicalGames';

const TEAM_BIRTHDAY_DATA = `Team,Team Bday,Coach,Coach Bday,QB,QB Bday,Owner,Owner Bday,Blindside Tackle,Blindside Tackle Bday
Arizona Cardinals,1/17/1917,Jonathan Gannon,1/4/1983,Kyler Murray,8/7/1997,Michael Bidwill,4/22/1964,Paris Johnson Jr.,7/3/2001
Atlanta Falcons,6/30/1965,Raheem Morris,9/3/1976,Michael Penix Jr.,5/8/2000,Arthur Blank,9/27/1942,Jake Matthews,2/11/1992
Baltimore Ravens,2/9/1996,John Harbaugh,9/23/1962,Lamar Jackson,1/7/1997,Steve Bisciotti,4/10/1960,Ronnie Stanley,3/18/1994
Buffalo Bills,10/28/1959,Sean McDermott,3/21/1974,Josh Allen,5/21/1996,Terry Pegula,3/27/1951,Dion Dawkins,4/26/1994
Carolina Panthers,10/26/1993,Dave Canales,5/7/1981,Bryce Young,7/25/2001,David Tepper,9/11/1957,Ikem Ekwonu,10/31/2000
Chicago Bears,9/17/1920,Matt Eberflus,5/17/1970,Caleb Williams,11/18/2001,George McCaskey,3/29/1956,Braxton Jones,3/27/1999
Cincinnati Bengals,5/23/1967,Zac Taylor,5/10/1983,Joe Burrow,12/10/1996,Mike Brown,8/10/1935,Orlando Brown Jr.,5/2/1996
Cleveland Browns,6/4/1944,Kevin Stefanski,5/8/1982,Deshaun Watson,9/14/1995,Jimmy Haslam,3/9/1954,Jedrick Wills Jr.,5/17/1999
Dallas Cowboys,1/28/1960,Mike McCarthy,11/10/1963,Dak Prescott,7/29/1993,Jerry Jones,10/13/1942,Tyler Smith,4/3/2001
Denver Broncos,8/14/1959,Sean Payton,12/29/1963,Bo Nix,2/25/2000,Rob Walton,10/27/1944,Garett Bolles,5/27/1992
Detroit Lions,7/12/1930,Dan Campbell,4/13/1976,Jared Goff,10/14/1994,Sheila Ford Hamp,10/31/1951,Taylor Decker,8/23/1993
Green Bay Packers,8/11/1919,Matt LaFleur,11/3/1979,Jordan Love,11/2/1998,Mark Murphy,7/13/1955,Rasheed Walker,2/13/2000
Houston Texans,10/6/1999,DeMeco Ryans,7/28/1984,C.J. Stroud,10/3/2001,Cal McNair,10/24/1961,Laremy Tunsil,8/2/1994
Indianapolis Colts,1/23/1953,Shane Steichen,5/11/1985,Anthony Richardson,5/22/2002,Jim Irsay,7/13/1959,Bernhard Raimann,9/23/1997
Jacksonville Jaguars,11/30/1993,Doug Pederson,1/31/1968,Trevor Lawrence,10/6/1999,Shahid Khan,7/18/1950,Cam Robinson,10/9/1995
Kansas City Chiefs,8/14/1959,Andy Reid,3/19/1958,Patrick Mahomes,9/17/1995,Clark Hunt,2/19/1965,Wanya Morris,10/10/2000
Las Vegas Raiders,1/30/1960,Antonio Pierce,10/26/1978,Gardner Minshew,5/16/1996,Mark Davis,5/18/1955,Kolton Miller,10/9/1995
Los Angeles Chargers,8/14/1959,Jim Harbaugh,12/23/1963,Justin Herbert,3/10/1998,Dean Spanos,5/26/1950,Rashawn Slater,3/18/1999
Los Angeles Rams,2/12/1937,Sean McVay,1/24/1986,Matthew Stafford,2/7/1988,Stan Kroenke,7/29/1947,Alaric Jackson,7/14/1998
Miami Dolphins,8/16/1965,Mike McDaniel,3/6/1983,Tua Tagovailoa,3/2/1998,Stephen Ross,5/10/1940,Terron Armstead,7/23/1991
Minnesota Vikings,1/28/1960,Kevin O'Connell,5/25/1985,J.J. McCarthy,1/20/2003,Zygi Wilf,4/22/1950,Christian Darrisaw,6/2/1999
New England Patriots,11/22/1959,Jerod Mayo,2/23/1986,Drake Maye,8/30/2002,Robert Kraft,6/5/1941,Chukwuma Okorafor,8/8/1997
New Orleans Saints,11/1/1966,Dennis Allen,9/22/1972,Derek Carr,3/28/1991,Gayle Benson,1/26/1947,Taliese Fuaga,4/2/2002
New York Giants,8/1/1925,Brian Daboll,4/14/1975,Daniel Jones,5/27/1997,John Mara,12/1/1954,Andrew Thomas,1/22/1999
New York Jets,8/14/1959,Robert Saleh,1/31/1979,Aaron Rodgers,12/2/1983,Woody Johnson,4/12/1947,Tyron Smith,12/12/1990
Philadelphia Eagles,7/8/1933,Nick Sirianni,6/15/1981,Jalen Hurts,8/7/1998,Jeffrey Lurie,9/8/1951,Jordan Mailata,3/31/1997
Pittsburgh Steelers,7/8/1933,Mike Tomlin,3/15/1972,Russell Wilson,11/29/1988,Art Rooney II,9/14/1952,Broderick Jones,5/16/2001
San Francisco 49ers,3/28/1946,Kyle Shanahan,12/14/1979,Brock Purdy,12/27/1999,Jed York,1/9/1981,Trent Williams,7/19/1988
Seattle Seahawks,6/15/1972,Mike Macdonald,6/26/1987,Geno Smith,10/10/1990,Jody Allen,2/3/1959,Charles Cross,11/25/2000
Tampa Bay Buccaneers,4/24/1974,Todd Bowles,11/18/1963,Baker Mayfield,4/14/1995,Glazer family,1/1/1970,Tristan Wirfs,1/24/1999
Tennessee Titans,8/3/1959,Brian Callahan,6/10/1984,Will Levis,6/27/1999,Amy Adams Strunk,9/29/1955,JC Latham,2/8/2003
Washington Commanders,7/9/1932,Dan Quinn,9/11/1970,Jayden Daniels,12/18/2000,Josh Harris,12/4/1964,Cornelius Lucas,7/18/1991`;

function parseDate(dateStr: string): Date {
  if (isNaN(new Date(dateStr).getTime())) {
    return new Date('1970-01-01');
  }
  return new Date(dateStr);
}

/* ===== Core math (ported from user's code) ===== */
const getLetterValue = (t: string): number => {
    const letter = String(t || '').toUpperCase();
    const valueMap: { [key: string]: number } = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9, J: 1, K: 2, L: 3, M: 4, N: 5, O: 6, P: 7, Q: 8, R: 9, S: 1, T: 2, U: 3, V: 4, W: 5, X: 6, Y: 7, Z: 8 };
    return valueMap[letter] || 0;
};

const reduceSequence = (n: number): string => {
    const sequence: number[] = [n];
    let current = n;
    while (current > 9) {
        current = String(current).split('').reduce((acc, digit) => acc + parseInt(digit, 10), 0);
        sequence.push(current);
    }
    return sequence.join('/');
};

const reduceToSingleDigit = (n: number): number => {
    if (n === 0) return 9;
    let sum = Math.abs(n);
    while (sum > 9) {
        sum = String(sum).split('').reduce((acc, digit) => acc + parseInt(digit, 10), 0);
    }
    return sum;
};

const getCycleString = (name: string): string => {
    return String(name || '').toUpperCase().replace(/[^A-Z]/g, '').split('').map(char => {
        const lv = getLetterValue(char);
        return char.repeat(lv);
    }).join('');
};

const calculateEssence = (name: string, index: number): { e: number, raw: number } => {
    let total = 0;
    const parts = String(name || '').split(/\s+/).filter(Boolean);
    for (const part of parts) {
        const cycle = getCycleString(part);
        if (!cycle) continue;
        const char = cycle[(index - 1) % cycle.length];
        total += getLetterValue(char);
    }
    return { e: reduceToSingleDigit(total), raw: total };
};

const calculateAge = (targetDate: { y: number; m: number; d: number; }, birthDate: { y: number; m: number; d: number; }): number => {
    let age = targetDate.y - birthDate.y;
    if (targetDate.m < birthDate.m || (targetDate.m === birthDate.m && targetDate.d < birthDate.d)) {
        age--;
    }
    return age;
};

const calculatePersonalYear = (birthDay: number, birthMonth: number, gameYear: number): number => {
    const result = (birthDay + birthMonth + gameYear) % 9;
    return result === 0 ? 9 : result;
};

const calculateAllPatterns = (name: string, birthday: Date, gameDate: Date): NumerologyPatterns => {
    const gameMonth = gameDate.getUTCMonth() + 1;
    const gameDay = gameDate.getUTCDate();
    const seasonYear = gameDate.getUTCFullYear();

    const birthMonth = birthday.getUTCMonth() + 1;
    const birthDay = birthday.getUTCDate();
    const birthYear = birthday.getUTCFullYear();

    const yrIdx = calculateAge(
        { y: seasonYear, m: gameMonth, d: gameDay },
        { y: birthYear, m: birthMonth, d: birthDay }
    );

    const essence = calculateEssence(name, yrIdx);
    
    const pyRaw = birthDay + birthMonth + seasonYear;
    const personalYearNum = calculatePersonalYear(birthDay, birthMonth, seasonYear);

    const pmRaw = personalYearNum + gameMonth;
    const personalMonthNum = reduceToSingleDigit(pmRaw);

    const pmeRaw = essence.e + personalMonthNum;
    
    const mcomRaw = reduceToSingleDigit(pmeRaw) + personalMonthNum;
    
    const combRaw = essence.e + personalYearNum;
    
    const dailyEssenceRaw = personalMonthNum + gameDay + essence.e;

    return {
        yrPersonalEss: reduceSequence(essence.raw),
        py: reduceSequence(pyRaw),
        pm: reduceSequence(pmRaw),
        pme: reduceSequence(pmeRaw),
        monCombiner: reduceSequence(mcomRaw),
        yearCom: reduceSequence(combRaw),
        dayNum: reduceSequence(gameDay),
        dailyEssenceFull: reduceSequence(dailyEssenceRaw)
    };
};

// ---------- Start: User-provided pattern matching logic ----------

// CardPattern represents the 8 key values for a person on a given day.
type CardPattern = {
    yrESS: string;
    py: string;
    pm: string;
    pme: string;
    monCombiner: string;
    yearCOM: string;
    dayNum: string;
    dailyEss: string;
};

function parseCSV(text: string): Record<string, string>[] {
    const lines = text.trim().split(/\r?\n/);
    const headers = lines[0].split(",").map(h => h.trim());
    return lines.slice(1).map(line => {
        const cells = line.split(",");
        const row: Record<string, string> = {};
        headers.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
        return row;
    });
}

function norm(v: string) {
    if (!v) return "";
    const trimmed = String(v).trim().replace(/^20\d\d\//, '');
    if (trimmed.includes('/')) {
        const parts = trimmed.split('/');
        if (parts.length === 3 && parts[1].length <= 2) {
            return `${parts[1]}/${parts[2]}`; // e.g. 28/10/1 -> 10/1
        }
        if (parseInt(parts[0], 10) > 18) {
            return parts[parts.length - 1]; // e.g. 27/9 -> 9
        }
        return trimmed;
    }
    return trimmed;
}

// Key builders (must keep field order)
function key8_fromCard(p: CardPattern) {
    return [norm(p.yrESS), norm(p.py), norm(p.pm), norm(p.pme), norm(p.monCombiner), norm(p.yearCOM), norm(p.dayNum), norm(p.dailyEss)].join("|");
}

function key8_fromWinningRow(r: Record<string, string>) {
    return [norm(r["Yr Personal ESS"]), norm(r["PY"]), norm(r["WINNING PM"]), norm(r["WINNING PME"]), norm(r["WINNING MonCombiner"]), norm(r["WINNING YearCOM"]), norm(r["WINNING Day Number"]), norm(r["WINNING Daily Essence"])].join("|");
}

function key8_fromLosingRow(r: Record<string, string>) {
    return [norm(r["LOSING TEAM Yr Personal ESS"]), norm(r["PY"]), norm(r["PM"]), norm(r["PME"]), norm(r["MonCombiner"]), norm(r["YearCOM"]), norm(r["Day Number"]), norm(r["Daily Essence"])].join("|");
}

function key5_fromCard(p: CardPattern) {
    return [norm(p.py), norm(p.pme), norm(p.dayNum), norm(p.dailyEss), norm(p.yearCOM)].join("|");
}

function key5_fromWinningRow(r: Record<string, string>) {
    return [norm(r["PY"]), norm(r["WINNING PME"]), norm(r["WINNING Day Number"]), norm(r["WINNING Daily Essence"]), norm(r["WINNING YearCOM"])].join("|");
}

function key5_fromLosingRow(r: Record<string, string>) {
    return [norm(r["PY"]), norm(r["PME"]), norm(r["Day Number"]), norm(r["Daily Essence"]), norm(r["YearCOM"])].join("|");
}

function buildLookups(winningCSV: string, losingCSV: string) {
    const wRows = parseCSV(winningCSV);
    const lRows = parseCSV(losingCSV);
    const W8 = new Map<string, number>();
    const L8 = new Map<string, number>();
    const W5 = new Map<string, number>();
    const L5 = new Map<string, number>();

    for (const r of wRows) {
        const k8 = key8_fromWinningRow(r);
        const k5 = key5_fromWinningRow(r);
        W8.set(k8, (W8.get(k8) ?? 0) + 1);
        W5.set(k5, (W5.get(k5) ?? 0) + 1);
    }
    for (const r of lRows) {
        const k8 = key8_fromLosingRow(r);
        const k5 = key5_fromLosingRow(r);
        L8.set(k8, (L8.get(k8) ?? 0) + 1);
        L5.set(k5, (L5.get(k5) ?? 0) + 1);
    }
    return { W8, L8, W5, L5 };
}

function evaluatePattern(card: CardPattern, lookups: ReturnType<typeof buildLookups>): EvalResult {
    const k8 = key8_fromCard(card);
    const k5 = key5_fromCard(card);
    const wins8 = lookups.W8.get(k8) ?? 0;
    const losses8 = lookups.L8.get(k8) ?? 0;
    const wins5 = lookups.W5.get(k5) ?? 0;
    const losses5 = lookups.L5.get(k5) ?? 0;
    return {
        exact: { wins: wins8, losses: losses8, net: wins8 - losses8 },
        subset: { wins: wins5, losses: losses5, net: wins5 - losses5 },
    };
}

type SideScore = { label: string; eval: EvalResult };
function pickWinnerByPatterns(a: SideScore, b: SideScore): { winnerLabel: string, reason: string } {
    if (a.eval.exact.net !== b.eval.exact.net) {
        const winner = a.eval.exact.net > b.eval.exact.net ? a : b;
        return { winnerLabel: winner.label, reason: `a stronger combined Exact-8 pattern score (${winner.eval.exact.net} vs ${winner === a ? b.eval.exact.net : a.eval.exact.net})` };
    }
    if (a.eval.exact.wins !== b.eval.exact.wins) {
        const winner = a.eval.exact.wins > b.eval.exact.wins ? a : b;
        return { winnerLabel: winner.label, reason: `more wins on a tied Exact-8 pattern` };
    }
    if (a.eval.subset.net !== b.eval.subset.net) {
        const winner = a.eval.subset.net > b.eval.subset.net ? a : b;
        return { winnerLabel: winner.label, reason: `a stronger combined Subset-5 pattern score (${winner.eval.subset.net} vs ${winner === a ? b.eval.subset.net : a.eval.subset.net})` };
    }
    if (a.eval.subset.wins !== b.eval.subset.wins) {
        const winner = a.eval.subset.wins > b.eval.subset.wins ? a : b;
        return { winnerLabel: winner.label, reason: `more wins on a tied Subset-5 pattern` };
    }
    return { winnerLabel: a.label, reason: "insufficient historical data to separate them, defaulting to the home team" }; // Default case
}
// ---------- End: User-provided pattern matching logic ----------

let lookups: ReturnType<typeof buildLookups> | null = null;
const getLookups = () => {
    if (!lookups) {
        lookups = buildLookups(winningPatternsCSV, losingPatternsCSV);
    }
    return lookups;
};

// Helper to map our internal pattern type to the user's evaluation pattern type
const toCardPattern = (patterns: NumerologyPatterns): CardPattern => ({
    yrESS: patterns.yrPersonalEss,
    py: patterns.py,
    pm: patterns.pm,
    pme: patterns.pme,
    monCombiner: patterns.monCombiner,
    yearCOM: patterns.yearCom,
    dayNum: patterns.dayNum,
    dailyEss: patterns.dailyEssenceFull,
});

export const parseTeamData = (): Team[] => {
    const rows = TEAM_BIRTHDAY_DATA.trim().split('\n');
    rows.shift(); // Remove header

    return rows.map(row => {
        const values = row.split(',');
        return {
            name: values[0],
            birthday: parseDate(values[1]),
            coach: { name: values[2], birthday: parseDate(values[3]) },
            qb: { name: values[4], birthday: parseDate(values[5]) },
            owner: { name: values[6], birthday: parseDate(values[7]) },
            blindsideTackle: { name: values[8], birthday: parseDate(values[9]) }
        };
    });
};

export const predictWinner = (teamA: Team, teamB: Team, gameDateInput: Date | string, isTeamAHome: boolean = true): PredictionResult => {
    const gameDate = typeof gameDateInput === 'string'
        ? (gameDateInput.includes('T') ? new Date(gameDateInput) : new Date(`${gameDateInput}T00:00:00Z`))
        : gameDateInput;
    const historicalLookups = getLookups();
    
    const teamABreakdown: Breakdown[] = [];
    const teamBBreakdown: Breakdown[] = [];

    const rolesToCalculate: Role[] = ['Team', 'Coach', 'Owner', 'Qb', 'Blindside Tackle'];
    
    // Calculate patterns for all roles for UI breakdown
    for(const role of rolesToCalculate) {
        const entityA = role === 'Team' ? teamA : teamA[role.charAt(0).toLowerCase() + role.slice(1) as keyof Omit<Team, 'name' | 'birthday'>];
        const entityB = role === 'Team' ? teamB : teamB[role.charAt(0).toLowerCase() + role.slice(1) as keyof Omit<Team, 'name' | 'birthday'>];
        
        if (entityA && 'name' in entityA) {
            const patterns = calculateAllPatterns(entityA.name, entityA.birthday, gameDate);
            const evalResult = evaluatePattern(toCardPattern(patterns), historicalLookups);
            const deStats = getDEPatternStats(patterns.dailyEssenceFull);
            teamABreakdown.push({ role, name: entityA.name, patterns, evalResult, deStats });
        }
        if (entityB && 'name' in entityB) {
            const patterns = calculateAllPatterns(entityB.name, entityB.birthday, gameDate);
            const evalResult = evaluatePattern(toCardPattern(patterns), historicalLookups);
            const deStats = getDEPatternStats(patterns.dailyEssenceFull);
            teamBBreakdown.push({ role, name: entityB.name, patterns, evalResult, deStats });
        }
    }

    const teamA_Team = teamABreakdown.find(b => b.role === 'Team')!;
    const teamA_Coach = teamABreakdown.find(b => b.role === 'Coach')!;
    const teamA_QB = teamABreakdown.find(b => b.role === 'Qb');
    const teamA_Owner = teamABreakdown.find(b => b.role === 'Owner');

    const teamB_Team = teamBBreakdown.find(b => b.role === 'Team')!;
    const teamB_Coach = teamBBreakdown.find(b => b.role === 'Coach')!;
    const teamB_QB = teamBBreakdown.find(b => b.role === 'Qb');
    const teamB_Owner = teamBBreakdown.find(b => b.role === 'Owner');

    // Extract core game patterns (Daily Essence and Day Number)
    const teamA_DE = teamA_Team.patterns.dailyEssenceFull;
    const teamA_Day = teamA_Team.patterns.dayNum;
    const teamB_DE = teamB_Team.patterns.dailyEssenceFull;
    const teamB_Day = teamB_Team.patterns.dayNum;

    // Retrieve historical statistics for both teams' patterns from 1,365 game database
    const teamA_DEStats = getDEPatternStats(teamA_DE);
    const teamB_DEStats = getDEPatternStats(teamB_DE);
    const teamA_DayStats = getDayPatternStats(teamA_Day);
    const teamB_DayStats = getDayPatternStats(teamB_Day);
    const teamA_ComboWins = getComboWins(teamA_DE, teamA_Day);
    const teamB_ComboWins = getComboWins(teamB_DE, teamB_Day);

    // Coach specific Daily Essence statistics
    const teamA_CoachDE = teamA_Coach.patterns.dailyEssenceFull;
    const teamB_CoachDE = teamB_Coach.patterns.dailyEssenceFull;
    const teamA_CoachDEStats = getDEPatternStats(teamA_CoachDE);
    const teamB_CoachDEStats = getDEPatternStats(teamB_CoachDE);

    // QB specific Daily Essence statistics
    const teamA_QbDE = teamA_QB?.patterns.dailyEssenceFull || '';
    const teamB_QbDE = teamB_QB?.patterns.dailyEssenceFull || '';
    const teamA_QbDEStats = teamA_QbDE ? getDEPatternStats(teamA_QbDE) : undefined;
    const teamB_QbDEStats = teamB_QbDE ? getDEPatternStats(teamB_QbDE) : undefined;

    // Owner specific Daily Essence statistics (Top of the Organizational Pyramid)
    const teamA_OwnerDE = teamA_Owner?.patterns.dailyEssenceFull || '';
    const teamB_OwnerDE = teamB_Owner?.patterns.dailyEssenceFull || '';
    const teamA_OwnerDEStats = teamA_OwnerDE ? getDEPatternStats(teamA_OwnerDE) : undefined;
    const teamB_OwnerDEStats = teamB_OwnerDE ? getDEPatternStats(teamB_OwnerDE) : undefined;

    // Detect Chaos / Script / Upset Day Dynamics (Vibration 4, 13/4, 7, 16/7, 22/4)
    const gameCalDay = gameDate.getUTCDate();
    const gameCalMonth = gameDate.getUTCMonth() + 1;
    const gameCalYear = gameDate.getUTCFullYear();
    const universalDayNum = reduceToSingleDigit(gameCalDay + gameCalMonth + gameCalYear);
    const isChaosVibration = [4, 7].includes(universalDayNum) || 
                             ['4', '13/4', '7', '16/7', '22/4'].includes(teamA_Day) || 
                             ['4', '13/4', '7', '16/7', '22/4'].includes(teamB_Day);

    const isChaosDay = isChaosVibration;
    const chaosType = universalDayNum === 4 || ['4', '13/4', '22/4'].includes(teamA_Day)
        ? 'Vibration 4 (Uranus / Chaos / Script Inversion)'
        : 'Vibration 7 (Neptune / Illusion / Karmic Reversal)';
    const chaosWarning = isChaosDay
        ? `This game falls under a high-volatility ${chaosType} cycle. In sports numerology and scripted narrative theory, 4 and 7 vibrations frequently trigger inverted outcomes, bizarre penalties, unexpected fumbles, and heavy-favorite upsets.`
        : undefined;

    // Aggregate Pattern Numbers Total Wins and Losses across the historical dataset
    const teamA_TotalPatternWins = teamA_DEStats.wins + teamA_CoachDEStats.wins + (teamA_QbDEStats?.wins || 0) + (teamA_OwnerDEStats?.wins || 0) + teamA_DayStats.wins + teamA_ComboWins;
    const teamA_TotalPatternLosses = teamA_DEStats.losses + teamA_CoachDEStats.losses + (teamA_QbDEStats?.losses || 0) + (teamA_OwnerDEStats?.losses || 0) + teamA_DayStats.losses;
    const teamA_TotalPatternPct = (teamA_TotalPatternWins + teamA_TotalPatternLosses) > 0 
        ? Math.round((teamA_TotalPatternWins / (teamA_TotalPatternWins + teamA_TotalPatternLosses)) * 1000) / 10 
        : 50.0;

    const teamB_TotalPatternWins = teamB_DEStats.wins + teamB_CoachDEStats.wins + (teamB_QbDEStats?.wins || 0) + (teamB_OwnerDEStats?.wins || 0) + teamB_DayStats.wins + teamB_ComboWins;
    const teamB_TotalPatternLosses = teamB_DEStats.losses + teamB_CoachDEStats.losses + (teamB_QbDEStats?.losses || 0) + (teamB_OwnerDEStats?.losses || 0) + teamB_DayStats.losses;
    const teamB_TotalPatternPct = (teamB_TotalPatternWins + teamB_TotalPatternLosses) > 0 
        ? Math.round((teamB_TotalPatternWins / (teamB_TotalPatternWins + teamB_TotalPatternLosses)) * 1000) / 10 
        : 50.0;

    // Precedent historical games
    const precedentGames = findPrecedents(teamA_DE, teamA_Day, teamB_DE, teamB_Day, teamA.name, teamB.name);

    // Combine Team + Coach + QB + Owner evaluations
    const teamAExactNet = (teamA_Team.evalResult?.exact.net || 0) + 
                          (teamA_Coach.evalResult?.exact.net || 0) + 
                          ((teamA_QB?.evalResult?.exact.net || 0) * 0.5) +
                          ((teamA_Owner?.evalResult?.exact.net || 0) * 0.4);
    const teamASubsetNet = (teamA_Team.evalResult?.subset.net || 0) + 
                           (teamA_Coach.evalResult?.subset.net || 0) + 
                           ((teamA_QB?.evalResult?.subset.net || 0) * 0.5) +
                           ((teamA_Owner?.evalResult?.subset.net || 0) * 0.4);

    const teamBExactNet = (teamB_Team.evalResult?.exact.net || 0) + 
                          (teamB_Coach.evalResult?.exact.net || 0) + 
                          ((teamB_QB?.evalResult?.exact.net || 0) * 0.5) +
                          ((teamB_Owner?.evalResult?.exact.net || 0) * 0.4);
    const teamBSubsetNet = (teamB_Team.evalResult?.subset.net || 0) + 
                           (teamB_Coach.evalResult?.subset.net || 0) + 
                           ((teamB_QB?.evalResult?.subset.net || 0) * 0.5) +
                           ((teamB_Owner?.evalResult?.subset.net || 0) * 0.4);

    // Compute multi-factor decision scores
    let teamAScore = 0;
    let teamBScore = 0;

    // Home Field Grounding Advantage (Team A is Home)
    if (isTeamAHome) {
        teamAScore += 8; // Traditional stadium vibrational grounding
    }

    // Factor 1: Team Daily Essence Historical Win Rate & Total Record
    const deDiff = teamA_DEStats.winPct - teamB_DEStats.winPct;
    if (deDiff > 1) {
        teamAScore += 25 + (deDiff * 0.8);
    } else if (deDiff < -1) {
        teamBScore += 25 + (Math.abs(deDiff) * 0.8);
    } else {
        if (teamA_DEStats.wins > teamB_DEStats.wins) teamAScore += 10;
        else if (teamB_DEStats.wins > teamA_DEStats.wins) teamBScore += 10;
    }

    // Factor 2: Head Coach Daily Essence Dominance
    const coachDEDiff = teamA_CoachDEStats.winPct - teamB_CoachDEStats.winPct;
    if (coachDEDiff > 1) {
        teamAScore += 25 + (coachDEDiff * 0.8);
    } else if (coachDEDiff < -1) {
        teamBScore += 25 + (Math.abs(coachDEDiff) * 0.8);
    } else {
        if (teamA_CoachDEStats.wins > teamB_CoachDEStats.wins) teamAScore += 8;
        else if (teamB_CoachDEStats.wins > teamA_CoachDEStats.wins) teamBScore += 8;
    }

    // Factor 3: Starting QB Daily Essence Alignment
    if (teamA_QbDEStats && teamB_QbDEStats) {
        const qbDEDiff = teamA_QbDEStats.winPct - teamB_QbDEStats.winPct;
        if (qbDEDiff > 1) {
            teamAScore += 20 + (qbDEDiff * 0.7);
        } else if (qbDEDiff < -1) {
            teamBScore += 20 + (Math.abs(qbDEDiff) * 0.7);
        } else {
            if (teamA_QbDEStats.wins > teamB_QbDEStats.wins) teamAScore += 8;
            else if (teamB_QbDEStats.wins > teamA_QbDEStats.wins) teamBScore += 8;
        }
    }

    // Factor 3b: Franchise Owner Daily Essence Alignment (Organizational Power)
    if (teamA_OwnerDEStats && teamB_OwnerDEStats) {
        const ownerDEDiff = teamA_OwnerDEStats.winPct - teamB_OwnerDEStats.winPct;
        if (ownerDEDiff > 1) {
            teamAScore += 12 + (ownerDEDiff * 0.5);
        } else if (ownerDEDiff < -1) {
            teamBScore += 12 + (Math.abs(ownerDEDiff) * 0.5);
        }
    }

    // Factor 4: Game Day Number Alignment
    const dayDiff = teamA_DayStats.winPct - teamB_DayStats.winPct;
    if (dayDiff > 2) {
        teamAScore += 15 + (dayDiff * 0.4);
    } else if (dayDiff < -2) {
        teamBScore += 15 + (Math.abs(dayDiff) * 0.4);
    } else {
        if (teamA_DayStats.wins > teamB_DayStats.wins) teamAScore += 8;
        else if (teamB_DayStats.wins > teamA_DayStats.wins) teamBScore += 8;
    }

    // Factor 5: DE | Day Winning Combination Frequency
    const comboDiff = teamA_ComboWins - teamB_ComboWins;
    if (comboDiff > 0) {
        teamAScore += 15 + (comboDiff * 2);
    } else if (comboDiff < 0) {
        teamBScore += 15 + (Math.abs(comboDiff) * 2);
    }

    // Factor 6: Personnel Exact-8 & Subset-5 Pattern Net Scores
    const exactDiff = teamAExactNet - teamBExactNet;
    const subsetDiff = teamASubsetNet - teamBSubsetNet;
    if (exactDiff > 0 || (exactDiff === 0 && subsetDiff > 0)) {
        const netEdge = (exactDiff * 12) + (subsetDiff * 4);
        teamAScore += Math.max(netEdge, 10);
    } else if (exactDiff < 0 || (exactDiff === 0 && subsetDiff < 0)) {
        const netEdge = (Math.abs(exactDiff) * 12) + (Math.abs(subsetDiff) * 4);
        teamBScore += Math.max(netEdge, 10);
    }

    // Factor 7: Precedent Historical Games Trend (Modest, balanced weighting)
    let precedentTeamAWins = 0;
    let precedentTeamBWins = 0;
    for (const g of precedentGames) {
        if (g.winnerTeam === teamA.name) precedentTeamAWins++;
        else if (g.winnerTeam === teamB.name) precedentTeamBWins++;
        else if (g.winnerDE === teamA_DE) precedentTeamAWins += 0.5;
        else if (g.winnerDE === teamB_DE) precedentTeamBWins += 0.5;
    }
    if (precedentTeamAWins > precedentTeamBWins) {
        teamAScore += Math.min(8, (precedentTeamAWins - precedentTeamBWins) * 3);
    } else if (precedentTeamBWins > precedentTeamAWins) {
        teamBScore += Math.min(8, (precedentTeamBWins - precedentTeamAWins) * 3);
    }

    // Factor 8: Head-to-Head Venue Mastery & Multi-Decade Series Streak
    let seriesInfo: { venueStreak?: string; allTimeRecord?: string; streakYears?: number; lastRoadWinDate?: string; narrativeNotes?: string } | undefined = undefined;
    if (isTeamAHome && teamA.name.includes('Bills') && teamB.name.includes('Lions')) {
        seriesInfo = {
            venueStreak: 'Bills 4-0-1 vs Lions in Buffalo since Dec 22, 1991',
            allTimeRecord: 'Bills 4-1-1 all-time home record vs Lions',
            streakYears: 35,
            lastRoadWinDate: 'December 22, 1991 (17-14 OT)',
            narrativeNotes: 'Detroit has not won in Buffalo in nearly 35 years (since Dec 22, 1991). Buffalo won in 1997 (22-13), 2002 (24-17), 2010 (14-12), and 2018 (14-13), with their only other home meeting being a 21-21 tie in 1972.'
        };
        teamAScore += 14; // Stadium multi-decade psychological & energetic venue mastery
    } else if (!isTeamAHome && teamB.name.includes('Bills') && teamA.name.includes('Lions')) {
        seriesInfo = {
            venueStreak: 'Bills 4-0-1 vs Lions in Buffalo since Dec 22, 1991',
            allTimeRecord: 'Bills 4-1-1 all-time home record vs Lions',
            streakYears: 35,
            lastRoadWinDate: 'December 22, 1991 (17-14 OT)',
            narrativeNotes: 'Detroit has not won in Buffalo in nearly 35 years (since Dec 22, 1991). Buffalo won in 1997 (22-13), 2002 (24-17), 2010 (14-12), and 2018 (14-13).'
        };
        teamBScore += 14;
    }

    // Pick winner based on calculated total score
    const isTeamAWinner = teamAScore >= teamBScore;
    const winner = isTeamAWinner ? teamA : teamB;
    const loser = isTeamAWinner ? teamB : teamA;
    const winnerBreakdown = isTeamAWinner ? teamABreakdown : teamBBreakdown;
    const loserBreakdown = isTeamAWinner ? teamBBreakdown : teamABreakdown;

    const winnerDE = isTeamAWinner ? teamA_DE : teamB_DE;
    const loserDE = isTeamAWinner ? teamB_DE : teamA_DE;
    const winnerDay = isTeamAWinner ? teamA_Day : teamB_Day;
    const loserDay = isTeamAWinner ? teamB_Day : teamA_Day;

    const winnerDEStats = isTeamAWinner ? teamA_DEStats : teamB_DEStats;
    const loserDEStats = isTeamAWinner ? teamB_DEStats : teamA_DEStats;
    const winnerDayStats = isTeamAWinner ? teamA_DayStats : teamB_DayStats;
    const loserDayStats = isTeamAWinner ? teamB_DayStats : teamA_DayStats;

    const winnerCoachDE = isTeamAWinner ? teamA_CoachDE : teamB_CoachDE;
    const loserCoachDE = isTeamAWinner ? teamB_CoachDE : teamA_CoachDE;
    const winnerCoachDEStats = isTeamAWinner ? teamA_CoachDEStats : teamB_CoachDEStats;
    const loserCoachDEStats = isTeamAWinner ? teamB_CoachDEStats : teamA_CoachDEStats;

    const winnerQbDE = isTeamAWinner ? teamA_QbDE : teamB_QbDE;
    const loserQbDE = isTeamAWinner ? teamB_QbDE : teamA_QbDE;
    const winnerQbDEStats = isTeamAWinner ? teamA_QbDEStats : teamB_QbDEStats;
    const loserQbDEStats = isTeamAWinner ? teamB_QbDEStats : teamA_QbDEStats;

    const winnerComboWins = isTeamAWinner ? teamA_ComboWins : teamB_ComboWins;
    const loserComboWins = isTeamAWinner ? teamB_ComboWins : teamA_ComboWins;

    const winnerTotalPatternWins = isTeamAWinner ? teamA_TotalPatternWins : teamB_TotalPatternWins;
    const winnerTotalPatternLosses = isTeamAWinner ? teamA_TotalPatternLosses : teamB_TotalPatternLosses;
    const winnerTotalPatternPct = isTeamAWinner ? teamA_TotalPatternPct : teamB_TotalPatternPct;

    const loserTotalPatternWins = isTeamAWinner ? teamB_TotalPatternWins : teamA_TotalPatternWins;
    const loserTotalPatternLosses = isTeamAWinner ? teamB_TotalPatternLosses : teamA_TotalPatternLosses;
    const loserTotalPatternPct = isTeamAWinner ? teamB_TotalPatternPct : teamA_TotalPatternPct;

    const winnerOwnerDE = isTeamAWinner ? teamA_OwnerDE : teamB_OwnerDE;
    const loserOwnerDE = isTeamAWinner ? teamB_OwnerDE : teamA_OwnerDE;
    const winnerOwnerDEStats = isTeamAWinner ? teamA_OwnerDEStats : teamB_OwnerDEStats;
    const loserOwnerDEStats = isTeamAWinner ? teamB_OwnerDEStats : teamA_OwnerDEStats;

    const isWinnerHome = isTeamAWinner ? isTeamAHome : !isTeamAHome;

    // Decision factors list with detailed total wins and losses
    const decisionFactors: DecisionFactor[] = [];

    // Home Field Grounding
    decisionFactors.push({
        title: 'Home Field Vibrational Grounding',
        description: isWinnerHome
            ? `${winner.name} holds home field stadium vibrational grounding, providing an energetic advantage against traveling opposition.`
            : `${winner.name} successfully overcame away-team travel displacement through commanding macro numerology alignment.`,
        winnerScore: isWinnerHome ? 1 : 0,
        loserScore: isWinnerHome ? 0 : 1,
        advantage: isWinnerHome ? 'winner' : 'loser',
        edgeScore: 8
    });

    decisionFactors.push({
        title: 'Team Daily Essence (DE) Total Record',
        description: `${winner.name} carries DE ${winnerDE} (${winnerDEStats.wins}W - ${winnerDEStats.losses}L, ${winnerDEStats.winPct}% across all games) vs ${loser.name}'s DE ${loserDE} (${loserDEStats.wins}W - ${loserDEStats.losses}L, ${loserDEStats.winPct}%).`,
        winnerScore: winnerDEStats.winPct,
        loserScore: loserDEStats.winPct,
        advantage: winnerDEStats.winPct >= loserDEStats.winPct ? 'winner' : 'loser',
        edgeScore: Math.abs(Math.round(winnerDEStats.winPct - loserDEStats.winPct))
    });

    decisionFactors.push({
        title: 'Head Coach Daily Essence Dominance',
        description: `${winner.name}'s Coach DE is ${winnerCoachDE} (${winnerCoachDEStats.wins}W - ${winnerCoachDEStats.losses}L, ${winnerCoachDEStats.winPct}%) compared to ${loser.name}'s Coach DE ${loserCoachDE} (${loserCoachDEStats.wins}W - ${loserCoachDEStats.losses}L, ${loserCoachDEStats.winPct}%).`,
        winnerScore: winnerCoachDEStats.winPct,
        loserScore: loserCoachDEStats.winPct,
        advantage: winnerCoachDEStats.winPct >= loserCoachDEStats.winPct ? 'winner' : 'loser',
        edgeScore: Math.abs(Math.round(winnerCoachDEStats.winPct - loserCoachDEStats.winPct))
    });

    if (winnerQbDEStats && loserQbDEStats) {
        decisionFactors.push({
            title: 'Starting QB Daily Essence Alignment',
            description: `${winner.name}'s QB DE is ${winnerQbDE} (${winnerQbDEStats.wins}W - ${winnerQbDEStats.losses}L, ${winnerQbDEStats.winPct}%) vs ${loser.name}'s QB DE ${loserQbDE} (${loserQbDEStats.wins}W - ${loserQbDEStats.losses}L, ${loserQbDEStats.winPct}%).`,
            winnerScore: winnerQbDEStats.winPct,
            loserScore: loserQbDEStats.winPct,
            advantage: winnerQbDEStats.winPct >= loserQbDEStats.winPct ? 'winner' : 'loser',
            edgeScore: Math.abs(Math.round(winnerQbDEStats.winPct - loserQbDEStats.winPct))
        });
    }

    if (winnerOwnerDEStats && loserOwnerDEStats) {
        decisionFactors.push({
            title: 'Franchise Owner Daily Essence Alignment',
            description: `${winner.name}'s Owner DE is ${winnerOwnerDE} (${winnerOwnerDEStats.wins}W - ${winnerOwnerDEStats.losses}L, ${winnerOwnerDEStats.winPct}%) vs ${loser.name}'s Owner DE ${loserOwnerDE} (${loserOwnerDEStats.wins}W - ${loserOwnerDEStats.losses}L, ${loserOwnerDEStats.winPct}%).`,
            winnerScore: winnerOwnerDEStats.winPct,
            loserScore: loserOwnerDEStats.winPct,
            advantage: winnerOwnerDEStats.winPct >= loserOwnerDEStats.winPct ? 'winner' : 'loser',
            edgeScore: Math.abs(Math.round(winnerOwnerDEStats.winPct - loserOwnerDEStats.winPct))
        });
    }

    decisionFactors.push({
        title: 'Game Day Number League-Wide Record',
        description: `${winner.name} aligns with Day Number ${winnerDay} (${winnerDayStats.wins}W - ${winnerDayStats.losses}L, ${winnerDayStats.winPct}% in NFL history) vs ${loser.name}'s Day Number ${loserDay} (${loserDayStats.wins}W - ${loserDayStats.losses}L, ${loserDayStats.winPct}%).`,
        winnerScore: winnerDayStats.wins,
        loserScore: loserDayStats.wins,
        advantage: winnerDayStats.wins >= loserDayStats.wins ? 'winner' : 'loser',
        edgeScore: Math.abs(winnerDayStats.wins - loserDayStats.wins)
    });

    decisionFactors.push({
        title: 'DE | Day Combination Winning Frequency',
        description: `The combination pattern [${winnerDE} | ${winnerDay}] has registered ${winnerComboWins} wins in our verified database, compared to ${loserComboWins} wins for [${loserDE} | ${loserDay}].`,
        winnerScore: winnerComboWins,
        loserScore: loserComboWins,
        advantage: winnerComboWins >= loserComboWins ? 'winner' : 'loser',
        edgeScore: Math.abs(winnerComboWins - loserComboWins)
    });

    const winnerExactNet = isTeamAWinner ? teamAExactNet : teamBExactNet;
    const loserExactNet = isTeamAWinner ? teamBExactNet : teamAExactNet;
    const winnerSubsetNet = isTeamAWinner ? teamASubsetNet : teamBSubsetNet;
    const loserSubsetNet = isTeamAWinner ? teamBSubsetNet : teamASubsetNet;

    decisionFactors.push({
        title: 'Personnel Exact-8 & Subset-5 Pattern Net Edge',
        description: `${winner.name}'s Team, Coach & QB collective pattern net score is +${winnerExactNet} exact / +${winnerSubsetNet} subset, vs ${loser.name}'s +${loserExactNet} exact / +${loserSubsetNet} subset.`,
        winnerScore: winnerExactNet,
        loserScore: loserExactNet,
        advantage: winnerExactNet >= loserExactNet ? 'winner' : 'loser',
        edgeScore: Math.abs(winnerExactNet - loserExactNet)
    });

    if (precedentGames.length > 0) {
        const winnerPrecWins = isTeamAWinner ? precedentTeamAWins : precedentTeamBWins;
        const loserPrecWins = isTeamAWinner ? precedentTeamBWins : precedentTeamAWins;
        decisionFactors.push({
            title: 'Historical Precedents & Pattern Matchups',
            description: `Identified ${precedentGames.length} relevant historical games in the database matching these DE/Day patterns and franchises.`,
            winnerScore: winnerPrecWins,
            loserScore: loserPrecWins,
            advantage: winnerPrecWins >= loserPrecWins ? 'winner' : 'loser',
            edgeScore: Math.abs(winnerPrecWins - loserPrecWins)
        });
    }

    if (seriesInfo) {
        const isWinnerAdvantaged = winner.name.includes('Bills');
        decisionFactors.push({
            title: 'Venue Dominance & 35-Year Series Streak',
            description: seriesInfo.narrativeNotes || seriesInfo.venueStreak || '',
            winnerScore: isWinnerAdvantaged ? 4 : 0,
            loserScore: isWinnerAdvantaged ? 0 : 4,
            advantage: isWinnerAdvantaged ? 'winner' : 'loser',
            edgeScore: 14
        });
    }

    // Calibrated realistic confidence based on score margin
    const margin = Math.abs(teamAScore - teamBScore);
    const edgeFactor = Math.min(margin / 90, 1);
    const confidence = Math.round(52 + (edgeFactor * 26));

    // Dynamic, natural reasoning
    const reasons: string[] = [];
    if (winnerCoachDEStats.winPct > loserCoachDEStats.winPct + 1) {
        reasons.push(`superior Head Coach Daily Essence record (${winnerCoachDEStats.wins}W - ${winnerCoachDEStats.losses}L, ${winnerCoachDEStats.winPct}% for DE ${winnerCoachDE})`);
    }
    if (winnerQbDEStats && loserQbDEStats && winnerQbDEStats.winPct > loserQbDEStats.winPct + 1) {
        reasons.push(`higher Starting QB Daily Essence efficiency (${winnerQbDEStats.winPct}% for DE ${winnerQbDE})`);
    }
    if (winnerDEStats.winPct > loserDEStats.winPct + 1) {
        reasons.push(`higher Team Daily Essence historical win rate (${winnerDEStats.winPct}% for DE ${winnerDE})`);
    }
    if (winnerComboWins > loserComboWins) {
        reasons.push(`a higher-frequency winning combo profile (${winnerComboWins} historical wins for ${winnerDE}|${winnerDay})`);
    }
    if (winnerExactNet > loserExactNet) {
        reasons.push(`a stronger personnel exact pattern score (+${winnerExactNet} vs +${loserExactNet})`);
    }

    const reasoningSummary = reasons.length > 0 
        ? reasons.join(', and ')
        : `favorable total pattern numbers win rate across all documented NFL games and personnel numerology metrics`;

    const finalReasoning = `${winner.name} is favored over ${loser.name} based on ${reasoningSummary}.`;

    const getDisplayNumbers = (entity: Team | Person, date: Date): DisplayNumbers => {
        const patterns = calculateAllPatterns(entity.name, entity.birthday, date);
        const gameYear = date.getUTCFullYear();
        const parseLastNum = (s: string) => parseInt(s.split('/').pop()!, 10);
        
        return {
            yearEssence: reduceToSingleDigit(gameYear),
            personalYear: parseLastNum(patterns.py),
            personalMonth: parseLastNum(patterns.pm),
            personalMonthEssence: parseLastNum(patterns.pme),
            dailyEssence: parseLastNum(patterns.dailyEssenceFull)
        };
    };

    return {
        winner,
        loser,
        confidence,
        reasoning: finalReasoning,
        winnerStats: getDisplayNumbers(winner, gameDate),
        loserStats: getDisplayNumbers(loser, gameDate),
        winnerBreakdown,
        loserBreakdown,
        winnerDE,
        loserDE,
        winnerDay,
        loserDay,
        winnerDEStats,
        loserDEStats,
        winnerCoachDE,
        loserCoachDE,
        winnerCoachDEStats,
        loserCoachDEStats,
        winnerQbDE,
        loserQbDE,
        winnerQbDEStats,
        loserQbDEStats,
        winnerDayStats,
        loserDayStats,
        winnerComboWins,
        loserComboWins,
        winnerTotalPatternWins,
        winnerTotalPatternLosses,
        winnerTotalPatternPct,
        loserTotalPatternWins,
        loserTotalPatternLosses,
        loserTotalPatternPct,
        winnerOwnerDE,
        loserOwnerDE,
        winnerOwnerDEStats,
        loserOwnerDEStats,
        isChaosDay,
        chaosType,
        chaosWarning,
        isWinnerHome,
        decisionFactors,
        precedentGames
    };
};
