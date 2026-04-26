<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>NETFUNGUS // colony 0.3</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=VT323&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #1f2419;
    --bg-deep: #161a12;
    --board-bg: #2a3122;
    --grid: #4a5439;
    --grid-strong: #6b7853;
    --p1: #f4c430;
    --p1-glow: #ffe066;
    --p2: #7ed957;
    --p2-glow: #b5ff8f;
    --text: #e8dba8;
    --text-dim: #8a8060;
    --warn: #e85a3a;
    --warn-glow: #ff8866;
    --crt-line: rgba(255, 230, 140, 0.05);
  }

  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg-deep);
    color: var(--text);
    font-family: "JetBrains Mono", ui-monospace, monospace;
    height: 100%;
    overflow: hidden;
  }

  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background: repeating-linear-gradient(
      0deg, transparent 0, transparent 2px,
      var(--crt-line) 3px, transparent 4px);
    z-index: 9999;
    mix-blend-mode: screen;
  }
  body::after {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.4) 100%);
    z-index: 9998;
  }

  .app {
    display: grid;
    grid-template-columns: 340px 1fr 280px;
    grid-template-rows: 48px 1fr 36px;
    grid-template-areas:
      "header header header"
      "sidebar board log"
      "footer footer footer";
    height: 100vh;
    gap: 1px;
    background: var(--grid);
    padding: 1px;
  }

  header.bar {
    grid-area: header;
    background: var(--bg);
    display: flex;
    align-items: center;
    padding: 0 18px;
    font-family: "VT323", monospace;
    font-size: 24px;
    letter-spacing: 2px;
    color: var(--p1);
    text-shadow: 0 0 8px var(--p1-glow);
    justify-content: space-between;
  }
  header.bar .title::before { content: "▓ "; color: var(--p2); }
  header.bar .room-code { color: var(--text); font-size: 18px; letter-spacing: 4px; }
  header.bar .room-code span { color: var(--p1); }

  aside.sidebar {
    grid-area: sidebar;
    background: var(--bg);
    padding: 18px;
    overflow-y: auto;
    border-right: 1px solid var(--grid);
  }

  main.board-wrap {
    grid-area: board;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
  }

  aside.log {
    grid-area: log;
    background: var(--bg);
    padding: 18px 14px;
    overflow-y: auto;
    border-left: 1px solid var(--grid);
    font-size: 12px;
  }

  footer.bar {
    grid-area: footer;
    background: var(--bg);
    display: flex;
    align-items: center;
    padding: 0 18px;
    font-size: 11px;
    color: var(--text-dim);
    letter-spacing: 1px;
    justify-content: space-between;
  }

  .panel-title {
    font-family: "VT323", monospace;
    font-size: 22px;
    color: var(--p1);
    text-shadow: 0 0 6px var(--p1-glow);
    letter-spacing: 3px;
    margin: 0 0 14px;
    border-bottom: 1px dashed var(--grid-strong);
    padding-bottom: 10px;
  }
  .panel-section {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px dashed var(--grid-strong);
  }
  .panel-section-title {
    font-family: "VT323", monospace;
    font-size: 16px;
    color: var(--text-dim);
    letter-spacing: 3px;
    margin: 0 0 10px;
  }

  .field { margin-bottom: 12px; }
  .field label {
    display: block;
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 2px;
    margin-bottom: 4px;
  }
  .field input[type=text], .field input:not([type]), .field select {
    width: 100%;
    background: var(--bg-deep);
    border: 1px solid var(--grid-strong);
    color: var(--text);
    font-family: inherit;
    padding: 8px 10px;
    font-size: 14px;
    outline: none;
    letter-spacing: 1px;
  }
  .field input:focus, .field select:focus {
    border-color: var(--p1);
    box-shadow: 0 0 0 1px var(--p1) inset;
  }
  .field input.code-input {
    text-transform: uppercase;
    letter-spacing: 6px;
    font-size: 18px;
    text-align: center;
  }
  .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .field-row .field { margin-bottom: 0; }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
  }
  .checkbox-row input[type=checkbox] {
    appearance: none;
    width: 16px; height: 16px;
    border: 1px solid var(--grid-strong);
    background: var(--bg-deep);
    cursor: pointer;
    position: relative;
    flex-shrink: 0;
  }
  .checkbox-row input[type=checkbox]:checked { border-color: var(--p1); }
  .checkbox-row input[type=checkbox]:checked::after {
    content: "▓";
    position: absolute;
    top: -3px; left: 1px;
    color: var(--p1);
    font-size: 14px;
    line-height: 1;
  }

  button.act {
    display: block; width: 100%;
    background: transparent;
    border: 1px solid var(--p1);
    color: var(--p1);
    padding: 10px;
    font-family: inherit;
    font-size: 13px;
    letter-spacing: 3px;
    text-transform: uppercase;
    cursor: pointer;
    margin-top: 6px;
    transition: all 0.15s;
  }
  button.act:hover { background: var(--p1); color: var(--bg-deep); }
  button.act.secondary { border-color: var(--p2); color: var(--p2); }
  button.act.secondary:hover { background: var(--p2); color: var(--bg-deep); }
  button.act.danger { border-color: var(--warn); color: var(--warn); }
  button.act.danger:hover { background: var(--warn); color: var(--bg-deep); }
  button.act.active { background: var(--p1); color: var(--bg-deep); }
  button.act:disabled {
    border-color: var(--text-dim);
    color: var(--text-dim);
    cursor: not-allowed;
    background: transparent;
  }

  .or-divider {
    text-align: center;
    color: var(--text-dim);
    margin: 18px 0;
    font-size: 11px;
    letter-spacing: 4px;
  }
  .or-divider::before, .or-divider::after {
    content: "─────";
    margin: 0 8px;
    opacity: 0.5;
  }

  .player-card {
    border: 1px solid var(--grid-strong);
    padding: 10px 12px;
    margin-bottom: 10px;
    position: relative;
    background: var(--bg-deep);
  }
  .player-card.p1 { border-left: 3px solid var(--p1); }
  .player-card.p2 { border-left: 3px solid var(--p2); }
  .player-card.active::after {
    content: "◀ TURN";
    position: absolute;
    right: 10px; top: 10px;
    font-size: 10px;
    letter-spacing: 2px;
    color: var(--p1-glow);
    text-shadow: 0 0 4px currentColor;
    animation: pulse 1.5s infinite;
  }
  .player-card.p2.active::after { color: var(--p2-glow); }
  .player-card.threatened {
    box-shadow: 0 0 12px var(--warn-glow);
    animation: dangerPulse 0.9s infinite;
  }
  @keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
  @keyframes dangerPulse {
    0%,100% { box-shadow: 0 0 8px var(--warn-glow); }
    50%     { box-shadow: 0 0 16px var(--warn); }
  }
  .player-card .name {
    font-size: 14px;
    color: var(--text);
    margin-bottom: 4px;
    letter-spacing: 1px;
    word-wrap: break-word;
  }
  .player-card.p1 .name { color: var(--p1); }
  .player-card.p2 .name { color: var(--p2); }
  .player-card .stat {
    font-size: 11px;
    color: var(--text-dim);
    letter-spacing: 1px;
  }
  .player-card .stat strong { color: var(--text); font-size: 13px; }
  .player-card .threat-tag {
    display: inline-block;
    margin-left: 6px;
    color: var(--warn);
    font-size: 10px;
    letter-spacing: 2px;
    animation: pulse 0.9s infinite;
  }
  .player-card .bites-row {
    display: flex;
    gap: 4px;
    margin-top: 6px;
    align-items: center;
  }
  .player-card .bites-row .label {
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 2px;
    margin-right: 4px;
  }
  .bite-pip {
    display: inline-block;
    width: 10px; height: 10px;
    border: 1px solid currentColor;
    transform: rotate(45deg);
  }
  .player-card.p1 .bite-pip { color: var(--p1); }
  .player-card.p2 .bite-pip { color: var(--p2); }
  .bite-pip.spent { opacity: 0.25; background: transparent; }
  .bite-pip:not(.spent) { background: currentColor; }

  .piece-display {
    margin-top: 18px;
    padding: 14px;
    border: 1px dashed var(--grid-strong);
    text-align: center;
  }
  .piece-display .label {
    font-size: 11px;
    letter-spacing: 3px;
    color: var(--text-dim);
    margin-bottom: 8px;
  }
  .piece-display .piece-svg {
    width: 100%;
    max-width: 140px;
    height: 80px;
    margin: 0 auto;
  }
  .piece-display .hint {
    font-size: 10px;
    color: var(--text-dim);
    margin-top: 8px;
    line-height: 1.4;
  }
  .piece-display .hint kbd {
    background: var(--bg-deep);
    border: 1px solid var(--grid-strong);
    padding: 1px 5px;
    color: var(--text);
    font-family: inherit;
    font-size: 10px;
  }

  .upcoming-display {
    margin-top: 14px;
    padding: 10px;
    border: 1px dashed var(--grid-strong);
  }
  .upcoming-display .label {
    font-size: 10px;
    letter-spacing: 3px;
    color: var(--text-dim);
    margin-bottom: 8px;
    text-align: center;
  }
  .upcoming-row {
    display: flex; gap: 6px; justify-content: center; align-items: center; flex-wrap: wrap;
  }
  .upcoming-row svg {
    width: 44px; height: 28px;
    background: var(--bg-deep);
    border: 1px solid var(--grid);
    padding: 2px;
  }
  .upcoming-row .arrow { color: var(--text-dim); font-size: 10px; margin: 0 2px; }

  .room-info {
    margin-top: 14px;
    padding: 8px 10px;
    background: var(--bg-deep);
    border: 1px solid var(--grid-strong);
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 1.5px;
    line-height: 1.6;
  }
  .room-info .row { display: flex; justify-content: space-between; }
  .room-info strong { color: var(--text); font-weight: normal; }

  #board {
    display: block;
    image-rendering: pixelated;
    background: var(--board-bg);
    border: 1px solid var(--grid-strong);
    cursor: crosshair;
  }
  #board.bite-mode { cursor: cell; }

  .board-status {
    position: absolute;
    top: 16px; left: 50%;
    transform: translateX(-50%);
    font-family: "VT323", monospace;
    font-size: 18px;
    letter-spacing: 3px;
    color: var(--text-dim);
    pointer-events: none;
  }
  .board-status.bite-mode {
    color: var(--warn);
    text-shadow: 0 0 8px var(--warn-glow);
  }

  .game-over {
    position: absolute;
    inset: 0;
    background: rgba(22,26,18,0.88);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    z-index: 10;
    backdrop-filter: blur(2px);
  }
  .game-over h1 {
    font-family: "VT323", monospace;
    font-size: 64px;
    margin: 0;
    letter-spacing: 6px;
    text-shadow: 0 0 20px currentColor;
  }
  .game-over .sub {
    margin: 12px 0 24px;
    font-size: 13px;
    letter-spacing: 4px;
    color: var(--text-dim);
  }
  .game-over button {
    background: transparent;
    border: 1px solid var(--text);
    color: var(--text);
    padding: 12px 28px;
    font-family: inherit;
    letter-spacing: 4px;
    cursor: pointer;
    text-transform: uppercase;
    font-size: 13px;
  }
  .game-over button:hover { background: var(--text); color: var(--bg-deep); }

  .log-entry {
    padding: 4px 0;
    border-bottom: 1px dotted var(--grid);
    font-size: 11px;
    letter-spacing: 0.5px;
    color: var(--text-dim);
  }
  .log-entry .turn-num { color: var(--text); }
  .log-entry.p1 .who { color: var(--p1); }
  .log-entry.p2 .who { color: var(--p2); }
  .log-entry .flip { color: var(--p1-glow); }
  .log-entry .bite-tag { color: var(--warn); letter-spacing: 1px; }

  .hidden { display: none !important; }
  .err {
    color: var(--warn);
    font-size: 12px;
    margin-top: 8px;
    min-height: 16px;
  }

  @media (max-width: 900px) {
    .app {
      grid-template-columns: 1fr;
      grid-template-rows: 48px auto auto auto 36px;
      grid-template-areas: "header" "sidebar" "board" "log" "footer";
      height: auto; min-height: 100vh;
    }
    aside.log { max-height: 200px; }
  }
</style>
</head>
<body>
<div class="app">
  <header class="bar">
    <span class="title">NETFUNGUS</span>
    <span class="room-code" id="roomCodeDisplay"></span>
  </header>

  <aside class="sidebar" id="sidebar">
    <!-- LOBBY -->
    <div id="lobby">
      <h2 class="panel-title">// initialize</h2>
      <div class="field">
        <label>your name</label>
        <input id="nameInput" maxlength="24" placeholder="enter your name" />
      </div>

      <div class="panel-section">
        <h3 class="panel-section-title">// new colony settings</h3>
        <div class="field-row">
          <div class="field">
            <label>grid size</label>
            <select id="sizeSelect">
              <option value="8">8 × 8</option>
              <option value="10">10 × 10</option>
              <option value="12">12 × 12</option>
              <option value="14">14 × 14</option>
              <option value="16" selected>16 × 16</option>
              <option value="18">18 × 18</option>
              <option value="20">20 × 20</option>
              <option value="24">24 × 24</option>
            </select>
          </div>
          <div class="field">
            <label>head spread</label>
            <select id="offsetSelect">
              <option value="1">close (1)</option>
              <option value="2">2 from center</option>
              <option value="3" selected>3 from center</option>
              <option value="4">4 from center</option>
              <option value="5">far (5)</option>
            </select>
          </div>
        </div>
        <label class="checkbox-row">
          <input type="checkbox" id="lookaheadToggle" />
          <span>show upcoming pieces</span>
        </label>
        <div class="field" id="lookaheadCountField" style="display:none;">
          <label>how many to show</label>
          <select id="lookaheadCount">
            <option value="1">1 piece</option>
            <option value="3" selected>3 pieces</option>
            <option value="5">5 pieces</option>
          </select>
        </div>
        <button class="act" id="createBtn">Create New Colony</button>
      </div>

      <div class="or-divider">or</div>

      <div class="field">
        <label>room code</label>
        <input id="codeInput" class="code-input" maxlength="4" placeholder="XXXX" />
      </div>
      <button class="act secondary" id="joinBtn">Join Existing</button>
      <div class="err" id="lobbyErr"></div>
    </div>

    <!-- WAITING -->
    <div id="waiting" class="hidden">
      <h2 class="panel-title">// waiting</h2>
      <p style="font-size:12px;color:var(--text-dim);line-height:1.6;">
        Share this code with another player:
      </p>
      <div style="font-family:'VT323',monospace;font-size:48px;text-align:center;letter-spacing:8px;color:var(--p1);text-shadow:0 0 12px var(--p1-glow);margin:10px 0;" id="waitCode">────</div>
      <p style="font-size:11px;color:var(--text-dim);text-align:center;letter-spacing:2px;">
        connection pending…
      </p>
      <div class="room-info" id="waitInfo"></div>
    </div>

    <!-- IN-GAME -->
    <div id="gameInfo" class="hidden">
      <h2 class="panel-title">// colonies</h2>
      <div id="playerCards"></div>

      <div class="piece-display">
        <div class="label" id="pieceLabel">YOUR NEXT SPORE</div>
        <svg class="piece-svg" id="pieceSvg" viewBox="0 0 140 80"></svg>
        <div class="hint" id="pieceHint">
          <kbd>R</kbd> rotate &nbsp;·&nbsp; <kbd>Click</kbd> place
        </div>
      </div>

      <button class="act danger" id="biteBtn" style="margin-top:12px;">
        BITE (3)
      </button>

      <div class="upcoming-display hidden" id="upcomingDisplay">
        <div class="label">UPCOMING</div>
        <div class="upcoming-row" id="upcomingRow"></div>
      </div>

      <div class="room-info" id="gameRoomInfo"></div>
    </div>
  </aside>

  <main class="board-wrap">
    <div class="board-status" id="boardStatus"></div>
    <canvas id="board" width="640" height="640"></canvas>
    <div class="game-over hidden" id="gameOver">
      <h1 id="goTitle">VICTORY</h1>
      <div class="sub" id="goSub">colony dominant</div>
      <button id="rematchBtn">REMATCH</button>
    </div>
  </main>

  <aside class="log">
    <div style="font-size:10px;letter-spacing:3px;color:var(--text-dim);margin-bottom:10px;">// EVENT LOG</div>
    <div id="logList"></div>
  </aside>

  <footer class="bar">
    <span>NETFUNGUS · A reconstruction of the 1990s networked colony game</span>
    <span id="connStatus">○ disconnected</span>
  </footer>
</div>

<script>
const SHAPES = {
  I: [[0,0],[1,0],[2,0],[3,0]],
  O: [[0,0],[1,0],[0,1],[1,1]],
  T: [[0,0],[1,0],[2,0],[1,1]],
  S: [[1,0],[2,0],[0,1],[1,1]],
  Z: [[0,0],[1,0],[1,1],[2,1]],
  J: [[0,0],[0,1],[1,1],[2,1]],
  L: [[2,0],[0,1],[1,1],[2,1]],
};
function rotate(cells, times) {
  let out = cells.map(([x,y])=>[x,y]);
  for (let i = 0; i < ((times%4)+4)%4; i++)
    out = out.map(([x,y])=>[-y,x]);
  const minX = Math.min(...out.map(([x])=>x));
  const minY = Math.min(...out.map(([,y])=>y));
  return out.map(([x,y])=>[x-minX, y-minY]);
}

let ws = null;
let myIndex = null;
let lastState = null;
let hover = { x: -1, y: -1 };
let rotation = 0;
let myRoom = null;
let boardSize = 16;
let biteMode = false; // toggled by Bite button
let pulseT = 0; // animation time
let pulseAnim = null;

function makeCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function buildWsUrl(room, name, role, extra = {}) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({ room, name, role, ...extra });
  return `${proto}//${location.host}/ws?${params.toString()}`;
}

function connect(room, name, role, extra = {}) {
  myRoom = room;
  const url = buildWsUrl(room, name, role, extra);
  ws = new WebSocket(url);
  ws.onopen = () => {
    document.getElementById("connStatus").textContent = "● connected";
    document.getElementById("connStatus").style.color = "var(--p2)";
  };
  ws.onclose = (e) => {
    document.getElementById("connStatus").textContent = "○ disconnected";
    document.getElementById("connStatus").style.color = "var(--warn)";
    if (!lastState && e.code !== 1000) {
      document.getElementById("lobbyErr").textContent =
        e.reason || "connection failed (room may not exist or be full)";
      document.getElementById("lobby").classList.remove("hidden");
      document.getElementById("waiting").classList.add("hidden");
      document.getElementById("gameInfo").classList.add("hidden");
    }
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "error") {
      document.getElementById("lobbyErr").textContent = msg.error;
      flashStatus(msg.error);
      return;
    }
    if (msg.type === "lobby") {
      myIndex = msg.yourIndex;
      enterWaiting(myRoom, msg.settings);
      return;
    }
    if (msg.type === "state") {
      myIndex = msg.yourIndex;
      const wasNewGame = !lastState || lastState.size !== msg.size;
      lastState = msg;
      boardSize = msg.size;
      enterGame();
      if (wasNewGame) fitCanvas();
      // If turn flipped to opponent, exit bite mode
      if (msg.turn !== myIndex) biteMode = false;
      render();
      return;
    }
    if (msg.type === "opponent_left") {
      if (lastState) {
        lastState.finished = true;
        lastState.endReason = "forfeit";
        lastState.winner = msg.winner;
        render();
      }
    }
  };
}

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function flashStatus(text) {
  const status = document.getElementById("boardStatus");
  const original = status.textContent;
  const originalColor = status.style.color;
  status.textContent = "// " + text;
  status.style.color = "var(--warn)";
  setTimeout(() => {
    status.textContent = original;
    status.style.color = originalColor;
  }, 1500);
}

document.getElementById("lookaheadToggle").addEventListener("change", (e) => {
  document.getElementById("lookaheadCountField").style.display =
    e.target.checked ? "block" : "none";
});

document.getElementById("createBtn").onclick = () => {
  const name = document.getElementById("nameInput").value.trim();
  if (!name) {
    document.getElementById("lobbyErr").textContent = "please enter your name";
    return;
  }
  const size = document.getElementById("sizeSelect").value;
  const offset = document.getElementById("offsetSelect").value;
  const lookaheadOn = document.getElementById("lookaheadToggle").checked;
  const lookahead = lookaheadOn ? document.getElementById("lookaheadCount").value : "0";
  const code = makeCode();
  connect(code, name, "create", { size, offset, lookahead });
};
document.getElementById("joinBtn").onclick = () => {
  const name = document.getElementById("nameInput").value.trim();
  if (!name) {
    document.getElementById("lobbyErr").textContent = "please enter your name";
    return;
  }
  const code = document.getElementById("codeInput").value.trim().toUpperCase();
  if (code.length !== 4) {
    document.getElementById("lobbyErr").textContent = "code must be 4 characters";
    return;
  }
  connect(code, name, "join");
};
document.getElementById("codeInput").addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});
document.getElementById("rematchBtn").onclick = () => send({ type: "rematch" });

document.getElementById("biteBtn").onclick = () => {
  if (!lastState || lastState.finished) return;
  if (lastState.turn !== myIndex) return;
  if (lastState.bitesRemaining[myIndex] <= 0) return;
  biteMode = !biteMode;
  render();
};

function settingsHtml(s) {
  if (!s) return "";
  const la = s.lookahead > 0 ? `${s.lookahead} piece${s.lookahead > 1 ? "s" : ""}` : "off";
  return (
    `<div class="row"><span>grid</span><strong>${s.size} × ${s.size}</strong></div>` +
    `<div class="row"><span>head spread</span><strong>${s.offset} from center</strong></div>` +
    `<div class="row"><span>lookahead</span><strong>${la}</strong></div>` +
    `<div class="row"><span>bites each</span><strong>3</strong></div>`
  );
}

function enterWaiting(code, settings) {
  document.getElementById("lobby").classList.add("hidden");
  document.getElementById("waiting").classList.remove("hidden");
  document.getElementById("gameInfo").classList.add("hidden");
  document.getElementById("waitCode").textContent = code;
  document.getElementById("roomCodeDisplay").innerHTML = "ROOM <span>" + code + "</span>";
  document.getElementById("waitInfo").innerHTML = settingsHtml(settings);
}
function enterGame() {
  document.getElementById("lobby").classList.add("hidden");
  document.getElementById("waiting").classList.add("hidden");
  document.getElementById("gameInfo").classList.remove("hidden");
  document.getElementById("roomCodeDisplay").innerHTML = "ROOM <span>" + myRoom + "</span>";
  document.getElementById("gameRoomInfo").innerHTML = settingsHtml(lastState.settings);
}

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
let CELL = 36;

function fitCanvas() {
  const wrap = document.querySelector(".board-wrap");
  const size = Math.min(wrap.clientWidth - 40, wrap.clientHeight - 40, 720);
  canvas.width = canvas.height = size;
  CELL = size / boardSize;
  if (lastState) render();
}
window.addEventListener("resize", fitCanvas);

function getCSS(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function colorFor(playerNum) {
  if (playerNum === 1) return getCSS("--p1");
  if (playerNum === 2) return getCSS("--p2");
  return null;
}
function glowFor(playerNum) {
  if (playerNum === 1) return getCSS("--p1-glow");
  if (playerNum === 2) return getCSS("--p2-glow");
  return null;
}

function render() {
  if (!lastState) return;
  const { board, turn, nextPiece, finished, heads, threats } = lastState;

  ctx.fillStyle = getCSS("--board-bg");
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = getCSS("--grid-strong");
  ctx.lineWidth = 1;
  for (let i = 0; i <= boardSize; i++) {
    ctx.beginPath(); ctx.moveTo(i*CELL, 0); ctx.lineTo(i*CELL, boardSize*CELL); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i*CELL); ctx.lineTo(boardSize*CELL, i*CELL); ctx.stroke();
  }

  // Cells (skipping head positions — heads draw on top)
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const v = board[y][x];
      if (v === 0) continue;
      if (heads && heads.some(h => h.x === x && h.y === y)) continue; // head drawn separately
      drawCell(x, y, v);
    }
  }

  // Heads
  if (heads) {
    for (let i = 0; i < heads.length; i++) {
      drawHead(heads[i], threats ? threats[i] : 0);
    }
  }

  // Hover preview
  if (!finished && turn === myIndex && hover.x >= 0) {
    if (biteMode) {
      drawBitePreview(hover.x, hover.y);
    } else if (nextPiece[myIndex]) {
      const shape = rotate(SHAPES[nextPiece[myIndex]], rotation);
      const cells = shape.map(([dx, dy]) => [hover.x + dx, hover.y + dy]);
      const valid = checkValidPlacement(cells, myIndex + 1, board, heads);
      for (const [x, y] of cells) {
        if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) continue;
        const color = valid ? colorFor(myIndex + 1) : getCSS("--warn");
        drawCellGhost(x, y, color);
      }
    }
  }

  updateSidebar();
  updateLog();
  updateGameOver();
  updateBiteButton();
}

function drawCell(x, y, playerNum) {
  const px = x * CELL;
  const py = y * CELL;
  const color = colorFor(playerNum);
  const glow = glowFor(playerNum);
  ctx.shadowColor = glow;
  ctx.shadowBlur = CELL * 0.35;
  ctx.fillStyle = color;
  ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
  ctx.shadowBlur = 0;
  ctx.fillStyle = glow;
  ctx.globalAlpha = 0.3;
  ctx.fillRect(px + 2, py + 2, CELL - 4, Math.max(2, CELL * 0.12));
  ctx.globalAlpha = 1;
}

// The fungal-eye head — distinct from regular cells.
function drawHead(head, threatLevel) {
  const px = head.x * CELL;
  const py = head.y * CELL;
  const cx = px + CELL / 2;
  const cy = py + CELL / 2;
  const r = CELL * 0.5;
  const color = colorFor(head.playerNum);
  const glow = glowFor(head.playerNum);

  // Threat pulse: when threatened, a red halo grows/shrinks
  if (threatLevel >= 2) {
    const pulse = 0.5 + 0.5 * Math.sin(pulseT * 0.012);
    ctx.shadowColor = getCSS("--warn-glow");
    ctx.shadowBlur = CELL * (0.6 + pulse * 0.6);
    ctx.fillStyle = getCSS("--warn");
    ctx.globalAlpha = 0.3 + pulse * 0.3;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Outer body — a slightly oversized colored disc
  ctx.shadowColor = glow;
  ctx.shadowBlur = CELL * 0.5;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
  ctx.fill();

  // Inner darker ring (the "iris")
  ctx.shadowBlur = 0;
  ctx.fillStyle = getCSS("--bg-deep");
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
  ctx.fill();

  // Glowing pupil — animates with subtle breathing
  const breath = 0.85 + 0.15 * Math.sin(pulseT * 0.005);
  ctx.shadowColor = glow;
  ctx.shadowBlur = CELL * 0.35;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.22 * breath, 0, Math.PI * 2);
  ctx.fill();

  // Vertical slit to suggest a sinister mushroom-eye
  ctx.shadowBlur = 0;
  ctx.fillStyle = getCSS("--bg-deep");
  ctx.fillRect(cx - r * 0.04, cy - r * 0.18, r * 0.08, r * 0.36);

  // Spore-flecks around the head (4 small dots at NE, NW, SE, SW)
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.7;
  const fleckR = r * 0.08;
  for (const [dx, dy] of [[-0.55,-0.55],[0.55,-0.55],[-0.55,0.55],[0.55,0.55]]) {
    ctx.beginPath();
    ctx.arc(cx + r * dx, cy + r * dy, fleckR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function drawCellGhost(x, y, color) {
  const px = x * CELL;
  const py = y * CELL;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.95;
  ctx.strokeRect(px + 3, py + 3, CELL - 6, CELL - 6);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.25;
  ctx.fillRect(px + 3, py + 3, CELL - 6, CELL - 6);
  ctx.globalAlpha = 1;
}

function drawBitePreview(x, y) {
  if (!lastState) return;
  if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) return;
  const valid = checkValidBite(x, y, myIndex + 1, lastState.board, lastState.heads);
  const px = x * CELL;
  const py = y * CELL;

  if (valid) {
    // Pulsing red overlay on the targeted enemy cell
    const pulse = 0.5 + 0.5 * Math.sin(pulseT * 0.012);
    ctx.fillStyle = getCSS("--warn");
    ctx.globalAlpha = 0.4 + pulse * 0.3;
    ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
    ctx.shadowColor = getCSS("--warn-glow");
    ctx.shadowBlur = CELL * 0.4;
    ctx.strokeStyle = getCSS("--warn-glow");
    ctx.lineWidth = 3;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    // Bite-mark slash
    ctx.moveTo(px + 6, py + 6);
    ctx.lineTo(px + CELL - 6, py + CELL - 6);
    ctx.moveTo(px + CELL - 6, py + 6);
    ctx.lineTo(px + 6, py + CELL - 6);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  } else {
    // Subtle "no" indicator
    ctx.strokeStyle = getCSS("--text-dim");
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.strokeRect(px + 4, py + 4, CELL - 8, CELL - 8);
    ctx.globalAlpha = 1;
  }
}

function checkValidPlacement(cells, playerNum, board, heads) {
  for (const [x, y] of cells) {
    if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) return false;
    if (board[y][x] !== 0) return false;
    if (heads && heads.some(h => h.x === x && h.y === y)) return false;
  }
  let touches = false;
  for (const [x, y] of cells) {
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize
          && board[ny][nx] === playerNum) {
        touches = true;
      }
    }
  }
  return touches;
}

function checkValidBite(x, y, playerNum, board, heads) {
  if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) return false;
  if (heads && heads.some(h => h.x === x && h.y === y)) return false;
  const enemy = playerNum === 1 ? 2 : 1;
  // Must be an enemy cell
  if (board[y][x] !== enemy) return false;
  // Must be adjacent to one of mine
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize
        && board[ny][nx] === playerNum) return true;
  }
  return false;
}

function pieceSvg(pieceType, w, h, color, padding = 2) {
  const shape = rotate(SHAPES[pieceType], 0);
  const sw = Math.max(...shape.map(([x])=>x)) + 1;
  const sh = Math.max(...shape.map(([,y])=>y)) + 1;
  const size = Math.min((w - padding*2) / sw, (h - padding*2) / sh);
  const ox = (w - sw * size) / 2;
  const oy = (h - sh * size) / 2;
  return shape.map(([x, y]) =>
    `<rect x="${ox + x*size + 1}" y="${oy + y*size + 1}" width="${size-2}" height="${size-2}" fill="${color}" opacity="0.9"/>`
  ).join("");
}

function updateSidebar() {
  const cards = document.getElementById("playerCards");
  cards.innerHTML = "";
  lastState.names.forEach((name, i) => {
    const card = document.createElement("div");
    card.className = "player-card p" + (i + 1);
    if (lastState.turn === i && !lastState.finished) card.classList.add("active");
    if (lastState.threats && lastState.threats[i] >= 2 && !lastState.finished) {
      card.classList.add("threatened");
    }
    const youTag = i === myIndex ? " <span style='color:var(--text-dim);font-size:10px;'>(YOU)</span>" : "";
    const threatTag = (lastState.threats && lastState.threats[i] >= 2 && !lastState.finished)
      ? " <span class='threat-tag'>HEAD AT RISK</span>" : "";
    const pips = (lastState.bitesRemaining || [3,3])[i];
    const bitePips = Array.from({length: 3}, (_, k) =>
      `<span class="bite-pip${k < pips ? '' : ' spent'}"></span>`
    ).join("");
    card.innerHTML =
      `<div class='name'>${escapeHtml(name)}${youTag}${threatTag}</div>` +
      `<div class='stat'>cells <strong>${lastState.counts[i]}</strong></div>` +
      `<div class='bites-row'><span class='label'>BITES</span>${bitePips}</div>`;
    cards.appendChild(card);
  });

  // Current piece preview
  const svg = document.getElementById("pieceSvg");
  const pieceLabel = document.getElementById("pieceLabel");
  const pieceHint = document.getElementById("pieceHint");
  const myPiece = lastState.nextPiece[myIndex];

  if (biteMode) {
    pieceLabel.textContent = "BITE MODE";
    pieceLabel.style.color = "var(--warn)";
    svg.innerHTML = `
      <g transform="translate(70, 40)">
        <rect x="-14" y="-14" width="28" height="28" fill="none" stroke="var(--warn)" stroke-width="2"/>
        <line x1="-10" y1="-10" x2="10" y2="10" stroke="var(--warn)" stroke-width="2"/>
        <line x1="10" y1="-10" x2="-10" y2="10" stroke="var(--warn)" stroke-width="2"/>
      </g>`;
    pieceHint.innerHTML = "Click an enemy cell touching your colony.<br/>Disconnected enemy cells will die.<br/>Click <kbd>BITE</kbd> again to cancel.";
  } else if (myPiece) {
    pieceLabel.textContent = "YOUR NEXT SPORE";
    pieceLabel.style.color = "var(--text-dim)";
    const shape = rotate(SHAPES[myPiece], rotation);
    const w = Math.max(...shape.map(([x])=>x)) + 1;
    const h = Math.max(...shape.map(([,y])=>y)) + 1;
    const size = Math.min(140 / w, 80 / h);
    const ox = (140 - w * size) / 2;
    const oy = (80 - h * size) / 2;
    const color = myIndex === 0 ? "var(--p1)" : "var(--p2)";
    svg.innerHTML = shape.map(([x, y]) =>
      `<rect x="${ox + x*size + 2}" y="${oy + y*size + 2}" width="${size-4}" height="${size-4}" fill="${color}" opacity="0.9"/>`
    ).join("");
    pieceHint.innerHTML = "<kbd>R</kbd> rotate &nbsp;·&nbsp; <kbd>Click</kbd> place";
  }

  // Upcoming pieces
  const upDisplay = document.getElementById("upcomingDisplay");
  const upRow = document.getElementById("upcomingRow");
  if (lastState.upcoming && lastState.upcoming.length > 0) {
    upDisplay.classList.remove("hidden");
    const color = myIndex === 0 ? "var(--p1)" : "var(--p2)";
    const items = lastState.upcoming.map((p, i) => {
      return `<svg viewBox="0 0 44 28">${pieceSvg(p, 44, 28, color)}</svg>` +
             (i < lastState.upcoming.length - 1 ? '<span class="arrow">›</span>' : '');
    });
    upRow.innerHTML = items.join("");
  } else {
    upDisplay.classList.add("hidden");
  }

  // Status text
  const status = document.getElementById("boardStatus");
  if (lastState.finished) {
    status.textContent = "";
    status.classList.remove("bite-mode");
  } else if (lastState.turn === myIndex) {
    if (biteMode) {
      status.textContent = "// BITE MODE — click an enemy cell adjacent to your colony";
      status.classList.add("bite-mode");
    } else {
      status.textContent = "// your move";
      status.classList.remove("bite-mode");
      status.style.color = myIndex === 0 ? "var(--p1)" : "var(--p2)";
    }
  } else {
    status.textContent = "// awaiting opponent";
    status.classList.remove("bite-mode");
    status.style.color = "var(--text-dim)";
  }

  // Canvas cursor
  if (biteMode) canvas.classList.add("bite-mode");
  else canvas.classList.remove("bite-mode");
}

function updateBiteButton() {
  const btn = document.getElementById("biteBtn");
  if (!lastState) return;
  const remaining = (lastState.bitesRemaining || [3,3])[myIndex];
  btn.textContent = `BITE (${remaining})`;
  const myTurn = lastState.turn === myIndex && !lastState.finished;
  btn.disabled = !myTurn || remaining <= 0;
  btn.classList.toggle("active", biteMode);
}

function updateLog() {
  const list = document.getElementById("logList");
  list.innerHTML = "";
  if (!lastState.moveLog) return;
  lastState.moveLog.slice().reverse().forEach((entry, i) => {
    const turnNum = lastState.moveLog.length - i;
    const div = document.createElement("div");
    div.className = "log-entry p" + (entry.player + 1);
    const playerName = lastState.names[entry.player] || ("P" + (entry.player + 1));
    const turnTag = `<span class="turn-num">${String(turnNum).padStart(3,"0")}</span>`;
    const who = `<span class="who">${escapeHtml(playerName)}</span>`;
    if (entry.skipped) {
      div.innerHTML = `${turnTag} · ${who} skipped — no legal action`;
    } else if (entry.bite) {
      const killText = entry.killed > 0
        ? ` · <span class="flip">${entry.killed} killed</span>` : "";
      div.innerHTML = `${turnTag} · ${who} <span class="bite-tag">▼ BIT</span> @ ${entry.x},${entry.y}${killText}`;
    } else {
      const flipText = entry.flipped > 0
        ? ` · <span class="flip">+${entry.flipped} flipped</span>` : "";
      const convText = entry.converted > 0
        ? ` · <span class="flip">+${entry.converted} absorbed</span>` : "";
      div.innerHTML = `${turnTag} · ${who} placed ${entry.piece} @ ${entry.x},${entry.y}${flipText}${convText}`;
    }
    list.appendChild(div);
  });
}

function updateGameOver() {
  const go = document.getElementById("gameOver");
  if (!lastState.finished) {
    go.classList.add("hidden");
    return;
  }
  go.classList.remove("hidden");
  const title = document.getElementById("goTitle");
  const sub = document.getElementById("goSub");
  const reason = lastState.endReason;

  if (lastState.winner === -1) {
    title.textContent = "STALEMATE";
    title.style.color = "var(--text)";
    sub.textContent = "the colonies are deadlocked";
  } else if (lastState.winner === myIndex) {
    if (reason === "head_captured") {
      title.textContent = "HEAD TAKEN";
      title.style.color = myIndex === 0 ? "var(--p1)" : "var(--p2)";
      sub.textContent = "you flanked the enemy head";
    } else if (reason === "forfeit") {
      title.textContent = "VICTORY";
      title.style.color = myIndex === 0 ? "var(--p1)" : "var(--p2)";
      sub.textContent = "your opponent disconnected";
    } else {
      title.textContent = "VICTORY";
      title.style.color = myIndex === 0 ? "var(--p1)" : "var(--p2)";
      sub.textContent = "your colony has dominated the substrate";
    }
  } else {
    if (reason === "head_captured") {
      title.textContent = "HEAD CONSUMED";
      title.style.color = "var(--warn)";
      sub.textContent = "your head has been flanked";
    } else {
      title.textContent = "CONSUMED";
      title.style.color = "var(--warn)";
      sub.textContent = "your spores have been engulfed";
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// Continuous render loop for head pulsing/breathing animation
function tick() {
  pulseT = performance.now();
  if (lastState && !lastState.finished) {
    // Re-render only the heads/threats; just call render() since canvas is small
    render();
  }
  pulseAnim = requestAnimationFrame(tick);
}
// Start animation loop only once we have state
function startTickIfNeeded() {
  if (pulseAnim == null) tick();
}

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / CELL);
  const y = Math.floor((e.clientY - rect.top) / CELL);
  if (x !== hover.x || y !== hover.y) {
    hover = { x, y };
  }
});
canvas.addEventListener("mouseleave", () => { hover = { x: -1, y: -1 }; });
canvas.addEventListener("click", () => {
  if (!lastState || lastState.finished) return;
  if (lastState.turn !== myIndex) return;
  if (hover.x < 0) return;
  if (biteMode) {
    send({ type: "bite", x: hover.x, y: hover.y });
    biteMode = false;
  } else {
    const piece = lastState.nextPiece[myIndex];
    send({ type: "move", piece, x: hover.x, y: hover.y, rotation });
  }
});
window.addEventListener("keydown", (e) => {
  if (e.key === "r" || e.key === "R") {
    rotation = (rotation + 1) % 4;
  }
  if (e.key === "b" || e.key === "B") {
    document.getElementById("biteBtn").click();
  }
  if (e.key === "Escape" && biteMode) {
    biteMode = false;
  }
});

let touchStart = null;
canvas.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) {
    rotation = (rotation + 1) % 4;
    e.preventDefault();
    return;
  }
  touchStart = e.touches[0];
});
canvas.addEventListener("touchend", (e) => {
  if (!touchStart) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((touchStart.clientX - rect.left) / CELL);
  const y = Math.floor((touchStart.clientY - rect.top) / CELL);
  hover = { x, y };
  if (lastState && !lastState.finished && lastState.turn === myIndex) {
    if (biteMode) {
      send({ type: "bite", x, y });
      biteMode = false;
    } else {
      const piece = lastState.nextPiece[myIndex];
      send({ type: "move", piece, x, y, rotation });
    }
  }
  touchStart = null;
});

fitCanvas();
startTickIfNeeded();
</script>
</body>
</html>
