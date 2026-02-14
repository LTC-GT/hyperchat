# 🚀 Hyperchat

A decentralized P2P chat application with **end-to-end GPG encryption** built on the [DAT ecosystem](https://dat-ecosystem.org/) using Hypercore Protocol.

> **Truly peer-to-peer**: No central servers, no accounts, no tracking. Just cryptographic keys and direct connections.
>
> **🔒 End-to-end encrypted** with 4096-bit RSA GPG keys!

[![License: LGPL-3.0](https://img.shields.io/badge/License-LGPL%20v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![Encryption](https://img.shields.io/badge/encryption-4096--bit%20RSA-blue)](./ARCHITECTURE.md)
[![Status](https://img.shields.io/badge/status-alpha-orange)]()
[![Code Size](https://img.shields.io/badge/code-~1.4k%20lines-blue)]()

## 📸 Screenshots
![image](/.github/media/cliss.png)
![image](/.github/media/webss.png)

> [!TIP]
> Start the web interface with `npm run web` and open http://localhost:3000 and you'll see active peers and messages replicating in real-time as you follow users and send messages from the CLI!

## 🏗️ Project Status

**⚠️ Alpha - Work in Progress**

This project is in active development and considered **alpha** quality. While the core functionality works and is well-tested (83.95% code coverage), expect:
- Breaking API changes
- Bugs and edge cases  
- Missing features from the roadmap
- Documentation updates

**Codebase Stats:**
- ~1,374 lines of source code
- ~2,339 lines of test code
- 58 unit tests + 9 integration tests (all passing ✅)
- Small, focused, and easy to audit

## ✨ Features

### 🔒 Security & Encryption

- **4096-bit RSA GPG Encryption** - End-to-end encrypted direct messages
- **Digital Signatures** - All messages cryptographically signed
- **Signature Verification** - Automatic verification of message authenticity  
- **Import Your Keys** - Use existing GPG keys or generate new ones
- **Offline-Compatible** - Encrypted messages work even when sender is offline

### 💬 Messaging

- 📝 **Append-only logs** using Hypercore for:
  - Chat messages (encrypted or signed)
  - Status updates (signed)
  - Micro-blog posts (signed, max 280 chars)
- 🔐 **Per-user feeds**: Each user has their own cryptographically signed Hypercore feed
- 👥 **Follow system**: Subscribe to other users by their feed keys
- 💬 **Direct messaging**: Send encrypted messages to specific users by username
- 🔗 **Peer notifications**: See when followed users connect
- 🏷️ **Username mapping**: Assign memorable usernames to followed users

### 🌐 Network & Discovery

- 🌐 **P2P Discovery**: Automatic peer discovery using Hyperswarm (DHT + MDNS)
- 💾 **Offline-first**: Works without central servers
- ⚡ **Real-time replication**: Changes sync instantly to connected peers
- 🔄 **Works across networks**: DHT-based discovery works globally

## 🎯 Quick Start

### Installation

```bash
npm install
```

### Start Chatting (CLI)

```bash
# Start as Alice (GPG keys auto-generated)
npm start alice
# or
npm run start alice
```

Or import your existing GPG keys:

```bash
npm start alice --private-key ./my-private.asc --public-key ./my-public.asc
```

In the application:
```bash
# Share your GPG fingerprint (your identity)
/mygpg

# Share your feed key (for others to follow you)
/mykey

# Export your public GPG key to share
/exportkey

# Post a signed public message
Hello, Hyperchat!

# Post a status
/status Building decentralized apps 🚀

# Follow someone with a username (use their feed key)
/follow fc4dfa31d14b3b6eefe6e0c7902143b5... bob

# Send an encrypted direct message to bob
/message bob This message is encrypted end-to-end!

# Post a microblog (≤280 chars)
/blog Decentralization is the future!

# View your network statistics
/stats

# Get help
/help
```

### Web Interface

```bash
# Start the web server
npm run web
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────┐
│            Hyperchat Application                 │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌────────────────┐      ┌──────────────────┐    │
│  │ CryptoManager  │◄────►│  FeedManager     │    │
│  │ - GPG keys     │      │  - Own feed      │    │
│  │ - Encryption   │      │  - Following     │    │
│  │ - Signatures   │      │  - Timeline      │    │
│  └────────────────┘      └─────────┬────────┘    │
│                                    │             │
│                        ┌───────────▼────────┐    │
│                        │  NetworkManager    │    │
│                        │  - Swarm conn.     │    │
│                        │  - Replication     │    │
│                        └────────────────────┘    │
├──────────────────────────────────────────────────┤
│      Hypercore (Append-only Log) + Hyperswarm    │
│           (P2P Network & Discovery)              │
└──────────────────────────────────────────────────┘
```

Each user maintains their own encrypted Hypercore feed. When you follow someone, you replicate their feed and receive updates in real-time.

**See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed technical documentation.**

## 📦 Project Structure

```
hyperchat/
├── src/                      # JavaScript implementation
│   ├── main.js              # CLI application
│   ├── feed-manager.js      # Feed management & encryption
│   ├── crypto-manager.js    # GPG encryption & signatures
│   ├── network-manager.js   # P2P networking
│   ├── encoding.js          # Message serialization
│   └── web-server.js        # Web UI server (demo)
├── test/                    # Test suite
│   └── crypto.test.js       # GPG encryption tests
├── web/                     # Web interface (demo)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── rust/                    # Rust implementation (stub)
│   └── src/                 # See note below
├── storage/                 # Local feed storage (auto-created)
├── ARCHITECTURE.md          # Technical documentation
└── README.md                # This file
```

### 🦀 About the Rust Implementation

The `rust/` folder contains a **stub implementation** and proof-of-concept for a Rust version of Hyperchat that demonstrates the message type system (messages, status updates, microblogs) with serialization/validation, but it doesn't actually implement the full P2P functionality because the Rust ecosystem for Hypercore is still maturing compared to the JavaScript/Node.js version. When run, it displays a warning directing users to use the fully-functional JavaScript implementation instead, while showcasing how the message structures could work in Rust and serving as a foundation for future contributors who want to build a complete Rust port once the Hypercore Rust crates become more feature-complete.

## 💬 Message Types

### Chat Message (Encrypted or Signed)
```javascript
{
  type: 'message',
  content: 'Hello, world!',          // Encrypted if direct message
  timestamp: 1234567890123,
  author: 'alice',
  recipient: 'bob',                  // Optional
  encrypted: true,                   // Indicates encryption
  signature: '...'                   // GPG signature
}
```

### Status Update (Signed)
```javascript
{
  type: 'status',
  content: 'Working on Hyperchat 🚀',
  timestamp: 1234567890123,
  author: 'bob',
  signature: '...'
}
```

### Microblog (≤280 chars, Signed)
```javascript
{
  type: 'microblog',
  content: 'Decentralization is the future!',
  timestamp: 1234567890123,
  author: 'charlie',
  signature: '...'
}
```

## 🌐 Technology Stack

- **[Hypercore](https://github.com/holepunchto/hypercore)**: Append-only log data structure
- **[Hyperswarm](https://github.com/holepunchto/hyperswarm)**: P2P networking and peer discovery
- **[OpenPGP.js](https://openpgpjs.org/)**: 4096-bit RSA encryption and digital signatures
- **Node.js 18+**: ES modules runtime
- **Vanilla JavaScript**: No framework dependencies

## 🧪 Testing with Multiple Users

Open multiple terminals to simulate a P2P network:

```bash
# Terminal 1 - Alice
npm start alice
# Copy Alice's feed key

# Terminal 2 - Bob  
npm start bob
/follow <alice-feed-key> alice
# Wait for "New peer connected: alice" notification

# Terminal 3 - Charlie
npm start charlie
/follow <alice-feed-key> alice
/follow <bob-feed-key> bob

# Charlie sends an encrypted direct message to bob
/message bob Hey Bob, this is Charlie! 🔒✔️
```

Messages replicate automatically between users. Direct messages are encrypted end-to-end!

## 🧪 Testing

Hyperchat includes a comprehensive test suite for GPG encryption.

```bash
# Run all tests
npm test

# Run crypto tests specifically
npm run test:crypto
```

All 6 crypto tests pass! ✅

## 🛠️ Development

### Prerequisites

- Node.js 18+
- npm

### Running in Development Mode

```bash
# Install dependencies
npm install

# Start the CLI
npm run start <username>

# Run tests
npm test
```

## 🔐 Security Notes

- ✅ Each feed is cryptographically signed (Ed25519 by Hypercore)
- ✅ All messages signed with 4096-bit RSA GPG keys
- ✅ Direct messages encrypted end-to-end with GPG
- ✅ Automatic signature verification with visual indicators (🔒✔️)
- ✅ Messages are immutable (append-only)
- ✅ Feed keys serve as transport identifiers
- ⚠️ Metadata (timestamps, recipients) visible on the feed
- ⚠️ Message deletion not possible (by design)
- ⚠️ Keep your GPG private key secure! Never share it
- ⚠️ RSA vulnerable to quantum computers (future risk)

## 🚧 Roadmap & Limitations

### Current Limitations

- Metadata privacy (timestamps, recipients visible to anyone with feed access)
- No perfect forward secrecy (GPG limitation)
- RSA vulnerable to quantum computers (future risk)
- Public messages readable by anyone with the feed key

### Completed Features ✅

- [x] End-to-end encryption (4096-bit RSA GPG)
- [x] Digital signatures for all messages
- [x] Automatic signature verification
- [x] Import/export GPG keys
- [x] Direct encrypted messaging
- [x] Peer connection notifications
- [x] Username mapping system

### Planned Features

- [ ] Group encryption (multi-recipient)
- [ ] Perfect forward secrecy (Signal protocol)
- [ ] Post-quantum cryptography (Kyber/Dilithium)
- [ ] File sharing with encryption
- [ ] User profiles and avatars
- [ ] Search functionality
- [ ] Mobile apps
- [ ] Browser extension

## 🤝 Contributing

Contributions are welcome!

### Ways to Contribute

- 🐛 Report bugs via issues
- 💡 Suggest features
- 📝 Improve documentation
- 🔧 Submit pull requests
- ⭐ Star the project

## 📄 License

This project is licensed under the GNU Lesser General Public License v3.0 or later (LGPL-3.0-or-later).

See [LICENSE](LICENSE) for the full license text.

### What this means:

- ✅ You can use this library in your projects (open source or proprietary)
- ✅ You can modify this library
- ✅ If you distribute modified versions of this library, you must release them under LGPL-3.0-or-later
- ✅ Applications using this library can be under any license

## 🙏 Acknowledgments

- [DAT Ecosystem](https://dat-ecosystem.org/) - For the Hypercore Protocol
- [Holepunch](https://holepunch.to/) - For Hypercore and Hyperswarm implementations
- [OpenPGP.js](https://openpgpjs.org/) - For GPG encryption
- [GNU Privacy Guard](https://gnupg.org/) - For GPG standards and tools
- All contributors and supporters

---

**Built with ❤️ using the DAT ecosystem**