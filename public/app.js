import { SimplePool, nip19 } from 'https://esm.sh/nostr-tools@2.10.0';
import { BunkerSigner, parseBunkerInput } from 'https://esm.sh/nostr-tools@2.10.0/nip46';
import { generateSecretKey, getPublicKey as getPublicKeyFromSecret } from 'https://esm.sh/nostr-tools@2.10.0/pure';
import qrGenerator from 'https://esm.sh/qrcode-generator@1.4.4';

// ─── SVG Icons ──────────────────────────────────────────────────────────────────

const ICONS = {
  reply: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  like: '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  repost: '<svg viewBox="0 0 24 24"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  zap: '<svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  externalLink: '<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  userX: '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/></svg>',
  code: '<svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  hash: '<svg viewBox="0 0 24 24"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
  user: '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
};

// ─── Settings ───────────────────────────────────────────────────────────────────

const Settings = {
  defaults: {
    sortMode: 'trust-desc',
    maxNotes: 150,
    timeWindow: 2,
    maxHops: 3,
    trustedOnly: true,
    trustWeight: 0.7,
    trustThreshold: 0,
    showTrustFooter: true,
    showDebug: false,
    compactMode: false,
    relays: ['wss://relay.damus.io'],
    mutedPubkeys: [],
    bookmarks: {},
    theme: 'dark',
  },
  _data: null,

  load() {
    try {
      const raw = localStorage.getItem('wot-feed-settings');
      const saved = raw ? JSON.parse(raw) : {};
      this._data = { ...this.defaults, ...saved };
    } catch {
      this._data = { ...this.defaults };
    }
  },

  save() {
    try {
      localStorage.setItem('wot-feed-settings', JSON.stringify(this._data));
    } catch { /* quota exceeded */ }
  },

  get(key) {
    if (!this._data) this.load();
    return key in this._data ? this._data[key] : this.defaults[key];
  },

  set(key, value) {
    if (!this._data) this.load();
    this._data[key] = value;
    this.save();
  },
};

// ─── Helpers: hex <-> bytes ──────────────────────────────────────────────────────

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Signer Abstraction ─────────────────────────────────────────────────────────

const Signer = {
  _backend: null,   // 'nip07' | 'nip46' | 'readonly' | null
  _pubkey: null,
  _bunkerSigner: null,

  isLoggedIn() {
    return this._backend !== null;
  },

  isReadOnly() {
    return this._backend === 'readonly';
  },

  async initNip07() {
    if (!window.nostr) throw new Error('No NIP-07 extension found');
    this._pubkey = await window.nostr.getPublicKey();
    this._backend = 'nip07';
    return this._pubkey;
  },

  async initNip46(input, clientSecretKey) {
    const pool = new SimplePool();
    const parsed = await parseBunkerInput(input);
    if (!parsed) throw new Error('Invalid bunker input');
    const signer = new BunkerSigner(clientSecretKey, parsed, { pool });
    await signer.connect();
    this._bunkerSigner = signer;
    this._pubkey = await signer.getPublicKey();
    this._backend = 'nip46';
    return this._pubkey;
  },

  async reconnectNip46(savedInput, clientSecretHex) {
    const secretBytes = hexToBytes(clientSecretHex);
    return this.initNip46(savedInput, secretBytes);
  },

  setReadOnly() {
    this._backend = 'readonly';
    this._pubkey = null;
  },

  async getPublicKey() {
    if (!this._backend || this._backend === 'readonly') return null;
    return this._pubkey;
  },

  async signEvent(event) {
    if (this._backend === 'nip07') {
      return window.nostr.signEvent(event);
    }
    if (this._backend === 'nip46' && this._bunkerSigner) {
      return this._bunkerSigner.signEvent(event);
    }
    throw new Error('No signer available');
  },

  disconnect() {
    if (this._bunkerSigner) {
      try { this._bunkerSigner.close(); } catch (_) { /* ignore */ }
      this._bunkerSigner = null;
    }
    this._backend = null;
    this._pubkey = null;
  },
};

// ─── Auth Manager ───────────────────────────────────────────────────────────────

const Auth = {
  _modal: null,
  _extensionBtn: null,
  _bunkerInput: null,
  _bunkerConnectBtn: null,
  _readOnlyBtn: null,
  _statusEl: null,
  _errorEl: null,

  init() {
    this._modal = document.getElementById('login-modal');
    this._extensionBtn = document.getElementById('login-extension-btn');
    this._bunkerInput = document.getElementById('login-bunker-input');
    this._bunkerConnectBtn = document.getElementById('login-bunker-connect');
    this._readOnlyBtn = document.getElementById('login-readonly-btn');
    this._statusEl = document.getElementById('login-status');
    this._errorEl = document.getElementById('login-error');

    this._qrBtn = document.getElementById('login-qr-btn');
    this._qrContainer = document.getElementById('login-qr-container');

    this._extensionBtn.addEventListener('click', () => this._connectExtension());
    this._bunkerConnectBtn.addEventListener('click', () => this._connectBunker());
    this._qrBtn.addEventListener('click', () => this._connectQR());
    this._readOnlyBtn.addEventListener('click', () => this._browseReadOnly());
  },

  // ── QR subscription cleanup ──
  _qrPool: null,
  _qrTimeout: null,

  async start() {
    const saved = this._loadSession();
    if (saved) {
      try {
        if (saved.method === 'nip07') {
          this._showStatus('Reconnecting to extension...');
          this._modal.classList.add('open');
          const hasExt = await this._detectExtension();
          if (hasExt) {
            await Signer.initNip07();
            this._hideModal();
            this._postLogin();
            return;
          }
          // Extension gone — clear session and show modal
          this._clearSession();
          this._showError('Extension not found. Please log in again.');
          this._hideStatus();
        } else if (saved.method === 'nip46') {
          this._showStatus('Reconnecting to bunker...');
          this._modal.classList.add('open');
          await Signer.reconnectNip46(saved.bunkerInput, saved.clientSecret);
          this._hideModal();
          this._postLogin();
          return;
        } else if (saved.method === 'readonly') {
          Signer.setReadOnly();
          this._postLogin();
          return;
        }
      } catch (e) {
        this._clearSession();
        this._showError('Reconnection failed: ' + e.message);
        this._hideStatus();
      }
    }

    // No saved session or reconnection failed — show modal
    this._modal.classList.add('open');
    this._detectExtension().then(found => {
      this._extensionBtn.disabled = !found;
      if (found) {
        this._extensionBtn.textContent = 'Connect with Extension';
      } else {
        this._extensionBtn.textContent = 'No extension detected';
      }
    });
  },

  async _connectExtension() {
    this._hideError();
    this._showStatus('Connecting to extension...');
    this._extensionBtn.disabled = true;
    try {
      await Signer.initNip07();
      this._saveSession({ method: 'nip07' });
      this._hideModal();
      this._postLogin();
    } catch (e) {
      this._showError(e.message);
      this._extensionBtn.disabled = false;
    }
    this._hideStatus();
  },

  async _connectBunker() {
    const input = this._bunkerInput.value.trim();
    if (!input) {
      this._showError('Enter a bunker:// URL or NIP-05 address');
      return;
    }
    this._hideError();
    this._showStatus('Connecting to bunker...');
    this._bunkerConnectBtn.disabled = true;
    try {
      const clientSecret = generateSecretKey();
      const clientSecretHex = bytesToHex(clientSecret);
      await Signer.initNip46(input, clientSecret);
      this._saveSession({ method: 'nip46', bunkerInput: input, clientSecret: clientSecretHex });
      this._hideModal();
      this._postLogin();
    } catch (e) {
      this._showError(e.message);
      this._bunkerConnectBtn.disabled = false;
    }
    this._hideStatus();
  },

  async _connectQR() {
    this._hideError();
    this._cancelQR();

    const clientSecret = generateSecretKey();
    const clientPubkey = getPublicKeyFromSecret(clientSecret);
    const nip46Relay = 'wss://relay.nsec.app';

    const metadata = encodeURIComponent(JSON.stringify({ name: 'Nostr WoT Feed' }));
    const uri = `nostrconnect://${clientPubkey}?relay=${encodeURIComponent(nip46Relay)}&metadata=${metadata}`;

    this._showQR(uri);
    this._showStatus('Scan with your signer app (Amber, nsec.app, etc.)');

    const pool = new SimplePool();
    this._qrPool = pool;
    const since = Math.floor(Date.now() / 1000) - 5;

    try {
      const signerPubkey = await new Promise((resolve, reject) => {
        this._qrTimeout = setTimeout(() => {
          reject(new Error('Connection timed out — try again'));
        }, 120000);

        pool.subscribeMany(
          [nip46Relay],
          [{ kinds: [24133], '#p': [clientPubkey], since }],
          {
            onevent: (event) => {
              clearTimeout(this._qrTimeout);
              resolve(event.pubkey);
            },
          }
        );
      });

      this._showStatus('Signer found, connecting...');

      const bunkerPointer = { pubkey: signerPubkey, relays: [nip46Relay] };
      const signer = new BunkerSigner(clientSecret, bunkerPointer, { pool });
      await signer.connect();

      Signer._bunkerSigner = signer;
      Signer._pubkey = await signer.getPublicKey();
      Signer._backend = 'nip46';

      const clientSecretHex = bytesToHex(clientSecret);
      const bunkerInput = `bunker://${signerPubkey}?relay=${encodeURIComponent(nip46Relay)}`;
      this._saveSession({ method: 'nip46', bunkerInput, clientSecret: clientSecretHex });

      this._hideQR();
      this._hideModal();
      this._postLogin();
    } catch (e) {
      this._hideQR();
      this._showError(e.message);
    }
    this._hideStatus();
  },

  _showQR(uri) {
    const qr = qrGenerator(0, 'M');
    qr.addData(uri);
    qr.make();
    document.getElementById('login-qr-code').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    document.getElementById('login-qr-uri').value = uri;
    this._qrContainer.style.display = 'block';
  },

  _hideQR() {
    if (this._qrContainer) this._qrContainer.style.display = 'none';
  },

  _cancelQR() {
    if (this._qrTimeout) { clearTimeout(this._qrTimeout); this._qrTimeout = null; }
    this._qrPool = null;
    this._hideQR();
  },

  _browseReadOnly() {
    Signer.setReadOnly();
    this._saveSession({ method: 'readonly' });
    this._hideModal();
    this._postLogin();
  },

  _postLogin() {
    this._updateAuthIndicator();
    document.dispatchEvent(new CustomEvent('auth-ready'));
  },

  logout() {
    Signer.disconnect();
    this._cancelQR();
    this._clearSession();
    this._updateAuthIndicator();
    // Reset UI
    this._bunkerInput.value = '';
    this._bunkerConnectBtn.disabled = false;
    this._extensionBtn.disabled = true;
    this._hideError();
    this._hideStatus();
    this._modal.classList.add('open');
    this._detectExtension().then(found => {
      this._extensionBtn.disabled = !found;
      this._extensionBtn.textContent = found ? 'Connect with Extension' : 'No extension detected';
    });
  },

  _updateAuthIndicator() {
    const pairs = [
      [document.getElementById('auth-status'), document.getElementById('auth-label')],
      [document.getElementById('auth-status-m'), document.getElementById('auth-label-m')],
    ];
    const methodLabel = document.getElementById('settings-auth-method');
    const logoutSection = document.getElementById('settings-account-section');

    if (Signer.isLoggedIn() && !Signer.isReadOnly()) {
      const backend = Signer._backend === 'nip07' ? 'Extension' : 'Bunker';
      for (const [dot, label] of pairs) {
        if (!dot) continue;
        dot.className = 'status-dot connected';
        label.textContent = backend;
      }
      if (methodLabel) methodLabel.textContent = 'Connected via ' + backend;
      if (logoutSection) logoutSection.style.display = '';
    } else if (Signer.isReadOnly()) {
      for (const [dot, label] of pairs) {
        if (!dot) continue;
        dot.className = 'status-dot unavailable';
        label.textContent = 'Read-only';
      }
      if (methodLabel) methodLabel.textContent = 'Read-only mode';
      if (logoutSection) logoutSection.style.display = '';
    } else {
      for (const [dot, label] of pairs) {
        if (!dot) continue;
        dot.className = 'status-dot';
        label.textContent = 'Auth';
      }
      if (methodLabel) methodLabel.textContent = '';
      if (logoutSection) logoutSection.style.display = 'none';
    }
  },

  async _detectExtension() {
    const delays = [0, 500, 1500];
    for (const d of delays) {
      if (d > 0) await new Promise(r => setTimeout(r, d));
      if (window.nostr) return true;
    }
    return false;
  },

  _showStatus(msg) {
    this._statusEl.textContent = msg;
    this._statusEl.style.display = 'block';
  },

  _hideStatus() {
    this._statusEl.style.display = 'none';
  },

  _showError(msg) {
    this._errorEl.textContent = msg;
    this._errorEl.style.display = 'block';
  },

  _hideError() {
    this._errorEl.style.display = 'none';
  },

  _hideModal() {
    this._modal.classList.remove('open');
  },

  _saveSession(data) {
    try { localStorage.setItem('wot-feed-auth', JSON.stringify(data)); } catch { /* ignore */ }
  },

  _loadSession() {
    try {
      const raw = localStorage.getItem('wot-feed-auth');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  _clearSession() {
    try { localStorage.removeItem('wot-feed-auth'); } catch { /* ignore */ }
  },
};

// ─── Debug Logger ───────────────────────────────────────────────────────────────

const Debug = {
  panel: null,
  enabled: false,

  init() {
    this.panel = document.getElementById('debug-panel');
    this.enabled = Settings.get('showDebug');
    if (this.enabled) this.panel.classList.add('visible');
  },

  setEnabled(val) {
    this.enabled = val;
    this.panel.classList.toggle('visible', val);
    Settings.set('showDebug', val);
  },

  log(msg, type = '') {
    console.log(`[WoT] ${msg}`);
    if (!this.panel) return;
    const line = document.createElement('div');
    line.className = `debug-line ${type}`;
    line.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
    this.panel.appendChild(line);
    this.panel.scrollTop = this.panel.scrollHeight;
    while (this.panel.children.length > 200) {
      this.panel.removeChild(this.panel.firstChild);
    }
  },
};

// ─── Toast ──────────────────────────────────────────────────────────────────────

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2500);
}

// ─── Theme Manager ──────────────────────────────────────────────────────────────

const Theme = {
  current: 'dark',

  init() {
    this.current = Settings.get('theme');
    this.apply();
    document.getElementById('theme-toggle').addEventListener('click', () => this.toggle());
  },

  apply() {
    document.documentElement.setAttribute('data-theme', this.current);
    const sunIcon = document.querySelector('#theme-toggle .icon-sun');
    const moonIcon = document.querySelector('#theme-toggle .icon-moon');
    if (this.current === 'dark') {
      sunIcon.style.display = '';
      moonIcon.style.display = 'none';
    } else {
      sunIcon.style.display = 'none';
      moonIcon.style.display = '';
    }
  },

  toggle() {
    this.current = this.current === 'dark' ? 'light' : 'dark';
    Settings.set('theme', this.current);
    this.apply();
  },
};

// ─── Dropdown Manager ───────────────────────────────────────────────────────────

const DropdownManager = {
  activeDropdown: null,

  init() {
    document.addEventListener('click', (e) => {
      if (this.activeDropdown && !e.target.closest('.note-more-wrap')) {
        this.close();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  },

  open(dropdownEl) {
    if (this.activeDropdown && this.activeDropdown !== dropdownEl) {
      this.activeDropdown.classList.remove('open');
    }
    dropdownEl.classList.add('open');
    this.activeDropdown = dropdownEl;
  },

  close() {
    if (this.activeDropdown) {
      this.activeDropdown.classList.remove('open');
      this.activeDropdown = null;
    }
  },

  toggle(dropdownEl) {
    if (dropdownEl.classList.contains('open')) {
      this.close();
    } else {
      this.open(dropdownEl);
    }
  },
};

// ─── Content Renderer ───────────────────────────────────────────────────────────

const ContentRenderer = {
  render(content) {
    const tokens = this._tokenize(content);
    let result = '';
    let pos = 0;
    for (const t of tokens) {
      if (t.start > pos) {
        result += escapeHtml(content.slice(pos, t.start));
      }
      result += this._renderToken(t);
      pos = t.end;
    }
    if (pos < content.length) {
      result += escapeHtml(content.slice(pos));
    }
    return result;
  },

  _tokenize(content) {
    const tokens = [];
    let m;

    // URLs
    const urlRe = /https?:\/\/[^\s<>"')\]]+/g;
    while ((m = urlRe.exec(content)) !== null) {
      tokens.push({ start: m.index, end: m.index + m[0].length, type: 'url', value: m[0] });
    }

    // nostr: mentions
    const nostrRe = /nostr:(npub1|note1|nevent1|nprofile1)[a-z0-9]+/gi;
    while ((m = nostrRe.exec(content)) !== null) {
      tokens.push({ start: m.index, end: m.index + m[0].length, type: 'nostr', value: m[0] });
    }

    // Hashtags (# at start of string or after whitespace)
    const hashRe = /(^|\s)#(\w{1,50})/g;
    while ((m = hashRe.exec(content)) !== null) {
      const hashStart = m.index + m[1].length;
      const hashEnd = m.index + m[0].length;
      tokens.push({ start: hashStart, end: hashEnd, type: 'hashtag', value: '#' + m[2] });
    }

    // Sort by position, remove overlaps
    tokens.sort((a, b) => a.start - b.start);
    const cleaned = [];
    let lastEnd = 0;
    for (const t of tokens) {
      if (t.start >= lastEnd) {
        cleaned.push(t);
        lastEnd = t.end;
      }
    }
    return cleaned;
  },

  _renderToken(token) {
    switch (token.type) {
      case 'url': return this._renderUrl(token.value);
      case 'nostr': return this._renderNostr(token.value);
      case 'hashtag': return this._renderHashtag(token.value);
      default: return escapeHtml(token.value);
    }
  },

  _renderUrl(url) {
    // Images
    if (/\.(jpg|jpeg|png|gif|webp)(\?[^\s]*)?$/i.test(url)) {
      return `<img class="note-image" src="${escapeAttr(url)}" alt="" loading="lazy" onclick="window.open('${escapeAttr(url)}','_blank')">`;
    }
    // Videos
    if (/\.(mp4|mov|webm)(\?[^\s]*)?$/i.test(url)) {
      return `<video class="note-video" src="${escapeAttr(url)}" controls preload="metadata"></video>`;
    }
    // YouTube
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
    if (ytMatch) {
      return `<div class="note-embed"><iframe src="https://www.youtube.com/embed/${escapeAttr(ytMatch[1])}" frameborder="0" allowfullscreen loading="lazy"></iframe></div>`;
    }
    // Vimeo
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) {
      return `<div class="note-embed"><iframe src="https://player.vimeo.com/video/${escapeAttr(vimeoMatch[1])}" frameborder="0" allowfullscreen loading="lazy"></iframe></div>`;
    }
    // Regular link
    return `<a class="note-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
  },

  _renderNostr(raw) {
    const value = raw.slice(6); // remove "nostr:"
    try {
      nip19.decode(value);
      const display = value.slice(0, 12) + '...' + value.slice(-4);
      const href = `https://njump.me/${encodeURIComponent(value)}`;
      return `<a class="nostr-mention" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(display)}</a>`;
    } catch {
      return `<span class="nostr-mention">${escapeHtml(raw)}</span>`;
    }
  },

  _renderHashtag(raw) {
    return `<span class="hashtag">${escapeHtml(raw)}</span>`;
  },
};

// ─── Profile Manager ────────────────────────────────────────────────────────────

const Profiles = {
  cache: new Map(),
  pendingPubkeys: new Set(),
  fetchTimer: null,
  onUpdate: null,

  get(pubkey) {
    return this.cache.get(pubkey) || null;
  },

  request(pubkey) {
    if (this.cache.has(pubkey) || this.pendingPubkeys.has(pubkey)) return;
    this.pendingPubkeys.add(pubkey);
    if (!this.fetchTimer) {
      this.fetchTimer = setTimeout(() => this.fetchBatch(), 800);
    }
  },

  async fetchBatch() {
    this.fetchTimer = null;
    if (this.pendingPubkeys.size === 0) return;

    const pubkeys = [...this.pendingPubkeys];
    this.pendingPubkeys.clear();
    Debug.log(`Fetching ${pubkeys.length} profiles (Kind 0)`, 'info');

    const pool = Relay.pool;
    if (!pool) return;

    const events = await pool.querySync(
      Relay.getUrls(),
      { kinds: [0], authors: pubkeys }
    );

    const latest = new Map();
    for (const ev of events) {
      const existing = latest.get(ev.pubkey);
      if (!existing || ev.created_at > existing.created_at) {
        latest.set(ev.pubkey, ev);
      }
    }

    const updatedPubkeys = [];
    for (const [pk, ev] of latest) {
      try {
        const meta = JSON.parse(ev.content);
        this.cache.set(pk, {
          name: meta.name || meta.display_name || '',
          displayName: meta.display_name || meta.name || '',
          picture: meta.picture || '',
          about: meta.about || '',
          nip05: meta.nip05 || '',
        });
        updatedPubkeys.push(pk);
      } catch (_) { /* invalid JSON */ }
    }

    Debug.log(`Loaded ${updatedPubkeys.length} profiles`, 'success');
    if (updatedPubkeys.length > 0 && this.onUpdate) {
      this.onUpdate(updatedPubkeys);
    }
  },
};

// ─── Parent Notes Cache ──────────────────────────────────────────────────────────

const ParentNotes = {
  cache: new Map(),
  pendingIds: new Set(),
  fetchTimer: null,
  onUpdate: null,

  get(eventId) {
    // Check local feed first
    const local = Feed.notesById?.get(eventId);
    if (local) return { pubkey: local.pubkey, content: local.content };
    return this.cache.get(eventId) || null;
  },

  request(eventId) {
    if (!eventId) return;
    if (this.cache.has(eventId) || this.pendingIds.has(eventId)) return;
    // Skip if already in local feed
    if (Feed.notesById?.has(eventId)) return;
    this.pendingIds.add(eventId);
    if (!this.fetchTimer) {
      this.fetchTimer = setTimeout(() => this.fetchBatch(), 1200);
    }
  },

  async fetchBatch() {
    this.fetchTimer = null;
    if (this.pendingIds.size === 0) return;

    const ids = [...this.pendingIds];
    this.pendingIds.clear();
    Debug.log(`Fetching ${ids.length} parent notes`, 'info');

    const pool = Relay.pool;
    if (!pool) return;

    const events = await pool.querySync(
      Relay.getUrls(),
      { ids }
    );

    const fetched = [];
    for (const ev of events) {
      if (!this.cache.has(ev.id)) {
        this.cache.set(ev.id, { pubkey: ev.pubkey, content: ev.content });
        Profiles.request(ev.pubkey);
        fetched.push(ev.id);
      }
    }

    Debug.log(`Loaded ${fetched.length} parent notes`, 'success');
    if (fetched.length > 0 && this.onUpdate) {
      this.onUpdate(fetched);
    }
  },
};

// ─── WoT Manager ────────────────────────────────────────────────────────────────

const WOT_ORACLE_URL = 'https://wot-oracle.mappingbitcoin.com';

const WoT = {
  cache: new Map(),
  myPubkey: null,
  hasExtension: false,
  _methods: {},

  // Documented distance → score weights
  _scoreFromDistance(d) {
    if (d <= 0 || d === Infinity) return 0;
    if (d === 1) return 1.0;
    if (d === 2) return 0.5;
    if (d === 3) return 0.25;
    return 0.1;
  },

  async init() {
    await new Promise(r => setTimeout(r, 300));

    this.hasExtension = !!(window.nostr?.wot);
    Debug.log(`window.nostr exists: ${!!window.nostr}`, 'info');
    Debug.log(`window.nostr.wot exists: ${this.hasExtension}`, 'info');

    if (window.nostr?.wot) {
      const wot = window.nostr.wot;
      const names = [];
      for (const k in wot) {
        if (typeof wot[k] === 'function') {
          this._methods[k] = true;
          names.push(k);
        }
      }
      Debug.log(`WoT extension methods: ${names.join(', ')}`, 'info');
    }

    if (Signer.isLoggedIn()) {
      try {
        this.myPubkey = await Signer.getPublicKey();
        if (this.myPubkey) {
          Debug.log(`My pubkey: ${this.myPubkey.slice(0, 12)}...`, 'success');
        }
      } catch (e) {
        Debug.log(`getPublicKey failed: ${e.message}`, 'error');
      }
    }

    if (!this.hasExtension) {
      Debug.log('No WoT extension — will use oracle fallback.', 'info');
    }

    return { hasExtension: this.hasExtension };
  },

  // ── Single score (cache-only safety net) ──

  async scoreSingle(pubkey) {
    if (this.cache.has(pubkey)) return this.cache.get(pubkey);
    // If not cached, run a mini batch of 1
    await this.scoreBatch([pubkey]);
    return this.cache.get(pubkey) || { score: 0, distance: Infinity, trusted: false };
  },

  // ── Main batch scorer — picks the best available strategy ──

  async scoreBatch(pubkeys) {
    const uncached = pubkeys.filter(pk => !this.cache.has(pk));
    if (uncached.length === 0) return;

    Debug.log(`Scoring ${uncached.length} pubkeys...`, 'info');

    if (this.hasExtension) {
      await this._scoreBatchExtension(uncached);
    } else if (this.myPubkey) {
      await this._scoreBatchOracle(uncached);
    } else {
      for (const pk of uncached) {
        this.cache.set(pk, { score: 0, distance: Infinity, trusted: false });
      }
    }

    Debug.log(`Scoring complete. Cache: ${this.cache.size}`, 'success');
  },

  // ── Extension strategy ──
  // 1. filterByWoT (1 call) to partition in-WoT vs out
  // 2. getDetails / getDistance for in-WoT pubkeys (rate-limited)

  async _scoreBatchExtension(pubkeys) {
    const wot = window.nostr.wot;
    let toDetail = pubkeys;

    // Step 1: Bulk filter — 1 call eliminates most pubkeys
    if (this._methods.filterByWoT) {
      try {
        const maxHops = Settings.get('maxHops');
        const inWot = await wot.filterByWoT(pubkeys, maxHops + 2);
        const inWotSet = new Set(Array.isArray(inWot) ? inWot : []);

        // Cache misses as untrusted immediately
        for (const pk of pubkeys) {
          if (!inWotSet.has(pk)) {
            this.cache.set(pk, { score: 0, distance: Infinity, trusted: false });
          }
        }

        toDetail = pubkeys.filter(pk => inWotSet.has(pk));
        Debug.log(`filterByWoT: ${inWotSet.size} in WoT, ${pubkeys.length - inWotSet.size} out`, 'info');
      } catch (e) {
        Debug.log(`filterByWoT failed: ${e.message}`, 'error');
        toDetail = pubkeys;
      }
    }

    // Step 2: Get details for in-WoT pubkeys, rate-limited
    if (toDetail.length === 0) return;

    const RATE_PER_SEC = 8;
    const DELAY_MS = Math.ceil(1000 / RATE_PER_SEC);

    for (let i = 0; i < toDetail.length; i++) {
      const pk = toDetail[i];
      if (this.cache.has(pk)) continue;

      const result = { score: 0, distance: Infinity, trusted: false };

      try {
        // Prefer getDetails (1 call → score + distance + everything)
        if (this._methods.getDetails) {
          const details = await wot.getDetails(pk);
          if (details) {
            result.distance = details.distance ?? details.hops ?? Infinity;
            result.score = details.score ?? details.trustScore ?? 0;
            if (result.distance < Infinity && result.distance > 0) result.trusted = true;
            if (result.score > 0) result.trusted = true;
            // Fill score from distance if extension only returned distance
            if (result.trusted && result.score === 0) {
              result.score = this._scoreFromDistance(result.distance);
            }
          }
        }
        // Fallback: getDistance only (1 call, compute score locally)
        else if (this._methods.getDistance) {
          const raw = await wot.getDistance(pk);
          const d = typeof raw === 'number' ? raw : (raw?.distance ?? raw?.hops ?? null);
          if (d !== null && d > 0) {
            result.distance = d;
            result.trusted = true;
            result.score = this._scoreFromDistance(d);
          }
        }
        // Last resort: getTrustScore (1 call)
        else if (this._methods.getTrustScore) {
          const raw = await wot.getTrustScore(pk);
          const s = typeof raw === 'number' ? raw : (raw?.score ?? raw?.trust ?? 0);
          if (s > 0) {
            result.score = s;
            result.trusted = true;
          }
        }
      } catch (e) {
        // On rate limit, pause longer then retry
        if (e.message && e.message.includes('Rate limit')) {
          Debug.log(`Rate limited — pausing 2s (${i}/${toDetail.length})`, 'error');
          await new Promise(r => setTimeout(r, 2000));
          i--; // retry this pubkey
          continue;
        }
        Debug.log(`WoT error ${pk.slice(0, 8)}: ${e.message}`, 'error');
      }

      this.cache.set(pk, result);

      // Rate-limit delay between calls
      if (i < toDetail.length - 1) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }
  },

  // ── Oracle fallback — batch distance query ──

  async _scoreBatchOracle(pubkeys) {
    if (!this.myPubkey) return;

    // Process in chunks of 50 for the oracle batch endpoint
    for (let i = 0; i < pubkeys.length; i += 50) {
      const chunk = pubkeys.slice(i, i + 50);
      const uncached = chunk.filter(pk => !this.cache.has(pk));
      if (uncached.length === 0) continue;

      try {
        const resp = await fetch(`${WOT_ORACLE_URL}/distance/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: this.myPubkey, targets: uncached }),
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        // data could be an object { pubkey: distance } or array
        if (data && typeof data === 'object') {
          for (const pk of uncached) {
            const d = data[pk] ?? data.distances?.[pk] ?? null;
            if (d !== null && typeof d === 'number' && d > 0) {
              this.cache.set(pk, {
                score: this._scoreFromDistance(d),
                distance: d,
                trusted: true,
              });
            } else {
              this.cache.set(pk, { score: 0, distance: Infinity, trusted: false });
            }
          }
        }

        Debug.log(`Oracle: scored ${uncached.length} pubkeys`, 'info');
      } catch (e) {
        Debug.log(`Oracle batch failed: ${e.message}`, 'error');

        // Individual fallback via GET /distance
        for (const pk of uncached) {
          if (this.cache.has(pk)) continue;
          try {
            const r = await fetch(`${WOT_ORACLE_URL}/distance?from=${this.myPubkey}&to=${pk}`);
            if (r.ok) {
              const d = await r.json();
              const dist = typeof d === 'number' ? d : (d?.distance ?? null);
              if (dist !== null && dist > 0) {
                this.cache.set(pk, { score: this._scoreFromDistance(dist), distance: dist, trusted: true });
                continue;
              }
            }
          } catch (_) { /* ignore individual failures */ }
          this.cache.set(pk, { score: 0, distance: Infinity, trusted: false });
        }
      }
    }
  },
};

// ─── Mute Manager ───────────────────────────────────────────────────────────────

const Mute = {
  list: new Set(),

  init() {
    // Mute list is loaded from relay only — no localStorage
  },

  async loadFromRelay() {
    if (!WoT.myPubkey) {
      Debug.log('Mute: skipping relay load — no pubkey', 'info');
      return;
    }
    try {
      Debug.log('Mute: loading kind 10000 from relays...', 'info');
      const events = await Relay.pool.querySync(
        Relay.getUrls(),
        { kinds: [10000], authors: [WoT.myPubkey] }
      );
      if (events.length === 0) {
        Debug.log('Mute: no kind 10000 event found on relays', 'info');
        return;
      }
      const latest = events.reduce((a, b) => a.created_at > b.created_at ? a : b);
      const relayPubkeys = latest.tags
        .filter(t => t[0] === 'p' && t[1])
        .map(t => t[1]);
      this.list.clear();
      relayPubkeys.forEach(pk => this.list.add(pk));
      Debug.log(`Mute: loaded ${this.list.size} entries from relay`, 'success');
    } catch (e) {
      Debug.log(`Mute: relay load failed: ${e.message}`, 'error');
    }
  },

  async publishToRelay() {
    if (!Signer.isLoggedIn() || Signer.isReadOnly()) {
      Debug.log('Mute: cannot publish — no signer available', 'error');
      return;
    }
    try {
      const tags = [...this.list].map(pk => ['p', pk]);
      const event = {
        kind: 10000,
        content: '',
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };
      const signed = await Signer.signEvent(event);
      await Relay.publishEvent(signed);
      Debug.log(`Mute: published kind 10000 with ${tags.length} entries`, 'success');
      showToast('Mute list synced to relay');
    } catch (e) {
      Debug.log(`Mute: publish failed: ${e.message}`, 'error');
      showToast('Mute list publish failed');
    }
  },

  isMuted(pubkey) {
    return this.list.has(pubkey);
  },

  toggle(pubkey) {
    if (this.list.has(pubkey)) {
      this.list.delete(pubkey);
    } else {
      this.list.add(pubkey);
    }
    this.publishToRelay();
  },

  unmute(pubkey) {
    this.list.delete(pubkey);
    this.publishToRelay();
  },
};

// ─── Bookmarks Manager ─────────────────────────────────────────────────────────

const Bookmarks = {
  list: new Map(),

  init() {
    const saved = Settings.get('bookmarks');
    if (saved && typeof saved === 'object') {
      for (const [id, data] of Object.entries(saved)) {
        this.list.set(id, data);
      }
    }
  },

  has(noteId) {
    return this.list.has(noteId);
  },

  toggle(noteId, noteData) {
    if (this.list.has(noteId)) {
      this.list.delete(noteId);
    } else {
      this.list.set(noteId, { ...noteData });
    }
    this._save();
  },

  _save() {
    const obj = {};
    for (const [id, data] of this.list) {
      obj[id] = data;
    }
    Settings.set('bookmarks', obj);
  },
};

// ─── Relay Manager ──────────────────────────────────────────────────────────────

const Relay = {
  pool: null,
  sub: null,
  onEvent: null,
  onStatus: null,

  getUrls() {
    return Settings.get('relays');
  },

  init(onEvent, onStatus) {
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.pool = new SimplePool();
    this.connect();
  },

  connect() {
    const urls = this.getUrls();
    const hours = Settings.get('timeWindow');
    const since = Math.floor(Date.now() / 1000) - hours * 60 * 60;
    const limit = Settings.get('maxNotes');

    Debug.log(`Subscribing to ${urls.length} relay(s) since ${new Date(since * 1000).toLocaleTimeString()}`, 'info');

    this.sub = this.pool.subscribeMany(
      urls,
      [{ kinds: [1], since, limit }],
      {
        onevent: (event) => {
          if (this.onEvent) this.onEvent(event);
        },
        oneose: () => {
          Debug.log('EOSE — initial batch complete', 'success');
          if (this.onStatus) this.onStatus('eose');
        },
        onclose: (reason) => {
          Debug.log(`Sub closed: ${JSON.stringify(reason)}`, 'error');
          if (this.onStatus) this.onStatus('disconnected');
        },
      }
    );

    if (this.onStatus) this.onStatus('connected');
  },

  reconnect() {
    if (this.sub) {
      this.sub.close();
      this.sub = null;
    }
    this.connect();
  },

  addRelay(url) {
    const urls = this.getUrls();
    if (urls.includes(url)) return false;
    Settings.set('relays', [...urls, url]);
    this.reconnect();
    return true;
  },

  removeRelay(url) {
    const urls = this.getUrls();
    const filtered = urls.filter(u => u !== url);
    if (filtered.length === 0) return false; // keep at least one
    Settings.set('relays', filtered);
    this.reconnect();
    return true;
  },

  async publishEvent(event) {
    await Promise.any(this.pool.publish(this.getUrls(), event));
  },
};

// ─── Interactions ───────────────────────────────────────────────────────────────

const Actions = {
  liked: new Set(),
  reposted: new Set(),

  async like(noteId, authorPubkey) {
    if (this.liked.has(noteId)) return;
    if (!Signer.isLoggedIn() || Signer.isReadOnly()) { showToast('Login required'); return; }

    try {
      const event = {
        kind: 7,
        content: '+',
        tags: [['e', noteId], ['p', authorPubkey]],
        created_at: Math.floor(Date.now() / 1000),
      };
      const signed = await Signer.signEvent(event);
      await Relay.publishEvent(signed);
      this.liked.add(noteId);
      showToast('Liked!');
      const btn = document.querySelector(`.note[data-id="${noteId}"] .action-like`);
      if (btn) btn.classList.add('liked');
    } catch (e) {
      Debug.log(`Like failed: ${e.message}`, 'error');
      showToast('Like failed');
    }
  },

  async repost(noteId, authorPubkey) {
    if (this.reposted.has(noteId)) return;
    if (!Signer.isLoggedIn() || Signer.isReadOnly()) { showToast('Login required'); return; }

    try {
      const relayHint = Relay.getUrls()[0] || '';
      const event = {
        kind: 6,
        content: '',
        tags: [['e', noteId, relayHint], ['p', authorPubkey]],
        created_at: Math.floor(Date.now() / 1000),
      };
      const signed = await Signer.signEvent(event);
      await Relay.publishEvent(signed);
      this.reposted.add(noteId);
      showToast('Reposted!');
      const btn = document.querySelector(`.note[data-id="${noteId}"] .action-repost`);
      if (btn) btn.classList.add('reposted');
    } catch (e) {
      Debug.log(`Repost failed: ${e.message}`, 'error');
      showToast('Repost failed');
    }
  },

  async reply(noteId, authorPubkey, content) {
    if (!content.trim()) return;
    if (!Signer.isLoggedIn() || Signer.isReadOnly()) { showToast('Login required'); return; }

    try {
      const relayHint = Relay.getUrls()[0] || '';
      const event = {
        kind: 1,
        content: content.trim(),
        tags: [['e', noteId, relayHint, 'reply'], ['p', authorPubkey]],
        created_at: Math.floor(Date.now() / 1000),
      };
      const signed = await Signer.signEvent(event);
      await Relay.publishEvent(signed);
      showToast('Reply sent!');
    } catch (e) {
      Debug.log(`Reply failed: ${e.message}`, 'error');
      showToast('Reply failed');
    }
  },

  async zap(noteId, authorPubkey) {
    showToast('Zaps require a Lightning wallet (coming soon)');
  },
};

// ─── Profile Modal ──────────────────────────────────────────────────────────────

const ProfileModal = {
  overlay: null,
  currentPubkey: null,

  init() {
    this.overlay = document.getElementById('profile-modal');
    document.getElementById('pm-close').addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    // Mute button
    document.getElementById('pm-mute').addEventListener('click', () => {
      if (!this.currentPubkey) return;
      Mute.toggle(this.currentPubkey);
      this._updateMuteButton();
      Feed.scheduleRender(true);
      SettingsDrawer.updateMutedList();
    });

    // Swipe-to-dismiss (swipe down)
    let touchStartY = 0;
    const modal = this.overlay.querySelector('.profile-modal');
    modal.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    modal.addEventListener('touchend', (e) => {
      if (e.changedTouches[0].clientY - touchStartY > 80) this.close();
    }, { passive: true });
  },

  _updateMuteButton() {
    const btn = document.getElementById('pm-mute');
    const muted = Mute.isMuted(this.currentPubkey);
    btn.textContent = muted ? 'Unmute' : 'Mute';
    btn.classList.toggle('muted', muted);
  },

  open(pubkey) {
    this.currentPubkey = pubkey;
    const profile = Profiles.get(pubkey);
    const trust = WoT.cache.get(pubkey) || { score: 0, distance: Infinity, trusted: false };
    const avatarColor = pubkeyColor(pubkey);
    const initials = (profile?.displayName || profile?.name || pubkey.slice(0, 2)).slice(0, 2).toUpperCase();

    const banner = document.getElementById('pm-banner');
    banner.style.background = `linear-gradient(135deg, ${avatarColor}, ${pubkeyColor(pubkey.split('').reverse().join(''))})`;

    const avatarEl = document.getElementById('pm-avatar');
    if (profile?.picture) {
      avatarEl.innerHTML = `<img src="${escapeAttr(profile.picture)}" alt="" onerror="this.parentElement.style.background='${avatarColor}';this.parentElement.textContent='${initials}';this.remove()">`;
      avatarEl.style.background = '';
    } else {
      avatarEl.textContent = initials;
      avatarEl.style.background = avatarColor;
    }

    let npubFull;
    try { npubFull = nip19.npubEncode(pubkey); } catch { npubFull = pubkey; }

    document.getElementById('pm-name').textContent = profile?.displayName || profile?.name || truncateNpub(pubkey);
    document.getElementById('pm-npub').textContent = npubFull;
    document.getElementById('pm-nip05').textContent = profile?.nip05 || '';
    document.getElementById('pm-about').textContent = profile?.about || 'No bio available.';

    document.getElementById('pm-trust-score').textContent = trust.score.toFixed(3);
    document.getElementById('pm-distance').textContent = trust.distance < Infinity ? `${trust.distance} hops` : 'Unknown';

    const noteForAuthor = Feed.notes.find(n => n.pubkey === pubkey);
    document.getElementById('pm-combined').textContent = noteForAuthor
      ? noteForAuthor.combinedScore.toFixed(3)
      : trust.score.toFixed(3);

    document.getElementById('pm-trusted').textContent = trust.trusted ? 'Yes' : 'No';
    document.getElementById('pm-trusted').style.color = trust.trusted ? 'var(--green)' : 'var(--red)';

    const bar = document.getElementById('pm-trust-bar');
    const pct = Math.min(100, Math.max(0, trust.score * 100));
    bar.style.width = `${pct}%`;
    if (trust.score > 0.6) bar.style.background = 'var(--green)';
    else if (trust.score > 0.3) bar.style.background = 'var(--yellow)';
    else if (trust.score > 0) bar.style.background = 'var(--peach)';
    else bar.style.background = 'var(--text-muted)';

    this._updateMuteButton();
    this.overlay.classList.add('open');
  },

  close() {
    this.overlay.classList.remove('open');
    this.currentPubkey = null;
  },
};

// ─── Composer ───────────────────────────────────────────────────────────────────

const Composer = {
  overlay: null,
  textarea: null,
  charCount: null,
  publishBtn: null,

  init() {
    this.overlay = document.getElementById('compose-modal');
    this.textarea = document.getElementById('compose-textarea');
    this.charCount = document.getElementById('compose-char-count');
    this.publishBtn = document.getElementById('compose-publish');

    document.getElementById('fab').addEventListener('click', () => this.open());
    document.getElementById('compose-close').addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    this.textarea.addEventListener('input', () => {
      this.charCount.textContent = this.textarea.value.length;
      this.publishBtn.disabled = this.textarea.value.trim().length === 0;
    });

    this.publishBtn.addEventListener('click', () => this.publish());
  },

  open() {
    this.textarea.value = '';
    this.charCount.textContent = '0';
    this.publishBtn.disabled = true;
    this.overlay.classList.add('open');
    setTimeout(() => this.textarea.focus(), 100);
  },

  close() {
    this.overlay.classList.remove('open');
  },

  async publish() {
    const content = this.textarea.value.trim();
    if (!content) return;
    if (!Signer.isLoggedIn() || Signer.isReadOnly()) { showToast('Login required'); return; }

    this.publishBtn.disabled = true;
    try {
      const event = {
        kind: 1,
        content,
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      };
      const signed = await Signer.signEvent(event);
      await Relay.publishEvent(signed);

      // Optimistic insert into feed
      Feed.addEvent(signed);

      this.close();
      showToast('Note published!');
    } catch (e) {
      Debug.log(`Publish failed: ${e.message}`, 'error');
      showToast('Publish failed');
      this.publishBtn.disabled = false;
    }
  },
};

// ─── Settings Drawer ────────────────────────────────────────────────────────────

const SettingsDrawer = {
  overlay: null,
  drawer: null,

  init() {
    this.overlay = document.getElementById('settings-overlay');
    this.drawer = document.getElementById('settings-drawer');

    document.getElementById('settings-btn').addEventListener('click', () => this.open());
    document.getElementById('settings-close').addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', () => this.close());

    // Swipe-to-dismiss (swipe right)
    let touchStartX = 0;
    this.drawer.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
    }, { passive: true });
    this.drawer.addEventListener('touchend', (e) => {
      if (e.changedTouches[0].clientX - touchStartX > 80) this.close();
    }, { passive: true });

    this._wireControls();
  },

  _wireControls() {
    // Sort
    const sortSelect = document.getElementById('sort-select');
    sortSelect.value = Settings.get('sortMode');
    sortSelect.addEventListener('change', () => {
      Settings.set('sortMode', sortSelect.value);
      Feed.setSortMode(sortSelect.value);
    });

    // Max Notes
    const maxNotesSlider = document.getElementById('max-notes-slider');
    const maxNotesValue = document.getElementById('max-notes-value');
    maxNotesSlider.value = Settings.get('maxNotes');
    maxNotesValue.textContent = Settings.get('maxNotes');
    maxNotesSlider.addEventListener('input', () => {
      const val = parseInt(maxNotesSlider.value, 10);
      maxNotesValue.textContent = val;
      Settings.set('maxNotes', val);
    });

    // Time Window
    const timeSlider = document.getElementById('time-window-slider');
    const timeValue = document.getElementById('time-window-value');
    timeSlider.value = Settings.get('timeWindow');
    timeValue.textContent = Settings.get('timeWindow') + 'h';
    timeSlider.addEventListener('input', () => {
      const val = parseInt(timeSlider.value, 10);
      timeValue.textContent = val + 'h';
      Settings.set('timeWindow', val);
    });
    timeSlider.addEventListener('change', () => {
      // Reconnect on release to apply new time window
      Relay.reconnect();
    });

    // Max Hops
    const trustSlider = document.getElementById('trust-slider');
    const sliderLabel = document.getElementById('slider-label');
    trustSlider.value = Settings.get('maxHops');
    sliderLabel.textContent = Settings.get('maxHops');
    trustSlider.addEventListener('input', () => {
      const hops = parseInt(trustSlider.value, 10);
      sliderLabel.textContent = hops;
      Settings.set('maxHops', hops);
      Feed.setMaxHops(hops);
    });

    // Trusted Only
    const trustedToggle = document.getElementById('trusted-only');
    trustedToggle.checked = Settings.get('trustedOnly');
    trustedToggle.addEventListener('change', () => {
      Settings.set('trustedOnly', trustedToggle.checked);
      Feed.setTrustedOnly(trustedToggle.checked);
    });

    // Trust Weight
    const weightSlider = document.getElementById('trust-weight-slider');
    const weightValue = document.getElementById('trust-weight-value');
    weightSlider.value = Math.round(Settings.get('trustWeight') * 100);
    weightValue.textContent = Settings.get('trustWeight').toFixed(1);
    weightSlider.addEventListener('input', () => {
      const val = parseInt(weightSlider.value, 10) / 100;
      weightValue.textContent = val.toFixed(1);
      Settings.set('trustWeight', val);
    });

    // Trust Threshold
    const thresholdSlider = document.getElementById('trust-threshold-slider');
    const thresholdValue = document.getElementById('trust-threshold-value');
    if (thresholdSlider) {
      thresholdSlider.value = Settings.get('trustThreshold');
      thresholdValue.textContent = Settings.get('trustThreshold') + '%';
      thresholdSlider.addEventListener('input', () => {
        const val = parseInt(thresholdSlider.value, 10);
        thresholdValue.textContent = val + '%';
        Settings.set('trustThreshold', val);
      });
      thresholdSlider.addEventListener('change', () => {
        Feed.scheduleRender(true);
      });
    }

    // Show Trust Footer
    const footerToggle = document.getElementById('show-trust-footer');
    footerToggle.checked = Settings.get('showTrustFooter');
    footerToggle.addEventListener('change', () => {
      Settings.set('showTrustFooter', footerToggle.checked);
      Feed.scheduleRender(true);
    });

    // Debug
    const debugToggle = document.getElementById('debug-toggle');
    debugToggle.checked = Settings.get('showDebug');
    debugToggle.addEventListener('change', () => {
      Debug.setEnabled(debugToggle.checked);
    });

    // Compact Mode
    const compactToggle = document.getElementById('compact-mode');
    compactToggle.checked = Settings.get('compactMode');
    document.body.classList.toggle('compact', Settings.get('compactMode'));
    compactToggle.addEventListener('change', () => {
      Settings.set('compactMode', compactToggle.checked);
      document.body.classList.toggle('compact', compactToggle.checked);
    });

    // Relay Add
    document.getElementById('relay-add-btn').addEventListener('click', () => {
      const input = document.getElementById('relay-input');
      const url = input.value.trim();
      if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
        showToast('Relay URL must start with wss://');
        return;
      }
      if (Relay.addRelay(url)) {
        input.value = '';
        this.updateRelayList();
        showToast('Relay added');
      } else {
        showToast('Relay already exists');
      }
    });

    this.updateRelayList();
    this.updateMutedList();
  },

  updateRelayList() {
    const container = document.getElementById('relay-list');
    const urls = Relay.getUrls();
    container.innerHTML = '';
    for (const url of urls) {
      const item = document.createElement('div');
      item.className = 'relay-item';
      item.innerHTML = `
        <span class="relay-status-dot"></span>
        <span class="relay-url">${escapeHtml(url)}</span>
        ${urls.length > 1 ? '<button class="relay-remove" title="Remove">&times;</button>' : ''}
      `;
      const removeBtn = item.querySelector('.relay-remove');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          Relay.removeRelay(url);
          this.updateRelayList();
          showToast('Relay removed');
        });
      }
      container.appendChild(item);
    }
  },

  updateMutedList() {
    const container = document.getElementById('muted-list');
    if (Mute.list.size === 0) {
      container.innerHTML = '<p class="settings-empty">No muted users</p>';
      return;
    }
    container.innerHTML = '';
    for (const pk of Mute.list) {
      const profile = Profiles.get(pk);
      const displayName = profile?.displayName || profile?.name || truncateNpub(pk);
      const item = document.createElement('div');
      item.className = 'muted-item';
      item.innerHTML = `
        <span class="muted-name">${escapeHtml(displayName)}</span>
        <button class="unmute-btn">Unmute</button>
      `;
      item.querySelector('.unmute-btn').addEventListener('click', () => {
        Mute.unmute(pk);
        this.updateMutedList();
        Feed.scheduleRender(true);
      });
      container.appendChild(item);
    }
  },

  open() {
    this.updateRelayList();
    this.updateMutedList();
    this.overlay.classList.add('open');
    this.drawer.classList.add('open');
  },

  close() {
    this.overlay.classList.remove('open');
    this.drawer.classList.remove('open');
  },
};

// ─── Feed Manager ───────────────────────────────────────────────────────────────

const RENDER_THROTTLE_MS = 600;
const PAGE_SIZE = 20;

const Feed = {
  notes: [],
  maxHops: 3,
  trustedOnly: true,
  sortMode: 'trust-desc',
  feedEl: null,
  loadingEl: null,
  emptyEl: null,
  totalReceived: 0,
  seenIds: new Set(),
  authors: new Set(),
  pendingQueue: [],
  processing: false,
  notesById: new Map(),
  domNodes: new Map(),
  renderTimer: null,
  lastRenderTime: 0,
  needsFullRebuild: false,

  // Bookmarks view
  showingBookmarks: false,

  // New notes indicator
  newNotesBanner: null,

  // Pagination & buffering
  _displayLimit: PAGE_SIZE,
  _totalFiltered: 0,
  _eoseReceived: false,
  _initialRenderDone: false,
  _pendingCount: 0,

  init() {
    this.feedEl = document.getElementById('feed');
    this.loadingEl = document.getElementById('loading');
    this.emptyEl = document.getElementById('empty-state');
    this.newNotesBanner = document.getElementById('new-notes-banner');

    // Load settings
    this.maxHops = Settings.get('maxHops');
    this.trustedOnly = Settings.get('trustedOnly');
    this.sortMode = Settings.get('sortMode');

    // New notes banner click → refresh
    this.newNotesBanner.addEventListener('click', () => this.refresh());

    // Bookmarks toggle
    document.getElementById('bookmarks-toggle').addEventListener('click', () => {
      this.toggleBookmarks();
    });

    // Infinite scroll — load more when sentinel is visible
    const sentinel = document.getElementById('load-more');
    if (sentinel) {
      const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && this._initialRenderDone) {
          this.loadMore();
        }
      }, { rootMargin: '300px' });
      observer.observe(sentinel);
    }
  },

  toggleBookmarks() {
    this.showingBookmarks = !this.showingBookmarks;
    const btn = document.getElementById('bookmarks-toggle');
    btn.classList.toggle('active', this.showingBookmarks);
    this.scheduleRender(true);
  },

  refresh() {
    this._pendingCount = 0;
    this._displayLimit = PAGE_SIZE;
    this._hideNewNotesBanner();
    this.scheduleRender(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  loadMore() {
    if (this._displayLimit >= this._totalFiltered) return;
    this._displayLimit += PAGE_SIZE;
    this.scheduleRender();
  },

  _showNewNotesBanner(count) {
    if (!this.newNotesBanner) return;
    this.newNotesBanner.textContent = `${count} new note${count !== 1 ? 's' : ''} — click to load`;
    this.newNotesBanner.style.display = 'block';
  },

  _hideNewNotesBanner() {
    if (this.newNotesBanner) this.newNotesBanner.style.display = 'none';
  },

  async addEvent(event) {
    this.totalReceived++;

    if (this.seenIds.has(event.id)) return;
    this.seenIds.add(event.id);
    this.authors.add(event.pubkey);
    updateStats();

    Profiles.request(event.pubkey);

    this.pendingQueue.push(event);
    if (!this.processing) this.processQueue();
  },

  async processQueue() {
    this.processing = true;
    let newInBatch = 0;

    while (this.pendingQueue.length > 0) {
      const batch = this.pendingQueue.splice(0, 20);
      newInBatch += batch.length;

      const batchPubkeys = [...new Set(batch.map(e => e.pubkey))];
      await WoT.scoreBatch(batchPubkeys, 10);

      const trustWeight = Settings.get('trustWeight');
      const recencyWeight = 1 - trustWeight;
      const maxAge = Settings.get('timeWindow') * 60 * 60;

      for (const event of batch) {
        const trust = WoT.cache.get(event.pubkey) || await WoT.scoreSingle(event.pubkey);

        const now = Math.floor(Date.now() / 1000);
        const ageSeconds = now - event.created_at;
        const recencyScore = Math.max(0, 1 - ageSeconds / maxAge);
        const combinedScore = trust.score * trustWeight + recencyScore * recencyWeight;

        const replyTo = getReplyToId(event.tags || []);

        const note = {
          id: event.id,
          pubkey: event.pubkey,
          content: event.content,
          created_at: event.created_at,
          trustScore: trust.score,
          distance: trust.distance,
          trusted: trust.trusted,
          combinedScore,
          replyTo,
        };
        this.notes.push(note);
        this.notesById.set(note.id, note);

        if (replyTo) ParentNotes.request(replyTo);
      }
    }

    // Prune
    const maxNotes = Settings.get('maxNotes');
    if (this.notes.length > maxNotes) {
      this.notes.sort((a, b) => b.combinedScore - a.combinedScore);
      this.notes = this.notes.slice(0, maxNotes);
      // Rebuild notesById from remaining notes
      this.notesById.clear();
      for (const n of this.notes) this.notesById.set(n.id, n);
    }

    this.processing = false;

    // First batch after EOSE → do initial render
    if (this._eoseReceived && !this._initialRenderDone) {
      this._initialRenderDone = true;
      this._displayLimit = PAGE_SIZE;
      this.scheduleRender(true);
    } else if (this._initialRenderDone) {
      // After initial render: buffer silently, show banner
      this._pendingCount += newInBatch;
      if (this._pendingCount > 0) {
        this._showNewNotesBanner(this._pendingCount);
      }
    }
    // Before EOSE: don't render (loading spinner stays visible)
  },

  scheduleRender(forceRebuild = false) {
    if (forceRebuild) this.needsFullRebuild = true;

    const now = Date.now();
    const elapsed = now - this.lastRenderTime;

    if (this.renderTimer) return;

    if (elapsed >= RENDER_THROTTLE_MS) {
      this.executeRender();
    } else {
      this.renderTimer = setTimeout(() => {
        this.renderTimer = null;
        this.executeRender();
      }, RENDER_THROTTLE_MS - elapsed);
    }
  },

  executeRender() {
    this.lastRenderTime = Date.now();

    if (this.loadingEl && this.notes.length > 0) {
      this.loadingEl.style.display = 'none';
    }

    // Filter
    let filtered;
    if (this.showingBookmarks) {
      filtered = [...Bookmarks.list.values()];
    } else {
      filtered = this.notes.filter((n) => {
        if (Mute.isMuted(n.pubkey)) return false;
        if (this.trustedOnly) {
          if (!n.trusted || n.distance > this.maxHops) return false;
        }
        const threshold = Settings.get('trustThreshold');
        if (threshold > 0 && n.trustScore * 100 < threshold) return false;
        return true;
      });
    }

    // Empty state
    if (filtered.length === 0 && (this.notes.length > 0 || this.showingBookmarks)) {
      this.emptyEl.style.display = 'block';
    } else {
      this.emptyEl.style.display = 'none';
    }

    const sorted = this.sortNotes([...filtered]);
    this._totalFiltered = sorted.length;

    // Paginate — only show up to _displayLimit
    const paged = sorted.slice(0, this._displayLimit);
    const visibleIds = new Set(paged.map(n => n.id));

    // Remove DOM nodes no longer visible
    for (const [id, el] of this.domNodes) {
      if (!visibleIds.has(id)) {
        el.remove();
        this.domNodes.delete(id);
      }
    }

    if (this.needsFullRebuild) {
      this.needsFullRebuild = false;
      for (const [, el] of this.domNodes) {
        el.remove();
      }
      this.domNodes.clear();
      for (const note of paged) {
        const el = this.createNoteElement(note, false);
        this.domNodes.set(note.id, el);
        this.feedEl.appendChild(el);
      }
    } else {
      let prevEl = null;
      for (const note of paged) {
        let el = this.domNodes.get(note.id);
        if (!el) {
          el = this.createNoteElement(note, true);
          this.domNodes.set(note.id, el);
        }
        const nextSibling = prevEl ? prevEl.nextSibling : (this.loadingEl?.nextSibling || this.emptyEl?.nextSibling || this.feedEl.firstChild);
        if (el !== nextSibling) {
          this.feedEl.insertBefore(el, nextSibling);
        }
        prevEl = el;
      }
    }

    // Update visible count
    document.getElementById('stat-visible').textContent = paged.length;
    const svmB = document.getElementById('stat-visible-m'); if (svmB) svmB.textContent = paged.length;

    // Update load-more sentinel
    const sentinel = document.getElementById('load-more');
    if (sentinel) {
      const remaining = sorted.length - paged.length;
      if (remaining > 0) {
        sentinel.style.display = '';
        sentinel.querySelector('.load-more-text').textContent = `${remaining} more note${remaining !== 1 ? 's' : ''}`;
      } else {
        sentinel.style.display = 'none';
      }
    }
  },

  createNoteElement(note, animate) {
    const el = document.createElement('div');
    el.className = 'note' + (note.trusted ? '' : ' untrusted');
    if (animate) el.classList.add('note-new');
    el.dataset.id = note.id;
    el.dataset.pubkey = note.pubkey;

    this.fillNoteContent(el, note);
    this.wireNoteActions(el, note);

    if (animate) {
      el.addEventListener('animationend', () => {
        el.classList.remove('note-new');
      }, { once: true });
    }

    return el;
  },

  fillNoteContent(el, note) {
    const profile = Profiles.get(note.pubkey);
    const displayName = profile?.displayName || profile?.name || '';
    const npub = truncateNpub(note.pubkey);
    const avatarColor = pubkeyColor(note.pubkey);
    const initials = (displayName || note.pubkey.slice(0, 2)).slice(0, 2).toUpperCase();
    const hopClass = note.distance <= 6 ? `hop-${Math.min(note.distance, 6)}` : 'hop-unknown';
    const hopLabel = note.trusted
      ? (note.distance <= 6 ? `${note.distance}-hop` : 'wot')
      : 'unknown';
    const timeStr = timeAgo(note.created_at);
    const renderedContent = ContentRenderer.render(note.content);

    const isLiked = Actions.liked.has(note.id);
    const isReposted = Actions.reposted.has(note.id);
    const isBookmarked = Bookmarks.has(note.id);
    const isMuted = Mute.isMuted(note.pubkey);
    const showFooter = Settings.get('showTrustFooter');

    let avatarHtml;
    if (profile?.picture) {
      avatarHtml = `<div class="avatar"><img src="${escapeAttr(profile.picture)}" alt="" onerror="this.parentElement.style.background='${avatarColor}';this.parentElement.textContent='${initials}';this.remove()"></div>`;
    } else {
      avatarHtml = `<div class="avatar" style="background:${avatarColor}">${initials}</div>`;
    }

    const nameHtml = displayName
      ? `<span class="note-author">${escapeHtml(displayName)}</span>`
      : `<span class="note-author">${npub}</span>`;

    // Trust score percentage badge
    const trustPct = Math.round(note.trustScore * 100);
    const trustColor = trustScoreColor(trustPct);
    const trustPctHtml = note.trusted
      ? `<span class="trust-pct" style="color:${trustColor}">${trustPct}%</span>`
      : '';

    const npubLine = displayName
      ? `<span class="note-npub">${npub}</span>`
      : '';

    const footerHtml = showFooter ? `
      <div class="note-footer">
        <span>trust ${note.trustScore.toFixed(2)}</span>
        <span>score ${note.combinedScore.toFixed(2)}</span>
        ${note.distance < Infinity ? `<span>${note.distance}-hop</span>` : ''}
      </div>` : '';

    // Reply context bar
    let replyHtml = '';
    if (note.replyTo) {
      const parent = ParentNotes.get(note.replyTo);
      if (parent) {
        const parentProfile = Profiles.get(parent.pubkey);
        const parentName = parentProfile?.displayName || parentProfile?.name || truncateNpub(parent.pubkey);
        const snippet = parent.content.length > 80 ? parent.content.slice(0, 80) + '...' : parent.content;
        replyHtml = `<div class="reply-context"><span class="reply-context-label">Replying to</span> <span class="reply-context-author">@${escapeHtml(parentName)}</span> <span class="reply-context-snippet">${escapeHtml(snippet)}</span></div>`;
      } else {
        replyHtml = `<div class="reply-context reply-context-loading"><span class="reply-context-label">Reply</span></div>`;
      }
    }

    let noteIdBech32;
    try { noteIdBech32 = nip19.noteEncode(note.id); } catch { noteIdBech32 = note.id; }
    let authorNpubFull;
    try { authorNpubFull = nip19.npubEncode(note.pubkey); } catch { authorNpubFull = note.pubkey; }

    el.innerHTML = `
      <div class="note-header">
        ${avatarHtml}
        <div class="note-meta">
          <div class="note-author-row">
            ${nameHtml}
            ${trustPctHtml}
            <span class="trust-badge ${hopClass}">${hopLabel}</span>
          </div>
          ${npubLine}
        </div>
        <span class="note-time">${timeStr}</span>
        <div class="note-more-wrap">
          <button class="note-more-btn" title="More options">${ICONS.more}</button>
          <div class="note-dropdown">
            <div class="dropdown-section">
              <div class="dropdown-detail">
                <div class="dropdown-detail-label">Note ID</div>
                ${escapeHtml(noteIdBech32.slice(0, 24) + '...')}
              </div>
            </div>
            <div class="dropdown-section">
              <button class="dropdown-item action-dd-copy-note" data-copy="${escapeAttr(noteIdBech32)}">${ICONS.copy} Copy Note ID</button>
              <button class="dropdown-item action-dd-copy-hex" data-copy="${escapeAttr(note.id)}">${ICONS.hash} Copy Event ID (hex)</button>
              <button class="dropdown-item action-dd-copy-npub" data-copy="${escapeAttr(authorNpubFull)}">${ICONS.user} Copy Author npub</button>
              <button class="dropdown-item action-dd-copy-json">${ICONS.code} Copy Raw JSON</button>
            </div>
            <div class="dropdown-section">
              <button class="dropdown-item action-dd-open-njump">${ICONS.externalLink} Open in njump.me</button>
              <button class="dropdown-item action-dd-profile">${ICONS.user} View Profile</button>
            </div>
            <div class="dropdown-section">
              <button class="dropdown-item action-dd-mute danger">${ICONS.userX} ${isMuted ? 'Unmute User' : 'Mute User'}</button>
            </div>
          </div>
        </div>
      </div>
      ${replyHtml}
      <div class="note-content">${renderedContent}</div>
      <div class="note-actions">
        <button class="note-action action-reply" title="Reply">${ICONS.reply} Reply</button>
        <button class="note-action action-repost${isReposted ? ' reposted' : ''}" title="Repost">${ICONS.repost} Repost</button>
        <button class="note-action action-like${isLiked ? ' liked' : ''}" title="Like">${ICONS.like} Like</button>
        <button class="note-action action-zap" title="Zap">${ICONS.zap} Zap</button>
        <button class="note-action action-bookmark${isBookmarked ? ' bookmarked' : ''}" title="Bookmark">${ICONS.bookmark}</button>
      </div>
      <div class="reply-composer">
        <textarea placeholder="Write a reply..."></textarea>
        <div class="reply-actions">
          <button class="reply-btn cancel">Cancel</button>
          <button class="reply-btn send">Send</button>
        </div>
      </div>
      ${footerHtml}
    `;
  },

  wireNoteActions(el, note) {
    const noteId = note.id;
    const authorPk = note.pubkey;

    // Profile click
    const avatarEl = el.querySelector('.avatar');
    const nameEl = el.querySelector('.note-author');
    const openProfile = () => ProfileModal.open(note.pubkey);
    avatarEl.addEventListener('click', openProfile);
    nameEl.addEventListener('click', openProfile);

    // Three-dots dropdown
    const moreBtn = el.querySelector('.note-more-btn');
    const dropdown = el.querySelector('.note-dropdown');
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      DropdownManager.toggle(dropdown);
    });

    // Dropdown: copy actions
    el.querySelector('.action-dd-copy-note').addEventListener('click', () => {
      copyToClipboard(el.querySelector('.action-dd-copy-note').dataset.copy);
      showToast('Note ID copied');
      DropdownManager.close();
    });
    el.querySelector('.action-dd-copy-hex').addEventListener('click', () => {
      copyToClipboard(el.querySelector('.action-dd-copy-hex').dataset.copy);
      showToast('Event ID copied');
      DropdownManager.close();
    });
    el.querySelector('.action-dd-copy-npub').addEventListener('click', () => {
      copyToClipboard(el.querySelector('.action-dd-copy-npub').dataset.copy);
      showToast('Author npub copied');
      DropdownManager.close();
    });
    el.querySelector('.action-dd-copy-json').addEventListener('click', () => {
      const rawJson = JSON.stringify({
        id: note.id,
        pubkey: note.pubkey,
        content: note.content,
        created_at: note.created_at,
        kind: 1,
      }, null, 2);
      copyToClipboard(rawJson);
      showToast('Raw JSON copied');
      DropdownManager.close();
    });

    // Dropdown: open in njump
    el.querySelector('.action-dd-open-njump').addEventListener('click', () => {
      let noteIdBech32;
      try { noteIdBech32 = nip19.noteEncode(note.id); } catch { noteIdBech32 = note.id; }
      window.open(`https://njump.me/${noteIdBech32}`, '_blank', 'noopener');
      DropdownManager.close();
    });

    // Dropdown: view profile
    el.querySelector('.action-dd-profile').addEventListener('click', () => {
      ProfileModal.open(note.pubkey);
      DropdownManager.close();
    });

    // Dropdown: mute user
    el.querySelector('.action-dd-mute').addEventListener('click', () => {
      Mute.toggle(authorPk);
      Feed.scheduleRender(true);
      SettingsDrawer.updateMutedList();
      const wasMuted = Mute.isMuted(authorPk);
      showToast(wasMuted ? 'User muted' : 'User unmuted');
      DropdownManager.close();
    });

    // Actions
    el.querySelector('.action-like').addEventListener('click', () => {
      Actions.like(noteId, authorPk);
    });

    el.querySelector('.action-repost').addEventListener('click', () => {
      Actions.repost(noteId, authorPk);
    });

    el.querySelector('.action-zap').addEventListener('click', () => {
      Actions.zap(noteId, authorPk);
    });

    // Bookmark
    el.querySelector('.action-bookmark').addEventListener('click', () => {
      Bookmarks.toggle(noteId, note);
      const btn = el.querySelector('.action-bookmark');
      btn.classList.toggle('bookmarked', Bookmarks.has(noteId));
    });

    const composer = el.querySelector('.reply-composer');
    el.querySelector('.action-reply').addEventListener('click', () => {
      composer.classList.toggle('open');
      if (composer.classList.contains('open')) {
        composer.querySelector('textarea').focus();
      }
    });

    composer.querySelector('.reply-btn.cancel').addEventListener('click', () => {
      composer.classList.remove('open');
      composer.querySelector('textarea').value = '';
    });

    composer.querySelector('.reply-btn.send').addEventListener('click', async () => {
      const text = composer.querySelector('textarea').value;
      await Actions.reply(noteId, authorPk, text);
      composer.classList.remove('open');
      composer.querySelector('textarea').value = '';
    });
  },

  updateProfiles(pubkeys) {
    const pubkeySet = new Set(pubkeys);
    for (const [id, el] of this.domNodes) {
      const pk = el.dataset.pubkey;
      if (!pubkeySet.has(pk)) continue;

      const profile = Profiles.get(pk);
      if (!profile) continue;

      const displayName = profile.displayName || profile.name || '';
      const npub = truncateNpub(pk);
      const avatarColor = pubkeyColor(pk);
      const initials = (displayName || pk.slice(0, 2)).slice(0, 2).toUpperCase();

      const avatarEl = el.querySelector('.avatar');
      if (avatarEl && profile.picture) {
        avatarEl.innerHTML = `<img src="${escapeAttr(profile.picture)}" alt="" onerror="this.parentElement.style.background='${avatarColor}';this.parentElement.textContent='${initials}';this.remove()">`;
        avatarEl.style.background = '';
      }

      const nameEl = el.querySelector('.note-author');
      if (nameEl && displayName) {
        nameEl.textContent = displayName;
      }

      const metaEl = el.querySelector('.note-meta');
      if (displayName && metaEl && !metaEl.querySelector('.note-npub')) {
        const npubSpan = document.createElement('span');
        npubSpan.className = 'note-npub';
        npubSpan.textContent = npub;
        metaEl.appendChild(npubSpan);
      }
    }

    // Also update reply-context bars when a parent author's profile arrives
    for (const [id, el] of this.domNodes) {
      const note = this.notesById.get(id);
      if (!note?.replyTo) continue;
      const parent = ParentNotes.get(note.replyTo);
      if (!parent || !pubkeySet.has(parent.pubkey)) continue;
      const ctxEl = el.querySelector('.reply-context-author');
      if (ctxEl) {
        const parentProfile = Profiles.get(parent.pubkey);
        const parentName = parentProfile?.displayName || parentProfile?.name || truncateNpub(parent.pubkey);
        ctxEl.textContent = '@' + parentName;
      }
    }
  },

  updateParentNotes(eventIds) {
    const idSet = new Set(eventIds);
    for (const [id, el] of this.domNodes) {
      const note = this.notesById.get(id);
      if (!note?.replyTo || !idSet.has(note.replyTo)) continue;
      this.fillNoteContent(el, note);
      this.wireNoteActions(el, note);
    }
  },

  setMaxHops(hops) {
    this.maxHops = hops;
    this.scheduleRender(true);
  },

  setTrustedOnly(val) {
    this.trustedOnly = val;
    this.scheduleRender(true);
  },

  setSortMode(mode) {
    this.sortMode = mode;
    this.scheduleRender(true);
  },

  sortNotes(notes) {
    switch (this.sortMode) {
      case 'trust-desc':
        return notes.sort((a, b) => {
          if (a.trusted !== b.trusted) return a.trusted ? -1 : 1;
          return b.combinedScore - a.combinedScore;
        });
      case 'trust-asc':
        return notes.sort((a, b) => {
          if (a.trusted !== b.trusted) return a.trusted ? 1 : -1;
          return a.combinedScore - b.combinedScore;
        });
      case 'newest':
        return notes.sort((a, b) => b.created_at - a.created_at);
      case 'oldest':
        return notes.sort((a, b) => a.created_at - b.created_at);
      case 'random':
        for (let i = notes.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [notes[i], notes[j]] = [notes[j], notes[i]];
        }
        return notes;
      default:
        return notes;
    }
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

function truncateNpub(hexPubkey) {
  try {
    const np = nip19.npubEncode(hexPubkey);
    return np.slice(0, 12) + '...' + np.slice(-4);
  } catch {
    return hexPubkey.slice(0, 10) + '...';
  }
}

function timeAgo(timestamp) {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pubkeyColor(hex) {
  let hash = 0;
  for (let i = 0; i < 8; i++) {
    hash = parseInt(hex[i], 16) + (hash << 4);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 50%, 60%)`;
}

// Trust score percentage → color (orange at 50% to green at 100%)
function trustScoreColor(pct) {
  // pct: 0–100
  // 0–50: orange (hsl 30)
  // 50–100: interpolate from orange (30) to green (140)
  if (pct <= 0) return 'var(--text-muted)';
  if (pct <= 50) return 'hsl(30, 90%, 55%)';
  // Lerp hue from 30 (orange) to 140 (green) as pct goes 50→100
  const t = (pct - 50) / 50;
  const hue = 30 + t * 110;
  return `hsl(${Math.round(hue)}, 80%, 50%)`;
}

// NIP-10: extract the event ID this note is replying to
function getReplyToId(tags) {
  const eTags = tags.filter(t => t[0] === 'e');
  if (eTags.length === 0) return null;

  // Preferred: look for explicit "reply" marker
  const replyTag = eTags.find(t => t[3] === 'reply');
  if (replyTag) return replyTag[1];

  // Single e tag with "root" marker — treat as reply target
  if (eTags.length === 1 && eTags[0][3] === 'root') return eTags[0][1];

  // Deprecated positional: if no markers on any e tag, last e tag is reply
  const hasMarkers = eTags.some(t => t[3] === 'root' || t[3] === 'reply' || t[3] === 'mention');
  if (!hasMarkers && eTags.length > 0) return eTags[eTags.length - 1][1];

  return null;
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

function updateStats() {
  const total = Feed.totalReceived;
  const authors = Feed.authors.size;
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-authors').textContent = authors;
  // Mobile mirrors
  const totalM = document.getElementById('stat-total-m');
  const authorsM = document.getElementById('stat-authors-m');
  if (totalM) totalM.textContent = total;
  if (authorsM) authorsM.textContent = authors;
}

// ─── Pull to Refresh ────────────────────────────────────────────────────────────

const PullToRefresh = {
  _el: null,
  _textEl: null,
  _startY: 0,
  _pulling: false,
  _threshold: 80,

  init() {
    this._el = document.getElementById('ptr-indicator');
    this._textEl = document.getElementById('ptr-text');
    if (!this._el) return;

    let currentY = 0;

    document.addEventListener('touchstart', (e) => {
      if (window.scrollY <= 0 && Feed._initialRenderDone) {
        this._startY = e.touches[0].clientY;
        this._pulling = true;
        currentY = 0;
      }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!this._pulling) return;
      currentY = e.touches[0].clientY - this._startY;
      if (currentY > 0 && window.scrollY <= 0) {
        const dist = Math.min(currentY * 0.4, 80);
        this._el.style.height = dist + 'px';
        this._el.style.opacity = Math.min(currentY / this._threshold, 1);
        this._textEl.textContent = currentY >= this._threshold ? 'Release to refresh' : 'Pull to refresh';
      } else {
        this._el.style.height = '0';
        this._el.style.opacity = '0';
      }
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (!this._pulling) return;
      this._pulling = false;

      if (currentY >= this._threshold && window.scrollY <= 0) {
        this._textEl.textContent = 'Refreshing...';
        this._el.style.height = '40px';
        this._el.style.opacity = '1';
        Feed.refresh();
        setTimeout(() => {
          this._el.style.height = '0';
          this._el.style.opacity = '0';
        }, 600);
      } else {
        this._el.style.height = '0';
        this._el.style.opacity = '0';
      }
    }, { passive: true });
  },
};

// ─── Init ───────────────────────────────────────────────────────────────────────

async function main() {
  // ── Phase 1: UI init ──
  Settings.load();
  Theme.init();
  Debug.init();
  DropdownManager.init();
  Mute.init();
  Bookmarks.init();
  Feed.init();
  ProfileModal.init();
  Composer.init();
  SettingsDrawer.init();
  Auth.init();

  Debug.log('App starting...', 'info');

  // Hamburger menu (mobile)
  const hamburger = document.getElementById('hamburger');
  const headerInfo = document.getElementById('header-info');
  hamburger.addEventListener('click', () => {
    headerInfo.classList.toggle('open');
  });

  // Logout button in settings
  document.getElementById('settings-logout-btn').addEventListener('click', () => {
    Auth.logout();
  });

  Profiles.onUpdate = (pubkeys) => Feed.updateProfiles(pubkeys);
  ParentNotes.onUpdate = (eventIds) => Feed.updateParentNotes(eventIds);
  PullToRefresh.init();

  // ── Phase 2: after auth ──
  document.addEventListener('auth-ready', async () => {
    Debug.log('Auth ready, loading feed...', 'info');

    // Toggle read-only mode
    document.body.classList.toggle('readonly', Signer.isReadOnly());

    const wotStatus = await WoT.init();

    // Load mute list from relays (needs WoT.myPubkey)
    await Mute.loadFromRelay();
    SettingsDrawer.updateMutedList();

    // WoT status (desktop + mobile)
    const wotEls = [
      [document.getElementById('wot-status'), document.getElementById('wot-label')],
      [document.getElementById('wot-status-m'), document.getElementById('wot-label-m')],
    ];
    for (const [dot, label] of wotEls) {
      if (!dot) continue;
      if (wotStatus.hasExtension) {
        dot.classList.add('available');
        label.textContent = 'WoT';
      } else {
        dot.classList.add('unavailable');
        label.textContent = 'No WoT';
      }
    }

    // Relay status (desktop + mobile)
    const relayPairs = [
      [document.getElementById('relay-status'), document.getElementById('relay-label')],
      [document.getElementById('relay-status-m'), document.getElementById('relay-label-m')],
    ];

    Relay.init(
      (event) => Feed.addEvent(event),
      (status) => {
        // On EOSE, trigger initial render
        if (status === 'eose') {
          Feed._eoseReceived = true;
          if (!Feed.processing && !Feed._initialRenderDone) {
            Feed._initialRenderDone = true;
            Feed._displayLimit = PAGE_SIZE;
            Feed.scheduleRender(true);
          }
        }

        for (const [dot, label] of relayPairs) {
          if (!dot) continue;
          if (status === 'connected' || status === 'eose') {
            dot.className = 'status-dot connected';
            const urls = Relay.getUrls();
            label.textContent = urls.length === 1
              ? urls[0].replace('wss://', '').replace(/\/$/, '')
              : `${urls.length} relays`;
          } else {
            dot.className = 'status-dot disconnected';
            label.textContent = 'Offline';
          }
        }
      }
    );
  }, { once: true });

  // Start auth flow (will show modal or auto-reconnect)
  Auth.start();
}

main();
