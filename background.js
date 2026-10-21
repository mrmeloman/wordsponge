const api = globalThis.browser ?? globalThis.chrome;

const WORDS_URL = 'https://thewordsponge.com/sponge/words';

// Downloads the word list for a language ("Custom" means the user manages their own list)
async function refreshWords(language) {
  if (language === undefined) ({ language } = await api.storage.local.get('language'));
  if (language === 'Custom') return { skipped: true };
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
  const { language, words, customWords } = await api.storage.local.get(['language', 'words', 'customWords']);
  // Earlier versions kept a hand-edited list in "words" under the Custom language; keep it as the user's list
  if (reason === 'update' && language === 'Custom' && words && !customWords) {
    await api.storage.local.set({ customWords: words });
  }
  if (reason === 'install' || !words) refreshWords(language).catch(console.error);
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
