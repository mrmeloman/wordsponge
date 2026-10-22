const api = globalThis.browser ?? globalThis.chrome;

const WORDS_URL = 'https://thewordsponge.com/sponge/words';
const WORDS_ORIGIN = { origins: ['https://thewordsponge.com/*'] };

// Downloads the word list for a language; does nothing unless the user opted in to downloads
async function refreshWords(language) {
  const stored = await api.storage.local.get(['downloadWords', 'language']);
  if (!stored.downloadWords) return { skipped: true };
  if (!(await api.permissions.contains(WORDS_ORIGIN))) throw new Error('Permission to access thewordsponge.com was not granted');
  if (language === undefined) ({ language } = stored);
  const response = await fetch(language ? `${WORDS_URL}/${language}` : WORDS_URL, { credentials: 'include' });
  if (!response.ok) throw new Error(`Server responded with ${response.status}`);
  const words = await response.json();
  if (!words || typeof words !== 'object' || Array.isArray(words)) throw new Error('Unexpected word list format');
  await api.storage.local.set({ words });
  return { count: Object.keys(words).length };
}

async function ensureAlarm() {
  if (!(await api.alarms.get('updateWords'))) {
    api.alarms.create('updateWords', { periodInMinutes: 60 * 24 });
  }
}

api.runtime.onInstalled.addListener(async ({ reason }) => {
  ensureAlarm();
  if (reason !== 'update') return;
  // Earlier versions downloaded by default and kept a hand-edited list in "words" under the "Custom" language
  const { language, words, customWords, downloadWords } = await api.storage.local.get(['language', 'words', 'customWords', 'downloadWords']);
  if (downloadWords !== undefined) return;
  if (language === 'Custom') {
    await api.storage.local.set({ downloadWords: false, customWords: customWords || words || {} });
    await api.storage.local.remove('language');
  } else {
    await api.storage.local.set({ downloadWords: Boolean(words) });
  }
});
api.runtime.onStartup.addListener(ensureAlarm);

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'updateWords') refreshWords().catch(console.error);
});

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'refreshWords') {
    refreshWords(message.language)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
});
