const api = globalThis.browser ?? globalThis.chrome;

const SKIP_SELECTOR = [
  'a', 'input', 'textarea', 'select', 'button', 'script', 'style', 'noscript', 'pre', 'code',
  '[contenteditable]:not([contenteditable="false"])', '.ace_editor', '.notranslate', '.translated-word'
].join(', ');

let matcher = null;
let observer = null;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Compiles the word list into a single Unicode-aware regex plus a lookup table
function buildMatcher(words) {
  const lookup = new Map();
  for (const [word, translation] of Object.entries(words)) {
    const key = word.trim().toLowerCase();
    if (key && typeof translation === 'string' && translation.trim()) lookup.set(key, translation.trim());
  }
  if (!lookup.size) return null;
  const alternatives = [...lookup.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
  return {
    lookup,
    regex: new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{N}_])`, 'giu')
  };
}

function replaceWordsInTextNode(textNode) {
  const text = textNode.nodeValue;
  const matches = [...text.matchAll(matcher.regex)];
  if (!matches.length) return;

  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const match of matches) {
    const original = match[0];
    const translation = matcher.lookup.get(original.toLowerCase());
    if (!translation) continue;
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

function translateIn(root) {
  if (!matcher) return;
  const textNodes = [];
  if (root.nodeType === Node.TEXT_NODE) {
    textNodes.push(root);
  } else if (root.nodeType === Node.ELEMENT_NODE) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes.push(walker.currentNode);
  }
  for (const node of textNodes) {
    const parent = node.parentElement;
    if (!parent || !node.nodeValue.trim() || parent.closest(SKIP_SELECTOR)) continue;
    replaceWordsInTextNode(node);
  }
}

function undoTranslation() {
  for (const span of document.querySelectorAll('.translated-word')) {
    span.replaceWith(document.createTextNode(span.dataset.original));
  }
  document.body.normalize();
}

function toggleTranslation(event) {
  const span = event.target.closest('.translated-word');
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
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

async function refresh() {
  const { hostname } = window.location;
  const [disabled, { words, customWords }] = await Promise.all([
    api.storage.sync.get(hostname),
    api.storage.local.get(['words', 'customWords'])
  ]);
  if (disabled[hostname]) {
    stopTranslations();
    return;
  }
  matcher = buildMatcher({ ...(words || {}), ...(customWords || {}) });
  startTranslations();
}

document.body.addEventListener('click', toggleTranslation);
api.storage.onChanged.addListener((changes, area) => {
  const relevant = area === 'sync' ? window.location.hostname in changes : 'words' in changes || 'customWords' in changes;
  if (relevant) refresh();
});
refresh();

// On thewordsponge.com the site's own "update words" button refreshes the downloaded list
if (window.location.hostname === 'thewordsponge.com') {
  document.body.addEventListener('click', (event) => {
    if (event.target.closest('#update-words-button')) api.runtime.sendMessage({ action: 'refreshWords' });
  });
}
