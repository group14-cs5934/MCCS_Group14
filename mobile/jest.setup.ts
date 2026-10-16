// Runs before every test file. Supabase config for tests; the client itself is replaced by
// __mocks__/@supabase/supabase-js.ts, so nothing ever reaches a real project.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_KEY = 'test-publishable-key';

// AuthProvider calls GET /me whenever someone is signed in. Stub it so screen tests that count
// fetch calls only see their own requests. Every user is a 'user' unless a test says otherwise
// (see auth.test.tsx); api-client.test.ts tests the real getMe.
jest.mock('@/api/me', () => ({
  getMe: jest.fn(async () => ({
    ok: true,
    status: 200,
    data: { id: 'user-1', email: 'shopper@example.com', role: 'user' },
  })),
}));
