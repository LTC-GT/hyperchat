# neet

Peer-to-peer CLI chat with text messaging, file sharing, and a voice-ready architecture — all running over Hyperswarm with no central server.

Every room is an [Autobase](https://github.com/holepunchto/autobase) multi-writer log backed by [Corestore](https://github.com/holepunchto/corestore), so messages persist and can be delivered to peers who join later (offline delivery). Invite links use the `pear://neet/...` format.

## Quick start

```bash
pnpm install

# Create your identity (auto-generated on first run)
node bin/neet.js name alice

# Create a room and get the invite link
node bin/neet.js create

# On another terminal, join by link
node bin/neet.js join pear://neet/aqxrtr6dpecgwqdbaq9x7w3p4hk3xqpyoh7gkbgmcn574y7yymro
```

## Web UI

Run from the project root (the folder that contains `package.json`):

```bash
pnpm install
pnpm run build:css
pnpm dev
```

Then open `http://localhost:3000`.

For live UI styling during development:

```bash
pnpm run watch:css
```

### Web UI features

- Server list with multiple rooms
- Text + voice channels with `+` create buttons
- File upload/download in channel chat
- Unicode emoji picker + custom server emojis
- **Server Admin** page (gear icon) for:
  - managing custom emojis
  - setting room admins by public key
- Admin-only emoji management controls
- Voice, video, and screen-share calls from the header

Notes:

- If you see `File descriptor could not be locked`, another process may be using the same Corestore path. The Web UI now auto-falls back to a temporary storage directory for that run.
- You can set your own UI storage path with `NEET_UI_STORAGE=/path/to/storage pnpm dev`.
- Prefer Node LTS (18/20/22). Very new Node versions may be unstable with native storage dependencies.
- Tailwind is built locally with **Tailwind v4 CLI** (`@tailwindcss/cli`), not via CDN.

## Commands

| Command | Description |
|---|---|
| `neet create` | Create a new room, print its invite link |
| `neet join <link>` | Join a room by `pear://neet/...` link or hex key |
| `neet id` | Print your identity (public key + display name) |
| `neet name <name>` | Set your display name |

### In-room commands

| Command | Description |
|---|---|
| `/send <path>` | Share a file (stored in a dedicated Hypercore) |
| `/download <msgId> [dir]` | Download a shared file |
| `/history [n]` | Show the last _n_ messages (default 30) |
| `/peers` | List connected peers |
| `/add-writer <hexKey>` | Grant write access to a peer |
| `/info` | Room key, link, writer/indexer status |
| `/quit` | Leave the room |

Anything else typed at the prompt is sent as a text message.

## Architecture

```
┌──────────────────────────────────────────────────┐
│                   neet node                      │
│                                                  │
│  Identity        Ed25519 keypair (~/.neet/)      │
│  Corestore       Persistent Hypercore storage    │
│  Hyperswarm      DHT-based peer discovery        │
│                                                  │
│  ┌──────────── Room (Autobase) ───────────────┐  │
│  │  Writer cores  →  linearized view core     │  │
│  │  apply: routes add-writer → host.addWriter │  │
│  │         routes messages  → view.append     │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  File transfer   Dedicated Hypercore per file    │
│  Voice (ready)   Protomux "neet-voice" channel   │
└──────────────────────────────────────────────────┘
```

### Key concepts

- **Rooms** — Each room is an Autobase whose bootstrap key is encoded as a `pear://neet/<z32>` invite link. Every writer is also an indexer so any peer can produce the linearized view.
- **Messages** — JSON objects with a `type` field: `text`, `file`, `system`, `reaction`, `voice`. All carry a sender public key, display name, timestamp, and unique ID.
- **Default encryption** — Room messages are encrypted by default with libsodium (`crypto_secretbox`) using a per-room key derived from the room key. `add-writer` control messages remain plaintext so Autobase membership updates still work.
- **File sharing** — Files are split into 64 KiB blocks in a new Hypercore. A `file` message in the room references the core key; recipients replicate it via Corestore.
- **Voice (architecture)** — Real-time audio is *not* routed through Autobase. Instead, a Protomux `neet-voice` channel is opened directly between peers on the Hyperswarm connection, carrying signaling (JSON), raw audio frames, and control messages.
- **Offline delivery** — Because messages live in Hypercores replicated through Corestore, a peer joining later will catch up on the full view history.
- **Paged sync (Git/Torrent-style)** — The Web UI fetches message history in pages by sequence cursor (`beforeSeq`) and loads older pages only when needed, so peers do not transmit an entire database file on each join.

## Project layout

```
bin/neet.js           CLI entry point
lib/
  neet.js             Core orchestrator (Corestore + Hyperswarm + Rooms)
  room.js             Autobase-backed multi-writer room
  messages.js         Message type constructors
  identity.js         Ed25519 keypair management
  file-transfer.js    File send/receive over Hypercore
  voice.js            Protomux voice channel (architecture ready)
test/
  local.js            Same-machine integration test (local DHT testnet)
```

## Testing

The integration test spins up a local [HyperDHT testnet](https://github.com/holepunchto/hyperdht) (no internet needed) and runs two peers through room creation, writer addition, messaging, file sharing, and persistence checks.

```bash
pnpm test
```

## Dependencies

| Package | Purpose |
|---|---|
| autobase | Multi-writer append-only log |
| corestore | Hypercore storage & replication |
| hyperswarm | DHT peer discovery |
| hyperdht | Direct DHT / testnet |
| hypercore | Append-only log primitive |
| hypercore-crypto | Ed25519 key generation |
| protomux | Protocol multiplexing (voice) |
| compact-encoding | Binary encoding |
| sodium-universal | Cryptographic signing |
| z32 | Base32 encoding for invite links |
| b4a | Buffer/Uint8Array utilities |
| chalk | Terminal colors |
