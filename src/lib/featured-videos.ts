import type { ForecastVideoMetadata } from './forecast-video-feed';
import { centralZone } from './weather';

type VideoData = { video_id?: string; title?: string; isLive?: boolean; isPremiere?: boolean };
type Player = {
  mute(): void;
  playVideo(): void;
  cuePlaylist(options: { listType: 'playlist'; list: string }): void;
  cueVideoById(videoId: string): void;
  destroy(): void;
  pauseVideo(): void;
  getDuration(): number;
  getPlayerState(): number;
  getPlaylist(): string[] | undefined;
  getPlaylistIndex(): number;
  getVideoData?(): VideoData;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
};
type YouTube = { Player: new (iframe: HTMLIFrameElement, options: { events: {
  onReady(event: { target: Player }): void;
  onError(event: { data: number }): void;
  onStateChange(event: { data: number; target: Player }): void;
  onAutoplayBlocked(): void;
} }) => Player };
type ForecastSelection = { id: string; index: 0 | 1; fallbackId?: string };
const youtubeWindow = window as Window & { YT?: YouTube; onYouTubeIframeAPIReady?: () => void };
const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: centralZone, month: 'short', day: 'numeric' });
const youtubeOrigin = 'https://www.youtube.com';

function followLiveBroadcast(frame: HTMLIFrameElement, player: Player, badge: HTMLElement, signal: AbortSignal) {
  let lastSeek = -Infinity;
  window.addEventListener('message', (event) => {
    if (!frame.isConnected || event.origin !== youtubeOrigin || event.source !== frame.contentWindow ||
        typeof event.data !== 'string' || player.getPlayerState() !== 1 || player.getPlaylistIndex() !== 0) return;
    const video = player.getVideoData?.();
    if (!video?.isLive || video.isPremiere) {
      badge.hidden = true;
      return;
    }

    // The live duration can extend past what is currently playable. Use the
    // iframe's progress updates to get the end of the DVR window instead.
    let progress: { current: number; seekableEnd: number; allowSeeking?: boolean } | undefined;
    try {
      const packet = JSON.parse(event.data);
      if (packet?.event !== 'infoDelivery') return;
      progress = packet.info?.progressState;
    } catch {
      return;
    }
    if (!progress || !Number.isFinite(progress.current) || progress.current < 0 ||
        !Number.isFinite(progress.seekableEnd) || progress.seekableEnd <= 0) return;

    const behind = progress.seekableEnd - progress.current;
    badge.hidden = behind > 10;
    const now = performance.now();
    if (behind <= 30 || progress.allowSeeking === false || document.hidden || now - lastSeek < 15_000) return;
    lastSeek = now;
    player.seekTo(progress.seekableEnd - 3, true);
  }, { signal });
}

function playerApi() {
  if (youtubeWindow.YT?.Player) return Promise.resolve(youtubeWindow.YT);
  return new Promise<YouTube>((resolve, reject) => {
    youtubeWindow.onYouTubeIframeAPIReady = () => {
      if (youtubeWindow.YT?.Player) resolve(youtubeWindow.YT);
      else reject(new Error('Missing YouTube Player API'));
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('YouTube Player API unavailable'));
    document.head.append(script);
  });
}

function errorText(code: number) {
  if (code === 100) return 'This video is unavailable or private.';
  if (code === 101 || code === 150) return 'This video cannot be embedded.';
  if (code === 2) return 'YouTube rejected the video request.';
  return 'YouTube could not play this video here.';
}

const apiRequest = playerApi();
for (const card of document.querySelectorAll<HTMLElement>('[data-playlist]')) {
  const host = card.querySelector<HTMLElement>('[data-video-player]')!;
  const status = card.querySelector<HTMLElement>('[data-video-status]')!;
  const title = card.querySelector('h2')!.textContent!;
  const isForecast = card.dataset.videoKind === 'forecast';
  const liveBadge = card.querySelector<HTMLElement>('[data-video-live]');
  const headline = card.querySelector<HTMLElement>('[data-forecast-headline]');
  const headlineText = headline?.querySelector('p');
  const headlineDate = headline?.querySelector('time');
  const metadata: ForecastVideoMetadata[] = JSON.parse(card.dataset.forecastMetadata ?? '[]');

  function showForecastHeadline(id?: string, video?: VideoData) {
    if (!headline || !headlineText || !headlineDate) return;
    const entry = metadata.find((item) => item.id === id);
    const feedTitle = entry?.titleXml && new DOMParser().parseFromString(entry.titleXml, 'application/xml').documentElement;
    const playerTitle = video?.video_id === id ? video?.title : undefined;
    headlineText.textContent = playerTitle?.trim() || entry?.title || (feedTitle && feedTitle.localName === 'title' ? feedTitle.textContent : '') || '';
    headline.hidden = !headlineText.textContent;
    headlineDate.hidden = !entry;
    headlineDate.dateTime = entry?.published ?? '';
    headlineDate.textContent = entry ? shortDate.format(new Date(entry.published)) : '';
  }

  function message(text = '') {
    status.textContent = text;
    status.hidden = !text;
  }

  function unavailable(text: string) {
    if (!isForecast) {
      host.replaceChildren(status);
      message('The latest live video is unavailable.');
    } else {
      message(text);
    }
  }

  function mountPlayer(forecast?: ForecastSelection) {
    showForecastHeadline(forecast?.id);
    if (liveBadge) liveBadge.hidden = true;
    const discoveringForecast = isForecast && !forecast;
    const videoPath = forecast ? '/embed/' + encodeURIComponent(forecast.id) : '/embed';
    const url = new URL(videoPath, youtubeOrigin);
    if (!forecast) {
      url.searchParams.set('listType', 'playlist');
      url.searchParams.set('list', card.dataset.playlist!);
    }
    url.searchParams.set('playsinline', '1');
    url.searchParams.set('enablejsapi', '1');
    url.searchParams.set('origin', location.origin);

    const frame = document.createElement('iframe');
    frame.id = host.id + (forecast ? '-item-' + forecast.index : '-playlist');
    frame.title = title + ' player';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.hidden = discoveringForecast;
    frame.src = url.href;
    host.replaceChildren(frame);
    message('Loading YouTube player…');
    const readyTimer = window.setTimeout(() => {
      card.dataset.playerError = 'timeout';
      message('The player did not respond.');
    }, 15_000);
    let startupTimer: number | undefined;
    let checkedLive = false;
    const liveTracking = new AbortController();

    function discoverForecast(target: Player, retries = 12) {
      if (!frame.isConnected || card.dataset.playerError) return;
      const [latest, previous] = target.getPlaylist() ?? [];
      if (latest) {
        target.destroy();
        mountPlayer({ id: latest, index: 0, fallbackId: previous });
      } else if (retries > 0) {
        // Playlist metadata can arrive after the iframe signals readiness.
        startupTimer = window.setTimeout(() => discoverForecast(target, retries - 1), 250);
      } else {
        target.destroy();
        message('The forecast video could not be loaded.');
      }
    }

    void apiRequest.then((api) => {
      new api.Player(frame, { events: {
        onReady({ target }) {
          if (!frame.isConnected) return;
          window.clearTimeout(readyTimer);
          if (card.dataset.playerError && card.dataset.playerError !== 'timeout') return;
          delete card.dataset.playerError;
          if (discoveringForecast) {
            if (!target.getPlaylist()?.length) target.cuePlaylist({ listType: 'playlist', list: card.dataset.playlist! });
            discoverForecast(target);
            return;
          }
          message();
          if (forecast) showForecastHeadline(forecast.id, target.getVideoData?.());
          if (liveBadge) followLiveBroadcast(frame, target, liveBadge, liveTracking.signal);
          target.mute();
          const fallback = forecast?.fallbackId;
          if (fallback) {
            // An upcoming premiere stays unstarted or cued with no duration.
            startupTimer = window.setTimeout(() => {
              const state = target.getPlayerState();
              if ((state === -1 || state === 5) && target.getDuration() === 0) {
                target.destroy();
                mountPlayer({ id: fallback, index: 1 });
              }
            }, 4_000);
          }
          target.playVideo();
        },
        onError({ data }) {
          if (!frame.isConnected) return;
          window.clearTimeout(readyTimer);
          window.clearTimeout(startupTimer);
          if (liveBadge) liveBadge.hidden = true;
          card.dataset.playerError = String(data);
          if (data === 100 || data === 101 || data === 150) {
            liveTracking.abort();
            unavailable(errorText(data));
          } else message(errorText(data));
        },
        onAutoplayBlocked() {
          if (!frame.isConnected || discoveringForecast) return;
          window.clearTimeout(startupTimer);
          if (!card.dataset.playerError) message('Press play in the video player.');
        },
        onStateChange({ data, target }) {
          if (!frame.isConnected || discoveringForecast) return;
          if (liveBadge && data !== 1) liveBadge.hidden = true;
          if (forecast && data === 0) {
            target.cueVideoById(forecast.id);
            return;
          }
          if (data !== 1) return;
          if (forecast) {
            showForecastHeadline(forecast.id, target.getVideoData?.());
            window.clearTimeout(startupTimer);
            card.dataset.firstItem = String(forecast.index);
            message(forecast.index === 1 ? 'Showing the previous forecast.' : '');
            return;
          }
          const index = target.getPlaylistIndex();
          if (checkedLive) return;
          if (!Number.isInteger(index) || index < 0) return;
          checkedLive = true;
          card.dataset.firstItem = String(index);
          if (index === 0) {
            delete card.dataset.playerError;
            message();
          } else {
            target.pauseVideo();
            liveTracking.abort();
            card.dataset.playerError = 'skipped';
            unavailable('The first video in the playlist is unavailable.');
          }
        },
      } });
    }).catch(() => {
      window.clearTimeout(readyTimer);
      card.dataset.playerError = 'api';
      message('The player may be blocked.');
    });
  }

  mountPlayer();
}
