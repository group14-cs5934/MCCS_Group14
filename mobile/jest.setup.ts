// Runs before every test file. Supabase config for tests; the client itself is replaced by
// __mocks__/@supabase/supabase-js.ts, so nothing ever reaches a real project.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_KEY = 'test-publishable-key';
