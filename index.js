// NetFungus on Cloudflare Workers + Durable Objects
//
// Architecture:
//   - The Worker (default export) routes incoming requests:
//       /          -> serves index.html
//       /ws?room=X -> upgrades to WebSocket and forwards to the Room DO
//       /new       -> creates a new room code and redirects
//   - Each room is a Durable Object instance. It holds the game state in memory
//     while active and persists it to its built-in SQLite storage so it survives
//     hibernation. WebSockets use the Hibernation API so we don't pay for idle time.
//
// The static client (public/index.html) is served via the [assets] binding
// configured in wrangler.jsonc.

import { DurableObject } from "cloudflare:workers";

const BOARD_SIZE = 16;

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

function inBounds(x, y) {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

function validatePlacement(board, cells, playerNum) {
  for (const [x, y] of cells) {
    if (!inBounds(x, y)) return { ok: false, reason: "out of bounds" };
    if (board[y][x] !== 0) return { ok: false, reason: "cell occupied" };
  }
  let touchesOwn = false;
  for (const [x, y] of cells) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && board[ny][nx] === playerNum) {
        touchesOwn = true;
        break;
      }
    }
    if (touchesOwn) break;
  }
  if (!touchesOwn) return { ok: false, reason: "must connect to your colony" };
  return { ok: true };
}

function applyFlips(board, placedCells, playerNum) {
  const flipped = [];
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, -1], [1, -1], [-1, 1],
  ];
  for (const [px, py] of placedCells) {
    for (const [dx, dy] of dirs) {
      let x = px + dx, y = py + dy;
      const line = [];
      while (inBounds(x, y) && board[y][x] !== 0 && board[y][x] !== playerNum) {
        line.push([x, y]);
        x += dx;
        y += dy;
      }
      if (line.length > 0 && inBounds(x, y) && board[y][x] === playerNum) {
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
  for (let r = 0; r < 4; r++) {
    const shape = rotate(baseShape, r);
    for (let oy = 0; oy < BOARD_SIZE; oy++) {
      for (let ox = 0; ox < BOARD_SIZE; ox++) {
        const cells = shape.map(([dx, dy]) => [ox + dx, oy + dy]);
        if (validatePlacement(game.board, cells, playerNum).ok) return true;
      }
    }
  }
  return false;
}

function countCells(board, playerNum) {
  let n = 0;
  for (let y = 0; y < BOARD_SIZE; y++)
    for (let x = 0; x < BOARD_SIZE; x++)
      if (board[y][x] === playerNum) n++;
  return n;
}

function newGame() {
  const board = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(0)
  );
  // Seed two players in opposite corners
  board[1][1] = 1;
  board[BOARD_SIZE - 2][BOARD_SIZE - 2] = 2;
  return {
    board,
    turn: 0,
    bags: [makeBag(), makeBag()],
    nextPiece: [null, null],
    moveLog: [],
    winner: null,
    finished: false,
  };
}

function dealPiece(game, playerIdx) {
  if (game.bags[playerIdx].length === 0) {
    game.bags[playerIdx] = makeBag();
  }
  game.nextPiece[playerIdx] = game.bags[playerIdx].shift();
}

// ============================================================
// Durable Object: one instance per room
// ============================================================
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    // Restore state from storage if hibernating-and-waking
    this.ctx.blockConcurrencyWhile(async () => {
      this.game = (await this.ctx.storage.get("game")) || null;
      this.names = (await this.ctx.storage.get("names")) || [];
      this.started = (await this.ctx.storage.get("started")) || false;
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/connect") {
      const upgrade = request.headers.get("Upgrade");
      if (!upgrade || upgrade.toLowerCase() !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const name = url.searchParams.get("name") || "Player";
      const role = url.searchParams.get("role") || "join"; // 'create' or 'join'
      return this.handleConnect(name, role);
    }
    return new Response("not found", { status: 404 });
  }

  async handleConnect(name, role) {
    // Get currently connected sockets via the Hibernation API
    const sockets = this.ctx.getWebSockets();

    if (this.started && sockets.length >= 2) {
      return new Response("room full", { status: 403 });
    }
    if (role === "join" && sockets.length === 0 && !this.started) {
      // Joining an empty room that was never created — disallow
      // (the first connection should be 'create')
      return new Response("no such room", { status: 404 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Determine player index
    const playerIdx = sockets.length; // 0 or 1
    server.serializeAttachment({ playerIdx, name });

    // Track in our names array for state broadcasts
    if (this.names.length <= playerIdx) {
      this.names.push(name);
    } else {
      this.names[playerIdx] = name;
    }
    await this.ctx.storage.put("names", this.names);

    // Accept with hibernation
    this.ctx.acceptWebSocket(server);

    // If this is the second player, start the game
    if (playerIdx === 1 && !this.started) {
      this.game = newGame();
      dealPiece(this.game, 0);
      dealPiece(this.game, 1);
      this.started = true;
      await this.ctx.storage.put("game", this.game);
      await this.ctx.storage.put("started", true);
    }

    // Send initial state
    server.send(JSON.stringify(this.publicState(playerIdx)));
    // Notify other players too
    this.broadcastState();

    return new Response(null, { status: 101, webSocket: client });
  }

  publicState(perspectivePlayerIdx) {
    if (!this.started || !this.game) {
      return {
        type: "lobby",
        names: this.names,
        yourIndex: perspectivePlayerIdx,
      };
    }
    return {
      type: "state",
      names: this.names,
      board: this.game.board,
      turn: this.game.turn,
      nextPiece: this.game.nextPiece,
      yourIndex: perspectivePlayerIdx,
      finished: this.game.finished,
      winner: this.game.winner,
      counts: [
        countCells(this.game.board, 1),
        countCells(this.game.board, 2),
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
        // Socket dead; ignore
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
      this.game = newGame();
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

    const v = validatePlacement(g.board, cells, playerNum);
    if (!v.ok) return { error: v.reason };

    for (const [x, y] of cells) g.board[y][x] = playerNum;
    const flipped = applyFlips(g.board, cells, playerNum);

    g.moveLog.push({
      player: playerIdx,
      piece: pieceType,
      x: msg.x,
      y: msg.y,
      rotation: msg.rotation || 0,
      flipped: flipped.length,
    });

    // Advance turn
    g.turn = (g.turn + 1) % 2;
    dealPiece(g, g.turn);

    // End conditions
    const counts = [
      countCells(g.board, 1),
      countCells(g.board, 2),
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
      // Notify any remaining sockets
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
    // Same as close
    await this.webSocketClose(ws, 1011, "error", false);
  }
}

// ============================================================
// Worker: routes HTTP requests
// ============================================================
function makeRoomCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // WebSocket connection: /ws?room=XXXX&name=...&role=create|join
    if (url.pathname === "/ws") {
      const room = (url.searchParams.get("room") || "").toUpperCase();
      if (!/^[A-Z2-9]{4}$/.test(room)) {
        return new Response("invalid room code", { status: 400 });
      }
      const id = env.ROOM.idFromName(room);
      const stub = env.ROOM.get(id);
      // Forward to the DO
      const doUrl = new URL(request.url);
      doUrl.pathname = "/connect";
      return stub.fetch(doUrl.toString(), request);
    }

    // Generate a fresh code: GET /new -> { code }
    if (url.pathname === "/new") {
      // The client picks a code locally; this endpoint just returns one for convenience
      return Response.json({ code: makeRoomCode() });
    }

    // Otherwise, serve static assets
    return env.ASSETS.fetch(request);
  },
};
