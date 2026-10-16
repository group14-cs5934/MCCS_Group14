/** Supabase's default minimum (Auth -> Providers -> Email). Keep the two in sync. */
export const MIN_PASSWORD_LENGTH = 6;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Per-field error messages for the sign-in and sign-up forms. Empty means valid. */
export type FieldErrors = { email?: string; password?: string; confirmPassword?: string };

function checkEmail(email: string): string | undefined {
  if (!email.trim()) return 'Enter your email.';
  if (!EMAIL_PATTERN.test(email.trim())) return 'Enter a valid email, like name@example.com.';
  return undefined;
}

export function validateSignIn(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  const emailError = checkEmail(email);
  if (emailError) errors.email = emailError;
  if (!password) errors.password = 'Enter your password.';
  return errors;
}

export function validateSignUp(
  email: string,
  password: string,
  confirmPassword: string,
): FieldErrors {
  const errors = validateSignIn(email, password);
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirmPassword) {
    errors.confirmPassword = "Passwords don't match.";
  }
  return errors;
}

export const hasErrors = (errors: FieldErrors) => Object.keys(errors).length > 0;
