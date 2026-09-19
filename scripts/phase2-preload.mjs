// Preload for the isolated Phase 2 research runner.
// 1) TEAM_REGISTRY stores dates as Date objects; the research script expects ISO strings.
// 2) Coach DOB research resolves verified football pages to Wikidata P569 without
//    guessing. Wikimedia requests are serialized to avoid rate-limit-driven missingness.

const nativeFetch = globalThis.fetch.bind(globalThis);

if (typeof Date.prototype.split !== 'function') {
  Object.defineProperty(Date.prototype, 'split', {
    configurable: true,
    value(separator) {
      if (!Number.isFinite(this.getTime())) return [];
      return this.toISOString().slice(0, 10).split(separator);
    }
  });
}

const normalize = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const jsonResponse = payload => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { 'content-type': 'application/json; charset=utf-8' }
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function makeQueue(delayMs) {
  let tail = Promise.resolve();
  return async task => {
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      const result = await task();
      await sleep(delayMs);
      return result;
    } finally {
      release();
    }
  };
}

const serializedWikipedia = makeQueue(40);
const serializedWikidata = makeQueue(80);

function verifiedFootballCoachPage(page, name) {
  if (!page || page.missing != null || page.pageprops?.disambiguation != null) return false;
  const title = normalize(page.title);
  const target = normalize(name);
  if (!(title === target || title.startsWith(`${target} `))) return false;
  const extract = String(page.extract || '');
  return /american football/i.test(extract) && /(coach|coaching|head coach|coordinator|quarterback|player)/i.test(extract);
}

async function resolveExactWikipediaCandidates(name) {
  const candidates = [
    `${name} (American football coach)`,
    `${name} (American football)`,
    name
  ];
  const params = new URLSearchParams({
    action: 'query',
    prop: 'pageprops|extracts',
    titles: candidates.join('|'),
    redirects: '1',
    exintro: '1',
    explaintext: '1',
    format: 'json',
    origin: '*'
  });
  const response = await serializedWikipedia(() => nativeFetch(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': 'NFL-PURE-research/2.3 (GitHub Actions)' }
  }));
  if (!response.ok) return null;
  const pages = Object.values((await response.json()).query?.pages || {});
  const page = pages.find(row => verifiedFootballCoachPage(row, name));
  const qid = page?.pageprops?.wikibase_item;
  return typeof qid === 'string' && /^Q\d+$/.test(qid) ? qid : null;
}

async function resolveSearchFallback(name) {
  const searchParams = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: `${name} NFL coach`,
    srlimit: '10',
    format: 'json',
    origin: '*'
  });
  const searchRes = await serializedWikipedia(() => nativeFetch(`https://en.wikipedia.org/w/api.php?${searchParams}`, {
    headers: { 'User-Agent': 'NFL-PURE-research/2.3 (GitHub Actions)' }
  }));
  if (!searchRes.ok) return null;
  const hits = (await searchRes.json()).query?.search || [];
  const target = normalize(name);
  const titles = hits
    .filter(row => {
      const title = normalize(row.title);
      return title === target || title.startsWith(`${target} `);
    })
    .slice(0, 4)
    .map(row => row.title);
  if (!titles.length) return null;

  const pageParams = new URLSearchParams({
    action: 'query',
    prop: 'pageprops|extracts',
    titles: titles.join('|'),
    redirects: '1',
    exintro: '1',
    explaintext: '1',
    format: 'json',
    origin: '*'
  });
  const pageRes = await serializedWikipedia(() => nativeFetch(`https://en.wikipedia.org/w/api.php?${pageParams}`, {
    headers: { 'User-Agent': 'NFL-PURE-research/2.3 (GitHub Actions)' }
  }));
  if (!pageRes.ok) return null;
  const pages = Object.values((await pageRes.json()).query?.pages || {});
  const page = pages.find(row => verifiedFootballCoachPage(row, name));
  const qid = page?.pageprops?.wikibase_item;
  return typeof qid === 'string' && /^Q\d+$/.test(qid) ? qid : null;
}

async function resolveViaWikipedia(name) {
  const exact = await resolveExactWikipediaCandidates(name);
  if (exact) return exact;
  return resolveSearchFallback(name);
}

globalThis.fetch = async (input, init) => {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  if (!rawUrl) return nativeFetch(input, init);

  if (rawUrl.startsWith('https://www.wikidata.org/wiki/Special:EntityData/')) {
    return serializedWikidata(() => nativeFetch(input, init));
  }

  if (!rawUrl.startsWith('https://www.wikidata.org/w/api.php?')) {
    return nativeFetch(input, init);
  }

  const url = new URL(rawUrl);
  if (url.searchParams.get('action') !== 'wbsearchentities') {
    return serializedWikidata(() => nativeFetch(input, init));
  }

  const name = url.searchParams.get('search') || '';
  const original = await serializedWikidata(() => nativeFetch(input, init));
  if (!original.ok) return original;

  let payload;
  try {
    payload = await original.clone().json();
  } catch {
    return original;
  }

  const target = normalize(name);
  const alreadyUsable = (payload.search || []).some(row => {
    if (normalize(row.label) !== target) return false;
    const description = String(row.description || '');
    return /football/i.test(description) && /(coach|player)/i.test(description);
  });
  if (alreadyUsable) return original;

  const qid = await resolveViaWikipedia(name);
  if (!qid) return original;

  payload.search = [{ id: qid, label: name, description: 'American football coach' }];
  return jsonResponse(payload);
};