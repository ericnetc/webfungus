// NetFungus on Cloudflare Workers + Durable Objects, v0.4
//
// Rule changes from v0.3:
//   - Captures: an enemy cell flips when 2 OPPOSITE sides (N+S or E+W) are mine.
//     Chains until stable. No "long line" Reversi flips.
//   - Bites: choose an ENEMY cell adjacent to one of yours. It becomes empty.
//   - Connectivity-to-head: every cell must have a 4-adjacent path of same-color cells
//     back to its owner's head. Cells that lose this path become empty (after a bite)
//     or yours (after a capture).
//   - Heads still cannot be flipped, captured, or bitten.

import { DurableObject } from "cloudflare:workers";

const MIN_BOARD = 8, MAX_BOARD = 24, DEFAULT_BOARD = 16;
const MIN_OFFSET = 1, MAX_OFFSET = 8, DEFAULT_OFFSET = 3;
const VALID_LOOKAHEAD = [0, 1, 3, 5];
const DEFAULT_LOOKAHEAD = 0;
const STARTING_BITES = 3;

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
  while (bag.length < minCount) bag.push(...makeBag());
  return bag;
}

function inBounds(x, y, size) {
  return x >= 0 && x < size && y >= 0 && y < size;
}

function isHeadAt(heads, x, y) {
  return heads.some(h => h.x === x && h.y === y);
}

function validatePlacement(board, cells, playerNum, size, heads) {
  for (const [x, y] of cells) {
    if (!inBounds(x, y, size)) return { ok: false, reason: "out of bounds" };
    if (board[y][x] !== 0) return { ok: false, reason: "cell occupied" };
    if (isHeadAt(heads, x, y)) return { ok: false, reason: "cannot place on a head" };
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

// Bite validates an ENEMY cell adjacent to one of mine.
function validateBite(board, x, y, playerNum, size, heads) {
  if (!inBounds(x, y, size)) return { ok: false, reason: "out of bounds" };
  if (isHeadAt(heads, x, y)) return { ok: false, reason: "cannot bite a head" };
  const enemy = playerNum === 1 ? 2 : 1;
  if (board[y][x] !== enemy) return { ok: false, reason: "must bite an enemy cell" };
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (inBounds(nx, ny, size) && board[ny][nx] === playerNum) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "bite must touch your colony" };
}

// Othello-style capture in 8 directions.
//
// The rule: find every contiguous "ray" of enemy cells (in any of 8 directions:
// N, S, E, W, NW, NE, SW, SE) that is bracketed at both ends by mine. Each cell
// on such a ray flips. A cell counts as "mine" for bracketing if it's a regular
// cell of mine or my head. Heads themselves are immune (never flip).
//
// Implementation: for each of my cells (and my head), shoot rays outward in all
// 8 directions. While the ray hits enemy cells, accumulate them. If the ray
// terminates at another of my cells (or my head) — flip the accumulated cells.
// Termination by empty cell, off-board, or enemy head means no flip on that ray.
//
// Chains: after a pass of flips, scan again. New brackets may have formed.
// Loop until stable.
function captureFlanked(board, playerNum, size, heads) {
  const enemy = playerNum === 1 ? 2 : 1;

  // Helper: at (x,y), is the cell "mine" for bracketing?
  const isMine = (x, y) => {
    if (!inBounds(x, y, size)) return false;
    if (isHeadAt(heads, x, y)) {
      return heads.find(h => h.x === x && h.y === y).playerNum === playerNum;
    }
    return board[y][x] === playerNum;
  };

  // Helper: is (x,y) a flippable enemy cell? (Enemy color, NOT a head.)
  const isFlippableEnemy = (x, y) => {
    if (!inBounds(x, y, size)) return false;
    if (isHeadAt(heads, x, y)) return false; // heads can never flip
    return board[y][x] === enemy;
  };

  const DIRS_8 = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
    [-1, -1], [1, 1], [1, -1], [-1, 1],
  ];

  const allFlipped = [];

  while (true) {
    const toFlip = new Set();

    // For every cell that's "mine" (including head), shoot 8 rays outward.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isMine(x, y)) continue;
        for (const [dx, dy] of DIRS_8) {
          const ray = [];
          let nx = x + dx, ny = y + dy;
          while (isFlippableEnemy(nx, ny)) {
            ray.push([nx, ny]);
            nx += dx;
            ny += dy;
          }
          // Did the ray terminate at another of mine?
          if (ray.length > 0 && isMine(nx, ny)) {
            for (const [rx, ry] of ray) {
              toFlip.add(`${rx},${ry}`);
            }
          }
        }
      }
    }

    if (toFlip.size === 0) break;
    for (const key of toFlip) {
      const [x, y] = key.split(",").map(Number);
      board[y][x] = playerNum;
      allFlipped.push([x, y]);
    }
  }
  return allFlipped;
}

// Find all cells of a given player that ARE connected to their head via 4-adjacency.
// Returns a Set of "x,y" strings.
function reachableFromHead(board, head, size) {
  const reached = new Set();
  const startKey = `${head.x},${head.y}`;
  reached.add(startKey);
  const stack = [[head.x, head.y]];
  while (stack.length > 0) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny, size)) continue;
      const key = `${nx},${ny}`;
      if (reached.has(key)) continue;
      if (board[ny][nx] !== head.playerNum) continue;
      reached.add(key);
      stack.push([nx, ny]);
    }
  }
  return reached;
}

// Apply orphan rule. `orphanFate`:
//   "die"     => orphans become empty (used after bites)
//   "convert" => orphans become the OTHER player's color (used after captures from placement)
// Returns { orphansP1: [[x,y]...], orphansP2: [[x,y]...] }
function processOrphans(board, heads, size, orphanFate) {
  const result = { orphansP1: [], orphansP2: [] };
  for (let p = 1; p <= 2; p++) {
    const head = heads.find(h => h.playerNum === p);
    if (!head) continue;
    const reached = reachableFromHead(board, head, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (board[y][x] !== p) continue;
        if (isHeadAt(heads, x, y)) continue; // head itself is rooted
        if (!reached.has(`${x},${y}`)) {
          if (p === 1) result.orphansP1.push([x, y]);
          else result.orphansP2.push([x, y]);
          if (orphanFate === "die") {
            board[y][x] = 0;
          } else if (orphanFate === "convert") {
            board[y][x] = p === 1 ? 2 : 1;
          }
        }
      }
    }
  }
  return result;
}

function isHeadCaptured(board, head, size) {
  const enemy = head.playerNum === 1 ? 2 : 1;
  const at = (dx, dy) => {
    const x = head.x + dx, y = head.y + dy;
    if (!inBounds(x, y, size)) return null;
    return board[y][x];
  };
  const ns = at(0, -1) === enemy && at(0, 1) === enemy;
  const ew = at(-1, 0) === enemy && at(1, 0) === enemy;
  return ns || ew;
}

function headThreatLevel(board, head, size) {
  const enemy = head.playerNum === 1 ? 2 : 1;
  const at = (dx, dy) => {
    const x = head.x + dx, y = head.y + dy;
    if (!inBounds(x, y, size)) return null;
    return board[y][x];
  };
  const n = at(0, -1) === enemy ? 1 : 0;
  const s = at(0, 1) === enemy ? 1 : 0;
  const e = at(1, 0) === enemy ? 1 : 0;
  const w = at(-1, 0) === enemy ? 1 : 0;
  if ((n && s) || (e && w)) return 3;
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
        if (validatePlacement(game.board, cells, playerNum, size, game.heads).ok) return true;
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
      if (validateBite(game.board, x, y, playerNum, size, game.heads).ok) return true;
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
  const mid = Math.floor(size / 2);
  const head1 = { x: mid - offset, y: mid - offset, playerNum: 1 };
  const head2 = { x: mid + offset - 1, y: mid + offset - 1, playerNum: 2 };
  board[head1.y][head1.x] = 1;
  board[head2.y][head2.x] = 2;
  return {
    size, offset, board,
    heads: [head1, head2],
    turn: 0,
    bags: [topUpBag([], 12), topUpBag([], 12)],
    nextPiece: [null, null],
    bitesRemaining: [STARTING_BITES, STARTING_BITES],
    moveLog: [],
    winner: null,
    finished: false,
    endReason: null,
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
  const maxOffsetForSize = Math.floor(size / 2);
  offset = Math.min(offset, maxOffsetForSize);
  let lookahead = parseInt(raw.lookahead, 10);
  if (!VALID_LOOKAHEAD.includes(lookahead)) lookahead = DEFAULT_LOOKAHEAD;
  return { size, offset, lookahead };
}

// ============================================================
// Durable Object
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
        size: DEFAULT_BOARD, offset: DEFAULT_OFFSET, lookahead: DEFAULT_LOOKAHEAD,
      };
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/connect") {
      const upgrade = request.headers.get("Upgrade");
      if (!upgrade || upgrade.toLowerCase() !== "websocket")
        return new Response("expected websocket", { status: 426 });
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
    if (this.started && sockets.length >= 2) return new Response("room full", { status: 403 });
    if (role === "join" && sockets.length === 0 && !this.started)
      return new Response("no such room", { status: 404 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const playerIdx = sockets.length;
    server.serializeAttachment({ playerIdx, name });

    if (this.names.length <= playerIdx) this.names.push(name);
    else this.names[playerIdx] = name;
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
    const threats = this.game.heads.map(h => headThreatLevel(this.game.board, h, this.game.size));
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
      try { ws.send(JSON.stringify(this.publicState(att.playerIdx))); }
      catch (e) { /* dead socket */ }
    }
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const att = ws.deserializeAttachment();
    if (!att) return;
    const playerIdx = att.playerIdx;

    if (msg.type === "move") {
      const r = this.handleMove(playerIdx, msg);
      if (r.error) { ws.send(JSON.stringify({ type: "error", error: r.error })); return; }
      await this.ctx.storage.put("game", this.game);
      this.broadcastState();
      return;
    }
    if (msg.type === "bite") {
      const r = this.handleBite(playerIdx, msg);
      if (r.error) { ws.send(JSON.stringify({ type: "error", error: r.error })); return; }
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

  resolveEndOfTurn() {
    const g = this.game;
    for (let i = 0; i < g.heads.length; i++) {
      if (isHeadCaptured(g.board, g.heads[i], g.size)) {
        g.finished = true;
        g.endReason = "head_captured";
        g.winner = i === 0 ? 1 : 0;
        return;
      }
    }
    g.turn = (g.turn + 1) % 2;
    dealPiece(g, g.turn);
    let safety = 0;
    while (!hasLegalMove(g, g.turn) && !hasLegalBite(g, g.turn) && safety < 2) {
      g.moveLog.push({ player: g.turn, skipped: true });
      g.turn = (g.turn + 1) % 2;
      dealPiece(g, g.turn);
      safety++;
    }
    if (safety >= 2) {
      g.finished = true;
      g.endReason = "stalemate";
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

    const v = validatePlacement(g.board, cells, playerNum, g.size, g.heads);
    if (!v.ok) return { error: v.reason };

    // 1) Place piece
    for (const [x, y] of cells) g.board[y][x] = playerNum;

    // 2) Capture chain (opposite-side flanks, until stable)
    const flipped = captureFlanked(g.board, playerNum, g.size, g.heads);

    // 3) Orphan check — convert orphaned enemy cells to mine
    const { orphansP1, orphansP2 } = processOrphans(g.board, g.heads, g.size, "convert");
    const converted = playerNum === 1 ? orphansP2.length : orphansP1.length;

    g.moveLog.push({
      player: playerIdx,
      piece: pieceType,
      x: msg.x,
      y: msg.y,
      rotation: msg.rotation || 0,
      flipped: flipped.length,
      converted,
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
    const v = validateBite(g.board, msg.x, msg.y, playerNum, g.size, g.heads);
    if (!v.ok) return { error: v.reason };

    // 1) Remove the bitten cell
    g.board[msg.y][msg.x] = 0;
    g.bitesRemaining[playerIdx]--;

    // 2) Orphan check — orphaned cells DIE (become empty)
    const { orphansP1, orphansP2 } = processOrphans(g.board, g.heads, g.size, "die");
    const killed = playerNum === 1 ? orphansP2.length : orphansP1.length;

    g.moveLog.push({
      player: playerIdx,
      bite: true,
      x: msg.x,
      y: msg.y,
      killed,
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
          try { other.send(JSON.stringify({ type: "opponent_left", winner: this.game.winner })); }
          catch (e) {}
        }
      }
    }
  }
  async webSocketError(ws) { await this.webSocketClose(ws, 1011, "error", false); }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const room = (url.searchParams.get("room") || "").toUpperCase();
      if (!/^[A-Z2-9]{4}$/.test(room)) return new Response("invalid room code", { status: 400 });
      const id = env.ROOM.idFromName(room);
      const stub = env.ROOM.get(id);
      const doUrl = new URL(request.url);
      doUrl.pathname = "/connect";
      return stub.fetch(doUrl.toString(), request);
    }
    return env.ASSETS.fetch(request);
  },
};
