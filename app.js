/* Pocket Backbeat is deliberately dependency-free: all durable client state is stored under these keys. */
const STORAGE = {
  data: 'pocket-backbeat.data',
  endpoint: 'pocket-backbeat.endpoint',
  syncedAt: 'pocket-backbeat.syncedAt',
  pendingBpm: 'pocket-backbeat.pendingBpm',
  pendingNotes: 'pocket-backbeat.pendingNotes',
  midiPort: 'pocket-backbeat.midiPort'
};

// Preserve existing installs that used the previous name; this runs once per key and never overwrites new data.
const LEGACY_STORAGE = {
  data: 'setlists.data', endpoint: 'setlists.endpoint', syncedAt: 'setlists.syncedAt',
  pendingBpm: 'setlists.pendingBpm', pendingNotes: 'setlists.pendingNotes', midiPort: 'setlists.midiPort'
};

/** Move cached data from the original app name without discarding a user's offline library. */
function migrateLegacyStorage() {
  Object.keys(STORAGE).forEach((name) => {
    if (localStorage.getItem(STORAGE[name]) === null && localStorage.getItem(LEGACY_STORAGE[name]) !== null) {
      localStorage.setItem(STORAGE[name], localStorage.getItem(LEGACY_STORAGE[name]));
    }
  });
}

migrateLegacyStorage();

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const syncStatus = document.querySelector('#syncStatus');
const pendingBadge = document.querySelector('#pendingBadge');

// A small in-memory state layer keeps rendering simple while localStorage remains the source of truth.
const state = {
  // Show the last successful sheet snapshot immediately; a live refresh replaces it when available.
  data: readJson(STORAGE.data, { songs: [], playlists: [] }),
  pendingBpm: readJson(STORAGE.pendingBpm, []),
  pendingNotes: readJson(STORAGE.pendingNotes, []),
  view: 'library',
  editingSongId: null,
  playlistName: null,
  playlistItems: [],
  playlistOriginalName: null,
  play: null,
  wakeLock: null,
  audio: null,
  clickOutput: null,
  audioMuted: false,
  schedulerTimer: null,
  scheduledSources: [],
  metronomeRunning: false,
  nextClickAt: 0,
  nextMidiAt: 0,
  midiAccess: null,
  midiOutput: null,
  touchStartX: null
};

/** Read JSON safely so a manually cleared or corrupted cache never stops the app booting. */
function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; }
}

/** Persist the current cached sheet data after every local edit. */
function saveData() {
  localStorage.setItem(STORAGE.data, JSON.stringify(state.data));
}

/** Escape sheet and user content before placing it in generated markup. */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

/** Find a song by stable Sheet id; playlist references intentionally never use song titles. */
function songById(id) {
  return state.data.songs.find((song) => String(song.id) === String(id));
}

/** A blank title is an incomplete Sheet row, not a song that can be displayed or played. */
function hasTitle(song) {
  return String(song && song.title != null ? song.title : '').trim() !== '';
}

/** Keep stale cached blank rows out of every song picker and display. */
function titledSongs() {
  return state.data.songs.filter(hasTitle);
}

/** Keep every song picker and list ordered by the part musicians look for first. */
function compareSongsByTitle(a, b) {
  return String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' })
    || String(a.artist || '').localeCompare(String(b.artist || ''), undefined, { sensitivity: 'base' });
}

/** Use one title-first label wherever a song is shown as a compact item. */
function songDisplayName(song) {
  const title = String(song && song.title != null ? song.title : '').trim();
  const artist = String(song && song.artist != null ? song.artist : '').trim();
  return artist ? `${title} - ${artist}` : title;
}

/** Use natural singular/plural wording for library and playlist totals. */
function songCountLabel(count) {
  return `${count} song${count === 1 ? '' : 's'}`;
}

/** Return unique playlist names in a predictable order for all picker controls. */
function playlistNames() {
  return [...new Set(state.data.playlists.map((item) => item.playlist))].sort((a, b) => a.localeCompare(b));
}

/** Convert a raw playlist name to its ordered items. */
function itemsForPlaylist(name) {
  return state.data.playlists.filter((item) => item.playlist === name && (item.type !== 'song' || hasTitle(songById(item.ref)))).sort((a, b) => Number(a.position) - Number(b.position));
}

/** Display a short-lived, non-blocking status message. */
function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 4200);
}

/** Update the sync indicators that remain visible while changing views. */
function renderStatus() {
  const syncedAt = localStorage.getItem(STORAGE.syncedAt);
  syncStatus.textContent = syncedAt ? `Synced ${new Date(syncedAt).toLocaleString()}` : 'Local library';
  const pendingCount = state.pendingBpm.length + state.pendingNotes.length;
  pendingBadge.hidden = pendingCount === 0;
  pendingBadge.textContent = `${pendingCount} unsynced`;
}

/** Build navigation once per normal screen; play mode replaces the entire app area. */
function tabs() {
  return `<nav class="tabs" aria-label="Main navigation">
    ${['library', 'playlists', 'play'].map((view) => `<button class="${state.view === view ? 'active' : ''}" data-view="${view}">${view[0].toUpperCase() + view.slice(1)}</button>`).join('')}
  </nav>`;
}

/** Render the active standard view and then attach its event handlers. */
function render() {
  if (state.play) { renderPlayMode(); return; }
  renderStatus();
  if (state.view === 'library') renderLibrary();
  if (state.view === 'playlists') renderPlaylists();
  if (state.view === 'play') renderPlayPicker();
}

/** Attach shared tab handlers after a normal-view render. */
function bindTabs() {
  app.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
    state.view = button.dataset.view;
    state.editingSongId = null;
    render();
  }));
}

/** Render the local song library, with one song editor expanded at a time. */
function renderLibrary() {
  const songs = [...titledSongs()].sort(compareSongsByTitle);
  app.innerHTML = `${tabs()}<section class="view-header"><h2>Library <span class="song-count">${songCountLabel(songs.length)}</span></h2><button id="refresh" class="primary">Refresh</button></section>
    <p class="muted">Edit BPM and notes here. Changes are saved locally and sync when connected.</p>
    <section>${songs.length ? songs.map((song) => state.editingSongId === String(song.id) ? songEditor(song) : `<button class="song" data-edit-song="${escapeHtml(song.id)}"><strong>${escapeHtml(songDisplayName(song))}</strong><span class="bpm">${escapeHtml(song.bpm)}</span></button>`).join('') : '<p class="empty">No songs cached yet. Add your Apps Script URL in Settings, then refresh.</p>'}</section>
    ${settingsMarkup()}`;
  bindTabs();
  document.querySelector('#refresh').addEventListener('click', refreshData);
  app.querySelectorAll('[data-edit-song]').forEach((button) => button.addEventListener('click', () => { state.editingSongId = button.dataset.editSong; render(); }));
  bindSongEditor();
  bindSettings();
}

/** Create the compact editable song card. */
function songEditor(song) {
  return `<section class="card form-card"><strong>${escapeHtml(songDisplayName(song))}</strong><label for="editBpm">BPM</label><div class="bpm-control"><button type="button" data-bpm-step="-1" aria-label="Decrease BPM">−</button><input id="editBpm" type="number" inputmode="numeric" min="1" max="400" value="${escapeHtml(song.bpm)}"><button type="button" data-bpm-step="1" aria-label="Increase BPM">+</button></div><label for="editNotes">Notes</label><textarea id="editNotes" rows="4" placeholder="Add performance notes">${escapeHtml(song.notes)}</textarea><div class="actions"><button id="saveSong" class="primary">Save changes</button><button id="cancelSong">Cancel</button></div></section>`;
}

/** Wire song editing controls, validating before a local-first save. */
function bindSongEditor() {
  const input = app.querySelector('#editBpm');
  if (!input) return;
  app.querySelectorAll('[data-bpm-step]').forEach((button) => button.addEventListener('click', () => {
    input.value = Math.max(1, Math.min(400, Number(input.value || 0) + Number(button.dataset.bpmStep)));
  }));
  app.querySelector('#cancelSong').addEventListener('click', () => { state.editingSongId = null; render(); });
  app.querySelector('#saveSong').addEventListener('click', () => {
    const bpm = Number(input.value);
    if (!Number.isFinite(bpm) || bpm < 1 || bpm > 400) { showToast('Enter a BPM from 1 to 400.'); return; }
    const song = songById(state.editingSongId);
    if (Math.round(bpm) !== Number(song.bpm)) updateLocalBpm(song.id, Math.round(bpm));
    if (app.querySelector('#editNotes').value !== String(song.notes || '')) updateLocalNotes(song.id, app.querySelector('#editNotes').value);
    state.editingSongId = null;
    render();
    flushPendingChanges();
  });
}

/** Update cached song data and replace (rather than duplicate) its pending sync entry. */
function updateLocalBpm(id, bpm) {
  const song = songById(id);
  if (!song) return;
  song.bpm = bpm;
  state.pendingBpm = state.pendingBpm.filter((entry) => String(entry.id) !== String(id));
  state.pendingBpm.push({ id: song.id, bpm });
  saveData();
  localStorage.setItem(STORAGE.pendingBpm, JSON.stringify(state.pendingBpm));
  renderStatus();
}

/** Update cached notes and replace (rather than duplicate) their pending sync entry. */
function updateLocalNotes(id, notes) {
  const song = songById(id);
  if (!song) return;
  song.notes = notes;
  state.pendingNotes = state.pendingNotes.filter((entry) => String(entry.id) !== String(id));
  state.pendingNotes.push({ id: song.id, notes });
  saveData();
  localStorage.setItem(STORAGE.pendingNotes, JSON.stringify(state.pendingNotes));
  renderStatus();
}

/** The settings are intentionally at the bottom: most use is offline and needs no configuration screen. */
function settingsMarkup() {
  const endpoint = localStorage.getItem(STORAGE.endpoint) || '';
  return `<section class="card form-card" style="margin-top:24px"><strong>Settings</strong><label for="endpoint">Apps Script web-app URL</label><input id="endpoint" type="url" inputmode="url" placeholder="https://script.google.com/.../exec" value="${escapeHtml(endpoint)}"><div class="actions"><button id="saveSettings">Save URL</button>${'requestMIDIAccess' in navigator ? '<button id="enableMidi">Enable MIDI</button>' : ''}</div><div id="midiSettings"></div><p class="settings-note">The URL stays only on this device. Use Refresh after saving it.</p></section>`;
}

/** Bind configuration controls only when the settings card appears. */
function bindSettings() {
  const save = app.querySelector('#saveSettings');
  if (!save) return;
  save.addEventListener('click', () => {
    const value = app.querySelector('#endpoint').value.trim();
    if (value && !/^https:\/\//i.test(value)) { showToast('Use the full https:// Apps Script URL.'); return; }
    localStorage.setItem(STORAGE.endpoint, value);
    showToast(value ? 'Apps Script URL saved.' : 'Apps Script URL removed.');
  });
  const midi = app.querySelector('#enableMidi');
  if (midi) midi.addEventListener('click', enableMidi);
  renderMidiSettings();
}

/** Refresh MIDI options after permission is granted from a user gesture. */
async function enableMidi() {
  try {
    state.midiAccess = await navigator.requestMIDIAccess();
    state.midiAccess.onstatechange = () => { selectMidiOutput(); renderMidiSettings(); };
    selectMidiOutput();
    renderMidiSettings();
  } catch (_) { showToast('MIDI access was not granted.'); }
}

/** Select the remembered MIDI output if it still exists, otherwise use the first available port. */
function selectMidiOutput() {
  if (!state.midiAccess) return;
  const ports = [...state.midiAccess.outputs.values()];
  const savedId = localStorage.getItem(STORAGE.midiPort);
  state.midiOutput = ports.find((port) => port.id === savedId) || ports[0] || null;
}

/** Show a port picker only on browsers that both expose and have enabled Web MIDI. */
function renderMidiSettings() {
  const container = app.querySelector('#midiSettings');
  if (!container || !state.midiAccess) return;
  const ports = [...state.midiAccess.outputs.values()];
  container.innerHTML = ports.length ? `<label for="midiPort">MIDI clock output</label><select id="midiPort">${ports.map((port) => `<option value="${escapeHtml(port.id)}" ${state.midiOutput && port.id === state.midiOutput.id ? 'selected' : ''}>${escapeHtml(port.name || 'Unnamed output')}</option>`).join('')}</select>` : '<p class="settings-note">No MIDI outputs found.</p>';
  const select = container.querySelector('#midiPort');
  if (select) select.addEventListener('change', () => { localStorage.setItem(STORAGE.midiPort, select.value); selectMidiOutput(); });
}

/** Render playlist selection and the editing surface when one is active. */
function renderPlaylists() {
  const names = playlistNames();
  if (!state.playlistName && names.length) openPlaylist(names[0]);
  const songCount = state.playlistItems.filter((item) => item.type === 'song').length;
  app.innerHTML = `${tabs()}<section class="view-header"><h2>Playlists${state.playlistName ? ` <span class="song-count">${songCountLabel(songCount)}</span>` : ''}</h2><button id="newPlaylist" class="primary">New</button></section>
    ${names.length ? `<label class="muted" for="playlistSelect">Playlist</label><select id="playlistSelect">${names.map((name) => `<option ${name === state.playlistName ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select>` : ''}
    ${state.playlistName ? playlistEditorMarkup() : '<p class="empty">Create a playlist, then add songs and set headings.</p>'}`;
  bindTabs();
  app.querySelector('#newPlaylist').addEventListener('click', () => {
    const name = window.prompt('Playlist name');
    if (name && name.trim()) { state.playlistName = name.trim(); state.playlistOriginalName = null; state.playlistItems = []; render(); }
  });
  const picker = app.querySelector('#playlistSelect');
  if (picker) picker.addEventListener('change', () => { openPlaylist(picker.value); render(); });
  bindPlaylistEditor();
}

/** Load an existing playlist into an isolated draft, so cancel/re-renders never mutate cached source rows. */
function openPlaylist(name) {
  state.playlistName = name;
  state.playlistOriginalName = name;
  state.playlistItems = itemsForPlaylist(name).map((item) => ({ type: item.type, ref: item.ref }));
}

/** Create the editor markup from its local draft. */
function playlistEditorMarkup() {
  const songOptions = titledSongs().slice().sort(compareSongsByTitle).map((song) => `<option value="${escapeHtml(song.id)}">${escapeHtml(songDisplayName(song))}</option>`).join('');
  return `<section class="card form-card" style="margin-top:12px"><label for="playlistName">Name</label><input id="playlistName" value="${escapeHtml(state.playlistName)}"><label for="addSong">Add a song</label><div class="add-grid"><select id="addSong">${songOptions || '<option>No songs in library</option>'}</select><button id="addSongButton">Add</button></div><label for="headingText">Add a heading</label><div class="add-grid"><input id="headingText" placeholder="e.g. Set 2"><button id="addHeading">Add</button></div>
    <section id="playlistItems">${state.playlistItems.length ? state.playlistItems.map((item, index) => item.type === 'heading' ? `<div class="playlist-item heading"><span>${escapeHtml(item.ref)}</span>${itemControls(index)}</div>` : `<div class="playlist-item"><strong>${escapeHtml(songDisplayName(songById(item.ref)) || `Missing song #${item.ref}`)}</strong>${itemControls(index)}</div>`).join('') : '<p class="empty">This playlist is empty.</p>'}</section>
    <div class="editor-actions"><button id="savePlaylist" class="primary">Save playlist</button>${state.playlistOriginalName ? '<button id="deletePlaylist" class="danger">Delete playlist</button>' : ''}</div></section>`;
}

/** Small up/down/remove controls are deliberately used instead of fragile touch drag-and-drop. */
function itemControls(index) {
  return `<span class="item-buttons"><button data-move="${index}" data-direction="-1" aria-label="Move up">↑</button><button data-move="${index}" data-direction="1" aria-label="Move down">↓</button><button data-remove="${index}" aria-label="Remove">×</button></span>`;
}

/** Bind draft-only playlist operations and rerender to show their new order immediately. */
function bindPlaylistEditor() {
  const addSong = app.querySelector('#addSongButton');
  if (!addSong) return;
  addSong.addEventListener('click', () => { const id = app.querySelector('#addSong').value; if (songById(id)) { state.playlistItems.push({ type: 'song', ref: id }); render(); } });
  app.querySelector('#addHeading').addEventListener('click', () => { const input = app.querySelector('#headingText'); if (input.value.trim()) { state.playlistItems.push({ type: 'heading', ref: input.value.trim() }); render(); } });
  app.querySelectorAll('[data-remove]').forEach((button) => button.addEventListener('click', () => { state.playlistItems.splice(Number(button.dataset.remove), 1); render(); }));
  app.querySelectorAll('[data-move]').forEach((button) => button.addEventListener('click', () => {
    const from = Number(button.dataset.move); const to = from + Number(button.dataset.direction);
    if (to >= 0 && to < state.playlistItems.length) [state.playlistItems[from], state.playlistItems[to]] = [state.playlistItems[to], state.playlistItems[from]];
    render();
  }));
  app.querySelector('#savePlaylist').addEventListener('click', savePlaylist);
  const remove = app.querySelector('#deletePlaylist');
  if (remove) remove.addEventListener('click', deletePlaylist);
}

/** Save a whole playlist atomically on the server, updating cache only after that succeeds. */
async function savePlaylist() {
  const name = app.querySelector('#playlistName').value.trim();
  if (!name) { showToast('A playlist needs a name.'); return; }
  const original = state.playlistOriginalName;
  try {
    await apiPost({ action: 'savePlaylist', name, items: state.playlistItems });
    if (original && original !== name) await apiPost({ action: 'deletePlaylist', name: original });
    state.data.playlists = state.data.playlists.filter((item) => item.playlist !== original && item.playlist !== name);
    state.data.playlists.push(...state.playlistItems.map((item, index) => ({ playlist: name, position: index + 1, type: item.type, ref: item.ref })));
    state.playlistName = name; state.playlistOriginalName = name; saveData(); render(); showToast('Playlist saved.');
  } catch (error) { showToast(error.message || 'Could not save. Your editor draft is still here.'); }
}

/** Delete only after a deliberate confirmation, then remove it from the local cache. */
async function deletePlaylist() {
  if (!window.confirm(`Delete “${state.playlistOriginalName}”?`)) return;
  try {
    await apiPost({ action: 'deletePlaylist', name: state.playlistOriginalName });
    state.data.playlists = state.data.playlists.filter((item) => item.playlist !== state.playlistOriginalName);
    state.playlistName = null; state.playlistOriginalName = null; state.playlistItems = []; saveData(); render();
  } catch (error) { showToast(error.message || 'Could not delete the playlist.'); }
}

/** Render the offline playlist picker that leads into distraction-free play mode. */
function renderPlayPicker() {
  const names = playlistNames();
  app.innerHTML = `${tabs()}<section class="view-header"><h2>Play</h2></section>${names.length ? `<section class="card form-card"><label for="playPicker">Choose a playlist</label><select id="playPicker">${names.map((name) => `<option>${escapeHtml(name)}</option>`).join('')}</select><div class="actions"><button id="startPlay" class="primary">Start play mode</button></div></section>` : '<p class="empty">Save a playlist before entering play mode.</p>'}`;
  bindTabs();
  const start = app.querySelector('#startPlay');
  if (start) start.addEventListener('click', () => startPlay(app.querySelector('#playPicker').value));
}

/** Enter play mode using only cached items; networking is never needed at a gig. */
async function startPlay(name) {
  const items = itemsForPlaylist(name);
  if (!items.length) { showToast('That playlist is empty.'); return; }
  state.play = { name, items, index: 0 };
  await requestWakeLock();
  render();
}

/** Render the fullscreen stage display and navigation zones. */
function renderPlayMode() {
  const item = state.play.items[state.play.index];
  const song = item.type === 'song' ? songById(item.ref) : null;
  app.innerHTML = `<section class="play-shell"><div class="play-top"><button id="exitPlay" class="ghost">← Exit</button><span class="play-progress">${state.play.index + 1} / ${state.play.items.length}</span><div class="play-controls">${song && state.midiOutput ? `<button id="toggleAudio" class="${state.audioMuted ? 'audio-muted' : ''}">${state.audioMuted ? 'Unmute audio' : 'Mute audio'}</button>` : ''}<button id="toggleMetro" class="${state.metronomeRunning ? 'metro-playing' : ''}" ${song ? '' : 'hidden'}>${state.metronomeRunning ? 'Stop click' : 'Play click'}</button></div></div><div class="play-song" id="playContent">${song ? (state.editingSongId === String(song.id) ? playSongEditor(song) : `<button class="play-edit ghost" id="playEdit">Edit song</button><h2 class="play-title">${escapeHtml(song.title)}</h2><div class="play-bpm">${escapeHtml(song.bpm)}</div><div class="play-bpm-label">BPM</div><div class="play-artist">${escapeHtml(song.artist)}</div>${song.notes ? `<p class="play-notes">${escapeHtml(song.notes)}</p>` : ''}`) : `<div class="play-heading">${escapeHtml(item.ref)}</div>`}</div><div class="play-bottom"><div class="tap-nav"><button id="previous" ${state.play.index === 0 ? 'disabled' : ''}>← Previous</button><button id="next" ${state.play.index === state.play.items.length - 1 ? 'disabled' : ''}>Next →</button></div></div></section>`;
  app.querySelector('#exitPlay').addEventListener('click', exitPlay);
  app.querySelector('#previous').addEventListener('click', () => movePlay(-1));
  app.querySelector('#next').addEventListener('click', () => movePlay(1));
  const metro = app.querySelector('#toggleMetro'); if (metro) metro.addEventListener('click', toggleMetronome);
  const audio = app.querySelector('#toggleAudio'); if (audio) audio.addEventListener('click', toggleAudioMute);
  const edit = app.querySelector('#playEdit'); if (edit) edit.addEventListener('click', () => { state.editingSongId = String(song.id); renderPlayMode(); });
  bindPlaySongEditor();
  const content = app.querySelector('#playContent');
  if (!state.editingSongId) {
    content.addEventListener('touchstart', (event) => { state.touchStartX = event.changedTouches[0].clientX; }, { passive: true });
    content.addEventListener('touchend', (event) => { const distance = event.changedTouches[0].clientX - state.touchStartX; if (Math.abs(distance) > 55) movePlay(distance < 0 ? 1 : -1); }, { passive: true });
  }
}

/** Create a touch-friendly editor without leaving the current song in play mode. */
function playSongEditor(song) {
  return `<section class="card form-card play-editor"><strong>${escapeHtml(songDisplayName(song))}</strong><label for="playEditBpm">BPM</label><input id="playEditBpm" type="number" inputmode="numeric" min="1" max="400" value="${escapeHtml(song.bpm)}"><label for="playEditNotes">Notes</label><textarea id="playEditNotes" rows="5" placeholder="Add performance notes">${escapeHtml(song.notes)}</textarea><div class="actions"><button id="savePlaySong" class="primary">Save changes</button><button id="cancelPlaySong">Cancel</button></div></section>`;
}

/** Save the current play-screen song with the same offline queue used by the library. */
function bindPlaySongEditor() {
  const input = app.querySelector('#playEditBpm');
  if (!input) return;
  app.querySelector('#cancelPlaySong').addEventListener('click', () => { state.editingSongId = null; renderPlayMode(); });
  app.querySelector('#savePlaySong').addEventListener('click', () => {
    const bpm = Number(input.value);
    if (!Number.isFinite(bpm) || bpm < 1 || bpm > 400) { showToast('Enter a BPM from 1 to 400.'); return; }
    const song = songById(state.editingSongId);
    if (Math.round(bpm) !== Number(song.bpm)) updateLocalBpm(song.id, Math.round(bpm));
    if (app.querySelector('#playEditNotes').value !== String(song.notes || '')) updateLocalNotes(song.id, app.querySelector('#playEditNotes').value);
    state.editingSongId = null;
    renderPlayMode();
    flushPendingChanges();
  });
}

/** Shift a play position; changing screens always stops the current click cleanly. */
function movePlay(direction) {
  const next = state.play.index + direction;
  if (next < 0 || next >= state.play.items.length) return;
  stopMetronome();
  state.editingSongId = null;
  state.play.index = next;
  renderPlayMode();
}

/** Leave stage mode and release resources that should not outlive it. */
function exitPlay() {
  stopMetronome();
  if (state.wakeLock) state.wakeLock.release().catch(() => {});
  state.wakeLock = null; state.play = null; state.editingSongId = null; render();
}

/** Request a wake lock opportunistically; unsupported browsers remain fully usable. */
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    state.wakeLock = lock;
    // Browsers can release a lock when hidden; clear our reference so it can be requested again.
    lock.addEventListener('release', () => { if (state.wakeLock === lock) state.wakeLock = null; });
  } catch (_) { showToast('Screen wake lock is unavailable.'); }
}

/** Reacquire the lock after iOS/browser visibility transitions while stage mode remains active. */
document.addEventListener('visibilitychange', () => { if (state.play && document.visibilityState === 'visible' && !state.wakeLock) requestWakeLock(); });

/** Create/resume Web Audio only in response to a tap, as iOS Safari requires. */
async function toggleMetronome() {
  if (state.metronomeRunning) { stopMetronome(); renderPlayMode(); return; }
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) { showToast('This browser cannot play the metronome.'); return; }
  state.audio = state.audio || new AudioCtor();
  if (!state.clickOutput) {
    state.clickOutput = state.audio.createGain();
    state.clickOutput.connect(state.audio.destination);
  }
  state.clickOutput.gain.setValueAtTime(state.audioMuted ? 0 : 1, state.audio.currentTime);
  await state.audio.resume();
  state.metronomeRunning = true;
  state.nextClickAt = state.audio.currentTime + 0.04;
  state.nextMidiAt = state.nextClickAt;
  if (state.midiOutput) state.midiOutput.send([0xFA]);
  scheduler();
  renderPlayMode();
}

/** Mute the app's audio click without interrupting a running MIDI clock. */
function toggleAudioMute() {
  state.audioMuted = !state.audioMuted;
  if (state.audio && state.clickOutput) state.clickOutput.gain.setValueAtTime(state.audioMuted ? 0 : 1, state.audio.currentTime);
  renderPlayMode();
}

/** Stop future scheduling and tell hardware that its transport is no longer running. */
function stopMetronome() {
  if (!state.metronomeRunning) return;
  state.metronomeRunning = false;
  clearTimeout(state.schedulerTimer);
  state.schedulerTimer = null;
  // Cancel the small look-ahead queue too, so changing songs never leaks one last click.
  state.scheduledSources.forEach((source) => { try { source.stop(state.audio.currentTime); } catch (_) {} });
  state.scheduledSources = [];
  if (state.midiOutput) state.midiOutput.send([0xFC]);
}

/** Return the live BPM so an in-place edit takes effect on the next scheduled beat. */
function currentPlayBpm() {
  const item = state.play && state.play.items[state.play.index];
  return Number(item && item.type === 'song' && songById(item.ref)?.bpm) || 120;
}

/**
 * Look-ahead scheduler: timer callbacks only queue future Web Audio/MIDI events.
 * They never make sound themselves, avoiding timer jitter in the audible clock.
 */
function scheduler() {
  if (!state.metronomeRunning || !state.audio) return;
  const horizon = state.audio.currentTime + 0.16;
  while (state.nextClickAt < horizon) {
    scheduleClick(state.nextClickAt);
    state.nextClickAt += 60 / currentPlayBpm();
  }
  while (state.nextMidiAt < horizon) {
    scheduleMidiClock(state.nextMidiAt);
    state.nextMidiAt += 60 / currentPlayBpm() / 24;
  }
  state.schedulerTimer = setTimeout(scheduler, 25);
}

/** Synthesize a short, bright two-oscillator click at an exact AudioContext time. */
function scheduleClick(when) {
  const gain = state.audio.createGain();
  const osc = state.audio.createOscillator();
  const overtone = state.audio.createOscillator();
  gain.gain.setValueAtTime(0.0001, when);
  // Keep the click at full-scale output; listening level is controlled by the device.
  gain.gain.exponentialRampToValueAtTime(1, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
  osc.type = 'square'; osc.frequency.setValueAtTime(620, when);
  overtone.type = 'square'; overtone.frequency.setValueAtTime(940, when);
  osc.connect(gain); overtone.connect(gain); gain.connect(state.clickOutput);
  state.scheduledSources.push(osc, overtone);
  // Prune ended oscillators, keeping the cancellation list bounded during long sets.
  [osc, overtone].forEach((source) => source.addEventListener('ended', () => {
    state.scheduledSources = state.scheduledSources.filter((scheduled) => scheduled !== source);
  }));
  osc.start(when); overtone.start(when); osc.stop(when + 0.065); overtone.stop(when + 0.065);
}

/** Translate AudioContext time into MIDI's performance-time timestamps for a common stable schedule. */
function scheduleMidiClock(audioWhen) {
  if (!state.midiOutput) return;
  const timestamp = performance.now() + Math.max(0, audioWhen - state.audio.currentTime) * 1000;
  state.midiOutput.send([0xF8], timestamp);
}

/** Require a configured endpoint for all remote activity, keeping the repository URL-free. */
function endpoint() {
  const url = localStorage.getItem(STORAGE.endpoint);
  if (!url) throw new Error('Add your Apps Script web-app URL in Settings first.');
  return url;
}

/** Fetch all remote data in a single GET, preserving cached data on any failure. */
async function refreshData() {
  try {
    const response = await fetch(endpoint(), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Refresh failed (${response.status}).`);
    const data = await response.json();
    if (!Array.isArray(data.songs) || !Array.isArray(data.playlists)) throw new Error('The server returned invalid data.');
    state.data = data; saveData(); localStorage.setItem(STORAGE.syncedAt, new Date().toISOString());
    // Server data is newest except for edits queued locally while offline; those win until flushed.
    state.pendingBpm.forEach((entry) => { const song = songById(entry.id); if (song) song.bpm = entry.bpm; });
    state.pendingNotes.forEach((entry) => { const song = songById(entry.id); if (song) song.notes = entry.notes; });
    saveData();
    await flushPendingChanges(); render(); showToast('Library refreshed.');
  } catch (error) { showToast(error.message || 'Could not refresh; cached data is still available.'); }
}

/** Use text/plain to keep this cross-origin POST a CORS-simple request for Apps Script web apps. */
async function apiPost(payload) {
  const response = await fetch(endpoint(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Server request failed (${response.status}).`);
  const result = await response.json();
  if (!result.success) throw new Error(result.error || 'The server could not save that change.');
  return result;
}

/** Flush pending edits one at a time so a partial network failure leaves the rest safely queued. */
async function flushPendingBpm() {
  if (!state.pendingBpm.length || !navigator.onLine) return;
  try {
    for (const entry of [...state.pendingBpm]) {
      await apiPost({ action: 'updateBpm', id: entry.id, bpm: entry.bpm });
      state.pendingBpm = state.pendingBpm.filter((queued) => String(queued.id) !== String(entry.id));
      localStorage.setItem(STORAGE.pendingBpm, JSON.stringify(state.pendingBpm));
    }
    renderStatus();
  } catch (_) { renderStatus(); showToast('BPM change is saved locally and will sync later.'); }
}

/** Flush queued note edits after BPM so both local-first fields recover from offline use. */
async function flushPendingNotes() {
  if (!state.pendingNotes.length || !navigator.onLine) return;
  try {
    for (const entry of [...state.pendingNotes]) {
      await apiPost({ action: 'updateNotes', id: entry.id, notes: entry.notes });
      state.pendingNotes = state.pendingNotes.filter((queued) => String(queued.id) !== String(entry.id));
      localStorage.setItem(STORAGE.pendingNotes, JSON.stringify(state.pendingNotes));
    }
    renderStatus();
  } catch (_) { renderStatus(); showToast('Notes change is saved locally and will sync later.'); }
}

/** Flush every deferred song edit; playlist drafts intentionally remain local until explicitly saved. */
async function flushPendingChanges() {
  await flushPendingBpm();
  await flushPendingNotes();
}

// Sync deferred edits when connectivity returns; this does nothing to playlist drafts by design.
window.addEventListener('online', flushPendingChanges);

// Service worker failures are non-fatal because the app remains usable directly in the browser.
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));

render();
// The spreadsheet is canonical: load its current contents on every app launch.
if (navigator.onLine && localStorage.getItem(STORAGE.endpoint)) refreshData();
