from pathlib import Path

MAIN = Path('game/js/main.js')
ROUND = Path('game/js/round1-game.js')
HTML = Path('game/index.html')
CSS = Path('game/css/style.css')


def replace_between(text, start, end, replacement, label):
    a = text.find(start)
    b = text.find(end, a + len(start)) if a >= 0 else -1
    if a < 0 or b < 0:
        raise SystemExit(f'Unable to patch {label}: markers not found')
    return text[:a] + replacement.rstrip() + '\n\n' + text[b:]


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Unable to patch {label}: source text not found')
    return text.replace(old, new, 1)


round_js = ROUND.read_text(encoding='utf-8')
round_js = replace_once(
    round_js,
    "export const ROUND1_MIN_PLAYERS = 2;\nexport const ROUND1_MAX_PLAYERS = 8;",
    "export const ROUND1_REQUIRED_PLAYERS = 2;\nexport const ROUND1_MIN_PLAYERS = ROUND1_REQUIRED_PLAYERS;\nexport const ROUND1_MAX_PLAYERS = 8;\nexport const ROUND1_COUNTDOWN_MS = 7000;",
    'round constants'
)
round_js = replace_once(
    round_js,
    "export function chooseHostId(ids) {\n  return [...new Set((ids || []).map((id) => String(id || '')).filter(Boolean))].sort()[0] || null;\n}\n",
    "export function chooseHostId(ids) {\n  return [...new Set((ids || []).map((id) => String(id || '')).filter(Boolean))].sort()[0] || null;\n}\n\nexport function registeredPlayerIds(members) {\n  const ids = [];\n  const seen = new Set();\n  for (const member of members || []) {\n    const id = String(member?.id || member?.key || '').trim();\n    if (!id || !member?.joined || seen.has(id)) continue;\n    seen.add(id);\n    ids.push(id);\n  }\n  return ids.slice(0, ROUND1_MAX_PLAYERS);\n}\n\nexport function isRoundParticipant(state, playerId) {\n  const id = String(playerId || '');\n  if (!id || !state) return false;\n  const ids = state.participantIds || [\n    ...(state.activeIds || []),\n    ...(state.eliminatedIds || []),\n    ...(state.passedIds || [])\n  ];\n  return ids.map(String).includes(id);\n}\n",
    'round helpers'
)
round_js = replace_once(
    round_js,
    "    phase: 'countdown',\n    phaseEndsAt: now + 5000,\n    checkpointIndex: 0,\n    activeIds: players,",
    "    phase: 'countdown',\n    phaseEndsAt: now + ROUND1_COUNTDOWN_MS,\n    checkpointIndex: 0,\n    participantIds: [...players],\n    activeIds: players,",
    'round state participants'
)
ROUND.write_text(round_js, encoding='utf-8')

main = MAIN.read_text(encoding='utf-8')
main = replace_once(
    main,
    "  chooseHostId,\n  createRoundState,\n  applyReport,\n  greenDurationMs",
    "  chooseHostId,\n  registeredPlayerIds,\n  isRoundParticipant,\n  createRoundState,\n  applyReport,\n  greenDurationMs",
    'main round imports'
)
main = replace_once(
    main,
    "let round1RoundFinished = false;\nlet round1DebugBot = null;",
    "let round1RoundFinished = false;\nlet round1DebugBot = null;\nlet round1Joined = false;\nlet round1JoinBusy = false;\nlet round1RealtimeReady = false;\nlet round1AutoStartTimer = 0;\nlet round1FinishedResetAt = 0;",
    'round globals'
)

new_multiplayer = r'''async function initMultiplayer() {
  ensurePlayerId();
  loadRemoteAvatarTemplates();
  const btn = document.getElementById('btn-profile');
  if (btn) {
    btn.classList.remove('hidden');
    btn.style.zIndex = '50';
    btn.style.pointerEvents = 'auto';
  }
  const onlineEl = document.getElementById('players-online');
  if (onlineEl) {
    onlineEl.classList.remove('hidden');
    onlineEl.textContent = 'Онлайн: подключение…';
  }

  round1RealtimeReady = false;
  round1Joined = false;
  resetLocalRound1Flags();

  if (hasCloudAccount()) {
    try { await pushProfileToCloud(); }
    catch (error) { console.warn('multiplayer profile sync', error); }
  }

  const roomId = (new URLSearchParams(location.search).get('room') || 'round1-main')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 32) || 'round1-main';

  if (hasCloudAccount()) {
    try {
      await connectSupabaseMultiplayer(roomId);
      showToast('Сетевой режим готов · запишитесь на Раунд 1');
      return;
    } catch (e) {
      console.error('Supabase realtime failed', e);
      round1RealtimeReady = false;
      updateRound1LobbyUI();
      showToast('Не удалось подключиться к сетевой комнате');
      if (onlineEl) onlineEl.textContent = 'Сеть недоступна';
      return;
    }
  }

  if (new URLSearchParams(location.search).get('round1test') === '1') {
    setupRound1DebugMode();
    if (onlineEl) onlineEl.textContent = 'Тест: 2 игрока';
    showToast('Тестовый режим Раунда 1 · нажмите «Записаться»');
    return;
  }

  round1Members = [{ id: playerId, key: playerId, name: currentUser?.name || 'Игрок', joined: false }];
  round1HostId = playerId;
  round1RealtimeReady = false;
  updateRound1LobbyUI();
  showToast('Для сетевой игры войдите в аккаунт');
  if (onlineEl) onlineEl.textContent = 'Гость · только вы';
}

function round1PresenceId(member) {
  return String(member?.id || member?.key || '').trim();
}

function syncRound1RemotePresence(members) {
  const ids = [...new Set((members || []).map(round1PresenceId).filter(Boolean))];
  if (playerId && !ids.includes(String(playerId))) ids.push(String(playerId));
  for (const member of members || []) {
    const id = round1PresenceId(member);
    if (!id || id === String(playerId)) continue;
    let spawn = null;
    const participating = round1State && isRoundParticipant(round1State, id);
    if (participating) {
      const participants = round1State.participantIds || round1State.activeIds || [];
      spawn = round1SpawnForId(id, participants);
      if (remotePlayers.has(id) && round1State.phase !== 'countdown') continue;
    } else {
      spawn = round1LobbySpawnForId(id, ids);
    }
    upsertRemotePlayer({
      id,
      name: member.name || 'Игрок',
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      rot: spawn.yaw || 0,
      moving: 0,
      avatar: member.avatar || null
    });
  }
}

function handleRound1Presence(members) {
  round1Members = members || [];
  const onlineIds = round1MemberIds();
  const onlineSet = new Set(onlineIds);
  syncRound1RemotePresence(round1Members);

  if (round1State) {
    const participants = round1State.participantIds || round1State.activeIds || [];
    const presentParticipants = participants.filter((id) => onlineSet.has(String(id)));
    if (round1State.phase === 'countdown' && presentParticipants.length < participants.length) {
      const replacementHost = chooseHostId(presentParticipants);
      round1HostId = replacementHost;
      if (replacementHost === String(playerId)) {
        resetRound1ToLobby({ broadcast: true, message: 'Один из участников вышел. Набор открыт снова.' });
      }
    } else if (!onlineSet.has(String(round1State.hostId || ''))) {
      const replacementHost = chooseHostId((round1State.activeIds || participants).filter((id) => onlineSet.has(String(id))));
      round1HostId = replacementHost;
      if (replacementHost === String(playerId)) {
        const next = { ...round1State, hostId: replacementHost, revision: Number(round1State.revision || 0) + 1 };
        setRound1State(next, { force: true });
        broadcastRound1State();
      }
    } else {
      round1HostId = round1State.hostId;
    }
  } else {
    const queued = round1RegisteredIds();
    round1HostId = chooseHostId(queued) || chooseHostId(onlineIds);
  }

  for (const [id, entry] of remotePlayers) {
    if (!onlineSet.has(id) && id !== round1DebugBot?.id) {
      scene?.remove(entry.group);
      remotePlayers.delete(id);
    }
  }

  const el = document.getElementById('players-online');
  if (el) el.textContent = `Онлайн: ${Math.max(1, onlineIds.length)}`;
  updateRound1LobbyUI();
  maybeAutoStartRound1();
}

async function connectSupabaseMultiplayer(roomId) {
  cityRoom = createRealtimeRoom({
    client: supabaseClient,
    topic: `${ROUND1_ROOM_KEY}:${roomId}`,
    playerId,
    displayName: currentUser?.name,
    presence: {
      feature: ROUND1_ROOM_KEY,
      joined: false,
      avatar: customAvatarUrl || currentUser?.avatarUrl || null
    },
    onMessage: (payload) => {
      if (!payload || Date.now() - (payload.t || 0) > 15000) return;
      if (handleRound1Message(payload)) return;
      upsertRemotePlayer(payload);
      const entry = remotePlayers.get(payload.id);
      if (entry) entry.lastSeen = Date.now();
    },
    onPresence: handleRound1Presence
  });
  await cityRoom.connect();
  p2pSend = (payload) => {
    cityRoom.send({ ...payload, id: playerId }).catch((error) => {
      console.warn('city realtime send', error);
    });
  };
  round1RealtimeReady = true;
  round1Joined = false;
  await cityRoom.track({
    feature: ROUND1_ROOM_KEY,
    joined: false,
    avatar: customAvatarUrl || currentUser?.avatarUrl || null
  });
  handleRound1Presence(cityRoom.members());
  lifecycle.interval(() => broadcastPose(false), 250);
  lifecycle.interval(() => pruneRemotePlayers(), 2000);
  broadcastPose(true);
}

function setupRound1UI() {
  document.body.classList.add('round1-mode');
  round1Hud = document.getElementById('round1-hud');
  round1Status = document.getElementById('round1-status');
  round1Question = document.getElementById('round1-question');
  round1Counter = document.getElementById('round1-counter');
  round1StartButton = document.getElementById('round1-start');
  round1WaitingNotice = document.getElementById('round1-waiting');
  round1WaitingNotice?.classList.add('hidden');
  round1Hud?.classList.remove('hidden');
  if (round1StartButton && !round1StartButton.dataset.round1Bound) {
    round1StartButton.dataset.round1Bound = '1';
    round1StartButton.addEventListener('click', () => setRound1Registration(!round1Joined));
  }
  updateRound1LobbyUI();
}

function round1MemberIds() {
  const ids = (round1Members || []).map(round1PresenceId).filter(Boolean);
  if (playerId && !ids.includes(String(playerId))) ids.push(String(playerId));
  if (round1DebugBot?.id && !ids.includes(round1DebugBot.id)) ids.push(round1DebugBot.id);
  return [...new Set(ids)].slice(0, ROUND1_MAX_PLAYERS);
}

function round1RegisteredIds() {
  const ids = registeredPlayerIds(round1Members || []);
  if (round1Joined && playerId && !ids.includes(String(playerId))) ids.push(String(playerId));
  if (round1DebugBot?.joined && !ids.includes(round1DebugBot.id)) ids.push(round1DebugBot.id);
  return [...new Set(ids)].slice(0, ROUND1_MAX_PLAYERS);
}

function updateLocalPresenceCache(joined) {
  const id = String(playerId || '');
  let found = false;
  round1Members = (round1Members || []).map((member) => {
    if (round1PresenceId(member) !== id) return member;
    found = true;
    return { ...member, id, key: member.key || id, joined: Boolean(joined), avatar: customAvatarUrl || currentUser?.avatarUrl || null };
  });
  if (!found && id) {
    round1Members.push({ id, key: id, name: currentUser?.name || 'Игрок', joined: Boolean(joined), avatar: customAvatarUrl || currentUser?.avatarUrl || null });
  }
}

async function setRound1Registration(joined) {
  if (round1JoinBusy || round1State) return;
  if (!round1RealtimeReady && !round1DebugBot) {
    showToast(hasCloudAccount() ? 'Сетевая комната ещё не подключена' : 'Войдите в аккаунт для участия');
    return;
  }
  round1JoinBusy = true;
  round1Joined = Boolean(joined);
  updateLocalPresenceCache(round1Joined);
  if (round1Joined) {
    resetLocalRound1Flags();
    if (player) player.visible = true;
  }
  updateRound1LobbyUI();
  try {
    if (cityRoom) {
      await cityRoom.track({
        feature: ROUND1_ROOM_KEY,
        joined: round1Joined,
        avatar: customAvatarUrl || currentUser?.avatarUrl || null
      });
      round1Members = cityRoom.members();
    }
    showToast(round1Joined ? 'Вы записаны на Раунд 1' : 'Запись отменена');
  } catch (error) {
    console.warn('round1 registration', error);
    round1Joined = !round1Joined;
    updateLocalPresenceCache(round1Joined);
    showToast('Не удалось изменить запись. Попробуйте ещё раз.');
  } finally {
    round1JoinBusy = false;
    updateRound1LobbyUI();
    maybeAutoStartRound1();
  }
}

function maybeAutoStartRound1() {
  if (round1State || !round1RealtimeReady) return;
  const queued = round1RegisteredIds();
  if (queued.length < ROUND1_MIN_PLAYERS) {
    if (round1AutoStartTimer) window.clearTimeout(round1AutoStartTimer);
    round1AutoStartTimer = 0;
    return;
  }
  const host = chooseHostId(queued);
  round1HostId = host;
  if (host !== String(playerId) || round1AutoStartTimer) return;
  round1AutoStartTimer = window.setTimeout(() => {
    round1AutoStartTimer = 0;
    if (round1State) return;
    const fresh = round1RegisteredIds();
    if (fresh.length < ROUND1_MIN_PLAYERS) {
      updateRound1LobbyUI();
      return;
    }
    startRound1Match(fresh);
  }, 650);
}

function round1LobbySpawnForId(id, ids = round1MemberIds()) {
  const order = [...ids].sort();
  const index = Math.max(0, order.indexOf(String(id)));
  const angle = (-Math.PI / 2) + index * (Math.PI * 2 / Math.max(8, order.length));
  const radius = 4.2;
  const x = Math.cos(angle) * radius;
  const z = -48 + Math.sin(angle) * radius;
  return { x, y: 0.32, z, yaw: Math.atan2(-x, -28 - z) };
}

function placeLocalOnLobbySlot() {
  if (!player || round1State) return;
  const spawn = round1LobbySpawnForId(playerId);
  if (Math.hypot(player.position.x - spawn.x, player.position.z - spawn.z) > 1.5) {
    player.position.set(spawn.x, spawn.y, spawn.z);
    yaw = spawn.yaw;
    player.rotation.y = yaw;
    currentSpeed = 0;
    velocityY = 0;
    moveTarget = null;
    lastPoseX = player.position.x;
    lastPoseZ = player.position.z;
    broadcastPose(true);
  }
}

function updateRound1LobbyUI() {
  if (!round1Hud) return;
  round1Hud.classList.remove('hidden');
  if (round1State) {
    round1StartButton?.classList.add('hidden');
    refreshRound1Visuals();
    return;
  }

  resetLocalRound1Flags();
  if (player) player.visible = true;
  const online = round1MemberIds();
  const queued = round1RegisteredIds();
  placeLocalOnLobbySlot();
  if (round1Question) round1Question.textContent = 'Запись на Раунд 1';
  if (round1Counter) round1Counter.textContent = `Записано: ${queued.length} / ${ROUND1_MIN_PLAYERS} · онлайн ${online.length}`;
  if (round1Status) {
    round1Status.className = 'round1-status';
    if (!round1RealtimeReady && !round1DebugBot) {
      round1Status.textContent = hasCloudAccount() ? 'Подключение к сетевой комнате…' : 'Войдите в аккаунт, чтобы участвовать в сетевом матче.';
    } else if (!round1Joined) {
      round1Status.textContent = `Нажмите «Записаться на участие». Игра стартует автоматически после набора ${ROUND1_MIN_PLAYERS} игроков.`;
    } else if (queued.length < ROUND1_MIN_PLAYERS) {
      round1Status.textContent = `Вы записаны. Ожидаем ещё ${ROUND1_MIN_PLAYERS - queued.length} игрока.`;
    } else {
      round1Status.textContent = 'Набор завершён. Готовим общий отсчёт…';
      round1Status.classList.add('gold');
    }
  }
  if (round1StartButton) {
    round1StartButton.classList.remove('hidden');
    round1StartButton.classList.toggle('joined', round1Joined);
    round1StartButton.disabled = round1JoinBusy || (!round1RealtimeReady && !round1DebugBot);
    round1StartButton.textContent = round1JoinBusy
      ? 'Синхронизация…'
      : (round1Joined ? 'Отменить запись' : 'Записаться на участие');
  }
  maybeAutoStartRound1();
}

function setupRound1DebugMode() {
  round1DebugBot = { id: 'round1_debug_bot', name: 'Тестовый игрок', joined: true };
  round1Members = [
    { id: playerId, key: playerId, name: currentUser?.name || 'Игрок', joined: false },
    { id: round1DebugBot.id, key: round1DebugBot.id, name: round1DebugBot.name, joined: true }
  ];
  round1RealtimeReady = true;
  round1HostId = playerId;
  const botSpawn = round1LobbySpawnForId(round1DebugBot.id, round1MemberIds());
  upsertRemotePlayer({
    id: round1DebugBot.id,
    name: round1DebugBot.name,
    x: botSpawn.x,
    y: botSpawn.y,
    z: botSpawn.z,
    rot: botSpawn.yaw,
    moving: 0,
    avatar: null
  });
  updateRound1LobbyUI();
}

function round1SpawnForId(id, ids = round1RegisteredIds()) {
  const order = [...ids].sort();
  const index = Math.max(0, order.indexOf(String(id)));
  const count = Math.max(1, order.length);
  const spread = Math.min(24, Math.max(5, (count - 1) * 3.2));
  const x = count === 1 ? 0 : -spread / 2 + (spread * index) / (count - 1);
  return { x, y: 0.32, z: ROUND1_START_Z - 3.2, yaw: 0 };
}

function resetLocalRound1Flags() {
  round1LocalReportKey = '';
  round1RedAnchor = null;
  round1RedMaxMovement = 0;
  round1RedStartedAt = 0;
  round1IsSpectator = false;
  round1RoundFinished = false;
  round1WaitingNotice?.classList.add('hidden');
}

function teleportLocalToRound1Start(state) {
  if (!player || !isRoundParticipant(state, playerId)) return;
  const participants = state.participantIds || state.activeIds || [];
  const spawn = round1SpawnForId(playerId, participants);
  player.visible = true;
  player.position.set(spawn.x, spawn.y, spawn.z);
  yaw = spawn.yaw;
  player.rotation.y = yaw;
  currentSpeed = 0;
  velocityY = 0;
  isGrounded = true;
  moveTarget = null;
  lastPoseX = player.position.x;
  lastPoseZ = player.position.z;
  broadcastPose(true);
}

function prepareRemotePlayersForRound(state) {
  const participants = state?.participantIds || state?.activeIds || [];
  for (const idValue of participants) {
    const id = String(idValue);
    if (!id || id === String(playerId)) continue;
    const member = (round1Members || []).find((value) => round1PresenceId(value) === id);
    const spawn = round1SpawnForId(id, participants);
    upsertRemotePlayer({
      id,
      name: member?.name || remotePlayers.get(id)?.name || 'Игрок',
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      rot: spawn.yaw,
      moving: 0,
      avatar: member?.avatar || null
    });
    const entry = remotePlayers.get(id);
    if (entry) {
      entry.group.position.set(spawn.x, spawn.y, spawn.z);
      entry.target.set(spawn.x, spawn.y, spawn.z);
      entry.group.visible = true;
    }
  }
}

function resetRound1ToLobby({ broadcast = false, message = '' } = {}) {
  if (round1AutoStartTimer) window.clearTimeout(round1AutoStartTimer);
  round1AutoStartTimer = 0;
  round1FinishedResetAt = 0;
  round1HostTimer = 0;
  round1State = null;
  round1Joined = false;
  resetLocalRound1Flags();
  if (player) player.visible = true;
  updateLocalPresenceCache(false);
  if (cityRoom) {
    cityRoom.track({ feature: ROUND1_ROOM_KEY, joined: false, avatar: customAvatarUrl || currentUser?.avatarUrl || null }).catch(() => {});
  }
  if (broadcast && p2pSend) p2pSend({ type: 'round1_reset', reason: message || 'reset' });
  placeLocalOnLobbySlot();
  syncRound1RemotePresence(round1Members);
  updateRound1LobbyUI();
  if (message) showToast(message);
}
'''
main = replace_between(main, 'async function initMultiplayer() {', 'function configureRound1Answers(seed) {', new_multiplayer, 'multiplayer and queue flow')

# Make remote players visible at the correct position immediately instead of sliding in from world origin.
main = replace_once(
    main,
    "    scene.add(group);\n    entry = {",
    "    group.position.set(Number(row.x) || 0, Number(row.y) || 0, Number(row.z) || 0);\n    group.rotation.y = Number(row.rot) || 0;\n    scene.add(group);\n    entry = {",
    'remote initial position'
)

# Add spectator-safe rendering before date pads/status are updated.
main = replace_once(
    main,
    "  const total = ROUND1_QUESTIONS.length;\n  if (round1Counter) round1Counter.textContent = `${Math.min(total, round1State.checkpointIndex + 1)} / ${total}`;",
    "  const total = ROUND1_QUESTIONS.length;\n  const localParticipant = isRoundParticipant(round1State, playerId);\n  if (!localParticipant && phase !== 'finished') {\n    round1WaitingNotice?.classList.add('hidden');\n    if (round1Counter) round1Counter.textContent = `Участников: ${(round1State.participantIds || []).length}`;\n    if (round1Question) round1Question.textContent = 'Матч уже идёт';\n    setRound1Status('Вы не участвуете в текущем матче. Дождитесь следующего набора.', 'gold');\n    setRound1QuestionBoard('РАУНД 1 ИДЁТ', 'ожидайте следующего набора');\n    return;\n  }\n  if (round1Counter) round1Counter.textContent = `${Math.min(total, round1State.checkpointIndex + 1)} / ${total}`;",
    'spectator rendering'
)

# Finished state no longer exposes a stale elimination to a newly connected client and no manual restart button.
old_finished = """  } else if (phase === 'finished') {\n    if (round1State.passedIds?.includes(String(playerId))) {\n      setRound1Status('Вы успешно прошли Раунд 1.', 'green');\n      if (round1Question) round1Question.textContent = 'РАУНД ПРОЙДЕН';\n    } else if (round1IsSpectator || round1State.eliminatedIds?.includes(String(playerId))) {\n      setRound1Status('Вы выбыли. Ожидайте завершения матча в зале ожидания.', 'red');\n    } else {\n      setRound1Status('Раунд 1 завершён.', 'gold');\n    }\n    setRound1QuestionBoard('РАУНД 1 ЗАВЕРШЁН', `${round1State.passedIds?.length || 0} игроков прошли дальше`);\n    if (round1StartButton && round1HostId === playerId && round1MemberIds().length >= ROUND1_MIN_PLAYERS) {\n      round1StartButton.classList.remove('hidden');\n      round1StartButton.disabled = false;\n      round1StartButton.textContent = 'Повторить Раунд 1';\n    }\n  }\n}"""
new_finished = """  } else if (phase === 'finished') {\n    const localParticipant = isRoundParticipant(round1State, playerId);\n    if (localParticipant && round1State.passedIds?.includes(String(playerId))) {\n      setRound1Status('Вы успешно прошли Раунд 1.', 'green');\n      if (round1Question) round1Question.textContent = 'РАУНД ПРОЙДЕН';\n    } else if (localParticipant && (round1IsSpectator || round1State.eliminatedIds?.includes(String(playerId)))) {\n      setRound1Status('Вы выбыли. Скоро откроется новый набор.', 'red');\n    } else {\n      setRound1Status('Раунд 1 завершён. Скоро откроется новый набор.', 'gold');\n    }\n    setRound1QuestionBoard('РАУНД 1 ЗАВЕРШЁН', `${round1State.passedIds?.length || 0} игроков прошли дальше`);\n    round1StartButton?.classList.add('hidden');\n  }\n}"""
main = replace_once(main, old_finished, new_finished, 'finished ui')

new_start_state = r'''function startRound1Match(queuedIds = null) {
  const ids = [...new Set((queuedIds || round1RegisteredIds()).map(String).filter(Boolean))].slice(0, ROUND1_MAX_PLAYERS);
  const host = chooseHostId(ids);
  if (host !== String(playerId)) return;
  if (ids.length < ROUND1_MIN_PLAYERS) {
    updateRound1LobbyUI();
    return;
  }
  if (round1AutoStartTimer) window.clearTimeout(round1AutoStartTimer);
  round1AutoStartTimer = 0;
  resetLocalRound1Flags();
  const state = createRoundState(ids, Date.now());
  state.hostId = playerId;
  state.participantIds = [...ids];
  state.revision = 1;
  round1HostId = playerId;
  round1FinishedResetAt = 0;
  setRound1State(state, { force: true, localStart: true });
  broadcastRound1State();
}

function setRound1State(incoming, options = {}) {
  if (!incoming || typeof incoming !== 'object') return;
  if (!round1State && incoming.phase === 'finished' && !round1Joined && !options.force) return;
  const currentRevision = Number(round1State?.revision || 0);
  const incomingRevision = Number(incoming.revision || 0);
  if (!options.force && round1State?.roundId === incoming.roundId && incomingRevision < currentRevision) return;
  const previousRoundId = round1State?.roundId;
  round1State = JSON.parse(JSON.stringify(incoming));
  if (!Array.isArray(round1State.participantIds)) {
    round1State.participantIds = [...new Set([...(round1State.activeIds || []), ...(round1State.eliminatedIds || []), ...(round1State.passedIds || [])].map(String))];
  }
  round1HostId = round1State.hostId || round1HostId;
  const localParticipant = isRoundParticipant(round1State, playerId);

  if (previousRoundId !== round1State.roundId) {
    resetLocalRound1Flags();
    configureRound1Answers(round1State.seed);
    prepareRemotePlayersForRound(round1State);
    if (localParticipant) teleportLocalToRound1Start(round1State);
    else {
      round1WaitingNotice?.classList.add('hidden');
      if (player) player.visible = true;
    }
  }

  const phaseKey = `${round1State.roundId}:${round1State.checkpointIndex}:${round1State.phase}`;
  if (phaseKey !== round1LastPhaseKey) {
    round1LastPhaseKey = phaseKey;
    round1LocalReportKey = '';
    if (round1State.phase === 'red' && localParticipant && player && round1State.activeIds?.includes(String(playerId))) {
      round1RedAnchor = player.position.clone();
      round1RedMaxMovement = 0;
      round1RedStartedAt = Date.now();
    } else {
      round1RedAnchor = null;
      round1RedMaxMovement = 0;
      round1RedStartedAt = 0;
    }
  }

  if (localParticipant && round1State.eliminatedIds?.includes(String(playerId)) && !round1IsSpectator) {
    performRound1Elimination('eliminated');
  }
  if (round1State.phase === 'finished' && round1HostId === String(playerId) && !round1FinishedResetAt) {
    round1FinishedResetAt = Date.now() + 8000;
  }
  round1StartButton?.classList.add('hidden');
  refreshRound1Visuals();
}
'''
main = replace_between(main, 'function startRound1Match() {', 'function broadcastRound1State() {', new_start_state, 'start and state flow')

# Replace network message handler with reset support and stale-finished protection.
new_handler = r'''function handleRound1Message(payload) {
  if (!payload?.type || !String(payload.type).startsWith('round1_')) return false;
  if (payload.type === 'round1_reset') {
    resetRound1ToLobby({ broadcast: false, message: payload.reason && payload.reason !== 'reset' ? payload.reason : '' });
    return true;
  }
  if (payload.type === 'round1_state') {
    if (payload.state) {
      const incomingState = JSON.parse(JSON.stringify(payload.state));
      if (!round1State && incomingState.phase === 'finished' && !round1Joined) return true;
      const senderTime = Number(payload.t || 0);
      if (senderTime > 0 && String(payload.from || '') !== String(playerId)) {
        const clockShift = Date.now() - senderTime;
        if (Number.isFinite(incomingState.phaseEndsAt)) incomingState.phaseEndsAt += clockShift;
        if (Number.isFinite(incomingState.redCheckAt)) incomingState.redCheckAt += clockShift;
      }
      setRound1State(incomingState);
    }
    return true;
  }
  if (payload.type === 'round1_report') {
    if (round1HostId !== playerId || !round1State || round1State.phase !== 'red') return true;
    const reporter = String(payload.id || payload.from || '');
    const prior = [...(round1State.redActiveIds || round1State.activeIds || [])];
    const next = applyReport(round1State, reporter, payload.report);
    if (next !== round1State && next.reports?.[reporter] && !round1State.reports?.[reporter]) {
      next.redActiveIds = prior;
      commitHostRound1State(next);
    }
    return true;
  }
  return true;
}
'''
main = replace_between(main, 'function handleRound1Message(payload) {', 'function performRound1Elimination(reason = \'wrong\') {', new_handler, 'round message handler')

main = replace_once(
    main,
    "function performRound1Elimination(reason = 'wrong') {\n  if (round1IsSpectator || !player) return;",
    "function performRound1Elimination(reason = 'wrong') {\n  if (round1IsSpectator || !player || !isRoundParticipant(round1State, playerId)) return;",
    'elimination guard'
)
main = replace_once(
    main,
    "function sendLocalRound1Report(report) {\n  const key = `${round1State?.roundId}:${round1State?.checkpointIndex}`;\n  if (!round1State || round1LocalReportKey === key) return;",
    "function sendLocalRound1Report(report) {\n  const key = `${round1State?.roundId}:${round1State?.checkpointIndex}`;\n  if (!round1State || !isRoundParticipant(round1State, playerId) || round1LocalReportKey === key) return;",
    'report participant guard'
)
main = replace_once(
    main,
    "  refreshRound1Visuals(now);\n\n  if (round1State.phase === 'red'",
    "  refreshRound1Visuals(now);\n\n  if (round1State.phase === 'finished') {\n    if (round1HostId === String(playerId) && round1FinishedResetAt && now >= round1FinishedResetAt) {\n      resetRound1ToLobby({ broadcast: true });\n    }\n    return;\n  }\n\n  if (round1State.phase === 'red'",
    'finished auto reset'
)
main = replace_once(
    main,
    "      phaseEndsAt: redCheckAt + 1300,",
    "      phaseEndsAt: redCheckAt + 2600,",
    'network report margin'
)
MAIN.write_text(main, encoding='utf-8')

html = HTML.read_text(encoding='utf-8')
html = html.replace('<button type="button" id="round1-start" class="round1-start hidden">Начать раунд</button>', '<button type="button" id="round1-start" class="round1-start hidden">Записаться на участие</button>')
HTML.write_text(html, encoding='utf-8')

css = CSS.read_text(encoding='utf-8')
if '.round1-start.joined' not in css:
    css += "\n.round1-start.joined{background:linear-gradient(135deg,#475569,#334155);box-shadow:none}\n"
CSS.write_text(css, encoding='utf-8')

# Static sanity checks for the exact bugs being fixed.
final = MAIN.read_text(encoding='utf-8')
required = [
    'setRound1Registration(!round1Joined)',
    'maybeAutoStartRound1()',
    'syncRound1RemotePresence',
    "payload.type === 'round1_reset'",
    "incomingState.phase === 'finished' && !round1Joined",
    'prepareRemotePlayersForRound(round1State)',
    'group.position.set(Number(row.x) || 0',
]
for needle in required:
    if needle not in final:
        raise SystemExit(f'Missing required fix: {needle}')
print('Round 1 repair patch applied successfully')
