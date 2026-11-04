import type { ApiError } from '@/api';

/**
 * Called with the API's code when it says the user lost access to part of My store (403
 * missing_permission, not_your_store or forbidden), so the screen can load their role again and
 * hide what they lost.
 */
export type OnDenied = (code?: string) => void;

/**
 * Whether a 403 means the user's access changed. beyond_your_permissions isn't that: it's about
 * the role or person they tried to change, and its message is for them.
 */
export function isAccessLost(error: ApiError): boolean {
  return error.status === 403 && error.code !== 'beyond_your_permissions';
}

/**
 * What to show when a change is refused: the API's own message for conflicts (role_name_taken,
 * role_in_use, user_not_found...) and beyond_your_permissions, which are written for the person
 * making the change; otherwise `fallback` plus the generic message.
 */
export function changeError(error: ApiError, fallback: string): string {
  if (
    error.serverMessage &&
    (error.status === 409 || error.status === 404 || error.status === 403)
  ) {
    return error.serverMessage;
  }
  return `${fallback} ${error.message}`;
}
