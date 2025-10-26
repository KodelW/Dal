(() => {
  'use strict';

  const LEVELS = [
    { stage: 1, cups: 3, swaps: 4,  speed: 700 },
    { stage: 2, cups: 3, swaps: 6,  speed: 620 },
    { stage: 3, cups: 3, swaps: 10, speed: 540 },
    { stage: 4, cups: 4, swaps: 12, speed: 480 },
    { stage: 5, cups: 5, swaps: 14, speed: 420 }
  ];

  const playfield     = document.getElementById('playfield');
  const ballEl        = document.getElementById('ball');
  const stageLabel    = document.getElementById('stageLabel');
  const hud           = document.getElementById('hud');

  const menu          = document.getElementById('menu');
  const btnStart      = document.getElementById('btnStart');
  const winnerList    = document.getElementById('winnerList');

  const nameDialog    = document.getElementById('nameDialog');
  const nameInput     = document.getElementById('nameInput');
  const btnNameOk     = document.getElementById('btnNameOk');
  const btnCancel     = document.getElementById('btnCancel');

  const resultOverlay = document.getElementById('resultOverlay');
  const resultTitle   = document.getElementById('resultTitle');
  const resultDesc    = document.getElementById('resultDesc');
  const btnResult     = document.getElementById('btnResult');

  const btnRestart    = document.getElementById('btnRestart');

  const BALL_SIZE = 40;

  const state = {
    player: '',
    levelIndex: 0,
    cups: [],
    slots: [],
    slotX: [],
    cupSize: { w: 120, h: 130 },
    baseY: 0,
    ballSlot: 0,
    isAnimating: false,
    selectionLocked: true,
    ballVisible: false,
    session: 0
  };

  const Sfx = (() => {
    let ctx = null;
    function ensure() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    }
    function tone(freq = 440, dur = 0.12, type = 'sine', gain = 0.07) {
      if (!ctx) return;
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
    function noise(dur = 0.08, gain = 0.03) {
      if (!ctx) return;
      const sr = ctx.sampleRate;
      const buffer = ctx.createBuffer(1, sr * dur, sr);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      g.gain.value = gain;
      src.buffer = buffer;
      src.connect(g).connect(ctx.destination);
      src.start();
    }
    return {
      ensure,
      shuffleStep() {
        noise(0.06, 0.045);
        tone(220 + Math.random() * 140, 0.05, 'triangle', 0.04);
      },
      success() {
        tone(660, 0.12, 'sine', 0.08);
        setTimeout(() => tone(880, 0.14, 'sine', 0.08), 100);
        setTimeout(() => tone(1100, 0.16, 'sine', 0.08), 220);
      },
      fail() {
        tone(160, 0.25, 'square', 0.08);
        setTimeout(() => tone(120, 0.28, 'square', 0.07), 180);
      }
    };
  })();

  const rndInt = (n) => Math.floor(Math.random() * n);

  function show(el) { el.classList.add('show'); }
  function hide(el) { el.classList.remove('show'); }
  function setHidden(el, value = true) { el.hidden = value; }

  const Storage = {
    key: 'royal_shuffle_winners_v1',
    load() {
      try { return JSON.parse(localStorage.getItem(this.key)) || []; }
      catch { return []; }
    },
    save(list) {
      localStorage.setItem(this.key, JSON.stringify(list));
    },
    push(name) {
      const list = this.load();
      list.unshift({ name, ts: Date.now() });
      this.save(list.slice(0, 20));
    }
  };

  function formatWinnerDate(ts) {
    const d = new Date(ts);
    const date = `${d.getFullYear()}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getDate().toString().padStart(2, '0')}`;
    const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    return `${date} ${time}`;
  }

  function renderWinners() {
    const list = Storage.load();
    winnerList.innerHTML = '';
    if (!list.length) {
      const li = document.createElement('li');
      li.textContent = '아직 등록된 기록이 없습니다.';
      winnerList.appendChild(li);
      return;
    }
    list.forEach((entry) => {
      const li = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = entry.name;
      const date = document.createElement('span');
      date.className = 'winner-date';
      date.textContent = formatWinnerDate(entry.ts);
      li.append(name, document.createTextNode(' · '), date);
      winnerList.appendChild(li);
    });
  }

  function layoutFor(count) {
    const rect = playfield.getBoundingClientRect();
    const cupW = Math.min(rect.width / (count + 1), rect.height * 0.34);
    const cupH = cupW * 1.08;
    const margin = (rect.width - cupW * count) / (count + 1);
    const baseY = rect.height * 0.58;
    const slotX = Array.from({ length: count }, (_, i) => Math.round(margin + i * (cupW + margin)));
    return { cupW: Math.round(cupW), cupH: Math.round(cupH), slotX, baseY: Math.round(baseY) };
  }

  function createCups(count) {
    playfield.innerHTML = '';
    state.cups = [];
    state.slots = new Array(count);

    const L = layoutFor(count);
    state.cupSize = { w: L.cupW, h: L.cupH };
    state.slotX = L.slotX;
    state.baseY = L.baseY;

    hideBall();

    for (let i = 0; i < count; i++) {
      const btn = document.createElement('button');
      btn.className = 'cup';
      btn.type = 'button';
      btn.style.width = `${L.cupW}px`;
      btn.style.height = `${L.cupH}px`;
      btn.setAttribute('aria-label', `${i + 1}번 컵`);

      const cup = {
        el: btn,
        slot: i,
        x: L.slotX[i],
        baseY: L.baseY - L.cupH,
        liftHeight: Math.round(L.cupH * 0.55),
        lifted: false
      };

      btn.style.transitionDuration = '280ms';
      setCupTransform(cup);
      btn.addEventListener('click', onCupChoose);
      btn.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onCupChoose(event);
        }
      });

      playfield.appendChild(btn);
      state.cups.push(cup);
      state.slots[i] = cup;
    }
  }

  function setCupTransform(cup) {
    const y = cup.baseY - (cup.lifted ? cup.liftHeight : 0);
    cup.el.style.transform = `translate(${cup.x}px, ${y}px)`;
  }

  function liftCup(cup, up, duration = 240) {
    cup.el.style.transitionDuration = `${duration}ms`;
    cup.lifted = up;
    setCupTransform(cup);
  }

  function liftAll(up, duration = 260) {
    state.cups.forEach((cup) => liftCup(cup, up, duration));
  }

  function placeBall(x, y) {
    ballEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function moveBallToSlot(slot) {
    const x = state.slotX[slot] + (state.cupSize.w - BALL_SIZE) / 2;
    const y = state.baseY - BALL_SIZE;
    placeBall(x, y);
  }

  function showBallAtSlot(slot) {
    state.ballVisible = true;
    ballEl.setAttribute('aria-hidden', 'false');
    moveBallToSlot(slot);
  }

  function hideBall() {
    state.ballVisible = false;
    ballEl.setAttribute('aria-hidden', 'true');
    ballEl.style.transform = 'translate(-9999px, -9999px)';
  }

  function lockSelection(locked) {
    state.selectionLocked = locked;
    state.cups.forEach((cup) => {
      cup.el.disabled = locked;
      cup.el.tabIndex = locked ? -1 : 0;
    });
  }

  async function swapSlots(a, b, duration, session = state.session) {
    if (session !== state.session) return;
    if (a === b) {
      await wait(duration);
      return;
    }
    const cupA = state.slots[a];
    const cupB = state.slots[b];

    state.slots[a] = cupB;
    state.slots[b] = cupA;
    [cupA.slot, cupB.slot] = [b, a];

    cupA.x = state.slotX[cupA.slot];
    cupB.x = state.slotX[cupB.slot];
    cupA.el.style.transitionDuration = `${duration}ms`;
    cupB.el.style.transitionDuration = `${duration}ms`;

    setCupTransform(cupA);
    setCupTransform(cupB);

    if (state.ballSlot === a) state.ballSlot = b;
    else if (state.ballSlot === b) state.ballSlot = a;

    Sfx.shuffleStep();
    await wait(duration);
  }

  async function shufflePhase(level, session = state.session) {
    state.isAnimating = true;
    lockSelection(true);

    const { swaps, speed } = level;
    const delay = Math.max(80, Math.round(speed * 0.25));

    for (let i = 0; i < swaps; i++) {
      if (session !== state.session) break;
      let a = rndInt(state.slots.length);
      let b = rndInt(state.slots.length - 1);
      if (b >= a) b += 1;
      await swapSlots(a, b, speed, session);
      if (session !== state.session) break;
      await wait(delay);
    }

    state.isAnimating = false;
    lockSelection(false);
  }

  function onCupChoose(event) {
    if (state.selectionLocked || state.isAnimating) return;
    const el = event.currentTarget;
    const cup = state.cups.find((c) => c.el === el);
    if (!cup) return;

    lockSelection(true);
    const session = state.session;

    const chosenCorrect = cup.slot === state.ballSlot;
    showBallAtSlot(state.ballSlot);
    liftAll(true, 320);

    setTimeout(() => {
      if (session !== state.session) return;
      if (chosenCorrect) {
        Sfx.success();
        setTimeout(() => {
          if (session !== state.session) return;
          liftAll(false, 360);
          setTimeout(() => {
            if (session !== state.session) return;
            hideBall();
            nextStageOrWin();
          }, 420);
        }, 600);
      } else {
        Sfx.fail();
        setTimeout(() => {
          if (session !== state.session) return;
          liftAll(false, 360);
          setTimeout(() => {
            if (session !== state.session) return;
            hideBall();
            endWithFail();
          }, 420);
        }, 600);
      }
    }, 520);
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function startStage(index, session = state.session) {
    if (session !== state.session) return;
    const level = LEVELS[index];
    setHidden(hud, false);
    stageLabel.textContent = `Round ${level.stage}/5`;

    createCups(level.cups);
    lockSelection(true);

    state.ballSlot = rndInt(level.cups);
    showBallAtSlot(state.ballSlot);
    liftAll(true, 320);

    await wait(1100);
    if (session !== state.session) return;
    liftAll(false, 340);
    hideBall();
    await wait(360);
    if (session !== state.session) return;

    await shufflePhase(level, session);
  }

  function nextStageOrWin() {
    if (state.levelIndex >= LEVELS.length - 1) {
      Storage.push(state.player);
      showResult(true, '잭팟 달성!', `${state.player}님, 모든 라운드를 완벽히 클리어했습니다.`);
    } else {
      state.levelIndex += 1;
      const session = state.session;
      wait(900).then(() => startStage(state.levelIndex, session));
    }
  }

  function endWithFail() {
    showResult(false, '다시 도전하세요', '로비에서 전략을 가다듬고 재도전할 수 있습니다.');
  }

  function showResult(ok, title, desc) {
    lockSelection(true);
    resultTitle.textContent = title;
    resultTitle.className = ok ? 'success' : 'fail';
    resultDesc.textContent = desc;
    hide(menu);
    show(resultOverlay);
  }

  function hideAllOverlays() {
    hide(menu);
    hide(nameDialog);
    hide(resultOverlay);
  }

  function resetToMenu() {
    state.session += 1;
    state.levelIndex = 0;
    lockSelection(true);
    state.isAnimating = false;
    state.ballVisible = false;
    state.cups = [];
    state.slots = [];
    playfield.innerHTML = '';
    hideBall();
    setHidden(hud, true);
    renderWinners();
    hide(nameDialog);
    hide(resultOverlay);
    hide(menu);
    setTimeout(() => {
      show(menu);
    }, 420);
  }

  btnStart.addEventListener('click', () => {
    Sfx.ensure();
    hide(menu);
    show(nameDialog);
    nameInput.value = '';
    nameInput.focus();
  });

  btnCancel.addEventListener('click', () => {
    hide(nameDialog);
    show(menu);
  });

  function commitNameAndStart() {
    const name = nameInput.value.trim() || 'High Roller';
    state.player = name.slice(0, 12);
    state.session += 1;
    hide(nameDialog);
    hide(resultOverlay);
    setHidden(hud, false);
    state.isAnimating = false;
    state.ballVisible = false;
    state.levelIndex = 0;
    startStage(0, state.session);
  }

  btnNameOk.addEventListener('click', commitNameAndStart);
  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitNameAndStart();
    }
  });

  btnResult.addEventListener('click', () => {
    hide(resultOverlay);
    resetToMenu();
  });

  btnRestart.addEventListener('click', () => {
    hideAllOverlays();
    resetToMenu();
  });

  window.addEventListener('resize', () => {
    if (!state.cups.length) return;
    const count = state.slots.length;
    if (!count) return;

    const L = layoutFor(count);
    state.cupSize = { w: L.cupW, h: L.cupH };
    state.slotX = L.slotX;
    state.baseY = L.baseY;

    state.cups.forEach((cup) => {
      cup.baseY = L.baseY - L.cupH;
      cup.liftHeight = Math.round(L.cupH * 0.55);
      cup.x = state.slotX[cup.slot];
      cup.el.style.width = `${L.cupW}px`;
      cup.el.style.height = `${L.cupH}px`;
      setCupTransform(cup);
    });

    if (state.ballVisible) moveBallToSlot(state.ballSlot);
  });

  renderWinners();
  setHidden(hud, true);
})();
