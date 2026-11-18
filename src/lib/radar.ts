import { getJson, recent } from './weather';

const radar = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer';

export type RadarFrame = { time: number; rasterId: number };

export async function getRadarFrames(signal?: AbortSignal) {
  const query = new URLSearchParams({
    where: "idp_subset = 'CONUS' AND category = 1", outFields: 'objectid,idp_subset,idp_validtime', returnGeometry: 'false',
    orderByFields: 'idp_validtime DESC,objectid DESC', resultRecordCount: '24', f: 'json',
  });
  const data = await getJson<{ features?: { attributes: { objectid: number; idp_subset: string; idp_validtime: number } }[] }>(radar + '/query?' + query, signal);
  const scans = new Map<number, RadarFrame>();
  for (const { attributes: { objectid, idp_subset, idp_validtime } } of data.features ?? []) {
    if (idp_subset !== 'CONUS' || !Number.isInteger(objectid) || objectid <= 0 || !Number.isFinite(idp_validtime) ||
        !recent(idp_validtime, 120) || scans.has(idp_validtime)) continue;
    scans.set(idp_validtime, { time: idp_validtime, rasterId: objectid });
  }
  const frames = [...scans.values()].sort((a, b) => b.time - a.time).slice(0, 9).reverse();
  if (!frames.length) throw new Error('No recent radar frames');
  return frames;
}

export function radarImageUrl({ box, width, height }: { box: string; width: number; height: number }, frame: RadarFrame) {
  return radar + '/exportImage?' + new URLSearchParams({
    bbox: box, bboxSR: '3857', imageSR: '3857', size: width + ',' + height, adjustAspectRatio: 'false',
    format: 'png32', f: 'image', time: String(frame.time),
    mosaicRule: JSON.stringify({ mosaicMethod: 'esriMosaicLockRaster', lockRasterIds: [frame.rasterId] }),
  });
}
