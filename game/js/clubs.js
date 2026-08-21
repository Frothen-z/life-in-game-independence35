/**
 * Speaking Club · Chess · Monopoly + public table browser (no room codes)
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Chess } from 'chess.js';
import { createRealtimeRoom } from './services/realtime-room.js';
import { createMediaRoom, isMediaSignal } from './services/media-room.js';
import {
  advanceSpeakingState,
  applyChessAction,
  applyChessClock,
  applyMonopolyAction,
  createChessState,
  createMonopolyState,
  createSpeakingState,
  removeMonopolyPlayer
} from './services/game-rules.js';

const TABLES_TOPIC = 'club:lobby';

// Injected from main.js
let api = null;

export function initClubs(mainApi) {
  api = mainApi;
  injectStyles();
  injectHTML();
  bindUI();
  window.__tryOpenClub = tryOpenClubNearPlayer;
  window.__clubHint = clubHintText;
  console.log('[clubs] ready');
}

export function tryOpenClubNearPlayer() {
  const zone = (name) => {
    try { return api?.getZone?.(name); } catch { return null; }
  };
  const speaking = zone('speaking') || window.__speakingZone;
  const chess = zone('chess') || window.__chessZone;
  const monopoly = zone('monopoly') || window.__monopolyZone;
  if (isNear(speaking)) { openClubLobby('speaking'); return true; }
  if (isNear(chess)) { openClubLobby('chess'); return true; }
  if (isNear(monopoly)) { openClubLobby('monopoly'); return true; }
  return false;
}

export function clubHintText() {
  const speaking = window.__speakingZone;
  const chess = window.__chessZone;
  const monopoly = window.__monopolyZone;
  if (isNear(speaking)) return 'Нажми <kbd>E</kbd> — Speaking Club';
  if (isNear(chess)) return 'Нажми <kbd>E</kbd> — Шахматы';
  if (isNear(monopoly)) return 'Нажми <kbd>E</kbd> — Монополия';
  return null;
}

function isNear(zone) {
  const pl = api?.player || window.__playerRef;
  if (!pl || !zone || !zone.position) return false;
  const dx = pl.position.x - zone.position.x;
  const dz = pl.position.z - zone.position.z;
  return Math.hypot(dx, dz) <= (zone.radius || 16);
}

// ---------- Authenticated Supabase Realtime rooms ----------
let lobbyRoom = null;
let tableRoom = null;
const knownTables = new Map(); // id -> table
let myTable = null;
let clubLocalStream = null;
let clubMediaRoom = null;
function requireRealtime() {
  if (!api?.isAuthenticated?.() || !api?.realtimeClient) throw new Error('AUTH_REQUIRED');
  return api.realtimeClient;
}

function ensureClubMediaRoom() {
  if (clubMediaRoom) return clubMediaRoom;
  clubMediaRoom = createMediaRoom({
    selfId: api.playerId,
    send: async (message) => publishTableRoom(myTable?.id, message),
    getAccessToken: () => api?.getAccessToken?.() || '',
    onRemoteStream: ({ source, stream }) => {
      if (source !== 'camera') return;
      const id = myTable?.game === 'chess' ? 'chess-remote-video' : 'speaking-remote-video';
      const video = document.getElementById(id);
      if (!video) return;
      video.srcObject = stream.getTracks().length ? stream : null;
      video.play().catch(() => {});
    },
    onPeerState: ({ state }) => {
      if (state === 'failed') api?.showToast?.('Восстанавливаем связь за столом…');
    },
    onError: (error, context) => console.warn('[club-media]', context, error)
  });
  return clubMediaRoom;
}

function normalizePublicTable(table) {
  const id = String(table?.id || '').toUpperCase();
  const game = String(table?.game || '');
  if (!/^[A-Z0-9_-]{3,12}$/.test(id)) return null;
  if (!['speaking', 'chess', 'monopoly'].includes(game)) return null;
  const maxLimit = game === 'chess' ? 2 : game === 'speaking' ? 8 : 6;
  return {
    id,
    game,
    title: String(table?.title || 'Стол').slice(0, 80),
    hostId: String(table?.hostId || '').slice(0, 80),
    hostName: String(table?.hostName || 'Игрок').slice(0, 80),
    max: Math.min(maxLimit, Math.max(2, Number(table?.max) || maxLimit)),
    status: table?.status === 'open' ? 'open' : 'closed',
    players: Math.max(0, Number(table?.players) || 0),
    playerNames: Array.isArray(table?.playerNames)
      ? table.playerNames.slice(0, maxLimit).map((name) => String(name).slice(0, 80))
      : [],
    meta: {
      lang: String(table?.meta?.lang || '').slice(0, 30),
      level: String(table?.meta?.level || '').slice(0, 30),
      clock: String(table?.meta?.clock || '').slice(0, 20),
      mode: String(table?.meta?.mode || '').slice(0, 20)
    }
  };
}

function syncLobbyPresence(members = lobbyRoom?.members?.() || []) {
  knownTables.clear();
  for (const member of members) {
    const table = normalizePublicTable(member?.table);
    if (!table?.id || table.status !== 'open') continue;
    knownTables.set(table.id, { ...table, _updatedAt: Date.now() });
  }
  renderTablesList();
}

async function ensureTablesRealtime() {
  if (lobbyRoom?.connected) return lobbyRoom;
  lobbyRoom = createRealtimeRoom({
    client: requireRealtime(),
    topic: TABLES_TOPIC,
    playerId: api.playerId,
    displayName: api.currentUser?.name,
    presence: { scope: 'lobby', table: null },
    onPresence: syncLobbyPresence
  });
  await lobbyRoom.connect();
  return lobbyRoom;
}

function onTablePresence(members) {
  if (!myTable) return;
  const active = new Set(members.map((member) => String(member.id || member.key)));
  const departed = [];
  let changed = false;
  for (const member of members) {
    const id = String(member.id || member.key || '');
    if (!id || myTable.players[id]) continue;
    myTable.players[id] = { id, name: member.name || 'Игрок', ready: false };
    changed = true;
  }
  for (const id of Object.keys(myTable.players || {})) {
    if (!active.has(id)) {
      departed.push(id);
      delete myTable.players[id];
      changed = true;
    }
  }

  const departedHost = myTable.hostId && !active.has(myTable.hostId) ? myTable.hostId : null;
  if (departedHost && active.size) {
    const nextHost = [...active].sort()[0];
    myTable.hostId = nextHost;
    myTable.hostName = myTable.players[nextHost]?.name || 'Игрок';
    Object.values(myTable.players).forEach((player) => { player.host = player.id === nextHost; });
    changed = true;
    if (nextHost === api.playerId) {
      api?.showToast?.('Ведущий отключился — управление столом передано вам');
    } else {
      api?.showToast?.('Ведущий сменился после отключения');
    }
  }

  if (departed.length && myTable.hostId === api.playerId) {
    departed.forEach(handleClubPlayerDeparture);
  }
  if (changed && myTable.hostId === api.playerId) {
    announceTable();
    publishTableRoom(myTable.id, { type: 'sync', table: stripState(myTable) });
    if (myTable.state) publishTableRoom(myTable.id, { type: 'game-state', game: myTable.game, state: myTable.state });
  }
  if (changed) renderRoomPlayers();
  if (clubLocalStream) {
    ensureClubMediaRoom().syncPeers([...active].filter((id) => id !== api.playerId));
  }
}

function handleClubPlayerDeparture(departedPlayer) {
  if (!myTable?.state) return;
  if (myTable.game === 'chess' && myTable.state.status === 'playing') {
    const winner = departedPlayer === myTable.state.white ? myTable.state.black : myTable.state.white;
    myTable.state = {
      ...myTable.state,
      status: 'finished',
      winner,
      reason: 'disconnect',
      revision: Number(myTable.state.revision || 0) + 1,
      clocks: { ...myTable.state.clocks, activeSince: 0 }
    };
    applyChessState(myTable.state);
  }
  if (myTable.game === 'monopoly') {
    myTable.state = removeMonopolyPlayer(myTable.state, departedPlayer);
    updateMonoUI(myTable.state);
  }
  if (myTable.game === 'speaking') {
    const wasSpeaker = myTable.state.currentSpeaker === departedPlayer;
    myTable.state.queue = (myTable.state.queue || []).filter((id) => id !== departedPlayer);
    if (wasSpeaker) {
      myTable.state.speakerIndex = Math.max(-1, Number(myTable.state.speakerIndex || 0) - 1);
      commitSpeakingAdvance('timeout', api.playerId);
    }
    else applySpeakingPhase({ state: myTable.state });
  }
}

async function ensureTableRoom(tableId) {
  const topic = `room:club:${tableId}`;
  if (tableRoom?.connected && tableRoom.topic === topic) return tableRoom;
  if (tableRoom) {
    clubMediaRoom?.close({ stopLocal: false });
    clubMediaRoom = null;
    await tableRoom.close();
  }
  tableRoom = createRealtimeRoom({
    client: requireRealtime(),
    topic,
    playerId: api.playerId,
    displayName: api.currentUser?.name,
    presence: { game: myTable?.game || '', tableId },
    onMessage: handleRoomMessage,
    onPresence: onTablePresence
  });
  await tableRoom.connect();
  return tableRoom;
}

function publishTable(msg) {
  if (!lobbyRoom) return;
  if (msg.type === 'announce' && msg.table) {
    knownTables.set(msg.table.id, { ...msg.table, _updatedAt: Date.now() });
    lobbyRoom.track({ table: msg.table }).catch((error) => console.warn('[clubs] lobby presence', error));
  }
  if (msg.type === 'closed' && msg.tableId) {
    knownTables.delete(msg.tableId);
    lobbyRoom.track({ table: null }).catch((error) => console.warn('[clubs] lobby presence', error));
  }
  renderTablesList();
}

function publishTableRoom(tableId, msg) {
  if (!tableRoom || !tableId || myTable?.id !== tableId) return Promise.resolve(false);
  return tableRoom.send(msg).catch((error) => {
    console.warn('[clubs] room send', error);
    return false;
  });
}

function announceTable() {
  if (!myTable || myTable.status !== 'open') return;
  const pub = publicTable(myTable);
  pub._updatedAt = Date.now();
  knownTables.set(pub.id, pub); // show on host list too if reopened
  publishTable({ type: 'announce', table: pub });
}

function requestTablesRefresh() {
  syncLobbyPresence();
  renderTablesList();
  api?.showToast?.('Список столов обновлён');
}

function publicTable(t) {
  return {
    id: t.id,
    game: t.game,
    title: t.title,
    hostId: t.hostId,
    hostName: t.hostName,
    max: t.max,
    status: t.status,
    players: Object.keys(t.players || {}).length,
    playerNames: Object.values(t.players || {}).map((p) => p.name),
    meta: t.meta || {}
  };
}

// ---------- Lobby UI ----------
let currentLobbyGame = null;

function openClubLobby(game) {
  currentLobbyGame = game;
  document.getElementById('club-lobby')?.classList.remove('hidden');
  document.getElementById('club-lobby-title').textContent =
    game === 'speaking' ? 'Speaking Club' : game === 'chess' ? 'Шахматный клуб' : 'Монополия';
  document.getElementById('club-lobby-sub').textContent =
    game === 'speaking' ? 'Языковая практика · камера и микрофон' :
    game === 'chess' ? 'Партия 1 на 1 · камера и микрофон обязательны' :
    'Классическая монополия · 2–6 игроков';
  if (document.pointerLockElement) document.exitPointerLock();
  ensureTablesRealtime()
    .then(() => {
      requestTablesRefresh();
      if (myTable && myTable.status === 'open' && myTable.hostId === api?.playerId) announceTable();
    })
    .catch((error) => api?.showToast?.(
      String(error?.message).includes('AUTH_REQUIRED')
        ? 'Войдите в аккаунт, чтобы играть онлайн'
        : 'Нет связи со списком столов'
    ));
  setTimeout(() => renderTablesList(), 300);
}

function closeClubLobby() {
  document.getElementById('club-lobby')?.classList.add('hidden');
  currentLobbyGame = null;
}

function renderTablesList() {
  const list = document.getElementById('club-tables-list');
  if (!list || !currentLobbyGame) return;
  const rows = [...knownTables.values()].filter((t) => t.game === currentLobbyGame && t.status === 'open');
  if (!rows.length) {
    list.innerHTML = '<p class="club-empty">Нет открытых столов.<br/>Создайте свой или нажмите «Обновить»</p>';
    return;
  }
  list.innerHTML = rows.map((t) => `
    <div class="club-table-row" data-id="${escapeHtml(t.id)}">
      <div>
        <strong>${escapeHtml(t.title || 'Стол')}</strong>
        <div class="club-meta">${escapeHtml(t.hostName || '')} · ${t.players || 0}/${t.max}
        ${t.meta?.lang ? ' · ' + escapeHtml(t.meta.lang) : ''}
        ${t.meta?.clock ? ' · ' + escapeHtml(t.meta.clock) : ''}</div>
      </div>
      <button type="button" class="btn primary club-join-btn" data-id="${escapeHtml(t.id)}" style="width:auto;margin:0">Войти</button>
    </div>
  `).join('');
  list.querySelectorAll('.club-join-btn').forEach((btn) => {
    btn.addEventListener('click', () => joinTable(btn.dataset.id));
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

async function createTable() {
  const game = currentLobbyGame;
  if (!game) return;
  try {
    await ensureTablesRealtime();
  } catch (error) {
    api.showToast(String(error?.message).includes('AUTH_REQUIRED')
      ? 'Войдите в аккаунт, чтобы создать стол'
      : 'Нет связи со списком столов');
    return;
  }
  if (game === 'chess' || game === 'speaking') {
    try {
      clubLocalStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      api.showToast('Нужны камера и микрофон');
      return;
    }
  }

  const id = Math.random().toString(36).slice(2, 8).toUpperCase();
  const title = (api.currentUser?.name || 'Игрок') + ' — стол';
  myTable = {
    id,
    game,
    title,
    hostId: api.playerId,
    hostName: api.currentUser?.name || 'Игрок',
    max: game === 'chess' ? 2 : game === 'speaking' ? 8 : 6,
    status: 'open',
    players: {
      [api.playerId]: {
        id: api.playerId,
        name: api.currentUser?.name || 'Игрок',
        ready: false,
        host: true
      }
    },
    meta: game === 'speaking'
      ? { lang: 'English', level: 'Intermediate' }
      : game === 'chess'
        ? { clock: '10+5' }
        : { mode: 'classic' },
    state: null
  };
  try {
    await ensureTableRoom(id);
    if (clubLocalStream) await ensureClubMediaRoom().setLocalStream('camera', clubLocalStream);
  } catch {
    myTable = null;
    stopClubMedia();
    api.showToast('Не удалось создать защищённую комнату');
    return;
  }
  announceTable();
  closeClubLobby();
  openRoomUI(game);
  api?.showToast?.('Стол создан и сразу виден другим игрокам');
}

async function joinTable(tableId) {
  const t = knownTables.get(tableId);
  if (!t) return;
  if ((t.players || 0) >= t.max) {
    api.showToast('Стол полон');
    return;
  }
  try {
    await ensureTablesRealtime();
  } catch (error) {
    api.showToast(String(error?.message).includes('AUTH_REQUIRED')
      ? 'Войдите в аккаунт, чтобы играть онлайн'
      : 'Нет связи со списком столов');
    return;
  }
  if (t.game === 'chess' || t.game === 'speaking') {
    try {
      clubLocalStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      api.showToast('Нужны камера и микрофон');
      return;
    }
  }
  myTable = {
    id: t.id,
    game: t.game,
    title: t.title,
    hostId: t.hostId,
    hostName: t.hostName,
    max: t.max,
    status: t.status,
    players: {
      [api.playerId]: {
        id: api.playerId,
        name: api.currentUser?.name || 'Игрок',
        ready: false
      }
    },
    meta: t.meta || {},
    state: null
  };
  try {
    await ensureTableRoom(t.id);
    if (clubLocalStream) await ensureClubMediaRoom().setLocalStream('camera', clubLocalStream);
  } catch {
    myTable = null;
    stopClubMedia();
    api.showToast('Не удалось войти в защищённую комнату');
    return;
  }
  publishTableRoom(t.id, { type: 'join', name: api.currentUser?.name || 'Игрок' });
  closeClubLobby();
  openRoomUI(t.game);
  api.showToast('Вы вошли за стол');
}

function leaveTable() {
  const departingTable = myTable;
  const departingRoom = tableRoom;
  if (departingTable) {
    if (departingTable.hostId === api?.playerId) {
      publishTable({ type: 'closed', tableId: departingTable.id });
    }
  }
  myTable = null;
  tableRoom = null;
  if (departingRoom) {
    departingRoom.send({ type: 'leave' })
      .catch(() => {})
      .finally(() => departingRoom.close());
  }
  stopClubMedia();
  if (speakingTimer) { clearTimeout(speakingTimer); speakingTimer = null; }
  if (speakingClockTimer) { clearInterval(speakingClockTimer); speakingClockTimer = null; }
  if (chessClockTimer) { clearInterval(chessClockTimer); chessClockTimer = null; }
  chessGame = null;
  chessSelected = null;
  disposeChessBoard3D();
  hideAllRooms();
}

function stopClubMedia() {
  clubMediaRoom?.close({ stopLocal: false });
  clubMediaRoom = null;
  if (clubLocalStream) {
    clubLocalStream.getTracks().forEach((tr) => tr.stop());
    clubLocalStream = null;
  }
}

function openRoomUI(game) {
  hideAllRooms();
  if (document.pointerLockElement) document.exitPointerLock();
  if (game === 'speaking') openSpeakingRoom();
  else if (game === 'chess') openChessRoom();
  else if (game === 'monopoly') openMonopolyRoom();
}

function hideAllRooms() {
  document.getElementById('speaking-room')?.classList.add('hidden');
  document.getElementById('chess-room')?.classList.add('hidden');
  document.getElementById('monopoly-room')?.classList.add('hidden');
}

// ---------- Room message router ----------
function handleRoomMessage(msg) {
  if (!myTable || msg.from === api.playerId) return;
  if (msg.type === 'join' && myTable.hostId === api.playerId) {
    myTable.players[msg.from] = { id: msg.from, name: msg.name || 'Игрок', ready: false };
    announceTable();
    publishTableRoom(myTable.id, { type: 'sync', table: stripState(myTable) });
    renderRoomPlayers();
  }
  if (msg.type === 'sync' && msg.table && msg.from === myTable.hostId) {
    Object.assign(myTable, msg.table);
    if (!myTable.players) myTable.players = {};
    renderRoomPlayers();
  }
  if (msg.type === 'leave' && myTable.players) {
    delete myTable.players[msg.from];
    renderRoomPlayers();
  }
  if (msg.type === 'ready') {
    if (myTable.players[msg.from]) myTable.players[msg.from].ready = !!msg.ready;
    renderRoomPlayers();
    if (myTable.hostId === api.playerId) maybeStartGame();
  }
  if (msg.type === 'start' && msg.from === myTable.hostId) {
    myTable.status = 'playing';
    myTable.state = msg.state;
    onGameStart(msg.state);
  }
  if (msg.type === 'game-state' && msg.from === myTable.hostId && msg.game === myTable.game && msg.state) {
    myTable.state = msg.state;
    if (myTable.game === 'speaking') applySpeakingPhase({ state: msg.state });
    if (myTable.game === 'chess') applyChessState(msg.state);
    if (myTable.game === 'monopoly') updateMonoUI(msg.state);
  }
  if (msg.type === 'phase' && msg.from === myTable.hostId && myTable.game === 'speaking') {
    applySpeakingPhase(msg);
  }
  if (msg.type === 'done_speak' && myTable.game === 'speaking' && myTable.hostId === api.playerId) {
    commitSpeakingAdvance('done', msg.from);
  }
  if (msg.type === 'chess-action' && myTable.game === 'chess' && myTable.hostId === api.playerId) {
    hostApplyChessAction(msg);
  }
  if (msg.type === 'chess-state' && msg.from === myTable.hostId && myTable.game === 'chess' && msg.state) {
    applyChessState(msg.state);
  }
  if (msg.type === 'chess-rejected' && myTable.game === 'chess') {
    api?.showToast?.('Ход отклонён правилами или уже устарел');
    applyChessState(myTable.state);
  }
  if (msg.type === 'mono-action' && myTable.game === 'monopoly' && myTable.hostId === api.playerId) {
    hostApplyMonoAction(msg);
  }
  if (msg.type === 'mono-state' && msg.from === myTable.hostId && myTable.game === 'monopoly' && msg.state) {
    myTable.state = msg.state;
    updateMonoUI(msg.state);
  }
  if (msg.type === 'mono-rejected' && myTable.game === 'monopoly') {
    api?.showToast?.(monoErrorText(msg.error));
  }
  if (isMediaSignal(msg)) ensureClubMediaRoom().handleSignal(msg);
}

function stripState(t) {
  return {
    id: t.id, game: t.game, title: t.title, hostId: t.hostId, hostName: t.hostName,
    max: t.max, status: t.status, players: t.players, meta: t.meta
  };
}

function renderRoomPlayers() {
  if (!myTable) return;
  const el = document.getElementById(myTable.game + '-players');
  if (!el) return;
  const ps = Object.values(myTable.players || {});
  el.innerHTML = ps.map((p) =>
    `<div class="club-player-chip ${p.ready ? 'ready' : ''}">${escapeHtml(p.name)}${p.host ? ' 👑' : ''}${p.ready ? ' ✓' : ''}</div>`
  ).join('');
}

function maybeStartGame() {
  if (!myTable || myTable.hostId !== api.playerId) return;
  if (myTable.status !== 'open') return;
  const ps = Object.values(myTable.players || {});
  const min = myTable.game === 'chess' ? 2 : 2;
  if (ps.length < min) return;
  if (!ps.every((p) => p.ready || p.id === api.playerId)) return;
  // host must be ready too
  if (!ps.every((p) => p.ready)) return;

  let state = null;
  if (myTable.game === 'speaking') state = buildSpeakingState();
  if (myTable.game === 'chess') state = buildChessState();
  if (myTable.game === 'monopoly') state = buildMonoState();
  myTable.status = 'playing';
  myTable.state = state;
  publishTable({ type: 'closed', tableId: myTable.id }); // hide from open list
  publishTableRoom(myTable.id, { type: 'start', state });
  onGameStart(state);
}

function onGameStart(state) {
  if (!myTable) return;
  if (myTable.game === 'speaking') startSpeaking(state);
  if (myTable.game === 'chess') startChess(state);
  if (myTable.game === 'monopoly') startMono(state);
}

// ===================== SPEAKING CLUB =====================
let speakingTimer = null;
let speakingClockTimer = null;
let speakingPhase = null;

function buildSpeakingState() {
  const ids = Object.keys(myTable.players);
  return createSpeakingState(
    ids,
    SPEAK_TOPICS[Math.floor(Math.random() * SPEAK_TOPICS.length)]
  );
}

const SPEAK_TOPICS = [
  'Travel', 'Food', 'Work or study', 'Movies', 'Weekend plans',
  'Technology', 'Music', 'Hometown', 'Sports', 'Books'
];

function openSpeakingRoom() {
  document.getElementById('speaking-room')?.classList.remove('hidden');
  document.getElementById('speaking-status').textContent = 'Лобби — нажмите «Готов»';
  document.getElementById('speaking-topic').textContent = '—';
  renderRoomPlayers();
  attachLocalVideo('speaking-local-video');
  ensureClubMediaRoom().announce('camera');
}

function startSpeaking(state) {
  myTable.state = state;
  applySpeakingPhase({ phase: state.phase, state });
}

function applySpeakingPhase(msg) {
  const st = msg.state || myTable.state;
  if (!st) return;
  myTable.state = st;
  speakingPhase = st.phase;
  const status = document.getElementById('speaking-status');
  const topic = document.getElementById('speaking-topic');
  if (topic) topic.textContent = 'Тема: ' + (st.topic || '—');
  clearTimeout(speakingTimer);
  speakingTimer = null;
  clearInterval(speakingClockTimer);
  speakingClockTimer = null;
  const clock = document.getElementById('speaking-clock');
  if (clock) clock.textContent = st.endsAt ? `До смены этапа: ${formatRemaining(st.endsAt)}` : '';
  if (clock && st.endsAt) {
    speakingClockTimer = setInterval(() => {
      clock.textContent = `До смены этапа: ${formatRemaining(st.endsAt)}`;
    }, 500);
  }

  if (st.phase === 'rules') {
    if (status) status.textContent = 'Правила: говорим уважительно, на языке клуба. Старт через несколько секунд…';
    setSpeakMics('none');
  } else if (st.phase === 'ice') {
    const sp = st.currentSpeaker || st.queue[st.speakerIndex];
    const name = myTable.players[sp]?.name || 'Игрок';
    if (status) status.textContent = `Ice-breaker: слово у ${name} (1 мин) — представьтесь`;
    setSpeakMics(sp);
  } else if (st.phase === 'free') {
    if (status) status.textContent = 'Общее обсуждение — микрофоны у всех (5–8 мин)';
    setSpeakMics('all');
  } else if (st.phase === 'finale') {
    const sp = st.currentSpeaker || st.queue[st.speakerIndex];
    const name = myTable.players[sp]?.name || 'Игрок';
    if (status) status.textContent = `Финал: ${name} — one thought from today (30 сек)`;
    setSpeakMics(sp);
  } else if (st.phase === 'end') {
    if (status) status.textContent = 'Сессия завершена. Спасибо!';
    setSpeakMics('none');
  }

  if (myTable.hostId === api.playerId && st.phase !== 'end' && st.endsAt) {
    speakingTimer = setTimeout(
      () => commitSpeakingAdvance('timeout', api.playerId),
      Math.max(0, st.endsAt - Date.now())
    );
  }
}

function commitSpeakingAdvance(reason, actorId) {
  if (!myTable || myTable.hostId !== api.playerId) return;
  const result = advanceSpeakingState(myTable.state, {
    actorId,
    hostId: myTable.hostId,
    reason,
    now: Date.now()
  });
  if (!result.ok) return;
  myTable.state = result.state;
  publishTableRoom(myTable.id, { type: 'phase', phase: result.state.phase, state: result.state });
  applySpeakingPhase({ state: result.state });
}

function setSpeakMics(who) {
  if (!clubLocalStream) return;
  const audio = clubLocalStream.getAudioTracks()[0];
  if (!audio) return;
  if (who === 'all') audio.enabled = true;
  else if (who === 'none') audio.enabled = false;
  else audio.enabled = (who === api.playerId);
}

function speakingDone() {
  if (!myTable || !['ice', 'finale'].includes(speakingPhase)) return;
  const speaker = myTable.state?.currentSpeaker || myTable.state?.queue?.[myTable.state?.speakerIndex];
  if (speaker !== api.playerId && myTable.hostId !== api.playerId) {
    api?.showToast?.('Завершить выступление может только текущий спикер');
    return;
  }
  if (myTable.hostId === api.playerId) commitSpeakingAdvance('done', api.playerId);
  else publishTableRoom(myTable.id, { type: 'done_speak' });
}

function formatRemaining(endsAt) {
  const total = Math.max(0, Math.ceil((Number(endsAt || 0) - Date.now()) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// ===================== CHESS =====================
let chessGame = null;
let chessColor = null;
let chessBoardPreview = null; // { renderer, scene, camera, root, raf }

let chessClock = { w: 600000, b: 600000, inc: 5000, activeSince: 0 };
let chessClockTimer = null;

function buildChessState() {
  const ids = Object.keys(myTable.players);
  return createChessState(ids);
}

function openChessRoom() {
  document.getElementById('chess-room')?.classList.remove('hidden');
  document.getElementById('chess-status').textContent = 'Лобби — нужны 2 игрока, оба «Готов»';
  renderRoomPlayers();
  renderChessBoardEmpty();
  attachLocalVideo('chess-local-video');
  initChessBoard3D();
  ensureClubMediaRoom().announce('camera');
}

function disposeChessBoard3D() {
  if (chessBoardPreview) {
    cancelAnimationFrame(chessBoardPreview.raf);
    try { chessBoardPreview.ro?.disconnect(); } catch (e) {}
    try {
      chessBoardPreview.renderer.dispose();
      chessBoardPreview.renderer.forceContextLoss?.();
    } catch (e) {}
    chessBoardPreview = null;
  }
  const host = document.getElementById('chess-board-3d');
  if (host) host.innerHTML = '';
}

function initChessBoard3D() {
  disposeChessBoard3D();
  const host = document.getElementById('chess-board-3d');
  if (!host) {
    console.warn('[chess3d] host missing');
    return;
  }
  // Wait 2 frames so overlay layout has non-zero size
  requestAnimationFrame(() => {
    requestAnimationFrame(() => startChessBoard3D(host));
  });
}

function startChessBoard3D(host) {
  if (!host || chessBoardPreview) return;

  let w = host.clientWidth || host.offsetWidth || 0;
  let h = host.clientHeight || 0;
  if (w < 100) w = 320;
  if (h < 100) h = Math.round(w * 0.75);
  h = Math.max(200, Math.min(h, 320));

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, true);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x2a221c, 1);
  host.innerHTML = '';
  host.appendChild(renderer.domElement);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = h + 'px';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.borderRadius = '12px';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a221c);
  const camera = new THREE.PerspectiveCamera(32, w / h, 0.05, 80);
  camera.position.set(2.2, 2.4, 2.2);
  camera.lookAt(0, 0.2, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.95));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.35);
  sun.position.set(4, 8, 3);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xaaccff, 0.55);
  fill.position.set(-4, 3, -3);
  scene.add(fill);
  const hemi = new THREE.HemisphereLight(0xddeeff, 0x443322, 0.45);
  scene.add(hemi);

  const root = new THREE.Group();
  scene.add(root);
  chessBoardPreview = { renderer, scene, camera, root, raf: 0, spinning: true, host };

  const loader = new GLTFLoader();
  const url = new URL('models/chess/board.glb', window.location.href).href;
  loader.load(
    url,
    (gltf) => {
      if (!chessBoardPreview) return;
      const model = gltf.scene;
      model.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = false;
          c.receiveShadow = true;
          if (c.material) {
            const mats = Array.isArray(c.material) ? c.material : [c.material];
            for (const m of mats) {
              if (!m) continue;
              if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
              m.side = THREE.DoubleSide;
              // ensure not pure black unlit
              if (m.color && m.color.r + m.color.g + m.color.b < 0.05 && !m.map && !m.emissiveMap) {
                m.color.setHex(0xcccccc);
              }
              m.needsUpdate = true;
            }
          }
        }
      });
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      model.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      model.scale.setScalar(1.7 / maxDim);
      const box2 = new THREE.Box3().setFromObject(model);
      model.position.y -= box2.min.y;
      root.add(model);
      camera.position.set(1.55, 1.75, 1.55);
      camera.lookAt(0, size.y * (1.7 / maxDim) * 0.2, 0);
      console.log('[chess3d] board loaded', maxDim.toFixed(2));
    },
    undefined,
    (err) => {
      console.warn('[chess3d] load fail', err);
      host.insertAdjacentHTML(
        'beforeend',
        '<p style="color:#ccc;text-align:center;padding:12px;font-size:13px">3D-доска не загрузилась</p>'
      );
    }
  );

  let dragging = false, px = 0, py = 0;
  const el = renderer.domElement;
  el.style.touchAction = 'none';
  el.style.cursor = 'grab';
  el.addEventListener('pointerdown', (e) => {
    dragging = true;
    if (chessBoardPreview) chessBoardPreview.spinning = false;
    px = e.clientX; py = e.clientY;
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    el.style.cursor = 'grabbing';
  });
  el.addEventListener('pointerup', () => {
    dragging = false;
    el.style.cursor = 'grab';
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging || !chessBoardPreview) return;
    const dx = e.clientX - px;
    const dy = e.clientY - py;
    px = e.clientX; py = e.clientY;
    root.rotation.y += dx * 0.012;
    root.rotation.x = THREE.MathUtils.clamp(root.rotation.x + dy * 0.01, -0.5, 0.6);
  });

  // Resize if host grows
  const ro = new ResizeObserver(() => {
    if (!chessBoardPreview) return;
    const nw = Math.max(host.clientWidth || w, 200);
    const nh = Math.max(200, Math.min(320, Math.round(nw * 0.75)));
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
    renderer.setSize(nw, nh, true);
    renderer.domElement.style.height = nh + 'px';
  });
  try { ro.observe(host); } catch (e) {}
  chessBoardPreview.ro = ro;

  const tick = () => {
    if (!chessBoardPreview) return;
    chessBoardPreview.raf = requestAnimationFrame(tick);
    if (chessBoardPreview.spinning) root.rotation.y += 0.005;
    renderer.render(scene, camera);
  };
  tick();
}


function startChess(state) {
  myTable.state = state;
  chessGame = new Chess(state.fen);
  chessColor = state.white === api.playerId ? 'w' : state.black === api.playerId ? 'b' : null;
  chessClock = { ...state.clocks };
  document.getElementById('chess-status').textContent =
    chessColor === 'w' ? 'Вы белые' : chessColor === 'b' ? 'Вы чёрные' : 'Наблюдатель';
  renderChessBoard();
  startChessClock();
  // connect media to opponent
  const opp = chessColor === 'w' ? state.black : state.white;
  if (opp && clubLocalStream) ensureClubMediaRoom().connectPeer(opp, { initiate: true });
}

function startChessClock() {
  clearInterval(chessClockTimer);
  chessClockTimer = setInterval(() => {
    if (!chessGame || myTable?.state?.status !== 'playing') return;
    updateChessClockUI();
    if (myTable?.hostId === api.playerId) {
      const result = applyChessClock(myTable.state, Chess, { now: Date.now() });
      if (result.changed) {
        myTable.state = result.state;
        broadcastChessState();
        applyChessState(result.state);
      }
    }
  }, 250);
}

function updateChessClockUI() {
  const el = document.getElementById('chess-clocks');
  if (!el || !myTable?.state || !chessGame) return;
  const clocks = myTable.state.clocks || chessClock;
  let whiteMs = Number(clocks.w || 0);
  let blackMs = Number(clocks.b || 0);
  if (myTable.state.status === 'playing' && clocks.activeSince) {
    const elapsed = Math.max(0, Date.now() - Number(clocks.activeSince));
    if (chessGame.turn() === 'w') whiteMs = Math.max(0, whiteMs - elapsed);
    else blackMs = Math.max(0, blackMs - elapsed);
  }
  const fmt = (ms) => {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  el.textContent = `♔ ${fmt(whiteMs)}  ·  ♚ ${fmt(blackMs)}`;
}

function renderChessBoardEmpty() {
  const board = document.getElementById('chess-board');
  if (!board) return;
  board.innerHTML = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement('div');
      sq.className = 'chess-sq ' + ((r + c) % 2 ? 'dark' : 'light');
      board.appendChild(sq);
    }
  }
}

// One glyph set; color via CSS so white/black are clearly different
const PIECE_GLYPH = {
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟'
};

let chessSelected = null;
let chessLegal = [];

function renderChessBoard() {
  const board = document.getElementById('chess-board');
  if (!board || !chessGame) return;
  board.innerHTML = '';
  // Each player sees their own pieces at the bottom
  const orient = chessColor === 'b' ? 'b' : 'w';
  updateChessClockUI();

  // legal targets for selected piece
  chessLegal = [];
  if (chessSelected) {
    try {
      chessLegal = chessGame.moves({ square: chessSelected, verbose: true }).map((m) => m.to);
    } catch (e) { chessLegal = []; }
  }

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const r = orient === 'w' ? 7 - row : row;
      const c = orient === 'w' ? col : 7 - col;
      const file = 'abcdefgh'[c];
      const rank = r + 1;
      const name = file + rank;
      const piece = chessGame.get(name);
      const sq = document.createElement('div');
      const isDark = (r + c) % 2 === 1;
      sq.className = 'chess-sq ' + (isDark ? 'dark' : 'light');
      sq.dataset.sq = name;
      if (chessSelected === name) sq.classList.add('selected');
      if (chessLegal.includes(name)) sq.classList.add('legal');

      if (piece) {
        const span = document.createElement('span');
        span.className = 'chess-piece ' + (piece.color === 'w' ? 'pc-white' : 'pc-black');
        span.textContent = PIECE_GLYPH[piece.type] || '';
        span.setAttribute('aria-label', piece.color + piece.type);
        sq.appendChild(span);
      }
      sq.addEventListener('click', () => onChessSquare(name));
      board.appendChild(sq);
    }
  }
  const st = document.getElementById('chess-status');
  if (myTable.state.status === 'finished') {
    const winnerName = myTable.players[myTable.state.winner]?.name || '';
    const reason = {
      checkmate: 'Мат', timeout: 'Время вышло', resign: 'Соперник сдался', disconnect: 'Соперник отключился',
      stalemate: 'Пат', threefold: 'Троекратное повторение', insufficient: 'Недостаточно материала', draw: 'Ничья'
    }[myTable.state.reason] || 'Партия завершена';
    if (st) st.textContent = myTable.state.winner ? `${reason} · Победил ${winnerName}` : reason;
  } else if (st && chessColor) {
    const turn = chessGame.turn() === 'w' ? 'белых' : 'чёрных';
    const you = chessColor === 'w' ? 'белые' : 'чёрные';
    st.textContent = 'Вы: ' + you + ' · Ход ' + turn;
  }
}

function onChessSquare(name) {
  if (!chessGame || !chessColor) return;
  if (chessGame.turn() !== chessColor) return;
  if (chessGame.isGameOver()) return;
  if (!chessSelected) {
    const p = chessGame.get(name);
    if (p && p.color === chessColor) {
      chessSelected = name;
      renderChessBoard();
    }
    return;
  }
  if (chessSelected === name) {
    chessSelected = null;
    renderChessBoard();
    return;
  }
  const move = { fromSquare: chessSelected, toSquare: name, promotion: 'q' };
  let legal = true;
  try {
    const preview = new Chess(chessGame.fen());
    preview.move({ from: move.fromSquare, to: move.toSquare, promotion: move.promotion });
  } catch {
    legal = false;
  }
  chessSelected = null;
  if (!legal) {
    const p = chessGame.get(name);
    if (p && p.color === chessColor) chessSelected = name;
    renderChessBoard();
    return;
  }
  const action = { type: 'chess-action', kind: 'move', ...move };
  if (myTable.hostId === api.playerId) hostApplyChessAction({ ...action, from: api.playerId });
  else publishTableRoom(myTable.id, action);
  const status = document.getElementById('chess-status');
  if (status) status.textContent = 'Ход отправлен — ждём подтверждение ведущего…';
}

function hostApplyChessAction(msg) {
  if (!myTable?.state || myTable.hostId !== api.playerId) return;
  const result = applyChessAction(myTable.state, msg, Chess, { now: Date.now() });
  if (!result.ok) {
    publishTableRoom(myTable.id, { type: 'chess-rejected', to: msg.from, error: result.error });
    return;
  }
  myTable.state = result.state;
  broadcastChessState();
  applyChessState(result.state);
}

function broadcastChessState() {
  publishTableRoom(myTable.id, { type: 'chess-state', state: myTable.state });
}

function applyChessState(state) {
  if (!state || !myTable) return;
  if (myTable.state && Number(state.revision || 0) < Number(myTable.state.revision || 0)) return;
  myTable.state = state;
  chessClock = { ...state.clocks };
  if (!chessGame) chessGame = new Chess(state.fen);
  else chessGame.load(state.fen);
  chessColor = state.white === api.playerId ? 'w' : state.black === api.playerId ? 'b' : null;
  renderChessBoard();
  updateChessClockUI();
}

function chessResign() {
  if (!myTable || myTable.state?.status !== 'playing') return;
  const action = { type: 'chess-action', kind: 'resign' };
  if (myTable.hostId === api.playerId) hostApplyChessAction({ ...action, from: api.playerId });
  else publishTableRoom(myTable.id, action);
}

// ===================== MONOPOLY =====================
const MONO_START_MONEY = 1500000;
const MONO_GO = 200000;

// Simplified 40 spaces - classic structure
const MONO_BOARD = [
  { id: 0, name: 'Старт', type: 'go' },
  { id: 1, name: 'Парковая', type: 'prop', group: 'brown', price: 60000, rent: [2000, 10000, 30000, 90000, 160000, 250000], house: 50000 },
  { id: 2, name: 'Казна', type: 'chest' },
  { id: 3, name: 'Фонарная', type: 'prop', group: 'brown', price: 60000, rent: [4000, 20000, 60000, 180000, 320000, 450000], house: 50000 },
  { id: 4, name: 'Подоходный налог', type: 'tax', amount: 200000 },
  { id: 5, name: 'Вокзал Север', type: 'rail', price: 200000 },
  { id: 6, name: 'Ресторан', type: 'prop', group: 'lightblue', price: 100000, rent: [6000, 30000, 90000, 270000, 400000, 550000], house: 50000 },
  { id: 7, name: 'Шанс', type: 'chance' },
  { id: 8, name: 'Кафе', type: 'prop', group: 'lightblue', price: 100000, rent: [6000, 30000, 90000, 270000, 400000, 550000], house: 50000 },
  { id: 9, name: 'Кино', type: 'prop', group: 'lightblue', price: 120000, rent: [8000, 40000, 100000, 300000, 450000, 600000], house: 50000 },
  { id: 10, name: 'Тюрьма', type: 'jail' },
  { id: 11, name: 'Мафия-клуб', type: 'prop', group: 'pink', price: 140000, rent: [10000, 50000, 150000, 450000, 625000, 750000], house: 100000 },
  { id: 12, name: 'Электросеть', type: 'util', price: 150000 },
  { id: 13, name: 'Переулок', type: 'prop', group: 'pink', price: 140000, rent: [10000, 50000, 150000, 450000, 625000, 750000], house: 100000 },
  { id: 14, name: 'Площадь', type: 'prop', group: 'pink', price: 160000, rent: [12000, 60000, 180000, 500000, 700000, 900000], house: 100000 },
  { id: 15, name: 'Вокзал Юг', type: 'rail', price: 200000 },
  { id: 16, name: 'Speaking', type: 'prop', group: 'orange', price: 180000, rent: [14000, 70000, 200000, 550000, 750000, 950000], house: 100000 },
  { id: 17, name: 'Казна', type: 'chest' },
  { id: 18, name: 'Офисы', type: 'prop', group: 'orange', price: 180000, rent: [14000, 70000, 200000, 550000, 750000, 950000], house: 100000 },
  { id: 19, name: 'Перекрёсток', type: 'prop', group: 'orange', price: 200000, rent: [16000, 80000, 220000, 600000, 800000, 1000000], house: 100000 },
  { id: 20, name: 'Парковка', type: 'park' },
  { id: 21, name: 'Бассейн', type: 'prop', group: 'red', price: 220000, rent: [18000, 90000, 250000, 700000, 875000, 1050000], house: 150000 },
  { id: 22, name: 'Шанс', type: 'chance' },
  { id: 23, name: 'Спорт', type: 'prop', group: 'red', price: 220000, rent: [18000, 90000, 250000, 700000, 875000, 1050000], house: 150000 },
  { id: 24, name: 'Набережная', type: 'prop', group: 'red', price: 240000, rent: [20000, 100000, 300000, 750000, 925000, 1100000], house: 150000 },
  { id: 25, name: 'Вокзал Восток', type: 'rail', price: 200000 },
  { id: 26, name: 'Торговая', type: 'prop', group: 'yellow', price: 260000, rent: [22000, 110000, 330000, 800000, 975000, 1150000], house: 150000 },
  { id: 27, name: 'Шахматный', type: 'prop', group: 'yellow', price: 260000, rent: [22000, 110000, 330000, 800000, 975000, 1150000], house: 150000 },
  { id: 28, name: 'Водоканал', type: 'util', price: 150000 },
  { id: 29, name: 'Бульвар', type: 'prop', group: 'yellow', price: 280000, rent: [24000, 120000, 360000, 850000, 1025000, 1200000], house: 150000 },
  { id: 30, name: 'В тюрьму', type: 'gotojail' },
  { id: 31, name: 'Деловой', type: 'prop', group: 'green', price: 300000, rent: [26000, 130000, 390000, 900000, 1100000, 1275000], house: 200000 },
  { id: 32, name: 'Центральный', type: 'prop', group: 'green', price: 300000, rent: [26000, 130000, 390000, 900000, 1100000, 1275000], house: 200000 },
  { id: 33, name: 'Казна', type: 'chest' },
  { id: 34, name: 'Гранд-отель', type: 'prop', group: 'green', price: 320000, rent: [28000, 150000, 450000, 1000000, 1200000, 1400000], house: 200000 },
  { id: 35, name: 'Вокзал Запад', type: 'rail', price: 200000 },
  { id: 36, name: 'Шанс', type: 'chance' },
  { id: 37, name: 'Престиж', type: 'prop', group: 'blue', price: 350000, rent: [35000, 175000, 500000, 1100000, 1300000, 1500000], house: 200000 },
  { id: 38, name: 'Налог на роскошь', type: 'tax', amount: 100000 },
  { id: 39, name: 'Сити-Тауэр', type: 'prop', group: 'blue', price: 400000, rent: [50000, 200000, 600000, 1400000, 1700000, 2000000], house: 200000 }
];

function buildMonoState() {
  return createMonopolyState(Object.values(myTable.players), {
    startMoney: MONO_START_MONEY,
    goReward: MONO_GO
  });
}

function openMonopolyRoom() {
  document.getElementById('monopoly-room')?.classList.remove('hidden');
  document.getElementById('mono-status').textContent = 'Лобби — 2–6 игроков, все «Готов»';
  renderRoomPlayers();
  renderMonoBoard(null);
}

function startMono(state) {
  myTable.state = state;
  renderMonoBoard(state);
  updateMonoUI(state);
}

const MONO_GROUP_COLOR = {
  brown: '#8B4513', lightblue: '#aae0f0', pink: '#d93a96', orange: '#f7941d',
  red: '#ed1b24', yellow: '#fef200', green: '#1fb25a', blue: '#0072bb'
};

/** Map track index 0..39 → CSS grid row/col on 11×11 classic board (GO = bottom-right) */
function monoTrackToGrid(i) {
  if (i >= 0 && i <= 10) return { row: 11, col: 11 - i };       // bottom: GO→Jail
  if (i >= 11 && i <= 19) return { row: 11 - (i - 10), col: 1 }; // left up
  if (i >= 20 && i <= 30) return { row: 1, col: i - 19 };        // top left→right
  if (i >= 31 && i <= 39) return { row: i - 29, col: 11 };       // right down
  return { row: 6, col: 6 };
}

function renderMonoBoard(state) {
  const el = document.getElementById('mono-board');
  if (!el) return;
  el.className = 'mono-board mono-classic';
  const tokensByCell = {};
  if (state) {
    Object.values(state.players).forEach((p, idx) => {
      if (p.bankrupt) return;
      if (!tokensByCell[p.pos]) tokensByCell[p.pos] = [];
      tokensByCell[p.pos].push({ name: p.name, idx });
    });
  }

  let html = '<div class="mono-center"><div class="mono-logo">CITY<br/>MONOPOLY</div>';
  if (state) {
    const turnName = state.players[state.turn]?.name || '';
    html += `<div class="mono-center-sub">Ход: ${escapeHtml(turnName)}</div>`;
  }
  html += '</div>';

  for (let i = 0; i < 40; i++) {
    const c = MONO_BOARD[i];
    const { row, col } = monoTrackToGrid(i);
    const isCorner = c.type === 'go' || c.type === 'jail' || c.type === 'park' || c.type === 'gotojail';
    const gcol = c.group ? MONO_GROUP_COLOR[c.group] : '';
    const owner = state?.owners?.[c.id];
    const ownerName = owner ? (state.players[owner]?.name || '') : '';
    const houseCount = Number(state?.houses?.[c.id] || 0);
    const tokens = (tokensByCell[i] || []).map((t) =>
      `<span class="mono-token t${t.idx % 6}" title="${escapeHtml(t.name)}"></span>`
    ).join('');
    const price = c.price ? `<span class="mono-price">${Math.round(c.price / 1000)}k</span>` : '';
    const band = gcol ? `<div class="mono-band" style="background:${gcol}"></div>` : '';
    html += `<div class="mono-cell mono-${c.type}${isCorner ? ' mono-corner' : ''}" style="grid-row:${row};grid-column:${col}" data-id="${c.id}" title="${escapeHtml(c.name)}${ownerName ? ' · ' + ownerName : ''}">
      ${band}
      <span class="mono-name">${escapeHtml(c.name)}</span>
      ${price}
      ${owner ? `<span class="mono-own-dot" title="${escapeHtml(ownerName)}"></span>` : ''}
      ${houseCount ? `<span class="mono-houses" title="${houseCount === 5 ? 'Отель' : `Домов: ${houseCount}`}">${houseCount === 5 ? '🏨' : '▰'.repeat(houseCount)}</span>` : ''}
      <div class="mono-tokens">${tokens}</div>
    </div>`;
  }
  el.innerHTML = html;
}

function updateMonoUI(state) {
  if (!state) return;
  const me = state.players[api.playerId];
  const status = document.getElementById('mono-status');
  const money = document.getElementById('mono-money');
  const log = document.getElementById('mono-log');
  const turnName = state.players[state.turn]?.name || '—';
  if (status) {
    if (state.phase === 'over') {
      status.textContent = `Игра завершена · победил ${state.players[state.winner]?.name || '—'}`;
    } else if (state.phase === 'auction') {
      status.textContent = `Аукцион · ход: ${state.players[state.auction?.active]?.name || '—'}`;
    } else if (state.phase === 'debt') {
      status.textContent = `Долг покрывает: ${state.players[state.debt?.playerId]?.name || '—'}`;
    } else {
      status.textContent = state.turn === api.playerId
        ? (state.phase === 'roll' ? 'Ваш ход — бросайте кубики' : 'Ваш ход — завершите действие')
        : `Ход: ${turnName}`;
    }
  }
  if (money) {
    const dice = state.lastDice ? ` · 🎲 ${state.lastDice.d1}+${state.lastDice.d2}` : '';
    const jail = me?.inJail ? ` · Тюрьма (${me.jailTurns}/3)` : '';
    money.textContent = me ? `Баланс: ${fmtMoney(me.money)}${dice}${jail}` : '';
  }
  if (log) log.innerHTML = (state.log || []).slice(-8).map((l) => `<div>${escapeHtml(l)}</div>`).join('');
  renderMonoBoard(state);
  const actions = document.getElementById('mono-actions');
  if (!actions) return;
  actions.innerHTML = '';
  renderMonoAssets(state);
  if (!me || me.bankrupt || state.phase === 'over') return;

  if (state.phase === 'roll' && state.turn === api.playerId) {
    actions.innerHTML = `<button type="button" class="btn primary" id="mono-roll">Бросить кубики</button>
      ${me.inJail && me.money >= 50000 ? '<button type="button" class="btn ghost" id="mono-bail">Выйти за 50 000</button>' : ''}`;
    document.getElementById('mono-roll')?.addEventListener('click', () => requestMonoAction('roll'));
    document.getElementById('mono-bail')?.addEventListener('click', () => requestMonoAction('pay-bail'));
  } else if (state.phase === 'buy' && state.turn === api.playerId) {
    const cell = MONO_BOARD[me.pos];
    actions.innerHTML = `
      <button type="button" class="btn primary" id="mono-buy">Купить за ${fmtMoney(cell.price)}</button>
      <button type="button" class="btn ghost" id="mono-skip">Пас (аукцион)</button>`;
    document.getElementById('mono-buy')?.addEventListener('click', () => requestMonoAction('buy', { yes: true }));
    document.getElementById('mono-skip')?.addEventListener('click', () => requestMonoAction('buy', { yes: false }));
  } else if (state.phase === 'auction' && state.auction?.active === api.playerId) {
    const minimum = Number(state.auction.highestBid || 0) + Number(state.auction.minStep || 10000);
    actions.innerHTML = `
      <span class="mono-action-label">Текущая ставка: ${fmtMoney(state.auction.highestBid || 0)}</span>
      <button type="button" class="btn primary" id="mono-bid-min">${fmtMoney(minimum)}</button>
      <button type="button" class="btn ghost" id="mono-bid-plus">+50 000</button>
      <button type="button" class="btn ghost" id="mono-auction-pass">Пас</button>`;
    document.getElementById('mono-bid-min')?.addEventListener('click', () => requestMonoAction('auction-bid', { amount: minimum }));
    document.getElementById('mono-bid-plus')?.addEventListener('click', () => requestMonoAction('auction-bid', { amount: minimum + 50000 }));
    document.getElementById('mono-auction-pass')?.addEventListener('click', () => requestMonoAction('auction-pass'));
  } else if (state.phase === 'debt' && state.debt?.playerId === api.playerId) {
    actions.innerHTML = `<span class="mono-action-label">Продайте дома ниже или объявите банкротство.</span>
      <button type="button" class="btn danger" id="mono-bankrupt">Объявить банкротство</button>`;
    document.getElementById('mono-bankrupt')?.addEventListener('click', () => requestMonoAction('bankrupt'));
  } else if (state.phase === 'end' && state.turn === api.playerId) {
    actions.innerHTML = `<button type="button" class="btn primary" id="mono-end">Завершить ход</button>`;
    document.getElementById('mono-end')?.addEventListener('click', () => requestMonoAction('end-turn'));
  }
}

function renderMonoAssets(state) {
  const container = document.getElementById('mono-assets');
  const me = state.players?.[api.playerId];
  if (!container || !me) return;
  if (!me.props?.length) {
    container.innerHTML = '<span class="mono-assets-empty">У вас пока нет собственности</span>';
    return;
  }
  container.innerHTML = me.props.map((cellId) => {
    const cell = MONO_BOARD[cellId];
    const level = Number(state.houses?.[cellId] || 0);
    const canManage = cell?.type === 'prop';
    return `<div class="mono-asset">
      <span>${escapeHtml(cell?.name || String(cellId))} · ${level === 5 ? 'отель' : `${level} дом.`}</span>
      ${canManage ? `<button type="button" class="mono-mini" data-build="${cellId}">＋</button>
        <button type="button" class="mono-mini" data-sell="${cellId}" ${level ? '' : 'disabled'}>−</button>` : ''}
    </div>`;
  }).join('');
  container.querySelectorAll('[data-build]').forEach((button) => {
    button.addEventListener('click', () => requestMonoAction('build', { cellId: Number(button.dataset.build) }));
  });
  container.querySelectorAll('[data-sell]').forEach((button) => {
    button.addEventListener('click', () => requestMonoAction('sell-house', { cellId: Number(button.dataset.sell) }));
  });
}

function fmtMoney(n) {
  return new Intl.NumberFormat('ru-RU').format(n) + " so'm";
}

function requestMonoAction(kind, payload = {}) {
  if (!myTable?.state) return;
  const message = { type: 'mono-action', kind, ...payload };
  if (myTable.hostId === api.playerId) hostApplyMonoAction({ ...message, from: api.playerId });
  else publishTableRoom(myTable.id, message);
}

function hostApplyMonoAction(message) {
  if (!myTable?.state || myTable.hostId !== api.playerId) return;
  const result = applyMonopolyAction(myTable.state, message, MONO_BOARD);
  if (!result.ok) {
    publishTableRoom(myTable.id, { type: 'mono-rejected', to: message.from, error: result.error });
    if (message.from === api.playerId) api?.showToast?.(monoErrorText(result.error));
    return;
  }
  myTable.state = result.state;
  broadcastMonoState();
}

function monoErrorText(error) {
  return ({
    NOT_YOUR_TURN: 'Сейчас ход другого игрока',
    NOT_ENOUGH_MONEY: 'Недостаточно средств',
    INVALID_BID: 'Ставка должна быть выше и доступна по балансу',
    GROUP_NOT_COMPLETE: 'Сначала соберите всю цветовую группу',
    CANNOT_BUILD: 'Дом нужно строить равномерно и не выше пяти уровней',
    CANNOT_SELL_HOUSE: 'Дома продаются равномерно по цветовой группе'
  })[error] || 'Действие отклонено правилами игры';
}

function broadcastMonoState() {
  updateMonoUI(myTable.state);
  publishTableRoom(myTable.id, { type: 'mono-state', state: myTable.state });
}

function attachLocalVideo(id) {
  const v = document.getElementById(id);
  if (v && clubLocalStream) {
    v.srcObject = clubLocalStream;
    v.muted = true;
    v.play().catch(() => {});
  }
}

// ===================== UI bind / inject =====================
function bindUI() {
  document.getElementById('club-lobby-close')?.addEventListener('click', closeClubLobby);
  document.getElementById('club-create-btn')?.addEventListener('click', createTable);
  document.getElementById('club-refresh-btn')?.addEventListener('click', async () => {
    try {
      await ensureTablesRealtime();
      requestTablesRefresh();
    } catch (error) {
      api?.showToast?.(String(error?.message).includes('AUTH_REQUIRED')
        ? 'Войдите в аккаунт, чтобы увидеть столы'
        : 'Нет связи');
    }
  });
  document.getElementById('speaking-ready')?.addEventListener('click', () => {
    if (!myTable) return;
    const me = myTable.players[api.playerId];
    if (me) me.ready = !me.ready;
    publishTableRoom(myTable.id, { type: 'ready', ready: !!me?.ready });
    renderRoomPlayers();
    if (myTable.hostId === api.playerId) maybeStartGame();
  });
  document.getElementById('speaking-done')?.addEventListener('click', speakingDone);
  document.getElementById('speaking-leave')?.addEventListener('click', leaveTable);
  document.getElementById('chess-ready')?.addEventListener('click', () => {
    if (!myTable) return;
    const me = myTable.players[api.playerId];
    if (me) me.ready = !me.ready;
    publishTableRoom(myTable.id, { type: 'ready', ready: !!me?.ready });
    renderRoomPlayers();
    if (myTable.hostId === api.playerId) maybeStartGame();
  });
  document.getElementById('chess-resign')?.addEventListener('click', chessResign);
  document.getElementById('chess-leave')?.addEventListener('click', leaveTable);
  document.getElementById('mono-ready')?.addEventListener('click', () => {
    if (!myTable) return;
    const me = myTable.players[api.playerId];
    if (me) me.ready = !me.ready;
    publishTableRoom(myTable.id, { type: 'ready', ready: !!me?.ready });
    renderRoomPlayers();
    if (myTable.hostId === api.playerId) maybeStartGame();
  });
  document.getElementById('mono-leave')?.addEventListener('click', leaveTable);
}

function injectHTML() {
  if (document.getElementById('club-lobby')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div id="club-lobby" class="club-overlay hidden">
    <div class="club-card">
      <div class="club-card-head">
        <div>
          <h2 id="club-lobby-title">Клуб</h2>
          <p id="club-lobby-sub" class="club-sub"></p>
        </div>
        <button type="button" class="btn ghost" id="club-lobby-close" style="width:auto;margin:0">✕</button>
      </div>
      <div class="club-lobby-actions">
        <button type="button" class="btn primary" id="club-create-btn">Создать стол</button>
        <button type="button" class="btn ghost" id="club-refresh-btn" style="width:auto;margin:0">Обновить</button>
      </div>
      <h3 class="club-list-title">Открытые столы</h3>
      <div id="club-tables-list" class="club-tables-list"></div>
    </div>
  </div>

  <div id="speaking-room" class="club-overlay hidden">
    <div class="club-card club-card-wide">
      <div class="club-card-head">
        <div>
          <h2>Speaking Club</h2>
          <p id="speaking-status" class="club-sub">Лобби</p>
          <p id="speaking-topic" class="club-sub"></p>
          <p id="speaking-clock" class="club-clock"></p>
        </div>
        <button type="button" class="btn ghost" id="speaking-leave" style="width:auto;margin:0">Выйти</button>
      </div>
      <div id="speaking-players" class="club-players"></div>
      <div class="club-videos">
        <video id="speaking-local-video" autoplay playsinline muted></video>
        <video id="speaking-remote-video" autoplay playsinline></video>
      </div>
      <div class="club-actions">
        <button type="button" class="btn primary" id="speaking-ready">Готов</button>
        <button type="button" class="btn ghost" id="speaking-done">Я закончил</button>
      </div>
    </div>
  </div>

  <div id="chess-room" class="club-overlay hidden">
    <div class="club-card club-card-wide chess-card">
      <div class="club-card-head">
        <div>
          <h2>Шахматный клуб</h2>
          <p id="chess-status" class="club-sub">Лобби</p>
          <p id="chess-clocks" class="club-sub"></p>
        </div>
        <button type="button" class="btn ghost" id="chess-leave" style="width:auto;margin:0">Выйти</button>
      </div>
      <div id="chess-players" class="club-players"></div>
      <div class="chess-layout">
        <div class="chess-stage">
          <div id="chess-board-3d" class="chess-board-3d" title="Крутите доску мышью"></div>
          <p class="chess-3d-hint">3D-доска · ходы — на клетке справа</p>
        </div>
        <div class="chess-play-col">
          <div id="chess-board" class="chess-board"></div>
          <div class="club-videos chess-vids">
            <video id="chess-local-video" autoplay playsinline muted></video>
            <video id="chess-remote-video" class="chess-remote" autoplay playsinline></video>
          </div>
        </div>
      </div>
      <div class="club-actions">
        <button type="button" class="btn primary" id="chess-ready">Готов</button>
        <button type="button" class="btn ghost" id="chess-resign">Сдаться</button>
      </div>
    </div>
  </div>

  <div id="monopoly-room" class="club-overlay hidden">
    <div class="club-card club-card-wide">
      <div class="club-card-head">
        <div>
          <h2>Монополия</h2>
          <p id="mono-status" class="club-sub">Лобби</p>
          <p id="mono-money" class="club-sub"></p>
        </div>
        <button type="button" class="btn ghost" id="mono-leave" style="width:auto;margin:0">Выйти</button>
      </div>
      <div id="mono-players" class="club-players"></div>
      <div id="mono-board" class="mono-board"></div>
      <div id="mono-log" class="mono-log"></div>
      <div id="mono-assets" class="mono-assets"></div>
      <div id="mono-actions" class="club-actions"></div>
      <div class="club-actions">
        <button type="button" class="btn primary" id="mono-ready">Готов</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(wrap);
}

function injectStyles() {
  if (document.getElementById('club-styles')) return;
  const s = document.createElement('style');
  s.id = 'club-styles';
  s.textContent = `
.club-overlay{position:fixed;inset:0;z-index:320;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:12px}
.club-overlay.hidden{display:none!important}
.club-card{background:#14141c;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:16px;width:min(480px,100%);max-height:92vh;overflow:auto;color:#eee}
.club-card-wide{width:min(920px,100%)}
.club-card-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:12px}
.club-card h2{margin:0;font-size:1.25rem}
.club-sub{margin:4px 0 0;opacity:.75;font-size:.88rem}
.club-clock{margin:5px 0 0;color:#7dd3fc;font-size:.82rem;font-variant-numeric:tabular-nums}
.club-lobby-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px}
.club-list-title{margin:16px 0 8px;font-size:.95rem}
.club-tables-list{display:flex;flex-direction:column;gap:8px}
.club-table-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08)}
.club-meta{font-size:.8rem;opacity:.7;margin-top:2px}
.club-empty{opacity:.6;text-align:center;padding:20px}
.club-players{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.club-player-chip{padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.08);font-size:.85rem}
.club-player-chip.ready{background:rgba(34,197,94,.25);border:1px solid rgba(34,197,94,.4)}
.club-videos{display:flex;gap:8px;margin:10px 0}
.club-videos video{width:48%;max-height:160px;background:#000;border-radius:10px;object-fit:cover}
.club-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.chess-layout{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;justify-content:center}
.chess-stage{flex:1 1 280px;min-width:240px;max-width:420px}
.chess-board-3d{width:100%;min-height:220px;border-radius:14px;background:radial-gradient(ellipse at 50% 30%,#3a2f28 0%,#1a1512 70%);border:1px solid rgba(255,255,255,.1);overflow:hidden}
.chess-board-3d canvas{display:block;width:100%!important;height:auto!important;margin:0 auto}
.chess-3d-hint{margin:6px 0 0;font-size:.75rem;opacity:.55;text-align:center}
.chess-play-col{display:flex;flex-direction:column;gap:10px;align-items:center}
.chess-card{background:linear-gradient(165deg,#1a1614 0%,#14141c 50%,#121820 100%)!important}
.chess-board{display:grid;grid-template-columns:repeat(8,minmax(32px,48px));grid-template-rows:repeat(8,minmax(32px,48px));border:3px solid #2a2a2a;width:max-content;border-radius:4px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.45)}
.chess-sq{display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;position:relative}
.chess-sq.light{background:#efd9b5}
.chess-sq.dark{background:#b58863}
.chess-sq.selected{outline:3px solid #22c55e;outline-offset:-3px;z-index:1}
.chess-sq.legal::after{content:'';position:absolute;width:28%;height:28%;border-radius:50%;background:rgba(34,197,94,.55)}
.chess-piece{font-size:clamp(1.4rem,5vw,2.1rem);line-height:1;pointer-events:none}
.chess-piece.pc-white{color:#f5f5f5;text-shadow:0 0 1px #000,0 1px 0 #000,1px 0 0 #000,-1px 0 0 #000,0 -1px 0 #000,0 2px 3px rgba(0,0,0,.55)}
.chess-piece.pc-black{color:#111;text-shadow:0 0 1px #fff,0 1px 2px rgba(255,255,255,.25)}
.chess-vids{flex-direction:column;width:140px}
.chess-vids video{width:100%;max-height:120px;border-radius:10px;background:#000}
.mono-board.mono-classic{display:grid;grid-template-columns:repeat(11,minmax(0,1fr));grid-template-rows:repeat(11,minmax(0,1fr));gap:0;width:min(92vw,560px);aspect-ratio:1;margin:10px auto;background:#c8e6c9;border:3px solid #1a1a1a;border-radius:6px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.4)}
.mono-center{grid-row:2/11;grid-column:2/11;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(160deg,#dcedc8,#a5d6a7);border:1px dashed rgba(0,0,0,.12)}
.mono-logo{font-weight:900;font-size:clamp(1rem,3.5vw,1.8rem);color:#c62828;letter-spacing:.04em;text-align:center;transform:rotate(-25deg);text-shadow:1px 1px 0 #fff;line-height:1.15}
.mono-center-sub{margin-top:12px;font-size:.85rem;opacity:.85;transform:none}
.mono-cell{background:#f3efe6;border:1px solid rgba(0,0,0,.35);font-size:clamp(.45rem,.9vw,.62rem);position:relative;display:flex;flex-direction:column;padding:2px;overflow:hidden;min-width:0;min-height:0}
.mono-corner{background:#e8e0d0;font-weight:700}
.mono-go{background:#ffccbc!important}
.mono-jail{background:#fff9c4!important}
.mono-park{background:#b3e5fc!important}
.mono-gotojail{background:#ffcdd2!important}
.mono-chance,.mono-chest{background:#fff8e1}
.mono-tax{background:#fce4ec}
.mono-rail{background:#eceff1}
.mono-util{background:#e0f7fa}
.mono-band{height:18%;min-height:6px;width:100%;flex-shrink:0;border-bottom:1px solid rgba(0,0,0,.25)}
.mono-name{font-weight:600;line-height:1.1;margin-top:1px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.mono-price{opacity:.75;font-size:.9em;margin-top:auto}
.mono-tokens{position:absolute;left:2px;bottom:2px;display:flex;gap:2px;flex-wrap:wrap}
.mono-token{width:9px;height:9px;border-radius:50%;border:1px solid #000;display:inline-block}
.mono-token.t0{background:#e53935}.mono-token.t1{background:#1e88e5}.mono-token.t2{background:#43a047}
.mono-token.t3{background:#fb8c00}.mono-token.t4{background:#8e24aa}.mono-token.t5{background:#00acc1}
.mono-own-dot{position:absolute;top:2px;right:2px;width:7px;height:7px;border-radius:50%;background:#333;box-shadow:0 0 0 1px #fff}
.mono-houses{position:absolute;right:2px;bottom:2px;color:#166534;font-size:.55rem;line-height:1;letter-spacing:-1px}
.mono-log{max-height:100px;overflow:auto;font-size:.8rem;opacity:.85;background:rgba(0,0,0,.25);padding:8px;border-radius:8px}
.mono-assets{display:flex;gap:6px;overflow:auto;padding:8px 0;margin-top:4px}
.mono-assets-empty{font-size:.78rem;opacity:.55}
.mono-asset{flex:0 0 auto;display:flex;align-items:center;gap:5px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);padding:6px 8px;border-radius:9px;font-size:.74rem}
.mono-mini{width:24px;height:24px;border:0;border-radius:7px;background:rgba(255,255,255,.12);color:#fff;cursor:pointer}
.mono-mini:disabled{opacity:.35;cursor:not-allowed}
.mono-action-label{display:flex;align-items:center;font-size:.82rem;opacity:.8}
@media(max-width:700px){
  .chess-board{grid-template-columns:repeat(8,minmax(28px,36px));grid-template-rows:repeat(8,minmax(28px,36px))}
  .chess-piece{font-size:1.35rem}
  .mono-board.mono-classic{width:min(96vw,420px)}
}
`;
  document.head.appendChild(s);
}

export function disposeClubs() {
  try { leaveTable(); } catch (error) { console.warn('[clubs] leave cleanup', error); }
  if (speakingTimer) { clearTimeout(speakingTimer); speakingTimer = null; }
  if (speakingClockTimer) { clearInterval(speakingClockTimer); speakingClockTimer = null; }
  if (chessClockTimer) { clearInterval(chessClockTimer); chessClockTimer = null; }
  stopClubMedia();
  disposeChessBoard3D();
  knownTables.clear();
  lobbyRoom?.close().catch(() => {});
  lobbyRoom = null;
  tableRoom?.close().catch(() => {});
  tableRoom = null;
  api = null;
}
