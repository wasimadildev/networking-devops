import { useCallback, useState } from 'react';
import { ApiError, toApiError } from '../api/errors';

/**
 * Per-field error state for a form.
 *
 * A form needs three things from a failed submit, and a raw `ApiError` provides
 * none of them directly: the messages keyed by field so they can sit next to the
 * right input, the single message for failures that belong to no field, and a
 * way to clear the lot when the user starts fixing things.
 *
 * Kept as a hook rather than a helper function so the messages survive re-renders
 * — a failed submit has to keep showing why it failed, not flicker away on the
 * next keystroke.
 */
export interface FormErrors {
  /** All messages for one field, for rendering a list under an input. */
  messagesFor: (field: string) => string[];
  /** The first message for a field, used for the input's error text. */
  messageFor: (field: string) => string | undefined;
  /** A message for the form as a whole: a 409, a 403, or an unmapped issue. */
  formMessage: string | undefined;
  /** True when the submit failed, whether or not the cause was a field. */
  hasError: boolean;
  /** True while a submit is in flight. */
  isSubmitting: boolean;
  setSubmitting: (value: boolean) => void;
  /** Records a failure, splitting it into field messages and a form message. */
  setError: (error: unknown) => void;
  clear: () => void;
  /** Call at the top of `submit`: a retry should not show the previous error. */
  reset: () => void;
}

export const useFormErrors = (): FormErrors => {
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const setError = useCallback((error: unknown) => {
    setApiError(toApiError(error));
  }, []);

  const clear = useCallback(() => setApiError(null), []);

  const reset = useCallback(() => {
    setApiError(null);
    setSubmitting(false);
  }, []);

  return {
    messagesFor: (field) => apiError?.fieldErrors[field] ?? [],
    messageFor: (field) => apiError?.messageFor(field),
    formMessage: apiError ? apiError.formMessage : undefined,
    hasError: apiError !== null,
    isSubmitting,
    setSubmitting,
    setError,
    clear,
    reset,
  };
};
