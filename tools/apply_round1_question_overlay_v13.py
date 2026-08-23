from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, got {count}')
    return text.replace(old, new, 1)

# HTML: add a dedicated lightweight question overlay outside the large lobby HUD.
path = Path('game/index.html')
html = path.read_text(encoding='utf-8')
html = replace_once(
    html,
    '''    </section>\n    <div id="round1-waiting" class="round1-waiting hidden">''',
    '''    </section>\n    <div id="round1-question-overlay" class="round1-question-overlay hidden" aria-live="polite">\n      <div class="round1-question-overlay-meta" id="round1-question-overlay-meta">Вопрос 1 из 5</div>\n      <div class="round1-question-overlay-text" id="round1-question-overlay-text">Вопрос</div>\n      <div class="round1-question-overlay-timer" id="round1-question-overlay-timer">15</div>\n    </div>\n    <div id="round1-waiting" class="round1-waiting hidden">''',
    'question overlay markup'
)
html = html.replace('css/style.css?v=round1-cleanhud-12', 'css/style.css?v=round1-question-13')
html = html.replace('js/main.js?v=round1-cleanhud-12', 'js/main.js?v=round1-question-13')
path.write_text(html, encoding='utf-8')

# CSS: compact card visible only during the 15-second reading phase.
path = Path('game/css/style.css')
css = path.read_text(encoding='utf-8')
if '/* ROUND1_QUESTION_OVERLAY_V13 */' not in css:
    css += r'''

/* ROUND1_QUESTION_OVERLAY_V13 */
.round1-question-overlay {
  position: fixed;
  z-index: 78;
  top: max(12px, env(safe-area-inset-top));
  left: 50%;
  transform: translateX(-50%);
  width: min(720px, calc(100vw - 32px));
  box-sizing: border-box;
  min-height: 74px;
  padding: 11px 70px 12px 16px;
  border: 1px solid rgba(125, 211, 252, 0.42);
  border-radius: 16px;
  background: rgba(7, 21, 37, 0.88);
  box-shadow: 0 12px 34px rgba(2, 8, 23, 0.26);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: #f8fafc;
  pointer-events: none;
}
.round1-question-overlay.hidden { display: none !important; }
.round1-question-overlay-meta {
  margin-bottom: 4px;
  color: #7dd3fc;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.round1-question-overlay-text {
  font-size: clamp(0.96rem, 1.8vw, 1.22rem);
  font-weight: 800;
  line-height: 1.24;
  text-align: left;
}
.round1-question-overlay-timer {
  position: absolute;
  right: 13px;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border: 2px solid #7dd3fc;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.86);
  color: #ffffff;
  font-size: 1.12rem;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 720px) {
  .round1-question-overlay {
    top: max(8px, env(safe-area-inset-top));
    width: calc(100vw - 16px);
    min-height: 66px;
    padding: 9px 58px 10px 12px;
    border-radius: 13px;
  }
  .round1-question-overlay-meta {
    font-size: 0.64rem;
    margin-bottom: 3px;
  }
  .round1-question-overlay-text {
    font-size: 0.88rem;
    line-height: 1.2;
  }
  .round1-question-overlay-timer {
    right: 10px;
    width: 38px;
    height: 38px;
    font-size: 0.96rem;
  }
}
'''
path.write_text(css, encoding='utf-8')

# JS: drive the new overlay from the authoritative round state.
path = Path('game/js/main.js')
main = path.read_text(encoding='utf-8')

helper = '''function updateRound1QuestionOverlay(checkpoint, phase, now = Date.now()) {\n  const overlay = document.getElementById('round1-question-overlay');\n  if (!overlay) return;\n  const localParticipant = Boolean(round1State && isRoundParticipant(round1State, playerId));\n  const shouldShow = Boolean(\n    round1State &&\n    localParticipant &&\n    !round1IsSpectator &&\n    phase === 'countdown'\n  );\n  overlay.classList.toggle('hidden', !shouldShow);\n  if (!shouldShow) return;\n\n  const seconds = Math.max(0, Math.ceil((Number(round1State.phaseEndsAt || 0) - now) / 1000));\n  const meta = document.getElementById('round1-question-overlay-meta');\n  const text = document.getElementById('round1-question-overlay-text');\n  const timer = document.getElementById('round1-question-overlay-timer');\n  if (meta) meta.textContent = `Вопрос ${round1State.checkpointIndex + 1} из ${ROUND1_QUESTIONS.length}`;\n  if (text) text.textContent = checkpoint?.question || '';\n  if (timer) timer.textContent = String(seconds);\n}\n\n'''

main = replace_once(
    main,
    '''function refreshRound1Visuals(now = Date.now()) {''',
    helper + '''function refreshRound1Visuals(now = Date.now()) {''',
    'question overlay helper'
)

main = replace_once(
    main,
    '''  const total = ROUND1_QUESTIONS.length;\n  const localParticipant = isRoundParticipant(round1State, playerId);''',
    '''  const total = ROUND1_QUESTIONS.length;\n  const localParticipant = isRoundParticipant(round1State, playerId);\n  updateRound1QuestionOverlay(checkpoint, phase, now);''',
    'question overlay refresh call'
)

main = replace_once(
    main,
    '''  round1WaitingNotice?.classList.add('hidden');\n  round1Hud?.classList.remove('hidden');''',
    '''  round1WaitingNotice?.classList.add('hidden');\n  document.getElementById('round1-question-overlay')?.classList.add('hidden');\n  round1Hud?.classList.remove('hidden');''',
    'overlay initial hidden state'
)

main = replace_once(
    main,
    '''  round1State = null;\n  document.body.classList.remove('round1-match-active');''',
    '''  round1State = null;\n  document.body.classList.remove('round1-match-active');\n  document.getElementById('round1-question-overlay')?.classList.add('hidden');''',
    'overlay reset hidden state'
)

path.write_text(main, encoding='utf-8')
print('Round 1 question overlay v13 applied')
