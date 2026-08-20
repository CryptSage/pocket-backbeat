# Project: Setlist & Tempo Manager PWA for a drummer

## What you are building
A personal-use progressive web app for managing songs, tempos (BPM), and gig
setlists, backed by a Google Sheet. Primary device: iPhone (Safari, added to
home screen). Secondary: Chrome on a Windows laptop (for MIDI clock output).

## Hard constraints — do not deviate
- Vanilla HTML/CSS/JS only. No frameworks, no build step, no npm, no external
  libraries or CDNs. The app must work fully offline once cached.
- Every function and non-obvious block must have clear comments explaining what
  it does and why. Assume a competent developer who has never seen the code
  will edit it in a year.
- Files: `index.html`, `app.js`, `style.css`, `sw.js` (service worker),
  `manifest.json`, and `Code.gs` (Google Apps Script). Keep it to these.
- KISS above all. When in doubt, choose the simpler implementation.

## Data source: Google Sheet with two tabs

### Tab "Songs" — columns:
| id | title | artist | bpm | notes |
- `id`: integer, unique, assigned by the user, never reused. Playlists
  reference songs by id so renames don't break anything.

### Tab "Playlists" — columns:
| playlist | position | type | ref |
- `playlist`: playlist name (string)
- `position`: integer sort order within the playlist
- `type`: `song` or `heading`
- `ref`: song id when type=song; heading text (e.g. "Set 2") when type=heading

## Backend: Google Apps Script web app (`Code.gs`)
Bound to the sheet, deployed as web app, "execute as me", "anyone with link".
No OAuth on the client. Endpoints:
- `doGet`: returns JSON `{ songs: [...], playlists: [...] }` — everything in
  one call.
- `doPost` with JSON body, action-based:
  - `{ action: "updateBpm", id, bpm }` — update one song's BPM
  - `{ action: "savePlaylist", name, items: [...] }` — replace a playlist's
    rows entirely (delete existing rows for that name, write new ones)
  - `{ action: "deletePlaylist", name }`
- Return JSON with a success/error field. Handle CORS correctly for a GitHub
  Pages origin (Apps Script quirk: use `ContentService`, and note that POST
  from a browser may need `text/plain` content type to avoid preflight —
  handle this and comment why).
- The Apps Script URL is stored in the app via a one-time settings screen and
  kept in localStorage (do not hardcode it in the repo).

## App features

### 1. Library view
- List titled songs only (title, artist, BPM). Tap a song to edit its BPM
  (numeric input + / − buttons) and notes.
- "Refresh" button: fetch fresh data from the Apps Script, overwrite the
  localStorage cache, show last-synced timestamp.

### 2. Playlist editor (requires connectivity to save)
- Create, rename, delete playlists.
- Add songs from the library, add heading items (free text, e.g. "Set 1"),
  reorder items (simple up/down buttons are fine — no drag-and-drop library),
  remove items.
- Saving writes the whole playlist back via `savePlaylist`.

### 3. Play mode (must work 100% offline)
- Pick a playlist, get a full-screen, high-contrast, dark-background view:
  - Song title: very large
  - BPM: very large (this is the most important number on screen)
  - Artist and notes: smaller but readable at a glance
  - Headings render as full-screen-width dividers in the set flow
- Next/previous navigation via large tap zones or swipe.
- Request a screen Wake Lock while in play mode so the phone doesn't sleep;
  re-acquire it on visibilitychange. Release it on exit.
- BPM and notes can be edited in play mode. Changes apply to the local cache
  immediately and are added to pending-sync queues in localStorage. When the
  app is online (or on next manual refresh), the queues are flushed to the
  sheet via `updateBpm` and `updateNotes`. Show a small badge if there are
  unsynced edits.

### 4. Metronome (in play mode)
- Play/stop button on the song screen; plays a click at the song's BPM.
- Timing is critical. Use the Web Audio API with the lookahead scheduler
  pattern: a `setTimeout` loop (~25ms) that schedules click events 100–200ms
  ahead on `AudioContext.currentTime`. NEVER use setInterval/setTimeout to
  trigger the sounds themselves. Comment this section especially well.
- Click sound: synthesized in code (cowbell-like). No accents, all beats equal.
  No audio files.
- iOS: create/resume the AudioContext inside the user's tap handler (required
  by Safari). Stop cleanly on song change or exit.
- Changing the BPM while the metronome runs takes effect on the next
  scheduled beat without glitches.

### 5. MIDI clock out (Windows/Chrome only, progressive enhancement)
- Feature-detect `navigator.requestMIDIAccess`. If unavailable (iPhone),
  hide all MIDI UI entirely.
- If available: a settings control to pick a MIDI output port. When the
  metronome runs, also send MIDI clock: 0xF8 at 24 PPQN derived from the
  song BPM, 0xFA (start) on play, 0xFC (stop) on stop.
- Schedule clock messages ahead using the timestamp parameter of
  `MIDIOutput.send()` for stable timing, driven by the same lookahead
  scheduler as the audio click so they stay in sync.

## Offline / PWA behavior
- `sw.js`: cache-first for the app shell (all app files). The app must load
  instantly with no network.
- `manifest.json`: standalone display, dark theme colour, app name
  "Setlists", placeholder icon is fine.
- All song/playlist data lives in localStorage after each refresh; the app
  never blocks on the network except explicit refresh and playlist saves.
- If a network action fails, show a clear non-blocking message; never lose
  local state.

## Deliverables
1. All app files, fully commented.
2. `Code.gs`, fully commented.
3. `SETUP.md` with step-by-step instructions:
   - Creating the Google Sheet with both tabs and example rows
   - Adding the Apps Script, deploying it as a web app, getting the URL
   - Publishing the app on GitHub Pages
   - Adding to iPhone home screen and entering the Apps Script URL
   - Testing MIDI out on Windows/Chrome

## Style
Dark theme, minimal chrome, big touch targets. Play mode should look like a
stage tool, not a website.
