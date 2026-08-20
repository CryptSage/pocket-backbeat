# Pocket Backbeat

An offline-first Progressive Web App for a musician to manage a song library,
build gig setlists, show high-contrast tempo screens, and run a metronome with
optional MIDI clock output. It uses a Google Sheet as its editable source of
truth and has no dependencies, build step, or account login in the app.

## Features

- Offline song and playlist cache for reliable gig-time use
- Big, dark, distraction-free play mode with Wake Lock support
- BPM and notes editing with deferred sync when the device reconnects
- Playlist headings, song ordering, and whole-playlist saves
- Web Audio look-ahead metronome scheduler
- MIDI clock output in Chrome on Windows, when Web MIDI is available

## Project files

| File | Purpose |
| --- | --- |
| `index.html`, `style.css`, `app.js` | The dependency-free web app |
| `logo.png`, `favicon.png` | Pocket Backbeat logo and browser/PWA icon |
| `sw.js`, `manifest.json` | Offline PWA shell and install metadata |
| `Code.gs` | Google Apps Script API bound to the Sheet |

## Setup

## 1. Create the Sheet

Open a new incognito window, and go to: https://developers.google.com/apps-script/

Create a Google Sheet and add tabs named exactly `Songs` and `Playlists`.

Put this in row 1 of **Songs**:

| id | title | artist | bpm | notes |
| --- | --- | --- | --- | --- |
| 1 | The Chain | Fleetwood Mac | 76 | Watch the stop |
| 2 | Dream On | Aerosmith | 80 |  |

`id` is permanent: do not reuse it after deleting a song. Songs without a title are ignored. Edit song titles and artists directly in this tab; BPM and notes can also be updated in the app.

Put this in row 1 of **Playlists**:

| playlist | position | type | ref |
| --- | --- | --- | --- |
| Friday set | 1 | heading | Set 1 |
| Friday set | 2 | song | 1 |
| Friday set | 3 | song | 2 |

The app will manage playlist rows after this. `type` must be `song` or `heading`; song `ref` is a Songs id, while heading `ref` is its display text.

## 2. Add and deploy Apps Script

1. In the Sheet choose **Extensions → Apps Script**.
2. Replace the default editor content with [`Code.gs`](Code.gs), then save.
3. Choose **Deploy → New deployment**, select **Web app**, and use:
   - Execute as: **Me**
   - Who has access: **Anyone** (or the equivalent “Anyone with the link” option)
4. Authorize the script, deploy, then copy the web-app URL ending in `/exec`.

The browser sends JSON as `text/plain`, intentionally avoiding a cross-origin preflight request. If access is restricted to an organization, GitHub Pages cannot read the endpoint; use an access setting that permits your page to reach it.

## 3. Publish the app on GitHub Pages

1. Commit these app files to a GitHub repository.
2. In GitHub, open **Settings → Pages**.
3. Choose **Deploy from a branch**, select your branch and `/ (root)`, then save.
4. Open the published URL on your phone or laptop.
5. In the Library screen’s Settings section, paste the Apps Script `/exec` URL, save it, then press **Refresh**.
6. Your site is live at https://username.github.io/repository-name/

The app is static: do not put the Apps Script URL into any source file. Each device stores its own URL and cached library in local storage.

## 4. Install on iPhone

1. Open the GitHub Pages URL in **Safari** (not an in-app browser).
2. Tap Share, then **Add to Home Screen**.
3. Open Pocket Backbeat from the new icon, save the Apps Script URL if needed, and Refresh once before a gig.

The initial visit caches the app shell. Songs and playlists remain available without a connection. BPM and notes changes made offline are queued and sync the next time the app is online.

## 5. Test MIDI clock on Windows / Chrome

1. Connect and power your MIDI interface/device before opening Pocket Backbeat.
2. Open the GitHub Pages URL using recent Chrome over HTTPS.
3. In Library → Settings, click **Enable MIDI**, approve access, and select the desired output.
4. Start a playlist in Play mode and press **Play click** on a song.
5. Confirm the receiving device sees MIDI Start (`FA`), 24 clock ticks per quarter note (`F8`), and Stop (`FC`).

MIDI controls are deliberately absent on iPhone and any browser without Web MIDI support. The audio metronome still works there.
