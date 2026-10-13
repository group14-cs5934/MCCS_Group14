import { isAuthError } from '@supabase/supabase-js';

const messages: Record<string, string> = {
  invalid_credentials: "That email and password don't match. Please try again.",
  email_not_confirmed: 'Please confirm your email first. Check your inbox for the link.',
  user_already_exists: 'An account with this email already exists. Try signing in.',
  email_exists: 'An account with this email already exists. Try signing in.',
  weak_password: 'That password is too weak. Try a longer one.',
  over_email_send_rate_limit: 'Too many emails sent. Please wait a few minutes and try again.',
  over_request_rate_limit: 'Too many attempts. Please wait a moment and try again.',
};

/** Friendly text for a Supabase auth error, safe to show the user. */
export function authErrorMessage(error: unknown): string {
  if (isAuthError(error)) {
    if (error.name === 'AuthRetryableFetchError') {
      return "Can't reach the server. Check your internet connection and try again.";
    }
    if (error.code && error.code in messages) {
      return messages[error.code];
    }
  }
  return 'Something went wrong. Please try again.';
}
