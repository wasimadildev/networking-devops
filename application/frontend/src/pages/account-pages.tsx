import { useState, type FormEvent } from 'react';
import { authApi, passwordApi, userApi } from '../api/endpoints';
import { toApiError } from '../api/errors';
import { signOut, useSession } from '../auth/session-store';
import { TextInput } from '../components/form';
import { ErrorState, LoadingState } from '../components/states';
import { useFormErrors } from '../hooks/use-form-errors';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/query-keys';

/** Profile: the display name, and the account's own email as read-only. */
export const ProfilePage = () => {
  const session = useSession();
  const client = useQueryClient();
  const me = useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => userApi.me(signal).then((result) => result.data),
  });
  const [displayName, setDisplayName] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (name: string) => userApi.updateProfile({ displayName: name }),
    onSuccess: (result) => {
      // The session holds a copy of the user too. Refetching /users/me alone
      // would leave the header showing the old name until the next full reload.
      client.setQueryData(queryKeys.me, result.data);
      void client.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
  const errors = useFormErrors();

  if (me.isPending) return <LoadingState label="Loading profile" />;
  if (me.isError) return <ErrorState message={toApiError(me.error).message} />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    errors.reset();
    errors.setSubmitting(true);
    try {
      await update.mutateAsync(displayName ?? me.data.displayName);
      errors.setSubmitting(false);
    } catch (error) {
      errors.setError(error);
      errors.setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <h1>Profile</h1>
      <form className="card form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <TextInput
          label="Display name"
          value={displayName ?? me.data.displayName}
          onChange={setDisplayName}
          error={errors.messageFor('displayName')}
          autoComplete="name"
        />
        <TextInput label="Email" value={me.data.email} onChange={() => undefined} disabled hint="Your sign-in address cannot be changed here." />
        <button type="submit" className="button button--primary" disabled={errors.isSubmitting}>
          {errors.isSubmitting ? 'Saving…' : 'Save profile'}
        </button>
      </form>
      <p className="muted">Signed in as {session.user?.email}</p>
    </div>
  );
};

/**
 * Security: change the password, and sign out everywhere else.
 *
 * Changing a password revokes the other sessions, and the response says how many
 * — reported here because "your other devices have been signed out" is the whole
 * reason someone does this, and silence leaves them unsure it worked.
 */
export const SecurityPage = () => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [revoked, setRevoked] = useState<number | null>(null);
  const [everywhere, setEverywhere] = useState(false);
  const change = useMutation({
    mutationFn: () => passwordApi.change({ currentPassword, newPassword }),
    onSuccess: (result) => {
      setRevoked(result.data.sessionsRevoked);
      setCurrentPassword('');
      setNewPassword('');
    },
  });
  const logoutAll = useMutation({ mutationFn: () => authApi.logoutAll() });
  const errors = useFormErrors();

  const handleChange = async (event: FormEvent) => {
    event.preventDefault();
    errors.reset();
    setRevoked(null);
    errors.setSubmitting(true);
    try {
      await change.mutateAsync();
      errors.setSubmitting(false);
    } catch (error) {
      errors.setError(error);
      errors.setSubmitting(false);
    }
  };

  const handleLogoutAll = async () => {
    await logoutAll.mutateAsync();
    // The server revoked this session too, so the store must be told. Without
    // this the app would render as signed in with tokens that are already dead,
    // and every subsequent request would 401.
    signOut();
    setEverywhere(true);
  };

  return (
    <div className="page">
      <h1>Security</h1>

      <section className="panel" aria-labelledby="password-heading">
        <h2 id="password-heading">Change password</h2>
        <form className="form" onSubmit={(event) => void handleChange(event)} noValidate>
          <TextInput
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={setCurrentPassword}
            error={errors.messageFor('currentPassword')}
          />
          <TextInput
            label="New password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={setNewPassword}
            error={errors.messagesFor('newPassword')[0]}
            hint="At least 12 characters, with an uppercase letter and a digit."
          />
          <button type="submit" className="button button--primary" disabled={errors.isSubmitting}>
            {errors.isSubmitting ? 'Changing…' : 'Change password'}
          </button>
        </form>
        {revoked !== null ? (
          <p className="notice" role="status">
            Password changed. Signed out of {revoked} other {revoked === 1 ? 'session' : 'sessions'}.
          </p>
        ) : null}
      </section>

      <section className="panel" aria-labelledby="sessions-heading">
        <h2 id="sessions-heading">Sessions</h2>
        <p className="muted">
          Signs out every device, including this one. You will be returned to the sign-in page.
        </p>
        <button type="button" className="button button--danger" disabled={logoutAll.isPending} onClick={() => void handleLogoutAll()}>
          {logoutAll.isPending ? 'Signing out…' : 'Sign out everywhere'}
        </button>
        {everywhere ? (
          <p className="notice" role="status">
            Every session has been revoked.
          </p>
        ) : null}
      </section>
    </div>
  );
};
