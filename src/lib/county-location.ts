import type { FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import coverage from '../data/coverage.geo.json';
import { findCounty } from './counties';

const { features } = coverage as FeatureCollection<Polygon | MultiPolygon, { slug: string }>;

function ringContains(ring: Position[], lon: number, lat: number) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x, y] = ring[index];
    const [previousX, previousY] = ring[previous];
    if ((y > lat) !== (previousY > lat) && lon < x + (previousX - x) * (lat - y) / (previousY - y)) {
      inside = !inside;
    }
  }
  return inside;
}

export function countyAtLocation(lon: number, lat: number) {
  const match = features.find(({ geometry }) => {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.some(([outer, ...holes]) => ringContains(outer, lon, lat)
      && !holes.some((hole) => ringContains(hole, lon, lat)));
  });
  return findCounty(match?.properties.slug);
}
