# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment

This project deploys to Cloudflare Workers + Durable Objects. There is no build step.

```bash
npx wrangler deploy        # deploy to production
npx wrangler dev           # local dev server (Workers runtime emulation)
```

The `wrangler.jsonc` config names the Worker `webfungus`, binds `ASSETS` to `./public`, and registers a single Durable Object class `Room` with SQLite storage.

## Project Structure

Two files contain all the logic:

- **`src/index.js`** — Cloudflare Worker (HTTP router) + `Room` Durable Object. All game logic lives here.
- **`public/index.html`** — Single-file client: HTML, CSS, and ~1100 lines of canvas JS. No bundler, no framework.

The Worker routes `/ws?room=XXXX` to a `Room` DO instance (keyed by room code). All other paths are served by the `ASSETS` binding (static files from `./public`).

## Architecture

### Server (`src/index.js`)

`Room` is a Durable Object. One instance per 4-letter room code. It uses the WebSocket Hibernation API (`ctx.acceptWebSocket`) so idle rooms don't consume compute.

Key constants at the top: `DEFAULT_BOARD = 16`, `DEFAULT_OFFSET = 3`, `STARTING_BITES = 3`.

Game state lives in `this.game` (in memory while active, persisted to `ctx.storage` as JSON after every move). `this.started`, `this.names`, and `this.settings` are also persisted.

Turn flow:
1. Client sends `{ type: "move"|"bite"|"pass"|"resign"|"rematch", ... }`
2. DO validates via `validatePlacement` / `validateBite`
3. Applies captures (`captureFlanked` — 8-dir Othello-style, chains until stable)
4. Applies orphan rule (`processOrphans` — cells disconnected from their head either die or convert)
5. Checks head capture (`isHeadCaptured` — head's collinear run flanked on any of 4 axes = loss)
6. Advances turn, deals next piece, checks for stalemate
7. Broadcasts updated state to all sockets via `broadcastState()`

The `publicState(playerIdx)` method shapes the response: it includes the full board, heads, threat levels, bags (only the requesting player's upcoming pieces), and `lastEvents` (the diff from the most recent move, used by the client for animations).

### Client (`public/index.html`)

UI has three phases controlled by showing/hiding `#lobby`, `#waiting`, `#gameInfo` divs.

Client-side logic mirrors the server's capture and orphan logic (`simCapture`, `simOrphans`) purely for the hover preview — the server is authoritative.

Canvas rendering in `render()`:
- Draws grid, cells, heads (animated "fungal eye")
- Overlay hover preview: ghost piece + capture outlines
- Animation queue (`anims[]`) for place/flip/convert/bite/kill effects, driven by `requestAnimationFrame`

Player colors: `--p1` (gold `#f4c430`) and `--p2` (green `#7ed957`) as CSS variables.

## Game Rules Summary

- 16×16 grid (configurable 8–24). Two players, heads placed symmetrically offset from center.
- Each turn: place a tetromino (from a 7-bag) such that ≥1 cell is 4-adjacent to your existing colony.
- After placement: 8-directional Othello-style captures chain until stable. Orphaned cells (disconnected from head via 4-adj path) convert to the attacker's color.
- Alternatively: spend a **bite** (3 per game) to remove one adjacent enemy cell; orphaned enemies die (become empty).
- **Loss condition**: your head's collinear run of own-color cells is flanked by enemies on any of the 4 axes.
- Stalemate: both players pass consecutively or neither has a legal move. Winner is whoever has more cells within 2 squares of their head.

## Branch and Repository

- Repository: `ericnetc/webfungus`
- Feature development branch: `claude/netfungus-development-vt2hs`
- Git pushes require the proxy at `127.0.0.1` (configured in `~/.gitconfig` or via env) or use GitHub MCP tools (`mcp__github__push_files`) as a fallback.
