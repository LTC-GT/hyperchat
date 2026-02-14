use serde::{Deserialize, Serialize};

/// Message types supported by Hyperchat
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageType {
    Message,
    Status,
    Microblog,
}

/// A message in the Hyperchat system
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub r#type: MessageType,
    pub content: String,
    pub timestamp: u64,
    pub author: String,
}

impl Message {
    pub fn new(msg_type: MessageType, content: String, author: String) -> Self {
        Self {
            r#type: msg_type,
            content,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            author,
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.content.is_empty() {
            return Err("Content cannot be empty".to_string());
        }

        match self.r#type {
            MessageType::Microblog if self.content.len() > 280 => {
                Err("Microblog posts must be 280 characters or less".to_string())
            }
            _ => Ok(()),
        }
    }

    pub fn to_json(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(self)
    }

    pub fn from_json(data: &[u8]) -> Result<Self, serde_json::Error> {
        serde_json::from_slice(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_creation() {
        let msg = Message::new(
            MessageType::Message,
            "Hello, world!".to_string(),
            "alice".to_string(),
        );
        assert_eq!(msg.content, "Hello, world!");
        assert_eq!(msg.author, "alice");
    }

    #[test]
    fn test_microblog_validation() {
        let long_content = "a".repeat(281);
        let msg = Message::new(
            MessageType::Microblog,
            long_content,
            "bob".to_string(),
        );
        assert!(msg.validate().is_err());

        let valid_content = "a".repeat(280);
        let msg2 = Message::new(
            MessageType::Microblog,
            valid_content,
            "bob".to_string(),
        );
        assert!(msg2.validate().is_ok());
    }

    #[test]
    fn test_serialization() {
        let msg = Message::new(
            MessageType::Status,
            "Working on Rust!".to_string(),
            "charlie".to_string(),
        );

        let json = msg.to_json().unwrap();
        let deserialized = Message::from_json(&json).unwrap();

        assert_eq!(msg.content, deserialized.content);
        assert_eq!(msg.author, deserialized.author);
    }
}
