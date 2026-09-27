import type { ReactNode } from 'react';

/**
 * The three states every list in this app must be able to show.
 *
 * Shipping only the happy path is how a UI ends up looking broken in the cases
 * that actually happen: a slow first request, a dropped connection, and a user
 * who simply has nothing yet. These components exist so "loading, failed, empty"
 * are not optional extras each screen has to remember, and so they look the same
 * everywhere.
 */

export const LoadingState = ({ label = 'Loading' }: { label?: string }) => (
  <div className="state" role="status" aria-live="polite">
    <span className="spinner" aria-hidden="true" />
    <p>{label}</p>
  </div>
);

export const ErrorState = ({
  title = 'Something went wrong',
  message,
  requestId,
  onRetry,
}: {
  title?: string;
  message: string;
  requestId?: string;
  onRetry?: () => void;
}) => (
  <div className="state state--error" role="alert">
    <h2>{title}</h2>
    {/* The correlation id is the one piece of internal detail a user may be
        shown: it is what makes a report matchable to a log line, and it exposes
        nothing about the server. */}
    <p>{message}</p>
    {requestId ? (
      <p className="state__meta">
        Reference: <code>{requestId}</code>
      </p>
    ) : null}
    {onRetry ? (
      <button type="button" className="button" onClick={onRetry}>
        Try again
      </button>
    ) : null}
  </div>
);

export const EmptyState = ({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) => (
  <div className="state state--empty">
    <h2>{title}</h2>
    <p>{description}</p>
    {action}
  </div>
);
