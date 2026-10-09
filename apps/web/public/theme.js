// Apply the saved preference before the first paint. First visits always use dark.
(() => {
  let theme = 'dark';
  try { if (localStorage.getItem('spool-theme') === 'light') theme = 'light'; } catch { /* Storage can be disabled. */ }
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
