const LOCAL_PEERJS = new URL('../../vendor/peerjs.min.js', import.meta.url).href;
const PEERJS_SOURCES = [
  LOCAL_PEERJS,
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js',
  'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js'
];
const BASE_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'stun:global.stun.twilio.com:3478' }
];
function configuredIceServers() {
  const extra = globalThis.LIFE_IN_GAME_CONFIG?.iceServers;
  return Array.isArray(extra) && extra.length ? [...BASE_ICE_SERVERS, ...extra] : BASE_ICE_SERVERS;
}
const peerOptions = () => ({ debug: 0, config: { iceServers: configuredIceServers() } });
let peerJsPromise = null;

function loadPeerJs() {
  if (globalThis.Peer) return Promise.resolve(globalThis.Peer);
  if (peerJsPromise) return peerJsPromise;
  peerJsPromise = (async () => {
    let lastError = null;
    for (const source of PEERJS_SOURCES) {
      try {
        await new Promise((resolve, reject) => {
          const old = document.querySelector('script[data-life-peerjs="1"]');
          if (old) old.remove();
          const script = document.createElement('script');
          script.src = source;
          script.async = true;
          if (source !== LOCAL_PEERJS) script.crossOrigin = 'anonymous';
          script.dataset.lifePeerjs = '1';
          const timeout = setTimeout(() => reject(new Error('PEERJS_LOAD_TIMEOUT')), source === LOCAL_PEERJS ? 5000 : 15000);
          script.onload = () => {
            clearTimeout(timeout);
            globalThis.Peer ? resolve(true) : reject(new Error('PEERJS_GLOBAL_MISSING'));
          };
          script.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('PEERJS_LOAD_FAILED'));
          };
          document.head.appendChild(script);
        });
        if (globalThis.Peer) return globalThis.Peer;
      } catch (error) {
        lastError = error;
      }
    }
    peerJsPromise = null;
    throw lastError || new Error('PEERJS_LOAD_FAILED');
  })();
  return peerJsPromise;
}

function hashText(value) {
  const text = String(value || 'room');
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash >>> 0).toString(36);
}

function safeMeta(playerId, displayName, base, patch = {}) {
  return {
    id: String(playerId || ''),
    key: String(playerId || ''),
    name: String(patch.name || displayName || 'Игрок').slice(0, 80),
    online_at: new Date().toISOString(),
    ...base,
    ...patch,
    id: String(playerId || ''),
    key: String(playerId || '')
  };
}

function cloneMembers(map) {
  return [...map.values()].map((item) => ({ ...item }));
}

export function createPeerFallbackRoom({ topic, playerId, displayName, presence = {}, onMessage, onPresence, onStatus }) {
  const selfId = String(playerId || '').trim();
  if (!selfId) throw new Error('PLAYER_ID_REQUIRED');
  const roomKey = `lig-r1-${hashText(topic || 'round1-main')}`;

  let PeerCtor = null;
  let peer = null;
  let hostConn = null;
  let isHost = false;
  let closed = false;
  let connectPromise = null;
  let reconnectTimer = 0;
  let localMeta = safeMeta(selfId, displayName, presence);
  const membersMap = new Map([[selfId, localMeta]]);
  const hostConnections = new Map();
  const peerToPlayer = new Map();
  const onlineHandler = () => { if (!closed && !peer?.open) scheduleReconnect(); };
  const visibilityHandler = () => { if (!closed && document.visibilityState === 'visible' && !peer?.open) scheduleReconnect(); };
  globalThis.addEventListener?.('online', onlineHandler);
  document.addEventListener?.('visibilitychange', visibilityHandler);

  const emitPresence = () => onPresence?.(cloneMembers(membersMap));
  const cleanTimer = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = 0;
  };
  const sendSafe = (conn, data) => {
    try { if (conn?.open) conn.send(data); } catch {}
  };
  const broadcastPresence = () => {
    const packet = { kind: 'presence', members: cloneMembers(membersMap) };
    for (const conn of hostConnections.values()) sendSafe(conn, packet);
    emitPresence();
  };
  const relayAction = (packet, exceptPeerId = null) => {
    for (const [pid, conn] of hostConnections) {
      if (pid === exceptPeerId) continue;
      sendSafe(conn, { kind: 'action', payload: packet });
    }
  };
  const normalizeAction = (payload, fromId = selfId, name = localMeta.name) => ({
    ...payload,
    id: payload?.id || fromId,
    from: payload?.from || fromId,
    name: payload?.name || name || 'Игрок',
    t: Number(payload?.t || Date.now())
  });

  const dropHostClient = (peerId) => {
    hostConnections.delete(peerId);
    const memberId = peerToPlayer.get(peerId);
    peerToPlayer.delete(peerId);
    if (memberId && memberId !== selfId) membersMap.delete(memberId);
    broadcastPresence();
  };

  const bindHostConnection = (conn) => {
    if (!conn) return;
    hostConnections.set(conn.peer, conn);
    conn.on('data', (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.kind === 'hello' || message.kind === 'track') {
        const meta = message.meta || {};
        const memberId = String(meta.id || '').trim();
        if (!memberId || memberId === selfId) return;
        peerToPlayer.set(conn.peer, memberId);
        membersMap.set(memberId, { ...meta, id: memberId, key: memberId });
        broadcastPresence();
        return;
      }
      if (message.kind === 'action') {
        const memberId = peerToPlayer.get(conn.peer) || String(message.playerId || '');
        const member = membersMap.get(memberId);
        const packet = normalizeAction(message.payload || {}, memberId, member?.name);
        onMessage?.(packet);
        relayAction(packet, conn.peer);
      }
    });
    conn.on('close', () => dropHostClient(conn.peer));
    conn.on('error', () => dropHostClient(conn.peer));
  };

  const destroyPeer = () => {
    try { hostConn?.close?.(); } catch {}
    hostConn = null;
    for (const conn of hostConnections.values()) {
      try { conn.close?.(); } catch {}
    }
    hostConnections.clear();
    peerToPlayer.clear();
    try { peer?.destroy?.(); } catch {}
    peer = null;
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    onStatus?.('RECONNECTING');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = 0;
      destroyPeer();
      membersMap.clear();
      membersMap.set(selfId, localMeta);
      startElection().catch(() => { if (!closed) scheduleReconnect(); });
    }, 900 + Math.floor(Math.random() * 1600));
  };

  const becomeHost = () => {
    isHost = true;
    membersMap.clear();
    membersMap.set(selfId, localMeta);
    peer.on('connection', bindHostConnection);
    onStatus?.('SUBSCRIBED');
    broadcastPresence();
  };

  const becomeClient = () => new Promise((resolve, reject) => {
    isHost = false;
    peer = new PeerCtor(undefined, peerOptions());
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('PEER_CLIENT_TIMEOUT'));
    }, 20000);
    peer.on('open', () => {
      if (closed) return;
      hostConn = peer.connect(roomKey, { reliable: true, serialization: 'json' });
      hostConn.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        sendSafe(hostConn, { kind: 'hello', meta: localMeta });
        onStatus?.('SUBSCRIBED');
        emitPresence();
        resolve(true);
      });
      hostConn.on('data', (message) => {
        if (!message || typeof message !== 'object') return;
        if (message.kind === 'presence' && Array.isArray(message.members)) {
          membersMap.clear();
          for (const member of message.members) {
            const id = String(member?.id || member?.key || '').trim();
            if (id) membersMap.set(id, { ...member, id, key: id });
          }
          if (!membersMap.has(selfId)) membersMap.set(selfId, localMeta);
          emitPresence();
          return;
        }
        if (message.kind === 'action' && message.payload) onMessage?.(message.payload);
      });
      hostConn.on('close', scheduleReconnect);
      hostConn.on('error', (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error || new Error('PEER_HOST_CONNECTION_FAILED'));
          return;
        }
        scheduleReconnect();
      });
    });
    peer.on('error', (error) => {
      if (settled) return;
      const type = String(error?.type || '');
      settled = true;
      clearTimeout(timeout);
      if (type === 'peer-unavailable') {
        reject(new Error('PEER_HOST_UNAVAILABLE'));
        return;
      }
      reject(error || new Error('PEER_CLIENT_FAILED'));
    });
    peer.on('disconnected', scheduleReconnect);
    peer.on('close', scheduleReconnect);
  });

  async function startElection() {
    if (closed) throw new Error('ROOM_CLOSED');
    PeerCtor = PeerCtor || await loadPeerJs();
    onStatus?.('CONNECTING');
    return new Promise((resolve, reject) => {
      peer = new PeerCtor(roomKey, peerOptions());
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { peer.destroy(); } catch {}
        reject(new Error('PEER_HOST_TIMEOUT'));
      }, 18000);
      peer.on('open', () => {
        if (settled || closed) return;
        settled = true;
        clearTimeout(timeout);
        becomeHost();
        resolve(true);
      });
      peer.on('error', (error) => {
        const type = String(error?.type || '');
        if (settled) return;
        if (type === 'unavailable-id') {
          settled = true;
          clearTimeout(timeout);
          try { peer.destroy(); } catch {}
          peer = null;
          becomeClient().then(resolve, reject);
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  async function connect() {
    if (closed) throw new Error('ROOM_CLOSED');
    if (!connectPromise) {
      connectPromise = startElection().catch((error) => {
        connectPromise = null;
        onStatus?.('CHANNEL_ERROR');
        throw error;
      });
    }
    await connectPromise;
    return true;
  }

  async function send(payload) {
    if (closed) return false;
    const packet = normalizeAction(payload || {});
    if (isHost) {
      relayAction(packet);
      return true;
    }
    if (!hostConn?.open) return false;
    sendSafe(hostConn, { kind: 'action', playerId: selfId, payload: packet });
    return true;
  }

  async function track(patch = {}) {
    localMeta = safeMeta(selfId, displayName, localMeta, patch);
    membersMap.set(selfId, localMeta);
    if (isHost) broadcastPresence();
    else if (hostConn?.open) sendSafe(hostConn, { kind: 'track', meta: localMeta });
    else emitPresence();
    return true;
  }

  async function close() {
    if (closed) return;
    closed = true;
    cleanTimer();
    onStatus?.('CLOSED');
    globalThis.removeEventListener?.('online', onlineHandler);
    document.removeEventListener?.('visibilitychange', visibilityHandler);
    destroyPeer();
    membersMap.clear();
  }

  return { connect, send, track, close, members: () => cloneMembers(membersMap), transport: 'peerjs' };
}
