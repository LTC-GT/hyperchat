# Hyperchat Rust Implementation

This directory contains a Rust implementation of Hyperchat using Hypercore.

## Setup

To use the Rust version, you'll need the Hypercore Rust crate. As of 2026, you can use:

```toml
[dependencies]
hypercore = "0.12"
tokio = { version = "1.0", features = ["full"] }
anyhow = "1.0"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
```

## Note

The Rust ecosystem for Hypercore is still evolving. The JavaScript implementation is currently more mature and feature-complete. For production use, we recommend the JavaScript/Node.js version in the `src/` directory.

If you want to contribute a full Rust implementation, here's a suggested structure:

```
rust/
├── Cargo.toml
├── src/
│   ├── main.rs           # Entry point
│   ├── feed_manager.rs   # Feed management
│   ├── network.rs        # P2P networking
│   └── types.rs          # Message types
```

## Resources

- Hypercore Protocol Rust: https://github.com/hypercore-protocol/hypercore
- Dat Ecosystem: https://dat-ecosystem.org/
- Holepunch: https://holepunch.to/

For now, please use the JavaScript implementation which is fully functional and ready to use.
