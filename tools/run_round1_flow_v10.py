from pathlib import Path
import re

ROOT = Path('.')
PATCH = ROOT / 'tools/fix_round1_flow_v10.py'

# Fix the transform engine in-memory: JS replacement strings contain backslashes
# (for example /\S+/), so Python must not interpret them as re.sub escapes.
source = PATCH.read_text(encoding='utf-8')
source = source.replace(
    'new, count = re.subn(pattern, repl, text, count=1, flags=flags)',
    'new, count = re.subn(pattern, lambda _match: repl, text, count=1, flags=flags)'
)

# The original auth transform was intentionally removed here because it was too
# broad and could remove PHOTO_TYPES. Auth is patched safely below.
auth_start = source.index('# ---------- auth-service.js ----------')
auth_end = source.index('# ---------- round1-game.js ----------')
source = source[:auth_start] + '# ---------- auth-service.js handled safely by runner ----------\n\n' + source[auth_end:]

# Patch auth-service.js without touching PHOTO_TYPES or unrelated helpers.
auth_path = ROOT / 'game/js/services/auth-service.js'
auth = auth_path.read_text(encoding='utf-8')

username_line = re.compile(r'^const USERNAME_RE = .*?;\n', re.M)
auth, count = username_line.subn(lambda _m: '''function createInternalUsername() {
  let token = '';
  try { token = globalThis.crypto?.randomUUID?.() || ''; } catch {}
  if (!token) token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `u_${token.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 20)}`;
}
''', auth, count=1)
if count != 1:
    raise SystemExit(f'auth username helper: expected 1 match, got {count}')

validation_pattern = re.compile(
    r'export function validateRegistration\(\{ username, displayName, email, password, consent \}\) \{.*?\n\}',
    re.S,
)
auth, count = validation_pattern.subn(lambda _m: '''export function validateRegistration({ displayName, email, password }) {
  if (!String(displayName || '').trim()) return 'Введите имя';
  if (!/^\\S+@\\S+\\.\\S+$/.test(String(email || '').trim())) return 'Введите корректный email';
  if (!String(password || '')) return 'Введите пароль';
  return '';
}''', auth, count=1)
if count != 1:
    raise SystemExit(f'auth validation: expected 1 match, got {count}')

register_pattern = re.compile(
    r'  async function register\(\{ username, displayName, email, password, gender \}\) \{.*?\n  \}',
    re.S,
)
auth, count = register_pattern.subn(lambda _m: '''  async function register({ displayName, email, password }) {
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
  }''', auth, count=1)
if count != 1:
    raise SystemExit(f'auth register: expected 1 match, got {count}')

auth = auth.replace(
    "  if (text.includes('username') || text.includes('duplicate') || text.includes('unique')) return 'Такой логин уже занят';\n",
    ''
)
auth = auth.replace(
    "  if (text.includes('password')) return 'Пароль должен содержать минимум 8 символов';",
    "  if (text.includes('password')) return 'Проверьте пароль и попробуйте ещё раз';"
)
auth_path.write_text(auth, encoding='utf-8')

# Execute the rest of the already prepared transform after the safe fixes above.
namespace = {'__name__': '__main__', '__file__': str(PATCH)}
exec(compile(source, str(PATCH), 'exec'), namespace, namespace)

# Guard against accidental auth regressions.
final_auth = auth_path.read_text(encoding='utf-8')
if 'const PHOTO_TYPES = new Map' not in final_auth:
    raise SystemExit('PHOTO_TYPES was lost')
if 'createInternalUsername' not in final_auth:
    raise SystemExit('internal username helper missing')
if 'Такой логин уже занят' in final_auth:
    raise SystemExit('old duplicate-name error still present')
print('Round 1 flow v10 runner completed safely')
