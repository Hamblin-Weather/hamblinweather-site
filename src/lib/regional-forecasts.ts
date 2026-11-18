import { placePoints, temperatureColor } from './forecast-frames';
import layout from '../data/forecast-frame-layout.json';
import { centralZone, getForecast, getPoint, recent, type Forecast, type Period } from './weather';

const frames = Array.from(document.querySelectorAll<HTMLElement>('[data-forecast-frame]'));
const regionalNames = layout.regional.labels.map(([name]) => String(name));
const queue = [...new Set([...regionalNames, ...layout.hometown.flatMap((group) => group.labels.map(([name]) => String(name)))])];
const localDate = new Intl.DateTimeFormat('en-US', {
  timeZone: centralZone, year: 'numeric', month: '2-digit', day: '2-digit',
});
const displayDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric',
});
const day = 24 * 60 * 60_000;
const refreshAfter = 15 * 60_000;
const forecasts = new Map<string, Forecast>();
const urls = new Map<string, string>();
const attempted = new Set<string>();
let lastRequest = 0;
let loading = false;
let nextRollover = Infinity;

function dateAtNoon(date: string) { return new Date(date + 'T12:00:00Z'); }

function localDateKey(timestamp: string) {
  const parts = localDate.formatToParts(new Date(timestamp));
  return ['year', 'month', 'day'].map((part) => parts.find((entry) => entry.type === part)!.value).join('-');
}

function shiftDate(date: string, days: number) {
  return new Date(+dateAtNoon(date) + days * day).toISOString().slice(0, 10);
}

function periodDate(period: Period) {
  // The start of an ongoing NWS overnight period may move past midnight.
  // Date the low by the Central calendar evening before its morning end.
  return period.isDaytime ? localDateKey(period.startTime) : shiftDate(localDateKey(period.endTime), -1);
}

function periodLabel(date: string, daytime: boolean) {
  const start = displayDate.format(dateAtNoon(date));
  return daytime ? start : start + ' overnight into ' + displayDate.format(dateAtNoon(shiftDate(date, 1)));
}

function fahrenheit(period?: Period) {
  if (period?.temperature == null || !Number.isFinite(period.temperature)) return undefined;
  if (period.temperatureUnit === 'F') return Math.round(period.temperature);
  if (period.temperatureUnit === 'C') return Math.round(period.temperature * 9 / 5 + 32);
  return undefined;
}

function selectPeriod(periods: Period[], daytime: boolean, date: string | undefined) {
  return date ? periods.find((period) => period.isDaytime === daytime && periodDate(period) === date) : undefined;
}

function render() {
  nextRollover = Infinity;
  const current = new Map<string, Period[]>();
  const now = Date.now();
  for (const [name, forecast] of forecasts) {
    if (recent(forecast.updateTime, 480)) {
      const periods = forecast.periods.filter((period) => Date.parse(period.endTime) > now);
      current.set(name, periods);
      nextRollover = Math.min(nextRollover, Date.parse(forecast.updateTime) + 480 * 60_000 + 1,
        ...periods.map((period) => Date.parse(period.endTime)));
    }
  }
  function nextDate(daytime: boolean) {
    // Keep the groups synchronized with the region. Fall back to the other
    // verified towns if every regional point is missing for this period.
    const dates = (names: string[]) => names.flatMap((name) => (current.get(name) ?? [])
      .filter((period) => period.isDaytime === daytime).map(periodDate)).sort();
    return dates(regionalNames)[0] ?? dates(queue)[0];
  }
  const highDate = nextDate(true);
  const lowDate = nextDate(false);
  for (const frame of frames) {
    const daytime = frame.dataset.framePeriod === 'highs';
    const date = daytime ? highDate : lowDate;
    const getPeriod = (name: string) => selectPeriod(current.get(name) ?? [], daytime, date);
    const label = date ? periodLabel(date, daytime) : loading && !regionalNames.every((name) => attempted.has(name))
      ? 'Loading forecast period…' : 'Forecast period unavailable';
    frame.dataset.validDate = date ?? '';
    frame.querySelectorAll('[data-frame-date], [data-frame-period-label]').forEach((node) => { node.textContent = label; });
    frame.querySelectorAll<SVGTextElement>('[data-map-value]').forEach((node) => {
      const name = node.getAttribute('data-map-value')!;
      const temp = fahrenheit(getPeriod(name));
      node.textContent = temp != null ? String(temp) : attempted.has(name) ? 'N/A' : '—';
      node.toggleAttribute('data-missing', temp == null);
    });
    frame.querySelectorAll<HTMLElement>('[data-readable-value]').forEach((node) => {
      const name = node.dataset.readableValue!;
      const period = getPeriod(name);
      const temp = fahrenheit(period);
      node.textContent = temp != null ? temp + '°F' : attempted.has(name) ? 'Unavailable' : 'Loading…';
      node.nextElementSibling!.textContent = period?.shortForecast ? ' · ' + period.shortForecast : '';
    });
    const background = frame.querySelector('[data-thermal-background]');
    if (background) {
      const temps = regionalNames.map((name) => fahrenheit(getPeriod(name))).filter((temp) => temp != null);
      const mean = temps.length ? temps.reduce((a, b) => a + b) / temps.length : undefined;
      background.setAttribute('fill', mean == null ? '#414d50' : temperatureColor(mean, .55));
      frame.querySelector('[data-thermal-field]')!.setAttribute('fill', mean == null ? '#7f8c8e' : temperatureColor(mean));
      const washes = frame.querySelectorAll('[data-thermal-wash]');
      frame.querySelectorAll('[data-thermal-town]').forEach((gradient, index) => {
        const temp = fahrenheit(getPeriod(gradient.getAttribute('data-thermal-town')!));
        washes[index].setAttribute('visibility', temp == null ? 'hidden' : 'visible');
        if (temp != null) gradient.querySelectorAll('stop').forEach((stop) => stop.setAttribute('stop-color', temperatureColor(temp)));
      });
    }
  }
}

async function load() {
  if (loading) return;
  loading = true;
  lastRequest = Date.now();
  const requests = new Map<string, Promise<Forecast>>();
  // Prioritize the two regional boards. Share requests when town points map
  // to the same NWS grid and limit concurrent requests across the five frames.
  const batch = 6;
  for (let offset = 0; offset < queue.length; offset += batch) {
    await Promise.all(queue.slice(offset, offset + batch).map(async (name) => {
      try {
        const url = urls.get(name) ?? (await getPoint(placePoints.get(name)!)).forecast;
        urls.set(name, url);
        const pending = requests.get(url) ?? getForecast(url);
        requests.set(url, pending);
        forecasts.set(name, await pending);
      } catch {
        // The previous value can stay until its valid period or freshness expires.
      } finally {
        attempted.add(name);
      }
    }));
    render();
  }
  loading = false;
  render();
  frames[0]?.closest('.forecast-frames')?.setAttribute('data-initial-forecasts-settled', '');
}

for (const frame of frames) {
  const button = frame.querySelector<HTMLButtonElement>('[data-enlarge-frame]')!;
  const dialog = frame.querySelector<HTMLDialogElement>('[data-frame-dialog]')!;
  const viewport = frame.querySelector<HTMLElement>('[data-frame-viewport]')!;
  const canvas = button.querySelector('svg')!;
  button.disabled = false;
  button.addEventListener('click', () => {
    viewport.append(canvas);
    dialog.showModal();
    viewport.scrollTo(Math.round((viewport.scrollWidth - viewport.clientWidth) / 2), 0);
  });
  dialog.addEventListener('close', () => {
    button.append(canvas);
    button.focus({ preventScroll: true });
  });
}

function update() {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() >= nextRollover) render();
  if (Date.now() - lastRequest >= refreshAfter) void load();
}

document.addEventListener('visibilitychange', update);
window.setInterval(update, 30_000);
void load();
