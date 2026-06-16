/* ═══════════════════════════════════════════════════════════════
   SCORE CEKIH — app.js — Sadewa Corp
   Pure Vanilla JavaScript · State-Driven Pattern
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   0. CONSTANTS & ELEMENT COLORS
───────────────────────────────────────────── */
const ELEMENT_COLORS = ['#39ff6a', '#5fd4ff', '#b06bff', '#ff4d4d'];
const ELEMENT_NAMES  = ['Dragon', 'Tiger', 'Eagle', 'Cobra'];
const ELEMENT_EMOJIS = ['🐉', '🐯', '🦅', '🐍'];
const ANIMAL_VIDEOS  = ['video/dragon.mp4', 'video/tiger.mp4', 'video/eagle.mp4', 'video/cobra.mp4'];

const AI_COMMENTS = [
  "Wah tipis banget selisihnya!",
  "Kayaknya ada yang mau comeback nih",
  "Hati-hati yang di bawah lagi ngintip!",
  "Situasi makin panas!",
  "Siapa yang bakal menang ya?",
  "Jangan santai dulu, masih panjang!",
  "Fokus fokus!",
  "Wah berbahaya ini!"
];

const ACHIEVEMENTS_DEF = [
  { id: 'tukang_ngocok',  icon: '🃏', name: 'Tukang Ngocok Kartu',        desc: 'Skor pernah negatif',            check: s => s.hadNegative },
  { id: 'tukang_bakar',   icon: '🔥', name: 'Tukang Bakar',               desc: 'Berhasil membakar ≥ 3 kali',     check: s => s.burns >= 3 },
  { id: 'hari_apes',      icon: '😵', name: 'Hari Apes Gak Ada Yang Tau', desc: 'Dibakar ≥ 5 kali',               check: s => s.burned >= 5 },
  { id: 'dewa_kartu',     icon: '⚡', name: 'Dewa Kartu',                 desc: 'Skor tertinggi ≥ 500',           check: s => s.highestScore >= 500 },
  { id: 'dewa_dewa',      icon: '👑', name: 'Dewa Dari Segala Dewa',      desc: 'Mendapatkan lebih dari 1 bintang',check: s => s.stars > 1 },
  { id: 'triple_burn',    icon: '💥', name: 'Triple Burn',                desc: 'Pernah membakar 3 sekaligus',    check: s => s.tripleBurn > 0 },
];

/* ─────────────────────────────────────────────
   1. CENTRALIZED STATE
───────────────────────────────────────────── */
let gameState = null;
let undoStack  = [];
let chartInstance = null;

const defaultPlayer = (name, setupIdx) => ({
  name,
  setupIdx,          // 0-3, permanent
  score: 0,
  ranking: setupIdx + 1,
  prevRanking: setupIdx + 1,
  stars: 0,
  burns: 0,
  burned: 0,
  tripleBurn: 0,
  highestScore: 0,
  hadNegative: false,
  isInRecoveryMode: false,
  recoveryStartTurn: null,
  consecutiveMinus: 0,
  consecutiveMinusPlayed: false,
  history: [],      // per-round turn deltas
});

function createInitialGameState(names, target, roundNum = 1) {
  return {
    phase: 'game',       // 'setup' | 'game' | 'newround'
    round: roundNum,
    turn: 1,
    target,
    players: names.map((n, i) => defaultPlayer(n, i)),
    burnCandidates: [],  // [{attackerIdx, victimIdx}]
    history: [],         // global turn history entries
    chartData: [],       // [{turn, scores:[]}]
    bgMusicOn: true,
    bgMusicVolume: 1.0,
  };
}

/* ─────────────────────────────────────────────
   2. LOCALSTORAGE
───────────────────────────────────────────── */
const LS_KEY       = 'scoreCekih_gameState_v7';
const LS_PERM_KEY  = 'scoreCekih_permanent_v7';
const LS_UNDO_KEY  = 'scoreCekih_undo_v7';
const LS_ARCHIVE_KEY = 'scoreCekih_archive_v7';

function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(gameState));
    localStorage.setItem(LS_UNDO_KEY, JSON.stringify(undoStack.slice(-10)));
  } catch(e) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { gameState = JSON.parse(raw); return true; }
  } catch(e) {}
  return false;
}

function loadUndoStack() {
  try {
    const raw = localStorage.getItem(LS_UNDO_KEY);
    if (raw) undoStack = JSON.parse(raw);
  } catch(e) { undoStack = []; }
}

/* Permanent stats (player-name based) */
function getPermanentStats() {
  try { return JSON.parse(localStorage.getItem(LS_PERM_KEY)) || {}; } catch(e) { return {}; }
}
function savePermanentStats(perms) {
  localStorage.setItem(LS_PERM_KEY, JSON.stringify(perms));
}
function updatePermanentStats() {
  if (!gameState) return;
  const perms = getPermanentStats();
  gameState.players.forEach(p => {
    if (!perms[p.name]) perms[p.name] = { stars:0, burns:0, burned:0, tripleBurn:0, highestScore:0, hadNegative:false };
    const ps = perms[p.name];
    ps.stars        = Math.max(ps.stars, p.stars);
    ps.burns        = Math.max(ps.burns, p.burns);
    ps.burned       = Math.max(ps.burned, p.burned);
    ps.tripleBurn   = Math.max(ps.tripleBurn, p.tripleBurn);
    ps.highestScore = Math.max(ps.highestScore, p.highestScore);
    if (p.hadNegative) ps.hadNegative = true;
  });
  savePermanentStats(perms);
}

/* Player archive */
function getArchive() {
  try { return JSON.parse(localStorage.getItem(LS_ARCHIVE_KEY)) || []; } catch(e) { return []; }
}
function updateArchive() {
  if (!gameState) return;
  const archive = getArchive();
  gameState.players.forEach(p => {
    if (!archive.find(a => a.name === p.name)) {
      archive.push({ name: p.name, firstSeen: Date.now() });
    }
  });
  localStorage.setItem(LS_ARCHIVE_KEY, JSON.stringify(archive));
}

/* ─────────────────────────────────────────────
   3. PURE CALCULATION FUNCTIONS
───────────────────────────────────────────── */

/** Sort players by score descending, returns array of {idx, score} with ranks 1-4 */
function calculateRanking(players) {
  const indexed = players.map((p, i) => ({ i, score: p.score }));
  indexed.sort((a, b) => b.score - a.score);
  return indexed.map((item, rank) => ({ idx: item.i, rank: rank + 1 }));
}

function applyRanking(players) {
  const ranked = calculateRanking(players);
  ranked.forEach(r => { players[r.idx].ranking = r.rank; });
}

/**
 * detectBurnCandidates
 * Compare ranking arrays BEFORE and AFTER.
 * Returns [{attackerIdx, victimIdx}]
 * First turn of round → return []
 */
function detectBurnCandidates(playersBefore, playersAfter, isFirstTurn) {
  if (isFirstTurn) return [];
  const candidates = [];

  playersAfter.forEach((attacker, ai) => {
    const rankBefore = playersBefore[ai].ranking;
    const rankAfter  = attacker.ranking;
    // Attacker's ranking improved (lower number = better)
    if (rankAfter >= rankBefore) return; // no improvement

    // Find players who the attacker "passed"
    playersAfter.forEach((victim, vi) => {
      if (vi === ai) return;
      const vRankBefore = playersBefore[vi].ranking;
      const vRankAfter  = victim.ranking;

      // Victim was above attacker before, now below attacker
      if (vRankBefore < rankBefore && vRankAfter > rankAfter) {
        // Validate victim
        if (victim.score <= 0) return;
        if (victim.isInRecoveryMode) return;

        // Avoid duplicates
        const exists = candidates.find(c => c.attackerIdx === ai && c.victimIdx === vi);
        if (!exists) candidates.push({ attackerIdx: ai, victimIdx: vi });
      }
    });
  });

  return candidates;
}

/**
 * updateRecoveryStatus
 * After scoring, update recovery mode durations.
 * Recovery lasts 1 full turn after the turn they were burned.
 * Called BEFORE burn detection so that newly burned players get recovery immediately.
 */
function tickRecovery(players, currentTurn) {
  players.forEach(p => {
    if (p.isInRecoveryMode && p.recoveryStartTurn !== null) {
      // Recovery started at recoveryStartTurn.
      // Protected for turn: recoveryStartTurn + 1.
      // From turn recoveryStartTurn + 2 → normal.
      if (currentTurn > p.recoveryStartTurn + 1) {
        p.isInRecoveryMode  = false;
        p.recoveryStartTurn = null;
      }
    }
  });
}

/** Former recovery players (exited this turn) cannot burn each other */
function filterExRecoveryBurns(candidates, playersAfter, currentTurn) {
  // Players that just exited recovery this turn: recoveryStartTurn + 2 === currentTurn
  const exRecovery = new Set();
  playersAfter.forEach((p, i) => {
    if (!p.isInRecoveryMode && p.recoveryStartTurn !== null && p.recoveryStartTurn + 2 === currentTurn) {
      exRecovery.add(i);
    }
  });
  if (exRecovery.size < 2) return candidates;
  return candidates.filter(c => !(exRecovery.has(c.attackerIdx) && exRecovery.has(c.victimIdx)));
}

function processBurn(players, victimIdxList, currentTurn) {
  victimIdxList.forEach(vi => {
    players[vi].score  = 0;
    players[vi].burned += 1;
    players[vi].isInRecoveryMode  = true;
    players[vi].recoveryStartTurn = currentTurn;
    players[vi].consecutiveMinus  = 0;
    players[vi].consecutiveMinusPlayed = false;
  });

  // Check triple burn per attacker
  const attackerMap = {};
  victimIdxList.forEach(vi => {
    const candidate = gameState.burnCandidates.find(c => c.victimIdx === vi);
    if (candidate) {
      const ai = candidate.attackerIdx;
      attackerMap[ai] = (attackerMap[ai] || 0) + 1;
      players[ai].burns += 1;
    }
  });
  Object.keys(attackerMap).forEach(ai => {
    if (attackerMap[ai] >= 3) players[ai].tripleBurn += 1;
  });
}

/** Determine who shuffles cards after a turn */
function getShufflePlayer(players, burnedIdxList) {
  // If first turn with Tutup Tangan / Triss — handled externally
  const arr = players.slice(); // copy reference

  // If any player negative, pick most negative
  const negatives = arr.filter(p => p.score < 0);
  if (negatives.length > 0) {
    negatives.sort((a, b) => a.score - b.score);
    return negatives[0];
  }

  // No negative: if burned players, pick highest pre-burn score among them (they are now 0)
  // We don't track pre-burn score easily at this point, just pick first burned with score=0
  if (burnedIdxList.length > 0) {
    return players[burnedIdxList[0]];
  }

  // Pick smallest score
  const sorted = arr.slice().sort((a, b) => a.score - b.score);
  return sorted[0];
}

/* ─────────────────────────────────────────────
   4. NUMBER CONVERSION
───────────────────────────────────────────── */
function numberToBahasaIndonesia(n) {
  if (n === 0) return 'nol';
  const abs = Math.abs(n);
  const prefix = n < 0 ? 'minus ' : '';
  return prefix + toIndo(abs);
}

function toIndo(n) {
  const satuan = ['','satu','dua','tiga','empat','lima','enam','tujuh','delapan','sembilan',
                  'sepuluh','sebelas','dua belas','tiga belas','empat belas','lima belas',
                  'enam belas','tujuh belas','delapan belas','sembilan belas'];
  if (n < 20) return satuan[n];
  if (n < 100) {
    const t = Math.floor(n/10);
    const s = n % 10;
    const tens = ['','','dua puluh','tiga puluh','empat puluh','lima puluh',
                  'enam puluh','tujuh puluh','delapan puluh','sembilan puluh'];
    return tens[t] + (s ? ' ' + satuan[s] : '');
  }
  if (n < 200) return 'seratus' + (n>100 ? ' ' + toIndo(n-100) : '');
  if (n < 1000) {
    const h = Math.floor(n/100);
    return toIndo(h) + ' ratus' + (n%100 ? ' ' + toIndo(n%100) : '');
  }
  if (n < 2000) return 'seribu' + (n>1000 ? ' ' + toIndo(n-1000) : '');
  if (n < 1000000) {
    const th = Math.floor(n/1000);
    return toIndo(th) + ' ribu' + (n%1000 ? ' ' + toIndo(n%1000) : '');
  }
  return String(n);
}

/* ─────────────────────────────────────────────
   5. TTS / AUDIO
───────────────────────────────────────────── */
let bgMusic = null;
let bgMusicVolume = 1.0;
let activeMulaiAudio = null;
let activeKokMinusAudio = null;

function initBgMusic() {
  if (bgMusic) return;
  bgMusic = new Audio('audio/casino_bg.mp3');
  bgMusic.loop    = true;
  bgMusic.volume  = bgMusicVolume;
  bgMusic.preload = 'auto';
}

function tryPlayBgMusic() {
  if (!bgMusic) initBgMusic();
  if (gameState && gameState.bgMusicOn) {
    bgMusic.play().catch(() => {});
  }
}

function toggleBgMusic() {
  if (!bgMusic) initBgMusic();
  gameState.bgMusicOn = !gameState.bgMusicOn;
  if (gameState.bgMusicOn) {
    bgMusic.play().catch(() => {});
    document.getElementById('btn-bg-music').classList.remove('muted');
  } else {
    bgMusic.pause();
    document.getElementById('btn-bg-music').classList.add('muted');
  }
  saveState();
}

function getMaleVoice() {
  return new Promise(resolve => {
    const doFind = () => {
      const voices = speechSynthesis.getVoices();
      const male = voices.find(v => v.lang === 'id-ID' && /male|pria|laki/i.test(v.name))
        || voices.find(v => v.lang === 'id-ID')
        || voices.find(v => v.lang.startsWith('id'))
        || voices[0];
      resolve(male);
    };
    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) { doFind(); return; }
    speechSynthesis.onvoiceschanged = () => { doFind(); };
    setTimeout(doFind, 500);
  });
}

async function speakWithDuck(text) {
  return new Promise(async resolve => {
    try {
      speechSynthesis.cancel();
      if (bgMusic) bgMusic.volume = 0.15;
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang   = 'id-ID';
      utter.rate   = 1;
      utter.pitch  = 0.8;
      utter.volume = 1;
      utter.voice  = await getMaleVoice();
      utter.onend  = () => { if (bgMusic) bgMusic.volume = bgMusicVolume; resolve(); };
      utter.onerror= () => { if (bgMusic) bgMusic.volume = bgMusicVolume; resolve(); };
      speechSynthesis.speak(utter);
      // Fallback timeout
      const timeout = Math.max(3000, text.length * 100);
      setTimeout(() => { if (bgMusic) bgMusic.volume = bgMusicVolume; resolve(); }, timeout);
    } catch(e) {
      if (bgMusic) bgMusic.volume = bgMusicVolume;
      resolve();
    }
  });
}

function playWavWithDuck(src) {
  return new Promise(resolve => {
    try {
      if (bgMusic) bgMusic.volume = 0.15;
      const audio = new Audio(src);
      if (src.includes('mulai_dari_0')) activeMulaiAudio = audio;
      if (src.includes('kok_minus'))   activeKokMinusAudio = audio;
      audio.onended = () => { if (bgMusic) bgMusic.volume = bgMusicVolume; resolve(); };
      audio.onerror = () => { if (bgMusic) bgMusic.volume = bgMusicVolume; resolve(); };
      audio.play().catch(() => { if (bgMusic) bgMusic.volume = bgMusicVolume; resolve(); });
    } catch(e) {
      if (bgMusic) bgMusic.volume = bgMusicVolume;
      resolve();
    }
  });
}

function playClickSound() {
  try {
    const a = new Audio('audio/klik.wav');
    a.volume = 0.6;
    a.play().catch(() => {
      // fallback: AudioContext beep
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 800;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.start(); osc.stop(ctx.currentTime + 0.08);
      } catch(e2) {}
    });
  } catch(e) {}
}

function stopAllAudio() {
  speechSynthesis.cancel();
  if (activeMulaiAudio)  { activeMulaiAudio.pause();  activeMulaiAudio.currentTime  = 0; }
  if (activeKokMinusAudio){ activeKokMinusAudio.pause();activeKokMinusAudio.currentTime=0; }
  if (bgMusic) bgMusic.volume = bgMusicVolume;
}

/* ─────────────────────────────────────────────
   6. DANGER LEVEL
───────────────────────────────────────────── */
function getDangerLevel(score, target) {
  const pct = score / target;
  if (pct >= 0.9) return { label: '🔴 Kritis',    cls: 'badge-danger' };
  if (pct >= 0.7) return { label: '🟠 Bahaya',    cls: 'badge-danger-warning' };
  if (pct >= 0.5) return { label: '🟡 Waspada',   cls: 'badge-danger-caution' };
  return { label: '🟢 Aman', cls: 'badge-safe' };
}

/* Danger applies to other players who are near target and could be overtaken by someone */
function getDangerForPlayer(player, allPlayers, target) {
  // Is anyone chasing this player?
  const below = allPlayers.filter(p => p.name !== player.name && p.ranking > player.ranking);
  const isChased = below.length > 0;

  if (!isChased) return { label: '🟢 Aman', cls: 'badge-safe' };

  const diff = target - player.score;
  if (diff <= target * 0.1) return { label: '🔴 Kritis',  cls: 'badge-danger' };
  if (diff <= target * 0.3) return { label: '🟠 Bahaya',  cls: 'badge-danger-warning' };
  if (diff <= target * 0.5) return { label: '🟡 Waspada', cls: 'badge-danger-caution' };
  return { label: '🟢 Aman', cls: 'badge-safe' };
}

/* ─────────────────────────────────────────────
   7. SNAPSHOT (UNDO)
───────────────────────────────────────────── */
function pushSnapshot() {
  const snap = JSON.parse(JSON.stringify(gameState));
  undoStack.push(snap);
  if (undoStack.length > 15) undoStack.shift();
  saveState();
}

function popSnapshot() {
  if (undoStack.length === 0) return false;
  stopAllAudio();
  // Also stop reward video if playing
  stopRewardVideo();
  gameState = undoStack.pop();
  saveState();
  render();
  return true;
}

/* ─────────────────────────────────────────────
   8. RENDER
───────────────────────────────────────────── */
/* Make playClickSound globally accessible for inline HTML oninput */
window.playClickSound = playClickSound;

function render() {
  if (!gameState) {
    showPage('page-setup');
    return;
  }

  if (gameState.phase === 'setup') {
    showPage('page-setup');
    return;
  }
  if (gameState.phase === 'newround') {
    showPage('page-newround');
    renderNewRound();
    return;
  }

  showPage('page-game');
  renderHeader();
  renderCards();
  renderBurnSection();
  renderTabs();
  renderChart();
  renderAiComment();
}

function showPage(id) {
  const app = document.getElementById('app');
  if (app) app.classList.remove('hidden');
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
}

function renderHeader() {
  const rt = document.getElementById('header-round-turn');
  if (rt) rt.textContent = `Ronde ${gameState.round} · Giliran ${gameState.turn}`;
  const btn = document.getElementById('btn-bg-music');
  if (btn) {
    btn.classList.toggle('muted', !gameState.bgMusicOn);
  }
}

/* ─── CARDS ─── */
function renderCards() {
  const grid = document.getElementById('cards-grid');
  if (!grid) return;

  // Check if frames match current players (by setup index)
  let needRebuild = (grid.children.length !== gameState.players.length);
  if (!needRebuild) {
    for (let i = 0; i < gameState.players.length; i++) {
      const frame = grid.children[i];
      if (!frame || frame.dataset.setup !== String(gameState.players[i].setupIdx)) {
        needRebuild = true; break;
      }
    }
  }

  if (needRebuild) {
    grid.innerHTML = '';
    gameState.players.forEach((p, i) => {
      grid.appendChild(buildPlayerFrame(p, i));
    });
  } else {
    gameState.players.forEach((p, i) => {
      updatePlayerFrame(grid.children[i], p, i);
    });
  }
}

function buildPlayerFrame(p, i) {
  const si = p.setupIdx;
  const frame = document.createElement('div');
  frame.className = 'player-frame';
  frame.id = `frame-${i}`;
  frame.dataset.setup = si;
  frame.style.cssText = `
    --frame-bg: url('images/border_${si+1}.png');
    background-image: url('images/border_${si+1}.png');
    background-size: cover;
    background-position: center;
    background-color: #000;
  `;

  // Idle glow
  const glow = document.createElement('div');
  glow.className = 'idle-glow';

  // Particles (5 per card)
  const particleContainer = document.createElement('div');
  particleContainer.className = 'particle-container';
  particleContainer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:1;overflow:hidden;';
  for (let k = 0; k < 5; k++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    const startX = 15 + Math.random() * 70;
    const startY = 20 + Math.random() * 60;
    const dx = (Math.random() - 0.5) * 60;
    const dy = -20 - Math.random() * 40;
    const dur = 2 + Math.random() * 2.5;
    const delay = Math.random() * 2;
    particle.style.cssText = `
      left: ${startX}%;
      top: ${startY}%;
      --dx: ${dx}px;
      --dy: ${dy}px;
      animation: particleDrift0 ${dur}s ${delay}s ease-in-out infinite;
    `;
    particleContainer.appendChild(particle);
  }

  // Inner card
  const card = document.createElement('div');
  card.className = 'player-card';
  card.id = `card-${i}`;
  card.style.cssText = `
    --animal-bg: url('images/animal_${si+1}.png');
    background-image: url('images/animal_${si+1}.png');
    background-size: cover;
    background-position: center;
    background-color: #000;
  `;

  card.innerHTML = buildCardContentHTML(p, i);

  frame.appendChild(glow);
  frame.appendChild(particleContainer);
  frame.appendChild(card);
  return frame;
}

function buildCardContentHTML(p, i) {
  const pct = Math.min(100, Math.max(0, (p.score / (gameState.target || 1000)) * 100));
  const pctStr = p.score <= 0 ? '0%' : pct.toFixed(1) + '%';
  const scoreStr = p.score > 0 ? '+' + p.score : String(p.score);
  const isNeg = p.score < 0;
  const danger = getDangerForPlayer(p, gameState.players, gameState.target);

  let badgesHTML = '';
  if (p.isInRecoveryMode) badgesHTML += `<span class="badge badge-recovery">🔄 Recovery</span>`;
  badgesHTML += `<span class="badge ${danger.cls}">${danger.label}</span>`;
  if (isNeg) badgesHTML += `<span class="badge badge-burned">👎</span>`;

  const starsStr = p.stars > 0 ? '⭐'.repeat(p.stars) : '';

  return `
    <div class="card-content" id="card-content-${i}">
      <div class="card-row-top">
        <div class="rank-badge" id="rank-badge-${i}">#${p.ranking}</div>
        <div class="stars-display">${starsStr}</div>
      </div>
      <div class="card-name" title="${p.name}">${p.name}</div>
      <div class="card-score ${isNeg ? 'negative' : ''}" id="score-display-${i}">${scoreStr}</div>
      <div class="card-badges">${badgesHTML}</div>
      <div class="card-progress-wrap">
        <div class="card-progress-bar" style="width:${pctStr}"></div>
      </div>
      <div class="card-input-row">
        <input type="number" class="card-input" id="input-score-${i}"
          placeholder="Skor" maxlength="6"
          oninput="playClickSound()" />
      </div>
    </div>
  `;
}

function updatePlayerFrame(frameEl, p, i) {
  const card = frameEl.querySelector('.player-card');
  if (!card) return;
  card.innerHTML = buildCardContentHTML(p, i);
}

/* ─── BURN SECTION ─── */
function renderBurnSection() {
  const section = document.getElementById('burn-section');
  const list    = document.getElementById('burn-candidates-list');
  if (!section || !list) return;

  const cands = gameState.burnCandidates || [];
  if (cands.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  list.innerHTML = cands.map(c => {
    const attacker = gameState.players[c.attackerIdx];
    const victim   = gameState.players[c.victimIdx];
    return `<div class="burn-candidate-item">🔥 ${attacker.name} membakar ${victim.name}</div>`;
  }).join('');
}

/* ─── TABS ─── */
function renderTabs() {
  renderRankingTab();
  renderHistoryTab();
  renderAchievementTab();
  renderStatisticsTab();
  renderArchiveTab();
}

function renderRankingTab() {
  const el = document.getElementById('ranking-list');
  if (!el) return;
  const sorted = gameState.players.slice().sort((a,b) => b.score - a.score);
  el.innerHTML = sorted.map((p, rank) => `
    <div class="ranking-item">
      <div class="rank-num">#${rank+1}</div>
      <div class="rank-name">${ELEMENT_EMOJIS[p.setupIdx]} ${p.name}</div>
      <div class="rank-score">${p.score}</div>
      <div class="rank-stars">${'⭐'.repeat(p.stars)}</div>
    </div>
  `).join('');
}

function renderHistoryTab() {
  const el = document.getElementById('history-list');
  if (!el) return;
  const hist = [...(gameState.history || [])].reverse();
  el.innerHTML = hist.map(h => {
    let cls = '';
    let scoresHTML = '';
    if (h.type === 'turn') {
      cls = '';
      scoresHTML = h.scores.map(s => {
        const sign = s.delta > 0 ? '+' : '';
        const cls2 = s.delta > 0 ? 'score-plus' : (s.delta < 0 ? 'score-minus' : '');
        return `<span class="history-score-item ${cls2}">${s.name}: ${sign}${s.delta} (${s.total})</span>`;
      }).join('');
    } else if (h.type === 'burn') {
      cls = 'history-burn';
      scoresHTML = `🔥 ${h.text}`;
    } else if (h.type === 'star') {
      cls = 'history-star';
      scoresHTML = `⭐ ${h.text}`;
    }
    return `
      <div class="history-item ${cls}">
        <div class="history-turn">R${h.round} G${h.turn} ${h.timestamp}</div>
        <div class="history-scores">${scoresHTML}</div>
      </div>
    `;
  }).join('');
}

function renderAchievementTab() {
  const el = document.getElementById('achievement-list');
  if (!el) return;
  const perms = getPermanentStats();

  el.innerHTML = ACHIEVEMENTS_DEF.map(ach => {
    // Find any player who has it
    let unlockedBy = [];
    Object.keys(perms).forEach(name => {
      if (ach.check(perms[name])) unlockedBy.push(name);
    });
    // Also check current players
    (gameState.players || []).forEach(p => {
      if (ach.check(p) && !unlockedBy.includes(p.name)) unlockedBy.push(p.name);
    });
    const unlocked = unlockedBy.length > 0;
    return `
      <div class="achievement-item ${unlocked ? 'unlocked' : ''}">
        <div class="achievement-icon">${ach.icon}</div>
        <div class="achievement-info">
          <div class="achievement-name">${ach.name}</div>
          <div class="achievement-desc">${ach.desc}</div>
          ${unlocked ? `<div class="achievement-holder">🏅 ${unlockedBy.join(', ')}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderStatisticsTab() {
  const el = document.getElementById('statistics-list');
  if (!el) return;
  const perms = getPermanentStats();
  const allNames = new Set([
    ...Object.keys(perms),
    ...(gameState.players || []).map(p => p.name)
  ]);

  let html = '';
  allNames.forEach(name => {
    const ps = perms[name] || {};
    const cp = (gameState.players || []).find(p => p.name === name) || {};
    const stars        = Math.max(ps.stars        || 0, cp.stars        || 0);
    const burns        = Math.max(ps.burns        || 0, cp.burns        || 0);
    const burned       = Math.max(ps.burned       || 0, cp.burned       || 0);
    const tripleBurn   = Math.max(ps.tripleBurn   || 0, cp.tripleBurn   || 0);
    const highestScore = Math.max(ps.highestScore || 0, cp.highestScore || 0);
    html += `
      <div class="stat-player-block">
        <div class="stat-player-name">${name}</div>
        <div class="stat-row">
          <div class="stat-item">⭐ <span class="stat-val">${stars}</span></div>
          <div class="stat-item">🔥 Bakar: <span class="stat-val">${burns}</span></div>
          <div class="stat-item">💀 Dibakar: <span class="stat-val">${burned}</span></div>
          <div class="stat-item">💥 Triple: <span class="stat-val">${tripleBurn}</span></div>
          <div class="stat-item">🏆 Max: <span class="stat-val">${highestScore}</span></div>
        </div>
      </div>
    `;
  });
  el.innerHTML = html || '<div class="stat-player-block">Belum ada data</div>';
}

function renderArchiveTab() {
  const el = document.getElementById('archive-list');
  if (!el) return;
  const archive = getArchive();
  const perms   = getPermanentStats();

  if (archive.length === 0) {
    el.innerHTML = '<div class="archive-item"><div class="archive-name">Belum ada pemain</div></div>';
    return;
  }
  el.innerHTML = archive.map(a => {
    const ps = perms[a.name] || {};
    const date = new Date(a.firstSeen).toLocaleDateString('id-ID');
    return `
      <div class="archive-item">
        <div class="archive-name">${a.name}</div>
        <div class="archive-stats">
          <span class="archive-stat">⭐ ${ps.stars || 0}</span>
          <span class="archive-stat">🔥 ${ps.burns || 0}</span>
          <span class="archive-stat">💀 ${ps.burned || 0}</span>
          <span class="archive-stat">🏆 ${ps.highestScore || 0}</span>
          <span class="archive-stat">📅 ${date}</span>
        </div>
      </div>
    `;
  }).join('');
}

/* ─── CHART ─── */
function renderChart() {
  const canvas = document.getElementById('score-chart');
  if (!canvas) return;
  const data = gameState.chartData || [];
  if (data.length === 0) { if (chartInstance) { chartInstance.destroy(); chartInstance = null; } return; }

  const labels = data.map(d => `G${d.turn}`);
  const colors = ELEMENT_COLORS;

  const datasets = gameState.players.map((p, i) => ({
    label: p.name,
    data: data.map(d => d.scores[i] !== undefined ? d.scores[i] : 0),
    borderColor: colors[p.setupIdx],
    backgroundColor: colors[p.setupIdx] + '22',
    borderWidth: 2,
    pointRadius: 3,
    tension: 0.3,
    fill: false,
  }));

  if (!window.Chart) return;

  if (chartInstance) {
    chartInstance.data.labels   = labels;
    chartInstance.data.datasets = datasets;
    chartInstance.update();
  } else {
    chartInstance = new window.Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { labels: { color: '#d4af37', font: { size: 10 } } }
        },
        scales: {
          x: { ticks: { color: '#b8a96a', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#b8a96a', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
      }
    });
  }
}

/* ─── AI COMMENT ─── */
function renderAiComment() {
  const el = document.getElementById('ai-comment');
  if (!el) return;
  if (gameState._aiComment) {
    el.textContent = '🤖 ' + gameState._aiComment;
  }
}

/* ─── NEW ROUND RENDER ─── */
function renderNewRound() {
  // Pre-fill previous players
  ['p1','p2','p3','p4'].forEach((id, i) => {
    const inp = document.getElementById(`nr-${id}`);
    if (inp && gameState.players[i]) inp.value = gameState.players[i].name;
  });
  // Stars summary
  const sumEl = document.getElementById('nr-stars-summary');
  if (sumEl) {
    const rows = gameState.players.map(p =>
      `<div class="stars-summary-row">${ELEMENT_EMOJIS[p.setupIdx]} ${p.name}: ${'⭐'.repeat(p.stars)} (${p.stars} bintang)</div>`
    ).join('');
    sumEl.innerHTML = `<div class="stars-summary-title">Rekap Bintang</div>${rows}`;
  }
  // Subtitle
  const sub = document.getElementById('newround-subtitle');
  if (sub) sub.textContent = `Ronde ${gameState.round - 1} selesai · Mulai Ronde ${gameState.round}`;
}

/* ─────────────────────────────────────────────
   9. SAVE TURN
───────────────────────────────────────────── */
async function handleSaveTurn() {
  playClickSound();
  if (!gameState) return;

  // Read inputs
  const inputs = gameState.players.map((_, i) => {
    const inp = document.getElementById(`input-score-${i}`);
    return inp ? (parseFloat(inp.value) || 0) : 0;
  });

  // Push snapshot for undo
  pushSnapshot();

  const isFirstTurn = (gameState.turn === 1);

  // Save previous ranking & state
  const playersBefore = JSON.parse(JSON.stringify(gameState.players));

  // Tick recovery BEFORE applying new scores
  tickRecovery(gameState.players, gameState.turn);

  // Apply scores (cumulative), enforce max +1000 per turn
  const scoreDeltas = inputs.map((v, i) => {
    let delta = v;
    if (delta > 1000) delta = 1000;
    return delta;
  });

  // Apply
  const histScores = [];
  scoreDeltas.forEach((delta, i) => {
    const p = gameState.players[i];
    const prevScore = p.score;
    p.score += delta;
    histScores.push({ name: p.name, delta, total: p.score });

    // Highest score
    if (p.score > p.highestScore) p.highestScore = p.score;

    // Negative tracking
    if (p.score < 0) {
      p.hadNegative = true;
      p.consecutiveMinus++;
    } else {
      p.consecutiveMinus = 0;
      p.consecutiveMinusPlayed = false;
    }
  });

  // Update ranking
  applyRanking(gameState.players);

  // Chart data
  gameState.chartData.push({
    turn: gameState.turn,
    scores: gameState.players.map(p => p.score)
  });

  // History entry
  const ts = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  gameState.history.push({
    type: 'turn', round: gameState.round, turn: gameState.turn,
    timestamp: ts, scores: histScores
  });

  // Detect burn candidates
  const newCandidates = detectBurnCandidates(playersBefore, gameState.players, isFirstTurn);
  const filteredCands = filterExRecoveryBurns(newCandidates, gameState.players, gameState.turn);
  gameState.burnCandidates = filteredCands;

  // Update stats
  updatePermanentStats();
  updateArchive();

  // Check win condition
  const winner = gameState.players.find(p => p.score >= gameState.target);

  // AI comment
  gameState._aiComment = AI_COMMENTS[Math.floor(Math.random() * AI_COMMENTS.length)];

  // Card flip animation
  gameState.players.forEach((_, i) => {
    const card = document.getElementById(`frame-${i}`);
    if (card) { card.classList.remove('card-flip'); void card.offsetWidth; card.classList.add('card-flip'); }
  });

  // Rank badge bounce
  gameState.players.forEach((p, i) => {
    if (p.ranking !== playersBefore[i].ranking) {
      setTimeout(() => {
        const badge = document.getElementById(`rank-badge-${i}`);
        if (badge) { badge.classList.remove('rank-bounce'); void badge.offsetWidth; badge.classList.add('rank-bounce'); }
      }, 200);
    }
  });

  // Save & render
  saveState();
  render();

  // Clear inputs
  gameState.players.forEach((_, i) => {
    const inp = document.getElementById(`input-score-${i}`);
    if (inp) inp.value = '';
  });

  if (winner) {
    // Handle win
    await handleWin(winner);
    return;
  }

  // Run audio sequence
  if (filteredCands.length === 0) {
    // No burn — run audio directly
    await runNoburnaudioSequence();
  }
  // If burn candidates exist, wait for user to confirm burn
}

/* ─────────────────────────────────────────────
   10. BURN SYSTEM
───────────────────────────────────────────── */
function openBurnModal() {
  playClickSound();
  const modal = document.getElementById('burn-modal');
  const list  = document.getElementById('burn-modal-list');
  if (!modal || !list) return;

  const cands = gameState.burnCandidates || [];
  list.innerHTML = cands.map((c, idx) => {
    const attacker = gameState.players[c.attackerIdx];
    const victim   = gameState.players[c.victimIdx];
    return `
      <label class="burn-check-item">
        <input type="checkbox" class="burn-checkbox" data-idx="${idx}" checked />
        <div>
          <div class="burn-check-label">🔥 ${attacker.name} → ${victim.name}</div>
          <div class="burn-check-attacker">${ELEMENT_EMOJIS[attacker.setupIdx]} ${ELEMENT_NAMES[attacker.setupIdx]} vs ${victim.name}</div>
        </div>
      </label>
    `;
  }).join('');

  modal.classList.remove('hidden');
}

async function handleConfirmBurn() {
  playClickSound();
  const modal = document.getElementById('burn-modal');
  if (modal) modal.classList.add('hidden');

  const checkboxes = document.querySelectorAll('.burn-checkbox:checked');
  const selectedIdxs = Array.from(checkboxes).map(cb => parseInt(cb.dataset.idx));

  if (selectedIdxs.length === 0) {
    gameState.burnCandidates = [];
    saveState();
    render();
    await runNoburnaudioSequence();
    return;
  }

  const selectedCands = selectedIdxs.map(i => gameState.burnCandidates[i]);
  const victimIdxList = [...new Set(selectedCands.map(c => c.victimIdx))];

  // Push snapshot before burn
  pushSnapshot();

  // Process burn
  processBurn(gameState.players, victimIdxList, gameState.turn);

  // Update chart with new scores (update last entry)
  if (gameState.chartData.length > 0) {
    const last = gameState.chartData[gameState.chartData.length - 1];
    gameState.players.forEach((p, i) => { last.scores[i] = p.score; });
  }

  // Re-apply ranking after burn
  applyRanking(gameState.players);

  // History entries for burns
  selectedCands.forEach(c => {
    const attacker = gameState.players[c.attackerIdx];
    const victim   = gameState.players[c.victimIdx];
    const ts = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    gameState.history.push({ type: 'burn', round: gameState.round, turn: gameState.turn,
      timestamp: ts, text: `${attacker.name} membakar ${victim.name}` });
  });

  // Triple burn
  const attackerBurnCount = {};
  selectedCands.forEach(c => {
    attackerBurnCount[c.attackerIdx] = (attackerBurnCount[c.attackerIdx] || 0) + 1;
  });
  const hasTriple = Object.values(attackerBurnCount).some(v => v >= 3);

  // Clear burn candidates
  gameState.burnCandidates = [];

  updatePermanentStats();
  saveState();
  render();

  // AUDIO + ANIMATION SEQUENCE
  // Step: for each confirmed burn pair, TTS + attack animation
  for (const c of selectedCands) {
    const attacker = gameState.players[c.attackerIdx];
    const victim   = gameState.players[c.victimIdx];

    // Play TTS
    await speakWithDuck(`${attacker.name} membakar ${victim.name}`);

    // Attack animation
    await playAttackAnimation(c.attackerIdx, c.victimIdx, hasTriple && selectedCands.length >= 3);
  }

  // Mulai dari 0 for victims who were burned multiple times (repeatedly)
  for (const vi of victimIdxList) {
    const victim = gameState.players[vi];
    if (victim.burned >= 2) {
      await playWavWithDuck('audio/mulai_dari_0_ya_bapak.wav');
    }
  }

  // Shuffle card + total score audio
  await runPostBurnAudioSequence(victimIdxList);

  // Next turn
  advanceTurn();
}

function handleSkipBurn() {
  playClickSound();
  gameState.burnCandidates = [];
  saveState();
  render();
  runNoburnaudioSequence();
}

async function runNoburnaudioSequence() {
  // Shuffle card audio
  const shufflePlayer = getShufflePlayer(gameState.players, []);
  await speakWithDuck(`${shufflePlayer.name} tolong kocok kartunya ya`);

  // Total score audio
  for (const p of gameState.players) {
    await speakWithDuck(`${p.name} mendapatkan ${numberToBahasaIndonesia(p.score)} poin`);
  }

  // Check consecutive minus
  await checkConsecutiveMinus();

  // AI comment
  const comment = AI_COMMENTS[Math.floor(Math.random() * AI_COMMENTS.length)];
  await speakWithDuck(comment);

  advanceTurn();
}

async function runPostBurnAudioSequence(burnedIdxList) {
  // Shuffle card
  const shufflePlayer = getShufflePlayer(gameState.players, burnedIdxList);
  await speakWithDuck(`${shufflePlayer.name} tolong kocok kartunya ya`);

  // Total score
  for (const p of gameState.players) {
    await speakWithDuck(`${p.name} mendapatkan ${numberToBahasaIndonesia(p.score)} poin`);
  }

  // Check consecutive minus
  await checkConsecutiveMinus();

  // AI comment
  const comment = AI_COMMENTS[Math.floor(Math.random() * AI_COMMENTS.length)];
  await speakWithDuck(comment);
}

async function checkConsecutiveMinus() {
  for (const p of gameState.players) {
    if (p.consecutiveMinus >= 3 && !p.consecutiveMinusPlayed) {
      p.consecutiveMinusPlayed = true;
      await playWavWithDuck('audio/kok_minus_terus_sih_gamau_menang.wav');
      break; // Play once per turn
    }
  }
}

function advanceTurn() {
  gameState.turn++;
  gameState._aiComment = '';
  saveState();
  render();
}

/* ─────────────────────────────────────────────
   11. ATTACK ANIMATION
───────────────────────────────────────────── */
async function playAttackAnimation(attackerIdx, victimIdx, isTriple) {
  return new Promise(resolve => {
    const attackerFrame = document.getElementById(`frame-${attackerIdx}`);
    const victimFrame   = document.getElementById(`frame-${victimIdx}`);
    const victimCard    = document.getElementById(`card-${victimIdx}`);
    const layer         = document.getElementById('attack-layer');

    if (!attackerFrame || !victimFrame || !layer) { resolve(); return; }

    const color = ELEMENT_COLORS[gameState.players[attackerIdx].setupIdx];

    // 1. Charging effect on attacker
    attackerFrame.classList.add('charging');
    setTimeout(() => attackerFrame.classList.remove('charging'), 400);

    // 2. Energy projectile
    const aRect = attackerFrame.getBoundingClientRect();
    const vRect = victimFrame.getBoundingClientRect();

    const startX = aRect.left + aRect.width / 2;
    const startY = aRect.top  + aRect.height / 2;
    const endX   = vRect.left + vRect.width / 2;
    const endY   = vRect.top  + vRect.height / 2;

    const proj = document.createElement('div');
    proj.className = 'energy-projectile';
    proj.style.cssText = `
      left: ${startX - 7}px;
      top: ${startY - 7}px;
      background: ${color};
      color: ${color};
      box-shadow: 0 0 12px 4px ${color};
    `;
    layer.appendChild(proj);

    // Animate projectile
    const duration = 600;
    let start = null;
    function animProj(ts) {
      if (!start) start = ts;
      const progress = Math.min(1, (ts - start) / duration);
      const curX = startX + (endX - startX) * progress - 7;
      const curY = startY + (endY - startY) * progress - 7;
      proj.style.left = curX + 'px';
      proj.style.top  = curY + 'px';
      if (progress < 1) requestAnimationFrame(animProj);
      else {
        layer.removeChild(proj);
        // 3. Impact flash on victim card
        if (victimCard) {
          const flash = document.createElement('div');
          flash.className = 'impact-flash';
          flash.style.background = color;
          victimCard.appendChild(flash);
          setTimeout(() => { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 400);
        }

        // 4. Victim card shake
        if (victimFrame) {
          victimFrame.classList.add('card-shake');
          setTimeout(() => victimFrame.classList.remove('card-shake'), 500);
        }

        // 5. CRITICAL DAMAGE text
        const dmgText = document.createElement('div');
        dmgText.className = 'critical-damage-text';
        dmgText.textContent = 'CRITICAL DAMAGE';
        dmgText.style.cssText = `
          left: ${vRect.left + 10}px;
          top: ${vRect.top + vRect.height / 4}px;
          color: ${color};
        `;
        document.body.appendChild(dmgText);
        setTimeout(() => { if (dmgText.parentNode) dmgText.parentNode.removeChild(dmgText); }, 1400);

        // 6. Screen shake if triple
        if (isTriple) {
          const app = document.getElementById('app');
          if (app) { app.classList.add('screen-shake'); setTimeout(() => app.classList.remove('screen-shake'), 450); }
        }

        setTimeout(resolve, 700);
      }
    }
    requestAnimationFrame(animProj);
  });
}

/* ─────────────────────────────────────────────
   12. WIN HANDLER
───────────────────────────────────────────── */
async function handleWin(winner) {
  winner.stars += 1;

  // History
  const ts = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  gameState.history.push({ type: 'star', round: gameState.round, turn: gameState.turn,
    timestamp: ts, text: `${winner.name} mendapatkan bintang!` });

  // Cancel all burn candidates
  gameState.burnCandidates = [];

  updatePermanentStats();
  updateArchive();
  saveState();
  render();

  // Gold flash
  triggerGoldFlash();

  // Play reward video
  await playRewardVideo(winner.setupIdx);

  // TTS win
  await speakWithDuck(`Selamat ya ${winner.name} mendapatkan bintang satu`);
  await speakWithDuck('Ronde selesai, selamat berjuang dan fokus');

  // New round
  startNewRoundSetup();
}

function triggerGoldFlash() {
  let flash = document.getElementById('game-gold-flash');
  if (!flash) {
    flash = document.createElement('div');
    flash.id = 'game-gold-flash';
    document.body.appendChild(flash);
  }
  flash.classList.remove('flash-active');
  void flash.offsetWidth;
  flash.classList.add('flash-active');
}

async function playRewardVideo(setupIdx) {
  return new Promise(resolve => {
    const videoSrc = ANIMAL_VIDEOS[setupIdx];
    const overlay  = document.getElementById('reward-overlay');
    const video    = document.getElementById('reward-video');
    const flash    = document.getElementById('reward-flash');

    if (!overlay || !video) { resolve(); return; }

    // Duck bg music
    if (bgMusic) bgMusic.volume = 0.15;

    // Gold flash overlay
    if (flash) {
      flash.classList.remove('flash-active');
      void flash.offsetWidth;
      flash.classList.add('flash-active');
    }

    overlay.classList.remove('hidden');

    video.src = videoSrc;
    video.currentTime = 0;
    video.muted = false;

    const endVideo = () => {
      overlay.classList.add('hidden');
      video.pause();
      video.src = '';
      if (bgMusic) bgMusic.volume = bgMusicVolume;
      resolve();
    };

    video.onended = endVideo;
    video.onerror = () => {
      overlay.classList.add('hidden');
      if (bgMusic) bgMusic.volume = bgMusicVolume;
      resolve();
    };

    const timer = setTimeout(endVideo, 11000);
    video.onended = () => { clearTimeout(timer); endVideo(); };
    video.onerror = () => { clearTimeout(timer); overlay.classList.add('hidden'); if (bgMusic) bgMusic.volume = bgMusicVolume; resolve(); };

    video.play().catch(() => {
      clearTimeout(timer);
      overlay.classList.add('hidden');
      if (bgMusic) bgMusic.volume = bgMusicVolume;
      resolve();
    });
  });
}

function stopRewardVideo() {
  const overlay = document.getElementById('reward-overlay');
  const video   = document.getElementById('reward-video');
  if (overlay) overlay.classList.add('hidden');
  if (video) { video.pause(); video.currentTime = 0; video.src = ''; }
  if (bgMusic) bgMusic.volume = bgMusicVolume;
}

/* ─────────────────────────────────────────────
   13. NEW ROUND SETUP
───────────────────────────────────────────── */
function startNewRoundSetup() {
  gameState.phase  = 'newround';
  gameState.round += 1;
  saveState();
  render();
}

function handleStartNewRound() {
  playClickSound();

  const names = ['nr-p1','nr-p2','nr-p3','nr-p4'].map(id => {
    const inp = document.getElementById(id);
    return inp ? inp.value.trim() : '';
  });
  if (names.some(n => !n)) { alert('Semua nama pemain harus diisi!'); return; }

  // Get target
  const activeBtn = document.querySelector('#nr-target-row .target-btn.active');
  let target = activeBtn ? parseInt(activeBtn.dataset.val) : gameState.target;
  const customInp = document.getElementById('nr-custom-target');
  if (customInp && customInp.value) target = parseInt(customInp.value) || target;

  // Preserve stars and stats
  const prevPlayers = gameState.players;
  const round = gameState.round;
  const bgOn  = gameState.bgMusicOn;

  gameState = createInitialGameState(names, target, round);
  gameState.bgMusicOn = bgOn;
  gameState.phase = 'game';

  // Restore stars and accumulated stats from previous round (by name)
  gameState.players.forEach((p, i) => {
    const prev = prevPlayers.find(pp => pp.name === p.name);
    if (prev) {
      p.stars      = prev.stars;
      p.burns      = prev.burns;
      p.burned     = prev.burned;
      p.tripleBurn = prev.tripleBurn;
      p.highestScore = prev.highestScore;
      p.hadNegative  = prev.hadNegative;
    }
  });

  undoStack = [];
  saveState();
  render();
  tryPlayBgMusic();
  speakWithDuck('Permainan dimulai');
}

/* ─────────────────────────────────────────────
   14. RESET GAME
───────────────────────────────────────────── */
function handleResetGame() {
  playClickSound();
  document.getElementById('reset-modal').classList.remove('hidden');
}

function confirmReset() {
  playClickSound();
  document.getElementById('reset-modal').classList.add('hidden');
  stopAllAudio();

  gameState = null;
  undoStack = [];
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(LS_UNDO_KEY);

  // Destroy chart
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  showPage('page-setup');
}

/* ─────────────────────────────────────────────
   15. EDIT NAME
───────────────────────────────────────────── */
function openEditNameModal() {
  playClickSound();
  const modal  = document.getElementById('edit-name-modal');
  const fields = document.getElementById('edit-name-fields');
  if (!modal || !fields) return;

  fields.innerHTML = gameState.players.map((p, i) => `
    <div class="edit-name-field">
      <span class="edit-name-label">${ELEMENT_EMOJIS[p.setupIdx]}</span>
      <input type="text" class="edit-name-input" id="edit-name-inp-${i}"
        value="${p.name}" maxlength="16" />
    </div>
  `).join('');

  modal.classList.remove('hidden');
}

function saveEditNames() {
  playClickSound();
  gameState.players.forEach((p, i) => {
    const inp = document.getElementById(`edit-name-inp-${i}`);
    if (inp && inp.value.trim()) p.name = inp.value.trim();
  });
  updatePermanentStats();
  updateArchive();
  saveState();
  render();
  document.getElementById('edit-name-modal').classList.add('hidden');
}

/* ─────────────────────────────────────────────
   16. SCREENSHOT
───────────────────────────────────────────── */
function handleScreenshot() {
  playClickSound();
  // Simple screenshot via html2canvas if available, else alert
  if (window.html2canvas) {
    html2canvas(document.getElementById('page-game')).then(canvas => {
      const link = document.createElement('a');
      link.download = `score-cekih-r${gameState.round}g${gameState.turn}.png`;
      link.href = canvas.toDataURL();
      link.click();
    });
  } else {
    alert('Screenshot: Gunakan tombol screenshot bawaan perangkat Anda.');
  }
}

/* ─────────────────────────────────────────────
   17. FULLSCREEN
───────────────────────────────────────────── */
function handleFullscreen() {
  playClickSound();
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

/* ─────────────────────────────────────────────
   18. UNDO
───────────────────────────────────────────── */
function handleUndo() {
  playClickSound();
  stopAllAudio();
  stopRewardVideo();

  if (!popSnapshot()) {
    alert('Tidak ada yang bisa di-undo.');
    return;
  }

  // Re-apply ranking to be safe
  if (gameState && gameState.players) applyRanking(gameState.players);
  saveState();
  render();
}

/* ─────────────────────────────────────────────
   19. TAB SWITCHING
───────────────────────────────────────────── */
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.add('hidden');
  });
  const panel = document.getElementById(`tab-${tabName}`);
  if (panel) panel.classList.remove('hidden');

  if (tabName === 'chart') renderChart();
}

/* ─────────────────────────────────────────────
   20. SETUP PAGE
───────────────────────────────────────────── */
function handleStartGame() {
  playClickSound();

  const names = ['setup-p1','setup-p2','setup-p3','setup-p4'].map(id => {
    const inp = document.getElementById(id);
    return inp ? inp.value.trim() : '';
  });
  if (names.some(n => !n)) { alert('Semua nama pemain harus diisi!'); return; }

  // Get target
  const activeBtn = document.querySelector('.setup-target-row .target-btn.active');
  let target = activeBtn ? parseInt(activeBtn.dataset.val) : 1000;
  const customInp = document.getElementById('setup-custom-target');
  if (customInp && customInp.value) target = parseInt(customInp.value) || target;

  gameState = createInitialGameState(names, target, 1);
  gameState.phase = 'game';
  undoStack = [];

  updateArchive();
  saveState();

  // Destroy old chart
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  render();
  tryPlayBgMusic();
  speakWithDuck('Permainan dimulai');
}

/* ─────────────────────────────────────────────
   21. SETUP TARGET BUTTONS
───────────────────────────────────────────── */
function initTargetButtons(rowSelector) {
  document.querySelectorAll(`${rowSelector} .target-btn`).forEach(btn => {
    btn.addEventListener('click', () => {
      playClickSound();
      document.querySelectorAll(`${rowSelector} .target-btn`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

/* ─────────────────────────────────────────────
   22. LOADING SCREEN
───────────────────────────────────────────── */
function runLoadingScreen(onComplete) {
  const bar  = document.getElementById('loading-bar');
  const text = document.getElementById('loading-text');
  const msgs = ['Memuat aplikasi...', 'Membaca LocalStorage...', 'Memulihkan sesi...', 'Siap!'];
  let prog   = 0;
  let msgIdx = 0;

  const interval = setInterval(() => {
    prog = Math.min(100, prog + Math.random() * 18 + 5);
    if (bar) bar.style.width = prog + '%';
    if (text && msgIdx < msgs.length - 1 && prog > (msgIdx + 1) * 25) {
      msgIdx++;
      text.textContent = msgs[msgIdx];
    }
    if (prog >= 100) {
      clearInterval(interval);
      if (text) text.textContent = 'Siap!';
      setTimeout(() => {
        const ls = document.getElementById('loading-screen');
        if (ls) { ls.classList.add('fade-out'); setTimeout(() => { ls.style.display = 'none'; document.getElementById('app').classList.remove('hidden'); onComplete(); }, 800); }
      }, 400);
    }
  }, 120);
}

/* ─────────────────────────────────────────────
   23. CHART.JS LOADER
───────────────────────────────────────────── */
function loadChartJs(cb) {
  if (window.Chart) { cb(); return; }
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
  s.onload  = cb;
  s.onerror = cb;
  document.head.appendChild(s);
}

/* ─────────────────────────────────────────────
   24. EVENT LISTENERS
───────────────────────────────────────────── */
function bindEvents() {
  // Setup page
  const btnStart = document.getElementById('btn-start-game');
  if (btnStart) btnStart.addEventListener('click', handleStartGame);

  initTargetButtons('.setup-target-row');

  // Game page
  const btnSave = document.getElementById('btn-save-turn');
  if (btnSave) btnSave.addEventListener('click', handleSaveTurn);

  const btnUndo = document.getElementById('btn-undo');
  if (btnUndo) btnUndo.addEventListener('click', handleUndo);

  const btnEdit = document.getElementById('btn-edit-name');
  if (btnEdit) btnEdit.addEventListener('click', openEditNameModal);

  const btnOpenBurn = document.getElementById('btn-open-burn');
  if (btnOpenBurn) btnOpenBurn.addEventListener('click', openBurnModal);

  const btnSkipBurn = document.getElementById('btn-skip-burn');
  if (btnSkipBurn) btnSkipBurn.addEventListener('click', handleSkipBurn);

  const btnConfirmBurn = document.getElementById('btn-confirm-burn');
  if (btnConfirmBurn) btnConfirmBurn.addEventListener('click', handleConfirmBurn);

  const btnCancelBurn = document.getElementById('btn-cancel-burn');
  if (btnCancelBurn) btnCancelBurn.addEventListener('click', () => {
    playClickSound();
    document.getElementById('burn-modal').classList.add('hidden');
  });

  const btnBgMusic = document.getElementById('btn-bg-music');
  if (btnBgMusic) btnBgMusic.addEventListener('click', toggleBgMusic);

  const btnFullscreen = document.getElementById('btn-fullscreen');
  if (btnFullscreen) btnFullscreen.addEventListener('click', handleFullscreen);

  const btnScreenshot = document.getElementById('btn-screenshot');
  if (btnScreenshot) btnScreenshot.addEventListener('click', handleScreenshot);

  const btnReset = document.getElementById('btn-reset');
  if (btnReset) btnReset.addEventListener('click', handleResetGame);

  const btnConfirmReset = document.getElementById('btn-confirm-reset');
  if (btnConfirmReset) btnConfirmReset.addEventListener('click', confirmReset);

  const btnCancelReset = document.getElementById('btn-cancel-reset');
  if (btnCancelReset) btnCancelReset.addEventListener('click', () => {
    playClickSound();
    document.getElementById('reset-modal').classList.add('hidden');
  });

  // Edit name modal
  const btnSaveNames = document.getElementById('btn-save-names');
  if (btnSaveNames) btnSaveNames.addEventListener('click', saveEditNames);

  const btnCancelNames = document.getElementById('btn-cancel-names');
  if (btnCancelNames) btnCancelNames.addEventListener('click', () => {
    playClickSound();
    document.getElementById('edit-name-modal').classList.add('hidden');
  });

  // New round
  const btnStartNewRound = document.getElementById('btn-start-newround');
  if (btnStartNewRound) btnStartNewRound.addEventListener('click', handleStartNewRound);

  initTargetButtons('#nr-target-row');

  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      playClickSound();
      switchTab(btn.dataset.tab);
    });
  });

  // Modal close on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });
}

/* ─────────────────────────────────────────────
   25. MAIN INIT
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();

  loadChartJs(() => {
    runLoadingScreen(() => {
      loadUndoStack();
      const restored = loadState();

      if (restored && gameState) {
        // Ensure chart/history arrays exist
        if (!gameState.chartData) gameState.chartData = [];
        if (!gameState.history)   gameState.history   = [];
        if (!gameState.burnCandidates) gameState.burnCandidates = [];
        if (gameState.bgMusicOn === undefined) gameState.bgMusicOn = true;

        // Sync local audio volume variable
        if (gameState.bgMusicVolume) bgMusicVolume = gameState.bgMusicVolume;

        initBgMusic();
        if (gameState.bgMusicOn) tryPlayBgMusic();

        // Restore ranking
        if (gameState.players) applyRanking(gameState.players);

        render();
      } else {
        gameState = null;
        showPage('page-setup');
        document.getElementById('app').classList.remove('hidden');
        initBgMusic();
      }

      // First interaction needed for audio on some browsers
      document.addEventListener('click', () => { tryPlayBgMusic(); }, { once: true });
    });
  });
});

/* ─────────────────────────────────────────────
   26. SERVICE WORKER REGISTRATION
───────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
