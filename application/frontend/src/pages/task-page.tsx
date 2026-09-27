import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toApiError } from '../api/errors';
import type { Comment } from '../api/types';
import { TextArea } from '../components/form';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useProject } from '../hooks/use-projects';
import { useFormErrors } from '../hooks/use-form-errors';
import { useComments, useCreateComment, useDeleteComment, useTask, useUpdateComment } from '../hooks/use-tasks';
import { useSession } from '../auth/session-store';

/**
 * A task with its comment thread.
 *
 * The comment permissions are not cosmetic and are enforced again on the server:
 * a viewer may post, only the author may edit their own, and an editor may delete
 * anyone's. The buttons are hidden when the current user cannot use them, so the
 * UI never offers an action that would come back as a 403.
 */
export const TaskPage = () => {
  const { taskId } = useParams();
  const session = useSession();
  const task = useTask(taskId);
  const project = useProject(task.data?.projectId);
  const comments = useComments(taskId);
  const canComment = project.data?.viewerRole !== undefined;

  if (task.isPending) return <LoadingState label="Loading task" />;

  if (task.isError) {
    const error = toApiError(task.error);
    return (
      <ErrorState
        title={error.status === 404 ? 'Task not found' : 'Could not load the task'}
        message={error.message}
        requestId={error.requestId}
        onRetry={() => void task.refetch()}
      />
    );
  }

  const viewerRole = project.data?.viewerRole;
  const isEditor = viewerRole === 'owner' || viewerRole === 'editor';

  return (
    <div className="page">
      <div className="page__header">
        <div>
          {project.data ? (
            <p className="page__crumbs">
              <Link to={`/projects/${project.data.id}`}>{project.data.name}</Link>
            </p>
          ) : null}
          <h1>{task.data?.title}</h1>
        </div>
        <span className={`badge badge--${task.data?.priority}`}>{task.data?.priority}</span>
      </div>

      {task.data?.description ? <p className="task__body">{task.data.description}</p> : null}

      <dl className="meta">
        <div>
          <dt>Status</dt>
          <dd>{task.data?.status.replace('_', ' ')}</dd>
        </div>
        <div>
          <dt>Assignee</dt>
          <dd>{task.data?.assigneeName ?? 'Unassigned'}</dd>
        </div>
        <div>
          <dt>Created by</dt>
          <dd>{task.data?.createdByName}</dd>
        </div>
        {task.data?.dueAt ? (
          <div>
            <dt>Due</dt>
            <dd>{new Date(task.data.dueAt).toLocaleString()}</dd>
          </div>
        ) : null}
      </dl>

      <section className="comments" aria-labelledby="comments-heading">
        <h2 id="comments-heading">
          Comments{comments.data ? ` (${comments.data.length})` : ''}
        </h2>

        {comments.isPending ? <LoadingState label="Loading comments" /> : null}
        {comments.isError ? <ErrorState message={toApiError(comments.error).message} /> : null}
        {comments.isSuccess && comments.data.length === 0 ? (
          <EmptyState title="No comments yet" description="Start the discussion below." />
        ) : null}
        {comments.isSuccess && comments.data.length > 0 ? (
          <ul className="comments__list">
            {comments.data.map((comment) => (
              <CommentRow
                key={comment.id}
                comment={comment}
                currentUserId={session.user?.id}
                isEditor={isEditor}
              />
            ))}
          </ul>
        ) : null}

        {canComment ? <CommentForm taskId={taskId} projectId={task.data?.projectId} /> : (
          <p className="muted">You need to be a project member to comment.</p>
        )}
      </section>
    </div>
  );
};

const CommentRow = ({
  comment,
  currentUserId,
  isEditor,
}: {
  comment: Comment;
  currentUserId: string | undefined;
  isEditor: boolean;
}) => {
  const [editing, setEditing] = useState(false);
  const remove = useDeleteComment(comment.taskId);
  const isAuthor = comment.authorId === currentUserId;

  return (
    <li className="comments__item">
      <header className="comments__meta">
        <strong>{comment.authorName}</strong>
        <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
      </header>
      {editing ? <EditCommentForm comment={comment} onDone={() => setEditing(false)} /> : <p>{comment.body}</p>}
      {isAuthor || isEditor ? (
        <div className="comments__actions">
          {isAuthor ? (
            <button type="button" className="button button--ghost" onClick={() => setEditing((value) => !value)}>
              {editing ? 'Cancel' : 'Edit'}
            </button>
          ) : null}
          <button
            type="button"
            className="button button--ghost"
            disabled={remove.isPending}
            onClick={() => void remove.mutateAsync(comment.id)}
          >
            Delete
          </button>
        </div>
      ) : null}
    </li>
  );
};

const CommentForm = ({
  taskId,
  projectId,
}: {
  taskId: string | undefined;
  projectId: string | undefined;
}) => {
  const [body, setBody] = useState('');
  const create = useCreateComment(projectId);
  const errors = useFormErrors();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    errors.reset();
    errors.setSubmitting(true);
    try {
      await create.mutateAsync({ taskId: taskId as string, body });
      setBody('');
      errors.setSubmitting(false);
    } catch (error) {
      errors.setError(error);
      errors.setSubmitting(false);
    }
  };

  return (
    <form className="form" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <TextArea
        label="Add a comment"
        value={body}
        onChange={setBody}
        error={errors.messageFor('body')}
        rows={3}
      />
      <button type="submit" className="button button--primary" disabled={errors.isSubmitting}>
        {errors.isSubmitting ? 'Posting…' : 'Post comment'}
      </button>
    </form>
  );
};

const EditCommentForm = ({ comment, onDone }: { comment: Comment; onDone: () => void }) => {
  const [body, setBody] = useState(comment.body);
  const update = useUpdateComment(comment.taskId);
  const errors = useFormErrors();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    errors.reset();
    errors.setSubmitting(true);
    try {
      await update.mutateAsync({ commentId: comment.id, body });
      onDone();
    } catch (error) {
      errors.setError(error);
      errors.setSubmitting(false);
    }
  };

  return (
    <form className="form" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <TextArea label="Edit comment" value={body} onChange={setBody} error={errors.messageFor('body')} rows={3} />
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={errors.isSubmitting}>
          Save
        </button>
        <button type="button" className="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
};
