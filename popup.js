const api = globalThis.browser ?? globalThis.chrome;

document.addEventListener('DOMContentLoaded', async () => {
  const domainNameElement = document.querySelector('.domain_name');

  document.getElementById('settings-link').addEventListener('click', (event) => {
    event.preventDefault();
    api.runtime.openOptionsPage();
  });

  // Quick intensity switch; fine-grained limits live on the settings page
  const intensity = document.getElementById('intensity');
  const { frequency } = await api.storage.local.get('frequency');
  for (const [name, preset] of [...Object.entries(FREQUENCY_PRESETS), ['custom', { label: 'Custom...' }]]) {
    intensity.add(new Option(preset.label, name));
  }
  intensity.value = frequencyPreset(frequency);
  intensity.title = describeFrequency(frequency);
  intensity.addEventListener('change', () => {
    if (intensity.value === 'custom') {
      api.runtime.openOptionsPage();
      return;
    }
    const { density, perWord, perPage } = FREQUENCY_PRESETS[intensity.value];
    api.storage.local.set({ frequency: { density, perWord, perPage } });
    intensity.title = describeFrequency({ density, perWord, perPage });
  });

  // Pausing lasts until the page is reloaded or left; the two switches are the lasting choices for this page and site
  const siteToggle = document.getElementById('toggle');
  const pageToggle = document.getElementById('pageToggle');
  const pauseButton = document.getElementById('pause');
  const statusLine = document.getElementById('status');
  const pauseHint = document.getElementById('pauseHint');
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.startsWith('http')) {
    statusLine.textContent = 'Word Sponge does not run on this page.';
    siteToggle.disabled = pageToggle.disabled = true;
    return;
  }
  const { hostname } = new URL(tab.url);
  const page = pageKey(tab.url);
  domainNameElement.textContent = hostname;
  // "This page" ignores the query string, so show exactly which address the page switch covers
  const pageScope = document.getElementById('pageScope');
  pageScope.textContent = pageScope.title = page;
  // Firefox for Android has no keyboard shortcuts
  const [command] = ((await api.commands?.getAll?.()) || []).filter(({ name }) => name === 'toggle-pause');
  let current = null;

  async function render(status) {
    current = status || await api.tabs.sendMessage(tab.id, { action: 'status' }).catch(() => null);
    if (!current) {
      // No content script here: an excluded site, or a tab opened before Word Sponge was installed
      const [sites, { disabledPages = {} }] = await Promise.all([api.storage.sync.get(hostname), api.storage.local.get('disabledPages')]);
      siteToggle.checked = !sites[hostname];
      pageToggle.checked = !disabledPages[page];
      pageToggle.disabled = !siteToggle.checked;
      pauseButton.hidden = true;
      statusLine.textContent = 'Word Sponge is not running on this page. If you just installed it, reload the page.';
      pauseHint.textContent = '';
      return;
    }
    const { paused, pageOff, siteOff, replaced } = current;
    siteToggle.checked = !siteOff;
    pageToggle.checked = !pageOff;
    pageToggle.disabled = siteOff;
    pauseButton.hidden = siteOff || pageOff;
    pauseButton.textContent = paused ? 'Resume on this page' : 'Pause on this page';
    statusLine.textContent = siteOff ? `Off for ${hostname}`
      : pageOff ? 'Off for this page'
      : paused ? 'Paused until you reload or leave this page'
      : `${replaced} ${replaced === 1 ? 'word' : 'words'} replaced on this page`;
    pauseHint.textContent = pauseButton.hidden || !command?.shortcut ? '' : `Shortcut: ${command.shortcut}`;
  }

  // The content script applies stored changes on its own; give it a moment before asking for the new state
  async function renderSoon() {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await render();
  }

  pauseButton.addEventListener('click', async () => {
    render(await api.tabs.sendMessage(tab.id, { action: 'setPaused', paused: !current?.paused }).catch(() => null));
  });
  siteToggle.addEventListener('change', async () => {
    if (siteToggle.checked) await api.storage.sync.remove(hostname);
    else await api.storage.sync.set({ [hostname]: true });
    renderSoon();
  });
  pageToggle.addEventListener('change', async () => {
    const { disabledPages = {} } = await api.storage.local.get('disabledPages');
    if (pageToggle.checked) delete disabledPages[page];
    else disabledPages[page] = true;
    await api.storage.local.set({ disabledPages });
    renderSoon();
  });
  render();
});
