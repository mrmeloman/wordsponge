// How often words are replaced. Shared by the content script, the popup and the settings page.
// density: percentage of matching words to replace; perWord and perPage: caps per page, 0 means no limit
const DEFAULT_FREQUENCY = { density: 100, perWord: 0, perPage: 0 };

const FREQUENCY_PRESETS = {
  light: { label: 'Light', density: 30, perWord: 1, perPage: 10 },
  balanced: { label: 'Balanced', density: 50, perWord: 2, perPage: 30 },
  intense: { label: 'Intense', density: 80, perWord: 5, perPage: 100 },
  all: { label: 'Everything', ...DEFAULT_FREQUENCY }
};

function normalizeFrequency(frequency) {
  return { ...DEFAULT_FREQUENCY, ...frequency };
}

function frequencyPreset(frequency) {
  const current = normalizeFrequency(frequency);
  const matches = (preset) => Object.keys(DEFAULT_FREQUENCY).every((key) => preset[key] === current[key]);
  return Object.keys(FREQUENCY_PRESETS).find((name) => matches(FREQUENCY_PRESETS[name])) || 'custom';
}

function describeFrequency(frequency) {
  const { density, perWord, perPage } = normalizeFrequency(frequency);
  const times = { 1: 'once', 2: 'twice' }[perWord] || `${perWord} times`;
  return [
    density === 100 ? 'Every matching word' : `About ${density}% of matching words`,
    perWord ? `each word at most ${times}` : 'no limit per word',
    perPage ? `up to ${perPage} per page` : 'no limit per page'
  ].join(', ') + '.';
}

// Per-word levels. Normal follows the settings above; the others change a word's chance, its cap per page,
// and its weight, which decides which words claim the places first when a page limit applies
const WORD_LEVELS = {
  focus: { label: 'Focus', hint: 'New or important: shown more often and picked first', chance: 3, weight: 4, capFactor: 3 },
  normal: { label: 'Normal', hint: 'Follows your intensity settings', chance: 1, weight: 1, capFactor: 1 },
  familiar: { label: 'Familiar', hint: 'Shown rarely, at most once per page', chance: 0.25, weight: 0.25, cap: 1 },
  known: { label: 'Known', hint: 'Never shown, but kept in your list', chance: 0, weight: 0 }
};

function wordKey(word) {
  return word.trim().toLowerCase();
}

// What "this page" means for turning Word Sponge off: the host and path, without query or fragment
function pageKey(url) {
  const { hostname, pathname } = new URL(url);
  return hostname + pathname;
}
