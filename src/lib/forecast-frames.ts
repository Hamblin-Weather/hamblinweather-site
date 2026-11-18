import coordinates from '../data/forecast-frame-points.json';
import { counties } from './counties';

export const placePoints = new Map(Object.entries(coordinates).map(([name, [lat, lon]]) => {
  const existing = counties.find((county) => county.place === name);
  return [name, existing ? { lat: existing.lat, lon: existing.lon } : { lat, lon }] as const;
}));

export const temperatureStops: [number, string][] = [
  [0, '#1533ed'], [10, '#337bf5'], [20, '#49b8f4'], [30, '#67e2eb'],
  [40, '#80fbd2'], [47, '#40df86'], [50, '#5ce266'], [55, '#b5f54a'],
  [60, '#d9f643'], [70, '#ffed43'], [80, '#ff9f37'], [90, '#ff512a'], [100, '#e51835'],
];

export function temperatureColor(temp: number, brightness = 1) {
  const end = temperatureStops.findIndex(([threshold]) => threshold >= temp);
  const hi = end < 0 ? temperatureStops.length - 1 : end;
  const [t0, low] = temperatureStops[Math.max(0, hi - 1)];
  const [t1, high] = temperatureStops[hi];
  const f = t1 === t0 ? 1 : Math.max(0, Math.min(1, (temp - t0) / (t1 - t0)));
  const channels = [1, 3, 5].map((i) => Math.round(brightness * (
    parseInt(low.slice(i, i + 2), 16) * (1 - f) + parseInt(high.slice(i, i + 2), 16) * f
  )));
  return `rgb(${channels.join(' ')})`;
}
