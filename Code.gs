/**
 * Google Apps Script backend bound to the spreadsheet. Deploy as a web app that
 * executes as the sheet owner. The client deliberately uses text/plain POSTs:
 * that keeps the browser request CORS-simple, avoiding a preflight Apps Script
 * web apps cannot reliably answer. ContentService returns JSON to the caller.
 */

/** Return the complete library and all playlist rows in one lightweight request. */
function doGet() {
  try {
    return jsonResponse_({ songs: readRows_('Songs'), playlists: readRows_('Playlists') });
  } catch (error) {
    return jsonResponse_({ success: false, error: error.message });
  }
}

/** Route a JSON request body to a narrowly scoped sheet mutation. */
function doPost(event) {
  try {
    var request = JSON.parse(event.postData && event.postData.contents || '{}');
    var result;
    if (request.action === 'updateBpm') result = updateBpm_(request);
    else if (request.action === 'savePlaylist') result = savePlaylist_(request);
    else if (request.action === 'deletePlaylist') result = deletePlaylist_(request);
    else throw new Error('Unknown action.');
    return jsonResponse_({ success: true, result: result });
  } catch (error) {
    return jsonResponse_({ success: false, error: error.message });
  }
}

/** Convert a header row plus body rows into objects, preserving blank string cells. */
function readRows_(sheetName) {
  var sheet = sheet_(sheetName);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values.shift().map(String);
  return values.filter(function(row) { return row.some(function(value) { return value !== ''; }); }).map(function(row) {
    var object = {};
    headers.forEach(function(header, index) { object[header] = row[index]; });
    return object;
  });
}

/** Update only the bpm cell for one immutable song id. */
function updateBpm_(request) {
  var bpm = Number(request.bpm);
  if (!Number.isInteger(bpm) || bpm < 1 || bpm > 400) throw new Error('BPM must be an integer from 1 to 400.');
  var sheet = sheet_('Songs');
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(String);
  var idColumn = headers.indexOf('id');
  var bpmColumn = headers.indexOf('bpm');
  if (idColumn < 0 || bpmColumn < 0) throw new Error('Songs needs id and bpm columns.');
  for (var row = 1; row < values.length; row++) {
    if (String(values[row][idColumn]) === String(request.id)) {
      sheet.getRange(row + 1, bpmColumn + 1).setValue(bpm);
      return { id: request.id, bpm: bpm };
    }
  }
  throw new Error('Song id not found.');
}

/** Replace all rows for one playlist, retaining every other playlist in the tab. */
function savePlaylist_(request) {
  var name = String(request.name || '').trim();
  var items = request.items;
  if (!name) throw new Error('Playlist name is required.');
  if (!Array.isArray(items)) throw new Error('Playlist items must be an array.');
  items.forEach(function(item) {
    if (!item || (item.type !== 'song' && item.type !== 'heading') || item.ref === undefined || item.ref === '') throw new Error('Invalid playlist item.');
  });
  replacePlaylistRows_(name, items);
  return { name: name, count: items.length };
}

/** Delete all rows belonging to one playlist; an already absent playlist is harmless. */
function deletePlaylist_(request) {
  var name = String(request.name || '').trim();
  if (!name) throw new Error('Playlist name is required.');
  replacePlaylistRows_(name, null);
  return { name: name };
}

/** Rewrite the compact Playlist table after filtering one named playlist. */
function replacePlaylistRows_(name, replacement) {
  var sheet = sheet_('Playlists');
  var values = sheet.getDataRange().getValues();
  var headers = values.length ? values[0].map(String) : ['playlist', 'position', 'type', 'ref'];
  if (headers.join(',') !== 'playlist,position,type,ref') throw new Error('Playlists headers must be playlist, position, type, ref.');
  var kept = values.slice(1).filter(function(row) { return String(row[0]) !== name && row.some(function(value) { return value !== ''; }); });
  var added = (replacement || []).map(function(item, index) { return [name, index + 1, item.type, item.ref]; });
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (kept.concat(added).length) sheet.getRange(2, 1, kept.length + added.length, headers.length).setValues(kept.concat(added));
}

/** Get the bound spreadsheet tab and fail with a useful setup error when it is missing. */
function sheet_(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Missing required sheet tab: ' + name);
  return sheet;
}

/** Always serialize API results as JSON; ContentService supplies a browser-readable response. */
function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
