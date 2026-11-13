/* The menu itself: screens, focus, and what every button does. */
(function () {
  'use strict';
  const SMR = window.SMR;
  const C = SMR.content, store = SMR.store, audio = SMR.audio, input = SMR.input;
  const $ = (id) => document.getElementById(id);
  const app = $('app'), screensEl = $('screens');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let stage = null;
  const screens = {}, stack = [], focusMemo = {};
  let focused = null, busy = false, lastInput = performance.now();
  const top = () => stack[stack.length - 1];
  const suitById = (id) => C.suits.find((s) => s.id === id) || C.suits[0];
  const diffById = (id) => C.difficulties.find((d) => d.id === id) || C.difficulties[1];

  /* ---------- logo: the title with web strands cut through it ---------- */
  function buildLogo() {
    const ox = -70, oy = -90, angles = [];
    for (let i = 0; i <= 9; i++) angles.push(((6 + i * 8.6) * Math.PI) / 180);
    const pt = (a, r) => (ox + Math.cos(a) * r).toFixed(1) + ' ' + (oy + Math.sin(a) * r).toFixed(1);
    let web = angles.map((a) => 'M' + ox + ' ' + oy + 'L' + pt(a, 1400)).join('');
    for (let r = 230; r < 1300; r *= 1.36) {
      for (let i = 0; i < angles.length - 1; i++) web += 'M' + pt(angles[i], r) + 'Q' + pt((angles[i] + angles[i + 1]) / 2, r * 0.9) + ' ' + pt(angles[i + 1], r);
    }
    return '<svg viewBox="0 0 1000 440" aria-hidden="true">' +
      '<defs><mask id="webcut" maskUnits="userSpaceOnUse" x="-60" y="-60" width="1120" height="420"><rect x="-60" y="-60" width="1120" height="420" fill="#fff"/>' +
      '<path d="' + web + '" stroke="#000" stroke-width="2.6" fill="none"/></mask></defs>' +
      '<text class="l-shadow" x="12" y="232" font-size="236" textLength="984" lengthAdjust="spacingAndGlyphs">SPIDER-MAN</text>' +
      '<text class="l-under" x="0" y="220" font-size="236" textLength="984" lengthAdjust="spacingAndGlyphs">SPIDER-MAN</text>' +
      '<g mask="url(#webcut)"><text class="l-main" x="0" y="220" font-size="236" textLength="984" lengthAdjust="spacingAndGlyphs">SPIDER-MAN</text></g>' +
      '<polygon class="l-bar2" points="14,288 1010,288 986,440 -10,440"/><polygon class="l-bar" points="0,276 996,276 972,428 -24,428"/>' +
      '<text class="l-sub" x="62" y="398" font-size="118" textLength="850" lengthAdjust="spacing">REBIRTH</text></svg>';
  }

  /* ---------- small helpers ---------- */
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2300);
  }

  function applySettings() {
    const s = store.all();
    audio.setVolumes(s.master, s.music, s.sfx);
    stage.setOptions({ motion: s.motion, parallax: s.parallax });
    stage.setPalette(s.sky === 'auto' ? SMR.paletteForHour(new Date().getHours()) : s.sky);
    app.classList.toggle('no-grain', !s.grain);
    app.classList.toggle('no-motion', !s.motion);
    app.classList.toggle('contrast', s.contrast);
    document.documentElement.style.setProperty('--text-scale', s.textSize / 100);
    $('fps').hidden = !s.fps;
    stage.onFps(s.fps ? (n) => { $('fps').textContent = n + ' FPS'; } : null);
    const suit = suitById(s.suit);
    document.documentElement.style.setProperty('--accent', suit.accent);
    document.documentElement.style.setProperty('--accent2', suit.accent2);
  }

  const GLYPHS = {
    keyboard: { nav: '↑ ↓', ok: 'Enter', back: 'Esc', tabs: 'Q E', adjust: '← →', hide: 'H', any: 'Any key' },
    gamepad: { nav: 'D-pad', ok: 'A', back: 'B', tabs: 'LB RB', adjust: '← →', any: 'Any button' },
  };
  function renderHints() {
    const scr = screens[top()], set = GLYPHS[input.device()] || GLYPHS.keyboard;
    $('hints').innerHTML = (scr.hints || []).filter(([g]) => set[g]).map(([g, label]) => '<span><i class="kbd">' + esc(set[g]) + '</i>' + esc(label) + '</span>').join('');
  }

  /* ---------- focus and navigation ---------- */
  const items = (el) => Array.from(el.querySelectorAll('[data-nav]')).filter((n) => n.offsetParent !== null);

  function setFocus(node, quiet) {
    if (!node || node === focused) return;
    if (focused) focused.classList.remove('is-focus');
    focused = node;
    node.classList.add('is-focus');
    try { node.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
    const scr = screens[top()];
    focusMemo[scr.id] = items(scr.el).indexOf(node);
    if (!quiet) audio.play('move');
    if (scr.onFocus) scr.onFocus(node);
  }

  function show(id, params) {
    const scr = screens[id];
    Object.values(screens).forEach((s) => s.el.classList.toggle('active', s.id === id));
    app.dataset.screen = id;
    if (scr.shot) stage.setShot(scr.shot);
    stage.setMood('neutral');
    if (focused) { focused.classList.remove('is-focus'); focused = null; }
    if (scr.enter) scr.enter(params || {});
    const list = items(scr.el);
    if (list.length) setFocus(list[Math.max(0, Math.min(focusMemo[id] || 0, list.length - 1))], true);
    renderHints();
  }
  function go(id, params) { stack.push(id); show(id, params); }
  function back() {
    if (stack.length <= 1) return;
    const scr = screens[top()];
    if (scr.leave) scr.leave();
    stack.pop();
    audio.play('back');
    show(top());
  }

  function handle(action) {
    lastInput = performance.now();
    if (busy) return;
    if (app.classList.contains('hide-ui')) { app.classList.remove('hide-ui'); return; }
    const scr = screens[top()];
    if (scr.handle && scr.handle(action)) return;
    const list = items(scr.el), i = list.indexOf(focused);
    const step = (d) => { if (list.length) setFocus(list[(i + d + list.length) % list.length]); };
    if (action === 'up') step(-1);
    else if (action === 'down') step(1);
    else if (action === 'left' || action === 'right') {
      const d = action === 'left' ? -1 : 1;
      if (scr.horizontal) step(d);
      else if (focused && focused._adjust) focused._adjust(d);
    } else if (action === 'confirm') { if (focused && focused._run) focused._run(); }
    else if (action === 'back') { if (scr.onBack) scr.onBack(); else back(); }
    else if (action === 'hide' && scr.canHide) app.classList.add('hide-ui');
  }

  function define(id, def) {
    const el = document.createElement('section');
    el.className = 'screen screen--' + id;
    screensEl.appendChild(el);
    def.id = id; def.el = el;
    screens[id] = def;
    if (def.build) def.build(el);
  }

  function item(label, o) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'item' + (o.locked ? ' is-locked' : '');
    b.dataset.nav = '';
    b.dataset.desc = o.desc || '';
    if (o.mood) b.dataset.mood = o.mood;
    b.innerHTML = '<span>' + esc(label) + '</span>' + (o.tag ? '<i class="tag-on">' + esc(o.tag) + '</i>' : '') + (o.small ? '<small>' + esc(o.small) + '</small>' : '');
    b._run = o.run;
    return b;
  }

  /* ---------- dialog ---------- */
  let dlg = null;
  function dialog(o) { dlg = o; go('dialog'); }
  define('dialog', {
    horizontal: true,
    hints: [['adjust', 'Choose'], ['ok', 'Confirm'], ['back', 'Cancel']],
    build(el) { el.innerHTML = '<div class="dialog" role="alertdialog"><h2></h2><p></p><div class="menu"></div></div>'; },
    enter() {
      const el = this.el, menu = el.querySelector('.menu');
      el.querySelector('h2').textContent = dlg.title;
      el.querySelector('p').textContent = dlg.text;
      menu.innerHTML = '';
      menu.appendChild(item(dlg.no, { run: back }));
      menu.appendChild(item(dlg.yes, { run() { stack.pop(); audio.play('select'); dlg.onYes(); } }));
      focusMemo.dialog = 0;
    },
  });

  /* ---------- title ---------- */
  function begin() {
    audio.unlock();
    audio.play('select');
    stage.react();
    go('main');
  }
  define('title', {
    shot: 'title', canHide: true,
    build(el) { el.innerHTML = '<div class="press" id="press"></div><div class="tag">A fan-made game</div>'; },
    enter() { $('press').textContent = input.device() === 'touch' ? 'Tap to begin' : input.device() === 'gamepad' ? 'Press A' : 'Press any key'; },
    handle(action) { if (action !== 'hide') begin(); else return false; return true; },
  });

  /* ---------- main menu ---------- */
  define('main', {
    shot: 'main', canHide: true,
    hints: [['nav', 'Move'], ['ok', 'Select'], ['hide', 'Hide menu']],
    build(el) { el.innerHTML = '<nav class="menu" aria-label="Main menu"></nav><p class="desc"></p>'; },
    enter() {
      const menu = this.el.querySelector('.menu'), save = store.getSave();
      menu.innerHTML = '';
      if (save) {
        menu.appendChild(item('Continue', {
          small: 'Chapter ' + save.chapter + ' · ' + diffById(save.difficulty).name, mood: 'wide',
          desc: 'Pick up where you left off. Last played ' + new Date(save.updated).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + '.',
          run: () => startGame(save),
        }));
      }
      menu.appendChild(item('New game', { desc: 'Start the story from the first page.', mood: 'wide', run() { audio.play('select'); go('newgame'); } }));
      menu.appendChild(item('Suits', { small: suitById(store.get('suit')).name, desc: 'Change what you wear to work.', run() { audio.play('select'); go('suits'); } }));
      menu.appendChild(item('Options', { desc: 'Sound, picture, controls and comfort.', run() { audio.play('select'); go('options'); } }));
      menu.appendChild(item('Credits', { desc: 'The people and the tools behind the game.', run() { audio.play('select'); go('credits'); } }));
      menu.appendChild(item('Quit', {
        desc: 'Hang up the mask for now.', mood: 'narrow',
        run() {
          audio.play('select');
          dialog({ title: 'Leave the city?', text: 'The rooftops will still be here when you get back.', yes: 'Quit', no: 'Stay', onYes() { stack.length = 1; show('title'); try { window.close(); } catch (e) { /* tabs we did not open stay open */ } } });
        },
      }));
    },
    onFocus(node) { this.el.querySelector('.desc').textContent = node.dataset.desc; stage.setMood(node.dataset.mood || 'neutral'); },
    onBack() {},
  });

  /* ---------- new game ---------- */
  define('newgame', {
    shot: 'panel',
    hints: [['nav', 'Move'], ['ok', 'Start'], ['back', 'Back']],
    build(el) {
      el.innerHTML = '<div class="head"><div class="kicker">New game</div><h2 class="heading">How hard?</h2></div><nav class="menu menu--small" style="top:21.5rem"></nav><p class="desc"></p>';
      const menu = el.querySelector('.menu');
      C.difficulties.forEach((d) => menu.appendChild(item(d.name, {
        desc: d.line, mood: d.id === 'nonet' ? 'narrow' : d.id === 'menace' ? 'focus' : 'neutral',
        run() {
          const fresh = { chapter: 1, difficulty: d.id, suit: store.get('suit'), created: Date.now(), updated: Date.now() };
          store.set('difficulty', d.id);
          if (store.getSave()) dialog({ title: 'Start over?', text: 'You already have a story in progress. A new game replaces it.', yes: 'Start new game', no: 'Keep my save', onYes: () => startGame(fresh) });
          else startGame(fresh);
        },
      })));
    },
    enter() { focusMemo.newgame = Math.max(0, C.difficulties.findIndex((d) => d.id === store.get('difficulty'))); },
    onFocus(node) { this.el.querySelector('.desc').textContent = node.dataset.desc; stage.setMood(node.dataset.mood || 'neutral'); },
  });

  /* ---------- suits ---------- */
  define('suits', {
    shot: 'suits', canHide: true,
    hints: [['nav', 'Browse'], ['ok', 'Wear'], ['back', 'Back'], ['hide', 'Hide menu']],
    build(el) {
      el.innerHTML = '<div class="head"><div class="kicker">Wardrobe</div><h2 class="heading">Suits</h2></div><nav class="menu menu--small" style="top:21.5rem"></nav>' +
        '<div class="suit-card"><div class="name"></div><div class="line"></div><div class="chips"></div><div class="state"></div></div>';
    },
    enter() {
      const menu = this.el.querySelector('.menu'), worn = store.get('suit');
      menu.innerHTML = '';
      C.suits.forEach((s) => {
        const b = item(s.name, {
          locked: s.locked, tag: s.id === worn ? 'On' : '', small: s.locked ? 'Locked' : '',
          run: () => {
            if (s.locked) { audio.play('deny'); toast('Locked · ' + s.unlock); return; }
            if (store.get('suit') === s.id) return;
            store.set('suit', s.id);
            audio.play('equip');
            input.rumble(120, 0.5);
            stage.react();
            toast('Now wearing ' + s.name);
            focusMemo.suits = C.suits.indexOf(s);
            show('suits');
          },
        });
        b.dataset.suit = s.id;
        menu.appendChild(b);
      });
      focusMemo.suits = focusMemo.suits != null ? focusMemo.suits : C.suits.findIndex((s) => s.id === worn);
    },
    onFocus(node) {
      const s = suitById(node.dataset.suit), card = this.el.querySelector('.suit-card');
      stage.setSuit(s);
      card.querySelector('.name').textContent = s.name;
      card.querySelector('.line').textContent = s.line;
      card.querySelector('.chips').innerHTML = [s.mask, s.body, s.web, s.lens].map((c) => '<i style="background:' + c + '"></i>').join('');
      card.querySelector('.state').textContent = s.locked ? 'Locked · ' + s.unlock : s.id === store.get('suit') ? 'Wearing now' : 'Press ' + (input.device() === 'gamepad' ? 'A' : 'Enter') + ' to wear';
    },
    leave() { stage.setSuit(suitById(store.get('suit'))); focusMemo.suits = null; },
  });

  /* ---------- options ---------- */
  const ONOFF = [[true, 'On'], [false, 'Off']];
  const TABS = [
    { label: 'Audio', rows: [
      { type: 'slider', key: 'master', label: 'Master volume', desc: 'Everything at once.' },
      { type: 'slider', key: 'music', label: 'Music', desc: 'The slow score behind the menu.' },
      { type: 'slider', key: 'sfx', label: 'Effects', desc: 'Web lines, menu sounds and the rest.' },
    ] },
    { label: 'Display', rows: [
      { type: 'action', label: 'Fullscreen', value: () => (document.fullscreenElement ? 'On' : 'Off'), desc: 'Fill the whole screen.',
        run() { if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => toast('Fullscreen is not available here')); } },
      { type: 'cycle', key: 'sky', label: 'Time of day', values: [['dawn', 'First light'], ['dusk', 'Last light'], ['night', 'Midnight'], ['auto', 'Match my clock']], desc: 'Relight the whole city.' },
      { type: 'cycle', key: 'grain', label: 'Film grain', values: ONOFF, desc: 'A little print texture over the picture.' },
      { type: 'cycle', key: 'parallax', label: 'Follow the pointer', values: ONOFF, desc: 'The camera and his head follow your mouse.' },
      { type: 'cycle', key: 'fps', label: 'Frame rate counter', values: ONOFF, desc: 'A small counter in the corner.' },
    ] },
    { label: 'Game', rows: [
      { type: 'cycle', key: 'difficulty', label: 'Difficulty', values: C.difficulties.map((d) => [d.id, d.name]), desc: 'Used the next time you start a new game.' },
      { type: 'cycle', key: 'subtitles', label: 'Subtitles', values: ONOFF, desc: 'Show spoken lines as text.' },
      { type: 'cycle', key: 'vibration', label: 'Controller rumble', values: ONOFF, desc: 'Rumble on pads that support it.' },
    ] },
    { label: 'Controls', table: true },
    { label: 'Comfort', rows: [
      { type: 'cycle', key: 'motion', label: 'Motion', values: ONOFF, desc: 'Turn off to stop camera drift and most animation.' },
      { type: 'cycle', key: 'textSize', label: 'Text size', values: [[100, 'Standard'], [112, 'Large'], [124, 'Largest']], desc: 'Scale every piece of text in the menu.' },
      { type: 'cycle', key: 'contrast', label: 'High contrast', values: ONOFF, desc: 'A solid backing behind the menu.' },
      { type: 'action', label: 'Restore defaults', value: () => '', desc: 'Put every option back the way it shipped.',
        run() { dialog({ title: 'Restore defaults?', text: 'Every option goes back to its original setting. Your save and suit are kept.', yes: 'Restore', no: 'Cancel', onYes() { store.reset(); applySettings(); show('options'); toast('Options restored'); } }); } },
    ] },
  ];
  let tab = 0;

  function optionRow(r) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'row';
    b.dataset.nav = '';
    b.dataset.desc = r.desc;
    const paint = () => {
      let ctrl = '';
      if (r.type === 'slider') {
        const v = store.get(r.key);
        ctrl = '<div class="slider"><i style="width:' + v + '%"></i></div><span class="val">' + v + '</span>';
      } else if (r.type === 'cycle') {
        const cur = r.values.find((x) => x[0] === store.get(r.key)) || r.values[0];
        ctrl = '<div class="cycle"><span class="arr" data-dir="-1">‹</span><b>' + esc(cur[1]) + '</b><span class="arr" data-dir="1">›</span></div>';
      } else ctrl = '<div class="cycle"><b>' + esc(r.value()) + '</b></div>';
      b.innerHTML = '<span class="label">' + esc(r.label) + '</span><span class="ctrl">' + ctrl + '</span>';
    };
    const change = (v) => {
      store.set(r.key, v);
      applySettings();
      paint();
      if (r.key === 'vibration' && v) input.rumble(160, 0.7);
    };
    if (r.type === 'slider') {
      b._adjust = (d) => { const v = Math.max(0, Math.min(100, store.get(r.key) + d * 5)); if (v !== store.get(r.key)) { change(v); audio.play('tick'); } };
      b._setAt = (frac) => { change(Math.round((Math.max(0, Math.min(1, frac)) * 100) / 5) * 5); audio.play('tick'); };
    } else if (r.type === 'cycle') {
      b._adjust = (d) => {
        const i = Math.max(0, r.values.findIndex((x) => x[0] === store.get(r.key)));
        const next = r.values[(i + d + r.values.length) % r.values.length];
        change(next[0]);
        audio.play(next[0] === false ? 'off' : next[0] === true ? 'on' : 'tick');
      };
      b._run = () => b._adjust(1);
    } else b._run = () => { audio.play('select'); r.run(); setTimeout(paint, 250); };
    paint();
    return b;
  }

  define('options', {
    shot: 'panel',
    hints: [['nav', 'Move'], ['adjust', 'Change'], ['tabs', 'Switch tab'], ['back', 'Back']],
    build(el) { el.innerHTML = '<div class="head"><div class="kicker">Settings</div><h2 class="heading">Options</h2></div><div class="tabs" role="tablist"></div><div class="body"></div><p class="desc"></p>'; },
    enter() { this.paint(); },
    paint() {
      const el = this.el, t = TABS[tab], body = el.querySelector('.body');
      el.querySelector('.tabs').innerHTML = TABS.map((x, i) => '<button type="button" class="tab' + (i === tab ? ' on' : '') + '" data-tab="' + i + '" role="tab">' + esc(x.label) + '</button>').join('');
      el.querySelector('.desc').textContent = t.table ? 'How the game plays on keys and on a controller.' : '';
      body.innerHTML = '';
      if (t.table) {
        body.innerHTML = '<table class="keys"><tr><th>Action</th><th>Keyboard</th><th>Controller</th></tr>' +
          C.controls.map((c) => '<tr><td>' + esc(c[0]) + '</td><td><span class="kbd">' + esc(c[1]) + '</span></td><td><span class="kbd">' + esc(c[2]) + '</span></td></tr>').join('') + '</table>';
      } else {
        const rows = document.createElement('div');
        rows.className = 'rows';
        t.rows.forEach((r) => rows.appendChild(optionRow(r)));
        body.appendChild(rows);
      }
    },
    setTab(i) {
      tab = (i + TABS.length) % TABS.length;
      audio.play('tab');
      focusMemo.options = 0;
      show('options');
    },
    handle(action) {
      if (action === 'prev') { this.setTab(tab - 1); return true; }
      if (action === 'next') { this.setTab(tab + 1); return true; }
      if ((action === 'left' || action === 'right') && TABS[tab].table) { this.setTab(tab + (action === 'left' ? -1 : 1)); return true; }
      return false;
    },
    onFocus(node) { this.el.querySelector('.desc').textContent = node.dataset.desc; },
  });

  /* ---------- credits ---------- */
  define('credits', {
    shot: 'credits',
    hints: [['back', 'Back']],
    enter() {
      this.el.innerHTML = '<div class="roll">' + C.credits.map(([title, lines], i) =>
        i === 0 ? '<p class="big">' + esc(title) + '</p><p>' + lines.map(esc).join('<br>') + '</p>' : '<h3>' + esc(title) + '</h3><p>' + lines.map(esc).join('<br>') + '</p>').join('') +
        SMR.emblem.svg('mark') + '</div>';
    },
    handle(action) { if (action !== 'back') { back(); return true; } return false; },
  });

  /* ---------- starting the game ---------- */
  function startGame(save) {
    if (busy) return;
    busy = true;
    save.updated = Date.now();
    store.setSave(save);
    audio.play('start');
    if (store.get('vibration')) input.rumble(500, 0.9);
    app.classList.add('launching');
    stage.setShot('launch');
    setTimeout(() => $('fade').classList.add('on'), 700);
    setTimeout(() => {
      stack.length = 0;
      stack.push('title', 'main', 'play');
      show('play', { save });
      app.classList.remove('launching');
      $('fade').classList.remove('on');
      busy = false;
    }, 1350);
  }

  define('play', {
    hints: [],
    build(el) {
      let spiral = 'M50 50';
      for (let i = 1; i <= 140; i++) { const a = i * 0.32, r = 2 + i * 0.3; spiral += 'L' + (50 + Math.cos(a) * r).toFixed(1) + ' ' + (50 + Math.sin(a) * r).toFixed(1); }
      el.innerHTML = '<div class="play-load"><svg class="loader" viewBox="0 0 100 100"><path pathLength="1" d="' + spiral + '"/></svg><p class="play-tip"></p></div>' +
        '<div class="play-card"><div class="kicker"></div><div class="big">Chapter one</div>' +
        '<p class="note">This is where the game takes over. The menu is finished; the first chapter is the next thing to build.</p><nav class="menu"></nav></div>';
      el.querySelector('.menu').appendChild(item('Back to menu', { run: back }));
    },
    enter(p) {
      const el = this.el;
      el.classList.remove('arrived');
      el.querySelector('.play-tip').textContent = C.tips[Math.floor(Math.random() * C.tips.length)];
      el.querySelector('.kicker').textContent = diffById(p.save.difficulty).name + ' · ' + suitById(store.get('suit')).name + ' suit';
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        el.classList.add('arrived');
        setFocus(items(el)[0], true);
        this.hints = [['ok', 'Back to menu']];
        renderHints();
      }, 2100);
    },
    leave() { clearTimeout(this.timer); this.hints = []; stage.setShot('main', true); },
    handle(action) { if (!this.el.classList.contains('arrived')) return true; if (action === 'back') { back(); return true; } return false; },
  });

  /* ---------- pointer ---------- */
  function wirePointer() {
    screensEl.addEventListener('mousemove', (e) => {
      const node = e.target.closest('[data-nav]');
      if (node && !busy) setFocus(node);
    });
    screensEl.addEventListener('click', (e) => {
      lastInput = performance.now();
      if (busy) return;
      audio.unlock();
      if (app.classList.contains('hide-ui')) { app.classList.remove('hide-ui'); return; }
      const id = top();
      const tabBtn = e.target.closest('.tab');
      if (tabBtn) { screens.options.setTab(+tabBtn.dataset.tab); return; }
      const node = e.target.closest('[data-nav]');
      if (node) {
        setFocus(node, true);
        const slider = e.target.closest('.slider'), arr = e.target.closest('.arr');
        if (slider && node._setAt) { const r = slider.getBoundingClientRect(); node._setAt((e.clientX - r.left) / r.width); }
        else if (arr && node._adjust) node._adjust(+arr.dataset.dir);
        else if (node._run) node._run();
        return;
      }
      if (id === 'title') begin();
      else if (id === 'credits') back();
      else if (id === 'main' || id === 'suits') { stage.fireWeb(e.clientX, e.clientY); audio.play('web'); }
    });
    window.addEventListener('mousemove', (e) => { stage.pointerMove(e.clientX, e.clientY); lastInput = performance.now(); });
    document.addEventListener('mouseleave', () => stage.pointerLeave());
    window.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) stage.pointerMove(t.clientX, t.clientY); }, { passive: true });
  }

  /* ---------- start-up ---------- */
  SMR.startUI = function (theStage) {
    stage = theStage;
    $('logo').innerHTML = buildLogo();
    $('meta').textContent = C.version + ' · Unofficial fan project';
    applySettings();
    stage.setSuit(suitById(store.get('suit')), true);

    let news = Math.floor(Math.random() * C.headlines.length);
    const nextNews = () => { $('news').innerHTML = '<span>' + esc(C.headlines[news++ % C.headlines.length]) + '</span>'; };
    nextNews();
    setInterval(nextNews, 6500);

    input.on(handle);
    input.onDevice((d) => { app.classList.toggle('touch', d === 'touch'); renderHints(); if (top() === 'title') screens.title.enter(); });
    wirePointer();
    document.addEventListener('fullscreenchange', () => { if (top() === 'options') show('options'); });
    setInterval(() => stage.setIdle(performance.now() - lastInput > 22000 && (top() === 'title' || top() === 'main')), 1000);

    stack.push('title');
    show('title');
  };
})();
