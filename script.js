"use strict";

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const statusEl = document.getElementById("status");
const progressEl = document.getElementById("progress");
const overlay = document.getElementById("overlay");
const overlayBadge = document.getElementById("overlayBadge");
const overlayTitle = document.getElementById("overlayTitle");
const overlayText = document.getElementById("overlayText");
const startButton = document.getElementById("startButton");
const restartButton = document.getElementById("restartButton");
const soundButton = document.getElementById("soundButton");

const recordPanel = document.getElementById("recordPanel");
const recordForm = document.getElementById("recordForm");
const recordSummary = document.getElementById("recordSummary");
const recordMessage = document.getElementById("recordMessage");
const nicknameInput = document.getElementById("nickname");
const skipRecordButton = document.getElementById("skipRecord");
const rankingBody = document.getElementById("rankingBody");
const clearRankingButton = document.getElementById("clearRanking");
const RANKING_KEY = "jump-runner-ranking-v1";
let recordPending = false;
let finalRecord = null;

function readRanking() {
  try {
    const data = JSON.parse(localStorage.getItem(RANKING_KEY) || "[]");
    return Array.isArray(data) ? data.filter(r => r && typeof r.name === "string" &&
      Number.isFinite(r.passed) && Number.isFinite(r.seconds) && typeof r.date === "string") : [];
  } catch { return []; }
}
function sortRanking(records) {
  return records.sort((a, b) => b.passed - a.passed || a.seconds - b.seconds || a.date.localeCompare(b.date)).slice(0, 10);
}
function renderRanking() {
  rankingBody.replaceChildren();
  const ranking = sortRanking(readRanking());
  if (!ranking.length) {
    const row = rankingBody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 6;
    cell.className = "ranking-empty";
    cell.textContent = "아직 기록이 없어요. 첫 번째 도전자가 되어 보세요!";
    return;
  }
  ranking.forEach((entry, i) => {
    const row = rankingBody.insertRow();
    [String(i + 1), entry.name, entry.won ? "승리" : "패배", `${entry.passed}/15`, `${entry.seconds.toFixed(1)}초`, entry.date.slice(0, 10)].forEach(value => {
      row.insertCell().textContent = value;
    });
  });
}
function closeRecordPanel() {
  recordPending = false;
  finalRecord = null;
  recordPanel.hidden = true;
}
recordForm.addEventListener("submit", event => {
  event.preventDefault();
  if (!recordPending || !finalRecord) return;
  const name = nicknameInput.value.trim();
  if (!name || name.length > 12) { recordMessage.textContent = "닉네임을 1~12자로 입력해 주세요."; return; }
  const records = sortRanking([...readRanking(), { ...finalRecord, name }]);
  try {
    localStorage.setItem(RANKING_KEY, JSON.stringify(records));
  } catch {
    recordMessage.textContent = "저장할 수 없습니다. 브라우저 저장소 설정을 확인해 주세요.";
    return;
  }
  closeRecordPanel();
  renderRanking();
});
skipRecordButton.addEventListener("click", closeRecordPanel);
clearRankingButton.addEventListener("click", () => {
  if (!window.confirm("이 브라우저에 저장된 TOP 10 기록을 모두 삭제할까요?")) return;
  try { localStorage.removeItem(RANKING_KEY); } catch { /* 접근 제한 시 무시 */ }
  renderRanking();
});

const W = canvas.width;
const H = canvas.height;
const GROUND = 320;
const TARGET = 15;
const GRAVITY = 1900;
const JUMP_VELOCITY = -750;
const PLAYER = { x: 125, w: 42, h: 52 };

let state = "ready";
let playerY = GROUND - PLAYER.h;
let velocityY = 0;
let obstacles = [];
let passed = 0;
let spawnTimer = 0;
let worldDistance = 0;
let lastTime = 0;
let elapsed = 0;

// 외부 음원 파일 없이 브라우저에서 점프 효과음을 직접 생성합니다.
// 브라우저의 자동재생 제한 때문에 최초 사용자 입력 후 AudioContext를 시작합니다.
let audioContext = null;
let soundEnabled = true;

function prepareAudio() {
  if (!soundEnabled) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
  } catch (error) {
    console.warn("효과음을 사용할 수 없습니다.", error);
  }
}

function playJumpSound() {
  if (!soundEnabled) return;
  prepareAudio();
  if (!audioContext || audioContext.state !== "running") return;
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(330, now);
  oscillator.frequency.exponentialRampToValueAtTime(720, now + 0.12);
  oscillator.frequency.exponentialRampToValueAtTime(540, now + 0.20);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.23);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.24);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
}


// 종료 효과음: 승리는 상승하는 3음, 패배는 하강하는 3음입니다.
// 기존 효과음 ON/OFF 설정을 공통으로 적용합니다.
function playEndSound(won) {
  if (!soundEnabled) return;
  prepareAudio();
  if (!audioContext || audioContext.state !== "running") return;

  const now = audioContext.currentTime;
  const notes = won ? [523.25, 659.25, 783.99] : [392, 311.13, 196];
  const duration = won ? 0.17 : 0.23;
  const volume = won ? 0.12 : 0.11;

  notes.forEach((frequency, index) => {
    const startAt = now + index * duration;
    const endAt = startAt + duration + 0.06;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = won ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(endAt + 0.01);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  });
}


function reset() {
  closeRecordPanel();
  state = "ready";
  playerY = GROUND - PLAYER.h;
  velocityY = 0;
  obstacles = [];
  passed = 0;
  spawnTimer = 1.35;
  worldDistance = 0;
  elapsed = 0;
  updateHud();
  statusEl.textContent = "준비";
  showOverlay("READY?", "달릴 준비 됐나요?", "장애물을 뛰어넘어 결승점까지 도달하세요.", "게임 시작");
}

function start() {
  prepareAudio();
  if (state === "running") return;
  reset();
  state = "running";
  statusEl.textContent = "달리는 중";
  overlay.classList.add("hidden");
  // 버튼 클릭으로 시작했을 때 첫 점프는 별도 입력으로 진행합니다.
}

function jump() {
  if (state !== "running") {
    start();
    return;
  }
  if (playerY >= GROUND - PLAYER.h - 0.5) {
    velocityY = JUMP_VELOCITY;
    playJumpSound();
  }
}

function finish(won) {
  if (state !== "running") return; // 종료 효과음 중복 재생 방지
  state = won ? "won" : "lost";
  playEndSound(won);
  finalRecord = { won, passed, seconds: Math.round(elapsed * 10) / 10, date: new Date().toISOString() };
  recordPending = true;
  nicknameInput.value = "";
  recordMessage.textContent = "";
  recordSummary.textContent = `${won ? "승리" : "패배"} · 장애물 ${passed}/${TARGET}개 통과 · ${elapsed.toFixed(1)}초`;
  recordPanel.hidden = false;
  statusEl.textContent = won ? "승리!" : "게임 오버";
  showOverlay(
    won ? "YOU WIN!" : "GAME OVER",
    won ? "완벽한 달리기!" : "장애물에 부딪혔어요!",
    won ? "장애물 15개를 모두 통과했습니다!" : `${passed}개 통과! 다시 도전해 보세요.`,
    "다시 시작"
  );
}

function showOverlay(badge, title, description, buttonLabel) {
  overlayBadge.textContent = badge;
  overlayTitle.textContent = title;
  overlayText.textContent = description;
  startButton.textContent = buttonLabel + " →";
  overlay.classList.remove("hidden");
}

function updateHud() {
  scoreEl.textContent = passed;
  progressEl.style.width = `${(passed / TARGET) * 100}%`;
}

function update(dt) {
  if (state !== "running") return;
  elapsed += dt;
  const speed = Math.min(440, 330 + passed * 6);
  worldDistance += speed * dt;

  velocityY += GRAVITY * dt;
  playerY += velocityY * dt;
  if (playerY > GROUND - PLAYER.h) {
    playerY = GROUND - PLAYER.h;
    velocityY = 0;
  }

  spawnTimer -= dt;
  if (spawnTimer <= 0 && passed + obstacles.length < TARGET) {
    const height = 38 + Math.random() * 12;
    obstacles.push({ x: W + 30, w: 30, h: height, counted: false });
    // 일정한 최소 간격을 보장해 모든 장애물을 점프로 넘을 수 있습니다.
    spawnTimer = 1.4 + Math.random() * 0.35;
  }

  for (const obstacle of obstacles) {
    obstacle.x -= speed * dt;
    const margin = 7;
    const overlap = PLAYER.x + PLAYER.w - margin > obstacle.x + margin &&
      PLAYER.x + margin < obstacle.x + obstacle.w - margin &&
      playerY + PLAYER.h - margin > GROUND - obstacle.h + margin &&
      playerY + margin < GROUND - margin;
    if (overlap) {
      finish(false);
      return;
    }
    if (!obstacle.counted && obstacle.x + obstacle.w < PLAYER.x) {
      obstacle.counted = true;
      passed += 1;
      updateHud();
      if (passed >= TARGET) {
        finish(true);
        return;
      }
    }
  }
  obstacles = obstacles.filter(o => o.x + o.w > -20);
}

function roundedRect(x, y, w, h, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function draw() {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#182b50");
  sky.addColorStop(1, "#344c78");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // 달리는 느낌을 주는 배경 장식
  ctx.fillStyle = "#91b9ec18";
  for (let i = 0; i < 7; i++) {
    const x = ((i * 175 - worldDistance * 0.14) % 1100 + 1100) % 1100 - 100;
    roundedRect(x, 140 + (i % 3) * 23, 115, 12, 7, "#a7c7fa22");
  }
  ctx.fillStyle = "#223656";
  ctx.beginPath();
  ctx.moveTo(0, GROUND);
  for (let x = 0; x <= W; x += 60) {
    ctx.lineTo(x, 270 + Math.sin((x + worldDistance * 0.12) / 95) * 16);
  }
  ctx.lineTo(W, GROUND);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#13233b";
  ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.fillStyle = "#6ad5ed";
  ctx.fillRect(0, GROUND, W, 5);
  for (let i = 0; i < 13; i++) {
    const x = ((i * 95 - worldDistance * 0.7) % 1250 + 1250) % 1250 - 50;
    roundedRect(x, 359, 47, 4, 2, "#476181");
  }

  for (const obstacle of obstacles) {
    roundedRect(obstacle.x, GROUND - obstacle.h, obstacle.w, obstacle.h, 5, "#ff6585");
    roundedRect(obstacle.x + 5, GROUND - obstacle.h + 6, 6, obstacle.h - 12, 3, "#ff9bae");
  }

  const bob = state === "running" && velocityY === 0 ? Math.sin(elapsed * 18) * 2 : 0;
  roundedRect(PLAYER.x + 3, playerY + bob + 3, PLAYER.w, PLAYER.h, 9, "#09162b55");
  roundedRect(PLAYER.x, playerY + bob, PLAYER.w, PLAYER.h, 9, "#52d8e6");
  roundedRect(PLAYER.x + 9, playerY + bob + 12, 8, 8, 3, "#123454");
  roundedRect(PLAYER.x + 28, playerY + bob + 12, 8, 8, 3, "#123454");
  roundedRect(PLAYER.x + 16, playerY + bob + 32, 12, 4, 2, "#1688a9");
}

function frame(timestamp) {
  const dt = Math.min((timestamp - (lastTime || timestamp)) / 1000, 0.033);
  lastTime = timestamp;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

window.addEventListener("keydown", event => {
  if (event.code !== "Space") return;
  if (event.target instanceof HTMLElement && (event.target.closest("input, textarea, button, select") || event.target.isContentEditable)) return;
  event.preventDefault();
  if (event.repeat) return;
  jump();
});
startButton.addEventListener("click", start);
restartButton.addEventListener("click", start);
soundButton.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundButton.textContent = soundEnabled ? "🔊 효과음 켜짐" : "🔇 효과음 꺼짐";
  soundButton.setAttribute("aria-pressed", String(soundEnabled));
  if (soundEnabled) prepareAudio();
});

reset();
renderRanking();
requestAnimationFrame(frame);
