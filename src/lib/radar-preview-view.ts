export type Bounds = [west: number, south: number, east: number, north: number];

export function radarPreviewView([west, south, east, north]: Bounds, width: number, height: number) {
  // Give the counties the right half of the card, with space around their outer edges.
  const padding = Math.min(12, width * .035);
  const scale = Math.max((east - west) / (width / 2 - padding * 2), (north - south) / (height - padding * 2));
  const left = (west + east) / 2 - width * .75 * scale;
  const top = (north + south) / 2 + height * scale / 2;
  const box = [left, top - height * scale, left + width * scale, top].join(',');
  // SVG y runs south, while the two imagery services use projected northing.
  const viewBox = [left, -top, width * scale, height * scale].join(' ');
  return { box, viewBox, width, height };
}
