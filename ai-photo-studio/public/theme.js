// 深浅色：默认深色，记住用户选择。各页面在 <head> 里最先引入，避免闪烁
(function () {
  var KEY = 'studio:theme';
  function get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  if (get() === 'light') document.documentElement.dataset.theme = 'light';
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!b) return;
    var light = document.documentElement.dataset.theme === 'light';
    if (light) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = 'light';
    set(light ? 'dark' : 'light');
  });
})();
