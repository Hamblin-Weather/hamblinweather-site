import { centralTime, centralZone, getJson, recent, type Observation, type Period } from './weather';

const hourMs = 3_600_000;
const dayMs = 24 * hourMs;
const localDate = new Intl.DateTimeFormat('sv-SE', { timeZone: centralZone, year: 'numeric', month: '2-digit', day: '2-digit' });
const localHour = new Intl.DateTimeFormat('en-US', { timeZone: centralZone, hour: 'numeric', hourCycle: 'h23' });
const dayName = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' });
const dateNumber = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'numeric', day: 'numeric' });
const fullDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });

export function outdoorDays(now = Date.now()) {
  const first = Date.parse(localDate.format(now) + 'T00:00:00Z');
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(first + index * dayMs);
    return {
      key: day.toISOString().slice(0, 10),
      weekday: dayName.format(day),
      date: dateNumber.format(day),
      label: fullDate.format(day),
    };
  });
}

export const activities = [
  { id: 'fishing', title: 'Fishing Forecast', icon: 'fish', period: 'daylight', comfort: [50, 82],
    wind: 8, gust: 14, limit: 24, rain: 0.70, description: 'Daylight near the water. Mild temperatures, lower rain chances, and light winds score highest. Gusts of 24 mph or higher rule out a window.' },
  { id: 'hunting', title: 'Hunting Forecast', icon: 'compass', period: 'daylight', comfort: [32, 65],
    wind: 10, gust: 18, limit: 32, rain: 0.58, description: 'Daylight conditions for the outing. Wind direction changes between hours reduce the score. Gusts of 32 mph or higher rule out a window.' },
  { id: 'running', title: 'Walking & Running', icon: 'shoe', period: '6–21', comfort: [48, 72],
    wind: 11, gust: 18, limit: 30, rain: 0.68, description: '6 AM–9 PM Central. Uses feels-like temperature when available, rain chance, and wind. Gusts of 30 mph or higher rule out a window.' },
  { id: 'mowing', title: 'Mow-Cast', icon: 'grass', period: 'daylight', comfort: [48, 84],
    wind: 12, gust: 20, limit: 32, rain: 0.90, description: 'Daylight only. Rain chance, humidity, and rain in the preceding three hours affect drying potential. Recent station rainfall adds a penalty when available. Gusts of 32 mph or higher rule out a window.' },
  { id: 'grilling', title: 'Grilling Forecast', icon: 'grill', period: '16–22', comfort: [50, 84],
    wind: 9, gust: 13, limit: 25, rain: 0.78, description: '4–10 PM Central. Scores cool or hot temperatures, gusts, and rain. Gusts of 25 mph or higher or a relevant NWS fire-weather alert rule out a window.' },
  { id: 'plans', title: 'Outdoor Plans Forecast', icon: 'calendar', period: '6–21', comfort: [55, 82],
    wind: 12, gust: 18, limit: 30, rain: 0.82, description: '6 AM–9 PM Central. Mild temperatures, lower rain chances, and lighter winds score highest for picnics, ballgames, and other outdoor plans. Gusts of 30 mph or higher rule out a window.' },
] as const;

type Activity = typeof activities[number];
type GridValue<T> = { validTime: string; value: T | null };
type GridSeries<T> = { uom?: string; values: GridValue<T>[] };
type WeatherCode = { weather?: string | null };
type OutdoorGrid = {
  updateTime: string;
  windGust?: GridSeries<number>;
  apparentTemperature?: GridSeries<number>;
  relativeHumidity?: GridSeries<number>;
  weather?: GridSeries<WeatherCode[]>;
};
type Hour = {
  start: number; end: number; key: string; clockHour: number; daylight: boolean;
  temperature?: number; feelsLike?: number; wind?: number; gust?: number; direction: string;
  pop?: number; humidity?: number; rain: boolean; description: string; storm: boolean; ice: boolean;
};
type Alert = { event: string; start: number; end: number };
type Window = { first: Hour; second: Hour; score: number; hazard?: string };

export type OutdoorDay = {
  score?: number;
  rating: string;
  explanation: string;
  window: string;
  factors: string;
  tone: 'good' | 'fair' | 'poor' | 'missing';
};

export async function getOutdoorGrid(url: string, signal: AbortSignal) {
  const { properties } = await getJson<{ properties: OutdoorGrid }>(url, signal);
  if (!properties || !recent(properties.updateTime, 480)) throw new Error('No recent forecast grid');
  return properties;
}

function fieldAt<T>(series: GridSeries<T> | undefined, time: number) {
  for (const { validTime, value } of series?.values ?? []) {
    const [when, duration] = validTime.split('/');
    const start = Date.parse(when);
    const span = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(duration);
    if (!span || start > time) continue;
    const length = (Number(span[1] ?? 0) * 24 + Number(span[2] ?? 0) + Number(span[3] ?? 0) / 60 + Number(span[4] ?? 0) / 3600) * hourMs;
    if (time < start + length) return value ?? undefined;
  }
}

function fahrenheit(value: number | null | undefined, unit?: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  if (unit === 'F' || unit === 'wmoUnit:degF') return value;
  if (unit === 'C' || unit === 'wmoUnit:degC') return value * 9 / 5 + 32;
}

const thunder = /thunder|lightning|tstm/i;
const wetWeather = /rain|shower|drizzle|snow|sleet/i;

export function outdoorHours(periods: Period[], grid?: OutdoorGrid): Hour[] {
  return periods.flatMap((period) => {
    const start = Date.parse(period.startTime);
    const end = Date.parse(period.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const report = [period.shortForecast, ...(fieldAt(grid?.weather, start) ?? []).map((code) => code.weather)].join(' ');
    const wind = (period.windSpeed ?? '').match(/\d+(?:\.\d+)?/g)?.map(Number);
    const gridGust = grid?.windGust?.uom === 'wmoUnit:km_h-1' ? fieldAt(grid.windGust, start) : undefined;
    const probability = period.probabilityOfPrecipitation?.value;
    return [{
      start, end, key: localDate.format(start), clockHour: Number(localHour.format(start)), daylight: period.isDaytime,
      temperature: fahrenheit(period.temperature, period.temperatureUnit),
      feelsLike: fahrenheit(fieldAt(grid?.apparentTemperature, start), grid?.apparentTemperature?.uom),
      wind: wind?.length ? Math.max(...wind) : undefined,
      gust: typeof gridGust === 'number' && Number.isFinite(gridGust) && gridGust >= 0 ? Math.round(gridGust / 1.609344) : undefined,
      direction: period.windDirection || '',
      pop: typeof probability === 'number' && probability >= 0 && probability <= 100 ? probability : undefined,
      humidity: (grid?.relativeHumidity?.uom === 'wmoUnit:percent' ? fieldAt(grid.relativeHumidity, start) : undefined) ??
        period.relativeHumidity?.value ?? undefined,
      rain: wetWeather.test(report), description: period.shortForecast, storm: thunder.test(report),
      ice: /freezing (rain|drizzle)|ice pellets|sleet/i.test(report),
    }];
  }).sort((a, b) => a.start - b.start);
}

function allowedHour(activity: Activity, hour: Hour) {
  if (activity.period === 'daylight') return hour.daylight;
  return activity.period === '6–21' ? hour.clockHour >= 6 && hour.clockHour < 21 : hour.clockHour >= 16 && hour.clockHour < 22;
}

function hazardAt(activity: Activity, hour: Hour, alerts: Alert[]) {
  const relevant = alerts.find(({ event, start, end }) => start < hour.end && end > hour.start && (
    /tornado|thunderstorm|extreme (heat|cold)|excessive heat|heat advisory|wind (warning|advisory|watch)|flood (warning|watch)|flash flood|winter storm|ice storm|blizzard|hurricane|tropical storm|dust storm|snow squall|dense smoke|evacuation/i.test(event) ||
    (activity.id === 'fishing' && /flood|marine|lake wind|small craft|gale|dense fog/i.test(event)) ||
    (activity.id === 'grilling' && /red flag|fire weather|fire danger|wildfire|burn ban/i.test(event))
  ));
  if (relevant) return relevant.event + ' in effect';
  if (hour.storm) return 'Thunderstorms in the hourly forecast';
  if (hour.ice) return 'Freezing precipitation in the hourly forecast';
  const wind = Math.max(hour.wind ?? 0, hour.gust ?? 0);
  if (wind >= activity.limit) return 'Forecast winds reach ' + wind + ' mph';
  const feelsLike = hour.feelsLike ?? hour.temperature;
  if (feelsLike !== undefined && (feelsLike >= 103 || feelsLike <= 10)) return 'Dangerous heat or cold in the hourly forecast';
}

function mowingMoisture(hour: Hour, hours: Hour[], observation?: Observation) {
  const recentWetHour = hours.some((other) => other.end <= hour.start && hour.start - other.end < 3 * hourMs &&
    (other.rain || (other.pop ?? 0) >= 60));
  const age = hour.start - Date.parse(observation?.timestamp ?? '');
  return { recentWetHour, recentRain: age >= 0 && age < 6 * hourMs ? observation?.rainLast6HoursMm : undefined };
}

function hourScore(activity: Activity, hour: Hour, hours: Hour[], observation?: Observation) {
  const temperature = activity.id === 'running' ? hour.feelsLike ?? hour.temperature : hour.temperature;
  if (temperature === undefined || hour.wind === undefined || hour.pop === undefined) return;
  const [low, high] = activity.comfort;
  let penalty = Math.min(38, Math.max(0, low - temperature, temperature - high) * 1.5)
    + Math.max(0, hour.wind - activity.wind) * 1.8
    + Math.max(0, (hour.gust ?? hour.wind) - activity.gust) * 2
    + Math.max(hour.pop, hour.rain ? 55 : 0) * activity.rain;
  if (activity.id === 'mowing') {
    const { recentWetHour, recentRain } = mowingMoisture(hour, hours, observation);
    penalty += (recentWetHour ? 25 : 0) + Math.min(25, (recentRain ?? 0) * 5) + Math.max(0, (hour.humidity ?? 70) - 70) * 0.7;
  }
  return Math.max(0, Math.round(100 - penalty));
}

function directionPenalty(first: Hour, second: Hour) {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const from = directions.indexOf(first.direction);
  const to = directions.indexOf(second.direction);
  if (from < 0 || to < 0 || !first.wind || !second.wind) return 0;
  const change = Math.min(Math.abs(to - from), 16 - Math.abs(to - from));
  return change > 4 ? 14 : change > 2 ? 8 : 0;
}

function missing(explanation: string, rating = 'Insufficient data'): OutdoorDay {
  return { rating, explanation, window: rating, factors: '', tone: 'missing' };
}

function range(values: number[], unit: string) {
  const [min, max] = [Math.round(Math.min(...values)), Math.round(Math.max(...values))];
  return min === max ? min + unit : min + '–' + max + unit;
}

function windowFactors(activity: Activity, { first, second }: Window, hours: Hour[], observation?: Observation) {
  const scored = [first, second];
  const temperature = range(scored.map((hour) => (activity.id === 'running' ? hour.feelsLike ?? hour.temperature : hour.temperature)!), '°F');
  const temperatureLabel = activity.id === 'running' && scored.every((hour) => hour.feelsLike !== undefined)
    ? temperature + ' feels like' : activity.id === 'running' && scored.some((hour) => hour.feelsLike !== undefined)
      ? temperature + ' temperature / feels like' : temperature;
  const chance = range(scored.map((hour) => hour.pop!), '%');
  const precipitation = scored.some((hour) => hour.rain) ? chance + ' precip. chance, with precipitation in the forecast' : chance + ' precip. chance';
  const wind = range(scored.map((hour) => hour.wind!), ' mph');
  const direction = [...new Set(scored.map((hour) => hour.wind === 0 ? 'calm' : hour.direction).filter(Boolean))].join(' → ');
  const gusts = scored.flatMap((hour) => hour.gust === undefined ? [] : [hour.gust]);
  const gust = !gusts.length ? 'gusts unavailable' : 'gusts up to ' + Math.max(...gusts) + ' mph' + (gusts.length === 1 ? ' in one hour' : '');
  const windText = 'wind ' + wind + (activity.id === 'hunting' ? ' (' + (direction || 'direction unavailable') + ')' : '');
  const context = { fishing: 'Near the water', hunting: 'During the outing', running: 'For walking or running',
    mowing: 'During daylight', grilling: 'In the evening', plans: 'For outdoor plans' }[activity.id];
  let factors = gust;
  if (activity.id === 'hunting' && directionPenalty(first, second)) factors += ' · Changing wind direction';
  if (activity.id === 'mowing') {
    const moisture = scored.map((hour) => mowingMoisture(hour, hours, observation));
    const rain = moisture.find((hour) => hour.recentRain !== undefined)?.recentRain;
    const humidity = scored.flatMap((hour) => hour.humidity === undefined ? [] : [hour.humidity]);
    const drying = scored.some((hour) => hour.rain || hour.pop! >= 40) ? 'Rain may limit drying'
      : moisture.some((hour) => hour.recentWetHour) || (rain ?? 0) > 0 ? 'Earlier rain may slow drying'
      : humidity.some((value) => value > 75) ? 'High humidity may slow drying' : 'Lower rain chances favor drying';
    factors += (humidity.length ? ' · Humidity ' + range(humidity, '%') : '') +
      ' · ' + drying +
      (rain === undefined ? ' · Recent rainfall unavailable for this window' : ' · ' + (rain / 25.4).toFixed(2) + ' in at ' + observation!.station.stationIdentifier + ' over 6 hr');
  }
  return { explanation: context + ', expect ' + temperatureLabel + ', ' + windText + ', and ' + precipitation + '.', factors };
}

export function outdoorOutlook(activity: Activity, days: ReturnType<typeof outdoorDays>, hours: Hour[],
  alerts: Alert[] | undefined, observation: Observation | undefined, now = Date.now()): OutdoorDay[] {
  return days.map(({ key }, index) => {
    const remaining = hours.filter((hour) => hour.key === key && hour.start >= now);
    const eligible = remaining.filter((hour) => allowedHour(activity, hour));
    const pairs: Window[] = [];
    for (let position = 0; position + 1 < eligible.length; position++) {
      const first = eligible[position];
      const second = eligible[position + 1];
      if (first.end !== second.start || second.end - first.start !== 2 * hourMs) continue;
      const hazard = hazardAt(activity, first, alerts ?? []) ?? hazardAt(activity, second, alerts ?? []);
      if (hazard) {
        pairs.push({ first, second, score: 0, hazard });
        continue;
      }
      const firstScore = hourScore(activity, first, hours, observation);
      const secondScore = hourScore(activity, second, hours, observation);
      if (firstScore === undefined || secondScore === undefined) continue;
      const adjustment = activity.id === 'hunting' ? directionPenalty(first, second) : 0;
      pairs.push({ first, second, score: Math.max(0, Math.min(firstScore, secondScore) - adjustment) });
    }
    const best = pairs.sort((a, b) => b.score - a.score || Number(Boolean(a.hazard)) - Number(Boolean(b.hazard)))[0];
    if (!best) {
      const last = remaining.at(-1);
      const coversRestOfToday = remaining[0]?.start === Math.ceil(now / hourMs) * hourMs && last &&
        localDate.format(last.end) !== key && remaining.every((hour, offset) => !offset || hour.start === remaining[offset - 1].end);
      if (index === 0 && coversRestOfToday && eligible.length < 2) {
        return missing('No full two-hour activity period remains today.', 'No favorable window');
      }
      return missing('Hourly data does not cover two consecutive hours for this activity.');
    }
    if (best.hazard) return { score: 0, rating: 'Poor', explanation: best.hazard + '.', window: 'No favorable window', factors: '', tone: 'poor' };

    const { score, first, second } = best;
    const { explanation, factors } = windowFactors(activity, best, hours, observation);
    const wet = activity.id === 'mowing' && (first.rain || second.rain || Math.max(first.pop!, second.pop!) >= 40);
    const approved = score >= 65 && !wet && alerts !== undefined;
    return {
      score, explanation, factors,
      rating: alerts === undefined ? 'Alert check unavailable' : approved && score >= 82 ? 'Favorable' : score >= 65 && !wet ? 'Fair' : 'Poor',
      window: approved ? centralTime(first.start, false) + ' – ' + centralTime(second.end, false)
        : alerts === undefined ? 'Insufficient data' : 'No favorable window',
      tone: alerts === undefined ? 'missing' : approved && score >= 82 ? 'good' : approved ? 'fair' : 'poor',
    };
  });
}
