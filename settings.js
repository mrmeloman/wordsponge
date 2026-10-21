const api = globalThis.browser ?? globalThis.chrome;

const results = document.querySelector('.results');
const updateResults = document.querySelector('.update_results');
const wordList = document.getElementById('wordList');

function formatWords(words) {
  return Object.entries(words).map(([word, translation]) => `${word}: ${translation}`).join('\n');
}

// Parses "word<sep>translation" lines; the separator is whichever of tab, colon, comma or semicolon appears first
function parseLines(text) {
  const words = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(.+?)\s*[\t:,;]\s*(.+)$/);
    if (match) words[match[1].trim()] = match[2].trim();
  }
  return words;
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
    const text = await file.text();
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
  const response = await api.runtime.sendMessage({ action: 'refreshWords', language: selectedLanguage });
  updateResults.textContent = response?.error
    ? `Could not update the word list: ${response.error}`
    : `Word list updated successfully (${response.count} words). Language selected: ${selectedLanguage}`;
});

document.getElementById('languageSelect').addEventListener('change', function () {
  api.storage.local.set({ language: this.value });
});
