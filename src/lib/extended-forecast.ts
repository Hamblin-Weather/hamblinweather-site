import { brandedWeatherIcon } from './branded-weather-icon';
import { centralZone, getJson, recent, type Forecast, type Period } from './weather';

const calendarOptions = { year: 'numeric', month: '2-digit', day: '2-digit' } as const;
const centralClock = new Intl.DateTimeFormat('en-CA', {
  ...calendarOptions, timeZone: centralZone, hour: 'numeric', hourCycle: 'h23',
});
const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' });
const fullDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
const dateRange = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
const dayMs = 86_400_000;

type Temperature = Pick<Period, 'temperature' | 'temperatureUnit'>;
type GridTemperature = {
  uom: string;
  values: { validTime: string; value: number | null }[];
};
type PendingLow = { cell: Element; start?: number };

function dateKey(parts: Intl.DateTimeFormatPart[]) {
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)!.value).join('-');
}

function previousDate(key: string) {
  return new Date(Date.parse(key + 'T00:00:00Z') - dayMs).toISOString().slice(0, 10);
}

export function extendedForecastStart(now = Date.now()) {
  const parts = centralClock.formatToParts(now);
  const today = dateKey(parts);
  const hour = Number(parts.find((part) => part.type === 'hour')!.value);
  if (hour < 15) return today;
  return new Date(Date.parse(today + 'T00:00:00Z') + dayMs).toISOString().slice(0, 10);
}

function setTemperature(node: Element, period?: Temperature) {
  const value = period?.temperature;
  const digits = typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : '—';
  node.querySelector('[data-number]')!.textContent = digits;
  const unit = period?.temperatureUnit;
  node.querySelector('.extended-unit')!.textContent = digits === '—' ? ' unavailable'
    : unit === 'F' ? ' degrees Fahrenheit' : unit === 'C' ? ' degrees Celsius' : ' degrees';
  node.toggleAttribute('data-wide', digits.length > 2);
  node.toggleAttribute('data-missing', digits === '—');
  node.removeAttribute('title');
}

function gridTemperatures(series?: GridTemperature) {
  if (series?.uom !== 'wmoUnit:degC' && series?.uom !== 'wmoUnit:degF') return [];
  return series.values.flatMap(({ validTime, value }) => {
    const [date, duration] = validTime.split('/');
    const start = Date.parse(date);
    const length = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(duration);
    if (!length || value === null || !Number.isFinite(value) || !Number.isFinite(start)) return [];
    const minutes = Number(length[1] ?? 0) * 1440 + Number(length[2] ?? 0) * 60 + Number(length[3] ?? 0);
    if (!minutes) return [];
    return [{ start, end: start + minutes * 60_000, fahrenheit: series.uom === 'wmoUnit:degC' ? value * 9 / 5 + 32 : value }];
  }).sort((a, b) => a.start - b.start);
}

function gridOvernightLow(values: ReturnType<typeof gridTemperatures>, start: number, clock: Intl.DateTimeFormat) {
  const hourMs = 3_600_000;
  let end = start + hourMs;
  while (end - start <= 16 * hourMs && Number(clock.format(end)) !== 6) end += hourMs;
  if (end - start > 16 * hourMs) return;
  let covered = start;
  let lowest = Infinity;
  for (const interval of values) {
    if (interval.end <= covered) continue;
    if (interval.start > covered || interval.start >= end) break;
    lowest = Math.min(lowest, interval.fahrenheit);
    covered = interval.end;
    if (covered >= end) return lowest;
  }
}

export function extendedForecastBoard() {
  const section = document.querySelector<HTMLElement>('[data-extended-forecast]')!;
  const content = section.querySelector<HTMLElement>('[data-extended-content]')!;
  const status = section.querySelector<HTMLElement>('[data-extended-status]')!;
  const days = [...content.querySelectorAll('.extended-day')];
  for (const symbol of content.querySelectorAll<HTMLImageElement>('.extended-icon')) {
    symbol.addEventListener('error', () => { symbol.hidden = true; });
  }

  function setStatus(message: string) {
    status.hidden = false;
    status.textContent = message;
    content.hidden = true;
  }

  return {
    loading() { setStatus('Loading extended forecast…'); },
    unavailable() { setStatus('Extended forecast unavailable.'); },
    hasPendingLows() { return !content.hidden && Boolean(content.querySelector('[data-low][data-missing]')); },
    async show(forecast: Forecast, point: { forecastGridData?: string; timeZone?: string }, signal: AbortSignal) {
      const start = extendedForecastStart();
      const first = Date.parse(start + 'T00:00:00Z');
      const end = new Date(first + 6 * dayMs).toISOString().slice(0, 10);
      const calendar = new Intl.DateTimeFormat('en-CA', { ...calendarOptions, timeZone: point.timeZone ?? centralZone });
      const localDay = (timestamp: number) => dateKey(calendar.formatToParts(timestamp));
      const periods = [...forecast.periods].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
      const byDate = (daytime: boolean) => {
        const map = new Map<string, Period>();
        for (const period of periods) {
          if (period.isDaytime !== daytime) continue;
          // NWS can move the start of a still-active night period past midnight.
          const key = daytime ? localDay(Date.parse(period.startTime)) : previousDate(localDay(Date.parse(period.endTime)));
          if (!map.has(key)) map.set(key, period);
        }
        return map;
      };
      const highs = byDate(true);
      const lows = byDate(false);
      if (![...highs.keys(), ...lows.keys()].some((key) => key >= start && key <= end)) {
        return setStatus('Extended forecast unavailable.');
      }
      const missingHighs = new Map<string, Element>();
      const missingLows = new Map<string, PendingLow>();
      const badgeRoot = content.querySelector<HTMLElement>('[data-badge-root]')!.dataset.badgeRoot!;
      content.querySelector('[data-extended-range]')!.textContent = dateRange.formatRange(first, first + 6 * dayMs);
      days.forEach((day, index) => {
        const date = new Date(first + index * dayMs);
        const key = date.toISOString().slice(0, 10);
        const high = highs.get(key);
        const low = lows.get(key);
        const label = day.querySelector('time')!;
        label.dateTime = key;
        label.textContent = fullDate.format(date);
        day.querySelector<HTMLImageElement>('.extended-badge')!.src = badgeRoot + weekday.format(date).toLowerCase() + '.png';
        const highCell = day.querySelector('[data-high]')!;
        const lowCell = day.querySelector('[data-low]')!;
        setTemperature(highCell, high);
        setTemperature(lowCell, low);
        if (high?.temperature == null) missingHighs.set(key, highCell);
        if (low?.temperature == null) missingLows.set(key, { cell: lowCell, start: high ? Date.parse(high.endTime) : undefined });
        const outlook = high ?? low;
        const conditions = day.querySelector('.extended-conditions')!;
        conditions.textContent = outlook?.shortForecast || 'Conditions unavailable';
        const longLabel = conditions.textContent.length > 29 || /\S{13}/.test(conditions.textContent);
        conditions.toggleAttribute('data-long', longLabel);
        const icon = brandedWeatherIcon(outlook?.shortForecast || '', outlook?.isDaytime);
        const symbol = day.querySelector<HTMLImageElement>('.extended-icon')!;
        symbol.hidden = !icon;
        if (icon) symbol.src = badgeRoot + 'icons/' + icon + '.png';
        else symbol.removeAttribute('src');
      });
      status.hidden = true;
      content.hidden = false;
      if (!point.forecastGridData || (!missingHighs.size && !missingLows.size)) return;
      try {
        const { properties } = await getJson<{
          properties: { updateTime: string; maxTemperature?: GridTemperature; minTemperature?: GridTemperature; temperature?: GridTemperature };
        }>(point.forecastGridData, signal);
        if (signal.aborted || !recent(properties.updateTime, 480)) return;
        for (const { start: valid, fahrenheit } of gridTemperatures(properties.maxTemperature)) {
          const key = localDay(valid);
          const cell = missingHighs.get(key);
          if (!cell) continue;
          setTemperature(cell, { temperature: fahrenheit, temperatureUnit: 'F' });
          missingHighs.delete(key);
        }
        for (const { end: valid, fahrenheit } of gridTemperatures(properties.minTemperature)) {
          const key = previousDate(localDay(valid));
          const pending = missingLows.get(key);
          if (!pending) continue;
          setTemperature(pending.cell, { temperature: fahrenheit, temperatureUnit: 'F' });
          missingLows.delete(key);
        }
        const hours = gridTemperatures(properties.temperature);
        const nightClock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: point.timeZone ?? centralZone });
        for (const { cell, start: nightStart } of missingLows.values()) {
          if (nightStart === undefined) continue;
          // A partial evening can miss the coldest part of the night.
          const minimum = gridOvernightLow(hours, nightStart, nightClock);
          if (minimum === undefined) continue;
          setTemperature(cell, { temperature: minimum, temperatureUnit: 'F' });
          cell.setAttribute('title', 'Lowest temperature in the full overnight NWS hourly grid');
        }
      } catch {
        // Keep the published day and night forecast when the grid feed is unavailable.
      }
    },
  };
}
