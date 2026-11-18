export function brandedWeatherIcon(conditions: string, daytime = true) {
  if (/thunder/i.test(conditions)) return 'thunderstorm';
  if (/snow|sleet|flurr|freezing/i.test(conditions)) return '';
  if (/rain|shower|drizzle/i.test(conditions)) return 'rain';
  if (daytime && /partly (?:cloudy|sunny)|mostly (?:sunny|clear)/i.test(conditions)) return 'partly_cloudy';
  if (/cloud|overcast|fog|haze/i.test(conditions)) return 'cloudy';
  if (daytime && /clear|sunny|\bfair\b/i.test(conditions)) return 'sunny';
  return '';
}
