// WebFungus — turn-based colony battle on Cloudflare Workers + Durable Objects.
//
// 2-4 players, any mix of humans and bots. The host configures 4 slots before
// the game starts: each slot can be human, easy/moderate/hard bot, or empty.
// The first connection becomes the host (player 0). Subsequent connections
// claim open human slots in order. The host clicks Start when all human slots
// are filled; bots are then "spawned" internally and the game begins.
//
// Architecture:
//   - The Worker (default export) routes incoming requests:
//       /          -> static client (via [assets] binding)
//       /ws        -> WebSocket upgrade, forwarded to the Room DO
//   - Each room is a Durable Object instance. Game state in memory while
//     active; persists to built-in SQLite storage so it survives hibernation.
//   - Bots live entirely server-side. On a bot's turn, the DO computes a move
//     and applies it without any external WebSocket. After applying, it
//     broadcasts the new state with a small artificial delay so animations
//     play out for human observers.

import { DurableObject } from "cloudflare:workers";

// --- Configuration ranges ---
const MIN_BOARD = 8, MAX_BOARD = 24, DEFAULT_BOARD = 20;
const MIN_OFFSET = 1, MAX_OFFSET = 8, DEFAULT_OFFSET = 6;
const STARTING_BITES = 3;
const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const VALID_LOOKAHEAD = [0, 1, 3, 5];
const DEFAULT_LOOKAHEAD = 3;
const SLOT_TYPES = ["human", "easy", "moderate", "hard", "empty"];
const BOT_TYPES = new Set(["easy", "moderate", "hard"]);
const ELIM_FATES = ["die", "convert", "neutral"];
const DEFAULT_ELIM_FATE = "die";
const WIN_CONDITIONS = ["last_standing", "first_death", "cell_count"];
const DEFAULT_WIN_CONDITION = "last_standing";

// Cell values:
//   0 = empty
//   1..4 = player N's color
//   -1 = neutral (eliminated colony in 'neutral' mode — anyone can re-flip these)

// --- Tetromino shapes ---
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
  return heads.some(h => h && h.x === x && h.y === y);
}

function headAt(heads, x, y) {
  return heads.find(h => h && h.x === x && h.y === y);
}

// --- Placement validation ---
// In N-player, "your colony" is just your own cells. Touching another player's
// cells doesn't count.
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
        touchesOwn = true; break;
      }
    }
    if (touchesOwn) break;
  }
  if (!touchesOwn) return { ok: false, reason: "must connect to your colony" };
  return { ok: true };
}

// Bite: an enemy cell (any non-self, non-empty, non-neutral player cell)
// that's 4-adjacent to one of mine.
function validateBite(board, x, y, playerNum, size, heads) {
  if (!inBounds(x, y, size)) return { ok: false, reason: "out of bounds" };
  if (isHeadAt(heads, x, y)) return { ok: false, reason: "cannot bite a head" };
  const v = board[y][x];
  if (v === 0 || v === -1 || v === playerNum) {
    return { ok: false, reason: "must bite an enemy cell" };
  }
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (inBounds(nx, ny, size) && board[ny][nx] === playerNum) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "bite must touch your colony" };
}

// --- Othello-style 8-direction capture ---
// For every cell of mine (or my head), shoot rays in all 8 directions. While
// the ray passes through cells that are "enemy" (any non-mine, non-neutral,
// non-empty cell, AND not a head), accumulate them. If the ray ends at a cell
// of mine (or my head), all accumulated cells flip to me.
//
// Heads (any color) end a ray:
//   - my head ends as a friendly bracket (flips the line)
//   - enemy head ends without bracket (no flip)
// Neutral cells (-1) and empty cells end without bracket.
function captureFlanked(board, playerNum, size, heads) {
  const isMine = (x, y) => {
    if (!inBounds(x, y, size)) return false;
    const h = headAt(heads, x, y);
    if (h) return h.playerNum === playerNum;
    return board[y][x] === playerNum;
  };
  const isFlippableEnemy = (x, y) => {
    if (!inBounds(x, y, size)) return false;
    if (isHeadAt(heads, x, y)) return false;
    const v = board[y][x];
    return v > 0 && v !== playerNum; // enemy player color
  };
  const DIRS = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,1],[1,-1],[-1,1]];
  const allFlipped = [];
  while (true) {
    const toFlip = new Set();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isMine(x, y)) continue;
        for (const [dx, dy] of DIRS) {
          const ray = [];
          let nx = x + dx, ny = y + dy;
          while (isFlippableEnemy(nx, ny)) {
            ray.push([nx, ny]);
            nx += dx; ny += dy;
          }
          if (ray.length > 0 && isMine(nx, ny)) {
            for (const [rx, ry] of ray) toFlip.add(`${rx},${ry}`);
          }
        }
      }
    }
    if (toFlip.size === 0) break;
    for (const k of toFlip) {
      const [x, y] = k.split(",").map(Number);
      board[y][x] = playerNum;
      allFlipped.push([x, y]);
    }
  }
  return allFlipped;
}

// --- Connectivity / orphan rule ---
// Each player's cells must trace a 4-adjacent path of same-color cells to
// their head. If a head is gone (player eliminated), all their cells are
// already handled by the elimination logic — we skip them here.
function reachableFromHead(board, head, size) {
  const reached = new Set([`${head.x},${head.y}`]);
  const stack = [[head.x, head.y]];
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny, size)) continue;
      const k = `${nx},${ny}`;
      if (reached.has(k)) continue;
      if (board[ny][nx] !== head.playerNum) continue;
      reached.add(k);
      stack.push([nx, ny]);
    }
  }
  return reached;
}

// orphanFate: "die" (cells become empty) or "convert" (cells go to specified player)
// For convert mode, `convertTo` says which playerNum the orphans of each color go to.
// In placement-driven captures, convertTo[ofColor] = the mover's color.
// In bite-driven, all orphans die regardless.
function processOrphans(board, heads, size, fate, convertTo) {
  const result = {}; // { [playerNum]: [[x,y]...] }
  for (const head of heads) {
    if (!head) continue;
    const p = head.playerNum;
    result[p] = [];
    const reached = reachableFromHead(board, head, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (board[y][x] !== p) continue;
        if (isHeadAt(heads, x, y)) continue;
        if (!reached.has(`${x},${y}`)) {
          result[p].push([x, y]);
          if (fate === "die") {
            board[y][x] = 0;
          } else if (fate === "convert") {
            const target = convertTo && convertTo[p] != null ? convertTo[p] : 0;
            board[y][x] = target;
          }
        }
      }
    }
  }
  return result;
}

// Head capture rule: the contiguous line of my color (including the head) along
// any of 4 axes is bracketed by enemy on both ends. Enemy = any other player.
function isHeadCaptured(board, head, size) {
  const own = head.playerNum;
  const isOwn = (x, y) => inBounds(x, y, size) && board[y][x] === own;
  const isEnemy = (x, y) => {
    if (!inBounds(x, y, size)) return false;
    const v = board[y][x];
    return v > 0 && v !== own;
  };
  const AXES = [[1,0],[0,1],[1,1],[1,-1]];
  for (const [dx, dy] of AXES) {
    let fx = head.x + dx, fy = head.y + dy;
    while (isOwn(fx, fy)) { fx += dx; fy += dy; }
    const f = isEnemy(fx, fy);
    let bx = head.x - dx, by = head.y - dy;
    while (isOwn(bx, by)) { bx -= dx; by -= dy; }
    const b = isEnemy(bx, by);
    if (f && b) return true;
  }
  return false;
}

function headThreatLevel(board, head, size) {
  const own = head.playerNum;
  const isOwn = (x, y) => inBounds(x, y, size) && board[y][x] === own;
  const isEnemy = (x, y) => {
    if (!inBounds(x, y, size)) return false;
    const v = board[y][x];
    return v > 0 && v !== own;
  };
  const AXES = [[1,0],[0,1],[1,1],[1,-1]];
  let threatened = 0;
  let captured = false;
  for (const [dx, dy] of AXES) {
    let fx = head.x + dx, fy = head.y + dy;
    while (isOwn(fx, fy)) { fx += dx; fy += dy; }
    const f = isEnemy(fx, fy);
    let bx = head.x - dx, by = head.y - dy;
    while (isOwn(bx, by)) { bx -= dx; by -= dy; }
    const b = isEnemy(bx, by);
    if (f && b) captured = true;
    if (f || b) threatened++;
  }
  if (captured) return 3;
  return threatened;
}

// --- Move legality, used for skip detection and bot move generation ---
function hasLegalPlacement(board, size, heads, playerNum, pieceType) {
  if (!pieceType) return false;
  const baseShape = SHAPES[pieceType];
  for (let r = 0; r < 4; r++) {
    const shape = rotate(baseShape, r);
    for (let oy = 0; oy < size; oy++) {
      for (let ox = 0; ox < size; ox++) {
        const cells = shape.map(([dx, dy]) => [ox + dx, oy + dy]);
        if (validatePlacement(board, cells, playerNum, size, heads).ok) return true;
      }
    }
  }
  return false;
}

function hasLegalBite(board, size, heads, playerNum) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (validateBite(board, x, y, playerNum, size, heads).ok) return true;
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

// --- Head start positions ---
// 2 players: opposite corners (NW, SE)
// 3 players: triangle (NW, NE, S)
// 4 players: four corners (NW, NE, SE, SW)
// All positions inset from corner by `offset`.
function startingHeadPositions(size, offset, playerCount) {
  const lo = offset;
  const hi = size - 1 - offset;
  if (playerCount === 2) {
    return [
      { x: lo, y: lo, playerNum: 1 },
      { x: hi, y: hi, playerNum: 2 },
    ];
  }
  if (playerCount === 3) {
    return [
      { x: lo, y: lo, playerNum: 1 },
      { x: hi, y: lo, playerNum: 2 },
      { x: Math.floor(size / 2), y: hi, playerNum: 3 },
    ];
  }
  // 4 players
  return [
    { x: lo, y: lo, playerNum: 1 },
    { x: hi, y: lo, playerNum: 2 },
    { x: hi, y: hi, playerNum: 3 },
    { x: lo, y: hi, playerNum: 4 },
  ];
}

function newGame(settings, slots) {
  const { size, offset } = settings;
  // Active player count = number of non-"empty" slots
  const playerCount = slots.filter(s => s.type !== "empty").length;
  const heads = startingHeadPositions(size, offset, playerCount);
  const board = Array.from({ length: size }, () => Array(size).fill(0));
  for (const h of heads) {
    board[h.y][h.x] = h.playerNum;
  }
  return {
    size, offset, board,
    heads,
    playerCount,
    turn: 0,
    bags: heads.map(() => topUpBag([], 12)),
    nextPiece: heads.map(() => null),
    bitesRemaining: heads.map(() => STARTING_BITES),
    eliminated: heads.map(() => false),
    consecutivePasses: 0,
    lastEvents: null,
    moveLog: [],
    winner: null,           // playerIdx, or array of playerIdx for tie, or null
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
  let elimFate = String(raw.elimFate || "");
  if (!ELIM_FATES.includes(elimFate)) elimFate = DEFAULT_ELIM_FATE;
  let winCondition = String(raw.winCondition || "");
  if (!WIN_CONDITIONS.includes(winCondition)) winCondition = DEFAULT_WIN_CONDITION;
  return { size, offset, elimFate, winCondition, lookahead: DEFAULT_LOOKAHEAD };
}

function defaultSlots() {
  // Slot 0 (host) = human, slot 1 = human (open), slots 2-3 = empty
  return [
    { type: "human", name: null, occupied: false },
    { type: "human", name: null, occupied: false },
    { type: "empty", name: null, occupied: false },
    { type: "empty", name: null, occupied: false },
  ];
}

function validateSlots(rawSlots) {
  if (!Array.isArray(rawSlots) || rawSlots.length !== MAX_PLAYERS) {
    return defaultSlots();
  }
  const slots = rawSlots.map(s => {
    const type = SLOT_TYPES.includes(s && s.type) ? s.type : "empty";
    return { type, name: null, occupied: false };
  });
  // Slot 0 must always be human (the host's slot)
  slots[0].type = "human";
  // At least 2 active players
  const active = slots.filter(s => s.type !== "empty").length;
  if (active < MIN_PLAYERS) {
    slots[1].type = "human"; // ensure at least 2
  }
  return slots;
}

// ============================================================
// Bot move generation
// ============================================================

// Generate every legal placement: list of { x, y, rotation, piece, cells }
function* enumeratePlacements(board, size, heads, playerNum, pieceType) {
  if (!pieceType) return;
  const baseShape = SHAPES[pieceType];
  for (let r = 0; r < 4; r++) {
    const shape = rotate(baseShape, r);
    for (let oy = 0; oy < size; oy++) {
      for (let ox = 0; ox < size; ox++) {
        const cells = shape.map(([dx, dy]) => [ox + dx, oy + dy]);
        if (validatePlacement(board, cells, playerNum, size, heads).ok) {
          yield { x: ox, y: oy, rotation: r, piece: pieceType, cells };
        }
      }
    }
  }
}

function* enumerateBites(board, size, heads, playerNum) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (validateBite(board, x, y, playerNum, size, heads).ok) {
        yield { x, y };
      }
    }
  }
}

// Clone game state cheaply for bot simulation
function cloneBoard(board) { return board.map(r => r.slice()); }
function cloneHeads(heads) { return heads.map(h => h ? { ...h } : null); }

// Simulate a placement and return resulting state delta (board mutated, return events)
function simulatePlacement(board, heads, size, playerNum, cells, settings) {
  for (const [x, y] of cells) board[y][x] = playerNum;
  const flipped = captureFlanked(board, playerNum, size, heads);
  // Build convertTo: for placements, all orphans go to mover's color
  const convertTo = {};
  for (const h of heads) if (h) convertTo[h.playerNum] = playerNum;
  const orphans = processOrphans(board, heads, size, "convert", convertTo);
  let myGain = cells.length + flipped.length;
  let enemyLoss = flipped.length;
  for (const p in orphans) {
    if (parseInt(p, 10) !== playerNum) {
      enemyLoss += orphans[p].length;
      myGain += orphans[p].length;
    }
  }
  return { flipped, orphans, myGain, enemyLoss };
}

function simulateBite(board, heads, size, playerNum, x, y) {
  board[y][x] = 0;
  const orphans = processOrphans(board, heads, size, "die");
  let enemyLoss = 1;
  for (const p in orphans) {
    if (parseInt(p, 10) !== playerNum) enemyLoss += orphans[p].length;
  }
  return { orphans, enemyLoss };
}

// Easy bot: pick a random legal placement.
// (Doesn't bite.)
function pickEasyMove(game, playerIdx) {
  const playerNum = playerIdx + 1;
  const piece = game.nextPiece[playerIdx];
  const placements = [...enumeratePlacements(
    game.board, game.size, game.heads, playerNum, piece
  )];
  if (placements.length === 0) return { type: "pass" };
  const choice = placements[Math.floor(Math.random() * placements.length)];
  return { type: "move", piece, x: choice.x, y: choice.y, rotation: choice.rotation };
}

// Moderate bot: greedy one-ply.
//   - Evaluate every placement by simulated capture+orphan delta.
//   - If a bite would gain more, use it.
//   - Pick highest myGain. Tiebreak by lowest threat to my own head.
function pickModerateMove(game, playerIdx) {
  const playerNum = playerIdx + 1;
  const piece = game.nextPiece[playerIdx];
  let best = null; // { score, action }
  const consider = (action, score) => {
    if (best === null || score > best.score) best = { score, action };
  };

  const placements = [...enumeratePlacements(
    game.board, game.size, game.heads, playerNum, piece
  )];
  for (const p of placements) {
    const b = cloneBoard(game.board);
    const h = cloneHeads(game.heads);
    const sim = simulatePlacement(b, h, game.size, playerNum, p.cells, null);
    // Check: does this expose me to head capture?
    const myHead = h.find(x => x && x.playerNum === playerNum);
    if (myHead && isHeadCaptured(b, myHead, game.size)) continue; // suicidal
    const score = sim.myGain * 1.5 + sim.enemyLoss;
    consider(
      { type: "move", piece, x: p.x, y: p.y, rotation: p.rotation },
      score
    );
  }
  // Try bites if we have any — only if a placement isn't already great
  if (game.bitesRemaining[playerIdx] > 0) {
    const bites = [...enumerateBites(game.board, game.size, game.heads, playerNum)];
    for (const b of bites) {
      const bd = cloneBoard(game.board);
      const hd = cloneHeads(game.heads);
      const sim = simulateBite(bd, hd, game.size, playerNum, b.x, b.y);
      // Bites are valuable: count enemyLoss heavily but penalize spending
      const score = sim.enemyLoss * 1.2 - 1.5; // -1.5 = cost of spending a bite
      consider({ type: "bite", x: b.x, y: b.y }, score);
    }
  }
  if (best === null || best.score < 0) return { type: "pass" };
  return best.action;
}

// Hard bot: 2-ply minimax with eval function.
// For each of my candidate moves, simulate, then for each enemy's best response,
// pick the worst case for me. Then pick the move that maximizes my worst case.
//
// To keep it tractable, we only consider top-K candidates by greedy score at
// each level.
function pickHardMove(game, playerIdx) {
  const playerNum = playerIdx + 1;
  const piece = game.nextPiece[playerIdx];
  const TOP_K = 8;
  const TOP_K_OPP = 4;

  const evaluateBoard = (board, heads, size, me) => {
    // My net = my cells - sum of others' cells, weighted by head safety
    let myCells = 0;
    let totalEnemy = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = board[y][x];
        if (v === me) myCells++;
        else if (v > 0) totalEnemy++;
      }
    }
    const myHead = heads.find(h => h && h.playerNum === me);
    let myThreat = myHead ? headThreatLevel(board, myHead, size) : 3;
    let myCaptured = myHead ? isHeadCaptured(board, myHead, size) : true;
    if (myCaptured) return -10000;
    let opponentRisk = 0;
    for (const h of heads) {
      if (h && h.playerNum !== me) {
        if (isHeadCaptured(board, h, size)) opponentRisk += 10000;
        else opponentRisk += headThreatLevel(board, h, size) * 5;
      }
    }
    return myCells - totalEnemy - myThreat * 8 + opponentRisk * 0.5;
  };

  // Generate my top-K candidate actions by greedy eval
  const candidates = [];
  const placements = [...enumeratePlacements(
    game.board, game.size, game.heads, playerNum, piece
  )];
  for (const p of placements) {
    const b = cloneBoard(game.board);
    const h = cloneHeads(game.heads);
    const sim = simulatePlacement(b, h, game.size, playerNum, p.cells, null);
    const myHead = h.find(x => x && x.playerNum === playerNum);
    if (myHead && isHeadCaptured(b, myHead, game.size)) continue;
    const greedyScore = evaluateBoard(b, h, game.size, playerNum);
    candidates.push({
      action: { type: "move", piece, x: p.x, y: p.y, rotation: p.rotation },
      simBoard: b, simHeads: h, greedyScore
    });
  }
  if (game.bitesRemaining[playerIdx] > 0) {
    const bites = [...enumerateBites(game.board, game.size, game.heads, playerNum)];
    for (const b of bites) {
      const bd = cloneBoard(game.board);
      const hd = cloneHeads(game.heads);
      simulateBite(bd, hd, game.size, playerNum, b.x, b.y);
      const greedyScore = evaluateBoard(bd, hd, game.size, playerNum) - 4;
      candidates.push({
        action: { type: "bite", x: b.x, y: b.y },
        simBoard: bd, simHeads: hd, greedyScore
      });
    }
  }
  candidates.sort((a, b) => b.greedyScore - a.greedyScore);
  const topMe = candidates.slice(0, TOP_K);

  if (topMe.length === 0) return { type: "pass" };

  // For each top candidate, simulate the *worst* opponent reply (across all
  // remaining alive players, taking the worst for me).
  let bestAction = null;
  let bestWorstCaseScore = -Infinity;
  for (const cand of topMe) {
    let worstForMe = cand.greedyScore;
    // For each other alive player, simulate their best move with their current
    // piece and pick the move that hurts me most.
    for (let otherIdx = 0; otherIdx < game.heads.length; otherIdx++) {
      if (otherIdx === playerIdx) continue;
      if (game.eliminated[otherIdx]) continue;
      const otherNum = otherIdx + 1;
      const otherPiece = game.nextPiece[otherIdx];
      const oppPlacements = [...enumeratePlacements(
        cand.simBoard, game.size, cand.simHeads, otherNum, otherPiece
      )];
      let opPickScore = cand.greedyScore;
      let foundReply = false;
      // Score each opp reply from MY perspective; pick the one that minimizes my score
      const oppCandidates = [];
      for (const op of oppPlacements) {
        const b2 = cloneBoard(cand.simBoard);
        const h2 = cloneHeads(cand.simHeads);
        simulatePlacement(b2, h2, game.size, otherNum, op.cells, null);
        const score = evaluateBoard(b2, h2, game.size, playerNum);
        oppCandidates.push(score);
      }
      oppCandidates.sort((a, b) => a - b); // ascending = worst-for-me first
      const consider = oppCandidates.slice(0, TOP_K_OPP);
      for (const s of consider) {
        if (s < opPickScore) opPickScore = s;
        foundReply = true;
      }
      if (foundReply && opPickScore < worstForMe) worstForMe = opPickScore;
    }
    if (worstForMe > bestWorstCaseScore) {
      bestWorstCaseScore = worstForMe;
      bestAction = cand.action;
    }
  }
  return bestAction || { type: "pass" };
}

function pickBotMove(game, playerIdx, difficulty) {
  if (difficulty === "easy") return pickEasyMove(game, playerIdx);
  if (difficulty === "moderate") return pickModerateMove(game, playerIdx);
  if (difficulty === "hard") return pickHardMove(game, playerIdx);
  return { type: "pass" };
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
      this.slots = (await this.ctx.storage.get("slots")) || defaultSlots();
      this.started = (await this.ctx.storage.get("started")) || false;
      this.settings = (await this.ctx.storage.get("settings")) || {
        size: DEFAULT_BOARD,
        offset: DEFAULT_OFFSET,
        elimFate: DEFAULT_ELIM_FATE,
        winCondition: DEFAULT_WIN_CONDITION,
        lookahead: DEFAULT_LOOKAHEAD,
      };
      this.botTimer = null;
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
      let creatorPayload = null;
      if (role === "create") {
        creatorPayload = {
          settings: validateSettings({
            size: url.searchParams.get("size"),
            offset: url.searchParams.get("offset"),
            elimFate: url.searchParams.get("elimFate"),
            winCondition: url.searchParams.get("winCondition"),
          }),
        };
      }
      return this.handleConnect(name, role, creatorPayload);
    }
    return new Response("not found", { status: 404 });
  }

  async handleConnect(name, role, creatorPayload) {
    const sockets = this.ctx.getWebSockets();

    // If game is started, only allow if the connection corresponds to a slot
    // that's lost its socket (reconnect) — for v1 we just refuse.
    if (this.started) {
      return new Response("game already started", { status: 403 });
    }

    if (role === "create") {
      // First connection only
      if (sockets.length > 0) {
        return new Response("room already created", { status: 403 });
      }
      this.settings = creatorPayload.settings;
      this.slots = defaultSlots();
      this.slots[0].name = name;
      this.slots[0].occupied = true;
      await this.ctx.storage.put("settings", this.settings);
      await this.ctx.storage.put("slots", this.slots);
    } else {
      // Joining: claim the first open human slot
      const idx = this.slots.findIndex(s => s.type === "human" && !s.occupied);
      if (idx < 0) return new Response("no open slot", { status: 403 });
      this.slots[idx].name = name;
      this.slots[idx].occupied = true;
      await this.ctx.storage.put("slots", this.slots);
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Find the slot index this socket owns by name (cheap and unambiguous
    // because we just set it).
    const slotIdx = this.slots.findIndex(s => s.name === name && s.occupied);
    server.serializeAttachment({ slotIdx, name });
    this.ctx.acceptWebSocket(server);

    server.send(JSON.stringify(this.publicState(slotIdx)));
    this.broadcastState();
    return new Response(null, { status: 101, webSocket: client });
  }

  // Assemble the per-recipient view of state.
  publicState(perspectiveSlotIdx) {
    const names = this.slots.map(s => s.name);
    const slotsView = this.slots.map(s => ({ type: s.type, name: s.name, occupied: s.occupied }));
    if (!this.started || !this.game) {
      return {
        type: "lobby",
        slots: slotsView,
        names,
        yourIndex: perspectiveSlotIdx,
        settings: this.settings,
        // Slot 0 (host) gets a hint that they can configure
        isHost: perspectiveSlotIdx === 0,
      };
    }
    const lookahead = this.settings.lookahead || 0;
    let myUpcoming = [];
    if (perspectiveSlotIdx != null && lookahead > 0) {
      // Slot index → playerIdx: we built the game with playerCount active slots,
      // in slot order. So slot N maps to its game playerIdx by counting active
      // slots up to N. But we don't *yet* support empty slots in the middle
      // changing playerIdx — we always activate slots in order 0,1,2,3 skipping
      // empties. So we need a slot→playerIdx map.
      const playerIdx = this.slotToPlayerIdx(perspectiveSlotIdx);
      if (playerIdx != null && this.game.bags[playerIdx]) {
        myUpcoming = this.game.bags[playerIdx].slice(0, lookahead);
      }
    }
    const threats = this.game.heads.map(h =>
      h ? headThreatLevel(this.game.board, h, this.game.size) : 0
    );
    return {
      type: "state",
      names,
      slots: slotsView,
      settings: this.settings,
      board: this.game.board,
      size: this.game.size,
      heads: this.game.heads,
      threats,
      turn: this.game.turn, // playerIdx (not slot index)
      turnSlot: this.playerIdxToSlot(this.game.turn),
      nextPiece: this.game.nextPiece,
      bitesRemaining: this.game.bitesRemaining,
      eliminated: this.game.eliminated,
      upcoming: myUpcoming,
      yourIndex: perspectiveSlotIdx, // the slot index for this client
      yourPlayerIdx: this.slotToPlayerIdx(perspectiveSlotIdx),
      finished: this.game.finished,
      winner: this.game.winner,
      endReason: this.game.endReason,
      counts: this.game.heads.map(h => h ? countCells(this.game.board, h.playerNum, this.game.size) : 0),
      moveLog: this.game.moveLog.slice(-25),
      lastEvents: this.game.lastEvents,
      consecutivePasses: this.game.consecutivePasses || 0,
      playerCount: this.game.playerCount,
    };
  }

  // Slot↔playerIdx mapping. Active slots (non-empty) get playerIdx in order.
  slotToPlayerIdx(slotIdx) {
    if (slotIdx == null) return null;
    if (!this.game) return null;
    let p = 0;
    for (let i = 0; i <= slotIdx && i < this.slots.length; i++) {
      if (this.slots[i].type === "empty") continue;
      if (i === slotIdx) return p;
      p++;
    }
    return null;
  }
  playerIdxToSlot(playerIdx) {
    if (playerIdx == null || !this.game) return null;
    let p = 0;
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i].type === "empty") continue;
      if (p === playerIdx) return i;
      p++;
    }
    return null;
  }

  broadcastState() {
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      const att = ws.deserializeAttachment();
      if (!att) continue;
      try { ws.send(JSON.stringify(this.publicState(att.slotIdx))); }
      catch (e) {}
    }
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const att = ws.deserializeAttachment();
    if (!att) return;
    const slotIdx = att.slotIdx;

    if (!this.started) {
      // Lobby messages
      if (msg.type === "config_slots") {
        if (slotIdx !== 0) return; // only host
        await this.handleConfigSlots(msg);
        return;
      }
      if (msg.type === "config_settings") {
        if (slotIdx !== 0) return;
        await this.handleConfigSettings(msg);
        return;
      }
      if (msg.type === "start_game") {
        if (slotIdx !== 0) return;
        await this.handleStartGame();
        return;
      }
      return;
    }

    // In-game messages
    const playerIdx = this.slotToPlayerIdx(slotIdx);
    if (playerIdx == null) return;

    if (msg.type === "move") {
      const r = this.handleMove(playerIdx, msg);
      if (r.error) { ws.send(JSON.stringify({ type: "error", error: r.error })); return; }
      await this.persistAndBroadcast();
      return;
    }
    if (msg.type === "bite") {
      const r = this.handleBite(playerIdx, msg);
      if (r.error) { ws.send(JSON.stringify({ type: "error", error: r.error })); return; }
      await this.persistAndBroadcast();
      return;
    }
    if (msg.type === "pass") {
      const r = this.handlePass(playerIdx);
      if (r.error) { ws.send(JSON.stringify({ type: "error", error: r.error })); return; }
      await this.persistAndBroadcast();
      return;
    }
    if (msg.type === "resign") {
      const r = this.handleResign(playerIdx);
      if (r.error) { ws.send(JSON.stringify({ type: "error", error: r.error })); return; }
      await this.persistAndBroadcast();
      return;
    }
    if (msg.type === "rematch") {
      this.game = newGame(this.settings, this.slots);
      for (let i = 0; i < this.game.playerCount; i++) dealPiece(this.game, i);
      await this.ctx.storage.put("game", this.game);
      this.broadcastState();
      this.scheduleBotIfNeeded();
      return;
    }
  }

  async persistAndBroadcast() {
    await this.ctx.storage.put("game", this.game);
    this.broadcastState();
    this.scheduleBotIfNeeded();
  }

  async handleConfigSlots(msg) {
    if (!Array.isArray(msg.slots) || msg.slots.length !== MAX_PLAYERS) return;
    // Preserve names of currently-occupied human slots
    const newSlots = msg.slots.map((s, i) => {
      const t = SLOT_TYPES.includes(s.type) ? s.type : "empty";
      const existing = this.slots[i];
      if (i === 0) {
        // host's slot is always human, keep their name
        return { type: "human", name: existing.name, occupied: existing.occupied };
      }
      if (t === "human" && existing.type === "human" && existing.occupied) {
        // preserve someone already in this slot
        return { type: "human", name: existing.name, occupied: true };
      }
      return { type: t, name: null, occupied: false };
    });
    // At least 2 active
    const active = newSlots.filter(s => s.type !== "empty").length;
    if (active < MIN_PLAYERS) return;
    // If we kicked out a human who was in a slot that's now non-human or empty,
    // close their socket politely.
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i].occupied && newSlots[i].type !== "human") {
        // find their socket and close
        for (const ws of this.ctx.getWebSockets()) {
          const att = ws.deserializeAttachment();
          if (att && att.slotIdx === i) {
            try { ws.close(1000, "slot reconfigured"); } catch (e) {}
          }
        }
      }
    }
    this.slots = newSlots;
    await this.ctx.storage.put("slots", this.slots);
    this.broadcastState();
  }

  async handleConfigSettings(msg) {
    this.settings = validateSettings(msg.settings || {});
    await this.ctx.storage.put("settings", this.settings);
    this.broadcastState();
  }

  async handleStartGame() {
    // All human slots must be occupied; at least 2 active
    const active = this.slots.filter(s => s.type !== "empty").length;
    if (active < MIN_PLAYERS) return;
    for (const s of this.slots) {
      if (s.type === "human" && !s.occupied) return; // wait
    }
    this.started = true;
    this.game = newGame(this.settings, this.slots);
    for (let i = 0; i < this.game.playerCount; i++) dealPiece(this.game, i);
    await this.ctx.storage.put("started", true);
    await this.ctx.storage.put("game", this.game);
    this.broadcastState();
    this.scheduleBotIfNeeded();
  }

  // After any state change, check if the current turn belongs to a bot;
  // if so, schedule a bot move with a small delay so animations play.
  scheduleBotIfNeeded() {
    if (!this.started || !this.game || this.game.finished) return;
    if (this.botTimer) return; // already scheduled
    const slotIdx = this.playerIdxToSlot(this.game.turn);
    if (slotIdx == null) return;
    const slot = this.slots[slotIdx];
    if (!slot || !BOT_TYPES.has(slot.type)) return;
    const delay = 700 + Math.floor(Math.random() * 400);
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      this.runBotTurn();
    }, delay);
  }

  async runBotTurn() {
    if (!this.started || !this.game || this.game.finished) return;
    const slotIdx = this.playerIdxToSlot(this.game.turn);
    if (slotIdx == null) return;
    const slot = this.slots[slotIdx];
    if (!slot || !BOT_TYPES.has(slot.type)) return;
    const playerIdx = this.game.turn;
    const action = pickBotMove(this.game, playerIdx, slot.type);
    let r;
    if (action.type === "move") r = this.handleMove(playerIdx, action);
    else if (action.type === "bite") r = this.handleBite(playerIdx, action);
    else r = this.handlePass(playerIdx);
    // Errors from bots are bugs — log and pass to keep game going
    if (r && r.error) {
      console.warn("bot error", slot.type, r.error);
      this.handlePass(playerIdx);
    }
    await this.persistAndBroadcast();
  }

  resolveEndOfTurn() {
    const g = this.game;
    // Process eliminations: any head whose line is captured.
    // We do this in a loop because cascading eliminations can chain.
    while (true) {
      let didElim = false;
      for (let i = 0; i < g.heads.length; i++) {
        if (g.eliminated[i]) continue;
        if (isHeadCaptured(g.board, g.heads[i], g.size)) {
          this.eliminatePlayer(i);
          didElim = true;
        }
      }
      if (!didElim) break;
    }

    // Win condition checks
    const aliveIdxs = g.heads.map((_, i) => i).filter(i => !g.eliminated[i]);
    if (this.settings.winCondition === "first_death") {
      // Game ends as soon as anyone is eliminated.
      if (aliveIdxs.length < g.heads.length) {
        g.finished = true;
        g.endReason = "first_death";
        g.winner = aliveIdxs.length === 1 ? aliveIdxs[0] : aliveIdxs.slice();
        return;
      }
    } else {
      // Both "last_standing" and "cell_count" end immediately when only 1 alive
      if (aliveIdxs.length === 1) {
        g.finished = true;
        g.endReason = "head_captured";
        g.winner = aliveIdxs[0];
        return;
      }
      if (aliveIdxs.length === 0) {
        g.finished = true;
        g.endReason = "head_captured";
        g.winner = -1;
        return;
      }
    }

    // Advance turn to next non-eliminated player
    g.turn = this.nextLivingTurn(g.turn);
    dealPiece(g, g.turn);

    // Stalemate: nobody can do anything
    let cycle = 0;
    while (
      cycle < g.heads.length &&
      !g.eliminated[g.turn] &&
      !hasLegalPlacement(g.board, g.size, g.heads, g.turn + 1, g.nextPiece[g.turn]) &&
      !hasLegalBite(g.board, g.size, g.heads, g.turn + 1)
    ) {
      g.moveLog.push({ player: g.turn, skipped: true });
      g.turn = this.nextLivingTurn(g.turn);
      dealPiece(g, g.turn);
      cycle++;
    }
    if (cycle >= g.heads.length) {
      this.endByCellCount("stalemate");
    }
  }

  nextLivingTurn(currentTurn) {
    const g = this.game;
    const n = g.heads.length;
    let t = (currentTurn + 1) % n;
    for (let safety = 0; safety < n + 1; safety++) {
      if (!g.eliminated[t]) return t;
      t = (t + 1) % n;
    }
    return currentTurn;
  }

  endByCellCount(reason) {
    const g = this.game;
    g.finished = true;
    g.endReason = reason;
    let bestScore = -1;
    let winners = [];
    for (let i = 0; i < g.heads.length; i++) {
      const h = g.heads[i];
      const score = h ? countCellsNearHead(g.board, h, g.size) +
                        countCells(g.board, h.playerNum, g.size) * 0.1 : 0;
      if (score > bestScore) { bestScore = score; winners = [i]; }
      else if (score === bestScore) winners.push(i);
    }
    g.winner = winners.length === 1 ? winners[0] : winners;
  }

  eliminatePlayer(playerIdx) {
    const g = this.game;
    g.eliminated[playerIdx] = true;
    const head = g.heads[playerIdx];
    if (!head) return;
    const fate = this.settings.elimFate;
    const playerColor = head.playerNum;
    g.moveLog.push({ player: playerIdx, eliminated: true });

    // Remove the head from the board
    g.board[head.y][head.x] = 0;
    g.heads[playerIdx] = null; // remove from heads array

    // Process the player's remaining cells based on fate
    if (fate === "die") {
      for (let y = 0; y < g.size; y++) {
        for (let x = 0; x < g.size; x++) {
          if (g.board[y][x] === playerColor) g.board[y][x] = 0;
        }
      }
    } else if (fate === "neutral") {
      for (let y = 0; y < g.size; y++) {
        for (let x = 0; x < g.size; x++) {
          if (g.board[y][x] === playerColor) g.board[y][x] = -1;
        }
      }
    } else if (fate === "convert") {
      // Find who eliminated them — the player who just moved (current turn)
      // before resolveEndOfTurn advanced. We pull from lastEvents.
      const ev = g.lastEvents;
      const captorIdx = (ev && typeof ev.player === "number") ? ev.player : null;
      if (captorIdx != null && !g.eliminated[captorIdx]) {
        const captorNum = captorIdx + 1;
        for (let y = 0; y < g.size; y++) {
          for (let x = 0; x < g.size; x++) {
            if (g.board[y][x] === playerColor) g.board[y][x] = captorNum;
          }
        }
      } else {
        // Fallback to die if we can't determine captor
        for (let y = 0; y < g.size; y++) {
          for (let x = 0; x < g.size; x++) {
            if (g.board[y][x] === playerColor) g.board[y][x] = 0;
          }
        }
      }
    }
  }

  handleMove(playerIdx, msg) {
    const g = this.game;
    if (!g || g.finished) return { error: "game not active" };
    if (g.turn !== playerIdx) return { error: "not your turn" };
    if (g.eliminated[playerIdx]) return { error: "you are eliminated" };
    const pieceType = g.nextPiece[playerIdx];
    if (msg.piece !== pieceType) return { error: "piece mismatch" };
    const baseShape = SHAPES[pieceType];
    const shape = rotate(baseShape, msg.rotation || 0);
    const cells = shape.map(([dx, dy]) => [msg.x + dx, msg.y + dy]);
    const playerNum = playerIdx + 1;
    const v = validatePlacement(g.board, cells, playerNum, g.size, g.heads.filter(h => h));
    if (!v.ok) return { error: v.reason };

    for (const [x, y] of cells) g.board[y][x] = playerNum;
    const flipped = captureFlanked(g.board, playerNum, g.size, g.heads.filter(h => h));
    // For orphan-convert: all orphans (of any color) go to the mover
    const convertTo = {};
    for (const h of g.heads) if (h) convertTo[h.playerNum] = playerNum;
    const orphans = processOrphans(g.board, g.heads.filter(h => h), g.size, "convert", convertTo);
    const allConverted = [];
    for (const p in orphans) {
      if (parseInt(p, 10) !== playerNum) allConverted.push(...orphans[p]);
    }

    g.consecutivePasses = 0;
    g.lastEvents = {
      kind: "place",
      player: playerIdx,
      placed: cells,
      flipped,
      converted: allConverted,
    };
    g.moveLog.push({
      player: playerIdx,
      piece: pieceType,
      x: msg.x, y: msg.y,
      rotation: msg.rotation || 0,
      flipped: flipped.length,
      converted: allConverted.length,
    });

    this.resolveEndOfTurn();
    return { ok: true };
  }

  handleBite(playerIdx, msg) {
    const g = this.game;
    if (!g || g.finished) return { error: "game not active" };
    if (g.turn !== playerIdx) return { error: "not your turn" };
    if (g.eliminated[playerIdx]) return { error: "you are eliminated" };
    if (g.bitesRemaining[playerIdx] <= 0) return { error: "no bites remaining" };
    const playerNum = playerIdx + 1;
    const heads = g.heads.filter(h => h);
    const v = validateBite(g.board, msg.x, msg.y, playerNum, g.size, heads);
    if (!v.ok) return { error: v.reason };

    g.board[msg.y][msg.x] = 0;
    g.bitesRemaining[playerIdx]--;
    const orphans = processOrphans(g.board, heads, g.size, "die");
    const killedAll = [];
    for (const p in orphans) {
      if (parseInt(p, 10) !== playerNum) killedAll.push(...orphans[p]);
    }

    g.consecutivePasses = 0;
    g.lastEvents = {
      kind: "bite",
      player: playerIdx,
      bitten: [msg.x, msg.y],
      killed: killedAll,
    };
    g.moveLog.push({
      player: playerIdx,
      bite: true,
      x: msg.x, y: msg.y,
      killed: killedAll.length,
    });

    this.resolveEndOfTurn();
    return { ok: true };
  }

  handlePass(playerIdx) {
    const g = this.game;
    if (!g || g.finished) return { error: "game not active" };
    if (g.turn !== playerIdx) return { error: "not your turn" };
    g.consecutivePasses = (g.consecutivePasses || 0) + 1;
    g.lastEvents = { kind: "pass", player: playerIdx };
    g.moveLog.push({ player: playerIdx, passed: true });

    const aliveCount = g.eliminated.filter(e => !e).length;
    if (g.consecutivePasses >= aliveCount) {
      // All living players passed in succession
      this.endByCellCount("mutual_pass");
      return { ok: true };
    }
    g.turn = this.nextLivingTurn(g.turn);
    dealPiece(g, g.turn);
    return { ok: true };
  }

  handleResign(playerIdx) {
    const g = this.game;
    if (!g || g.finished) return { error: "game not active" };
    g.lastEvents = { kind: "resign", player: playerIdx };
    g.moveLog.push({ player: playerIdx, resigned: true });
    this.eliminatePlayer(playerIdx);
    // Treat resignation as a head-loss for win-condition purposes
    this.resolveEndOfTurn();
    return { ok: true };
  }

  async webSocketClose(ws, code, reason, wasClean) {
    const att = ws.deserializeAttachment();
    if (!att) return;
    const slotIdx = att.slotIdx;
    if (this.slots[slotIdx]) {
      this.slots[slotIdx].occupied = false;
    }
    if (this.game && !this.game.finished && this.started) {
      // Treat disconnection as resignation for that player
      const playerIdx = this.slotToPlayerIdx(slotIdx);
      if (playerIdx != null && !this.game.eliminated[playerIdx]) {
        this.game.lastEvents = { kind: "resign", player: playerIdx };
        this.game.moveLog.push({ player: playerIdx, resigned: true, disconnected: true });
        this.eliminatePlayer(playerIdx);
        this.resolveEndOfTurn();
        await this.ctx.storage.put("game", this.game);
        this.broadcastState();
        this.scheduleBotIfNeeded();
      }
    } else if (!this.started) {
      // In lobby: free the slot
      await this.ctx.storage.put("slots", this.slots);
      this.broadcastState();
    }
  }

  async webSocketError(ws) {
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
