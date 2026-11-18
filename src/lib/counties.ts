import counties from '../data/counties.json';

export { counties };
export type County = (typeof counties)[number];

export const defaultCounty = counties.find((county) => county.slug === 'madison')!;
export const savedCountyKey = 'hamblin-weather-county';

export function findCounty(slug?: string | null) {
  return counties.find((county) => county.slug === slug);
}

export function savedCounty() {
  try {
    return findCounty(localStorage.getItem(savedCountyKey));
  } catch {
    return undefined;
  }
}

export function rememberCounty(county: County) {
  try {
    localStorage.setItem(savedCountyKey, county.slug);
    return true;
  } catch {
    return false;
  }
}

export function forgetCounty() {
  try {
    localStorage.removeItem(savedCountyKey);
  } catch { /* Storage may be disabled. */ }
}

export function officialForecast(county: County) {
  return 'https://forecast.weather.gov/MapClick.php?lat=' + county.lat + '&lon=' + county.lon;
}
