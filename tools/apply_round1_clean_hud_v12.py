from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, got {count}')
    return text.replace(old, new, 1)

# --- HTML ---
path = Path('game/index.html')
html = path.read_text(encoding='utf-8')
html = replace_once(
    html,
    '''      <div id="round1-status" class="round1-status">Соберитесь на стартовой площади</div>\n      <button type="button" id="round1-start" class="round1-start hidden">Записаться на участие</button>''',
    '''      <div id="round1-status" class="round1-status">Соберитесь на стартовой площади</div>\n      <div id="round1-rules" class="round1-rules">\n        <strong>Как играть</strong>\n        <span><b>1.</b> Перед каждой точкой у вас 15 секунд, чтобы прочитать вопрос.</span>\n        <span><b>2.</b> Когда кукла отвернулась — бегите к правильной 3D-дате.</span>\n        <span><b>3.</b> Когда кукла повернулась — замрите. Движение или неверный ответ = выбывание.</span>\n        <span><b>4.</b> Выбывшие продолжают смотреть матч в режиме наблюдателя.</span>\n      </div>\n      <button type="button" id="round1-start" class="round1-start hidden">Записаться на участие</button>''',
    'round1 rules card'
)
html = html.replace('css/style.css?v=round1-spectator-11', 'css/style.css?v=round1-cleanhud-12')
html = html.replace('js/main.js?v=round1-spectator-11', 'js/main.js?v=round1-cleanhud-12')
path.write_text(html, encoding='utf-8')

# --- CSS ---
path = Path('game/css/style.css')
css = path.read_text(encoding='utf-8')
if '/* ROUND1_CLEAN_HUD_V12 */' not in css:
    css += r'''

/* ROUND1_CLEAN_HUD_V12 */
.round1-rules {
  display: grid;
  gap: 6px;
  width: min(680px, 100%);
  margin: 10px auto 12px;
  padding: 12px 14px;
  border: 1px solid rgba(125, 211, 252, 0.18);
  border-radius: 14px;
  background: rgba(7, 21, 37, 0.52);
  color: rgba(239, 248, 255, 0.82);
  text-align: left;
  font-size: 0.78rem;
  line-height: 1.35;
}
.round1-rules strong {
  color: #fff;
  font-size: 0.88rem;
  text-align: center;
  margin-bottom: 2px;
}
.round1-rules b { color: #7dd3fc; }

/* The large lobby HUD must never cover the arena once a match has started. */
body.round1-match-active #round1-hud {
  display: none !important;
}

@media (max-width: 720px) {
  .round1-rules {
    gap: 5px;
    margin: 8px auto 10px;
    padding: 10px 11px;
    font-size: 0.72rem;
  }
}
'''
path.write_text(css, encoding='utf-8')

# --- JS ---
path = Path('game/js/main.js')
main = path.read_text(encoding='utf-8')

main = replace_once(
    main,
    '''function updateRound1LobbyUI() {\n  if (!round1Hud) return;\n  syncRound1InputMode();\n  round1Hud.classList.remove('hidden');\n  if (round1State) {\n    round1StartButton?.classList.add('hidden');\n    round1CancelButton?.classList.add('hidden');\n    refreshRound1Visuals();\n    return;\n  }''',
    '''function updateRound1LobbyUI() {\n  if (!round1Hud) return;\n  syncRound1InputMode();\n  document.body.classList.toggle('round1-match-active', Boolean(round1State));\n  if (round1State) {\n    round1Hud.classList.add('hidden');\n    round1StartButton?.classList.add('hidden');\n    round1CancelButton?.classList.add('hidden');\n    refreshRound1Visuals();\n    return;\n  }\n  round1Hud.classList.remove('hidden');''',
    'hide large HUD in active match'
)

main = replace_once(
    main,
    '''  round1HostId = round1State.hostId || round1HostId;\n  const localParticipant = isRoundParticipant(round1State, playerId);''',
    '''  round1HostId = round1State.hostId || round1HostId;\n  document.body.classList.add('round1-match-active');\n  round1Hud?.classList.add('hidden');\n  const localParticipant = isRoundParticipant(round1State, playerId);''',
    'hide HUD immediately on state start'
)

main = replace_once(
    main,
    '''  round1State = null;\n  round1Joined = false;''',
    '''  round1State = null;\n  document.body.classList.remove('round1-match-active');\n  round1Joined = false;''',
    'restore lobby HUD on reset'
)

main = replace_once(
    main,
    '''  round1QuestionBoard.position.set(12.5, 9.4, 55.5);\n  round1QuestionBoard.rotation.y = Math.PI * 0.88;\n  arena.add(round1QuestionBoard);''',
    '''  round1QuestionBoard.position.set(12.5, 9.4, 55.5);\n  round1QuestionBoard.rotation.y = Math.PI * 0.88;\n  round1QuestionBoard.visible = false;\n  arena.add(round1QuestionBoard);''',
    'hide world question board before match'
)

path.write_text(main, encoding='utf-8')
print('Round 1 clean HUD v12 applied')
