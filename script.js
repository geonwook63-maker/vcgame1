"use strict";

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const distanceScoreEl = document.getElementById("distanceScore");
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
// 이전 버전 기록에는 점수가 없으므로 0점으로 표시하고 보존합니다.
function rankingScore(record) {
  return Number.isFinite(record.score) && record.score >= 0 ? Math.floor(record.score) : 0;
}
function sortRanking(records) {
  return records.sort((a, b) => rankingScore(b) - rankingScore(a) ||
    b.passed - a.passed || a.seconds - b.seconds || a.date.localeCompare(b.date)).slice(0, 10);
}
function renderRanking() {
  rankingBody.replaceChildren();
  const ranking = sortRanking(readRanking());
  if (!ranking.length) {
    const row = rankingBody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 7;
    cell.className = "ranking-empty";
    cell.textContent = "아직 기록이 없어요. 첫 번째 도전자가 되어 보세요!";
    return;
  }
  ranking.forEach((entry, i) => {
    const row = rankingBody.insertRow();
    [String(i + 1), entry.name, rankingScore(entry).toLocaleString("ko-KR"), entry.won ? "승리" : "패배", `${entry.passed}/${entry.target || 15}`, `${entry.seconds.toFixed(1)}초`, entry.date.slice(0, 10)].forEach(value => {
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
const STAGE_SIZE = 15;
const TARGET = STAGE_SIZE * 3;
// 실제 달린 월드 거리 10px당 1점. 정지/종료 중에는 점수가 오르지 않습니다.
const PIXELS_PER_POINT = 10;
function getScore() { return Math.floor(worldDistance / PIXELS_PER_POINT); }
// 단계마다 속도와 장애물 출현 간격을 변경합니다.
// 간격은 점프 체공 시간(약 0.79초)보다 충분히 길게 유지합니다.
const STAGES = [
  { name: "1단계 · 워밍업", speed: 300, minGap: 2.25, gapRandom: 0.30, special: 3 },
  { name: "2단계 · 가속", speed: 365, minGap: 2.10, gapRandom: 0.25, special: 6 },
  { name: "3단계 · 최종 도전", speed: 430, minGap: 2.00, gapRandom: 0.20, special: 8 }
];
const stageEl = document.getElementById("stage");
const stageNotice = document.getElementById("stageNotice");
let noticeTimeout = 0;
function stageIndexFor(passedCount) {
  return Math.min(STAGES.length - 1, Math.floor(passedCount / STAGE_SIZE));
}
function showStageNotice(index) {
  stageNotice.textContent = `${STAGES[index].name} 시작!`;
  stageNotice.classList.add("visible");
  noticeTimeout = 1.8;
}
const GRAVITY = 1900;
const JUMP_VELOCITY = -750;
const SECOND_JUMP_VELOCITY = -750;
const MAX_JUMPS = 2;
const PLAYER = { x: 125, w: 42, h: 52 };

let state = "ready";
let playerY = GROUND - PLAYER.h;
let velocityY = 0;
let jumpsUsed = 0;
let stagePlans = [];
let obstacles = [];
let passed = 0;
let spawnTimer = 0;
let worldDistance = 0;
let lastTime = 0;
let elapsed = 0;
let currentStage = 0;
let spawned = 0;

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


// 단계마다 정확히 지정된 수의 특수 장애물을 섞어 배치합니다.
// 게임을 다시 시작할 때마다 새로 셔플하여 순서가 달라집니다.
function makeStagePlan(stageIndex) {
  const specialCount = STAGES[stageIndex].special;
  const types = Array(STAGE_SIZE - specialCount).fill("normal");
  for (let i = 0; i < specialCount; i++) {
    types.push(i % 2 === 0 ? "tall" : "wide");
  }
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }
  return types;
}

function createObstacle(type, stageIndex) {
  const speed = STAGES[stageIndex].speed;
  if (type === "tall") return { type, x: W + 30, w: 36, h: 175, counted: false };
  // 1단 점프의 전체 체공 시간보다 긴 폭: 2단 점프가 필요합니다.
  if (type === "wide") return { type, x: W + 30, w: Math.round(speed * 0.91), h: 43, counted: false };
  return { type, x: W + 30, w: 30, h: 38 + Math.random() * 12, counted: false };
}

function reset() {
  closeRecordPanel();
  state = "ready";
  playerY = GROUND - PLAYER.h;
  velocityY = 0;
  jumpsUsed = 0;
  stagePlans = STAGES.map((_, index) => makeStagePlan(index));
  obstacles = [];
  passed = 0;
  spawnTimer = 1.35;
  worldDistance = 0;
  elapsed = 0;
  currentStage = 0;
  spawned = 0;
  noticeTimeout = 0;
  stageNotice.classList.remove("visible");
  updateHud();
  showOverlay("READY?", "달릴 준비 됐나요?", "장애물을 뛰어넘어 결승점까지 도달하세요.", "게임 시작");
}

function start() {
  prepareAudio();
  if (state === "running") return;
  reset();
  state = "running";
  overlay.classList.add("hidden");
  showStageNotice(0);
  // 버튼 클릭으로 시작했을 때 첫 점프는 별도 입력으로 진행합니다.
}

function jump() {
  if (state !== "running") {
    start();
    return;
  }
  if (jumpsUsed < MAX_JUMPS) {
    velocityY = jumpsUsed === 0 ? JUMP_VELOCITY : SECOND_JUMP_VELOCITY;
    jumpsUsed += 1;
    playJumpSound();
  }
}

function finish(won) {
  if (state !== "running") return; // 종료 효과음 중복 재생 방지
  state = won ? "won" : "lost";
  stageNotice.classList.remove("visible");
  playEndSound(won);
  finalRecord = { won, score: getScore(), passed, target: TARGET, stage: currentStage + 1, seconds: Math.round(elapsed * 10) / 10, date: new Date().toISOString() };
  recordPending = true;
  nicknameInput.value = "";
  recordMessage.textContent = "";
  recordSummary.textContent = `${won ? "승리" : "패배"} · ${STAGES[currentStage].name} · 장애물 ${passed}/${TARGET}개 통과 · 점수 ${getScore().toLocaleString("ko-KR")}점 · ${elapsed.toFixed(1)}초`;
  recordPanel.hidden = false;
  showOverlay(
    won ? "YOU WIN!" : "GAME OVER",
    won ? "완벽한 달리기!" : "장애물에 부딪혔어요!",
    won ? `3단계의 장애물 ${TARGET}개를 모두 통과했습니다!` : `${passed}개 통과! 다시 도전해 보세요.`,
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
  distanceScoreEl.textContent = getScore().toLocaleString("ko-KR");
  progressEl.style.width = `${(passed / TARGET) * 100}%`;
  stageEl.textContent = `${currentStage + 1} / ${STAGES.length} (${passed - currentStage * STAGE_SIZE}/${STAGE_SIZE})`;
}

function update(dt) {
  if (state !== "running") return;
  elapsed += dt;
  if (noticeTimeout > 0) {
    noticeTimeout -= dt;
    if (noticeTimeout <= 0) stageNotice.classList.remove("visible");
  }
  const stage = STAGES[currentStage];
  const speed = stage.speed;
  worldDistance += speed * dt;
  distanceScoreEl.textContent = getScore().toLocaleString("ko-KR");

  velocityY += GRAVITY * dt;
  playerY += velocityY * dt;
  if (playerY > GROUND - PLAYER.h) {
    playerY = GROUND - PLAYER.h;
    velocityY = 0;
    jumpsUsed = 0;
  }

  spawnTimer -= dt;
  if (spawnTimer <= 0 && spawned < (currentStage + 1) * STAGE_SIZE) {
    const stageSlot = spawned - currentStage * STAGE_SIZE;
    const type = stagePlans[currentStage][stageSlot];
    obstacles.push(createObstacle(type, currentStage));
    spawned += 1;
    // 일정한 최소 간격을 보장해 모든 장애물을 점프로 넘을 수 있습니다.
    spawnTimer = stage.minGap + Math.random() * stage.gapRandom;
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
      if (passed < TARGET && stageIndexFor(passed) !== currentStage) {
        currentStage = stageIndexFor(passed);
        showStageNotice(currentStage);
        // 다음 단계 첫 장애물부터 새 출현 간격 적용
        spawnTimer = STAGES[currentStage].minGap + Math.random() * STAGES[currentStage].gapRandom;
      }
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
    const color = obstacle.type === "tall" ? "#b77aff" : obstacle.type === "wide" ? "#ffb44d" : "#ff6585";
    const highlight = obstacle.type === "tall" ? "#dfbaff" : obstacle.type === "wide" ? "#ffe1a5" : "#ff9bae";
    roundedRect(obstacle.x, GROUND - obstacle.h, obstacle.w, obstacle.h, 5, color);
    roundedRect(obstacle.x + 5, GROUND - obstacle.h + 6, Math.max(6, obstacle.w - 10), 6, 3, highlight);
    if (obstacle.type !== "normal") {
      ctx.fillStyle = "#172440";
      ctx.font = "bold 15px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("×2", obstacle.x + obstacle.w / 2, GROUND - obstacle.h / 2 + 5);
      ctx.textAlign = "start";
    }
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
