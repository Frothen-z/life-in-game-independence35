from pathlib import Path
import re

css = Path('game/css/style.css')
text = css.read_text(encoding='utf-8')
old = """#c {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
  cursor: none;
}"""
new = """#c {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
  cursor: default;
}"""
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise RuntimeError('global canvas cursor block not found')

# In the lobby/countdown the mobile look/joystick overlay must not cover the registration UI.
mobile_rule = "body.round1-mode:not(.round1-playing) #mobile-controls { display: none !important; }"
if mobile_rule not in text:
    anchor = "body.round1-mode:not(.round1-playing) .mobile-controls { pointer-events: none !important; opacity: .18; }"
    if anchor in text:
        text = text.replace(anchor, anchor + "\n" + mobile_rule, 1)
    else:
        text += "\n" + mobile_rule + "\n"

css.write_text(text, encoding='utf-8')

html = Path('game/index.html')
h = html.read_text(encoding='utf-8')
h = re.sub(r'css/style\.css\?v=[^\"]+', 'css/style.css?v=round1-mobile-8', h)
h = re.sub(r'js/main\.js\?v=[^\"]+', 'js/main.js?v=round1-mobile-8', h)
html.write_text(h, encoding='utf-8')
print('desktop cursor and mobile lobby controls fixed')
