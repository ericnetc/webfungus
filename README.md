# WebFungus — Cloudflare Edition

A networked Reversi-meets-Tetris remake. Two players, one petri dish, deployable to
Cloudflare Workers + Durable Objects with no software installed locally.

## Architecture

- **Worker** (`src/index.js`) routes HTTP. `/ws` upgrades to a WebSocket and forwards
  to the right Durable Object. Other paths serve the static client.
- **Durable Object** `Room` — one instance per room code, identified by `idFromName(code)`.
  Holds the game state in memory while active and persists it to its built-in SQLite
  storage so it survives hibernation. Uses the WebSocket Hibernation API so we don't pay
  for idle time.
- **Static client** (`public/index.html`) — single-file canvas game. Served by the
  Workers `[assets]` binding.

## Deploy without installing anything

You need:
- A free GitHub account
- A free Cloudflare account

### 1. Get the code onto GitHub

1. Sign in to github.com
2. Click **New repository** (top left, green button after login)
3. Name it `webfungus`, leave it public, **don't** check "initialize with README", click **Create**
4. On the empty repo page, click the link **uploading an existing file** (in the quick-setup section)
5. Unzip the project. Drag the **contents** of the unzipped folder into the upload area:
   - `src/` (folder)
   - `public/` (folder)
   - `package.json`
   - `wrangler.jsonc`
   - `README.md`
6. Scroll down, click **Commit changes**

### 2. Deploy from the Cloudflare dashboard

1. Sign in to dash.cloudflare.com
2. In the left sidebar, click **Workers & Pages**
3. Click **Create application**, then **Get started** under "Import a repository"
4. The first time, you'll be asked to install Cloudflare's GitHub app. Pick the `webfungus` repo (or grant access to all repos — your call)
5. Select the `webfungus` repository in the list
6. Cloudflare reads `wrangler.jsonc` and pre-fills most settings. Verify:
   - **Project name:** webfungus
   - **Build command:** (leave empty — there's nothing to build)
   - **Deploy command:** `npx wrangler deploy` (this is the default and is fine)
7. Click **Save and Deploy**

The first deploy takes ~1 minute. When it's done you'll see a URL like
`https://webfungus.<your-subdomain>.workers.dev`.

Open it in two browser windows (or share with a friend). One creates a colony, the other
joins with the 4-letter code.

### 3. Updating the game later

Edit any file directly on GitHub (click file → pencil icon → edit → commit). Cloudflare
watches the repo and redeploys automatically within ~30 seconds. No CLI, ever.

## Rules

- 16×16 grid. Each player seeded in opposite corners.
- Each turn you draw a tetromino from your private 7-bag (all 7 pieces appear once per cycle).
- Place all 4 cells in empty squares; at least one cell must be 4-adjacent to one of yours.
- Press **R** to rotate. Click to place.
- After placing: any straight line of opponent cells bracketed by yours flips to yours, in all 8 directions (Reversi-style).
- If you have no legal placement, your turn is skipped. If both players are stuck, the larger colony wins.
- If your colony ever reaches 0 cells, you lose immediately.

## Files

```
src/index.js         Worker + Durable Object
public/index.html    Static client (the game itself)
wrangler.jsonc       Cloudflare project config
package.json         Marker file (no dependencies — Workers runtime is enough)
```

## Knobs to turn

These are the obvious places to riff on the rules:

- `BOARD_SIZE` in `src/index.js` (default 16). Smaller boards make games sharper.
- `SHAPES` — could add pentominoes or restrict to a smaller set.
- The seed positions in `newGame()` — corners is the symmetric default; centers change opening dynamics.
- `applyFlips` is currently 8-directional. Restrict to 4 for a Go-ish feel.

## Known limitations

- 2 players only. The Worker route assumes 2 slots; extending to 4 means changing
  capacity checks in the DO and adjusting client UI.
- No spectator mode. Third connection to a full room is rejected.
- No reconnect — losing your connection mid-game forfeits.
- The Durable Object persists state across hibernation, but a manual deploy of new code
  does not currently migrate game state. Treat in-flight games as ephemeral during dev.
