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

languageSelect.addEventListener('change', function () {
  api.storage.local.set({ language: this.value });
});
