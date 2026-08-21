module.exports = function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  const avaturnSubdomain = process.env.AVATURN_SUBDOMAIN || 'demo';
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ supabaseUrl, supabaseAnonKey, avaturnSubdomain });
};
