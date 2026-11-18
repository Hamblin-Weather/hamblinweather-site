import { defaultCounty, findCounty, forgetCounty, rememberCounty, savedCounty, type County } from './counties';
import { centralZone, getForecast, getObservation, getPoint, WeatherHttpError, type Observation, type Period } from './weather';
import { path } from './paths';
import { brandedWeatherIcon } from './branded-weather-icon';
import { locationPreferenceKey, weatherCoordinates, weatherPosition } from './weather-location';

const select = document.querySelector<HTMLSelectElement>('#home-county')!;
const form = document.querySelector<HTMLFormElement>('#home-county-form')!;
const location = document.querySelector<HTMLElement>('#home-location')!;
const locateButton = document.querySelector<HTMLButtonElement>('#use-home-location')!;
const locationStatus = document.querySelector<HTMLElement>('#home-location-status')!;
const actionLabel = document.querySelector<HTMLElement>('#home-forecast-action')!;
const forecastPeriod = document.querySelector<HTMLElement>('#home-forecast-period')!;
const forecastReading = document.querySelector<HTMLElement>('#home-forecast-reading')!;
const value = document.querySelector<HTMLElement>('#home-weather-value')!;
const summary = document.querySelector<HTMLElement>('#home-weather-summary')!;
const observed = document.querySelector<HTMLElement>('#home-observed-value')!;
const observedSummary = document.querySelector<HTMLElement>('#home-observed-summary')!;
const observedDetails = document.querySelector<HTMLElement>('#home-observed-details')!;
const observedIcon = document.querySelector<HTMLImageElement>('#home-observed-icon')!;
const forecastIcon = document.querySelector<HTMLImageElement>('#home-forecast-icon')!;
let currentRequest: AbortController | undefined;
let locationRequest = 0;

for (const icon of [observedIcon, forecastIcon]) {
  icon.addEventListener('error', () => { icon.hidden = true; });
}

function startWeather(currentLoading: string) {
  currentRequest?.abort();
  const request = new AbortController();
  currentRequest = request;
  forecastReading.removeAttribute('data-night');
  forecastPeriod.textContent = 'Forecast';
  value.textContent = '—';
  summary.textContent = 'Loading local forecast…';
  observed.textContent = '—';
  observedSummary.textContent = currentLoading;
  observedDetails.hidden = true;
  observedIcon.hidden = true;
  forecastIcon.hidden = true;
  return request.signal;
}

function showIcon(image: HTMLImageElement, description: string, daytime: boolean) {
  const name = brandedWeatherIcon(description, daytime);
  image.hidden = !name;
  if (name) image.src = path('brand/extended/icons/' + name + '.png');
  else image.removeAttribute('src');
}

function showForecast(period: Period) {
  forecastReading.toggleAttribute('data-night', !period.isDaytime);
  const temperatureKind = period.isDaytime ? 'high' : 'low';
  const label = period.name === 'Today' || period.name === 'Tonight'
    ? period.name + '’s ' + temperatureKind
    : period.name + ' · ' + temperatureKind;
  forecastPeriod.textContent = label;
  if (period.temperature !== null) value.textContent = Math.round(period.temperature) + '°' + period.temperatureUnit;
  summary.textContent = period.shortForecast;
  showIcon(forecastIcon, period.shortForecast, period.isDaytime);
}

function showCurrent({ temperature, text, windMph, humidity, timestamp }: Observation, timeZone: string) {
  observed.textContent = Math.round(temperature) + '°F';
  observedSummary.textContent = text || 'Station observation';
  const details = [
    typeof windMph === 'number' ? 'Wind ' + Math.round(windMph) + ' mph' : '',
    typeof humidity === 'number' ? 'Humidity ' + Math.round(humidity) + '%' : '',
  ].filter(Boolean);
  observedDetails.textContent = details.join(' · ');
  observedDetails.hidden = details.length === 0;
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(timestamp)));
  showIcon(observedIcon, text, hour >= 6 && hour < 18);
}

async function loadNwsWeather(coordinates: Pick<County, 'lat' | 'lon'>, signal: AbortSignal, device?: { county?: County }) {
  const forecastUnavailable = () => {
    if (signal.aborted) return;
    summary.textContent = 'Forecast unavailable';
  };
  const observationUnavailable = () => {
    if (signal.aborted) return;
    observedSummary.textContent = 'Recent observation unavailable';
  };

  try {
    const point = await getPoint(coordinates, signal);
    if (signal.aborted) return;
    const nearby = point.relativeLocation?.properties;
    if (device && nearby?.city) {
      const place = [nearby.city, nearby.state].filter(Boolean).join(', ');
      location.textContent = 'Near ' + place + (device.county ? ' · ' + device.county.name + ' County' : '');
    }
    await Promise.all([
      getForecast(point.forecast, signal).then((data) => {
        if (!signal.aborted) showForecast(data.periods[0]);
      }).catch(forecastUnavailable),
      getObservation(point.observationStations, signal).then((data) => {
        if (signal.aborted) return;
        showCurrent(data, point.timeZone ?? centralZone);
      }).catch(observationUnavailable),
    ]);
  } catch (error) {
    forecastUnavailable();
    observationUnavailable();
    if (!signal.aborted && device && error instanceof WeatherHttpError && error.status === 404) {
      summary.textContent = 'No NWS forecast for this location';
    }
  }
}

function showCountyWeather() {
  const county = findCounty(select.value) ?? defaultCounty;
  const signal = startWeather('Loading station observation…');
  location.textContent = county.place + ' · ' + county.name + ' County';
  actionLabel.textContent = 'Get forecast';
  return loadNwsWeather(county, signal);
}

function showDeviceWeather(coords: GeolocationCoordinates, county?: County) {
  const signal = startWeather('Loading current conditions…');
  location.textContent = county ? 'Your location · ' + county.name + ' County' : 'Your location';
  actionLabel.textContent = 'Refresh forecast';
  return loadNwsWeather(weatherCoordinates(coords), signal, { county });
}

async function useLocation() {
  if (locateButton.disabled) return;
  const request = ++locationRequest;
  locateButton.disabled = true;
  locationStatus.textContent = 'Finding your location…';

  try {
    const { coords } = await weatherPosition();
    if (request !== locationRequest) return;
    const boundaries = await import('./county-location').catch(() => undefined);
    if (request !== locationRequest) return;
    const county = boundaries?.countyAtLocation(coords.longitude, coords.latitude);
    forgetCounty();
    try { localStorage.setItem(locationPreferenceKey, '1'); } catch { /* Storage may be disabled. */ }
    locationStatus.textContent = '';
    select.value = '';
    void showDeviceWeather(coords, county);
  } catch (error) {
    if (request !== locationRequest) return;
    const denied = typeof error === 'object' && error !== null && 'code' in error && error.code === 1;
    locationStatus.textContent = denied ? 'Location access is off. You can choose a county above.'
      : 'We couldn’t find your location. Try again or choose a county above.';
  } finally {
    if (request === locationRequest) locateButton.disabled = false;
  }
}

const preferredCounty = savedCounty();
select.value = (preferredCounty ?? defaultCounty).slug;
select.addEventListener('change', () => {
  locationRequest++;
  locateButton.disabled = false;
  locationStatus.textContent = '';
  const county = findCounty(select.value);
  if (county) rememberCounty(county);
  void showCountyWeather();
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!select.value) {
    void useLocation();
    return;
  }
  const county = findCounty(select.value);
  if (!county) return;
  rememberCounty(county);
  window.location.assign(path('forecast/' + county.slug + '/'));
});
void showCountyWeather();
if (window.isSecureContext && navigator.geolocation) {
  locateButton.hidden = false;
  locateButton.addEventListener('click', () => void useLocation());
  try {
    if (!preferredCounty && localStorage.getItem(locationPreferenceKey) === '1') void useLocation();
  } catch { /* Storage may be disabled. */ }
}
