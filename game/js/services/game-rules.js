export const CHESS_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const asId = (value) => String(value || '').trim();
const clone = (value) => JSON.parse(JSON.stringify(value));
const clampInt = (value, min, max) => Math.min(max, Math.max(min, Math.trunc(Number(value) || 0)));

function shuffled(values, random = Math.random) {
  const result = values.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createChessState(playerIds, {
  now = Date.now(),
  random = Math.random,
  initialMs = 10 * 60 * 1000,
  incrementMs = 5 * 1000
} = {}) {
  const ids = [...new Set((playerIds || []).map(asId).filter(Boolean))];
  if (ids.length !== 2) throw new Error('CHESS_REQUIRES_TWO_PLAYERS');
  const order = shuffled(ids, random);
  return {
    fen: CHESS_START_FEN,
    white: order[0],
    black: order[1],
    clocks: { w: initialMs, b: initialMs, inc: incrementMs, activeSince: now },
    status: 'playing',
    winner: null,
    reason: null,
    revision: 1,
    lastMove: null
  };
}

function finishChess(state, winner, reason) {
  state.status = 'finished';
  state.winner = winner || null;
  state.reason = reason;
  state.clocks.activeSince = 0;
  state.revision += 1;
  return { ok: true, state };
}

export function applyChessAction(current, action, Chess, { now = Date.now() } = {}) {
  if (!current || !Chess) return { ok: false, error: 'INVALID_CHESS_STATE' };
  const state = clone(current);
  const actorId = asId(action?.from);
  if (state.status !== 'playing') return { ok: false, error: 'GAME_FINISHED' };
  if (![state.white, state.black].includes(actorId)) return { ok: false, error: 'NOT_A_PLAYER' };

  const game = new Chess(state.fen);
  const turn = game.turn();
  const activePlayer = turn === 'w' ? state.white : state.black;
  if (actorId !== activePlayer) return { ok: false, error: 'NOT_YOUR_TURN' };

  const elapsed = Math.max(0, now - Number(state.clocks.activeSince || now));
  state.clocks[turn] = Math.max(0, Number(state.clocks[turn] || 0) - elapsed);
  if (state.clocks[turn] <= 0) {
    return finishChess(state, turn === 'w' ? state.black : state.white, 'timeout');
  }

  if (action?.kind === 'resign') {
    return finishChess(state, turn === 'w' ? state.black : state.white, 'resign');
  }
  if (action?.kind !== 'move') return { ok: false, error: 'INVALID_ACTION' };

  let move;
  try {
    move = game.move({
      from: String(action.fromSquare || ''),
      to: String(action.toSquare || ''),
      promotion: ['q', 'r', 'b', 'n'].includes(action.promotion) ? action.promotion : 'q'
    });
  } catch {
    return { ok: false, error: 'ILLEGAL_MOVE' };
  }
  if (!move) return { ok: false, error: 'ILLEGAL_MOVE' };

  state.clocks[turn] += Number(state.clocks.inc || 0);
  state.clocks.activeSince = now;
  state.fen = game.fen();
  state.lastMove = { from: move.from, to: move.to, san: move.san };
  state.revision += 1;

  if (game.isCheckmate()) return finishChess(state, actorId, 'checkmate');
  if (game.isStalemate()) return finishChess(state, null, 'stalemate');
  if (game.isThreefoldRepetition()) return finishChess(state, null, 'threefold');
  if (game.isInsufficientMaterial()) return finishChess(state, null, 'insufficient');
  if (game.isDraw()) return finishChess(state, null, 'draw');
  return { ok: true, state };
}

export function applyChessClock(current, Chess, { now = Date.now() } = {}) {
  if (!current || current.status !== 'playing') return { ok: true, state: current, changed: false };
  const state = clone(current);
  const game = new Chess(state.fen);
  const turn = game.turn();
  const elapsed = Math.max(0, now - Number(state.clocks.activeSince || now));
  if (elapsed < Number(state.clocks[turn] || 0)) return { ok: true, state, changed: false };
  state.clocks[turn] = 0;
  const winner = turn === 'w' ? state.black : state.white;
  return { ...finishChess(state, winner, 'timeout'), changed: true };
}

export function createSpeakingState(playerIds, topic, {
  now = Date.now(),
  rulesMs = 15 * 1000,
  speakerMs = 60 * 1000,
  freeMs = 6 * 60 * 1000,
  finaleMs = 30 * 1000
} = {}) {
  const queue = [...new Set((playerIds || []).map(asId).filter(Boolean))];
  return {
    phase: 'rules',
    topic: String(topic || 'Conversation').slice(0, 100),
    queue,
    speakerIndex: 0,
    currentSpeaker: null,
    endsAt: now + rulesMs,
    durations: { rulesMs, speakerMs, freeMs, finaleMs },
    revision: 1
  };
}

export function advanceSpeakingState(current, {
  actorId,
  hostId,
  reason = 'timeout',
  now = Date.now()
} = {}) {
  if (!current) return { ok: false, error: 'INVALID_SPEAKING_STATE' };
  const state = clone(current);
  const actor = asId(actorId);
  const host = asId(hostId);
  const currentSpeaker = state.queue[state.speakerIndex] || null;
  if (reason === 'done' && actor !== host && actor !== currentSpeaker) {
    return { ok: false, error: 'NOT_CURRENT_SPEAKER' };
  }
  if (reason === 'timeout' && now < Number(state.endsAt || 0) && actor !== host) {
    return { ok: false, error: 'PHASE_NOT_FINISHED' };
  }

  const durations = state.durations || {};
  if (state.phase === 'rules') {
    state.phase = 'ice';
    state.speakerIndex = 0;
    state.currentSpeaker = state.queue[0] || null;
    state.endsAt = now + Number(durations.speakerMs || 60000);
  } else if (state.phase === 'ice') {
    state.speakerIndex += 1;
    if (state.speakerIndex >= state.queue.length) {
      state.phase = 'free';
      state.currentSpeaker = null;
      state.endsAt = now + Number(durations.freeMs || 360000);
    } else {
      state.currentSpeaker = state.queue[state.speakerIndex];
      state.endsAt = now + Number(durations.speakerMs || 60000);
    }
  } else if (state.phase === 'free') {
    state.phase = 'finale';
    state.speakerIndex = 0;
    state.currentSpeaker = state.queue[0] || null;
    state.endsAt = now + Number(durations.finaleMs || 30000);
  } else if (state.phase === 'finale') {
    state.speakerIndex += 1;
    if (state.speakerIndex >= state.queue.length) {
      state.phase = 'end';
      state.currentSpeaker = null;
      state.endsAt = 0;
    } else {
      state.currentSpeaker = state.queue[state.speakerIndex];
      state.endsAt = now + Number(durations.finaleMs || 30000);
    }
  } else {
    return { ok: false, error: 'SESSION_FINISHED' };
  }
  state.revision = Number(state.revision || 0) + 1;
  return { ok: true, state };
}

export function sanitizeMafiaState(current) {
  if (!current) return null;
  const publicState = clone(current);
  const submittedVotes = Object.keys(publicState.votes || {});
  const skippedVotes = Object.keys(publicState.voteSkip || {});
  delete publicState.roles;
  delete publicState.chiefMafia;
  delete publicState.nightTarget;
  delete publicState.votes;
  delete publicState.voteSkip;
  delete publicState._pendingEliminate;
  delete publicState._pendingRunoff;
  delete publicState._mafiaPeerIds;
  delete publicState._mafiaPeerNames;
  delete publicState._privateChiefMafia;
  return {
    ...publicState,
    submittedVotes,
    skippedVotes
  };
}

function monopolyResult(ok, state, error = '') {
  return { ok, state, error };
}

function monopolyLog(state, text) {
  state.log = (state.log || []).concat(String(text || '')).slice(-40);
}

function nextActiveId(state, fromId = state.turn) {
  const alive = state.order.filter((id) => state.players[id] && !state.players[id].bankrupt);
  if (!alive.length) return null;
  const start = state.order.indexOf(fromId);
  for (let offset = 1; offset <= state.order.length; offset += 1) {
    const candidate = state.order[(Math.max(0, start) + offset) % state.order.length];
    if (state.players[candidate] && !state.players[candidate].bankrupt) return candidate;
  }
  return alive[0];
}

function finishMonopolyIfNeeded(state) {
  const alive = state.order.filter((id) => state.players[id] && !state.players[id].bankrupt);
  if (alive.length > 1) return false;
  state.phase = 'over';
  state.winner = alive[0] || null;
  monopolyLog(state, `Победитель: ${state.players[state.winner]?.name || '—'}`);
  return true;
}

function propertyGroup(board, group) {
  return board.filter((cell) => cell.type === 'prop' && cell.group === group);
}

function ownsGroup(state, board, playerId, group) {
  const groupCells = propertyGroup(board, group);
  return groupCells.length > 0 && groupCells.every((cell) => state.owners[cell.id] === playerId);
}

function propertyRent(state, board, cell, ownerId, diceTotal) {
  if (state.mortgaged?.[cell.id]) return 0;
  if (cell.type === 'prop') {
    const houses = clampInt(state.houses?.[cell.id], 0, 5);
    const base = Number(cell.rent?.[houses] || cell.rent?.[0] || 0);
    return houses === 0 && ownsGroup(state, board, ownerId, cell.group) ? base * 2 : base;
  }
  if (cell.type === 'rail') {
    const count = board.filter((item) => item.type === 'rail' && state.owners[item.id] === ownerId).length;
    return [0, 25000, 50000, 100000, 200000][count] || 0;
  }
  if (cell.type === 'util') {
    const count = board.filter((item) => item.type === 'util' && state.owners[item.id] === ownerId).length;
    return (count >= 2 ? 10 : 4) * Math.max(2, Number(diceTotal || 7)) * 1000;
  }
  return 0;
}

function setDebtPhase(state, debtorId, creditorId = null) {
  const player = state.players[debtorId];
  if (player.money >= 0) return false;
  state.phase = 'debt';
  state.debt = { playerId: debtorId, creditorId };
  monopolyLog(state, `${player.name} должен покрыть долг ${Math.abs(player.money).toLocaleString('ru-RU')}`);
  return true;
}

function sendToJail(state, player) {
  player.pos = 10;
  player.inJail = true;
  player.jailTurns = 0;
  state.doublesInTurn = 0;
  state.extraTurn = false;
  state.phase = 'end';
  monopolyLog(state, `${player.name} отправляется в тюрьму`);
}

function drawCard(state, player, cardType, random) {
  const cards = [
    { text: 'Банк выплачивает дивиденды', money: 100000 },
    { text: 'Оплатите городской сбор', money: -50000 },
    { text: 'Отправляйтесь на Старт', move: 0, collectGo: true },
    { text: 'Отправляйтесь в тюрьму', jail: true }
  ];
  const card = cards[Math.floor(random() * cards.length)] || cards[0];
  monopolyLog(state, `${cardType === 'chance' ? 'Шанс' : 'Казна'}: ${card.text}`);
  if (card.money) player.money += card.money;
  if (card.jail) sendToJail(state, player);
  if (Number.isInteger(card.move)) {
    if (card.collectGo && player.pos !== 0) player.money += Number(state.goReward || 200000);
    player.pos = card.move;
  }
}

function beginAuction(state, cell) {
  const bidders = state.order.filter((id) => !state.players[id].bankrupt);
  state.phase = 'auction';
  state.auction = {
    cellId: cell.id,
    active: bidders[0] || null,
    passed: [],
    highestBid: 0,
    highestBidder: null,
    minStep: 10000
  };
  monopolyLog(state, `Аукцион: «${cell.name}»`);
}

function nextAuctionBidder(state) {
  const auction = state.auction;
  const eligible = state.order.filter((id) => {
    const player = state.players[id];
    return player && !player.bankrupt && !auction.passed.includes(id) && id !== auction.highestBidder;
  });
  if (!eligible.length) return null;
  const start = state.order.indexOf(auction.active);
  for (let offset = 1; offset <= state.order.length; offset += 1) {
    const candidate = state.order[(Math.max(0, start) + offset) % state.order.length];
    if (eligible.includes(candidate)) return candidate;
  }
  return eligible[0];
}

function settleAuction(state, board) {
  const auction = state.auction;
  const cell = board[auction.cellId];
  const winner = state.players[auction.highestBidder];
  if (winner && auction.highestBid > 0 && winner.money >= auction.highestBid) {
    winner.money -= auction.highestBid;
    winner.props.push(cell.id);
    state.owners[cell.id] = winner.id;
    monopolyLog(state, `${winner.name} выиграл «${cell.name}» за ${auction.highestBid.toLocaleString('ru-RU')}`);
  } else {
    monopolyLog(state, `«${cell.name}» остался у банка`);
  }
  state.auction = null;
  state.phase = 'end';
}

function resolveMonopolyCell(state, board, playerId, random) {
  const player = state.players[playerId];
  const cell = board[player.pos];
  if (!cell) {
    state.phase = 'end';
    return;
  }
  if (['go', 'jail', 'park'].includes(cell.type)) {
    state.phase = 'end';
    return;
  }
  if (cell.type === 'gotojail') {
    sendToJail(state, player);
    return;
  }
  if (cell.type === 'tax') {
    player.money -= Number(cell.amount || 0);
    monopolyLog(state, `${player.name} платит налог ${Number(cell.amount || 0).toLocaleString('ru-RU')}`);
    if (!setDebtPhase(state, playerId)) state.phase = 'end';
    return;
  }
  if (cell.type === 'chance' || cell.type === 'chest') {
    drawCard(state, player, cell.type, random);
    if (!player.inJail && !setDebtPhase(state, playerId)) state.phase = 'end';
    return;
  }

  const ownerId = state.owners[cell.id];
  if (!ownerId) {
    state.phase = 'buy';
    state.pendingCell = cell.id;
    return;
  }
  if (ownerId === playerId) {
    state.phase = 'end';
    return;
  }
  const rent = propertyRent(state, board, cell, ownerId, state.lastDice?.total);
  player.money -= rent;
  state.players[ownerId].money += Math.min(rent, Math.max(0, player.money + rent));
  monopolyLog(state, `${player.name} платит ${rent.toLocaleString('ru-RU')} → ${state.players[ownerId].name}`);
  if (!setDebtPhase(state, playerId, ownerId)) state.phase = 'end';
}

export function createMonopolyState(players, {
  startMoney = 1500000,
  goReward = 200000
} = {}) {
  const order = players.map((player) => asId(player.id)).filter(Boolean);
  const playerMap = {};
  players.forEach((player, index) => {
    const id = asId(player.id);
    if (!id || playerMap[id]) return;
    playerMap[id] = {
      id,
      name: String(player.name || 'Игрок').slice(0, 80),
      money: startMoney,
      pos: 0,
      inJail: false,
      jailTurns: 0,
      props: [],
      bankrupt: false,
      order: index
    };
  });
  if (Object.keys(playerMap).length < 2) throw new Error('MONOPOLY_REQUIRES_TWO_PLAYERS');
  return {
    players: playerMap,
    turn: order[0],
    order,
    owners: {},
    houses: {},
    mortgaged: {},
    phase: 'roll',
    pendingCell: null,
    auction: null,
    debt: null,
    lastDice: null,
    doublesInTurn: 0,
    extraTurn: false,
    winner: null,
    goReward,
    revision: 1,
    log: ['Игра началась. Каждому по 1 500 000.']
  };
}

export function applyMonopolyAction(current, action, board, {
  random = Math.random
} = {}) {
  if (!current || !Array.isArray(board) || board.length !== 40) {
    return monopolyResult(false, current, 'INVALID_MONOPOLY_STATE');
  }
  const state = clone(current);
  const actorId = asId(action?.from);
  const player = state.players[actorId];
  if (!player || player.bankrupt) return monopolyResult(false, current, 'NOT_ACTIVE_PLAYER');
  if (state.phase === 'over') return monopolyResult(false, current, 'GAME_FINISHED');

  const kind = String(action?.kind || '');
  if (kind === 'roll') {
    if (state.turn !== actorId || state.phase !== 'roll') return monopolyResult(false, current, 'NOT_YOUR_TURN');
    const d1 = 1 + Math.floor(random() * 6);
    const d2 = 1 + Math.floor(random() * 6);
    const total = d1 + d2;
    const isDouble = d1 === d2;
    state.lastDice = { d1, d2, total, isDouble };
    monopolyLog(state, `${player.name} выбросил ${d1}+${d2}=${total}`);

    if (player.inJail) {
      if (isDouble) {
        player.inJail = false;
        player.jailTurns = 0;
        monopolyLog(state, `${player.name} вышел из тюрьмы дублем`);
      } else {
        player.jailTurns += 1;
        if (player.jailTurns < 3) {
          state.phase = 'end';
          state.extraTurn = false;
          state.revision += 1;
          return monopolyResult(true, state);
        }
        player.money -= 50000;
        player.inJail = false;
        player.jailTurns = 0;
        monopolyLog(state, `${player.name} платит залог 50 000`);
        if (setDebtPhase(state, actorId)) {
          state.revision += 1;
          return monopolyResult(true, state);
        }
      }
    }

    if (isDouble) state.doublesInTurn += 1;
    else state.doublesInTurn = 0;
    if (state.doublesInTurn >= 3) {
      sendToJail(state, player);
      state.revision += 1;
      return monopolyResult(true, state);
    }

    const rawPos = player.pos + total;
    if (rawPos >= 40) {
      player.money += Number(state.goReward || 200000);
      monopolyLog(state, `${player.name} прошёл Старт: +${Number(state.goReward || 200000).toLocaleString('ru-RU')}`);
    }
    player.pos = rawPos % 40;
    state.extraTurn = isDouble;
    resolveMonopolyCell(state, board, actorId, random);
  } else if (kind === 'pay-bail') {
    if (state.turn !== actorId || state.phase !== 'roll' || !player.inJail || player.money < 50000) {
      return monopolyResult(false, current, 'BAIL_NOT_AVAILABLE');
    }
    player.money -= 50000;
    player.inJail = false;
    player.jailTurns = 0;
    monopolyLog(state, `${player.name} заплатил залог 50 000`);
  } else if (kind === 'buy') {
    if (state.turn !== actorId || state.phase !== 'buy') return monopolyResult(false, current, 'BUY_NOT_AVAILABLE');
    const cell = board[state.pendingCell];
    if (!cell || state.owners[cell.id]) return monopolyResult(false, current, 'PROPERTY_UNAVAILABLE');
    if (action.yes) {
      if (player.money < Number(cell.price || 0)) return monopolyResult(false, current, 'NOT_ENOUGH_MONEY');
      player.money -= Number(cell.price || 0);
      player.props.push(cell.id);
      state.owners[cell.id] = actorId;
      monopolyLog(state, `${player.name} купил «${cell.name}»`);
      state.phase = 'end';
      state.pendingCell = null;
    } else {
      beginAuction(state, cell);
    }
  } else if (kind === 'auction-bid') {
    if (state.phase !== 'auction' || state.auction?.active !== actorId) return monopolyResult(false, current, 'NOT_YOUR_AUCTION_TURN');
    const bid = clampInt(action.amount, 0, 100000000);
    const minimum = state.auction.highestBid + state.auction.minStep;
    if (bid < minimum || bid > player.money) return monopolyResult(false, current, 'INVALID_BID');
    state.auction.highestBid = bid;
    state.auction.highestBidder = actorId;
    monopolyLog(state, `${player.name}: ставка ${bid.toLocaleString('ru-RU')}`);
    const next = nextAuctionBidder(state);
    if (!next) settleAuction(state, board);
    else state.auction.active = next;
  } else if (kind === 'auction-pass') {
    if (state.phase !== 'auction' || state.auction?.active !== actorId) return monopolyResult(false, current, 'NOT_YOUR_AUCTION_TURN');
    if (!state.auction.passed.includes(actorId)) state.auction.passed.push(actorId);
    monopolyLog(state, `${player.name} пасует`);
    const next = nextAuctionBidder(state);
    if (!next) settleAuction(state, board);
    else state.auction.active = next;
  } else if (kind === 'build' || kind === 'sell-house') {
    const cellId = clampInt(action.cellId, 0, 39);
    const cell = board[cellId];
    if (!cell || cell.type !== 'prop' || state.owners[cellId] !== actorId) {
      return monopolyResult(false, current, 'PROPERTY_NOT_OWNED');
    }
    const groupCells = propertyGroup(board, cell.group);
    const levels = groupCells.map((item) => Number(state.houses[item.id] || 0));
    const currentLevel = Number(state.houses[cellId] || 0);
    if (kind === 'build') {
      if (!ownsGroup(state, board, actorId, cell.group)) return monopolyResult(false, current, 'GROUP_NOT_COMPLETE');
      if (currentLevel >= 5 || currentLevel > Math.min(...levels) || player.money < Number(cell.house || 0)) {
        return monopolyResult(false, current, 'CANNOT_BUILD');
      }
      player.money -= Number(cell.house || 0);
      state.houses[cellId] = currentLevel + 1;
      monopolyLog(state, `${player.name} строит на «${cell.name}»`);
    } else {
      if (currentLevel <= 0 || currentLevel < Math.max(...levels)) return monopolyResult(false, current, 'CANNOT_SELL_HOUSE');
      state.houses[cellId] = currentLevel - 1;
      player.money += Math.floor(Number(cell.house || 0) / 2);
      monopolyLog(state, `${player.name} продал дом на «${cell.name}»`);
      if (state.phase === 'debt' && state.debt?.playerId === actorId && player.money >= 0) {
        state.phase = 'end';
        state.debt = null;
      }
    }
  } else if (kind === 'bankrupt') {
    if (state.phase !== 'debt' || state.debt?.playerId !== actorId) return monopolyResult(false, current, 'BANKRUPTCY_NOT_AVAILABLE');
    const creditorId = state.debt.creditorId;
    const creditor = state.players[creditorId];
    for (const cellId of player.props) {
      if (creditor && !creditor.bankrupt) {
        state.owners[cellId] = creditorId;
        creditor.props.push(cellId);
      } else {
        delete state.owners[cellId];
        delete state.houses[cellId];
      }
    }
    player.props = [];
    player.money = 0;
    player.bankrupt = true;
    state.debt = null;
    monopolyLog(state, `${player.name} объявил банкротство`);
    if (!finishMonopolyIfNeeded(state)) state.phase = 'end';
  } else if (kind === 'end-turn') {
    if (state.turn !== actorId || state.phase !== 'end') return monopolyResult(false, current, 'TURN_NOT_FINISHED');
    if (!state.extraTurn || player.inJail) {
      state.turn = nextActiveId(state, actorId);
      state.doublesInTurn = 0;
    } else {
      monopolyLog(state, `${player.name} ходит ещё раз за дубль`);
    }
    state.extraTurn = false;
    state.phase = 'roll';
    state.pendingCell = null;
    state.lastDice = null;
  } else {
    return monopolyResult(false, current, 'INVALID_ACTION');
  }

  finishMonopolyIfNeeded(state);
  state.revision = Number(state.revision || 0) + 1;
  return monopolyResult(true, state);
}

export function removeMonopolyPlayer(current, playerId) {
  if (!current?.players?.[playerId]) return current;
  const state = clone(current);
  const player = state.players[playerId];
  player.bankrupt = true;
  player.money = 0;
  for (const cellId of player.props || []) {
    delete state.owners[cellId];
    delete state.houses[cellId];
  }
  player.props = [];
  monopolyLog(state, `${player.name} отключился и выбыл из игры`);
  if (state.turn === playerId) {
    state.turn = nextActiveId(state, playerId);
    state.phase = 'roll';
  }
  finishMonopolyIfNeeded(state);
  state.revision = Number(state.revision || 0) + 1;
  return state;
}
