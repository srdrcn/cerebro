// Applies the stored theme before first paint to avoid a light/dark flash.
// Kept as an external file so a strict Content-Security-Policy can be used.
(function () {
  try {
    var theme = window.localStorage.getItem('cerebro.theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch (e) {
    // Storage may be unavailable; the stylesheet then follows the OS theme.
  }
})();
