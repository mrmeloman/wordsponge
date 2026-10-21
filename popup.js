const api = globalThis.browser ?? globalThis.chrome;

document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('toggle');
  const domainNameElement = document.querySelector('.domain_name');

  document.getElementById('settings-link').addEventListener('click', (event) => {
    event.preventDefault();
    api.runtime.openOptionsPage();
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
    api.storage.sync.set({ [hostname]: !toggle.checked });
  });
});
