# Quibble

#### Futura Vox Libera

Peer-to-peer CLI chat with text messaging, file sharing, and a voice-ready architecture — all running over Hyperswarm with no central server.

Quibble is built on the `quibble` protocol.

Every room is an [Autobase](https://github.com/holepunchto/autobase) multi-writer log backed by [Corestore](https://github.com/holepunchto/corestore), so messages persist and can be delivered to peers who join later (offline delivery). Invite links use the `pear://quibble/...` format.

## Quick start

```bash
pnpm install

# Create your identity (auto-generated on first run)
pnpm quibble name alice

# Create a room and get the invite link
pnpm quibble create

# On another terminal, join by link
pnpm quibble join pear://quibble/aqxrtr6dpecgwqdbaq9x7w3p4hk3xqpyoh7gkbgmcn574y7yymro
```

## Web UI

Run from the project root (the folder that contains `package.json`):

```bash
pnpm install
pnpm run build:css
pnpm dev
```

Then open `http://localhost:3000`.

### Run two local clients on one machine

To test calls/chat/server features between two separate local users simultaneously:

```bash
pnpm run dev:dual
```

This launches two isolated Quibble UI servers:

- `http://127.0.0.1:3000` (client-a)
- `http://127.0.0.1:3001` (client-b)

Each instance uses separate identity/storage directories under `.quibble-dev/`, so they behave as distinct clients.
Use separate browser profiles or one normal + one private/incognito window when testing side-by-side.

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

- If you see `File descriptor could not be locked`, another process is likely still using the same Corestore path. The Web UI now retries briefly, then exits with a clear error instead of switching to temporary storage (to prevent rooms from appearing to disappear across restarts).
- You can set your own UI storage path with `QUIBBLE_UI_STORAGE=/path/to/storage pnpm dev`.
- WebRTC video calls use a LAN-friendly STUN baseline by default. For stricter NAT/firewall environments, provide your own TURN/STUN via `QUIBBLE_ICE_SERVERS_JSON`, e.g. `QUIBBLE_ICE_SERVERS_JSON='[{"urls":["stun:stun.l.google.com:19302"]},{"urls":["turn:turn.example.com:3478"],"username":"user","credential":"pass"}]' pnpm dev`.
- Prefer Node LTS (18/20/22). Very new Node versions may be unstable with native storage dependencies.
- Tailwind is built locally with **Tailwind v4 CLI** (`@tailwindcss/cli`), not via CDN.

## Commands

| Command | Description |
|---|---|
| `quibble create` | Create a new room, print its invite link |
| `quibble join <link>` | Join a room by `pear://quibble/...` link or hex key |
| `quibble id` | Print your identity (public key + display name) |
| `quibble name <name>` | Set your display name |

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
│                 Quibble node                     │
│                                                  │
│  Identity        Ed25519 keypair (~/.quibble/)   │
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
│  Voice (ready)   Protomux "quibble-voice" channel │
└──────────────────────────────────────────────────┘
```

### Key concepts

- **Rooms** — Each room is an Autobase whose bootstrap key is encoded as a `pear://quibble/<z32>` invite link. Every writer is also an indexer so any peer can produce the linearized view.
- **Messages** — JSON objects with a `type` field: `text`, `file`, `system`, `reaction`, `voice`. All carry a sender public key, display name, timestamp, and unique ID.
- **Default encryption** — Room messages are encrypted by default with libsodium (`crypto_secretbox`) using a per-room key derived from the room key. `add-writer` control messages remain plaintext so Autobase membership updates still work.
- **File sharing** — Files are split into 64 KiB blocks in a new Hypercore. A `file` message in the room references the core key; recipients replicate it via Corestore.
- **Voice (architecture)** — Real-time audio is *not* routed through Autobase. Instead, a Protomux `quibble-voice` channel is opened directly between peers on the Hyperswarm connection, carrying signaling (JSON), raw audio frames, and control messages.
- **Offline delivery** — Because messages live in Hypercores replicated through Corestore, a peer joining later will catch up on the full view history.
- **Paged sync (Git/Torrent-style)** — The Web UI fetches message history in pages by sequence cursor (`beforeSeq`) and loads older pages only when needed, so peers do not transmit an entire database file on each join.

## Project layout

```
bin/quibble.js        CLI entry point (command: quibble)
lib/
  quibble.js          Core orchestrator (Corestore + Hyperswarm + Rooms)
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
