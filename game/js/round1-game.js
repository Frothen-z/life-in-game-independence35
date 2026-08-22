export const ROUND1_REQUIRED_PLAYERS = 2;
export const ROUND1_MIN_PLAYERS = ROUND1_REQUIRED_PLAYERS;
export const ROUND1_MAX_PLAYERS = 8;
export const ROUND1_COUNTDOWN_MS = 7000;
export const ROUND1_CHECKPOINT_Z = Object.freeze([-8, 10, 28, 46, 64]);
export const ROUND1_LANE_X = Object.freeze([-10, 0, 10]);
export const ROUND1_ZONE_HALF_W = 3.4;
export const ROUND1_ZONE_HALF_D = 3.6;

export const ROUND1_QUESTIONS = Object.freeze([
  Object.freeze({
    id: 'independence',
    question: 'В каком году была провозглашена государственная независимость Республики Узбекистан?',
    correctYear: 1991,
    options: Object.freeze([1990, 1991, 1992])
  }),
  Object.freeze({
    id: 'flag',
    question: 'В каком году был утверждён Государственный флаг Республики Узбекистан?',
    correctYear: 1991,
    options: Object.freeze([1991, 1992, 1993])
  }),
  Object.freeze({
    id: 'un',
    question: 'В каком году Узбекистан был принят в Организацию Объединённых Наций?',
    correctYear: 1992,
    options: Object.freeze([1991, 1992, 1993])
  }),
  Object.freeze({
    id: 'constitution',
    question: 'В каком году была принята Конституция Республики Узбекистан?',
    correctYear: 1992,
    options: Object.freeze([1991, 1992, 1993])
  }),
  Object.freeze({
    id: 'som',
    question: 'В каком году была введена национальная валюта Узбекистана — сум?',
    correctYear: 1994,
    options: Object.freeze([1993, 1994, 1995])
  })
]);

export function hashString(value) {
  const input = String(value ?? '');
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function seededUnit(seed) {
  let x = (Number(seed) >>> 0) || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 4294967296;
}

export function shuffleWithSeed(values, seed) {
  const arr = [...values];
  let state = (Number(seed) >>> 0) || 1;
  for (let i = arr.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function checkpointFor(index, roundSeed = 1) {
  const safeIndex = Math.max(0, Math.min(ROUND1_QUESTIONS.length - 1, Number(index) || 0));
  const q = ROUND1_QUESTIONS[safeIndex];
  const seed = (Number(roundSeed) + Math.imul(safeIndex + 1, 2654435761)) >>> 0;
  const years = shuffleWithSeed(q.options, seed);
  return {
    index: safeIndex,
    id: q.id,
    question: q.question,
    correctYear: q.correctYear,
    z: ROUND1_CHECKPOINT_Z[safeIndex],
    zones: years.map((year, lane) => ({
      year,
      x: ROUND1_LANE_X[lane],
      z: ROUND1_CHECKPOINT_Z[safeIndex],
      lane
    }))
  };
}

export function locateZone(x, z, checkpoint) {
  if (!checkpoint?.zones) return null;
  return checkpoint.zones.find((zone) =>
    Math.abs(Number(x) - zone.x) <= ROUND1_ZONE_HALF_W &&
    Math.abs(Number(z) - zone.z) <= ROUND1_ZONE_HALF_D
  ) || null;
}

export function evaluateCheckpoint({ x, z, movedDistance = 0, checkpoint, movementLimit = 0.18 }) {
  if (Number(movedDistance) > movementLimit) {
    return { pass: false, eliminated: true, reason: 'movement', zone: null };
  }
  const zone = locateZone(x, z, checkpoint);
  if (!zone) return { pass: false, eliminated: true, reason: 'outside', zone: null };
  if (zone.year !== checkpoint.correctYear) {
    return { pass: false, eliminated: true, reason: 'wrong-year', zone };
  }
  return { pass: true, eliminated: false, reason: 'correct', zone };
}

export function chooseHostId(ids) {
  return [...new Set((ids || []).map((id) => String(id || '')).filter(Boolean))].sort()[0] || null;
}

export function registeredPlayerIds(members) {
  const ids = [];
  const seen = new Set();
  for (const member of members || []) {
    const id = String(member?.id || member?.key || '').trim();
    if (!id || !member?.joined || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.slice(0, ROUND1_MAX_PLAYERS);
}

export function isRoundParticipant(state, playerId) {
  const id = String(playerId || '');
  if (!id || !state) return false;
  const ids = state.participantIds || [
    ...(state.activeIds || []),
    ...(state.eliminatedIds || []),
    ...(state.passedIds || [])
  ];
  return ids.map(String).includes(id);
}

export function createRoundState(playerIds, now = Date.now(), seed = null) {
  const players = [...new Set((playerIds || []).map(String).filter(Boolean))].slice(0, ROUND1_MAX_PLAYERS);
  if (players.length < 1) throw new Error('ROUND1_REQUIRES_PLAYER');
  const roundSeed = seed == null ? hashString(`${now}:${players.join('|')}`) : Number(seed) >>> 0;
  return {
    version: 1,
    roundId: `r1_${now}_${roundSeed.toString(36)}`,
    seed: roundSeed,
    hostId: chooseHostId(players),
    phase: 'countdown',
    phaseEndsAt: now + ROUND1_COUNTDOWN_MS,
    checkpointIndex: 0,
    participantIds: [...players],
    activeIds: players,
    eliminatedIds: [],
    passedIds: [],
    reports: {},
    winnerIds: [],
    createdAt: now
  };
}

export function applyReport(state, playerId, report) {
  if (!state || !playerId || !report) return state;
  const id = String(playerId);
  if (!state.activeIds.includes(id)) return state;
  if (Number(report.checkpointIndex) !== Number(state.checkpointIndex)) return state;
  if (state.reports?.[id]) return state;

  const next = {
    ...state,
    activeIds: [...state.activeIds],
    eliminatedIds: [...state.eliminatedIds],
    passedIds: [...state.passedIds],
    reports: { ...(state.reports || {}) }
  };
  next.reports[id] = {
    checkpointIndex: Number(report.checkpointIndex),
    pass: Boolean(report.pass),
    reason: String(report.reason || '')
  };
  if (!report.pass) {
    next.activeIds = next.activeIds.filter((value) => value !== id);
    if (!next.eliminatedIds.includes(id)) next.eliminatedIds.push(id);
  }
  return next;
}

export function allActiveReported(state, priorActiveIds = null) {
  const expected = priorActiveIds || state?.activeIds || [];
  if (!expected.length) return true;
  return expected.every((id) => Boolean(state?.reports?.[id]));
}

export function greenDurationMs(seed, checkpointIndex) {
  const unit = seededUnit((Number(seed) + Math.imul(Number(checkpointIndex) + 11, 1103515245)) >>> 0);
  return Math.round(4300 + unit * 2300);
}
