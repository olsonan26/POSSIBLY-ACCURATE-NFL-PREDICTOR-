import type { CoachEvidence } from '../services/coachAnalysis.js';
const domains = new Set(['nfl.com','espn.com','apnews.com','reuters.com','cbssports.com','nbcsports.com','foxsports.com','si.com','theathletic.com','weather.gov','noaa.gov',
 '49ers.com','baltimoreravens.com','buffalobills.com','bengals.com','clevelandbrowns.com','denverbroncos.com','detroitlions.com','packers.com','houstontexans.com','colts.com','jaguars.com','chiefs.com','raiders.com','chargers.com','therams.com','miamidolphins.com','vikings.com','patriots.com','neworleanssaints.com','giants.com','newyorkjets.com','philadelphiaeagles.com','steelers.com','seahawks.com','buccaneers.com','tennesseetitans.com','commanders.com','atlantafalcons.com','panthers.com','chicagobears.com','dallascowboys.com','azcardinals.com']);
const normalize = (s: string) => s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
export function allowedCoachUrl(value: string): boolean {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && [...domains].some(d => u.hostname === d || u.hostname.endsWith('.'+d)); } catch { return false; }
}
export function verifyCoachExcerpt(html: string, candidate: any, cutoff: string, id: string, earliest?: string): CoachEvidence | null {
  if (!allowedCoachUrl(candidate?.url || '')) return null;
  const published = [...html.matchAll(/"datePublished"\s*:\s*"([^"]+)"/gi)].map(m=>m[1]);
  const modified = [...html.matchAll(/"dateModified"\s*:\s*"([^"]+)"/gi)].map(m=>m[1]);
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs: Record<string,string> = {}; for (const match of tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) attrs[match[1].toLowerCase()] = match[2];
    const key = attrs.property || attrs.name || attrs.itemprop;
    if (['article:published_time','datePublished'].includes(key)) published.push(attrs.content);
    if (['article:modified_time','dateModified'].includes(key)) modified.push(attrs.content);
  }
  const time = (s: string) => Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s+'T23:59:59Z' : s);
  const cutoffMs = Date.parse(cutoff);
  if (earliest && published.some(d => time(d) < Date.parse(earliest))) return null;
  if (!published.length || published.some(d => !Number.isFinite(time(d)) || time(d) >= cutoffMs)
    || modified.some(d => !Number.isFinite(time(d)) || time(d) >= cutoffMs)) return null;
  const quote = normalize(typeof candidate.quote === 'string' ? candidate.quote : '');
  const body = normalize(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' '));
  if (quote.length < 40 || quote.length > 600 || !body.includes(quote)) return null;
  return {id, url:candidate.url, title:normalize(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || candidate.url).slice(0,240), publishedAt:new Date(Math.max(...published.map(time))).toISOString(), quote};
}
export async function collectCoachEvidence(candidates: any[], cutoff: string, earliest?: string): Promise<CoachEvidence[]> {
  const unique = [...new Map((Array.isArray(candidates) ? candidates : []).filter(c=>allowedCoachUrl(c?.url || '')).map(c=>[c.url,c])).values()].slice(0,12);
  const rows: CoachEvidence[] = [];
  for (let i=0;i<unique.length;i+=4) {
    const chunk = await Promise.all(unique.slice(i,i+4).map(async (candidate,index) => {
      try {
        let url = candidate.url, response: Response | undefined;
        for(let hop=0;hop<3;hop++) {
          if(!allowedCoachUrl(url)) return null;
          response = await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(8000),cache:'no-store'});
          if(response.status >= 300 && response.status < 400) { const location=response.headers.get('location'); if(!location) return null; url=new URL(location,url).href; continue; }
          break;
        }
        if(!response?.ok || !response.body) return null;
        const reader=response.body.getReader(); let html='',bytes=0; const decoder=new TextDecoder();
        while(true) { const part=await reader.read(); if(part.done) break; bytes+=part.value.length; if(bytes>1_000_000) {await reader.cancel();return null;} html+=decoder.decode(part.value,{stream:true}); }
        return verifyCoachExcerpt(html,candidate,cutoff,`E${i+index+1}`,earliest);
      } catch {return null;}
    }));
    rows.push(...chunk.filter((r): r is CoachEvidence => Boolean(r)));
  }
  return rows;
}
