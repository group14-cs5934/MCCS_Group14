import type { Account } from '@/types/user';

import { api, type CallOptions } from './client';

/** GET /me: the signed-in user's account and role. The first call adds them as a 'user'. */
export function getMe(options?: CallOptions) {
  return api.get<Account>('/me', options);
}
