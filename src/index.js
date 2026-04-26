// NetFungus on Cloudflare Workers + Durable Objects
//
// Architecture:
//   - The Worker (default export) routes incoming requests:
//       /          -> serves index.html (via [assets] binding)
//       /ws        -> upgrades to WebSocket and forwards to the Room DO
//   - Each room is a Durable Object instance. It holds the game state in memory
//     while active and persists it to its built-in SQLite storage so it survives
//     hibernation. WebSockets use the Hibernation API.

import { DurableObject } from "cloudflare:workers";

// Configuration ranges (validated server-side)
const MIN_BOARD = 8, MAX_BOARD = 24, DEFAULT_BOARD = 16;
const MIN_INSET = 0, MAX_INSET = 4, DEFAULT_INSET = 1;
const VALID_LOOKAHEAD = [0, 1, 3, 5];
const DEFAULT_LOOKAHEAD = 0;

// ---------- Tetromino shapes ----------
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

function applyFlips(board, placedCells, playerNum, size) {
  const flipped = [];
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, -1], [1, -1], [-1, 1],
  ];
  for (const [px, py] of placedCells) {
    for (const [dx, dy] of dirs) {
      let x = px + dx, y = py + dy;
      const line = [];
      while (inBounds(x, y, size) && board[y][x] !== 0 && board[y][x] !== playerNum) {
        line.push([x, y]);
        x += dx;
        y += dy;
      }
      if (line.length > 0 && inBounds(x, y, size) && board[y][x] === playerNum) {
        for (const [fx, fy] of line) {
          board[fy][fx] = playerNum;
          flipped.push([fx, fy]);
        }
      }
    }
  }
  return flipped;
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

function countCells(board, playerNum, size) {
  let n = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (board[y][x] === playerNum) n++;
  return n;
}

function newGame(settings) {
  const { size, inset } = settings;
  const board = Array.from({ length: size }, () => Array(size).fill(0));
  board[inset][inset] = 1;
  board[size - 1 - inset][size - 1 - inset] = 2;
  return {
    size,
    inset,
    board,
    turn: 0,
    bags: [topUpBag([], 12), topUpBag([], 12)],
    nextPiece: [null, null],
    moveLog: [],
    winner: null,
    finished: false,
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
  let inset = clampInt(raw.inset, MIN_INSET, MAX_INSET, DEFAULT_INSET);
  // Keep at least 2 cells of separation between seeds for any size
  const maxInsetForSize = Math.max(0, Math.floor((size - 2) / 2) - 1);
  inset = Math.min(inset, maxInsetForSize);
  let lookahead = parseInt(raw.lookahead, 10);
  if (!VALID_LOOKAHEAD.includes(lookahead)) lookahead = DEFAULT_LOOKAHEAD;
  return { size, inset, lookahead };
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
        inset: DEFAULT_INSET,
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
          inset: url.searchParams.get("inset"),
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

    return {
      type: "state",
      names: this.names,
      settings: this.settings,
      board: this.game.board,
      size: this.game.size,
      turn: this.game.turn,
      nextPiece: this.game.nextPiece,
      upcoming: myUpcoming,
      yourIndex: perspectivePlayerIdx,
      finished: this.game.finished,
      winner: this.game.winner,
      counts: [
        countCells(this.game.board, 1, this.game.size),
        countCells(this.game.board, 2, this.game.size),
      ],
      moveLog: this.game.moveLog.slice(-20),
    };
  }

  broadcastState() {
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      const att = ws.deserializeAttachment();
      if (!att) continue;
      try {
        ws.send(JSON.stringify(this.publicState(att.playerIdx)));
      } catch (e) {
        // dead socket; ignore
      }
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

    if (msg.type === "rematch") {
      this.game = newGame(this.settings);
      dealPiece(this.game, 0);
      dealPiece(this.game, 1);
      await this.ctx.storage.put("game", this.game);
      this.broadcastState();
      return;
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

    const v = validatePlacement(g.board, cells, playerNum, g.size);
    if (!v.ok) return { error: v.reason };

    for (const [x, y] of cells) g.board[y][x] = playerNum;
    const flipped = applyFlips(g.board, cells, playerNum, g.size);

    g.moveLog.push({
      player: playerIdx,
      piece: pieceType,
      x: msg.x,
      y: msg.y,
      rotation: msg.rotation || 0,
      flipped: flipped.length,
    });

    g.turn = (g.turn + 1) % 2;
    dealPiece(g, g.turn);

    const counts = [
      countCells(g.board, 1, g.size),
      countCells(g.board, 2, g.size),
    ];
    const alive = counts.map((c, i) => (c > 0 ? i : -1)).filter((i) => i >= 0);
    if (alive.length === 1) {
      g.finished = true;
      g.winner = alive[0];
    } else {
      let safety = 0;
      while (!hasLegalMove(g, g.turn) && safety < 2) {
        g.moveLog.push({ player: g.turn, skipped: true });
        g.turn = (g.turn + 1) % 2;
        dealPiece(g, g.turn);
        safety++;
      }
      if (safety >= 2) {
        g.finished = true;
        const max = Math.max(...counts);
        const winners = counts
          .map((c, i) => (c === max ? i : -1))
          .filter((i) => i >= 0);
        g.winner = winners.length === 1 ? winners[0] : -1;
      }
    }
    return { ok: true };
  }

  async webSocketClose(ws, code, reason, wasClean) {
    const att = ws.deserializeAttachment();
    if (this.game && !this.game.finished && att) {
      this.game.finished = true;
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
// Worker: routes HTTP requests
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
