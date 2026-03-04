// ─── External module type stubs ───
// These provide the shapes actually used by Quibble, not full API coverage.

declare module 'ws' {
  import { EventEmitter } from 'events'
  import type { Server as HTTPServer } from 'node:http'

  interface WebSocketServerOptions {
    server?: HTTPServer
    port?: number
    host?: string
  }

  class WebSocket extends EventEmitter {
    static readonly OPEN: number
    readonly readyState: number
    readonly OPEN: number
    send (data: string | Buffer): void
    close (): void
    on (event: 'message', cb: (data: Buffer | string) => void): this
    on (event: 'close', cb: () => void): this
    on (event: 'error', cb: (err: Error) => void): this
    on (event: string, cb: (...args: unknown[]) => void): this
  }

  class WebSocketServer extends EventEmitter {
    clients: Set<WebSocket>
    constructor (opts?: WebSocketServerOptions)
    close (): void
    on (event: 'connection', cb: (ws: WebSocket) => void): this
    on (event: 'error', cb: (err: Error) => void): this
    on (event: string, cb: (...args: unknown[]) => void): this
  }

  export { WebSocket, WebSocketServer }
  export default WebSocket
}

declare module 'b4a' {
  function from (input: string | Buffer | Uint8Array, encoding?: string): Buffer
  function toString (buf: Buffer | Uint8Array, encoding?: string): string
  function isBuffer (value: unknown): value is Buffer
  function alloc (size: number, fill?: number): Buffer
  function allocUnsafe (size: number): Buffer
  function concat (buffers: (Buffer | Uint8Array)[], totalLength?: number): Buffer
  function equals (a: Buffer | Uint8Array, b: Buffer | Uint8Array): boolean
  function compare (a: Buffer | Uint8Array, b: Buffer | Uint8Array): number
  function byteLength (input: string | Buffer | Uint8Array, encoding?: string): number
  function copy (source: Buffer, target: Buffer, targetStart?: number, start?: number, end?: number): number
  export { from, toString, isBuffer, alloc, allocUnsafe, concat, equals, compare, byteLength, copy }
}

declare module 'autobase' {
  import { EventEmitter } from 'events'

  export interface AutobaseOpts {
    open?: (store: Corestore) => Hypercore
    apply?: (nodes: AutobaseNode[], view: Hypercore, host: Autobase) => Promise<void>
    valueEncoding?: string
    ackInterval?: number
    encryptionKey?: Buffer | null
  }

  export interface AutobaseNode {
    value: unknown
  }

  export interface Hypercore {
    length: number
    key: Buffer
    discoveryKey: Buffer
    writable: boolean
    get (seq: number): Promise<unknown>
    append (value: unknown): Promise<void>
    ready (): Promise<void>
    update (opts?: { wait?: boolean }): Promise<void>
  }

  export interface Corestore {
    ready (): Promise<void>
    close (): Promise<void>
    get (nameOrKey: string | Buffer | { name?: string; valueEncoding?: string }, opts?: { valueEncoding?: string }): Hypercore
    namespace (name: string): Corestore
    session (): Corestore
    replicate (socket: unknown): void
  }

  class Autobase extends EventEmitter {
    key: Buffer
    discoveryKey: Buffer
    writable: boolean
    isIndexer: boolean
    view: Hypercore
    local: { key: Buffer }
    constructor (store: Corestore, bootstrapKey: Buffer | null, opts?: AutobaseOpts)
    ready (): Promise<void>
    update (): Promise<void>
    append (value: unknown): Promise<void>
    addWriter (key: Buffer, opts?: { indexer?: boolean }): Promise<void>
    activeWriters: unknown[]
    close (): Promise<void>
  }

  export default Autobase
}

declare module 'corestore' {
  import type { Hypercore, Corestore as CorestoreBase } from 'autobase'

  class Corestore implements CorestoreBase {
    constructor (storage: string)
    ready (): Promise<void>
    close (): Promise<void>
    get (nameOrKey: string | Buffer | { name?: string; valueEncoding?: string }, opts?: { valueEncoding?: string }): Hypercore
    namespace (name: string): Corestore
    session (): Corestore
    replicate (socket: unknown): void
  }
  export default Corestore
}

declare module 'hyperswarm' {
  import { EventEmitter } from 'events'

  export interface PeerInfo {
    publicKey: Buffer
  }

  export interface SwarmSocket {
    remotePublicKey: Buffer
    on (event: string, cb: (...args: unknown[]) => void): this
    once (event: string, cb: (...args: unknown[]) => void): this
    write (data: Buffer): boolean
  }

  class Hyperswarm extends EventEmitter {
    connections: Set<SwarmSocket>
    constructor (opts?: Record<string, unknown>)
    flush (): Promise<void>
    on (event: 'connection', cb: (socket: SwarmSocket, info: PeerInfo) => void): this
    on (event: string, cb: (...args: unknown[]) => void): this
    join (topic: Buffer, opts?: { server?: boolean; client?: boolean }): void
    leave (topic: Buffer): Promise<void>
    destroy (): Promise<void>
  }

  export default Hyperswarm
}

declare module 'hyperdht/testnet' {
  function createTestnet (opts?: unknown): Promise<{ bootstrap: unknown[] }>
  export default createTestnet
}

declare module 'hypercore-crypto' {
  interface KeyPair {
    publicKey: Buffer
    secretKey: Buffer
  }
  const crypto: {
    keyPair (seed?: Buffer): KeyPair
    randomBytes (n: number): Buffer
    discoveryKey (key: Buffer): Buffer
  }
  export default crypto
}

declare module 'sodium-universal' {
  const sodium: {
    crypto_generichash (out: Buffer, input: Buffer, key?: Buffer | null): void
    crypto_secretbox_easy (cipher: Buffer, message: Buffer, nonce: Buffer, key: Buffer): void
    crypto_secretbox_open_easy (message: Buffer, cipher: Buffer, nonce: Buffer, key: Buffer): boolean
    crypto_sign_detached (sig: Buffer, message: Buffer, secretKey: Buffer): void
    crypto_sign_verify_detached (sig: Buffer, message: Buffer, publicKey: Buffer): boolean
    randombytes_buf (buf: Buffer): void
    crypto_generichash_BYTES: number
    crypto_secretbox_KEYBYTES: number
    crypto_secretbox_NONCEBYTES: number
    crypto_secretbox_MACBYTES: number
    crypto_sign_BYTES: number
  }
  export default sodium
}

declare module 'protomux' {
  export interface ProtomuxMessage {
    send (buf: Buffer): void
  }

  export interface Channel {
    messages: ProtomuxMessage[]
    open (): void
    close (): void
  }

  export interface Mux {
    createChannel (opts: { protocol: string; onopen?: () => void; onclose?: () => void }): Channel
  }

  const Protomux: {
    from (socket: unknown): Mux
  }
  export default Protomux
}

declare module 'compact-encoding' {
  interface Encoding {
    preencode (state: unknown, value: unknown): void
    encode (state: unknown, value: unknown): void
    decode (state: unknown): unknown
  }
  const enc: {
    buffer: Encoding
    raw: Encoding
    string: Encoding
  }
  export default enc
}

declare module 'compact-encoding-struct' {
  const struct: unknown
  export default struct
}

declare module 'z32' {
  const z32: {
    encode (buf: Buffer): string
    decode (str: string): Buffer
  }
  export default z32
}

declare module 'bip39' {
  type Wordlist = string[]
  const wordlists: { english: Wordlist; [lang: string]: Wordlist }
  function generateMnemonic (strength?: number, rng?: (size: number) => Buffer, wordlist?: Wordlist): string
  function mnemonicToEntropy (mnemonic: string, wordlist?: Wordlist): string
  function entropyToMnemonic (entropy: string | Buffer, wordlist?: Wordlist): string
  function validateMnemonic (mnemonic: string, wordlist?: Wordlist): boolean
  export { generateMnemonic, mnemonicToEntropy, entropyToMnemonic, validateMnemonic, wordlists, Wordlist }
}
