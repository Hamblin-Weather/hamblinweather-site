import { defaultCounty, findCounty, savedCounty } from './counties';
import { extendedForecastBoard, extendedForecastStart } from './extended-forecast';
import { outdoorForecasts } from './outdoor-page';
import { getForecast, getPoint } from './weather';
import { locationPreferenceKey, weatherCoordinates, weatherPosition } from './weather-location';

const board = extendedForecastBoard();
const outdoor = outdoorForecasts();
const location = document.querySelector<HTMLElement>('[data-extended-location]')!;
const locationSelect = document.querySelector<HTMLSelectElement>('#forecast-location')!;
const preferredCounty = savedCounty();
const canUseDevice = window.isSecureContext && Boolean(navigator.geolocation);
let deviceCoordinates: ReturnType<typeof weatherCoordinates> | undefined;
let request: AbortController | undefined;
let forecastStart = extendedForecastStart();
let refreshBoard: (() => Promise<void>) | undefined;
let boardCheckedAt = 0;

async function loadForecast(selection = locationSelect.value, notice = '') {
  request?.abort();
  request = new AbortController();
  const { signal } = request;
  refreshBoard = undefined;
  const useDevice = selection === 'device';
  const county = findCounty(selection) ?? defaultCounty;
  const countyLabel = county.place + ' · ' + county.name + ' County';
  const label = useDevice ? 'Your location' : countyLabel + (selection ? '' : ' (default)');
  board.loading();
  outdoor.loading(label, notice);

  let point: Awaited<ReturnType<typeof getPoint>>;
  let coordinates = { lat: county.lat, lon: county.lon };
  try {
    if (useDevice) {
      const device = deviceCoordinates ?? weatherCoordinates((await weatherPosition()).coords);
      if (signal.aborted) return;
      deviceCoordinates = device;
      coordinates = device;
    }
    point = await getPoint(coordinates, signal);
  } catch {
    if (signal.aborted) return;
    if (useDevice) {
      deviceCoordinates = undefined;
      locationSelect.value = preferredCounty?.slug ?? '';
      await loadForecast(locationSelect.value, 'Device location unavailable. Showing ' + (preferredCounty ?? defaultCounty).place + '.');
    } else {
      board.unavailable();
      outdoor.unavailable('Forecast point unavailable for ' + county.place + '.');
    }
    return;
  }
  if (signal.aborted) return;
  const nearby = point.relativeLocation?.properties;
  const pointLabel = useDevice && nearby?.city
    ? 'Near ' + [nearby.city, nearby.state].filter(Boolean).join(', ')
    : label;
  location.textContent = useDevice ? pointLabel : countyLabel;
  outdoor.show({ point, coordinates, signal }, pointLabel);
  async function updateBoard(initial: boolean) {
    boardCheckedAt = Date.now();
    try {
      const forecast = await getForecast(point.forecast, signal);
      if (!signal.aborted) await board.show(forecast, point, signal);
    } catch {
      if (!signal.aborted && initial) board.unavailable();
    }
  }
  refreshBoard = () => updateBoard(false);
  await updateBoard(true);
}

function checkForecastWindow() {
  if (document.hidden) return;
  const start = extendedForecastStart();
  if (start !== forecastStart) {
    forecastStart = start;
    void loadForecast();
  } else if (board.hasPendingLows() && Date.now() - boardCheckedAt >= 15 * 60_000) {
    void refreshBoard?.();
  }
}

function scheduleForecastWindowCheck() {
  window.setTimeout(() => {
    checkForecastWindow();
    scheduleForecastWindowCheck();
  }, 60_000 - Date.now() % 60_000);
}

function start() {
  locationSelect.value = preferredCounty?.slug ?? '';
  locationSelect.querySelector<HTMLOptionElement>('option[value="device"]')!.hidden = !canUseDevice;
  try {
    if (!preferredCounty && canUseDevice && localStorage.getItem(locationPreferenceKey) === '1') {
      locationSelect.value = 'device';
    }
  } catch {
    // Use the county forecast if device location or browser storage is unavailable.
  }
  forecastStart = extendedForecastStart();
  void loadForecast();
  locationSelect.addEventListener('change', () => void loadForecast());
  scheduleForecastWindowCheck();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkForecastWindow();
  });
}

start();
