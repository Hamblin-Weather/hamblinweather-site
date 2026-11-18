import { findCounty, officialForecast, rememberCounty, savedCounty } from './counties';
import { brandedWeatherIcon } from './branded-weather-icon';
import { element } from './dom';
import { path } from './paths';
import { centralTime, centralZone, getPoint, getForecast, getObservation, type Forecast, type Period } from './weather';

const wrapper = document.querySelector<HTMLElement>('#county-forecast')!;
const county = findCounty(wrapper.dataset.county)!;
const selector = document.querySelector<HTMLSelectElement>('#switch-county')!;
const save = document.querySelector<HTMLButtonElement>('#save-county')!;
const saveStatus = document.querySelector<HTMLElement>('#save-county-message')!;
const observation = document.querySelector<HTMLElement>('#observed-data')!;
const observationSymbol = document.querySelector<HTMLImageElement>('.observation-symbol')!;
const near = document.querySelector<HTMLElement>('#near-term')!;
const hourly = document.querySelector<HTMLElement>('#hourly-data')!;
const extended = document.querySelector<HTMLElement>('#extended-data')!;

selector.addEventListener('change', () => {
  const selection = findCounty(selector.value);
  if (selection) window.location.assign(path('forecast/' + selection.slug + '/'));
});
function updateSave() {
  const isSaved = savedCounty()?.slug === county.slug;
  save.textContent = isSaved ? 'Saved county ✓' : 'Save this county';
  save.disabled = isSaved;
}
save.addEventListener('click', () => {
  saveStatus.textContent = rememberCounty(county) ? 'Saved on this device.' : 'This browser could not save your county.';
  updateSave();
});
updateSave();
observationSymbol.addEventListener('error', () => { observationSymbol.hidden = true; });

function fallback(target: HTMLElement, text: string) {
  const link = element('a', 'Official forecast for ' + county.place + ' ↗', 'text-link');
  link.href = officialForecast(county);
  target.replaceChildren(element('p', text, 'muted'), link);
}

function temperature(period: Period) {
  return Number.isFinite(period.temperature) ? period.temperature + '°' + period.temperatureUnit : 'Unavailable';
}

function forecastCards(periods: Period[]) {
  const grid = element('div', '', 'period-grid');
  for (const period of periods) {
    const card = element('div', '', 'period-card');
    card.append(element('h3', period.name), element('strong', temperature(period), 'period-temperature'),
      element('p', period.detailedForecast || period.shortForecast));
    grid.append(card);
  }
  return grid;
}

function renderDaily(data: Forecast) {
  near.replaceChildren(forecastCards(data.periods.slice(0, 2)));
  extended.replaceChildren(forecastCards(data.periods));
}

function renderHourly(data: Forecast) {
  const periods = data.periods.slice(0, 12);
  const numeric = periods.flatMap((period) => typeof period.temperature === 'number' ? [period.temperature] : []);
  const min = numeric.length ? Math.min(...numeric) : 0;
  const spread = Math.max(5, Math.max(...numeric) - min);
  const chart = element('ol', '', 'hourly-grid');
  for (const period of periods) {
    const cell = element('li', '', 'hour');
    const bar = element('span', '', 'hour-bar');
    bar.setAttribute('aria-hidden', 'true');
    if (typeof period.temperature === 'number') bar.style.setProperty('--bar-size', 15 + (period.temperature - min) * 55 / spread + 'px');
    const chance = period.probabilityOfPrecipitation?.value;
    cell.append(element('time', centralTime(period.startTime, false)), bar,
      element('strong', temperature(period)), element('span', period.shortForecast, 'hour-condition'),
      element('small', chance == null ? 'Precip. —' : chance + '% precip.'));
    chart.append(cell);
  }
  hourly.replaceChildren(chart);
}

async function load() {
  try {
    const point = await getPoint(county);
    await Promise.all([
      getForecast(point.forecast).then(renderDaily).catch(() => {
        fallback(near, 'A recent near-term forecast is unavailable.');
        fallback(extended, 'A recent extended forecast is unavailable.');
      }),
      getForecast(point.forecastHourly).then(renderHourly).catch(() => fallback(hourly, 'A recent hourly forecast is unavailable.')),
      getObservation(point.observationStations).then((data) => {
        const conditions = data.text?.trim() || '';
        observation.replaceChildren(element('strong', data.temperature + '°F', 'observed-temperature'));
        if (conditions) observation.append(element('p', conditions));
        const measurements = [
          data.humidity === null ? '' : 'Humidity ' + Math.round(data.humidity) + '%',
          data.windMph === null ? '' : 'Wind ' + data.windMph + ' mph',
        ].filter(Boolean);
        if (measurements.length) observation.append(element('p', measurements.join(' · '), 'source-line'));
        const localHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: centralZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(data.timestamp)));
        const iconName = brandedWeatherIcon(conditions, localHour >= 6 && localHour < 18);
        if (iconName) {
          observationSymbol.src = path('brand/extended/icons/' + iconName + '.png');
          observationSymbol.hidden = false;
        }
      }).catch(() => fallback(observation, 'No recent observation is available from a nearby station.')),
    ]);
  } catch {
    for (const target of [near, hourly, extended, observation]) fallback(target, 'This NWS data could not be loaded.');
  }
}

void load();
