import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';
import coverage from '../data/coverage.geo.json';
import { findCounty } from './counties';
import { activeAlert, alertUrl, centralTime, getAlerts, getJson, type LocalAlert } from './weather';
import { element } from './dom';
import { getRadarFrames, radarImageUrl, type RadarFrame } from './radar';
import { getSatelliteTime, satelliteImageUrl } from './satellite';

const outlook = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer/1/query';
const layerInfo = {
  radar: ['Official NOAA radar ↗', 'https://radar.weather.gov/'],
  satellite: ['Official NOAA satellite ↗', 'https://www.weather.gov/satellite'],
  outlook: ['Official SPC outlook ↗', 'https://www.spc.noaa.gov/products/outlook/'],
};
type Mode = keyof typeof layerInfo;

const mapElement = document.querySelector<HTMLElement>('#weather-map')!;
const layerInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="map-layer"]'));
const countySelect = document.querySelector<HTMLSelectElement>('#map-county')!;
const controls = document.querySelector<HTMLElement>('#radar-controls')!;
const slider = document.querySelector<HTMLInputElement>('#radar-frame')!;
const play = document.querySelector<HTMLButtonElement>('#radar-play')!;
const output = document.querySelector<HTMLOutputElement>('#radar-time')!;
const radarNotice = document.querySelector<HTMLElement>('#radar-notice')!;
const status = document.querySelector<HTMLElement>('#map-status')!;
const official = document.querySelector<HTMLAnchorElement>('#map-official')!;
const alertToggle = document.querySelector<HTMLInputElement>('#alert-overlay-toggle')!;
const alertControl = document.querySelector<HTMLElement>('#alert-overlay-control')!;
const alertReadout = document.querySelector<HTMLElement>('#alert-overlay-readout')!;
const alertStatus = document.querySelector<HTMLElement>('#alert-overlay-status')!;
const map = L.map(mapElement, { zoomSnap: 0.5, minZoom: 5, maxZoom: 10, scrollWheelZoom: true });
map.attributionControl.setPrefix(false);
map.attributionControl.addAttribution('County boundaries · U.S. Census Bureau');
const base = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  className: 'basemap', keepBuffer: 1,
}).addTo(map);
map.createPane('weather-image').style.zIndex = '320';
map.createPane('radar-alerts').style.zIndex = '430';
const alertPolygons = L.layerGroup();
let alertRequest: AbortController | undefined;
let alertExpiry: number | undefined;

const boundaries = L.geoJSON(coverage as FeatureCollection, {
  style: { color: '#3046a4', weight: 1.4, opacity: 0.72, fillColor: '#a4b1ee', fillOpacity: 0.08 },
  onEachFeature(feature, layer) {
    const county = findCounty(feature.properties?.slug);
    if (county) layer.bindTooltip(county.name + ' County', { sticky: true });
  },
}).addTo(map);
const fit = () => map.fitBounds(boundaries.getBounds(), { padding: [28, 28], maxZoom: 8.5, animate: false });
fit();
const parameters = new URLSearchParams(window.location.search);
let mode = layerInputs.some((input) => input.value === parameters.get('layer')) ? parameters.get('layer') as Mode : 'radar';
let frames: RadarFrame[] = [];
let frame = 0;
let satelliteTime = '';
let timer: number | undefined;
let imageTimeout: number | undefined;
let playing = false;
let image: L.ImageOverlay | undefined;
let displayedRadarTime: number | undefined;
let pending: L.ImageOverlay | undefined;
let imageRevision = 0;
let vectors: L.Layer | undefined;
let request: AbortController | undefined;

function stop() {
  window.clearTimeout(timer);
  timer = undefined;
  playing = false;
  play.querySelector('span')!.textContent = 'Play';
}

function setRadarNotice(message = '') {
  radarNotice.hidden = !message;
  if (radarNotice.textContent !== message) radarNotice.textContent = message;
}

function clearImage() {
  imageRevision++;
  window.clearTimeout(imageTimeout);
  image?.remove();
  pending?.remove();
  image = undefined;
  displayedRadarTime = undefined;
  setRadarNotice();
  pending = undefined;
}

function bbox() {
  const bounds = map.getBounds();
  const sw = L.CRS.EPSG3857.project(bounds.getSouthWest());
  const ne = L.CRS.EPSG3857.project(bounds.getNorthEast());
  const size = map.getSize();
  const scale = Math.min(1, 1200 / Math.max(size.x, size.y));
  return { bounds, box: [sw.x, sw.y, ne.x, ne.y].join(','), width: Math.round(size.x * scale), height: Math.round(size.y * scale) };
}

function hasNoRadarEchoes(image: HTMLImageElement) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context || !canvas.width || !canvas.height) return false;
  try {
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let alpha = 3; alpha < data.length; alpha += 4) {
      if (data[alpha]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function drawImage() {
  if (mode !== 'radar' && mode !== 'satellite') return;
  if (mode === 'radar' && !frames.length || mode === 'satellite' && !satelliteTime) return;
  const revision = ++imageRevision;
  window.clearTimeout(timer);
  window.clearTimeout(imageTimeout);
  pending?.remove();
  const { bounds, box, width, height } = bbox();
  const isRadar = mode === 'radar';
  const view = { box, width, height };
  const url = isRadar ? radarImageUrl(view, frames[frame]) : satelliteImageUrl(view, satelliteTime);
  const frameTime = isRadar ? frames[frame].time : satelliteTime;
  const candidate = L.imageOverlay(url, bounds, { pane: 'weather-image', opacity: 0, alt: '', crossOrigin: isRadar });
  pending = candidate;
  const done = (loaded: boolean) => {
    if (revision !== imageRevision) return;
    imageRevision++;
    window.clearTimeout(imageTimeout);
    pending = undefined;
    if (loaded) {
      image?.remove();
      image = candidate.setOpacity(isRadar ? 0.87 : 0.68);
      if (isRadar) {
        displayedRadarTime = Number(frameTime);
        output.textContent = centralTime(displayedRadarTime);
        setRadarNotice(hasNoRadarEchoes(candidate.getElement()!) ? 'No radar echoes in this view' : '');
        status.textContent = 'NOAA/NWS base reflectivity · ' + frames.length + ' available frames';
        if (playing) timer = window.setTimeout(advance, frame === frames.length - 1 ? 1450 : 700);
      } else {
        status.textContent = 'NOAA nowCOAST · GOES longwave infrared · ' + centralTime(frameTime);
      }
    } else {
      candidate.remove();
      stop();
      if (image) {
        if (isRadar) setRadarNotice('Showing the last loaded radar frame');
        status.textContent = 'This map image is unavailable. Showing the last loaded image.';
        if (displayedRadarTime !== undefined) {
          const previous = frames.findIndex(({ time }) => time === displayedRadarTime);
          if (previous !== -1) {
            frame = previous;
            slider.value = String(frame);
          }
        }
      } else {
        status.textContent = 'This map image is unavailable. Open the official provider below.';
        if (isRadar) {
          output.textContent = 'Frame unavailable';
          setRadarNotice('Radar unavailable');
        }
      }
    }
  };
  candidate.once('load', () => done(true));
  candidate.once('error', () => done(false));
  imageTimeout = window.setTimeout(() => done(false), 12_000);
  candidate.addTo(map);
}

async function loadRadar(signal: AbortSignal, refreshing = false) {
  const available = await getRadarFrames(signal);
  if (signal.aborted || refreshing && playing) return;
  frames = available;
  frame = frames.length - 1;
  slider.max = String(frame);
  slider.value = String(frame);
  slider.disabled = frames.length < 2;
  play.disabled = frames.length < 2;
  drawImage();
}

async function loadSatellite(signal: AbortSignal) {
  const time = await getSatelliteTime(signal);
  if (signal.aborted) return;
  satelliteTime = time;
  drawImage();
}

function renderAlertOverlay(alerts: LocalAlert[], checked: number) {
  const active = alerts.filter(activeAlert);
  alertPolygons.clearLayers();
  let count = 0;
  for (const alert of active) {
    if (!alert.feature.geometry || !['Polygon', 'MultiPolygon'].includes(alert.feature.geometry.type)) continue;
    const details = alert.feature.properties;
    const color = { warning: '#ba3439', watch: '#aa6500', other: '#4b57a0' }[alert.kind];
    const popup = element('div');
    const link = element('a', 'Official NWS details ↗');
    link.href = alertUrl(alert);
    popup.append(element('strong', details.event), element('p', details.areaDesc), link);
    L.geoJSON(alert.feature, { pane: 'radar-alerts', style: { color, weight: 2, fillOpacity: 0.2 } })
      .bindPopup(popup).addTo(alertPolygons);
    count++;
  }
  alertStatus.textContent = count
    ? count + ' official alert ' + (count === 1 ? 'polygon' : 'polygons') + ' · ' + active.length + ' active local alerts.'
    : active.length ? 'Active local alerts have no drawable polygons. Open the official alert text below.'
      : 'No active NWS alerts in the coverage area · Checked ' + centralTime(checked) + '.';
  window.clearTimeout(alertExpiry);
  const nextExpiry = active.reduce((soonest, alert) => {
    const { expires, ends } = alert.feature.properties;
    return Math.min(soonest, Date.parse(expires), ends ? Date.parse(ends) : Infinity);
  }, Infinity);
  if (Number.isFinite(nextExpiry)) {
    alertExpiry = window.setTimeout(() => renderAlertOverlay(active, checked), Math.max(1, nextExpiry - Date.now()));
  }
}

async function refreshAlertOverlay() {
  if (!map.hasLayer(alertPolygons) || alertRequest) return;
  const controller = new AbortController();
  alertRequest = controller;
  try {
    const alerts = await getAlerts(controller.signal);
    if (!controller.signal.aborted) renderAlertOverlay(alerts, Date.now());
  } catch {
    if (!controller.signal.aborted) {
      window.clearTimeout(alertExpiry);
      alertPolygons.clearLayers();
      alertStatus.textContent = 'Official alert polygons are unavailable. Open the official alert text below.';
    }
  } finally {
    if (alertRequest === controller) alertRequest = undefined;
  }
}

function syncAlertOverlay() {
  const onRadar = mode === 'radar';
  const enabled = onRadar && alertToggle.checked;
  alertControl.hidden = !onRadar;
  alertReadout.hidden = !enabled;
  if (enabled) {
    if (!map.hasLayer(alertPolygons)) {
      alertPolygons.addTo(map);
      alertStatus.textContent = 'Checking official alert polygons…';
      void refreshAlertOverlay();
    }
  } else {
    alertRequest?.abort();
    alertRequest = undefined;
    window.clearTimeout(alertExpiry);
    alertPolygons.clearLayers();
    alertPolygons.remove();
  }
}

const risks: Record<number, string> = { 2: '#64a965', 3: '#287147', 4: '#d6a52e', 5: '#de7a35', 6: '#c3444a', 8: '#a04b91' };

async function loadOutlook(signal: AbortSignal) {
  const query = new URLSearchParams({
    where: '1=1', outFields: 'dn,label,valid,expire', outSR: '4326', maxAllowableOffset: '0.005', f: 'geojson',
  });
  const data = await getJson<FeatureCollection<Geometry, GeoJsonProperties>>(outlook + '?' + query, signal);
  if (signal.aborted) return;
  if (!Array.isArray(data.features)) throw new Error('Outlook response incomplete');
  const from = (value: string | number) => {
    const text = String(value);
    if (/^\d{12}$/.test(text)) return Date.UTC(+text.slice(0, 4), +text.slice(4, 6) - 1, +text.slice(6, 8), +text.slice(8, 10), +text.slice(10, 12));
    if (typeof value === 'number') return value;
    return Date.parse(text);
  };
  const active = data.features.filter((item) => item.properties && from(item.properties.expire) > Date.now());
  if (data.features.length && !active.length) throw new Error('Outlook update unavailable');
  const current: FeatureCollection = { type: 'FeatureCollection', features: active };
  vectors = L.geoJSON(current, {
    style: (feature) => ({ color: risks[Number(feature?.properties?.dn)] ?? '#397864', weight: 2, fillOpacity: 0.22 }),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindPopup(element('div', (p?.label ?? 'Convective outlook') + ' · Valid ' + centralTime(from(p?.valid)) + ' to ' + centralTime(from(p?.expire))));
    },
  }).addTo(map);
  status.textContent = active.length
    ? 'NOAA/SPC Day 1 categorical outlook · Valid through ' + centralTime(from(active[0].properties?.expire))
    : 'NOAA/SPC returned no Day 1 outlook shapes. See the official outlook below.';
}

const loadLayer = { radar: loadRadar, satellite: loadSatellite, outlook: loadOutlook };

async function show(next: Mode) {
  mode = next;
  request?.abort();
  const controller = new AbortController();
  request = controller;
  stop();
  clearImage();
  vectors?.remove();
  vectors = undefined;
  frames = [];
  satelliteTime = '';
  for (const input of layerInputs) input.checked = input.value === mode;
  controls.hidden = mode !== 'radar';
  syncAlertOverlay();
  play.disabled = true;
  slider.disabled = true;
  output.textContent = 'Awaiting radar frames';
  document.querySelectorAll<HTMLElement>('[data-legend]').forEach((node) => { node.hidden = node.dataset.legend !== mode; });
  [official.textContent, official.href] = layerInfo[mode];
  status.textContent = 'Loading weather layer…';
  try {
    await loadLayer[mode](controller.signal);
  } catch {
    if (!controller.signal.aborted) {
      status.textContent = 'This weather layer is unavailable. Open the official provider below.';
      if (next === 'radar') {
        output.textContent = 'Frame unavailable';
        setRadarNotice('Radar unavailable');
      }
    }
  }
}

function advance() {
  frame = (frame + 1) % frames.length;
  slider.value = String(frame);
  drawImage();
}

play.addEventListener('click', () => {
  if (playing) stop();
  else {
    playing = true;
    play.querySelector('span')!.textContent = 'Pause';
    advance();
  }
});
slider.addEventListener('input', () => {
  stop();
  frame = Number(slider.value);
  drawImage();
});
for (const input of layerInputs) input.addEventListener('change', () => {
  if (input.checked) void show(input.value as Mode);
});
countySelect.addEventListener('change', () => {
  const county = findCounty(countySelect.value);
  if (county) map.setView([county.lat, county.lon], 9, { animate: false });
  else fit();
});
alertToggle.addEventListener('change', syncAlertOverlay);
map.on('moveend', drawImage);
window.setInterval(() => {
  if (document.visibilityState === 'visible') void refreshAlertOverlay();
}, 60_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && map.hasLayer(alertPolygons)) {
    window.clearTimeout(alertExpiry);
    alertPolygons.clearLayers();
    alertStatus.textContent = 'Checking official alert polygons…';
    void refreshAlertOverlay();
  }
});
window.setInterval(() => {
  if (document.visibilityState !== 'visible' || playing) return;
  if (mode === 'radar' && image && request) {
    const { signal } = request;
    void loadRadar(signal, true).catch(() => {
      if (!signal.aborted && !playing) {
        setRadarNotice('Showing the last loaded radar frame');
        status.textContent = 'Radar update unavailable. Showing the last loaded image.';
      }
    });
  } else {
    void show(mode);
  }
}, 180_000);
base.on('tileerror', () => {
  document.querySelector<HTMLElement>('#basemap-status')!.hidden = false;
});
void show(mode);


