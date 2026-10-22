const api = globalThis.browser ?? globalThis.chrome;

const SKIP_SELECTOR = [
  'head', 'a', 'input', 'textarea', 'select', 'button', 'script', 'style', 'noscript', 'pre', 'code', 'svg', 'math',
  '[contenteditable]:not([contenteditable="false"])', '.ace_editor', '.notranslate', '.translated-word'
].join(', ');
const BOUNDARY = '[\\p{L}\\p{N}\\p{M}_]';

let matcher = null;
let observer = null;
let limits = DEFAULT_FREQUENCY;
let usage = null;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A prefix trie keeps the pattern small; a flat alternation of thousands of words is very slow with the i and u flags
function trieToPattern(words) {
  const root = {};
  for (const word of words) {
    let node = root;
    for (const char of word) node = node[char] ??= {};
    node.end = true;
  }
  const build = (node) => {
    const branches = Object.keys(node).filter((key) => key !== 'end').map((key) => escapeRegExp(key) + build(node[key]));
    if (!branches.length) return '';
    const pattern = branches.length === 1 ? branches[0] : `(?:${branches.join('|')})`;
    return node.end ? `(?:${pattern})?` : pattern;
  };
  return build(root);
}

function buildMatcher(words) {
  const lookup = new Map();
  for (const [word, translation] of Object.entries(words)) {
    const key = word.trim().toLowerCase();
    if (key && typeof translation === 'string' && translation.trim()) lookup.set(key, translation.trim());
  }
  if (!lookup.size) return null;
  return {
    lookup,
    regex: new RegExp(`(?<!${BOUNDARY})${trieToPattern(lookup.keys())}(?!${BOUNDARY})`, 'giu')
  };
}

// Replaces the chosen matches (in document order) of one text node with translated spans
function replaceMatches(textNode, matches) {
  const text = textNode.nodeValue;
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const match of matches) {
    const original = match[0];
    const translation = matcher.lookup.get(original.toLowerCase());
    if (match.index > last) fragment.appendChild(document.createTextNode(text.slice(last, match.index)));
    const span = document.createElement('span');
    span.className = 'translated-word';
    span.dataset.original = original;
    span.dataset.translation = translation;
    span.textContent = translation;
    fragment.appendChild(span);
    last = match.index + original.length;
  }
  if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)));
  textNode.replaceWith(fragment);
}

function pageFull() {
  return limits.perPage > 0 && usage.total >= limits.perPage;
}

// Applies the frequency settings: the share of matches to replace and the per-word and per-page caps
function shouldReplace(key) {
  const count = usage.perWord.get(key) || 0;
  if (pageFull() || (limits.perWord > 0 && count >= limits.perWord) || Math.random() * 100 >= limits.density) return false;
  usage.total += 1;
  usage.perWord.set(key, count + 1);
  return true;
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function translateIn(root) {
  if (!matcher || !root || pageFull()) return;
  const textNodes = [];
  if (root.nodeType === Node.TEXT_NODE) {
    textNodes.push(root);
  } else if (root.nodeType === Node.ELEMENT_NODE) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes.push(walker.currentNode);
  }
  const candidates = [];
  for (const node of textNodes) {
    const parent = node.parentElement;
    if (!parent || !node.nodeValue.trim() || parent.closest(SKIP_SELECTOR)) continue;
    for (const match of node.nodeValue.matchAll(matcher.regex)) {
      const key = match[0].toLowerCase();
      if (matcher.lookup.has(key)) candidates.push({ node, match, key });
    }
  }
  // Picking in random order spreads limited replacements over the whole page instead of piling them up at the top
  const chosen = new Map();
  for (const { node, match, key } of shuffle(candidates)) {
    if (!shouldReplace(key)) continue;
    if (!chosen.has(node)) chosen.set(node, []);
    chosen.get(node).push(match);
  }
  chosen.forEach((matches, node) => replaceMatches(node, matches.sort((a, b) => a.index - b.index)));
}

function undoTranslation() {
  const parents = new Set();
  for (const span of document.querySelectorAll('.translated-word')) {
    parents.add(span.parentNode);
    span.replaceWith(document.createTextNode(span.dataset.original));
  }
  parents.forEach((parent) => parent.normalize());
}

function toggleTranslation(event) {
  const span = event.target.closest?.('.translated-word');
  if (!span) return;
  const { original, translation } = span.dataset;
  span.textContent = span.textContent === original ? translation : original;
}

function stopTranslations() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  undoTranslation();
}

function startTranslations() {
  stopTranslations();
  if (!matcher) return;
  usage = { total: 0, perWord: new Map() };
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        translateIn(mutation.target);
      } else {
        mutation.addedNodes.forEach(translateIn);
      }
    }
    observer.takeRecords();
  });
  translateIn(document.body);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
}

async function refresh() {
  const { hostname } = window.location;
  const [disabled, { words, customWords, downloadWords, frequency }] = await Promise.all([
    api.storage.sync.get(hostname),
    api.storage.local.get(['words', 'customWords', 'downloadWords', 'frequency'])
  ]);
  if (disabled[hostname]) {
    stopTranslations();
    return;
  }
  matcher = buildMatcher({ ...(downloadWords ? words : null), ...customWords });
  limits = normalizeFrequency(frequency);
  startTranslations();
}

document.addEventListener('click', toggleTranslation);
api.storage.onChanged.addListener((changes, area) => {
  const relevant = area === 'sync' ? window.location.hostname in changes : ['words', 'customWords', 'downloadWords', 'frequency'].some((key) => key in changes);
  if (relevant) refresh();
});
refresh();

// On thewordsponge.com the site's own "update words" button refreshes the downloaded list
if (window.location.hostname === 'thewordsponge.com') {
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('#update-words-button')) api.runtime.sendMessage({ action: 'refreshWords' });
  });
}
