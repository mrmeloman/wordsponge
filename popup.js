const api = globalThis.browser ?? globalThis.chrome;

document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('toggle');
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

  // Set the toggle switch state from the stored per-site value for the current tab
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.startsWith('http')) {
    toggle.disabled = true;
    return;
  }
  const { hostname } = new URL(tab.url);
  domainNameElement.textContent = hostname;
  const stored = await api.storage.sync.get(hostname);
  toggle.checked = !stored[hostname];

  // Content scripts pick up the change through storage.onChanged
  toggle.addEventListener('change', () => {
    if (toggle.checked) api.storage.sync.remove(hostname);
    else api.storage.sync.set({ [hostname]: true });
  });
});
