# Hamblin Weather

An independent weather desk for 14 West Tennessee counties. Astro generates static HTML with browser-side TypeScript for weather requests, the county finder, and the Leaflet map.

## Local setup on Windows

Use Node.js 24 LTS and PowerShell.

```powershell
Set-Location -LiteralPath 'C:\Users\noah5\OneDrive\Desktop\New Website'
$env:ASTRO_TELEMETRY_DISABLED = '1'
$env:NODE_USE_SYSTEM_CA = '1'
npm.cmd ci
npm.cmd run dev -- --port 4321
```

Open [localhost port 4321](http://localhost:4321/). Stop the server with **Ctrl+C** in its terminal. To restart development, run the last command from this folder. To serve the production build locally, run:

```powershell
npm.cmd run build
npm.cmd run preview -- --port 4321
```

If the preview is already using port 4321, stop it first or select a different port. County preferences are stored by browser origin.

## Updating the station

- **Written forecasts, explainers, station updates, and blog posts** can be added with the local editor below. The site uses Markdown in [src/content/updates](src/content/updates) with `title`, `description`, `published` (YYYY-MM-DD), `category`, and optional `publishedTime` (HH:mm Central). Date-only entries still work. The Blog post category appears under Blog. Entries in other categories are available at their direct article URLs. County forecasts and observations come directly from NWS.
- **Homepage videos** use the two playlist IDs in [featured-videos.ts](src/data/featured-videos.ts). Put the newest item first in each YouTube playlist. If a forecast premiere is still waiting to start, the forecast player tries the second item. Reload the page to check the newest forecast again. Rebuild the static site to refresh publication dates from YouTube. The players start muted and use YouTube’s volume controls.
- **Sponsorship and support** use `sponsorshipEmail` and `supportEmail` in [src/data/station.ts](src/data/station.ts). The corresponding page shows an email link once its address is set.
- **County geography** comes from [src/data/counties.json](src/data/counties.json) and [src/data/coverage.geo.json](src/data/coverage.geo.json). Run `node scripts/refresh-counties.mjs` to regenerate both from the 14 representative points, verifying Census GEOIDs and NWS county, public forecast, and fire zone codes. The coverage art is based on these Census outlines.

Sponsorship and support are awaiting their public contact addresses.

## Add Weather Update on Windows

Open PowerShell and run:

```powershell
Set-Location -LiteralPath 'C:\Users\noah5\OneDrive\Desktop\New Website'
npm.cmd run editor
```

Open [the local editor](http://127.0.0.1:4331/) and leave its terminal running while you work. Enter a title, summary, body and publication date and time in Central Time. Choose a category and review the preview. Use a blank line to separate body paragraphs.

**Save draft** stores a private copy, even if you have not filled every field. To continue it, select it under **Saved drafts** and click **Load draft**. Saving again creates a new copy. **Add to local site**, followed by **Add update**, creates a new Markdown file with a unique address. An existing post with the same title is kept. The date and time are the byline for the post; they do not schedule it.

Keep the live preview running in a second PowerShell terminal from this folder while you write: `npm.cmd run dev -- --port 4321`. The editor gives you a direct link to the new article. If a static preview is already using port 4321, stop it with **Ctrl+C** before starting the live preview. Use `npm.cmd run build` and `npm.cmd run preview` when you want to check the static build before publishing.

Choose **Blog post** from Category and click **Add to Blog** to create a local entry. The editor shows its local URL and the command to rebuild the static site. To change an existing entry, select it under **Existing updates**, click **Edit update**, and then **Save changes**. Edits keep the same article address when the entry stays in the same section. **Delete update** asks for confirmation and moves a copy to `.weather-update-drafts` outside the website.

The editor runs on `127.0.0.1` only. Drafts live in `.weather-update-drafts` and are excluded from the site. The editor is not part of `dist`. To stop it, press **Ctrl+C** in its terminal. Adding an update here does not deploy anything.

## Verification

Run `npm.cmd run check` and `npm.cmd run build`. With the preview running, `npm.cmd test` runs the Chrome browser smoke test. Set `BROWSER_CHANNEL` to `msedge` to use Edge, `TEST_URL` for a different preview address, and `SCREENSHOTS=1` to regenerate the screenshots. Run `node scripts/test-editor.mjs` to check editor validation, drafts, duplicate slugs, and the static build. That test removes the temporary entries it creates and rebuilds the clean preview.

The November 9, 2026 verification checked the 26 static pages, desktop and 390 px mobile layouts, keyboard navigation, county selection and persistence, and the NWS forecast and station observation labels. It also exercised radar, satellite, temperatures, the SPC outlook, and the official alert feed. Browser-intercepted fixtures checked warning priority, county filters, stale alert data, and feed failures.

Live sources checked in the browser or during the county registry build:

| Source | What it provides |
| --- | --- |
| [National Weather Service API](https://www.weather.gov/documentation/services-web-api) | Point forecasts, hourly periods, nearby stations, observations, and active Tennessee alerts |
| [NOAA radar imagery service](https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer) | Timestamped MRMS reflectivity frames |
| [NOAA nowCOAST satellite service](https://nowcoast.noaa.gov/geoserver/observations/satellite/ows?service=WMS&request=GetCapabilities) | GOES longwave infrared image and time |
| [NOAA Storm Prediction Center](https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer/1) | Day 1 categorical outlook polygons and validity times |
| [Census TIGERweb](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1) | County GEOIDs and simplified outlines |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Base map tiles with attribution |

Tennessee Valley Weather informed the white masthead, navy navigation, and layout of the forecast panels. Its page HTML was accessible during the redesign, and the visual layout followed the supplied brief. The masthead uses `logo_transparent_source.png` with transparent padding trimmed. About uses `logo_broadcast.png`, and the social preview uses `logo_white_source.png`. The hero serves two WebP sizes derived from `background.png`. Its decorative outline uses the 14 matching Tennessee GEOIDs from the supplied NAD83 `counties.geojson`. Forecasts, radar, and alert matching use the existing website data.

Screenshots captured from the preview are in [docs/preview](docs/preview).

## Packaging for GitHub Pages later

For a repository site such as `username.github.io/repository/`, set `$env:SITE_BASE = '/repository'` and `$env:SITE_URL = 'https://username.github.io'` before building. The site URL gives the social preview image an absolute address. For a root site or custom domain, leave the base at `/`. Run `npm.cmd run build`, then publish the contents of `dist` as the GitHub Pages artifact. A test build verified prefixed asset URLs and a nested county route. The [Astro Pages guide](https://docs.astro.build/en/guides/deploy/github/) covers the GitHub Actions setup. To return to a root-path build in the same terminal, run `Remove-Item Env:SITE_BASE` before building again.

