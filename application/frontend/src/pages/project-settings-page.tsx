import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toApiError } from '../api/errors';
import type { ActivityEntry, ProjectMember, ProjectMemberRole } from '../api/types';
import { Select, TextInput } from '../components/form';
import { ErrorState, LoadingState } from '../components/states';
import { useFormErrors } from '../hooks/use-form-errors';
import {
  useActivity,
  useAddMember,
  useArchiveProject,
  useChangeMemberRole,
  useMembers,
  useProject,
  useRemoveMember,
  useUpdateProject,
} from '../hooks/use-projects';

/**
 * Project settings: the member list and the activity log.
 *
 * The three sections are independent queries, so each carries its own loading and
 * error state. Folding them into one `isPending` would blank the whole page
 * because the activity log was slow, which is exactly the kind of coupling that
 * makes a settings page feel broken.
 */
export const ProjectSettingsPage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const project = useProject(projectId);
  const members = useMembers(projectId);
  const activity = useActivity(projectId);
  const removeMember = useRemoveMember(projectId);

  if (project.isPending) return <LoadingState label="Loading project" />;

  if (project.isError) {
    const error = toApiError(project.error);
    return (
      <ErrorState
        title={error.status === 404 ? 'Project not found' : 'Could not load the project'}
        message={error.message}
        requestId={error.requestId}
        onRetry={() => void project.refetch()}
      />
    );
  }

  const isOwner = project.data?.viewerRole === 'owner';
  const currentUserId = project.data?.ownerId;

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <p className="page__crumbs">
            <Link to={`/projects/${projectId}`}>{project.data?.name}</Link>
          </p>
          <h1>Project settings</h1>
        </div>
      </div>

      <section className="panel" aria-labelledby="details-heading">
        <h2 id="details-heading">Details</h2>
        <ProjectDetailsForm
          projectId={projectId}
          name={project.data?.name ?? ''}
          description={project.data?.description ?? ''}
          status={project.data?.status ?? 'active'}
          canEdit={isOwner}
        />
      </section>

      <section className="panel" aria-labelledby="members-heading">
        <h2 id="members-heading">Members</h2>
        {isOwner ? <AddMemberForm projectId={projectId} /> : null}
        {members.isPending ? <LoadingState label="Loading members" /> : null}
        {members.isError ? <ErrorState message={toApiError(members.error).message} /> : null}
        {members.isSuccess ? (
          <ul className="members">
            {members.data.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                projectId={projectId}
                canManage={isOwner}
                isSelf={member.userId === currentUserId}
                onRemove={() => void removeMember.mutateAsync(member.userId)}
                isRemoving={removeMember.isPending}
              />
            ))}
          </ul>
        ) : null}
      </section>

      <section className="panel" aria-labelledby="activity-heading">
        <h2 id="activity-heading">Activity</h2>
        {activity.isPending ? <LoadingState label="Loading activity" /> : null}
        {activity.isError ? <ErrorState message={toApiError(activity.error).message} /> : null}
        {activity.isSuccess ? <ActivityFeed entries={activity.data} /> : null}
      </section>

      {isOwner && project.data?.status === 'active' ? (
        <ArchiveControl
          projectId={projectId}
          onArchived={() => {
            // React Router 7 returns a promise from navigate. Nothing waits on the
            // transition here, so it is discarded explicitly rather than left
            // floating.
            void navigate('/projects');
          }}
        />
      ) : null}
    </div>
  );
};

/**
 * Archiving is destructive and hides the project from the default list, so it is
 * confirmed rather than done on a single click.
 */
const ArchiveControl = ({
  projectId,
  onArchived,
}: {
  projectId: string | undefined;
  onArchived: () => void;
}) => {
  const archive = useArchiveProject(projectId);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" className="button button--danger" onClick={() => setConfirming(true)}>
        Archive project
      </button>
    );
  }

  return (
    <div className="confirm" role="group" aria-label="Confirm archiving this project">
      <p>Archive this project? It becomes read-only and leaves the default list. You can restore it later.</p>
      <div className="form__actions">
        <button
          type="button"
          className="button button--danger"
          disabled={archive.isPending}
          onClick={() => {
            void archive.mutateAsync().then(onArchived);
          }}
        >
          {archive.isPending ? 'Archiving…' : 'Yes, archive it'}
        </button>
        <button type="button" className="button" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
};

const ProjectDetailsForm = ({
  projectId,
  name,
  description,
  status,
  canEdit,
}: {
  projectId: string | undefined;
  name: string;
  description: string;
  status: 'active' | 'archived';
  canEdit: boolean;
}) => {
  const [draftName, setDraftName] = useState(name);
  const [draftDescription, setDraftDescription] = useState(description);
  const update = useUpdateProject(projectId);
  const errors = useFormErrors();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    errors.reset();
    errors.setSubmitting(true);
    try {
      await update.mutateAsync({ name: draftName, description: draftDescription, status });
      errors.setSubmitting(false);
    } catch (error) {
      errors.setError(error);
      errors.setSubmitting(false);
    }
  };

  if (!canEdit) {
    return (
      <dl className="meta">
        <div>
          <dt>Name</dt>
          <dd>{name}</dd>
        </div>
        <div>
          <dt>Description</dt>
          <dd>{description || '—'}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{status}</dd>
        </div>
      </dl>
    );
  }

  return (
    <form className="form" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <TextInput label="Name" value={draftName} onChange={setDraftName} error={errors.messageFor('name')} />
      <TextInput
        label="Description"
        value={draftDescription}
        onChange={setDraftDescription}
        error={errors.messageFor('description')}
      />
      <button type="submit" className="button button--primary" disabled={errors.isSubmitting}>
        {errors.isSubmitting ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
};

const AddMemberForm = ({ projectId }: { projectId: string | undefined }) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<ProjectMemberRole, 'owner'>>('viewer');
  const addMember = useAddMember(projectId);
  const errors = useFormErrors();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    errors.reset();
    errors.setSubmitting(true);
    try {
      await addMember.mutateAsync({ email, role });
      setEmail('');
      errors.setSubmitting(false);
    } catch (error) {
      errors.setError(error);
      errors.setSubmitting(false);
    }
  };

  return (
    <form className="form form--inline" onSubmit={(event) => void handleSubmit(event)} noValidate>
      {/* An email field, not a user picker. The server resolves the address, so
          the app never needs a directory of accounts to search — which is the
          reason the API has no such endpoint. */}
      <TextInput
        label="Add a member by email"
        type="email"
        inputMode="email"
        value={email}
        onChange={setEmail}
        error={errors.messageFor('email')}
        hint="They need an existing TaskFlow account."
      />
      <Select
        label="Role"
        value={role}
        onChange={setRole}
        options={[
          { value: 'viewer', label: 'Viewer' },
          { value: 'editor', label: 'Editor' },
        ]}
      />
      <button type="submit" className="button button--primary" disabled={errors.isSubmitting}>
        {errors.isSubmitting ? 'Adding…' : 'Add member'}
      </button>
      {/* A duplicate add is a 409, and a wrong address a 404. Neither is a field
          problem, so both land here. */}
      {errors.formMessage && !errors.messageFor('email') ? (
        <p className="form__error" role="alert">
          {errors.formMessage}
        </p>
      ) : null}
    </form>
  );
};

const MemberRow = ({
  member,
  projectId,
  canManage,
  isSelf,
  onRemove,
  isRemoving,
}: {
  member: ProjectMember;
  projectId: string | undefined;
  canManage: boolean;
  isSelf: boolean;
  onRemove: () => void;
  isRemoving: boolean;
}) => {
  const changeRole = useChangeMemberRole(projectId);
  const isOwnerRow = member.role === 'owner';

  return (
    <li className="members__row">
      <div>
        <strong>{member.displayName}</strong>
        <span className="muted"> {member.email}</span>
      </div>
      {isOwnerRow ? (
        // An owner's role is not a select. Ownership transfers, and the transfer
        // is a different action with different rules, so offering "editor" in a
        // dropdown would produce a request the server must reject.
        <span className="badge">Owner</span>
      ) : canManage ? (
        <>
          <label className="visually-hidden" htmlFor={`role-${member.userId}`}>
            Role for {member.displayName}
          </label>
          <select
            id={`role-${member.userId}`}
            value={member.role}
            disabled={changeRole.isPending}
            onChange={(event) => {
              void changeRole.mutateAsync({
                userId: member.userId,
                role: event.target.value as Exclude<ProjectMemberRole, 'owner'>,
              });
            }}
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
          </select>
          {isSelf ? (
            // The server rejects this with 422: a project must always have an
            // owner, so an owner leaves by transferring ownership, not by
            // removing themselves. A button that can only fail is worse than none.
            <span className="muted">Transfer ownership to leave</span>
          ) : (
            <button type="button" className="button button--ghost" disabled={isRemoving} onClick={onRemove}>
              Remove
            </button>
          )}
        </>
      ) : (
        <span className="badge">{member.role}</span>
      )}
    </li>
  );
};

const ActivityFeed = ({ entries }: { entries: ActivityEntry[] }) => {
  if (entries.length === 0) return <p className="muted">Nothing has happened yet.</p>;

  return (
    <ol className="activity">
      {entries.map((entry) => (
        <li key={entry.id}>
          <strong>{entry.actorName}</strong> {describe(entry)}
          <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
        </li>
      ))}
    </ol>
  );
};

/** Turns an activity row into a sentence, so the feed is not a list of codes. */
const describe = (entry: ActivityEntry): string => {
  const verb: Record<ActivityEntry['action'], string> = {
    'project.created': 'created the project',
    'project.updated': 'updated the project',
    'project.archived': 'archived the project',
    'project.member_added': 'added a member',
    'project.member_role_changed': 'changed a member role',
    'project.member_removed': 'removed a member',
    'task.created': 'created a task',
    'task.updated': 'updated a task',
    'task.moved': 'moved a task',
    'task.deleted': 'deleted a task',
    'task.assigned': 'assigned a task',
    'comment.created': 'commented',
    'comment.updated': 'edited a comment',
    'comment.deleted': 'deleted a comment',
  };
  return verb[entry.action];
};
