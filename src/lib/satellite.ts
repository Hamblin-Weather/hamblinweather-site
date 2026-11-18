import { recent } from './weather';

const satellite = 'https://nowcoast.noaa.gov/geoserver/observations/satellite/ows';
const layerName = 'goes_longwave_imagery';

export async function getSatelliteTime(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(12_000);
  const response = await fetch(satellite + '?service=WMS&version=1.1.1&request=GetCapabilities', {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error('Satellite capabilities unavailable');
  const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
  const layer = [...xml.querySelectorAll('Layer')].find((node) => node.querySelector(':scope > Name')?.textContent === layerName);
  const time = layer?.querySelector('Extent[name="time"]')?.getAttribute('default') ?? '';
  if (!recent(time, 60)) throw new Error('Satellite time unavailable');
  return time;
}

export function satelliteImageUrl({ box, width, height }: { box: string; width: number; height: number }, time: string) {
  return satellite + '?' + new URLSearchParams({
    bbox: box, width: String(width), height: String(height), srs: 'EPSG:3857', service: 'WMS',
    version: '1.1.1', request: 'GetMap', layers: layerName, format: 'image/png',
    transparent: 'true', time,
  });
}
