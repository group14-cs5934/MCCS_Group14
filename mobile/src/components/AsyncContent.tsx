import type { ReactNode } from 'react';

import ErrorState from '@/components/ErrorState';
import Loader from '@/components/Loader';
import { sharedStyles } from '@/theme';

type Props = {
  children: ReactNode;
  /** Shows a spinner instead of the children. Wins over error, so a retry shows the spinner. */
  loading?: boolean;
  /** Error message to show instead of the children. */
  error?: string | null;
  /** Adds a Try Again button to the error. */
  onRetry?: () => void;
  /** Text under the spinner, e.g. "Loading product…". */
  loadingMessage?: string;
};

/**
 * Wraps a screen's content and handles its loading and error states: a centered spinner while
 * loading, a full-screen error with Try Again if loading failed, otherwise the children.
 * Fills its parent, so put it in a View with flex: 1 (e.g. sharedStyles.screen).
 */
export default function AsyncContent({
  children,
  loading = false,
  error,
  onRetry,
  loadingMessage,
}: Props) {
  if (loading) {
    return <Loader message={loadingMessage} style={sharedStyles.centered} />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={onRetry} style={sharedStyles.centered} />;
  }

  return children;
}
