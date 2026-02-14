# Architecture Overview

## System Design

Hyperchat is built on the Hypercore Protocol with end-to-end GPG encryption, creating a hybrid architecture that combines P2P transport with cryptographic security.

```
┌─────────────────────────────────────────────────────────────┐
│                    Hyperchat Application                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐                         │
│  │   CLI/UI     │  │  Web Server  │                         │
│  │   Layer      │  │  (Demo)      │                         │
│  └──────┬───────┘  └──────┬───────┘                         │
│         │                  │                                 │
│         └──────────────────┴──────────────────┘              │
│                            │                                 │
│  ┌─────────────────────────▼─────────────────────────┐      │
│  │            Application Logic Layer                 │      │
│  │  ┌─────────────────┐  ┌──────────────────┐       │      │
│  │  │ CryptoManager   │  │  FeedManager     │       │      │
│  │  │ - GPG keys      │◄─┤  - Own feed      │       │      │
│  │  │ - Encryption    │  │  - Following     │       │      │
│  │  │ - Signatures    │  │  - Timeline      │       │      │
│  │  │ - Verification  │  │  - Username map  │       │      │
│  │  └─────────────────┘  └────────┬─────────┘       │      │
│  │                                 │                 │      │
│  │                      ┌──────────▼──────────┐      │      │
│  │                      │  NetworkManager     │      │      │
│  │                      │  - Swarm conn.      │      │      │
│  │                      │  - Replication      │      │      │
│  │                      │  - Discovery        │      │      │
│  │                      └─────────────────────┘      │      │
│  └────────────────────────────────────────────────────      │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│                       Protocol Layers                         │
│  ┌────────────────────────┐  ┌──────────────────────────┐   │
│  │     Hypercore          │  │      Hyperswarm          │   │
│  │  Append-only Log       │  │   P2P Network Layer      │   │
│  │  - Signed blocks       │  │   - Peer discovery       │   │
│  │  - Merkle trees        │  │   - NAT traversal        │   │
│  │  - Verification        │  │   - Connection mgmt      │   │
│  └────────────────────────┘  └──────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. CryptoManager (Encryption Layer) **NEW**

**Purpose**: Handle all GPG encryption, signing, and key management operations.

**Key Features**:
- Generate 4096-bit RSA key pairs
- Import/export GPG keys (armored format)
- Encrypt messages for specific recipients
- Decrypt received encrypted messages
- Sign all outgoing messages
- Verify signatures on incoming messages
- Extract GPG fingerprints for identity

**Key Methods**:
- `initialize()` - Load or generate GPG keys
- `encryptMessage(message, recipientPublicKey)` - Encrypt+sign message
- `decryptMessage(encryptedMessage, signature)` - Decrypt+verify message
- `signMessage(message)` - Create detached signature
- `verifyMessage(message, signature, publicKey)` - Verify signature
- `getFingerprint()` - Get key fingerprint (identity)
- `exportPublicKey()` - Export public key for sharing
- `exportPrivateKey()` - Export private key (backup only!)

**Security Model**:
```
┌──────────────────────────────────────────┐
│     Message Security Pipeline            │
├──────────────────────────────────────────┤
│                                          │
│  Plaintext Message                       │
│       │                                  │
│       ▼                                  │
│  ┌─────────────┐                        │
│  │ Sign        │ (sender's private key) │
│  └─────┬───────┘                        │
│        │                                 │
│        ▼                                 │
│  ┌─────────────┐                        │
│  │ Encrypt     │ (recipient's pub key)  │
│  └─────┬───────┘                        │
│        │                                 │
│        ▼                                 │
│  Encrypted Message → Hypercore Feed     │
│        │                                 │
│        ▼                                 │
│  ┌─────────────┐                        │
│  │ Decrypt     │ (recipient's priv key) │
│  └─────┬───────┘                        │
│        │                                 │
│        ▼                                 │
│  ┌─────────────┐                        │
│  │ Verify      │ (sender's pub key)     │
│  └─────┬───────┘                        │
│        │                                 │
│        ▼                                 │
│  Plaintext Message (verified ✔️)        │
└──────────────────────────────────────────┘
```

### 2. Hypercore (Data Layer)

**Purpose**: Store messages in an append-only, cryptographically signed log.

**Key Features**:
- Each user has their own Hypercore feed
- Messages are appended as blocks (encrypted or plaintext)
- Each block is cryptographically signed by Hypercore (Ed25519)
- Merkle tree structure for efficient verification
- Immutable history (can't edit past messages)

**Data Flow**:
```
User Input → CryptoManager (Encrypt/Sign) → Encode → Append to Hypercore → Replicate to Peers
```

### 3. FeedManager (Application Logic)

**Responsibilities**:
- Initialize and manage user's own feed
- Track followed feeds and their GPG public keys
- Append messages to own feed (encrypted if direct message)
- Read messages from own and followed feeds
- Decrypt incoming encrypted messages
- Verify signatures on all messages
- Construct timeline from multiple feeds
- Watch for new messages
- Map usernames to feed keys

**Integration with CryptoManager**:
```javascript
// Sending encrypted direct message
async appendMessage(type, content, recipient) {
  let processedContent = content;
  let encrypted = false;
  
  if (recipient && type === 'message') {
    const recipientKey = this.getPublicKeyForUser(recipient);
    processedContent = await this.crypto.encryptMessage(content, recipientKey);
    encrypted = true;
  }
  
  const signature = await this.crypto.signMessage(processedContent);
  
  return this.feed.append({
    type,
    content: processedContent,
    author: this.username,
    recipient,
    encrypted,
    signature,
    timestamp: Date.now()
  });
}

// Reading and verifying messages
async getFeedMessages(feedKey) {
  const messages = await readFromFeed(feedKey);
  
  for (const msg of messages) {
    // Verify signature
    const verified = await this.crypto.verifyMessage(
      msg.content,
      msg.signature,
      msg.authorPublicKey
    );
    
    // Decrypt if encrypted for us
    if (msg.encrypted && msg.recipient === this.username) {
      msg.content = await this.crypto.decryptMessage(msg.content);
    }
    
    msg.verified = verified;
  }
  
  return messages;
}
```

**Key Methods**:
- `initialize(username, crypto)` - Set up user feed with crypto
- `appendMessage(type, content, recipient)` - Post encrypted/signed message
- `followUser(publicKey, username, gpgKey)` - Subscribe to a feed
- `getTimeline()` - Get combined message stream with decryption
- `watchFeed()` - Listen for updates

### 4. NetworkManager (P2P Layer)

**Responsibilities**:
- Manage Hyperswarm connections
- Announce own feed for discovery
- Join swarms for followed feeds
- Replicate feeds with peers
- Handle connection lifecycle
- Notify on peer connections

**Network Flow**:
```
1. User A announces their feed on the DHT
2. User B wants to follow A, joins A's discovery key
3. Hyperswarm finds peers announcing that key
4. Direct connection established (or relay if needed)
5. Feeds replicate in real-time (encrypted content)
6. B decrypts messages using their private key
```

### 5. Encoding Layer

**Purpose**: Serialize/deserialize messages for storage.

Currently uses JSON encoding. Messages are already encrypted by CryptoManager before encoding.

## Message Types

### 1. Encrypted Direct Message
```javascript
{
  type: 'message',
  content: '-----BEGIN PGP MESSAGE-----\n...\n-----END PGP MESSAGE-----',
  timestamp: 1234567890123,
  author: 'alice',
  recipient: 'bob',
  encrypted: true,
  signature: '-----BEGIN PGP SIGNATURE-----\n...\n-----END PGP SIGNATURE-----'
}
```

### 2. Public Message (Signed)
```javascript
{
  type: 'message',
  content: 'Hello, world!',
  timestamp: 1234567890123,
  author: 'alice',
  encrypted: false,
  signature: '-----BEGIN PGP SIGNATURE-----\n...\n-----END PGP SIGNATURE-----'
}
```

### 3. Status Update (Signed)
```javascript
{
  type: 'status',
  content: 'Working on Hyperchat',
  timestamp: 1234567890123,
  author: 'bob',
  signature: '...'
}
```

### 4. Microblog (≤280 chars, Signed)
```javascript
{
  type: 'microblog',
  content: 'Short thought...',
  timestamp: 1234567890123,
  author: 'charlie',
  signature: '...'
}
```

## P2P Network Architecture

### Discovery Process

1. **Local Discovery (MDNS)**
   - Finds peers on same network
   - Fast, no internet required

2. **DHT Discovery**
   - Global peer discovery
   - Uses distributed hash table
   - Based on Kademlia

3. **Relay Discovery**
   - When direct connection fails
   - Uses relay servers
   - Automatic fallback

### Connection Types

```
Direct Connection (Best)
┌──────┐          ┌──────┐
│ Peer │◄────────►│ Peer │
│  A   │          │  B   │
└──────┘          └──────┘

NAT Traversal (Hole Punching)
┌──────┐          ┌──────┐
│ Peer │◄────┬───►│ Peer │
│  A   │     │    │  B   │
└──────┘     │    └──────┘
             │
       ┌─────▼─────┐
       │   DHT     │
       │  Server   │
       └───────────┘

Relay Connection (Fallback)
┌──────┐          ┌──────┐
│ Peer │◄────┐    │ Peer │
│  A   │     │    │  B   │
└──────┘     │    └──────┘
             │
       ┌─────▼─────┐
       │   Relay   │
       │  Server   │
       └───────────┘
```

## Data Flow Diagrams

### Posting an Encrypted Direct Message

```
┌──────┐
│ User │ /message bob "Hello"
└───┬──┘
    │
    ▼
┌──────────────┐
│CryptoManager │
│.encryptMsg() │ ← Bob's public GPG key
└───┬──────────┘
    │ Encrypt + Sign
    ▼
┌──────────────┐
│ FeedManager  │
│.appendMsg()  │
└───┬──────────┘
    │ Encode
    ▼
┌──────────────┐
│  Hypercore   │
│  .append()   │
└───┬──────────┘
    │ Add encrypted block
    ▼
┌──────────────┐
│ NetworkMgr   │
│ Replicate    │
└───┬──────────┘
    │
    ▼
┌──────────────┐
│   Peers      │
│ Bob receives │
└───┬──────────┘
    │
    ▼
┌──────────────┐
│CryptoManager │
│.decryptMsg() │ ← Bob's private key
└───┬──────────┘
    │ Decrypt + Verify
    ▼
┌──────────────┐
│   Display    │
│ "Hello" 🔒✔️ │
└──────────────┘
```

### Following a User

```
┌──────┐
│ User │ /follow <key> alice
└───┬──┘
    ▼
┌──────────────┐
│ NetworkMgr   │
│.followAndRepl│
└───┬──────────┘
    │
    ▼
┌──────────────┐
│ FeedManager  │
│.followUser() │
└───┬──────────┘
    │ Store username + GPG key
    ▼
┌──────────────┐
│  Hypercore   │
│  new feed    │
└───┬──────────┘
    │
    ▼
┌──────────────┐
│ Hyperswarm   │
│  .join()     │
└───┬──────────┘
    │ Find peers
    ▼
┌──────────────┐
│   Peers      │
│  Replicate   │
└──────────────┘
```

### Key Exchange Flow

```
Alice                           Bob
  │                              │
  │ 1. Generate GPG keys         │
  │    (or import existing)      │
  │                              │
  │ 2. Share feed key            │
  ├─────────────────────────────►│
  │                              │
  │                              │ 3. Follow Alice's feed
  │                              │
  │◄─────────────────────────────┤ 4. Share feed key back
  │                              │
  │ 5. Alice announces GPG key   │
  │    in her feed               │
  ├─────────────────────────────►│
  │                              │
  │◄─────────────────────────────┤ 6. Bob announces GPG key
  │                              │
  │ 7. Both now have each        │
  │    other's GPG public keys   │
  │                              │
  │ /message bob "Hi!" 🔒✔️      │
  ├─────────────────────────────►│ 8. Encrypted direct message
  │                              │
```

## Security Model

### Cryptographic Guarantees

1. **Feed Authentication** (Hypercore layer)
   - Public key = Feed identifier (Ed25519)
   - Private key = Signing key (never shared)
   - Each block cryptographically signed

2. **Message Authentication** (GPG layer)
   - 4096-bit RSA signatures on all messages
   - Detached signatures verify author identity
   - Public key fingerprint serves as user identity

3. **Confidentiality** (GPG layer)
   - End-to-end encryption for direct messages
   - Only intended recipient can decrypt
   - Encrypted before storage in Hypercore feed

4. **Integrity** (Both layers)
   - Hypercore: Merkle tree prevents tampering
   - GPG: Signatures detect any modification
   - Append-only: No deletion or editing

### Trust Model

```
┌────────────────────────────────────────┐
│         Trust Architecture             │
├────────────────────────────────────────┤
│                                        │
│  Feed Layer (Hypercore)                │
│  ┌────────────────────────────────┐   │
│  │  Ed25519 cryptographic signing │   │
│  │  - Proves feed ownership       │   │
│  │  - Prevents feed impersonation │   │
│  └────────────────────────────────┘   │
│              ▲                         │
│              │                         │
│  Application Layer (GPG)               │
│  ┌────────────────────────────────┐   │
│  │  RSA-4096 encryption + signing │   │
│  │  - End-to-end confidentiality  │   │
│  │  - Message authenticity        │   │
│  │  - User identity (fingerprint) │   │
│  └────────────────────────────────┘   │
│                                        │
└────────────────────────────────────────┘
```

**Decentralized Trust**:
- No central authority
- Peer trust: You choose who to follow
- Cryptographic verification: Don't trust, verify
- Key fingerprints as identity (out-of-band verification recommended)

### Security Properties

✅ **What Hyperchat Protects**:
- Message content (encrypted direct messages)
- Message authenticity (signatures)
- Feed integrity (Merkle trees)
- Author identity (cryptographic keys)

⚠️ **Current Limitations**:
- **Metadata leakage**: Timestamps, sender/recipient visible on feed
- **No forward secrecy**: Compromised private key exposes all past messages
- **No post-quantum**: RSA vulnerable to quantum computers (future risk)
- **Key distribution**: Manual exchange of feed keys required
- **Revocation**: No built-in key revocation mechanism

### Threat Model

**Protected Against**:
- ✅ Message eavesdropping (encryption)
- ✅ Message forgery (signatures)
- ✅ Feed tampering (Merkle trees)
- ✅ Identity spoofing (key-based authentication)

**NOT Protected Against**:
- ❌ Traffic analysis (who talks to whom)
- ❌ Metadata exposure (timing, frequency)
- ❌ Quantum computing attacks (RSA vulnerability)
- ❌ Compromised endpoints (malware, keyloggers)
- ❌ Social engineering (key substitution)

## Scalability Considerations

### Feed Size
- Append-only means feeds grow indefinitely
- Encrypted messages add overhead (~2-3x plaintext size)
- Sparse replication available (only sync recent messages)
- Could implement pruning/archival for old messages

### Network Connections
- Each followed user = potential peer connections
- Hyperswarm manages connection pooling efficiently
- Scales to hundreds of followed users
- DHT queries distributed across network

### Message Throughput
- Each feed handles thousands of messages
- Replication is efficient (only new blocks synced)
- Background sync doesn't block UI
- Encryption/decryption async, non-blocking

### Storage
- Local storage grows with followed feeds
- Each message ~1-5 KB (encrypted)
- Typical user: 10 follows × 1000 msgs × 3 KB = ~30 MB
- Sparse mode reduces storage requirements

## Extension Points

### 1. Enhanced Encryption
```javascript
// Add perfect forward secrecy (Signal protocol)
const session = new SignalProtocolSession();
const ephemeralKey = await session.ratchet();
const encrypted = await session.encrypt(message);
```

### 2. Group Encryption
```javascript
// Encrypt for multiple recipients
const groupKey = generateGroupKey();
for (const member of group.members) {
  const wrappedKey = await crypto.encryptMessage(groupKey, member.publicKey);
  await sendKeyPackage(member, wrappedKey);
}
```

### 3. File Sharing (Encrypted)
```javascript
// Use Hyperdrive with GPG encryption
const drive = new Hyperdrive(key);
const encryptedFile = await crypto.encryptFile(fileBuffer, recipientKey);
await drive.writeFile('photo.jpg.gpg', encryptedFile);
```

### 4. Post-Quantum Cryptography
```javascript
// Replace RSA with Kyber (post-quantum)
import { kyber1024 } from '@noble/post-quantum/kyber';
const { publicKey, secretKey } = kyber1024.keygen();
const { cipherText, sharedSecret } = kyber1024.encapsulate(publicKey);
```

### 5. Key Revocation
```javascript
// Publish revocation certificate
{
  type: 'key-revocation',
  fingerprint: 'ABC123...',
  revocationCert: '-----BEGIN PGP SIGNATURE-----...',
  reason: 'Key compromised',
  timestamp: Date.now()
}
```

### 6. Moderation
```javascript
// Block list in special feed
const blockList = new Hypercore();
await blockList.append({ 
  blockedFingerprint: '...',
  reason: 'spam' 
});
```

## Performance Optimization

### Caching
- Keep recent messages in memory
- Cache GPG public keys for followed users
- Index by timestamp for fast timeline
- LRU cache for followed feeds
- Cache signature verification results

### Sparse Replication
```javascript
// Only download recent blocks
const feed = new Hypercore(key, {
  sparse: true,
  length: 100 // only last 100 blocks
});
```

### Batch Operations
```javascript
// Append multiple messages at once
await feed.append([msg1, msg2, msg3]);

// Batch signature verification
const results = await Promise.all(
  messages.map(m => crypto.verifyMessage(m))
);
```

### Lazy Decryption
```javascript
// Only decrypt when displaying
async displayMessage(msg) {
  if (msg.encrypted && !msg.decrypted) {
    msg.content = await crypto.decryptMessage(msg.content);
    msg.decrypted = true;
  }
  return msg;
}
```

## Testing Strategy

### 1. Crypto Tests (`test/crypto.test.js`)
- GPG key generation (4096-bit RSA)
- Key import/export (armored format)
- Message encryption/decryption
- Digital signatures
- Signature verification
- All 6 tests passing ✅

### 2. Unit Tests (Future)
- Test individual components in isolation
- Mock dependencies
- Fast execution

### 3. Integration Tests (Future)
- Test feed + network + crypto together
- Multi-peer scenarios
- Encryption end-to-end

### 4. E2E Tests (Future)
- Multi-instance simulations
- Network resilience
- Key exchange flows

### 5. Load Tests (Future)
- Many peers, many messages
- Large encrypted messages
- Key performance metrics

## Technology Stack

### Core Dependencies

- **[Hypercore v10](https://github.com/holepunchto/hypercore)**: Append-only log
- **[Hyperswarm v4](https://github.com/holepunchto/hyperswarm)**: P2P networking
- **[OpenPGP.js v6](https://openpgpjs.org/)**: GPG encryption (4096-bit RSA)
- **b4a**: Buffer utilities
- **compact-encoding**: Message serialization
- **Node.js 18+**: ES modules, native test runner

### Architecture Layers

```
Application Layer (CLI/UI)
    ↕
Business Logic (FeedManager, CryptoManager, NetworkManager)
    ↕
Protocol Layer (Hypercore, Hyperswarm, OpenPGP)
    ↕
Network Layer (TCP/UDP, DHT, MDNS)
```

## Future Roadmap

### Security Enhancements
- [ ] Perfect forward secrecy (Signal protocol)
- [ ] Post-quantum cryptography (Kyber, Dilithium)
- [ ] Key revocation system
- [ ] Multi-device key sync

### Features
- [ ] Group encryption (multi-recipient)
- [ ] File sharing with encryption
- [ ] Voice messages (encrypted)
- [ ] User profiles and avatars
- [ ] Search and indexing
- [ ] Mobile apps (React Native)

### Performance
- [ ] Message pagination
- [ ] Optimized encryption (hardware acceleration)
- [ ] Better caching strategies
- [ ] Sparse replication by default
