const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const PHOTO_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);

export function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().normalize('NFKC');
}

export function validateRegistration({ username, displayName, email, password, consent }) {
  const normalizedUsername = normalizeUsername(username);
  if (!USERNAME_RE.test(normalizedUsername)) {
    return 'Логин: 3–24 символа, только латинские буквы, цифры и _';
  }
  if (String(displayName || '').trim().length < 2) return 'Имя должно содержать минимум 2 символа';
  if (!/^\S+@\S+\.\S+$/.test(String(email || '').trim())) return 'Введите корректный email';
  if (String(password || '').length < 8) return 'Пароль должен содержать минимум 8 символов';
  if (!consent) return 'Нужно принять правила и политику конфиденциальности';
  return '';
}

function profileToUser(row, fallback = {}) {
  return {
    ...fallback,
    username: row?.username || fallback.username || '',
    name: row?.name || fallback.name || 'Игрок',
    gender: row?.gender || fallback.gender || 'male',
    status: row?.status || '',
    photo: row?.photo || '',
    birthday: row?.birthday || '',
    work: row?.work || '',
    city: row?.city || '',
    about: row?.about || '',
    clothes: row?.clothes || 'default',
    avatarUrl: row?.avatar_url || null,
    avatarVersion: Number(row?.avatar_version || 1)
  };
}

export async function createAuthService() {
  const cfg = await import('../config.js');
  if (!cfg.isCloudEnabled?.()) return null;

  const createClient = globalThis.supabase?.createClient;
  if (typeof createClient !== 'function') throw new Error('SUPABASE_CLIENT_UNAVAILABLE');
  const client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce'
    }
  });

  async function getSession() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function register({ username, displayName, email, password, gender }) {
    const cleanUsername = normalizeUsername(username);
    const cleanName = String(displayName || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const { data, error } = await client.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: { username: cleanUsername, name: cleanName, gender } }
    });
    if (error) throw error;
    return data;
  }

  async function login(email, password) {
    const { data, error } = await client.auth.signInWithPassword({
      email: String(email || '').trim().toLowerCase(),
      password
    });
    if (error) throw error;
    return data;
  }

  async function loadProfile(user, fallback = {}) {
    if (!user) return profileToUser(null, fallback);
    const { data, error } = await client.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) throw error;
    return profileToUser(data, {
      ...fallback,
      username: user.user_metadata?.username || fallback.username,
      name: user.user_metadata?.name || fallback.name,
      gender: user.user_metadata?.gender || fallback.gender
    });
  }

  async function saveProfile(row) {
    const { error } = await client.from('profiles').upsert(row, { onConflict: 'id' });
    if (error) throw error;
  }

  async function uploadPhoto(userId, file) {
    const ext = PHOTO_TYPES.get(file?.type);
    if (!ext) throw new Error('UNSUPPORTED_PHOTO_TYPE');
    if (file.size > 3_000_000) throw new Error('PHOTO_TOO_LARGE');
    try {
      const bitmap = await createImageBitmap(file);
      const tooLarge = bitmap.width > 4096 || bitmap.height > 4096;
      bitmap.close();
      if (tooLarge) throw new Error('PHOTO_DIMENSIONS_TOO_LARGE');
    } catch (error) {
      if (String(error?.message || '').startsWith('PHOTO_')) throw error;
      throw new Error('INVALID_PHOTO');
    }
    const path = `${userId}/profile.${ext}`;
    const { error } = await client.storage.from('profile-media').upload(path, file, {
      upsert: true,
      contentType: file.type,
      cacheControl: '3600'
    });
    if (error) throw error;
    const { data } = client.storage.from('profile-media').getPublicUrl(path);
    return `${data.publicUrl}?v=${Date.now()}`;
  }

  async function persistAvatar(userId, providerUrl, version) {
    const parsed = new URL(providerUrl);
    if (parsed.protocol !== 'https:') throw new Error('INVALID_AVATAR_URL');
    const response = await fetch(parsed.href, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) throw new Error('AVATAR_DOWNLOAD_FAILED');
    const sizeHeader = Number(response.headers.get('content-length') || 0);
    if (sizeHeader > 25_000_000) throw new Error('AVATAR_TOO_LARGE');
    const blob = await response.blob();
    if (!blob.size || blob.size > 25_000_000) throw new Error('AVATAR_TOO_LARGE');

    const safeVersion = Math.max(1, Number(version || 1));
    const path = `${userId}/avatar-v${safeVersion}.glb`;
    const { error } = await client.storage.from('avatar-models').upload(path, blob, {
      upsert: true,
      contentType: 'model/gltf-binary',
      cacheControl: '31536000'
    });
    if (error) throw error;
    const { data } = client.storage.from('avatar-models').getPublicUrl(path);
    return data.publicUrl;
  }

  async function requestPasswordReset(email) {
    const redirectTo = `${location.origin}${location.pathname}`;
    const { error } = await client.auth.resetPasswordForEmail(
      String(email || '').trim().toLowerCase(),
      { redirectTo }
    );
    if (error) throw error;
  }

  async function updatePassword(password) {
    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;
  }

  return {
    client,
    getSession,
    register,
    login,
    loadProfile,
    saveProfile,
    uploadPhoto,
    persistAvatar,
    requestPasswordReset,
    updatePassword,
    signOut: () => client.auth.signOut(),
    onAuthStateChange: (callback) => client.auth.onAuthStateChange(callback)
  };
}

export function authErrorMessage(error) {
  const text = String(error?.message || error || '').toLowerCase();
  if (text.includes('invalid login')) return 'Неверный email или пароль';
  if (text.includes('already') || text.includes('registered')) return 'Этот email уже зарегистрирован';
  if (text.includes('username') || text.includes('duplicate') || text.includes('unique')) return 'Такой логин уже занят';
  if (text.includes('password')) return 'Пароль должен содержать минимум 8 символов';
  if (text.includes('rate')) return 'Слишком много попыток. Попробуйте немного позже';
  if (text.includes('email')) return 'Проверьте адрес электронной почты';
  return 'Операция не выполнена. Проверьте подключение и попробуйте снова';
}
