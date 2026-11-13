/* Boot: load settings, build the 3D stage, start the menu. */
(function () {
  'use strict';
  const SMR = window.SMR;
  const app = document.getElementById('app');

  // browser tab icon, from the same spider mark the suit wears
  const icon = document.createElement('link');
  icon.rel = 'icon';
  icon.href = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-82 -82 164 168"><rect x="-82" y="-82" width="164" height="168" rx="30" fill="#05060f"/><path fill="#e5162d" d="' + SMR.emblem.svgPath + '"/></svg>');
  document.head.appendChild(icon);

  SMR.store.load();

  let stage;
  try {
    stage = SMR.createStage(document.getElementById('gl'), document.getElementById('fx'));
  } catch (err) {
    app.classList.add('ready');
    app.innerHTML = '<p style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem;font-size:1.4rem;letter-spacing:.06em;line-height:1.6">Spider-Man: Rebirth needs WebGL to draw its 3D city.<br>Try a current version of Chrome, Edge, Firefox or Safari.</p>';
    console.error(err);
    return;
  }

  SMR.startUI(stage);
  stage.resize();
  stage.start();

  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(stage.resize, 140); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stage.stop(); SMR.audio.pause(true); } else { stage.start(); SMR.audio.pause(false); }
  });

  const fonts = document.fonts && document.fonts.load ? Promise.all([document.fonts.load('900 1rem Spinneret'), document.fonts.load('400 1rem Spinneret')]) : Promise.resolve();
  fonts.catch(() => {}).then(() => app.classList.add('ready'));

  SMR.stage = stage; // handy from the console, and the hook the game will use later
})();
