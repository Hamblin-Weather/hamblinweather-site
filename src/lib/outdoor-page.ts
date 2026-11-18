import { activities, getOutdoorGrid, outdoorDays, outdoorHours, outdoorOutlook, type OutdoorDay } from './outdoor-weather';
import { getForecast, getObservation, getPointAlerts, recent, type Observation, type Point } from './weather';

type ActivityId = typeof activities[number]['id'];
type Location = { point: Point; coordinates: { lat: number; lon: number }; signal: AbortSignal };
const colors = { good: '#6de2b2', fair: '#ffd37b', poor: '#ff9da9', missing: '#9aafd5' };

function getCard(node: HTMLElement) {
  return {
    id: node.dataset.outdoorCard as ActivityId,
    selected: '',
    gauge: node.querySelector<HTMLElement>('[data-gauge]')!,
    score: node.querySelector<HTMLElement>('[data-score]')!,
    place: node.querySelector<HTMLElement>('[data-point-name]')!,
    rating: node.querySelector<HTMLElement>('[data-rating]')!,
    explanation: node.querySelector<HTMLElement>('[data-explanation]')!,
    window: node.querySelector<HTMLElement>('[data-window]')!,
    factors: node.querySelector<HTMLElement>('[data-factors]')!,
    tiles: node.querySelector<HTMLElement>('[data-days]')!,
    days: Array.from(node.querySelectorAll<HTMLButtonElement>('button[data-day]'), (button) => ({
      button,
      weekday: button.querySelector<HTMLElement>('[data-weekday]')!,
      date: button.querySelector<HTMLElement>('[data-date]')!,
      score: button.querySelector<HTMLElement>('[data-day-score]')!,
    })),
  };
}

type Card = ReturnType<typeof getCard>;
type Tile = { score?: number; tone: OutdoorDay['tone']; label: string };

function gauge(card: Card, score: number | undefined, color: string) {
  card.score.textContent = score === undefined ? '—' : String(score);
  card.gauge.style.setProperty('--indicator', color);
  card.gauge.style.setProperty('--amount', (score ?? 0) + '%');
  card.gauge.setAttribute('aria-label', score === undefined ? 'Weather score unavailable' : 'Weather score ' + score + ' out of 100');
}

function fillTiles(card: Card, days: ReturnType<typeof outdoorDays>, values: Tile[]) {
  if (!days.some(({ key }) => key === card.selected)) card.selected = days[0].key;
  card.tiles.hidden = false;
  card.days.forEach(({ button, weekday, date, score }, index) => {
    const day = days[index];
    const value = values[index];
    button.dataset.dateKey = day.key;
    button.setAttribute('aria-pressed', String(day.key === card.selected));
    button.setAttribute('aria-label', day.label + ': ' + value.label);
    button.dataset.tone = value.tone;
    weekday.textContent = index === 0 ? 'Today' : day.weekday;
    date.textContent = day.date;
    score.textContent = value.score === undefined ? '—' : String(value.score);
  });
  return days.findIndex(({ key }) => key === card.selected);
}

export function outdoorForecasts() {
  const root = document.querySelector<HTMLElement>('[data-outdoor]')!;
  const status = root.querySelector<HTMLElement>('[data-outdoor-status]')!;
  const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-outdoor-card]'), getCard);
  let location: Location | undefined;
  let requestedAt = 0;
  let forecastUpdated = '';
  let alertsChecked = 0;
  let hours: ReturnType<typeof outdoorHours> = [];
  let observation: Observation | undefined;
  let alerts: Awaited<ReturnType<typeof getPointAlerts>> | undefined;
  let loading = true;

  const weatherGap = (explanation: string): OutdoorDay => ({
    rating: loading ? 'Loading hourly forecast…' : 'Insufficient data',
    explanation, window: loading ? 'Loading…' : 'Insufficient data', factors: '', tone: 'missing',
  });

  function render() {
    const days = outdoorDays();
    const liveHours = recent(forecastUpdated, 480) ? hours : [];
    const liveAlerts = recent(alertsChecked, 6) ? alerts : undefined;
    const gap = weatherGap(loading ? 'Checking the selected forecast point.' : 'Hourly forecast unavailable for this date.');
    for (const activity of activities) {
      const card = cards.find(({ id }) => id === activity.id)!;
      const outlook = liveHours.length ? outdoorOutlook(activity, days, liveHours, liveAlerts, observation) : days.map(() => gap);
      const selected = fillTiles(card, days, outlook.map(({ score, tone, rating }) => ({
        score, tone, label: score === undefined ? rating : score + ' out of 100, ' + rating,
      })));
      const day = outlook[selected];
      gauge(card, day.score, colors[day.tone]);
      card.rating.textContent = day.rating;
      card.explanation.textContent = day.explanation;
      card.window.textContent = 'Best 2-hour window · ' + day.window;
      card.factors.textContent = day.factors;
      card.factors.hidden = !day.factors;
    }
  }

  function refresh(selected: Location) {
    requestedAt = Date.now();
    const { point, coordinates, signal } = selected;
    const optional = <T>(request: Promise<T>) => request.catch(() => undefined);
    const weather = optional(getForecast(point.forecastHourly, signal));
    const grid = point.forecastGridData ? optional(getOutdoorGrid(point.forecastGridData, signal)) : undefined;
    const rain = optional(getObservation(point.observationStations, AbortSignal.any([signal, AbortSignal.timeout(9000)])));
    const active = optional(getPointAlerts(coordinates, signal));
    void Promise.all([weather, grid, rain, active]).then(([forecast, extras, observed, activeAlerts]) => {
      if (signal.aborted) return;
      forecastUpdated = forecast?.updateTime ?? '';
      hours = forecast ? outdoorHours(forecast.periods, extras) : [];
      observation = observed;
      alerts = activeAlerts;
      alertsChecked = Date.now();
      loading = false;
      render();
    });
  }

  for (const card of cards) {
    for (const { button } of card.days) button.addEventListener('click', () => {
      card.selected = button.dataset.dateKey ?? '';
      render();
    });
  }

  function tick() {
    if (document.hidden) return;
    const interval = alerts === undefined ? 60_000 : 5 * 60_000;
    if (location && !location.signal.aborted && Date.now() - requestedAt >= interval) refresh(location);
    render();
  }
  window.setInterval(tick, 60_000);
  document.addEventListener('visibilitychange', tick);

  return {
    loading(label: string, message = '') {
      location = undefined;
      for (const card of cards) card.place.textContent = label;
      hours = [];
      alerts = undefined;
      loading = true;
      status.textContent = message;
      render();
    },
    show(selected: Location, label: string) {
      for (const card of cards) card.place.textContent = label;
      location = selected;
      refresh(selected);
    },
    unavailable(message: string) {
      status.textContent = message;
      loading = false;
      render();
    },
  };
}
