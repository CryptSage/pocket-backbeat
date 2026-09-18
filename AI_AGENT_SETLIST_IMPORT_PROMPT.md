# Pocket Backbeat setlist importer

Use this prompt when the user wants to import a photographed or typed setlist
into Pocket Backbeat's Google Sheet and create a playlist from it. The Google
Sheet is the source of truth; this workflow does not use the PWA's Apps Script
web endpoint because its current API cannot add songs.

## Setup and security

At the beginning of a session, load the runtime's configured environment. If
either `GOOGLE_SHEETS_SPREADSHEET_ID` or `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` is
absent, blank, or unusable, stop and tell the user what configuration is
missing by referring to `.env.example`. Do not ask them to paste credentials,
private keys, or tokens into chat. Do not log secret values. The credential
file must be untracked and readable only by the agent runtime.

Use a Google service account with the Google Sheets API enabled. The target
spreadsheet must be shared with that service account's `client_email` as an
Editor. Use `Songs` and `Playlists` unless their corresponding environment
variables override those names.

Before making changes, read both tabs and validate these exact headers:

| Tab | Required columns |
| --- | --- |
| `Songs` | `id`, `title`, `artist`, `bpm`, `notes` |
| `Playlists` | `playlist`, `position`, `type`, `ref` |

If the workbook does not conform, explain the discrepancy and stop. Never
alter headers, delete existing songs, reuse an ID, or overwrite another
playlist.

## Import workflow

1. Accept either an image or typed setlist. Transcribe it in the supplied
   order. Preserve set dividers such as `Set 1`, `Encore`, or `Break` as
   heading candidates. Ask a focused clarification only when handwriting or a
   title is genuinely ambiguous.
2. Read the current `Songs` rows. Match each song against existing records
   before searching. Compare normalized title and artist (case-insensitive,
   whitespace/punctuation-insensitive); do not treat a loose title-only match
   as certain when multiple artists are plausible. Report exact matches,
   probable matches requiring confirmation, and missing songs.
3. For each missing or ambiguous song, run a small web search to determine the
   likely canonical title, recording artist, and BPM. Prefer an official or
   reputable music metadata source. BPM is often arrangement-specific, so
   identify it as a starting tempo and give a confidence label; do not invent a
   BPM if a credible result cannot be found. Keep a compact proposal table with
   the original entry, proposed title, artist, BPM, confidence/source, and any
   ambiguity.
4. Ask once for explicit approval before any write. The approval summary must
   state every proposed new Song row and every proposed playlist item in its
   final order. Let the user correct candidates, BPMs, headings, or the order.
   A response such as “yes”, “approved”, or an unambiguous edited table is
   sufficient only after that summary. Never create rows merely because search
   results look confident.
5. After the user approves the song additions, append each approved song to
   `Songs`. Assign IDs as consecutive integers beginning at one above the
   current maximum numeric `id`; never fill gaps. Write `notes` as blank unless
   the user supplied notes. Re-read the appended rows and verify their IDs.
6. Once every ordered item resolves to a song ID or an approved heading, ask
   for the new playlist title. If that title already exists, ask whether to
   choose a different name; do not replace it. Then show the final playlist
   preview and get explicit confirmation to create it.
7. Append rows to `Playlists`, in the supplied order, using the playlist name,
   positions starting at `1`, `type` of `song` or `heading`, and `ref` equal to
   the immutable song ID or heading text. Re-read the new rows and report the
   playlist title, song count, heading count, and any unresolved entries.

## Operational rules

- Do not deduplicate two different songs solely because their titles match.
- Do not silently substitute covers, live versions, medleys, key changes, or
  half/double-time BPM values. Surface the choice for approval.
- Keep the user's supplied order exactly, including repeated songs.
- If a user declines a proposed song, leave it unresolved and do not include a
  broken playlist reference.
- Make writes idempotent within the current session: after a failed or
  interrupted write, re-read the Sheet before retrying so duplicate Songs or
  playlist rows are not created.
- Report failures clearly and retain the parsed setlist/proposals so the user
  can correct them without re-uploading an image.

## First response template

When invoked, respond briefly: confirm that you will check the configured
Sheet, then ask the user to attach a setlist photo or paste/type the songs.
If configuration is missing, provide the `.env.example` setup requirement
instead and wait for the user to populate the runtime environment.
