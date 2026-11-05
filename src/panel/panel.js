// Lettoscape – settings panel
(async function () {
  // In a normal browser (preview) use a mock
  const api = window.lettoscape || mockApi();

  const SCENE_COLORS = {
    bergsee:      ['#2b3d55', '#6d8199', '#2d3b2a'],
    camping:      ['#1a1420', '#5a2f1c', '#e08a3c'],
    firewatch:    ['#3a1f1a', '#c2652e', '#1d2a1c'],
    schloss:      ['#14161f', '#3a3f55', '#1a1a1a'],
    lichtung:     ['#1d2c18', '#6f8a3c', '#d9c27a'],
    jaegerhuette: ['#1b1410', '#5b3b22', '#d99a4e'],
    muehle:       ['#1a2420', '#3f6b5a', '#a7c4a0'],
    bahnhof:      ['#101418', '#2f3d48', '#8aa0b0'],
    kapelle:      ['#18141c', '#4a3b5c', '#f1c27d'],
    leuchtturm:   ['#0e1a26', '#2e5873', '#f5d38a'],
  };

  const { settings: initial, scenes, version, platform, sceneStatus: initialStatus, power: initialPower } = await api.getSettings();
  const status = { ...(initialStatus || {}) };
  let s = initial;

  // ---- Scenes ----
  const sceneBox = document.getElementById('scenes');
  for (const sc of scenes) {
    const b = document.createElement('button');
    b.className = 'scene' + (sc.ready ? '' : ' soon');
    b.dataset.id = sc.id;
    const c = SCENE_COLORS[sc.id] || ['#222', '#444', '#666'];
    // real preview image (matching the time of day), gradient as fallback
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    const slot = h >= 7.5 && h < 16.5 ? 'day' : ((h >= 16.5 && h < 20) || (h >= 5.5 && h < 7.5)) ? 'dusk' : 'night';
    b.style.backgroundImage = `url("../wallpaper/previews/${sc.id}-${slot}-thumb.jpg"), radial-gradient(60% 50% at 70% 80%, ${c[2]}66, transparent 70%), linear-gradient(160deg, ${c[0]}, ${c[1]})`;
    b.style.backgroundPosition = 'center';
    const label = document.createElement('span');
    label.textContent = sc.name;
    b.appendChild(label);
    if (sc.ready) b.addEventListener('click', () => set({ scene: sc.id }));
    else b.disabled = true;
    sceneBox.appendChild(b);
  }

  // ---- Tabs ----
  let tab = 'scene';
  try { tab = localStorage.getItem('tab') || 'scene'; } catch {}
  function showTab(n) {
    tab = n;
    try { localStorage.setItem('tab', n); } catch {}
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === n));
    document.querySelectorAll('section[data-tab]').forEach((el) => { el.hidden = el.dataset.tab !== n; });
    document.querySelector('main').scrollTop = 0;
  }
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ---- Quick bar ----
  const ids = scenes.filter((x) => x.ready).map((x) => x.id);
  const pickScene = (rand) => {
    const rest = ids.filter((x) => x !== s.scene);
    return rand ? rest[Math.floor(Math.random() * rest.length)] : ids[(ids.indexOf(s.scene) + 1) % ids.length];
  };
  document.getElementById('qRandom').addEventListener('click', () => set({ scene: pickScene(true) }));
  document.getElementById('qNext').addEventListener('click', () => set({ scene: pickScene(false) }));
  document.getElementById('qMute').addEventListener('click', () => set({ sound: !s.sound }));
  document.getElementById('qPause').addEventListener('click', () => set({ wallPaused: !s.wallPaused }));
  document.querySelectorAll('#timeChips button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.t === 'real') set({ timeMode: 'real' });
    else set({ timeMode: 'fixed', hour: Number(b.dataset.t) });
  }));

  // ---- Segments / chips ----
  document.querySelectorAll('.seg, .chips').forEach((group) => {
    if (!group.dataset.key) return;
    const key = group.dataset.key;
    const num = group.hasAttribute('data-num');
    group.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => set({ [key]: num ? Number(btn.dataset.val) : btn.dataset.val }));
    });
  });

  // ---- Slider ----
  const fmt = {
    pct: (v) => Math.round(v * 100) + '%',
    x: (v) => v.toFixed(2).replace(/\.?0+$/, '') + '×',
    clock: (v) => {
      const h = Math.floor(v), m = Math.round((v - h) * 60);
      return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    },
  };
  document.querySelectorAll('input[type="range"]').forEach((inp) => {
    const key = inp.dataset.key;
    inp.addEventListener('input', () => {
      paintRange(inp);
      const out = document.querySelector(`output[data-for="${key}"]`);
      if (out) out.textContent = fmt[out.dataset.fmt](Number(inp.value));
      set({ [key]: Number(inp.value) }, true);
    });
  });

  // ---- Power levels ----
  const PRESETS = {
    eco:      { fps: 20, renderScale: 0.45, quality: 'low' },
    balanced: { fps: 24, renderScale: 0.6,  quality: 'high' },
    beauty:   { fps: 30, renderScale: 0.85, quality: 'high' },
  };
  const POWER_HINT = {
    eco: 'Cool and quiet. Ideal for laptops.',
    balanced: 'A good balance of looks and heat.',
    beauty: 'Full splendor, needs a strong GPU.',
    custom: 'Custom settings (see Advanced).',
  };
  document.querySelectorAll('#power button').forEach((b) => {
    b.addEventListener('click', () => set({ power: b.dataset.power, ...PRESETS[b.dataset.power] }));
  });
  // Advanced controls -> custom level
  document.querySelectorAll('.adv .seg button, .adv input').forEach((el) => {
    el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'click', () => { if (s.power !== 'custom') set({ power: 'custom' }); });
  });

  let power = initialPower || {};
  let stats = null;
  function renderLive() {
    const t = document.getElementById('liveText');
    const box = document.getElementById('live');
    box.classList.remove('warm', 'hot', 'idle');
    if (power.pausedAll || (stats && stats.paused)) {
      box.classList.add('idle');
      const why = { manuell: 'paused by you', gesperrt: 'screen locked', abwesend: 'you are away', verdeckt: 'desktop covered', vollbild: 'fullscreen app', app: 'app in foreground' }[power.reason] || 'covered';
      t.textContent = (power.reason === 'app' || power.reason === 'manuell' ? 'Still image' : 'Paused') + ' (' + why + ') · 0 % GPU';
      return;
    }
    if (!stats) { t.textContent = 'Measuring …'; return; }
    let txt = stats.fps + ' FPS · ' + stats.w + '×' + stats.h + (stats.outW ? ' → ' + stats.outW + '×' + stats.outH : '');
    if (stats.load !== null && stats.load !== undefined) {
      txt += ' · GPU ~' + stats.load + ' %';
      if (stats.load > stats.budget * 1.3) box.classList.add('hot');
      else if (stats.load > stats.budget * 0.9) box.classList.add('warm');
    }
    if (stats.battery) txt += ' · battery mode';
    t.textContent = txt;
  }
  if (api.onRenderStats) api.onRenderStats((st) => { stats = st; renderLive(); });
  if (api.onPower) api.onPower((p) => { power = p; renderLive(); render(); });

  // ---- Toggles ----
  document.querySelectorAll('.toggle input').forEach((inp) => {
    inp.addEventListener('change', () => set({ [inp.dataset.key]: inp.checked }));
  });

  function paintRange(inp) {
    const p = ((inp.value - inp.min) / (inp.max - inp.min)) * 100;
    inp.style.setProperty('--p', p + '%');
  }

  function render() {
    document.querySelectorAll('.scene').forEach((el) => el.classList.toggle('active', el.dataset.id === s.scene));
    document.querySelectorAll('.seg[data-key], .chips[data-key]').forEach((group) => {
      const v = String(s[group.dataset.key]);
      group.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.val === v));
    });
    document.querySelectorAll('input[type="range"]').forEach((inp) => {
      if (document.activeElement !== inp) inp.value = s[inp.dataset.key];
      paintRange(inp);
      const out = document.querySelector(`output[data-for="${inp.dataset.key}"]`);
      if (out) out.textContent = fmt[out.dataset.fmt](Number(inp.value));
    });
    document.querySelectorAll('.toggle input').forEach((inp) => { inp.checked = !!s[inp.dataset.key]; });
    const q = (id, on, txt) => { const b = document.getElementById(id); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); if (txt) b.textContent = txt; };
    q('qMute', !s.sound, s.sound ? '🔊 Sound on' : '🔇 Muted');
    q('qPause', !!s.wallPaused, s.wallPaused ? '▶ Resume' : '⏸ Pause');
    document.getElementById('switchOpts').classList.toggle('disabled', !s.autoSwitch);
    document.querySelectorAll('#timeChips button').forEach((b) => {
      b.classList.toggle('on', b.dataset.t === 'real' ? s.timeMode === 'real' : s.timeMode === 'fixed' && Math.abs(s.hour - Number(b.dataset.t)) < 0.01);
    });
    document.getElementById('hourRow').classList.toggle('disabled', s.timeMode !== 'fixed');
    document.querySelectorAll('#power button').forEach((b) => b.classList.toggle('on', b.dataset.power === s.power));
    document.getElementById('powerHint').textContent = (POWER_HINT[s.power] || '') + (power && power.battery ? ' Gerade im Akku-Modus.' : '');
    const pin = document.getElementById('pin');
    pin.classList.toggle('on', !!s.panelPinned);
    pin.setAttribute('aria-pressed', String(!!s.panelPinned));
    pin.title = s.panelPinned ? 'Pinned: stays open (click to unpin)' : 'Pin: keep panel open';
    const sc = scenes.find((x) => x.id === s.scene);
    // Load state per scene
    document.querySelectorAll('.scene').forEach((el) => {
      const st = status[el.dataset.id];
      el.classList.toggle('loading', !!st && (st.state === 'loading' || st.state === 'lost') && !st.background);
      el.classList.toggle('failed', !!st && st.state === 'error');
      el.title = st && st.state === 'error' ? 'Failed to load: ' + st.error : '';
    });
    const cs = status[s.scene];
    let line = (sc ? sc.name : '') + ' · ' + (s.timeMode === 'real' ? 'real time' : fmt.clock(s.hour));
    if (cs && (cs.state === 'loading' || cs.state === 'lost')) line = (sc ? sc.name : 'Scene') + ' is getting ready …';
    if (cs && cs.state === 'error') line = (sc ? sc.name : 'Scene') + ': failed to load';
    document.getElementById('status').textContent = line;
  }

  let pending = null;
  async function set(patch, throttle) {
    s = { ...s, ...patch };
    if (!throttle) { render(); s = await api.setSettings(patch); render(); return; }
    // Slider: do not save every pixel at once
    pending = { ...(pending || {}), ...patch };
    if (set._t) return;
    set._t = setTimeout(async () => {
      const p = pending; pending = null; set._t = null;
      s = await api.setSettings(p);
    }, 60);
  }

  api.onSettings((ns) => { s = ns; render(); });
  if (api.onSceneStatus) api.onSceneStatus((st) => { status[st.id] = st; render(); });

  document.getElementById('close').addEventListener('click', () => api.hidePanel());
  document.getElementById('pin').addEventListener('click', () => set({ panelPinned: !s.panelPinned }));
  document.getElementById('quit').addEventListener('click', () => api.quit());
  document.getElementById('reset').addEventListener('click', async () => { s = await api.resetSettings(); render(); });
  document.getElementById('ver').textContent = 'v' + version;
  if (platform === 'linux') {
    const t = document.querySelector('[data-key="autostart"]').previousElementSibling;
    t.textContent = 'Start at login';
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.hidePanel(); });

  showTab(tab);
  render();

  function mockApi() {
    const defaults = {
      scene: 'bergsee', timeMode: 'real', hour: 20, weather: 'clear', fog: 0.45, clouds: 0.35, brightness: 1,
      speed: 1, fps: 30, renderScale: 0.75, quality: 'high', parallax: true, sound: false, volume: 0.5,
      autostart: true, pauseOnFullscreen: true, allDisplays: true, showInTaskbar: true, cornerMenu: true, panelPinned: false, preload: true, power: 'balanced', batterySaver: true, autoPerformance: true, pauseMode: 'desktop', taskbarSync: true, autoSwitch: false, switchMinutes: 15, switchRandom: true, hotkeys: true, wallPaused: false,
    };
    let st = { ...defaults };
    const names = ['Mountain Lake', 'Campsite', 'Fire Watchtower', 'Abandoned Castle', 'Forest Clearing', "Hunter's Cabin", 'Old Mill by the Creek', 'Abandoned Station', 'Chapel at the Forest Edge', 'Lighthouse on the Coast'];
    const ids = ['bergsee', 'camping', 'firewatch', 'schloss', 'lichtung', 'jaegerhuette', 'muehle', 'bahnhof', 'kapelle', 'leuchtturm'];
    return {
      getSettings: async () => ({ settings: st, scenes: ids.map((id, i) => ({ id, name: names[i], ready: true })), version: '0.1.0', platform: 'win32' }),
      setSettings: async (p) => (st = { ...st, ...p }),
      resetSettings: async () => (st = { ...defaults }),
      onSettings: () => {},
      onSceneStatus: () => {},
      hidePanel: () => {},
      quit: () => {},
    };
  }
})();
