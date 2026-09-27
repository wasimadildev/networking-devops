import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './app-routes';
import { ApiError } from './api/errors';
import { restoreSession } from './auth/session-store';
import './index.css';

/**
 * The query client.
 *
 * `retry` is a function rather than a number because the useful answer depends on
 * what failed. A 422 will fail identically forever, so retrying it only delays
 * the error the user needs to see; a 503 or a dropped connection is worth another
 * try. `ApiError.isRetryable` encodes that distinction once, in the error type.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && !error.isRetryable) return false;
        return failureCount < 2;
      },
      // Exponential-ish backoff: 1s, then 2s. Long enough not to hammer a
      // struggling API, short enough that the user is not staring at a spinner.
      retryDelay: (attempt) => 1000 * 2 ** attempt,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Never retried. A mutation is a write, and repeating one the user did not
      // intend — sending an invite, deleting a task — is worse than showing an
      // error they can act on.
      retry: false,
    },
  },
});

// Started before the first render, and deliberately not awaited. The route guard
// renders a "starting" state until the store reports a decision, so blocking here
// would only delay the first paint without changing what is shown.
void restoreSession();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
