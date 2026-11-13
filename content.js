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
let wordSettings = {};
// Paused lasts until the page is reloaded or left; pageOff and siteOff are the stored "always off" choices
let paused = false;
let pageOff = false;
let siteOff = false;
let disabledPages = {};
let currentPage = pageKey(window.location.href);
let ui = null;

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

// Combines the intensity settings with the word's own level and cap
function wordRule(key) {
  const setting = wordSettings[key] || {};
  const level = WORD_LEVELS[setting.level] || WORD_LEVELS.normal;
  return {
    chance: Math.min(100, limits.density * level.chance),
    cap: setting.max || level.cap || limits.perWord * level.capFactor,
    weight: level.weight
  };
}

// Applies the frequency settings: the share of matches to replace and the per-word and per-page caps
function shouldReplace(key, rule) {
  const count = usage.perWord.get(key) || 0;
  if (pageFull() || (rule.cap > 0 && count >= rule.cap) || Math.random() * 100 >= rule.chance) return false;
  usage.total += 1;
  usage.perWord.set(key, count + 1);
  return true;
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
  const rules = new Map();
  for (const node of textNodes) {
    const parent = node.parentElement;
    if (!parent || !node.nodeValue.trim() || parent.closest(SKIP_SELECTOR)) continue;
    for (const match of node.nodeValue.matchAll(matcher.regex)) {
      const key = match[0].toLowerCase();
      if (!matcher.lookup.has(key)) continue;
      if (!rules.has(key)) rules.set(key, wordRule(key));
      const rule = rules.get(key);
      if (rule.weight > 0) candidates.push({ node, match, key, rule, order: Math.random() ** (1 / rule.weight) });
    }
  }
  // A random order spreads limited replacements over the whole page instead of piling them up at the top;
  // weighting it by level lets Focus words claim the places first and leaves Familiar words for last
  candidates.sort((a, b) => b.order - a.order);
  const chosen = new Map();
  for (const { node, match, key, rule } of candidates) {
    if (!shouldReplace(key, rule)) continue;
    if (!chosen.has(node)) chosen.set(node, []);
    chosen.get(node).push(match);
  }
  chosen.forEach((matches, node) => replaceMatches(node, matches.sort((a, b) => a.index - b.index)));
}

function undoTranslation(spans = document.querySelectorAll('.translated-word')) {
  const parents = new Set();
  for (const span of spans) {
    parents.add(span.parentNode);
    span.replaceWith(document.createTextNode(span.dataset.original));
  }
  parents.forEach((parent) => parent.normalize());
  if (ui?.cardFor && !ui.cardFor.isConnected) closeCard();
}

// Clicking a word shows the original and opens a card for setting the word's level; clicking it again flips it back
function handleClick(event) {
  if (ui && event.target === ui.host) return;
  const span = event.target.closest?.('.translated-word');
  if (!span) {
    closeCard();
    return;
  }
  const { original, translation } = span.dataset;
  span.textContent = span.textContent === original ? translation : original;
  if (ui?.cardFor === span) closeCard();
  else openCard(span);
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
    if (checkLocation()) return;
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

// The word card and the pause notice live in a shadow root, so the page's styles cannot reach them
const UI_STYLE = `
  .card, .toast { font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2328; background: #ffffff;
    border: 1px solid #d0d7de; border-radius: 8px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18); box-sizing: border-box; }
  .card { position: fixed; width: 270px; padding: 10px 12px; }
  .words { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; margin-bottom: 8px; }
  .words b { font-size: 16px; }
  .words span, .hint { color: #59636e; }
  .levels { display: flex; gap: 4px; }
  button { font: inherit; color: inherit; background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px; padding: 3px 8px; cursor: pointer; }
  button:hover { background: #eef1f4; }
  button:focus-visible { outline: 2px solid #0969da; outline-offset: 1px; }
  .levels button { flex: 1; padding: 3px 0; }
  .levels button[aria-pressed="true"] { background: #0969da; border-color: #0969da; color: #ffffff; }
  .hint { font-size: 12px; margin: 6px 0 8px; }
  .pause { width: 100%; }
  .toast { position: fixed; left: 16px; right: 16px; bottom: 24px; width: fit-content; margin: 0 auto; display: flex; flex-wrap: wrap;
    align-items: center; gap: 8px; padding: 10px 12px; }
  [hidden] { display: none !important; }
  @media (prefers-color-scheme: dark) {
    .card, .toast { color: #e6edf3; background: #22272e; border-color: #444c56; }
    button { background: #2d333b; border-color: #444c56; }
    button:hover { background: #373e47; }
    .words span, .hint { color: #9198a1; }
  }
`;

function element(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function getUI() {
  if (ui?.host.isConnected) return ui;
  const host = element('div');
  host.style.cssText = 'all: initial; display: block; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  // A constructed stylesheet is not subject to the page's content security policy; fall back to a style element
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(UI_STYLE);
    root.adoptedStyleSheets = [sheet];
  } catch {
    root.append(element('style', { textContent: UI_STYLE }));
  }
  const card = element('div', { className: 'card', hidden: true });
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Word Sponge');
  const toast = element('div', { className: 'toast', hidden: true });
  toast.setAttribute('role', 'status');
  root.append(card, toast);
  document.documentElement.appendChild(host);
  ui = { host, card, toast, cardFor: null, toastTimer: 0 };
  toast.addEventListener('mouseenter', () => clearTimeout(ui.toastTimer));
  toast.addEventListener('mouseleave', () => { ui.toastTimer = setTimeout(hideToast, 4000); });
  toast.addEventListener('focusin', () => clearTimeout(ui.toastTimer));
  toast.addEventListener('focusout', () => { ui.toastTimer = setTimeout(hideToast, 4000); });
  return ui;
}

function onCardKey(event) {
  if (event.key !== 'Escape') return;
  const { returnFocus } = ui;
  closeCard();
  if (returnFocus?.isConnected) returnFocus.focus?.({ preventScroll: true });
}

function openCard(span) {
  const { card } = getUI();
  const current = wordSettings[wordKey(span.dataset.original)]?.level || 'normal';
  const hint = element('div', { className: 'hint', textContent: WORD_LEVELS[current].hint });
  const buttons = Object.entries(WORD_LEVELS).map(([name, level]) => {
    const button = element('button', { type: 'button', textContent: level.label, title: level.hint });
    button.setAttribute('aria-pressed', String(name === current));
    button.addEventListener('click', async () => {
      await setWordLevel(span.dataset.original, name);
      if (name === 'known') {
        closeCard();
        return;
      }
      buttons.forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      hint.textContent = `Saved. ${level.hint}.`;
    });
    return button;
  });
  const pause = element('button', { type: 'button', className: 'pause', textContent: 'Pause on this page' });
  pause.addEventListener('click', () => setPaused(true, true));
  card.replaceChildren(
    element('div', { className: 'words' }, [element('b', { textContent: span.dataset.translation }), element('span', { textContent: span.dataset.original })]),
    element('div', { className: 'levels' }, buttons),
    hint,
    pause
  );
  card.hidden = false;
  ui.cardFor = span;
  ui.returnFocus = document.activeElement;
  // Below the word, or above it when there is no room, and always inside the window
  const rect = span.getBoundingClientRect();
  const top = rect.bottom + 6 + card.offsetHeight > window.innerHeight ? rect.top - 6 - card.offsetHeight : rect.bottom + 6;
  card.style.top = `${Math.max(8, top)}px`;
  card.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - card.offsetWidth - 8))}px`;
  buttons.find((button) => button.getAttribute('aria-pressed') === 'true').focus({ preventScroll: true });
  window.addEventListener('keydown', onCardKey, true);
  window.addEventListener('scroll', closeCard, { capture: true, passive: true });
  window.addEventListener('resize', closeCard);
}

function closeCard() {
  if (!ui?.cardFor) return;
  ui.card.hidden = true;
  ui.cardFor = null;
  window.removeEventListener('keydown', onCardKey, true);
  window.removeEventListener('scroll', closeCard, { capture: true });
  window.removeEventListener('resize', closeCard);
}

// A short notice after pausing, so the change is visible and easy to undo or make permanent
function showToast(kind) {
  const { toast } = getUI();
  const turnedBackOn = () => showToast(paused ? 'paused' : 'resumed');
  const notices = {
    paused: ['Word Sponge is paused on this page.', [
      ['Resume', () => setPaused(false, true)],
      ['Always skip this page', async () => { await setPageOff(true); showToast('skipped'); }]
    ]],
    resumed: ['Word Sponge is back on for this page.', []],
    skipped: [`Word Sponge is now always off on ${currentPage}.`, [
      ['Undo', async () => { await setPageOff(false); turnedBackOn(); }]
    ]],
    pageOff: [`Word Sponge is off on ${currentPage}.`, [
      ['Turn back on', async () => { await setPageOff(false); turnedBackOn(); }]
    ]],
    siteOff: [`Word Sponge is off for ${window.location.hostname}.`, [
      ['Turn back on', async () => { await api.storage.sync.remove(window.location.hostname); turnedBackOn(); }]
    ]]
  };
  const [message, actions] = notices[kind];
  toast.replaceChildren(element('span', { textContent: message }), ...actions.map(([label, action]) => {
    const button = element('button', { type: 'button', textContent: label });
    button.addEventListener('click', () => {
      hideToast();
      action();
    });
    return button;
  }));
  toast.hidden = false;
  clearTimeout(ui.toastTimer);
  ui.toastTimer = setTimeout(hideToast, actions.length ? 8000 : 3000);
}

function hideToast() {
  if (!ui) return;
  clearTimeout(ui.toastTimer);
  ui.toast.hidden = true;
}

async function refresh() {
  const { hostname } = window.location;
  const [disabled, stored] = await Promise.all([
    api.storage.sync.get(hostname),
    api.storage.local.get(['words', 'customWords', 'downloadWords', 'frequency', 'wordSettings', 'disabledPages'])
  ]);
  siteOff = Boolean(disabled[hostname]);
  currentPage = pageKey(window.location.href);
  disabledPages = stored.disabledPages || {};
  pageOff = Boolean(disabledPages[currentPage]);
  wordSettings = stored.wordSettings || {};
  if (siteOff || pageOff || paused) {
    stopTranslations();
    return;
  }
  matcher = buildMatcher({ ...(stored.downloadWords ? stored.words : null), ...stored.customWords });
  limits = normalizeFrequency(stored.frequency);
  startTranslations();
}

// Single-page sites change the address without reloading; "this page" follows the address
function checkLocation() {
  const page = pageKey(window.location.href);
  if (page === currentPage) return false;
  currentPage = page;
  if (Boolean(disabledPages[page]) === pageOff) return false;
  refresh();
  return true;
}

function status() {
  return { paused, pageOff, siteOff, replaced: document.querySelectorAll('.translated-word').length };
}

async function setPaused(value, notify) {
  paused = value;
  if (paused) stopTranslations();
  else await refresh();
  if (notify) showToast(paused ? 'paused' : 'resumed');
  return status();
}

async function setPageOff(value) {
  const { disabledPages = {} } = await api.storage.local.get('disabledPages');
  if (value) disabledPages[pageKey(window.location.href)] = true;
  else delete disabledPages[pageKey(window.location.href)];
  await api.storage.local.set({ disabledPages });
}

async function setWordLevel(word, level) {
  const key = wordKey(word);
  const { wordSettings: stored = {} } = await api.storage.local.get('wordSettings');
  const setting = { ...stored[key], level };
  if (level === 'normal') delete setting.level;
  if (Object.keys(setting).length) stored[key] = setting;
  else delete stored[key];
  await api.storage.local.set({ wordSettings: stored });
}

document.addEventListener('click', handleClick);
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (window.location.hostname in changes) refresh();
    return;
  }
  if ('wordSettings' in changes) {
    // Words just marked Known disappear at once; other level changes apply from the next visit, so the page does not reshuffle
    wordSettings = changes.wordSettings.newValue || {};
    undoTranslation([...document.querySelectorAll('.translated-word')].filter((span) => wordSettings[wordKey(span.dataset.original)]?.level === 'known'));
    // Merging the restored text must not give the neighbouring words another chance
    observer?.takeRecords();
  }
  if ('disabledPages' in changes) disabledPages = changes.disabledPages.newValue || {};
  const pageChanged = 'disabledPages' in changes && Boolean(disabledPages[pageKey(window.location.href)]) !== pageOff;
  if (pageChanged || ['words', 'customWords', 'downloadWords', 'frequency'].some((key) => key in changes)) refresh();
});

// The popup and the keyboard shortcut (through the background) control pausing on this page
async function handleMessage(message) {
  if (pageKey(window.location.href) !== currentPage) await refresh();
  if (message.action === 'status') return status();
  if (siteOff || pageOff) {
    if (message.notify) showToast(siteOff ? 'siteOff' : 'pageOff');
    return status();
  }
  return setPaused(message.action === 'togglePause' ? !paused : message.paused, message.notify);
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['status', 'setPaused', 'togglePause'].includes(message.action)) return;
  handleMessage(message).then(sendResponse);
  return true;
});
window.addEventListener('popstate', checkLocation);
window.navigation?.addEventListener('navigatesuccess', checkLocation);
refresh();

// On thewordsponge.com the site's own "update words" button refreshes the downloaded list
if (window.location.hostname === 'thewordsponge.com') {
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('#update-words-button')) api.runtime.sendMessage({ action: 'refreshWords' });
  });
}
