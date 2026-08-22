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
css.write_text(text, encoding='utf-8')

html = Path('game/index.html')
h = html.read_text(encoding='utf-8')
h = re.sub(r'css/style\.css\?v=[^\"]+', 'css/style.css?v=round1-mobile-7', h)
h = re.sub(r'js/main\.js\?v=[^\"]+', 'js/main.js?v=round1-mobile-7', h)
html.write_text(h, encoding='utf-8')
print('global canvas cursor fixed; pointer lock controls hiding during active gameplay')
