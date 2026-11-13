const api = globalThis.browser ?? globalThis.chrome;

const results = document.querySelector('.results');
const updateResults = document.querySelector('.update_results');
const wordList = document.getElementById('wordList');
const downloadWords = document.getElementById('downloadWords');
const languageSelect = document.getElementById('languageSelect');
const updateWordsButton = document.getElementById('updateWordsButton');
const WORDS_ORIGIN = { origins: ['https://thewordsponge.com/*'] };

function setDownloadsEnabled(enabled) {
  downloadWords.checked = enabled;
  languageSelect.disabled = !enabled;
  updateWordsButton.disabled = !enabled;
}

function formatWords(words) {
  return Object.entries(words).map(([word, translation]) => `${word}: ${translation}`).join('\n');
}

// Parses "word<sep>translation" lines. A tab wins, then ": " as written by the text box, then the first colon, comma or semicolon
function parseLines(text) {
  const words = {};
  const unquote = (value) => value.trim().replace(/^"(.*)"$/s, '$1').replace(/""/g, '"').trim();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || /^"?word"?\s*[\t:,;]\s*"?translation"?$/i.test(line)) continue;
    const separator = line.includes('\t') ? '\t' : line.includes(': ') ? ': ' : line.match(/[:,;]/)?.[0];
    if (!separator) continue;
    const index = line.indexOf(separator);
    const word = unquote(line.slice(0, index));
    const translation = unquote(line.slice(index + separator.length));
    if (word && translation) words[word] = translation;
  }
  return words;
}

// Decodes text files that Excel and friends save as UTF-16 with a byte order mark
async function readTextFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  return new TextDecoder(encoding).decode(bytes);
}

function parseJson(text) {
  const data = JSON.parse(text);
  const entries = Array.isArray(data) ? data : Object.entries(data);
  const words = {};
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [word, translation] = entry.map((item) => String(item).trim());
    if (word && translation) words[word] = translation;
  }
  return words;
}

async function saveCustomWords(customWords) {
  await api.storage.local.set({ customWords });
  wordList.value = formatWords(customWords);
  return Object.keys(customWords).length;
}

document.addEventListener('DOMContentLoaded', async () => {
  const stored = await api.storage.local.get(['customWords', 'language', 'downloadWords']);
  if (stored.customWords) wordList.value = formatWords(stored.customWords);
  if (stored.language) languageSelect.value = stored.language;
  setDownloadsEnabled(Boolean(stored.downloadWords));
});

document.getElementById('saveButton').addEventListener('click', async () => {
  try {
    const count = await saveCustomWords(parseLines(wordList.value));
    results.textContent = `Words saved successfully (${count}).`;
  } catch (error) {
    console.error(error);
    results.textContent = error.message;
  }
});

document.getElementById('wordFile').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await readTextFile(file);
    const uploaded = file.name.toLowerCase().endsWith('.json') ? parseJson(text) : parseLines(text);
    const added = Object.keys(uploaded).length;
    if (!added) throw new Error('No word pairs found in the file.');
    const count = await saveCustomWords({ ...parseLines(wordList.value), ...uploaded });
    results.textContent = `Added ${added} words from ${file.name} (${count} in total).`;
  } catch (error) {
    console.error(error);
    results.textContent = `Could not read ${file.name}: ${error.message}`;
  }
  event.target.value = '';
});

// Downloads are opt-in: enabling them asks the browser for permission to reach thewordsponge.com
downloadWords.addEventListener('change', async () => {
  const granted = downloadWords.checked && await api.permissions.request(WORDS_ORIGIN);
  setDownloadsEnabled(granted);
  await api.storage.local.set({ downloadWords: granted });
  if (downloadWords.checked && !granted) {
    updateResults.textContent = 'Permission to access thewordsponge.com was not granted, so word lists stay local.';
  } else if (!granted) {
    updateResults.textContent = 'Downloads are off. Only your own words are used.';
    api.permissions.remove(WORDS_ORIGIN);
  } else {
    updateResults.textContent = '';
  }
});

updateWordsButton.addEventListener('click', async () => {
  const selectedLanguage = languageSelect.value;
  await api.storage.local.set({ language: selectedLanguage });
  if (!(await api.permissions.contains(WORDS_ORIGIN)) && !(await api.permissions.request(WORDS_ORIGIN))) {
    updateResults.textContent = 'Permission to access thewordsponge.com was not granted.';
    return;
  }
  updateResults.textContent = 'Updating...';
  const response = await api.runtime.sendMessage({ action: 'refreshWords', language: selectedLanguage });
  updateResults.textContent = response?.error
    ? `Could not update the word list: ${response.error}`
    : `Word list updated successfully (${response.count} words). Language selected: ${selectedLanguage}`;
});

// Frequency: a preset sets all limits at once; editing a limit switches to Custom unless it matches a preset
const presetList = document.getElementById('presets');
const density = document.getElementById('density');
const densityValue = document.getElementById('densityValue');
const perWord = document.getElementById('perWord');
const perPage = document.getElementById('perPage');

for (const [name, preset] of [...Object.entries(FREQUENCY_PRESETS), ['custom', { label: 'Custom' }]]) {
  const label = document.createElement('label');
  label.className = 'preset';
  label.innerHTML = '<input type="radio" name="preset"> <strong></strong><span class="hint"></span>';
  label.querySelector('input').value = name;
  label.querySelector('strong').textContent = preset.label;
  label.querySelector('.hint').textContent = name === 'custom' ? 'Set your own limits below.' : describeFrequency(preset);
  presetList.appendChild(label);
}

function renderFrequency(frequency) {
  const current = normalizeFrequency(frequency);
  density.value = current.density;
  densityValue.textContent = `${current.density}%`;
  perWord.value = current.perWord || '';
  perPage.value = current.perPage || '';
  presetList.querySelector(`input[value="${frequencyPreset(current)}"]`).checked = true;
}

function readLimit(input) {
  return Math.max(0, Math.floor(Number(input.value) || 0));
}

function saveFrequency(frequency) {
  const { density, perWord, perPage } = normalizeFrequency(frequency);
  renderFrequency(frequency);
  api.storage.local.set({ frequency: { density, perWord, perPage } });
}

presetList.addEventListener('change', (event) => {
  if (event.target.value === 'custom') density.focus();
  else saveFrequency(FREQUENCY_PRESETS[event.target.value]);
});
density.addEventListener('input', () => { densityValue.textContent = `${density.value}%`; });
for (const input of [density, perWord, perPage]) {
  input.addEventListener('change', () => saveFrequency({ density: Number(density.value), perWord: readLimit(perWord), perPage: readLimit(perPage) }));
}
api.storage.local.get('frequency').then(({ frequency }) => renderFrequency(frequency));
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.frequency) renderFrequency(changes.frequency.newValue);
});

languageSelect.addEventListener('change', function () {
  api.storage.local.set({ language: this.value });
});

// Your words: a level and an optional cap per word, for your own words or the downloaded list
const wordTable = document.getElementById('wordTable');
const wordSearch = document.getElementById('wordSearch');
const levelFilter = document.getElementById('levelFilter');
const wordSource = document.getElementById('wordSource');
const tableInfo = document.getElementById('tableInfo');
const bulkLevel = document.getElementById('bulkLevel');
const bulkLevelSelect = document.getElementById('bulkLevelSelect');
const addWordForm = document.getElementById('addWordForm');
const newWord = document.getElementById('newWord');
const newTranslation = document.getElementById('newTranslation');
const newLevel = document.getElementById('newLevel');
const TABLE_LIMIT = 200;
const state = { customWords: {}, words: {}, wordSettings: {} };

function levelOptions(select, value = 'normal') {
  for (const [name, level] of Object.entries(WORD_LEVELS)) select.add(new Option(level.label, name));
  select.value = value;
  return select;
}

for (const level of Object.values(WORD_LEVELS)) {
  const item = document.createElement('li');
  item.append(Object.assign(document.createElement('strong'), { textContent: level.label }), `: ${level.hint}.`);
  document.getElementById('levelLegend').append(item);
}
levelOptions(newLevel);
levelOptions(levelFilter, '');
levelOptions(bulkLevelSelect);

// changes maps a word key to the fields to change, or to null to forget the word's settings
async function saveWordSettings(changes) {
  const { wordSettings = {} } = await api.storage.local.get('wordSettings');
  for (const [key, change] of Object.entries(changes)) {
    const setting = change ? { ...wordSettings[key], ...change } : {};
    if (setting.level === 'normal') delete setting.level;
    if (!setting.max) delete setting.max;
    if (Object.keys(setting).length) wordSettings[key] = setting;
    else delete wordSettings[key];
  }
  await api.storage.local.set({ wordSettings });
}

function matchingWords() {
  const source = wordSource.value === 'downloaded' ? state.words : state.customWords;
  const query = wordSearch.value.trim().toLowerCase();
  return Object.entries(source).filter(([word, translation]) =>
    (!query || word.toLowerCase().includes(query) || String(translation).toLowerCase().includes(query)) &&
    (!levelFilter.value || (state.wordSettings[wordKey(word)]?.level || 'normal') === levelFilter.value));
}

function wordRow(word, translation, own) {
  const key = wordKey(word);
  const setting = state.wordSettings[key] || {};
  let shownAs = String(translation);
  if (own) {
    shownAs = Object.assign(document.createElement('input'), { type: 'text', value: translation });
    shownAs.setAttribute('aria-label', `Shown instead of ${word}`);
    shownAs.addEventListener('change', () => {
      if (shownAs.value.trim()) saveCustomWords({ ...state.customWords, [word]: shownAs.value.trim() });
      else shownAs.value = translation;
    });
  }
  const level = levelOptions(document.createElement('select'), setting.level || 'normal');
  level.setAttribute('aria-label', `How often ${word} appears`);
  level.addEventListener('change', () => saveWordSettings({ [key]: { level: level.value } }));
  const max = Object.assign(document.createElement('input'), { type: 'number', min: 0, step: 1, placeholder: 'auto', value: setting.max || '' });
  max.setAttribute('aria-label', `Most times per page for ${word}`);
  max.addEventListener('change', () => saveWordSettings({ [key]: { max: readLimit(max) } }));
  let remove = '';
  if (own) {
    remove = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Remove' });
    remove.addEventListener('click', async () => {
      const { [word]: removed, ...rest } = state.customWords;
      await saveCustomWords(rest);
      await saveWordSettings({ [key]: null });
    });
  }
  const row = document.createElement('tr');
  for (const content of [word, shownAs, level, max, remove]) {
    const cell = document.createElement('td');
    cell.append(content);
    row.append(cell);
  }
  return row;
}

function renderTable() {
  const own = wordSource.value !== 'downloaded';
  const total = Object.keys(own ? state.customWords : state.words).length;
  const rows = matchingWords();
  wordTable.replaceChildren(...rows.slice(0, TABLE_LIMIT).map(([word, translation]) => wordRow(word, translation, own)));
  tableInfo.textContent = !total ? (own ? 'No words yet. Add one above, or paste or upload many at once below.' : 'The downloaded list is empty.')
    : rows.length > TABLE_LIMIT ? `Showing ${TABLE_LIMIT} of ${rows.length} matching words. Search to narrow the list.`
    : `${rows.length} of ${total} words shown.`;
  document.getElementById('matchCount').textContent = rows.length;
  bulkLevel.hidden = !rows.length;
}

async function loadWords() {
  const stored = await api.storage.local.get(['customWords', 'words', 'wordSettings', 'downloadWords']);
  state.customWords = stored.customWords || {};
  state.words = (stored.downloadWords && stored.words) || {};
  state.wordSettings = stored.wordSettings || {};
  wordSource.hidden = !Object.keys(state.words).length;
  if (wordSource.hidden) wordSource.value = 'custom';
  if (document.activeElement !== wordList) wordList.value = formatWords(state.customWords);
  // Leave the table alone while one of its fields is being edited, so focus is not lost
  if (!wordTable.contains(document.activeElement)) renderTable();
}

addWordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const word = newWord.value.trim();
  const translation = newTranslation.value.trim();
  if (!word || !translation) return;
  await saveCustomWords({ ...state.customWords, [word]: translation });
  await saveWordSettings({ [wordKey(word)]: { level: newLevel.value } });
  wordSource.value = 'custom';
  levelFilter.value = '';
  wordSearch.value = word;
  addWordForm.reset();
  newLevel.value = 'normal';
  newWord.focus();
  renderTable();
});
wordSearch.addEventListener('input', renderTable);
levelFilter.addEventListener('change', renderTable);
wordSource.addEventListener('change', renderTable);
document.getElementById('bulkApply').addEventListener('click', () => {
  saveWordSettings(Object.fromEntries(matchingWords().map(([word]) => [wordKey(word), { level: bulkLevelSelect.value }])));
});

// Where Word Sponge is off: whole sites from the popup's site switch, single pages from its page switch
const offList = document.getElementById('offList');

async function renderOffList() {
  const [sites, { disabledPages = {} }] = await Promise.all([api.storage.sync.get(null), api.storage.local.get('disabledPages')]);
  const entries = [
    ...Object.keys(sites).filter((host) => sites[host] === true).sort().map((host) => [host, 'whole site', () => api.storage.sync.remove(host)]),
    ...Object.keys(disabledPages).sort().map((page) => [page, 'this page only', async () => {
      const { disabledPages: pages = {} } = await api.storage.local.get('disabledPages');
      delete pages[page];
      await api.storage.local.set({ disabledPages: pages });
    }])
  ];
  offList.replaceChildren(...entries.map(([label, scope, turnOn]) => {
    const button = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Turn back on' });
    button.addEventListener('click', turnOn);
    const item = document.createElement('li');
    item.append(Object.assign(document.createElement('strong'), { textContent: label }), ` (${scope}) `, button);
    return item;
  }));
  if (!entries.length) offList.replaceChildren(Object.assign(document.createElement('li'), { className: 'hint', textContent: 'Nowhere: Word Sponge runs on every site.' }));
}

api.commands.getAll().then((commands) => {
  const shortcut = commands.find(({ name }) => name === 'toggle-pause')?.shortcut;
  document.getElementById('shortcutHint').textContent = shortcut
    ? ` (${shortcut}, which you can change in your browser's extension shortcut settings)`
    : ' (none is set yet; add one in your browser\'s extension shortcut settings)';
});
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' || 'disabledPages' in changes) renderOffList();
  if (area === 'local' && ['customWords', 'words', 'wordSettings', 'downloadWords'].some((key) => key in changes)) loadWords();
});
loadWords();
renderOffList();
