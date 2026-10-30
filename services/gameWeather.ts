export interface GameVenue { id: string; latitude: number; longitude: number; roof: 'outdoor' | 'dome' | 'open' | 'closed' | 'unknown'; surface?: string; }
export interface KickoffWeather {
  kickoffAt: string; venue: GameVenue; capturedAt: string;
  evidenceMode: 'ARCHIVED_REANALYSIS' | 'FROZEN_FORECAST' | 'INDOOR';
  temperatureF: number | null; windSpeedMph: number | null; windGustMph: number | null;
  precipitation: number | null; snowfall: number | null; humidity: number | null;
  isDome: boolean; weatherImpact: number; source: string;
}
/** Requires actual venue metadata. Unknown retractable roof stays unknown; neutral venues never inherit home-team coordinates. */
export async function getKickoffWeather(kickoffAt: string, venue: GameVenue, capturedAt = new Date().toISOString()): Promise<KickoffWeather | null> {
  const kickoff = Date.parse(kickoffAt), capture = Date.parse(capturedAt);
  if (![kickoff,capture,venue.latitude,venue.longitude].every(Number.isFinite) || !venue.id || Math.abs(venue.latitude)>90 || Math.abs(venue.longitude)>180 || venue.roof === 'unknown') return null;
  const base = {kickoffAt,venue:structuredClone(venue),capturedAt,source:'Open-Meteo hourly; actual venue'};
  if (venue.roof === 'dome' || venue.roof === 'closed') return {...base,evidenceMode:'INDOOR',temperatureF:null,windSpeedMph:null,
    windGustMph:null,precipitation:null,snowfall:null,humidity:null,isDome:true,weatherImpact:0,source:'Verified indoor venue/roof; indoor temperature not observed'};
  const historical = kickoff <= capture;
  const day = kickoffAt.slice(0,10);
  const params = new URLSearchParams({latitude:String(venue.latitude),longitude:String(venue.longitude),start_date:day,end_date:day,
    hourly:'temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation,snowfall,relative_humidity_2m',timezone:'UTC',temperature_unit:'fahrenheit',wind_speed_unit:'mph'});
  const response = await fetch(`${historical?'https://archive-api.open-meteo.com/v1/archive':'https://api.open-meteo.com/v1/forecast'}?${params}`,{signal:AbortSignal.timeout(10000)});
  if(!response.ok) return null;
  const json=await response.json();
  const h=json.hourly;
  if(!Array.isArray(h?.time)) return null;
  const targetHour=Math.floor(kickoff/3600000)*3600000;
  const index=h.time.findIndex((t:string)=>Date.parse(t.endsWith('Z')?t:t+'Z')===targetHour);
  const value=(key:string)=>index>=0 && typeof h[key]?.[index]==='number' && Number.isFinite(h[key][index])?h[key][index]:null;
  const wind=value('wind_speed_10m'),precip=value('precipitation');
  if(index<0) return null;
  return {...base,evidenceMode:historical?'ARCHIVED_REANALYSIS':'FROZEN_FORECAST',temperatureF:value('temperature_2m'),windSpeedMph:wind,
    windGustMph:value('wind_gusts_10m'),precipitation:precip,snowfall:value('snowfall'),humidity:value('relative_humidity_2m'),isDome:false,
    weatherImpact:Math.min(.05,(wind!=null&&wind>15?.03:0)+(precip!=null&&precip>.1?.02:0))};
}
