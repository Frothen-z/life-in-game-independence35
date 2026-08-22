from pathlib import Path
import re

peer_path = Path('game/js/services/peer-room.js')
p = peer_path.read_text(encoding='utf-8')

# Prefer a same-origin vendored PeerJS build. External CDNs remain only as emergency fallbacks.
old_sources = """const PEERJS_SOURCES = [
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js',
  'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js'
];"""
new_sources = """const LOCAL_PEERJS = new URL('../../vendor/peerjs.min.js', import.meta.url).href;
const PEERJS_SOURCES = [
  LOCAL_PEERJS,
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js',
  'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js'
];"""
if old_sources in p:
    p = p.replace(old_sources, new_sources, 1)
elif 'const LOCAL_PEERJS =' not in p:
    raise RuntimeError('PeerJS source list not found')

# Add STUN on port 80 for mobile/corporate networks and remove candidate pool for broad Safari compatibility.
old_ice = """const PEER_ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ],
  iceCandidatePoolSize: 4
};
const peerOptions = () => ({ debug: 0, config: PEER_ICE_CONFIG });"""
new_ice = """const BASE_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'stun:global.stun.twilio.com:3478' }
];
function configuredIceServers() {
  const extra = globalThis.LIFE_IN_GAME_CONFIG?.iceServers;
  return Array.isArray(extra) && extra.length ? [...BASE_ICE_SERVERS, ...extra] : BASE_ICE_SERVERS;
}
const peerOptions = () => ({ debug: 0, config: { iceServers: configuredIceServers() } });"""
if old_ice in p:
    p = p.replace(old_ice, new_ice, 1)
elif 'function configuredIceServers()' not in p:
    raise RuntimeError('ICE config block not found')

# Local asset should fail fast if missing, then CDN fallbacks get a longer timeout.
old_timeout = "const timeout = setTimeout(() => reject(new Error('PEERJS_LOAD_TIMEOUT')), 18000);"
new_timeout = "const timeout = setTimeout(() => reject(new Error('PEERJS_LOAD_TIMEOUT')), source === LOCAL_PEERJS ? 5000 : 15000);"
if old_timeout in p:
    p = p.replace(old_timeout, new_timeout, 1)
elif new_timeout not in p:
    raise RuntimeError('PeerJS loader timeout not found')

# crossOrigin is useful for CDNs but unnecessary for the same-origin vendored asset.
p = p.replace("          script.crossOrigin = 'anonymous';\n", "          if (source !== LOCAL_PEERJS) script.crossOrigin = 'anonymous';\n", 1)

# Critical fix: a stale deterministic room peer ID can return unavailable-id, then the client
# connection gets peer-unavailable. Do not ignore it for 20 seconds; reject immediately so
# the election can restart and the phone can become the new host once the stale ID clears.
old_error = """    peer.on('error', (error) => {
      if (!settled && String(error?.type || '') !== 'peer-unavailable') {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });"""
new_error = """    peer.on('error', (error) => {
      if (settled) return;
      const type = String(error?.type || '');
      settled = true;
      clearTimeout(timeout);
      if (type === 'peer-unavailable') {
        reject(new Error('PEER_HOST_UNAVAILABLE'));
        return;
      }
      reject(error || new Error('PEER_CLIENT_FAILED'));
    });"""
if old_error in p:
    p = p.replace(old_error, new_error, 1)
elif 'PEER_HOST_UNAVAILABLE' not in p:
    raise RuntimeError('client peer error block not found')

# If the signalling peer itself closes, restart automatically as well.
needle = "    peer.on('disconnected', scheduleReconnect);\n"
replacement = "    peer.on('disconnected', scheduleReconnect);\n    peer.on('close', scheduleReconnect);\n"
if replacement not in p:
    if needle not in p:
        raise RuntimeError('disconnected handler not found')
    p = p.replace(needle, replacement, 1)

peer_path.write_text(p, encoding='utf-8')

# More quick retries at app level. The old 3-attempt sequence could spend most of its time
# waiting on a stale host. Six shorter retries recover much faster after mobile refreshes.
main_path = Path('game/js/main.js')
m = main_path.read_text(encoding='utf-8')
m = m.replace('for (let attempt = 1; attempt <= 3; attempt += 1) {', 'for (let attempt = 1; attempt <= 6; attempt += 1) {', 1)
m = m.replace('`Сеть: подключение ${attempt}/3…`', '`Сеть: подключение ${attempt}/6…`', 1)
m = m.replace('if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 900 * attempt));',
              'if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, Math.min(2800, 450 + 450 * attempt)));', 1)
if 'attempt <= 6' not in m or '${attempt}/6' not in m:
    raise RuntimeError('app-level P2P retry patch did not apply')
main_path.write_text(m, encoding='utf-8')

# Allow future TURN credentials without another code change. This array may contain normal
# RTCIceServer objects and is safe to leave empty.
settings_path = Path('SETTINGS_HERE.js')
s = settings_path.read_text(encoding='utf-8')
if 'iceServers:' not in s:
    s = s.replace('  supabaseAnonKey: "",\n', '  supabaseAnonKey: "",\n  iceServers: [],\n', 1)
settings_path.write_text(s, encoding='utf-8')

# Cache-bust production assets.
html_path = Path('game/index.html')
h = html_path.read_text(encoding='utf-8')
h = re.sub(r'js/main\.js\?v=[^\"]+', 'js/main.js?v=round1-mobile-9', h)
h = re.sub(r'css/style\.css\?v=[^\"]+', 'css/style.css?v=round1-mobile-9', h)
html_path.write_text(h, encoding='utf-8')

print('mobile network startup repair applied')
