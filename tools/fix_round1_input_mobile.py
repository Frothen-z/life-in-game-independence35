from pathlib import Path
import re

main = Path('game/js/main.js')
text = main.read_text(encoding='utf-8')

# ----- Lobby cursor / pointer lock -----
helper_marker = "function updateRound1LobbyUI() {\n"
helper = """function syncRound1InputMode() {
  const localParticipant = !!round1State && isRoundParticipant(round1State, playerId);
  const playing = Boolean(
    round1State &&
    localParticipant &&
    !round1IsSpectator &&
    round1State.activeIds?.includes(String(playerId)) &&
    round1State.phase !== 'countdown' &&
    round1State.phase !== 'finished'
  );
  document.body.classList.toggle('round1-playing', playing);
  if (!playing && document.pointerLockElement) {
    try { document.exitPointerLock(); } catch {}
  }
}

"""
if 'function syncRound1InputMode()' not in text:
    if helper_marker not in text:
        raise RuntimeError('round1 lobby marker missing')
    text = text.replace(helper_marker, helper + helper_marker, 1)

old = """function updateRound1LobbyUI() {
  if (!round1Hud) return;
  round1Hud.classList.remove('hidden');"""
new = """function updateRound1LobbyUI() {
  if (!round1Hud) return;
  syncRound1InputMode();
  round1Hud.classList.remove('hidden');"""
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise RuntimeError('updateRound1LobbyUI header missing')

old = """  round1StartButton?.classList.add('hidden');
  refreshRound1Visuals();
}"""
new = """  round1StartButton?.classList.add('hidden');
  syncRound1InputMode();
  refreshRound1Visuals();
}"""
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise RuntimeError('setRound1State tail missing')

old = """  round1IsSpectator = true;
  round1WaitingNotice?.classList.remove('hidden');"""
new = """  round1IsSpectator = true;
  syncRound1InputMode();
  round1WaitingNotice?.classList.remove('hidden');"""
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise RuntimeError('elimination marker missing')

old = """  function canCaptureMouse() {
    const menu = document.getElementById('menu');
    if (menu && !menu.classList.contains('hidden')) return false;
    if (restaurantOpen || mafiaOpen || mafiaInGame || cinemaOpen || cinemaInRoom) return false;
    const cr = document.getElementById('cinema-room');
    if (cr && !cr.classList.contains('hidden')) return false;
    return true;
  }"""
new = """  function canCaptureMouse() {
    const menu = document.getElementById('menu');
    if (menu && !menu.classList.contains('hidden')) return false;
    if (restaurantOpen || mafiaOpen || mafiaInGame || cinemaOpen || cinemaInRoom) return false;
    const cr = document.getElementById('cinema-room');
    if (cr && !cr.classList.contains('hidden')) return false;
    if (document.body.classList.contains('round1-mode')) {
      const activeRoundPlayer = Boolean(
        round1State &&
        isRoundParticipant(round1State, playerId) &&
        round1State.activeIds?.includes(String(playerId)) &&
        !round1IsSpectator &&
        round1State.phase !== 'countdown' &&
        round1State.phase !== 'finished'
      );
      if (!activeRoundPlayer) return false;
    }
    return true;
  }"""
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise RuntimeError('canCaptureMouse block missing')

# ----- Touch-safe lobby registration -----
old = """  if (round1StartButton && !round1StartButton.dataset.round1Bound) {
    round1StartButton.dataset.round1Bound = '1';
    round1StartButton.addEventListener('click', () => setRound1Registration(!round1Joined));
  }"""
new = """  if (round1StartButton && !round1StartButton.dataset.round1Bound) {
    round1StartButton.dataset.round1Bound = '1';
    let lastTouchJoin = 0;
    const joinAction = (event) => {
      event?.stopPropagation?.();
      setRound1Registration(!round1Joined);
    };
    round1StartButton.addEventListener('click', (event) => {
      if (Date.now() - lastTouchJoin < 700) return;
      joinAction(event);
    });
    round1StartButton.addEventListener('touchend', (event) => {
      event.preventDefault();
      lastTouchJoin = Date.now();
      joinAction(event);
    }, { passive: false });
  }"""
if old in text:
    text = text.replace(old, new, 1)
elif 'let lastTouchJoin = 0;' not in text:
    raise RuntimeError('round1 registration binding missing')

# ----- More robust initial guest P2P connection -----
old = """  try {
    await connectSupabaseMultiplayer(roomId);
    showToast('Гостевая P2P-сеть готова · запишитесь на Раунд 1');
    if (onlineEl) onlineEl.textContent = `Онлайн: ${Math.max(1, round1MemberIds().length)} · P2P`;
    return;
  } catch (peerError) {
    console.error('Peer fallback failed', peerError);
    round1Members = [{ id: playerId, key: playerId, name: currentUser?.name || 'Игрок', joined: false }];
    round1HostId = playerId;
    round1RealtimeReady = false;
    resetLocalRound1Flags();
    updateRound1LobbyUI();
    showToast('Не удалось подключиться к сетевой комнате. Проверьте интернет и обновите страницу.');
    if (onlineEl) onlineEl.textContent = 'Сеть: ошибка подключения';
  }"""
new = """  let peerError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      try { await cityRoom?.close?.(); } catch {}
      cityRoom = null;
      p2pSend = null;
      if (onlineEl) onlineEl.textContent = `Сеть: подключение ${attempt}/3…`;
      await connectSupabaseMultiplayer(roomId);
      showToast('Гостевая сеть готова · запишитесь на Раунд 1');
      if (onlineEl) onlineEl.textContent = `Онлайн: ${Math.max(1, round1MemberIds().length)} · P2P`;
      return;
    } catch (error) {
      peerError = error;
      console.warn(`Peer fallback attempt ${attempt} failed`, error);
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
    }
  }
  console.error('Peer fallback failed', peerError);
  round1Members = [{ id: playerId, key: playerId, name: currentUser?.name || 'Игрок', joined: false }];
  round1HostId = playerId;
  round1RealtimeReady = false;
  resetLocalRound1Flags();
  updateRound1LobbyUI();
  showToast('Сеть не подключилась. Проверьте интернет и обновите страницу.');
  if (onlineEl) onlineEl.textContent = 'Сеть: ошибка подключения';"""
if old in text:
    text = text.replace(old, new, 1)
elif 'Peer fallback attempt' not in text:
    raise RuntimeError('guest fallback block missing')

# Remove duplicate status terms introduced by an older patch.
text = text.replace(" || status === 'CONNECTING' || status === 'RECONNECTING' || status === 'CONNECTING' || status === 'RECONNECTING'", " || status === 'CONNECTING' || status === 'RECONNECTING'")

main.write_text(text, encoding='utf-8')

# ----- PeerJS mobile hardening -----
peer = Path('game/js/services/peer-room.js')
p = peer.read_text(encoding='utf-8')
if 'const PEERJS_SOURCES' not in p:
    p = p.replace(
        "const PEERJS_CDN = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';",
        "const PEERJS_SOURCES = [\n  'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js',\n  'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js'\n];\nconst PEER_ICE_CONFIG = {\n  iceServers: [\n    { urls: 'stun:stun.l.google.com:19302' },\n    { urls: 'stun:stun1.l.google.com:19302' },\n    { urls: 'stun:global.stun.twilio.com:3478' }\n  ],\n  iceCandidatePoolSize: 4\n};\nconst peerOptions = () => ({ debug: 0, config: PEER_ICE_CONFIG });"
    )

start = p.find('function loadPeerJs() {')
end = p.find('\n\nfunction hashText', start)
if start < 0 or end < 0:
    raise RuntimeError('loadPeerJs block missing')
if 'for (const source of PEERJS_SOURCES)' not in p[start:end]:
    loader = r'''function loadPeerJs() {
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
          script.crossOrigin = 'anonymous';
          script.dataset.lifePeerjs = '1';
          const timeout = setTimeout(() => reject(new Error('PEERJS_LOAD_TIMEOUT')), 18000);
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
}'''
    p = p[:start] + loader + p[end:]

p = p.replace("new PeerCtor(undefined, { debug: 0 })", "new PeerCtor(undefined, peerOptions())")
p = p.replace("new PeerCtor(roomKey, { debug: 0 })", "new PeerCtor(roomKey, peerOptions())")
p = p.replace("}, 12000);", "}, 20000);")
p = p.replace("}, 9000);", "}, 18000);")
p = p.replace("}, 500 + Math.floor(Math.random() * 900));", "}, 900 + Math.floor(Math.random() * 1600));")

map_marker = "  const peerToPlayer = new Map();\n"
if 'const onlineHandler =' not in p:
    addition = """  const peerToPlayer = new Map();
  const onlineHandler = () => { if (!closed && !peer?.open) scheduleReconnect(); };
  const visibilityHandler = () => { if (!closed && document.visibilityState === 'visible' && !peer?.open) scheduleReconnect(); };
  globalThis.addEventListener?.('online', onlineHandler);
  document.addEventListener?.('visibilitychange', visibilityHandler);
"""
    if map_marker not in p:
        raise RuntimeError('peer map marker missing')
    p = p.replace(map_marker, addition, 1)

old = """    onStatus?.('CLOSED');
    destroyPeer();
    membersMap.clear();"""
new = """    onStatus?.('CLOSED');
    globalThis.removeEventListener?.('online', onlineHandler);
    document.removeEventListener?.('visibilitychange', visibilityHandler);
    destroyPeer();
    membersMap.clear();"""
if old in p:
    p = p.replace(old, new, 1)
elif new not in p:
    raise RuntimeError('peer close block missing')

peer.write_text(p, encoding='utf-8')

# ----- UI / cache -----
css = Path('game/css/style.css')
c = css.read_text(encoding='utf-8')
css_marker = ".round1-start.joined{background:linear-gradient(135deg,#475569,#334155);box-shadow:none}"
rules = """
body.round1-mode:not(.round1-playing),
body.round1-mode:not(.round1-playing) #c { cursor: default !important; }
body.round1-mode.round1-playing #c { cursor: none !important; }
body.round1-mode:not(.round1-playing) .mobile-controls { pointer-events: none !important; opacity: .18; }
.round1-start { pointer-events: auto !important; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.round1-hud { cursor: default; }
"""
if 'body.round1-mode:not(.round1-playing)' not in c:
    if css_marker not in c:
        raise RuntimeError('round1 CSS marker missing')
    c = c.replace(css_marker, css_marker + rules, 1)
css.write_text(c, encoding='utf-8')

html = Path('game/index.html')
h = html.read_text(encoding='utf-8')
h = re.sub(r'css/style\.css\?v=[^\"]+', 'css/style.css?v=round1-mobile-6', h)
h = re.sub(r'js/main\.js\?v=[^\"]+', 'js/main.js?v=round1-mobile-6', h)
html.write_text(h, encoding='utf-8')

print('Round 1 desktop cursor/mobile guest patch applied')
