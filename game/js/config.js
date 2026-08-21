// ===== Multiplayer / Cloud config =====
// 1) Создай бесплатный проект на https://supabase.com
// 2) SQL из файла SUPABASE.sql выполни в SQL Editor
// 3) Вставь URL и anon key ниже
// Public browser credentials only. Never put a service-role key here.
// Values are read from the server environment in production. A static host can
// inject the same public values through window.LIFE_IN_GAME_CONFIG.
let runtime = globalThis.LIFE_IN_GAME_CONFIG || {};
if (!runtime.supabaseUrl || !runtime.supabaseAnonKey) {
  try {
    const response = await fetch('/api/runtime-config', { cache: 'no-store' });
    if (response.ok) runtime = { ...runtime, ...(await response.json()) };
  } catch {
    // Static hosting is supported through LIFE_IN_GAME_CONFIG.
  }
}
export const SUPABASE_URL = runtime.supabaseUrl || '';
export const SUPABASE_ANON_KEY = runtime.supabaseAnonKey || '';

// Avaturn: 'demo' for testing, or your subdomain from developer.avaturn.me
export const AVATURN_SUBDOMAIN = runtime.avaturnSubdomain || 'demo';

export function isCloudEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
