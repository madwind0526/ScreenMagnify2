(function () {
  const $ = (id) => document.getElementById(id);

  function apply(next) {
    document.documentElement.dataset.theme = next.theme === 'light' ? 'light' : 'dark';
    $('set-top').checked = !!next.alwaysOnTop;
    $('set-freeze').checked = next.freeze !== false;
    if (document.activeElement !== $('set-delay')) $('set-delay').value = next.delay;
    $('set-style').value = next.lensStyle;
    $('set-method').value = next.method;
    $('set-device').value = next.aiDevice;
    // A value that is not in the list (edited settings file, older version) snaps to the nearest option.
    const aiMax = $('set-aimax');
    const wanted = Number(next.aiMaxSize);
    const options = [...aiMax.options].map((option) => Number(option.value));
    aiMax.value = String(options.includes(wanted) ? wanted : options.filter((v) => v > 0).reduce((best, v) => (Math.abs(v - wanted) < Math.abs(best - wanted) ? v : best), 256));
    SM.applyDevice($('set-method'), next.aiDevice);
    if (document.activeElement !== $('set-max')) $('set-max').value = next.lensMaxScale;
    if (document.activeElement !== $('set-size')) $('set-size').value = next.lensSize;
  }

  const save = (patch) => window.api.settings.set(patch).then(apply);
  const clamped = (el, min, max) => {
    const value = Math.max(min, Math.min(max, Math.round(Number(el.value) || min)));
    el.value = value;
    return value;
  };

  $('btn-close').addEventListener('click', () => window.api.window.close());
  $('set-top').addEventListener('change', (e) => save({ alwaysOnTop: e.target.checked }));
  $('set-freeze').addEventListener('change', (e) => save({ freeze: e.target.checked }));
  $('set-delay').addEventListener('change', (e) => save({ delay: clamped(e.target, 0, 10) }));
  $('set-max').addEventListener('change', (e) => save({ lensMaxScale: clamped(e.target, 1, 5) }));
  $('set-size').addEventListener('change', (e) => save({ lensSize: clamped(e.target, 5, 40) }));
  $('set-method').addEventListener('change', (e) => save({ method: e.target.value }));
  $('set-device').addEventListener('change', (e) => save({ aiDevice: e.target.value }));
  $('set-aimax').addEventListener('change', (e) => save({ aiMaxSize: Number(e.target.value) }));
  $('set-style').addEventListener('change', (e) => save({ lensStyle: e.target.value }));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.api.window.close(); });

  window.api.settings.get().then((v) => {
    SM.fillSelect($('set-method'), v.method);
    apply(v);
  });
  window.api.onSettingsChanged(apply);
})();
