export const locationPreferenceKey = 'hamblin-weather-nws-location';

export function weatherPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10_000 });
  });
}

export function weatherCoordinates({ latitude, longitude }: GeolocationCoordinates) {
  return { lat: Number(latitude.toFixed(2)), lon: Number(longitude.toFixed(2)) };
}
