mod types;

use anyhow::Result;
use clap::Parser;
use types::{Message, MessageType};

/// Hyperchat - P2P Chat on Hypercore Protocol
#[derive(Parser, Debug)]
#[clap(author, version, about, long_about = None)]
struct Args {
    /// Username
    #[clap(short, long, default_value = "anonymous")]
    username: String,

    /// Storage directory
    #[clap(short, long, default_value = "./storage")]
    storage: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    println!("╔════════════════════════════════════════╗");
    println!("║     HYPERCHAT (Rust Implementation)   ║");
    println!("╚════════════════════════════════════════╝\n");
    println!("Username: {}", args.username);
    println!("Storage: {}\n", args.storage);

    println!("⚠️  NOTE: Full Rust Hypercore implementation is in development.");
    println!("📦 For a fully functional version, please use the JavaScript");
    println!("   implementation in the src/ directory:\n");
    println!("   $ npm install");
    println!("   $ npm start\n");

    // Demonstrate the message types system
    demo_message_system(&args.username).await?;

    Ok(())
}

async fn demo_message_system(username: &str) -> Result<()> {
    println!("🔧 Demonstrating Hyperchat Message System:\n");

    // Create sample messages
    let messages = vec![
        Message::new(
            MessageType::Message,
            "Hello from Rust!".to_string(),
            username.to_string(),
        ),
        Message::new(
            MessageType::Status,
            "Building Hyperchat in Rust 🦀".to_string(),
            username.to_string(),
        ),
        Message::new(
            MessageType::Microblog,
            "P2P is the future of communication!".to_string(),
            username.to_string(),
        ),
    ];

    for (i, msg) in messages.iter().enumerate() {
        // Validate message
        if let Err(e) = msg.validate() {
            eprintln!("❌ Message {} validation failed: {}", i + 1, e);
            continue;
        }

        // Serialize to JSON (this would be written to Hypercore)
        let json = msg.to_json()?;
        
        // Deserialize back (simulating read from Hypercore)
        let restored = Message::from_json(&json)?;

        println!("📝 Message {}:", i + 1);
        println!("   Type: {:?}", restored.r#type);
        println!("   Content: {}", restored.content);
        println!("   Author: {}", restored.author);
        println!("   Timestamp: {}", restored.timestamp);
        println!();
    }

    println!("✅ Message system working correctly!\n");
    println!("To implement full P2P functionality, you'll need to:");
    println!("  1. Integrate Hypercore Rust crate");
    println!("  2. Implement feed management");
    println!("  3. Add Hyperswarm for P2P networking");
    println!("  4. Build replication logic");
    println!("\nFor now, use the JavaScript version which is fully functional.");

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_demo_system() {
        let result = demo_message_system("test_user").await;
        assert!(result.is_ok());
    }
}
