# Pocket Backbeat

An offline-first Progressive Web App for a musician to manage a song library,
build gig setlists, show high-contrast tempo screens, and run a metronome with
optional MIDI clock output. It uses a Google Sheet as its editable source of
truth and has no dependencies, build step, or account login in the app.

## Features

- Offline song and playlist cache for reliable gig-time use
- Big, dark, distraction-free play mode with Wake Lock support
- BPM and notes editing with deferred sync when the device reconnects
- Playlist headings, song ordering, BPM at a glance, and whole-playlist saves
- Letter-size PDF print export with large song titles and BPM; each heading starts a new page
- Web Audio look-ahead metronome scheduler
- MIDI clock output when the browser exposes a Web MIDI output port

## Project files

| File | Purpose |
| --- | --- |
| `index.html`, `style.css`, `app.js` | The dependency-free web app |
| `logo.png`, `favicon.png` | Pocket Backbeat logo and browser/PWA icon |
| `sw.js`, `manifest.json` | Offline PWA shell and install metadata |
| `Code.gs` | Google Apps Script API bound to the Sheet |
| `AI_AGENT_SETLIST_IMPORT_PROMPT.md` | Instructions for the optional AI-agent setlist-import skill |
| `.env.example` | Non-secret example configuration for that skill |

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

## Optional: AI-agent setlist-import skill

The included AI-agent prompt turns a photographed or typed setlist into a Pocket
Backbeat playlist. It checks each entry against the existing `Songs` tab,
researches likely title/artist/BPM data for missing songs, asks for approval
before adding anything, and then creates a new ordered playlist. It preserves
the sheet schema and uses immutable song IDs.

This is separate from the PWA's Apps Script URL. The PWA API can read songs and
save playlists, but it cannot create new song rows. The agent therefore
connects directly to the Google Sheet with a Google service account.

### 1. Install the prompt or skill in your AI agent

Use your agent platform's documented custom prompt or skill location. Put the
contents of [`AI_AGENT_SETLIST_IMPORT_PROMPT.md`](AI_AGENT_SETLIST_IMPORT_PROMPT.md)
in the platform's equivalent of:

```text
<agent-project>/skills/pocket-backbeat-setlists/SKILL.md
```

If the platform uses a single system-prompt file rather than skill folders,
use this prompt there instead. Restart or reload the agent after installing it
and confirm that it discovers the custom prompt/skill. Follow any
platform-specific skill registry or lock-file requirement only when its
documentation requires one.

### 2. Create Google Sheets credentials

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create
   or select a project, such as `pocket-backbeat-agent`.
2. In **APIs & Services → Library**, enable **Google Sheets API**.
3. In **IAM & Admin → Service Accounts**, create a service account named
   `pocket-backbeat-agent`. No Google Cloud IAM role is needed for access to
   one existing spreadsheet.
4. Open that service account, copy its email address, then go to **Keys → Add
   key → Create new key → JSON**. Download the JSON key exactly once.
5. Open the Pocket Backbeat spreadsheet, click **Share**, add the service
   account email as an **Editor**, and save. Google Sheet sharing is what gives
   the service account access; a Cloud IAM role alone does not do that.
6. Copy the spreadsheet ID from its URL. In
   `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`, it is the text
   between `/d/` and `/edit`.

The service account only needs direct access to this Sheet. Domain-wide
delegation and Google Workspace administrator permissions are not needed.
See Google's [credential guide](https://developers.google.com/workspace/guides/create-credentials)
for current console details.

### 3. Store the key and configure the agent runtime

The JSON key is a secret. Store it outside the Git repository if possible, or
in the ignored `secrets` directory shown below. Never paste its contents into
chat, commit it, or put the JSON itself in `.env`.

```bash
cd <agent-project>
mkdir -p secrets
chmod 700 secrets
install -m 600 /path/to/downloaded-service-account-key.json \
  secrets/pocket-backbeat-google.json
```

Create `<agent-project>/.env` with these values (see [`.env.example`](.env.example)).
The runtime must load this file before it starts the agent.

```dotenv
GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=/path/visible/to/the/agent/pocket-backbeat-google.json
POCKET_BACKBEAT_SONGS_SHEET=Songs
POCKET_BACKBEAT_PLAYLISTS_SHEET=Playlists
```

Add these entries to `<agent-project>/.gitignore`:

```gitignore
.env
secrets/
```

If the agent runs in Docker Compose, load the environment file and mount the
key read-only. Replace `ai-agent` with the actual service name:

```yaml
services:
  ai-agent:
    env_file:
      - .env
    volumes:
      - ./secrets/pocket-backbeat-google.json:/run/secrets/pocket-backbeat-google.json:ro
```

For that Docker configuration, set
`GOOGLE_SERVICE_ACCOUNT_JSON_PATH=/run/secrets/pocket-backbeat-google.json`.
For a non-containerized runtime, set it to the protected host path instead.
Restart the agent after making these changes.

### 4. Use it

Ask your AI agent to use the Pocket Backbeat setlist-import skill, then attach a setlist
photo or paste/type the songs. The agent will:

1. Transcribe the entries and preserve their order and headings.
2. Match them against the `Songs` tab.
3. Search only missing or ambiguous entries for a likely title, artist, and
   starting BPM, clearly identifying uncertain results.
4. Present all new Song rows and the proposed playlist order for approval.
5. Append approved songs with new, never-reused IDs.
6. Ask for a playlist name, request final confirmation, and append the ordered
   rows to `Playlists`.

It never overwrites an existing playlist, silently substitutes a cover or live
version, or writes to the Sheet before explicit approval.

## 4. Install on iPhone

1. Open the GitHub Pages URL in **Safari** (not an in-app browser).
2. Tap Share, then **Add to Home Screen**.
3. Open Pocket Backbeat from the new icon, save the Apps Script URL if needed, and Refresh once before a gig.

The initial visit caches the app shell. Songs and playlists remain available without a connection. BPM and notes changes made offline are queued and sync the next time the app is online.

## 5. MIDI clock compatibility and setup

MIDI clock requires a browser with [Web MIDI](https://www.w3.org/TR/webmidi/),
an available MIDI output port, and permission to access it. Use the published
HTTPS app URL rather than `file:///…` for reliable MIDI access.

- **Best-supported:** Chrome, Edge, or Firefox on Windows, macOS, or Linux with a connected USB-MIDI interface/device.
- **Android:** Chrome and other Chromium-based browsers can work with a class-compliant USB-MIDI device through USB-OTG. Bluetooth-MIDI support varies by device, Android version, and browser.
- **Not supported:** Safari on macOS, and iPhone/iPad browsers (including installed PWAs) are not dependable Web MIDI targets.

The app sends standard MIDI Start (`FA`), 24 clock ticks per quarter note (`F8`), and Stop (`FC`) to the selected output.

1. Connect and power your MIDI interface/device before opening Pocket Backbeat.
2. Open the GitHub Pages URL in a supported browser over HTTPS.
3. In Library → Settings, click **Enable MIDI**, approve access, and select the desired output.
4. Start a playlist in Play mode and press **Play click** on a song.
5. Confirm the receiving device sees MIDI Start (`FA`), 24 clock ticks per quarter note (`F8`), and Stop (`FC`).

MIDI controls are deliberately absent on iPhone and any browser without Web MIDI support. The audio metronome still works there.
