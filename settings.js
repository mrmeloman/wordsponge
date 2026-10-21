const api = globalThis.browser ?? globalThis.chrome;

const results = document.querySelector('.results');
const updateResults = document.querySelector('.update_results');
const wordList = document.getElementById('wordList');

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
  const { customWords, language } = await api.storage.local.get(['customWords', 'language']);
  if (customWords) wordList.value = formatWords(customWords);
  if (language) document.getElementById('languageSelect').value = language;
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

document.getElementById('updateWordsButton').addEventListener('click', async () => {
  const selectedLanguage = document.getElementById('languageSelect').value;

  // If 'Custom' is selected - do not fetch from thewordsponge.com
  if (selectedLanguage === 'Custom') {
    updateResults.textContent = 'Nothing changed as Custom language is selected. Select other language to download word list from wordsponge.com';
    return;
  }

  updateResults.textContent = 'Updating...';
  await api.storage.local.set({ language: selectedLanguage });
  const response = await api.runtime.sendMessage({ action: 'refreshWords', language: selectedLanguage });
  updateResults.textContent = response?.error
    ? `Could not update the word list: ${response.error}`
    : `Word list updated successfully (${response.count} words). Language selected: ${selectedLanguage}`;
});

document.getElementById('languageSelect').addEventListener('change', function () {
  api.storage.local.set({ language: this.value });
});
