/** Supabase project settings from mobile/.env. Throws a readable error if they're missing. */
export function getSupabaseConfig(): { url: string; key: string } {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.EXPO_PUBLIC_SUPABASE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      'Supabase is not configured: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY in ' +
        'mobile/.env (see .env.example), then restart npm start.',
    );
  }
  return { url: url.replace(/\/+$/, ''), key };
}
