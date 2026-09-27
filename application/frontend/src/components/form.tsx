import { useId, type ReactNode } from 'react';

/**
 * Labelled form controls.
 *
 * Every input here is wired to a `<label>` by id and its errors are linked with
 * `aria-describedby`, `aria-invalid` and `role="alert"`. That is not decoration:
 * an unlabelled input is unusable with a screen reader, and an error message the
 * reader cannot associate with its field is not announced at all. Generating the
 * ids with `useId` keeps two instances of the same field from colliding.
 */

export const Field = ({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: (props: {
    id: string;
    'aria-invalid': boolean | undefined;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}) => {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`field${error ? ' field--invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
};

export const TextInput = ({
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  autoComplete,
  required,
  disabled,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: string;
  type?: 'text' | 'email' | 'password' | 'date' | 'datetime-local';
  autoComplete?: string;
  required?: boolean;
  disabled?: boolean;
  inputMode?: 'text' | 'email' | 'numeric';
}) => (
  <Field label={label} error={error} hint={hint}>
    {(aria) => (
      <input
        {...aria}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        inputMode={inputMode}
      />
    )}
  </Field>
);

export const TextArea = ({
  label,
  value,
  onChange,
  error,
  hint,
  rows = 4,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: string;
  rows?: number;
  disabled?: boolean;
}) => (
  <Field label={label} error={error} hint={hint}>
    {(aria) => (
      <textarea
        {...aria}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    )}
  </Field>
);

export const Select = <T extends string>({
  label,
  value,
  options,
  onChange,
  error,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  error?: string | undefined;
  disabled?: boolean;
}) => (
  <Field label={label} error={error}>
    {(aria) => (
      <select {...aria} value={value} onChange={(event) => onChange(event.target.value as T)} disabled={disabled}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )}
  </Field>
);
