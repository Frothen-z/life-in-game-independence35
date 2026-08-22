from pathlib import Path
import re

ROOT = Path('.')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, got {count}')
    return text.replace(old, new, 1)


def sub_once(text, pattern, repl, label, flags=0):
    new, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    return new

# ---------- index.html ----------
path = ROOT / 'game/index.html'
html = path.read_text(encoding='utf-8')
html = sub_once(
    html,
    r'<form id="form-register" class="form">.*?</form>',
    '''<form id="form-register" class="form">
        <label class="field-label" for="reg-name">Имя</label>
        <input type="text" id="reg-name" maxlength="50" placeholder="Ваше имя" required autocomplete="name">
        <label class="field-label" for="reg-email">Email</label>
        <input type="email" id="reg-email" maxlength="120" placeholder="name@example.com" required autocomplete="email" autocapitalize="none" spellcheck="false">
        <label class="field-label" for="reg-pass">Пароль</label>
        <input type="password" id="reg-pass" maxlength="72" placeholder="Пароль" required autocomplete="new-password">
        <button type="submit" class="btn primary" data-auth-submit>Создать аккаунт →</button>
      </form>''',
    'registration form',
    flags=re.S,
)
html = replace_once(
    html,
    '<button type="button" id="round1-start" class="round1-start hidden">Записаться на участие</button>',
    '<button type="button" id="round1-start" class="round1-start hidden">Записаться на участие</button>\n      <button type="button" id="round1-cancel" class="round1-cancel hidden">Отменить запись</button>',
    'round1 cancel button',
)
html = html.replace('css/style.css?v=round1-mobile-9', 'css/style.css?v=round1-flow-10')
html = html.replace('js/main.js?v=round1-mobile-9', 'js/main.js?v=round1-flow-10')
path.write_text(html, encoding='utf-8')

# ---------- CSS ----------
path = ROOT / 'game/css/style.css'
css = path.read_text(encoding='utf-8')
css = replace_once(
    css,
    '.form input[type="text"],\n.form input[type="password"] {',
    '.form input[type="text"],\n.form input[type="email"],\n.form input[type="password"] {',
    'email input style',
)
marker = '/* ROUND1_FLOW_V10 */'
if marker not in css:
    css += r'''

/* ROUND1_FLOW_V10 */
.round1-cancel {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 8px;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.82);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}
.round1-cancel.hidden { display: none !important; }
.round1-cancel:disabled { opacity: 0.45; cursor: default; }

@media (max-width: 760px) {
  html, body { min-height: 100%; min-height: 100dvh; }
  .menu {
    min-height: 100dvh;
    height: 100dvh;
    align-items: flex-start;
    justify-content: center;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    padding:
      max(8px, env(safe-area-inset-top))
      max(8px, env(safe-area-inset-right))
      max(8px, env(safe-area-inset-bottom))
      max(8px, env(safe-area-inset-left));
  }
  .menu-card,
  #screen-auth {
    width: 100%;
    max-width: 420px;
    max-height: none;
    margin: auto 0;
    padding: 18px 16px;
    border-radius: 16px;
    overflow: visible;
  }
  .menu-card h1 { font-size: 1.35rem; }
  .subtitle { margin-bottom: 12px; }
  .tabs { margin-bottom: 10px; }
  .tab { padding: 9px 8px; }
  .form label { margin: 9px 0 5px; }
  .form input[type="text"],
  .form input[type="email"],
  .form input[type="password"] {
    width: 100%;
    min-height: 44px;
    padding: 11px 12px;
    font-size: 16px;
  }
  #form-register .btn,
  #form-login .btn { margin-top: 12px; padding: 12px; }
  .error { margin-top: 7px; }
  .auth-mode { margin-top: 6px; }
  .guest-access { margin-top: 10px; padding-top: 10px; }
  .guest-access .btn { margin-top: 7px; }
}

@media (max-width: 760px) and (max-height: 640px) {
  .menu { padding: 4px 8px; }
  .menu-card,
  #screen-auth { padding: 12px 14px; border-radius: 12px; }
  .subtitle { display: none; }
  .tabs { margin-bottom: 6px; }
  .form label { margin: 6px 0 3px; }
  #form-register .btn,
  #form-login .btn { margin-top: 8px; }
  .auth-mode { font-size: 0.72rem; }
  .guest-access small { display: none; }
}
'''
path.write_text(css, encoding='utf-8')

# ---------- auth-service.js ----------
path = ROOT / 'game/js/services/auth-service.js'
auth = path.read_text(encoding='utf-8')
auth = sub_once(
    auth,
    r"const USERNAME_RE = .*?\n\nexport function validateRegistration\(\{ username, displayName, email, password, consent \}\) \{.*?\n\}",
    '''function createInternalUsername() {
  let token = '';
  try { token = globalThis.crypto?.randomUUID?.() || ''; } catch {}
  if (!token) token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `u_${token.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 20)}`;
}

export function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().normalize('NFKC');
}

export function validateRegistration({ displayName, email, password }) {
  if (!String(displayName || '').trim()) return 'Введите имя';
  if (!/^\\S+@\\S+\\.\\S+$/.test(String(email || '').trim())) return 'Введите корректный email';
  if (!String(password || '')) return 'Введите пароль';
  return '';
}''',
    'auth validation',
    flags=re.S,
)
auth = sub_once(
    auth,
    r"  async function register\(\{ username, displayName, email, password, gender \}\) \{.*?\n  \}",
    '''  async function register({ displayName, email, password }) {
    const internalUsername = createInternalUsername();
    const cleanName = String(displayName || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const { data, error } = await client.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: { username: internalUsername, name: cleanName, gender: 'male' } }
    });
    if (error) throw error;
    return { ...data, internalUsername };
  }''',
    'auth register',
    flags=re.S,
)
auth = auth.replace("  if (text.includes('username') || text.includes('duplicate') || text.includes('unique')) return 'Такой логин уже занят';\n", '')
auth = auth.replace("  if (text.includes('password')) return 'Пароль должен содержать минимум 8 символов';", "  if (text.includes('password')) return 'Проверьте пароль и попробуйте ещё раз';")
path.write_text(auth, encoding='utf-8')

# ---------- round1-game.js ----------
path = ROOT / 'game/js/round1-game.js'
r1 = path.read_text(encoding='utf-8')
r1 = replace_once(r1, 'export const ROUND1_REQUIRED_PLAYERS = 2;', 'export const ROUND1_REQUIRED_PLAYERS = 1;', 'round1 min players')
r1 = replace_once(r1, 'export const ROUND1_COUNTDOWN_MS = 7000;', 'export const ROUND1_COUNTDOWN_MS = 10000;', 'round1 countdown')
r1 = replace_once(r1, 'return Math.round(4300 + unit * 2300);', 'return Math.round(9500 + unit * 3500);', 'round1 green duration')
path.write_text(r1, encoding='utf-8')

# ---------- main.js ----------
path = ROOT / 'game/js/main.js'
main = path.read_text(encoding='utf-8')
main = replace_once(main, 'const ROUND1_RED_GRACE_MS = 240;', 'const ROUND1_RED_GRACE_MS = 420;', 'red grace')
main = replace_once(main, 'let guestConnectionId = null;', 'let guestConnectionId = null;\nlet round1GuestRealtimeClient = null;', 'guest realtime var')
main = replace_once(main, 'let round1StartButton = null;', 'let round1StartButton = null;\nlet round1CancelButton = null;', 'cancel var')
main = replace_once(main, 'let round1Joined = false;', 'let round1Joined = false;\nlet round1JoinedAt = 0;', 'joinedAt var')

# Dedicated guest Realtime client, independent from shared auth state.
needle = 'let remoteAvatarLoading = null;\n\nasync function initMultiplayer() {'
helper = '''let remoteAvatarLoading = null;

async function getRound1RealtimeClient() {
  if (!currentUser?.isGuest) return supabaseClient;
  if (round1GuestRealtimeClient) return round1GuestRealtimeClient;
  try {
    const cfg = await import('./config.js');
    const createClient = globalThis.supabase?.createClient;
    if (typeof createClient !== 'function' || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return supabaseClient;
    round1GuestRealtimeClient = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },
      realtime: { params: { eventsPerSecond: 30 } }
    });
    return round1GuestRealtimeClient;
  } catch (error) {
    console.warn('guest realtime client', error);
    return supabaseClient;
  }
}

async function initMultiplayer() {'''
main = replace_once(main, needle, helper, 'guest realtime helper')

main = replace_once(
    main,
    '''  if (supabaseClient) {
    try {
      await connectSupabaseMultiplayer(roomId);''',
    '''  const primaryRealtimeClient = await getRound1RealtimeClient();
  if (primaryRealtimeClient) {
    try {
      await connectSupabaseMultiplayer(roomId, primaryRealtimeClient);''',
    'primary realtime selection',
)
# The fallback must really be PeerJS, not another retry of the global Supabase client.
main = replace_once(
    main,
    '''      await connectSupabaseMultiplayer(roomId);
      showToast('Гостевая сеть готова · запишитесь на Раунд 1');
      if (onlineEl) onlineEl.textContent = `Онлайн: ${Math.max(1, round1MemberIds().length)} · P2P`;''',
    '''      await connectSupabaseMultiplayer(roomId, null, true);
      showToast('Резервная гостевая сеть готова · запишитесь на Раунд 1');
      if (onlineEl) onlineEl.textContent = `Онлайн: ${Math.max(1, round1MemberIds().length)} · P2P`;''',
    'real p2p fallback',
)
main = replace_once(
    main,
    '''async function connectSupabaseMultiplayer(roomId) {
  cityRoom = (supabaseClient ? createRealtimeRoom : createPeerFallbackRoom)({
    client: supabaseClient,''',
    '''async function connectSupabaseMultiplayer(roomId, clientOverride = supabaseClient, forcePeer = false) {
  const roomClient = forcePeer ? null : clientOverride;
  cityRoom = (roomClient ? createRealtimeRoom : createPeerFallbackRoom)({
    client: roomClient,''',
    'connect room client',
)
main = main.replace("      joined: false,\n      avatar:", "      joined: false,\n      joinedAt: 0,\n      avatar:", 1)
# track after connection
main = main.replace("    joined: false,\n    avatar:", "    joined: false,\n    joinedAt: 0,\n    avatar:", 1)

# Setup round UI actions.
main = sub_once(
    main,
    r'function setupRound1UI\(\) \{.*?\n\}\n\nfunction round1MemberIds',
    '''function setupRound1UI() {
  document.body.classList.add('round1-mode');
  round1Hud = document.getElementById('round1-hud');
  round1Status = document.getElementById('round1-status');
  round1Question = document.getElementById('round1-question');
  round1Counter = document.getElementById('round1-counter');
  round1StartButton = document.getElementById('round1-start');
  round1CancelButton = document.getElementById('round1-cancel');
  round1WaitingNotice = document.getElementById('round1-waiting');
  round1WaitingNotice?.classList.add('hidden');
  round1Hud?.classList.remove('hidden');

  if (round1StartButton && !round1StartButton.dataset.round1Bound) {
    round1StartButton.dataset.round1Bound = '1';
    let lastTouchAction = 0;
    const primaryAction = (event) => {
      event?.stopPropagation?.();
      if (!round1Joined) {
        setRound1Registration(true);
        return;
      }
      if (round1HostId === String(playerId)) startRound1Match(round1RegisteredIds());
    };
    round1StartButton.addEventListener('click', (event) => {
      if (Date.now() - lastTouchAction < 700) return;
      primaryAction(event);
    });
    round1StartButton.addEventListener('touchend', (event) => {
      event.preventDefault();
      lastTouchAction = Date.now();
      primaryAction(event);
    }, { passive: false });
  }

  if (round1CancelButton && !round1CancelButton.dataset.round1Bound) {
    round1CancelButton.dataset.round1Bound = '1';
    let lastTouchCancel = 0;
    const cancel = (event) => {
      event?.stopPropagation?.();
      if (round1Joined) setRound1Registration(false);
    };
    round1CancelButton.addEventListener('click', (event) => {
      if (Date.now() - lastTouchCancel < 700) return;
      cancel(event);
    });
    round1CancelButton.addEventListener('touchend', (event) => {
      event.preventDefault();
      lastTouchCancel = Date.now();
      cancel(event);
    }, { passive: false });
  }
  updateRound1LobbyUI();
}

function round1MemberIds''',
    'setup round1 UI',
    flags=re.S,
)

main = sub_once(
    main,
    r'function round1RegisteredIds\(\) \{.*?\n\}',
    '''function round1RegisteredIds() {
  const byId = new Map();
  for (const member of round1Members || []) {
    const id = round1PresenceId(member);
    if (!id || !member?.joined) continue;
    byId.set(id, { id, joinedAt: Number(member.joinedAt || 0) });
  }
  if (round1Joined && playerId) {
    byId.set(String(playerId), { id: String(playerId), joinedAt: Number(round1JoinedAt || Date.now()) });
  }
  if (round1DebugBot?.joined) {
    byId.set(round1DebugBot.id, { id: round1DebugBot.id, joinedAt: Number(round1DebugBot.joinedAt || Date.now() + 1) });
  }
  return [...byId.values()]
    .sort((a, b) => {
      const at = a.joinedAt > 0 ? a.joinedAt : Number.MAX_SAFE_INTEGER;
      const bt = b.joinedAt > 0 ? b.joinedAt : Number.MAX_SAFE_INTEGER;
      return at - bt || a.id.localeCompare(b.id);
    })
    .map((entry) => entry.id)
    .slice(0, ROUND1_MAX_PLAYERS);
}''',
    'registered ids order',
    flags=re.S,
)
main = sub_once(
    main,
    r'function updateLocalPresenceCache\(joined\) \{.*?\n\}',
    '''function updateLocalPresenceCache(joined) {
  const id = String(playerId || '');
  const joinedAt = joined ? Number(round1JoinedAt || Date.now()) : 0;
  let found = false;
  round1Members = (round1Members || []).map((member) => {
    if (round1PresenceId(member) !== id) return member;
    found = true;
    return { ...member, id, key: member.key || id, joined: Boolean(joined), joinedAt, avatar: customAvatarUrl || currentUser?.avatarUrl || null };
  });
  if (!found && id) {
    round1Members.push({ id, key: id, name: currentUser?.name || 'Игрок', joined: Boolean(joined), joinedAt, avatar: customAvatarUrl || currentUser?.avatarUrl || null });
  }
}''',
    'local presence cache',
    flags=re.S,
)
main = replace_once(
    main,
    '''  round1JoinBusy = true;
  round1Joined = Boolean(joined);
  updateLocalPresenceCache(round1Joined);''',
    '''  round1JoinBusy = true;
  const nextJoined = Boolean(joined);
  if (nextJoined && !round1JoinedAt) round1JoinedAt = Date.now();
  if (!nextJoined) round1JoinedAt = 0;
  round1Joined = nextJoined;
  updateLocalPresenceCache(round1Joined);''',
    'registration joinedAt',
)
main = replace_once(
    main,
    '''        feature: ROUND1_ROOM_KEY,
        joined: round1Joined,
        avatar:''',
    '''        feature: ROUND1_ROOM_KEY,
        joined: round1Joined,
        joinedAt: round1Joined ? round1JoinedAt : 0,
        avatar:''',
    'track joinedAt',
)
main = replace_once(
    main,
    '''  } finally {
    round1JoinBusy = false;
    updateRound1LobbyUI();
    maybeAutoStartRound1();
  }
}''',
    '''  } finally {
    round1JoinBusy = false;
    maybeAutoStartRound1();
    updateRound1LobbyUI();
  }
}''',
    'registration finish',
)
main = sub_once(
    main,
    r'function maybeAutoStartRound1\(\) \{.*?\n\}',
    '''function maybeAutoStartRound1() {
  if (round1State) return;
  const queued = round1RegisteredIds();
  round1HostId = queued[0] || null;
}''',
    'disable auto start',
    flags=re.S,
)

main = sub_once(
    main,
    r'function updateRound1LobbyUI\(\) \{.*?\n\}\n\nfunction setupRound1DebugMode',
    '''function updateRound1LobbyUI() {
  if (!round1Hud) return;
  syncRound1InputMode();
  round1Hud.classList.remove('hidden');
  if (round1State) {
    round1StartButton?.classList.add('hidden');
    round1CancelButton?.classList.add('hidden');
    refreshRound1Visuals();
    return;
  }

  resetLocalRound1Flags();
  if (player) player.visible = true;
  const online = round1MemberIds();
  const queued = round1RegisteredIds();
  round1HostId = queued[0] || null;
  const isHost = round1Joined && round1HostId === String(playerId);
  placeLocalOnLobbySlot();

  if (round1Question) round1Question.textContent = 'Запись на Раунд 1';
  if (round1Counter) round1Counter.textContent = `Записано: ${queued.length} · онлайн ${online.length}`;
  if (round1Status) {
    round1Status.className = 'round1-status';
    if (!round1RealtimeReady && !round1DebugBot) {
      round1Status.textContent = 'Подключение к сетевой комнате…';
    } else if (!round1Joined) {
      round1Status.textContent = 'Запишитесь на участие. Первый записавшийся игрок управляет стартом матча.';
    } else if (isHost) {
      round1Status.textContent = `Вы ведущий. Сейчас записано ${queued.length}. Можно начать игру или подождать других.`;
      round1Status.classList.add('gold');
    } else {
      round1Status.textContent = `Вы записаны. Игроков в очереди: ${queued.length}. Ожидаем запуска ведущим.`;
    }
  }

  if (round1StartButton) {
    round1StartButton.classList.remove('hidden');
    round1StartButton.classList.toggle('joined', round1Joined);
    if (!round1Joined) {
      round1StartButton.disabled = round1JoinBusy || (!round1RealtimeReady && !round1DebugBot);
      round1StartButton.textContent = round1JoinBusy ? 'Синхронизация…' : 'Записаться на участие';
    } else if (isHost) {
      round1StartButton.disabled = round1JoinBusy || queued.length < 1;
      round1StartButton.textContent = `Начать игру · ${queued.length}`;
    } else {
      round1StartButton.disabled = true;
      round1StartButton.textContent = 'Ожидаем ведущего';
    }
  }
  if (round1CancelButton) {
    round1CancelButton.classList.toggle('hidden', !round1Joined);
    round1CancelButton.disabled = round1JoinBusy;
  }
}

function setupRound1DebugMode''',
    'lobby UI manual start',
    flags=re.S,
)

# Keep the first joined player as host and allow starting with one or more joined players.
main = replace_once(main, '  const host = chooseHostId(ids);\n  if (host !== String(playerId)) return;\n  if (ids.length < ROUND1_MIN_PLAYERS) {', '  const host = ids[0] || null;\n  if (host !== String(playerId)) return;\n  if (ids.length < 1) {', 'manual host start')

# Round spawn: player faces +Z while camera is behind and also looks +Z.
main = sub_once(
    main,
    r'function round1SpawnForId\(id, ids = round1RegisteredIds\(\)\) \{.*?\n\}',
    '''function round1SpawnForId(id, ids = round1RegisteredIds()) {
  const order = [...ids];
  const index = Math.max(0, order.indexOf(String(id)));
  const count = Math.max(1, order.length);
  const spread = Math.min(24, Math.max(5, (count - 1) * 3.2));
  const x = count === 1 ? 0 : -spread / 2 + (spread * index) / (count - 1);
  return { x, y: 0.32, z: ROUND1_START_Z - 3.2, yaw: Math.PI, rot: 0 };
}''',
    'round spawn direction',
    flags=re.S,
)
main = sub_once(
    main,
    r'function teleportLocalToRound1Start\(state\) \{.*?\n\}',
    '''function teleportLocalToRound1Start(state) {
  if (!player || !isRoundParticipant(state, playerId)) return;
  const participants = state.participantIds || state.activeIds || [];
  const spawn = round1SpawnForId(playerId, participants);
  player.visible = true;
  player.position.set(spawn.x, spawn.y, spawn.z);
  cameraMode = 'follow';
  freeCam = false;
  yaw = spawn.yaw;
  pitch = 0.14;
  player.rotation.y = spawn.rot;
  currentSpeed = 0;
  velocityY = 0;
  isGrounded = true;
  moveTarget = null;
  lastPoseX = player.position.x;
  lastPoseZ = player.position.z;
  if (camera) {
    camera.position.set(spawn.x, spawn.y + 3.0, spawn.z - 6.4);
    camera.lookAt(spawn.x, spawn.y + 1.45, spawn.z + 7.5);
  }
  broadcastPose(true);
}''',
    'teleport camera direction',
    flags=re.S,
)
# Remote participants should face the course, not inherit camera yaw.
main = main.replace('      rot: spawn.yaw,\n      moving: 0,', '      rot: spawn.rot ?? 0,\n      moving: 0,', 1)
# In syncRound1RemotePresence participating players use their model rotation, lobby players use lobby yaw.
main = replace_once(main, '      rot: spawn.yaw || 0,', '      rot: participating ? (spawn.rot ?? 0) : (spawn.yaw || 0),', 'remote participant facing')

# Reset join order on lobby reset.
main = replace_once(main, '  round1Joined = false;\n  resetLocalRound1Flags();', '  round1Joined = false;\n  round1JoinedAt = 0;\n  resetLocalRound1Flags();', 'reset joinedAt')
main = main.replace("cityRoom.track({ feature: ROUND1_ROOM_KEY, joined: false, avatar:", "cityRoom.track({ feature: ROUND1_ROOM_KEY, joined: false, joinedAt: 0, avatar:", 1)

# Registration handler: only name/email/password, internal username is invisible and unique.
main = sub_once(
    main,
    r'    // Register\n    document\.getElementById\(\'form-register\'\)\?\.addEventListener\(\'submit\', async \(e\) => \{.*?\n    \}\);\n\n    // Login',
    '''    // Register
    document.getElementById('form-register')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const displayName = (document.getElementById('reg-name')?.value || '').trim();
      const email = (document.getElementById('reg-email')?.value || '').trim();
      const pass = document.getElementById('reg-pass')?.value || '';
      const validationError = validateRegistration({ displayName, email, password: pass });
      if (validationError) { setAuthError(validationError); return; }
      if (!cloudEnabled) {
        setAuthError('Регистрация временно недоступна. Сейчас можно войти как гость.');
        return;
      }
      try {
        setAuthBusy(true);
        setAuthError('Создаём аккаунт…');
        const data = await authService.register({ displayName, email, password: pass });
        if (!data.session) {
          showAuthForm('login');
          document.getElementById('login-email').value = email;
          setAuthError('Аккаунт создан. Подтвердите email по ссылке в письме, затем войдите.');
          return;
        }
        cloudSession = data.session;
        playerId = data.user.id;
        const internalUsername = data.internalUsername || `u_${String(data.user.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 20)}`;
        currentUser = { username: internalUsername, name: displayName, gender: 'male', clothes: 'default', avatarUrl: null };
        await pushProfileToCloud();
        customAvatarUrl = null;
        setAuthError('');
        openCharacterScreen();
      } catch (error) {
        setAuthError(authErrorMessage(error));
      } finally {
        setAuthBusy(false);
      }
    });

    // Login''',
    'simple registration handler',
    flags=re.S,
)

# Doll closer; board moves behind/above it; remove the extra label that obscures the silhouette.
main = sub_once(
    main,
    r"\n  const label = new THREE\.Mesh\(\n    new THREE\.PlaneGeometry\(6\.2, 1\.4\),\n    new THREE\.MeshBasicMaterial\(\{ map: makeSignTexture\('НАБЛЮДАТЕЛЬ'.*?\n  doll\.add\(label\);",
    '\n  // Keep the watcher silhouette clear: instructions are shown in the HUD/board instead.',
    'remove doll label',
    flags=re.S,
)
main = replace_once(main, 'new THREE.PlaneGeometry(18, 4.4)', 'new THREE.PlaneGeometry(16, 3.6)', 'question board size')
main = replace_once(main, 'round1QuestionBoard.position.set(0, 8.2, 75.5);', 'round1QuestionBoard.position.set(0, 14.2, 73.5);', 'question board position')
main = replace_once(main, 'round1Doll.position.set(0, 0, 82);', 'round1Doll.position.set(0, 0, 71.5);\n  round1Doll.scale.setScalar(1.16);', 'doll position')

path.write_text(main, encoding='utf-8')

print('Round 1 flow v10 patch applied')
