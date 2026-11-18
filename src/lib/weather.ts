import { counties, type County } from './counties';
import type { Feature, Geometry } from 'geojson';

export const centralZone = 'America/Chicago';
export const nwsAlertsUrl = 'https://www.weather.gov/alerts';
const api = 'https://api.weather.gov';
const minute = 60_000;

export class WeatherHttpError extends Error {
  constructor(readonly status: number) {
    super('HTTP ' + status);
  }
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(12_000);
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new WeatherHttpError(response.status);
  return await response.json() as T;
}

export function centralTime(timestamp: string | number, date = true) {
  const time = new Date(timestamp);
  if (!Number.isFinite(time.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: centralZone, ...(date ? { month: 'short', day: 'numeric' } : {}),
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(time);
}

export function recent(timestamp: string | number, maxAgeMinutes: number) {
  const age = Date.now() - new Date(timestamp).getTime();
  return age >= -5 * minute && age <= maxAgeMinutes * minute;
}

export interface Point {
  forecast: string;
  forecastHourly: string;
  forecastGridData?: string;
  observationStations: string;
  timeZone?: string;
  relativeLocation?: { properties?: { city?: string; state?: string } };
}

export interface Period {
  name: string;
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperature: number | null;
  temperatureUnit: string;
  probabilityOfPrecipitation?: { value: number | null };
  relativeHumidity?: { value: number | null };
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
  detailedForecast: string;
}

export interface Forecast { updateTime: string; periods: Period[] }

export async function getPoint(county: Pick<County, 'lat' | 'lon'>, signal?: AbortSignal) {
  const { properties } = await getJson<{ properties: Point }>(
    api + '/points/' + county.lat.toFixed(4) + ',' + county.lon.toFixed(4), signal,
  );
  return properties;
}

export async function getForecast(url: string, signal?: AbortSignal) {
  const { properties } = await getJson<{ properties: Forecast }>(url, signal);
  if (!properties || !Array.isArray(properties.periods)) throw new Error('Incomplete forecast response');
  const periods = properties.periods.filter((period) =>
    period.shortForecast && Date.parse(period.startTime) < Date.parse(period.endTime) &&
    Date.parse(period.endTime) > Date.now(),
  );
  if (!periods.length || !recent(properties.updateTime, 480)) throw new Error('No recent forecast');
  return { updateTime: properties.updateTime, periods };
}

interface Station {
  stationIdentifier: string;
  lat: number;
  lon: number;
  name: string;
}

interface ObservationData {
  timestamp: string;
  textDescription: string;
  temperature: { value: number | null; unitCode: string };
  relativeHumidity: { value: number | null };
  windSpeed: { value: number | null; unitCode: string };
  precipitationLast6Hours?: { value: number | null; unitCode: string };
}

export interface Observation {
  station: Station;
  timestamp: string;
  text: string;
  temperature: number;
  humidity: number | null;
  windMph: number | null;
  rainLast6HoursMm?: number;
}

export async function getObservation(url: string, signal?: AbortSignal): Promise<Observation> {
  const { features } = await getJson<{ features: { geometry: { coordinates: [number, number] }; properties: Omit<Station, 'lat' | 'lon'> }[] }>(url, signal);
  for (const feature of features.slice(0, 3)) {
    const station = feature.properties;
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    if (!station?.stationIdentifier || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    try {
      const { properties: data } = await getJson<{ properties: ObservationData }>(
        api + '/stations/' + encodeURIComponent(station.stationIdentifier) + '/observations/latest', signal,
      );
      const temperature = data?.temperature?.value;
      if (typeof temperature !== 'number' || data.temperature.unitCode !== 'wmoUnit:degC' || !recent(data.timestamp, 120)) continue;
      const wind = data.windSpeed?.value;
      const rain = data.precipitationLast6Hours;
      return {
        station: { ...station, lat, lon },
        timestamp: data.timestamp,
        text: data.textDescription,
        temperature: Math.round(temperature * 9 / 5 + 32),
        humidity: data.relativeHumidity?.value ?? null,
        windMph: typeof wind === 'number' && data.windSpeed.unitCode === 'wmoUnit:km_h-1' ? Math.round(wind / 1.609344) : null,
        rainLast6HoursMm: typeof rain?.value === 'number' && rain.value >= 0
          ? rain.unitCode === 'wmoUnit:m' ? rain.value * 1000 : rain.unitCode === 'wmoUnit:mm' ? rain.value : undefined
          : undefined,
      };
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  throw new Error('No recent observations');
}

interface AlertProperties {
  id: string;
  event: string;
  headline: string | null;
  areaDesc: string;
  sent: string;
  effective?: string;
  onset?: string | null;
  expires: string;
  ends: string | null;
  status: string;
  messageType: string;
  severity: string;
  description: string;
  instruction: string | null;
  geocode?: { SAME?: string[]; UGC?: string[] };
  affectedZones?: string[];
  parameters?: { NWSheadline?: string[] };
}

export type AlertKind = 'warning' | 'watch' | 'other';
export interface LocalAlert {
  feature: Feature<Geometry | null, AlertProperties>;
  counties: County[];
  kind: AlertKind;
}

export function activeAlert(alert: LocalAlert) {
  const { expires, ends } = alert.feature.properties;
  return Date.parse(expires) > Date.now() && (!ends || Date.parse(ends) > Date.now());
}

async function getActiveAlertFeatures(query: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(12_000);
  const response = await fetch(api + '/alerts/active?' + query, {
    cache: 'no-cache',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const { type, features, pagination, updated } = await response.json() as {
    features: Feature<Geometry | null, AlertProperties>[];
    type: string;
    updated: string;
    pagination?: { next?: string };
  };
  const date = response.headers.get('date');
  const age = Number(response.headers.get('age'));
  if (type !== 'FeatureCollection' || !Array.isArray(features) || !recent(updated, 5) || pagination?.next || age > 300 || (date && !recent(date, 5))) {
    throw new Error('NWS alert check could not be verified');
  }
  return features.filter((feature) => {
    const details = feature.properties;
    if (!details?.status || !details.messageType) throw new Error('Incomplete alert response');
    if (details.status !== 'Actual' || !['Alert', 'Update'].includes(details.messageType)) return false;
    if (!details.event || !Number.isFinite(Date.parse(details.sent)) || !Number.isFinite(Date.parse(details.expires)) ||
      (details.ends && !Number.isFinite(Date.parse(details.ends)))) {
      throw new Error('Incomplete active alert');
    }
    return true;
  });
}

export async function getPointAlerts({ lat, lon }: Pick<County, 'lat' | 'lon'>, signal?: AbortSignal) {
  const features = await getActiveAlertFeatures('point=' + lat.toFixed(4) + ',' + lon.toFixed(4), signal);
  return features.map(({ properties }) => {
    const start = Date.parse(properties.onset ?? properties.effective ?? properties.sent);
    if (!Number.isFinite(start)) throw new Error('Incomplete alert start');
    const end = Math.min(Date.parse(properties.expires), properties.ends ? Date.parse(properties.ends) : Infinity);
    return { event: properties.event, start, end };
  });
}

export async function getAlerts(signal?: AbortSignal) {
  const features = await getActiveAlertFeatures('area=TN', signal);
  const result: LocalAlert[] = [];
  for (const feature of features) {
    const details = feature.properties;
    const same = new Set(details.geocode?.SAME?.map((value) => value.slice(-5)));
    const zoneUrls = details.affectedZones ?? [];
    const ugc = new Set([...(details.geocode?.UGC ?? []), ...zoneUrls.map((url) => url.split('/').at(-1))]);
    if (!same.size && !ugc.size) throw new Error('Active alert has no geographic identifiers');
    const local = counties.filter((county) =>
      same.has(county.fips) || same.has('47000') || ugc.has('TNC000') || ugc.has('TNZ000') ||
      ugc.has('TNCALL') || ugc.has('TNZALL') || ugc.has(county.countyCode) ||
      ugc.has(county.forecastZone) || zoneUrls.some((zone) => zone.endsWith('/fire/' + county.fireZone)),
    );
    if (!local.length) continue;
    const kind = /warning$/i.test(details.event) ? 'warning' : /watch$/i.test(details.event) ? 'watch' : 'other';
    const alert = { feature, counties: local, kind } satisfies LocalAlert;
    if (activeAlert(alert)) result.push(alert);
  }
  const priority = { warning: 0, watch: 1, other: 2 };
  return result.sort((a, b) => priority[a.kind] - priority[b.kind] ||
    Date.parse(b.feature.properties.sent) - Date.parse(a.feature.properties.sent));
}

export function alertUrl(alert: LocalAlert) {
  const identifier = alert.feature.properties.id;
  return identifier ? api + '/alerts/' + encodeURIComponent(identifier) : nwsAlertsUrl;
}


