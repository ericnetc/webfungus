// NetFungus on Cloudflare Workers + Durable Objects
//
// Architecture:
//   - The Worker (default export) routes incoming requests:
//       /          -> serves index.html (via [assets] binding)
//       /ws        -> upgrades to WebSocket and forwards to the Room DO
//   - Each room is a Durable Object instance. Holds game state in memory while
//     active and persists to its built-in SQLite storage so it survives hibernation.

import { DurableObject } from "cloudflare:workers";

// ---- Configuration ranges ----
const MIN_BOARD = 8, MAX_BOARD = 24, DEFAULT_BOARD = 16;
// Offset is from the *center* of the board now.
// offset=1 means heads are 1 cell from center on each side (very close).
// offset=4 means heads are 4 cells from center on each side (far apart).
const MIN_OFFSET = 1, MAX_OFFSET = 8, DEFAULT_OFFSET = 3;
const VALID_LOOKAHEAD = [0, 1, 3, 5];
const DEFAULT_LOOKAHEAD = 0;
const STARTING_BITES = 3;

// ---- Tetromino shapes ----
const SHAPES = {
  I: [[0, 0], [1, 0], [2, 0], [3, 0]],
  O: [[0, 0], [1, 0], [0, 1], [1, 1]],
  T: [[0, 0], [1, 0], [2, 0], [1, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};

function rotate(cells, times) {
  let out = cells.map(([x, y]) => [x, y]);
  for (let i = 0; i < ((times % 4) + 4) % 4; i++) {
    out = out.map(([x, y]) => [-y, x]);
  }
  const minX = Math.min(...out.map(([x]) => x));
  const minY = Math.min(...out.map(([, y]) => y));
  return out.map(([x, y]) => [x - minX, y - minY]);
}

function makeBag() {
  const types = Object.keys(SHAPES);
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }
  return types;
}

function topUpBag(bag, minCount) {
  while (bag.length < minCount) {
    bag.push(...makeBag());
  }
  return bag;
}

function inBounds(x, y, size) {
  return x >= 0 && x < size && y >= 0 && y < size;
}

function validatePlacement(board, cells, playerNum, size) {
  for (const [x, y] of cells) {
    if (!inBounds(x, y, size)) return { ok: false, reason: "out of bounds" };
    if (board[y][x] !== 0) return { ok: false, reason: "cell occupied" };
  }
  let touchesOwn = false;
  for (const [x, y] of cells) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny, size) && board[ny][nx] === playerNum) {
        touchesOwn = true;
        break;
      }
    }
    if (touchesOwn) break;
  }
  if (!touchesOwn) return { ok: false, reason: "must connect to your colony" };
  return { ok: true };
}

// Bite validation: single cell, must be empty, must be 4-adjacent to one of your cells.
function validateBite(board, x, y, playerNum, size) {
  if (!inBounds(x, y, size)) return { ok: false, reason: "out of bounds" };
  if (board[y][x] !== 0) return { ok: false, reason: "cell occupied" };
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (inBounds(nx, ny, size) && board[ny][nx] === playerNum) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "bite must touch your colony" };
}

// Reversi-style flip from each placed cell, in 8 directions.
// IMPORTANT: heads are immune. We pass `headPositions` and skip flipping any cell
// whose coords match a head.
function applyFlips(board, placedCells, playerNum, size, headPositions) {
  const flipped = [];
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, -1], [1, -1], [-1, 1],
  ];
  const isHead = (x, y) => headPositions.some(h => h.x === x && h.y === y);

  for (const [px, py] of placedCells) {
    for (const [dx, dy] of dirs) {
      let x = px + dx, y = py + dy;
      const line = [];
      let hitHead = false;
      while (inBounds(x, y, size) && board[y][x] !== 0 && board[y][x] !== playerNum) {
        if (isHead(x, y)) {
          // Head blocks the bracket — neither flips nor counts as the closer.
          hitHead = true;
          break;
        }
        line.push([x, y]);
        x += dx;
        y += dy;
      }
      if (!hitHead && line.length > 0 && inBounds(x, y, size) && board[y][x] === playerNum) {
        for (const [fx, fy] of line) {
          board[fy][fx] = playerNum;
          flipped.push([fx, fy]);
        }
      }
    }
  }
  return flipped;
}

// Check whether a head is captured: both N+S neighbors enemy, OR both E+W neighbors enemy.
// "Enemy" means an enemy-colored cell present at that adjacent square.
// Empty squares and friendly squares (including the head's own colony) do NOT count as enemy.
function isHeadCaptured(board, head, size) {
  const owner = head.playerNum;
  const enemy = owner === 1 ? 2 : 1;
  const at = (dx, dy) => {
    const x = head.x + dx, y = head.y + dy;
    if (!inBounds(x, y, size)) return null;
    return board[y][x];
  };
  const ns = at(0, -1) === enemy && at(0, 1) === enemy;
  const ew = at(-1, 0) === enemy && at(1, 0) === enemy;
  return ns || ew;
}

// Threat status for visual warning: how many of the 4 axis-pairs have at least one enemy.
// Returns 0 (safe), 1 (one side of a pair has enemy), 2 (one full pair = capture),
// or counts that signal the warning state.
function headThreatLevel(board, head, size) {
  const owner = head.playerNum;
  const enemy = owner === 1 ? 2 : 1;
  const at = (dx, dy) => {
    const x = head.x + dx, y = head.y + dy;
    if (!inBounds(x, y, size)) return null;
    return board[y][x];
  };
  const n = at(0, -1) === enemy ? 1 : 0;
  const s = at(0, 1) === enemy ? 1 : 0;
  const e = at(1, 0) === enemy ? 1 : 0;
  const w = at(-1, 0) === enemy ? 1 : 0;
  // 0 = safe; 1 = some pressure; 2 = one side of either axis is fully threatened (one more = capture); 3 = captured
  if ((n && s) || (e && w)) return 3;
  // If one axis has both, captured; otherwise count enemies present
  return n + s + e + w;
}

function hasLegalMove(game, playerIdx) {
  const playerNum = playerIdx + 1;
  const pieceType = game.nextPiece[playerIdx];
  if (!pieceType) return false;
  const baseShape = SHAPES[pieceType];
  const size = game.size;
  for (let r = 0; r < 4; r++) {
    const shape = rotate(baseShape, r);
    for (let oy = 0; oy < size; oy++) {
      for (let ox = 0; ox < size; ox++) {
        const cells = shape.map(([dx, dy]) => [ox + dx, oy + dy]);
        if (validatePlacement(game.board, cells, playerNum, size).ok) return true;
      }
    }
  }
  return false;
}

function hasLegalBite(game, playerIdx) {
  if (game.bitesRemaining[playerIdx] <= 0) return false;
  const playerNum = playerIdx + 1;
  const size = game.size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (validateBite(game.board, x, y, playerNum, size).ok) return true;
    }
  }
  return false;
}

function countCells(board, playerNum, size) {
  let n = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (board[y][x] === playerNum) n++;
  return n;
}

// Cells adjacent to head in a 5x5 area (head at center). Used for stalemate tiebreak.
function countCellsNearHead(board, head, size) {
  let n = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = head.x + dx, y = head.y + dy;
      if (!inBounds(x, y, size)) continue;
      if (board[y][x] === head.playerNum) n++;
    }
  }
  return n;
}

function newGame(settings) {
  const { size, offset } = settings;
  const board = Array.from({ length: size }, () => Array(size).fill(0));
  // Heads placed offset-from-center on opposite sides of the diagonal.
  // For an even-sized board, "center" is between cells (size/2 - 0.5, size/2 - 0.5).
  // We anchor heads at floor(size/2) - 1 - (offset-1) and floor(size/2) + (offset-1) on both axes.
  // Equivalently: head1 at (mid - offset, mid - offset), head2 at (mid + offset - 1, mid + offset - 1)
  // where mid = floor(size/2).
  const mid = Math.floor(size / 2);
  const head1 = { x: mid - offset, y: mid - offset, playerNum: 1 };
  const head2 = { x: mid + offset - 1, y: mid + offset - 1, playerNum: 2 };
  board[head1.y][head1.x] = 1;
  board[head2.y][head2.x] = 2;

  return {
    size,
    offset,
    board,
    heads: [head1, head2],
    turn: 0,
    bags: [topUpBag([], 12), topUpBag([], 12)],
    nextPiece: [null, null],
    bitesRemaining: [STARTING_BITES, STARTING_BITES],
    moveLog: [],
    winner: null,
    finished: false,
    endReason: null, // 'head_captured' | 'stalemate' | 'forfeit'
  };
}

function dealPiece(game, playerIdx) {
  topUpBag(game.bags[playerIdx], 12);
  game.nextPiece[playerIdx] = game.bags[playerIdx].shift();
}

function clampInt(raw, lo, hi, fallback) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function validateSettings(raw) {
  const size = clampInt(raw.size, MIN_BOARD, MAX_BOARD, DEFAULT_BOARD);
  let offset = clampInt(raw.offset, MIN_OFFSET, MAX_OFFSET, DEFAULT_OFFSET);
  // Cap offset so heads stay on the board
  const maxOffsetForSize = Math.floor(size / 2);
  offset = Math.min(offset, maxOffsetForSize);
  let lookahead = parseInt(raw.lookahead, 10);
  if (!VALID_LOOKAHEAD.includes(lookahead)) lookahead = DEFAULT_LOOKAHEAD;
  return { size, offset, lookahead };
}

// ============================================================
// Durable Object: one instance per room
// ============================================================
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.ctx.blockConcurrencyWhile(async () => {
      this.game = (await this.ctx.storage.get("game")) || null;
      this.names = (await this.ctx.storage.get("names")) || [];
      this.started = (await this.ctx.storage.get("started")) || false;
      this.settings = (await this.ctx.storage.get("settings")) || {
        size: DEFAULT_BOARD,
        offset: DEFAULT_OFFSET,
        lookahead: DEFAULT_LOOKAHEAD,
      };
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/connect") {
      const upgrade = request.headers.get("Upgrade");
      if (!upgrade || upgrade.toLowerCase() !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const name = (url.searchParams.get("name") || "Player").slice(0, 24);
      const role = url.searchParams.get("role") || "join";

      let creatorSettings = null;
      if (role === "create") {
        creatorSettings = validateSettings({
          size: url.searchParams.get("size"),
          offset: url.searchParams.get("offset"),
          lookahead: url.searchParams.get("lookahead"),
        });
      }

      return this.handleConnect(name, role, creatorSettings);
    }
    return new Response("not found", { status: 404 });
  }

  async handleConnect(name, role, creatorSettings) {
    const sockets = this.ctx.getWebSockets();

    if (this.started && sockets.length >= 2) {
      return new Response("room full", { status: 403 });
    }
    if (role === "join" && sockets.length === 0 && !this.started) {
      return new Response("no such room", { status: 404 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    const playerIdx = sockets.length;
    server.serializeAttachment({ playerIdx, name });

    if (this.names.length <= playerIdx) {
      this.names.push(name);
    } else {
      this.names[playerIdx] = name;
    }
    await this.ctx.storage.put("names", this.names);

    if (playerIdx === 0 && creatorSettings) {
      this.settings = creatorSettings;
      await this.ctx.storage.put("settings", this.settings);
    }

    this.ctx.acceptWebSocket(server);

    if (playerIdx === 1 && !this.started) {
      this.game = newGame(this.settings);
      dealPiece(this.game, 0);
      dealPiece(this.game, 1);
      this.started = true;
      await this.ctx.storage.put("game", this.game);
      await this.ctx.storage.put("started", true);
    }

    server.send(JSON.stringify(this.publicState(playerIdx)));
    this.broadcastState();

    return new Response(null, { status: 101, webSocket: client });
  }

  publicState(perspectivePlayerIdx) {
    if (!this.started || !this.game) {
      return {
        type: "lobby",
        names: this.names,
        yourIndex: perspectivePlayerIdx,
        settings: this.settings,
      };
    }
    const lookahead = this.settings.lookahead || 0;
    const myUpcoming = (perspectivePlayerIdx != null && lookahead > 0)
      ? this.game.bags[perspectivePlayerIdx].slice(0, lookahead)
      : [];

    // Send threat levels so the client can pulse warning visuals.
    const threats = this.game.heads.map(h =>
      headThreatLevel(this.game.board, h, this.game.size)
    );

    return {
      type: "state",
      names: this.names,
      settings: this.settings,
      board: this.game.board,
      size: this.game.size,
      heads: this.game.heads,
      threats,
      turn: this.game.turn,
      nextPiece: this.game.nextPiece,
      bitesRemaining: this.game.bitesRemaining,
      upcoming: myUpcoming,
      yourIndex: perspectivePlayerIdx,
      finished: this.game.finished,
      winner: this.game.winner,
      endReason: this.game.endReason,
      counts: [
        countCells(this.game.board, 1, this.game.size),
        countCells(this.game.board, 2, this.game.size),
      ],
      moveLog: this.game.moveLog.slice(-25),
    };
  }

  broadcastState() {
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      const att = ws.deserializeAttachment();
      if (!att) continue;
      try {
        ws.send(JSON.stringify(this.publicState(att.playerIdx)));
      } catch (e) { /* dead socket */ }
    }
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const att = ws.deserializeAttachment();
    if (!att) return;
    const playerIdx = att.playerIdx;

    if (msg.type === "move") {
      const result = this.handleMove(playerIdx, msg);
      if (result.error) {
        ws.send(JSON.stringify({ type: "error", error: result.error }));
        return;
      }
      await this.ctx.storage.put("game", this.game);
      this.broadcastState();
      return;
    }

    if (msg.type === "bite") {
      const result = this.handleBite(playerIdx, msg);
      if (result.error) {
        ws.send(JSON.stringify({ type: "error", error: result.error }));
        return;
      }
      await this.ctx.storage.put("game", this.game);
      this.broadcastState();
      return;
    }

    if (msg.type === "rematch") {
      this.game = newGame(this.settings);
      dealPiece(this.game, 0);
      dealPiece(this.game, 1);
      await this.ctx.storage.put("game", this.game);
      this.broadcastState();
      return;
    }
  }

  // Shared end-of-turn logic: check head capture, check stalemate, advance turn.
  resolveEndOfTurn() {
    const g = this.game;
    // Head capture wins immediately
    for (let i = 0; i < g.heads.length; i++) {
      if (isHeadCaptured(g.board, g.heads[i], g.size)) {
        g.finished = true;
        g.endReason = "head_captured";
        g.winner = i === 0 ? 1 : 0; // the OTHER player wins
        return;
      }
    }

    // Advance turn
    g.turn = (g.turn + 1) % 2;
    dealPiece(g, g.turn);

    // Stalemate detection: both players unable to do anything (no legal piece, no legal bite)
    let safety = 0;
    while (
      !hasLegalMove(g, g.turn) &&
      !hasLegalBite(g, g.turn) &&
      safety < 2
    ) {
      g.moveLog.push({ player: g.turn, skipped: true });
      g.turn = (g.turn + 1) % 2;
      dealPiece(g, g.turn);
      safety++;
    }
    if (safety >= 2) {
      g.finished = true;
      g.endReason = "stalemate";
      // Tiebreak: cells near head (5x5)
      const near = g.heads.map(h => countCellsNearHead(g.board, h, g.size));
      if (near[0] > near[1]) g.winner = 0;
      else if (near[1] > near[0]) g.winner = 1;
      else g.winner = -1;
    }
  }

  handleMove(playerIdx, msg) {
    const g = this.game;
    if (!g || g.finished) return { error: "game not active" };
    if (g.turn !== playerIdx) return { error: "not your turn" };
    const pieceType = g.nextPiece[playerIdx];
    if (msg.piece !== pieceType) return { error: "piece mismatch" };

    const baseShape = SHAPES[pieceType];
    const shape = rotate(baseShape, msg.rotation || 0);
    const cells = shape.map(([dx, dy]) => [msg.x + dx, msg.y + dy]);
    const playerNum = playerIdx + 1;

    // Disallow placing on a head
    for (const [x, y] of cells) {
      if (g.heads.some(h => h.x === x && h.y === y)) {
        return { error: "cannot place on a head" };
      }
    }

    const v = validatePlacement(g.board, cells, playerNum, g.size);
    if (!v.ok) return { error: v.reason };

    for (const [x, y] of cells) g.board[y][x] = playerNum;
    const flipped = applyFlips(g.board, cells, playerNum, g.size, g.heads);

    g.moveLog.push({
      player: playerIdx,
      piece: pieceType,
      x: msg.x,
      y: msg.y,
      rotation: msg.rotation || 0,
      flipped: flipped.length,
    });

    this.resolveEndOfTurn();
    return { ok: true };
  }

  handleBite(playerIdx, msg) {
    const g = this.game;
    if (!g || g.finished) return { error: "game not active" };
    if (g.turn !== playerIdx) return { error: "not your turn" };
    if (g.bitesRemaining[playerIdx] <= 0) return { error: "no bites remaining" };

    const playerNum = playerIdx + 1;
    // Disallow biting a head's cell
    if (g.heads.some(h => h.x === msg.x && h.y === msg.y)) {
      return { error: "cannot bite a head" };
    }

    const v = validateBite(g.board, msg.x, msg.y, playerNum, g.size);
    if (!v.ok) return { error: v.reason };

    g.board[msg.y][msg.x] = playerNum;
    g.bitesRemaining[playerIdx]--;
    const flipped = applyFlips(g.board, [[msg.x, msg.y]], playerNum, g.size, g.heads);

    g.moveLog.push({
      player: playerIdx,
      bite: true,
      x: msg.x,
      y: msg.y,
      flipped: flipped.length,
    });

    this.resolveEndOfTurn();
    return { ok: true };
  }

  async webSocketClose(ws, code, reason, wasClean) {
    const att = ws.deserializeAttachment();
    if (this.game && !this.game.finished && att) {
      this.game.finished = true;
      this.game.endReason = "forfeit";
      this.game.winner = att.playerIdx === 0 ? 1 : 0;
      await this.ctx.storage.put("game", this.game);
      const sockets = this.ctx.getWebSockets();
      for (const other of sockets) {
        if (other !== ws) {
          try {
            other.send(JSON.stringify({
              type: "opponent_left",
              winner: this.game.winner,
            }));
          } catch (e) { /* ignore */ }
        }
      }
    }
  }

  async webSocketError(ws, error) {
    await this.webSocketClose(ws, 1011, "error", false);
  }
}

// ============================================================
// Worker
// ============================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const room = (url.searchParams.get("room") || "").toUpperCase();
      if (!/^[A-Z2-9]{4}$/.test(room)) {
        return new Response("invalid room code", { status: 400 });
      }
      const id = env.ROOM.idFromName(room);
      const stub = env.ROOM.get(id);
      const doUrl = new URL(request.url);
      doUrl.pathname = "/connect";
      return stub.fetch(doUrl.toString(), request);
    }
    return env.ASSETS.fetch(request);
  },
};
