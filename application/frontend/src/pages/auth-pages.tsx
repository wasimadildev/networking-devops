import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../api/endpoints';
import { signIn } from '../auth/session-store';
import { TextInput } from '../components/form';
import { useFormErrors, type FormErrors } from '../hooks/use-form-errors';

/**
 * The failure to show above the form rather than under a field.
 *
 * A validation error that has a field gets rendered by that field, so repeating
 * it here would say the same thing twice. What is left is everything with no
 * field to attach to: a rejected password, a rate limit, an address already
 * registered, a dead network.
 */
const formLevelMessage = (errors: FormErrors): string | undefined => {
  if (!errors.hasError) return undefined;
  const hasFieldMessage = Object.keys(errors.messagesFor('email')).length > 0;
  return hasFieldMessage ? undefined : errors.formMessage;
};

/**
 * Login and registration.
 *
 * The two share a form-error contract but not a component: a shared one would
 * need a boolean prop and two `if` branches in every handler, and the fields
 * differ enough that the overlap is mostly the error plumbing, which is already
 * in `useFormErrors`.
 */
export const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const errors = useFormErrors();

  // Named `handle*` and invoked through a void-returning arrow, because React's
  // form handler type is `void`-returning: handing it an async function means a
  // rejection inside is nobody's responsibility. The explicit `void` says the
  // promise is handled (it is — in the catch below) rather than dropped.
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    errors.reset();
    errors.setSubmitting(true);
    try {
      const { data } = await authApi.login({ email, password });
      authApi.adopt(data);
      // The session store is the router's source of truth, so this is all a
      // successful login needs to do. Navigating explicitly would race the store
      // update and can land the user on a page the guard then bounces.
      signIn(data.user);
    } catch (error) {
      errors.setError(error);
      errors.setSubmitting(false);
    }
  };

  return (
    <main className="auth">
      <form className="card auth__form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <h1>Sign in to TaskFlow</h1>
        <TextInput
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={errors.messageFor('email')}
          required
        />
        <TextInput
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={errors.messageFor('password')}
          required
        />
        {/* Field-less failures: a 409 for an address already registered, a rate
            limit, or a network error. Field-level messages render under their
            own inputs, so this only carries what belongs to no input. */}
        {formLevelMessage(errors) ? (
          <p className="form__error" role="alert">
            {formLevelMessage(errors)}
          </p>
        ) : null}
        <button className="button button--primary" type="submit" disabled={errors.isSubmitting}>
          {errors.isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="auth__alt">
          No account? <Link to="/register">Create one</Link>
        </p>
      </form>
    </main>
  );
};

export const RegisterPage = () => {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const errors = useFormErrors();

  // Named `handle*` and invoked through a void-returning arrow, because React's
  // form handler type is `void`-returning: handing it an async function means a
  // rejection inside is nobody's responsibility. The explicit `void` says the
  // promise is handled (it is — in the catch below) rather than dropped.
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    errors.reset();
    errors.setSubmitting(true);
    try {
      const { data } = await authApi.register({ email, displayName, password });
      authApi.adopt(data);
      signIn(data.user);
    } catch (error) {
      errors.setError(error);
      errors.setSubmitting(false);
    }
  };

  return (
    <main className="auth">
      <form className="card auth__form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <h1>Create your account</h1>
        <TextInput
          label="Display name"
          value={displayName}
          onChange={setDisplayName}
          autoComplete="name"
          error={errors.messageFor('displayName')}
          required
        />
        <TextInput
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={errors.messageFor('email')}
          required
        />
        <TextInput
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={errors.messagesFor('password')[0]}
          hint="At least 12 characters, with an uppercase letter and a digit."
          required
        />
        {formLevelMessage(errors) ? (
          <p className="form__error" role="alert">
            {formLevelMessage(errors)}
          </p>
        ) : null}
        <button className="button button--primary" type="submit" disabled={errors.isSubmitting}>
          {errors.isSubmitting ? 'Creating account…' : 'Create account'}
        </button>
        <p className="auth__alt">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </main>
  );
};
