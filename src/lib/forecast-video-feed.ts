import { get } from 'node:https';
import * as tls from 'node:tls';

export type ForecastVideoMetadata = { id: string; published: string; title?: string; titleXml?: string };

const youtube = 'https://www.youtube.com';
const ca = tls.getCACertificates
  ? [...tls.getCACertificates('default'), ...tls.getCACertificates('system')]
  : undefined;

function readYouTube(url: string) {
  return new Promise<string>((resolve, reject) => {
    get(url, { ca, signal: AbortSignal.timeout(5000) }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        resolve('');
        return;
      }
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => resolve(body));
      response.on('error', reject);
    }).on('error', reject);
  }).catch(() => '');
}

export async function getForecastVideoFeed(playlistId: string): Promise<ForecastVideoMetadata[]> {
  const list = encodeURIComponent(playlistId);
  const xml = await readYouTube(youtube + '/feeds/videos.xml?playlist_id=' + list);
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap(([, entry]) => {
    const id = entry.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)?.[1];
    const published = entry.match(/<published>([^<]+)<\/published>/)?.[1];
    const titleXml = entry.match(/<title>[\s\S]*?<\/title>/)?.[0];
    return id && published && titleXml && Number.isFinite(Date.parse(published)) ? [{ id, published, titleXml }] : [];
  });
  if (entries.length) return entries;

  // If the Atom feed is unavailable, read the public watch metadata for the
  // first two playlist items, the only items the forecast player selects.
  const playlist = await readYouTube(youtube + '/playlist?list=' + list);
  const ids = new Set<string>();
  for (const [, id, parent] of playlist.matchAll(/"watchEndpoint":\{"videoId":"([\w-]{11})","playlistId":"([^"]+)"/g)) {
    if (parent === playlistId) ids.add(id);
    if (ids.size === 2) break;
  }
  const videos = await Promise.allSettled([...ids].map(async (id) => {
    const watch = await readYouTube(youtube + '/watch?v=' + id);
    const published = watch.match(/<meta itemprop="datePublished" content="([^"]+)"/)?.[1];
    if (!published || !Number.isFinite(Date.parse(published))) return undefined;
    const match = watch.match(/"videoDetails":\{"videoId":"([\w-]{11})","title":("(?:[^"\\]|\\.)*")/);
    const title = match?.[1] === id ? JSON.parse(match[2]) as string : undefined;
    return { id, published, title };
  }));
  return videos.flatMap((video) => video.status === 'fulfilled' && video.value ? [video.value] : []);
}
