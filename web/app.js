/**
 * Hyperchat Web UI
 * Note: This is a mock UI for demonstration. In a real implementation,
 * you would need to connect this to the backend via IPC (Electron) 
 * or a WebSocket server.
 */

class HyperchatUI {
  constructor() {
    this.currentType = 'message';
    this.following = [];
    this.timeline = [];
    this.publicKey = null;
    this.username = 'demo-user';
    
    this.init();
  }

  init() {
    // Initialize UI elements
    this.elements = {
      username: document.getElementById('username'),
      followInput: document.getElementById('follow-input'),
      followBtn: document.getElementById('follow-btn'),
      followingList: document.getElementById('following-list'),
      composeInput: document.getElementById('compose-input'),
      postBtn: document.getElementById('post-btn'),
      charCount: document.getElementById('char-count'),
      timelineFeed: document.getElementById('timeline-feed'),
      peerCount: document.getElementById('peer-count'),
      messageCount: document.getElementById('message-count'),
      showKeyBtn: document.getElementById('show-key-btn'),
      modal: document.getElementById('key-modal'),
      publicKeyDisplay: document.getElementById('public-key'),
      copyKeyBtn: document.getElementById('copy-key-btn'),
      closeModal: document.querySelector('.close'),
      tabBtns: document.querySelectorAll('.tab-btn')
    };

    // Set username
    this.elements.username.textContent = `@${this.username}`;

    // Generate mock public key (in real app, this comes from Hypercore)
    this.publicKey = this.generateMockKey();

    // Bind events
    this.bindEvents();

    // Load mock data
    this.loadMockData();

    // Update UI every 5 seconds (simulate network updates)
    setInterval(() => this.updateStats(), 5000);
  }

  bindEvents() {
    // Tab switching
    this.elements.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.elements.tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentType = btn.dataset.type;
        this.updateCharCount();
      });
    });

    // Compose input
    this.elements.composeInput.addEventListener('input', () => {
      this.updateCharCount();
    });

    // Post button
    this.elements.postBtn.addEventListener('click', () => {
      this.postMessage();
    });

    // Follow button
    this.elements.followBtn.addEventListener('click', () => {
      this.followUser();
    });

    // Show key modal
    this.elements.showKeyBtn.addEventListener('click', () => {
      this.showKeyModal();
    });

    // Close modal
    this.elements.closeModal.addEventListener('click', () => {
      this.elements.modal.style.display = 'none';
    });

    // Copy key
    this.elements.copyKeyBtn.addEventListener('click', () => {
      this.copyKey();
    });

    // Close modal on outside click
    window.addEventListener('click', (e) => {
      if (e.target === this.elements.modal) {
        this.elements.modal.style.display = 'none';
      }
    });

    // Enter to post (Ctrl/Cmd + Enter)
    this.elements.composeInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        this.postMessage();
      }
    });
  }

  updateCharCount() {
    const length = this.elements.composeInput.value.length;
    const maxLength = this.currentType === 'microblog' ? 280 : 1000;
    
    this.elements.charCount.textContent = `${length} / ${maxLength}`;
    
    if (this.currentType === 'microblog') {
      this.elements.composeInput.maxLength = 280;
      if (length > 280) {
        this.elements.charCount.style.color = 'var(--danger-color)';
      } else {
        this.elements.charCount.style.color = 'var(--text-secondary)';
      }
    } else {
      this.elements.composeInput.maxLength = 1000;
      this.elements.charCount.style.color = 'var(--text-secondary)';
    }
  }

  postMessage() {
    const content = this.elements.composeInput.value.trim();
    
    if (!content) {
      alert('Message cannot be empty');
      return;
    }

    if (this.currentType === 'microblog' && content.length > 280) {
      alert('Microblog posts must be 280 characters or less');
      return;
    }

    const message = {
      type: this.currentType,
      content,
      timestamp: Date.now(),
      author: this.username,
      feedKey: this.publicKey.slice(0, 16)
    };

    // Add to timeline
    this.timeline.unshift(message);
    this.renderTimeline();

    // Clear input
    this.elements.composeInput.value = '';
    this.updateCharCount();

    // Update stats
    this.updateStats();

    console.log('Posted:', message);
  }

  followUser() {
    const publicKey = this.elements.followInput.value.trim();
    
    if (!publicKey) {
      alert('Please enter a public key');
      return;
    }

    if (publicKey.length < 32) {
      alert('Invalid public key format');
      return;
    }

    if (this.following.includes(publicKey)) {
      alert('Already following this user');
      return;
    }

    this.following.push(publicKey);
    this.renderFollowing();
    this.elements.followInput.value = '';

    console.log('Followed:', publicKey);
  }

  unfollowUser(publicKey) {
    this.following = this.following.filter(k => k !== publicKey);
    this.renderFollowing();
    console.log('Unfollowed:', publicKey);
  }

  renderFollowing() {
    if (this.following.length === 0) {
      this.elements.followingList.innerHTML = '<p class="empty-state">Not following anyone yet</p>';
      return;
    }

    this.elements.followingList.innerHTML = this.following.map(key => `
      <div class="following-item">
        <code>${key.slice(0, 16)}...${key.slice(-8)}</code>
        <button class="unfollow-btn" onclick="app.unfollowUser('${key}')">Unfollow</button>
      </div>
    `).join('');
  }

  renderTimeline() {
    if (this.timeline.length === 0) {
      this.elements.timelineFeed.innerHTML = `
        <div class="empty-state">
          <p>No messages yet. Start posting or follow someone!</p>
        </div>
      `;
      return;
    }

    const typeEmojis = {
      message: '💬',
      status: '📢',
      microblog: '✍️'
    };

    this.elements.timelineFeed.innerHTML = this.timeline.map(msg => {
      const date = new Date(msg.timestamp).toLocaleString();
      const emoji = typeEmojis[msg.type] || '📝';
      
      return `
        <div class="message-card">
          <div class="message-header">
            <span class="message-author">@${msg.author}</span>
            <span class="message-time">${date}</span>
          </div>
          <div class="message-type">${emoji} ${msg.type}</div>
          <div class="message-content">${this.escapeHtml(msg.content)}</div>
        </div>
      `;
    }).join('');
  }

  showKeyModal() {
    this.elements.publicKeyDisplay.textContent = this.publicKey;
    this.elements.modal.style.display = 'block';
  }

  copyKey() {
    navigator.clipboard.writeText(this.publicKey).then(() => {
      this.elements.copyKeyBtn.textContent = '✓ Copied!';
      setTimeout(() => {
        this.elements.copyKeyBtn.textContent = 'Copy to Clipboard';
      }, 2000);
    });
  }

  updateStats() {
    // Simulate network stats (in real app, this comes from NetworkManager)
    const peerCount = Math.floor(Math.random() * 10) + this.following.length;
    this.elements.peerCount.textContent = peerCount;
    this.elements.messageCount.textContent = this.timeline.length;
  }

  loadMockData() {
    // Add some mock messages for demonstration
    const mockMessages = [
      {
        type: 'status',
        content: 'Just set up Hyperchat! Loving the P2P approach. 🚀',
        timestamp: Date.now() - 3600000,
        author: 'alice',
        feedKey: this.generateMockKey().slice(0, 16)
      },
      {
        type: 'message',
        content: 'Hello everyone! This is my first message on Hyperchat.',
        timestamp: Date.now() - 7200000,
        author: 'bob',
        feedKey: this.generateMockKey().slice(0, 16)
      },
      {
        type: 'microblog',
        content: 'Decentralization is the future. No central servers, no censorship, just pure P2P communication. 💪',
        timestamp: Date.now() - 10800000,
        author: 'charlie',
        feedKey: this.generateMockKey().slice(0, 16)
      }
    ];

    this.timeline = [...mockMessages];
    this.renderTimeline();
    this.updateStats();
  }

  generateMockKey() {
    return Array.from({ length: 64 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize app
const app = new HyperchatUI();

// Make app globally available for inline event handlers
window.app = app;

console.log('%cHyperchat UI Loaded', 'color: #6366f1; font-size: 16px; font-weight: bold');
console.log('Note: This is a demo UI. To use the real P2P features, run the Node.js backend.');
