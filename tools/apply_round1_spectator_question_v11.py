from pathlib import Path

ROOT = Path('.')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, got {count}')
    return text.replace(old, new, 1)

# round1-game.js
path = ROOT / 'game/js/round1-game.js'
r1 = path.read_text(encoding='utf-8')
r1 = replace_once(r1, 'export const ROUND1_COUNTDOWN_MS = 10000;', 'export const ROUND1_COUNTDOWN_MS = 15000;', '15 second question timer')
path.write_text(r1, encoding='utf-8')

# index.html
path = ROOT / 'game/index.html'
html = path.read_text(encoding='utf-8')
html = replace_once(
    html,
    '<strong>Вы выбыли из раунда</strong>\n      <span>Вы перемещены в зал ожидания и можете наблюдать за матчем.</span>',
    '<strong>Режим наблюдателя</strong>\n      <span>Вы выбыли, но остаётесь в матче как зритель. Камера следит за игровой площадкой.</span>',
    'spectator notice'
)
html = html.replace('css/style.css?v=round1-flow-10', 'css/style.css?v=round1-spectator-11')
html = html.replace('js/main.js?v=round1-flow-10', 'js/main.js?v=round1-spectator-11')
path.write_text(html, encoding='utf-8')

# CSS: compact spectator notice so it does not cover the arena.
path = ROOT / 'game/css/style.css'
css = path.read_text(encoding='utf-8')
if '/* ROUND1_SPECTATOR_V11 */' not in css:
    css += r'''

/* ROUND1_SPECTATOR_V11 */
.round1-waiting:not(.hidden) {
  left: 18px;
  right: auto;
  top: auto;
  bottom: 18px;
  transform: none;
  width: min(360px, calc(100vw - 36px));
  max-width: 360px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(8, 17, 31, 0.82);
  backdrop-filter: blur(12px);
  pointer-events: none;
}
.round1-waiting:not(.hidden) strong { font-size: 0.92rem; }
.round1-waiting:not(.hidden) span { font-size: 0.76rem; line-height: 1.35; }
@media (max-width: 720px) {
  .round1-waiting:not(.hidden) {
    left: 10px;
    bottom: 10px;
    width: min(320px, calc(100vw - 20px));
    padding: 10px 12px;
  }
}
'''
path.write_text(css, encoding='utf-8')

# main.js
path = ROOT / 'game/js/main.js'
main = path.read_text(encoding='utf-8')
main = replace_once(
    main,
    '  ROUND1_MIN_PLAYERS,\n  ROUND1_MAX_PLAYERS,\n  ROUND1_QUESTIONS,',
    '  ROUND1_MIN_PLAYERS,\n  ROUND1_MAX_PLAYERS,\n  ROUND1_COUNTDOWN_MS,\n  ROUND1_QUESTIONS,',
    'import countdown constant'
)

# Question is only visible during the dedicated 15-second reading phase.
main = replace_once(
    main,
    "  if (round1Counter) round1Counter.textContent = `${Math.min(total, round1State.checkpointIndex + 1)} / ${total}`;\n  if (round1Question) round1Question.textContent = phase === 'finished' ? 'Раунд завершён' : checkpoint.question;",
    "  if (round1Counter) round1Counter.textContent = `${Math.min(total, round1State.checkpointIndex + 1)} / ${total}`;\n  if (round1QuestionBoard) round1QuestionBoard.visible = phase === 'countdown';\n  if (round1Question) {\n    if (phase === 'countdown') round1Question.textContent = checkpoint.question;\n    else if (phase === 'green') round1Question.textContent = 'Выберите правильную 3D-дату';\n    else if (phase === 'red') round1Question.textContent = 'СТОП — не двигайтесь';\n    else round1Question.textContent = 'Раунд завершён';\n  }",
    'question visibility and HUD text'
)
main = replace_once(
    main,
    "  if (phase === 'countdown') {\n    const seconds = Math.max(0, Math.ceil((round1State.phaseEndsAt - now) / 1000));\n    setRound1Status(`Старт через ${seconds}… Приготовьтесь.`, 'gold');\n    setRound1QuestionBoard('ПРИГОТОВЬТЕСЬ', `старт через ${seconds}`);\n  } else if (phase === 'green') {\n    setRound1Status('НАБЛЮДАТЕЛЬ ОТВЕРНУЛСЯ — двигайтесь к правильной 3D-дате.', 'green');\n    setRound1QuestionBoard(`ВОПРОС ${round1State.checkpointIndex + 1}`, checkpoint.question);\n  } else if (phase === 'red') {\n    setRound1Status('СТОП! Не двигайтесь. Сейчас проверяется ваша позиция.', 'red');\n    setRound1QuestionBoard('СТОП', 'замрите на выбранной дате');",
    "  if (phase === 'countdown') {\n    const seconds = Math.max(0, Math.ceil((round1State.phaseEndsAt - now) / 1000));\n    setRound1Status(`Читайте вопрос · ${seconds} сек. После таймера вопрос исчезнет.`, 'gold');\n    setRound1QuestionBoard(`ВОПРОС ${round1State.checkpointIndex + 1} · ${seconds} СЕК`, checkpoint.question);\n  } else if (phase === 'green') {\n    setRound1Status('НАБЛЮДАТЕЛЬ ОТВЕРНУЛСЯ — двигайтесь к правильной 3D-дате.', 'green');\n  } else if (phase === 'red') {\n    setRound1Status('СТОП! Не двигайтесь. Сейчас проверяется ваша позиция.', 'red');",
    '15 second reading status'
)

# After each successful checkpoint, pause 15 seconds to read the next question instead of immediately running.
main = replace_once(
    main,
    "        next.checkpointIndex += 1;\n        next.phase = 'green';\n        next.phaseEndsAt = now + greenDurationMs(next.seed, next.checkpointIndex);\n        next.reports = {};",
    "        next.checkpointIndex += 1;\n        next.phase = 'countdown';\n        next.phaseEndsAt = now + ROUND1_COUNTDOWN_MS;\n        next.reports = {};",
    'reading phase between checkpoints'
)

# Freeze eliminated spectator completely.
main = replace_once(
    main,
    "function updatePlayer(dt) {\n  if (!player) return;\n\n    let inputX =",
    "function updatePlayer(dt) {\n  if (!player) return;\n\n  if (round1IsSpectator && round1State) {\n    currentSpeed = 0;\n    velocityY = 0;\n    moveTarget = null;\n    keys.Space = false;\n    updateLocomotionPose(dt, 0);\n    return;\n  }\n\n    let inputX =",
    'freeze spectator movement'
)

# Elimination switches to spectator instead of a normal waiting-room camera.
main = replace_once(
    main,
    "  round1WaitingNotice?.classList.remove('hidden');\n  setRound1Status(reason === 'movement' ? 'Вы двигались во время проверки и выбыли.' : 'Ответ или позиция неверны. Вы выбыли.', 'red');\n  currentSpeed = 0;",
    "  round1WaitingNotice?.classList.remove('hidden');\n  setRound1Status(reason === 'movement' ? 'Вы выбыли за движение. Теперь вы наблюдаете за матчем.' : 'Вы выбыли. Теперь вы наблюдаете за оставшимися игроками.', 'red');\n  cameraMode = 'follow';\n  freeCam = false;\n  currentSpeed = 0;",
    'spectator elimination status'
)
main = replace_once(
    main,
    "    player.position.set(ROUND1_WAITING.x, 0.32, ROUND1_WAITING.z);\n    yaw = -Math.PI / 2;\n    player.rotation.y = yaw;\n    player.visible = true;\n    lastPoseX = player.position.x;",
    "    player.position.set(ROUND1_WAITING.x, 0.32, ROUND1_WAITING.z);\n    yaw = -Math.PI / 2;\n    player.rotation.y = yaw;\n    player.visible = false;\n    lastPoseX = player.position.x;",
    'hide local eliminated avatar'
)

# Spectator camera: elevated broadcast-style tracking of the current checkpoint and remaining players.
needle = "function updateCamera(dt) {\n  if (!player || !camera) return;"
helper = r'''function updateRound1SpectatorCamera(dt) {
  if (!camera || !round1State) return;
  const checkpoint = checkpointFor(round1State.checkpointIndex, round1State.seed);
  const activeIds = (round1State.activeIds || []).map(String);
  let sumX = 0;
  let sumZ = 0;
  let count = 0;
  for (const id of activeIds) {
    if (id === String(playerId) && player && !round1IsSpectator) {
      sumX += player.position.x;
      sumZ += player.position.z;
      count += 1;
      continue;
    }
    const entry = remotePlayers.get(id);
    if (!entry) continue;
    const pos = entry.target || entry.group?.position;
    if (!pos) continue;
    sumX += Number(pos.x) || 0;
    sumZ += Number(pos.z) || 0;
    count += 1;
  }
  const playerFocusX = count ? sumX / count : 0;
  const playerFocusZ = count ? sumZ / count : checkpoint.z;
  const focusZ = THREE.MathUtils.clamp((playerFocusZ + checkpoint.z) * 0.5 + 7, -8, 66);
  const focusX = THREE.MathUtils.clamp(playerFocusX * 0.45, -8, 8);
  const desired = new THREE.Vector3(
    24,
    21,
    THREE.MathUtils.clamp(focusZ - 34, -47, 34)
  );
  camera.position.lerp(desired, 1 - Math.pow(0.0025, dt));
  camera.lookAt(focusX, 3.0, THREE.MathUtils.clamp(focusZ + 12, 4, 70));
}

function updateCamera(dt) {
  if (!player || !camera) return;
  if (round1IsSpectator && round1State) {
    updateRound1SpectatorCamera(dt);
    return;
  }'''
main = replace_once(main, needle, helper, 'spectator camera helper')

# When a non-participant joins an already running match, the 3D board should not be forced visible.
main = replace_once(
    main,
    "    setRound1QuestionBoard('РАУНД 1 ИДЁТ', 'ожидайте следующего набора');\n    return;",
    "    if (round1QuestionBoard) round1QuestionBoard.visible = false;\n    return;",
    'hide board for nonparticipants'
)

path.write_text(main, encoding='utf-8')
print('Round 1 spectator + 15 second question phase v11 applied')
