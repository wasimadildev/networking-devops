import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toApiError } from '../api/errors';
import type { Task, TaskPriority, TaskStatus } from '../api/types';
import { Select, TextArea, TextInput } from '../components/form';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useBoard, useMembers, useProject } from '../hooks/use-projects';
import { useCreateTask, useMoveTask } from '../hooks/use-tasks';
import { useFormErrors } from '../hooks/use-form-errors';

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To do' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'done', label: 'Done' },
];

/**
 * The project board.
 *
 * Moving a card is a button, not a drag gesture. Drag and drop is the obvious
 * affordance and the wrong first choice here: it has no keyboard equivalent, so
 * the feature is unavailable to a meaningful number of users, and a plain
 * `<select>` per card is also unusable by touch. A labelled "move to" control is
 * operable by everyone and costs less code than making a custom drag
 * implementation accessible.
 */
export const BoardPage = () => {
  const { projectId } = useParams();
  const project = useProject(projectId);
  const board = useBoard(projectId);
  const [addingTo, setAddingTo] = useState<TaskStatus | null>(null);

  if (board.isPending || project.isPending) return <LoadingState label="Loading board" />;

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

  if (board.isError) {
    const error = toApiError(board.error);
    return (
      <ErrorState
        message={error.message}
        requestId={error.requestId}
        onRetry={() => void board.refetch()}
      />
    );
  }

  const canEdit = project.data?.viewerRole !== 'viewer';
  const empty = COLUMNS.every((column) => (board.data?.[column.status] ?? []).length === 0);

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1>{project.data?.name}</h1>
          {project.data?.description ? <p className="page__lede">{project.data.description}</p> : null}
        </div>
        <Link className="button" to={`/projects/${projectId}/settings`}>
          Project settings
        </Link>
      </div>

      {empty ? (
        <EmptyState
          title="No tasks yet"
          description={
            canEdit
              ? 'Add the first task to this board.'
              : 'There is nothing here yet. Ask an editor to add a task.'
          }
        />
      ) : null}

      <div className="board">
        {COLUMNS.map((column) => {
          const tasks = board.data?.[column.status] ?? [];
          return (
            <section className="board__column" key={column.status} aria-labelledby={`column-${column.status}`}>
              <header className="board__column-header">
                <h2 id={`column-${column.status}`}>{column.label}</h2>
                <span className="board__count">{tasks.length}</span>
              </header>

              <ul className="board__cards">
                {tasks.map((task) => (
                  <TaskCard key={task.id} task={task} projectId={projectId} canEdit={canEdit} />
                ))}
              </ul>

              {canEdit ? (
                addingTo === column.status ? (
                  <NewTaskForm
                    projectId={projectId}
                    status={column.status}
                    onDone={() => setAddingTo(null)}
                  />
                ) : (
                  <button type="button" className="button button--ghost board__add" onClick={() => setAddingTo(column.status)}>
                    Add task
                  </button>
                )
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
};

const TaskCard = ({
  task,
  projectId,
  canEdit,
}: {
  task: Task;
  projectId: string | undefined;
  canEdit: boolean;
}) => {
  const move = useMoveTask(projectId);

  return (
    <li className="card card--task">
      <h3>
        <Link to={`/tasks/${task.id}`}>{task.title}</Link>
      </h3>
      {task.description ? <p className="task__description">{task.description}</p> : null}
      <div className="task__meta">
        <span className={`badge badge--${task.priority}`}>{task.priority}</span>
        {task.assigneeName ? <span className="task__assignee">{task.assigneeName}</span> : null}
        {task.commentCount > 0 ? (
          <span className="task__comments">
            {task.commentCount} {task.commentCount === 1 ? 'comment' : 'comments'}
          </span>
        ) : null}
      </div>
      {canEdit ? (
        <div className="task__move">
          <label className="visually-hidden" htmlFor={`move-${task.id}`}>
            Move {task.title} to another column
          </label>
          <select
            id={`move-${task.id}`}
            className="task__move-select"
            value={task.status}
            disabled={move.isPending}
            onChange={(event) => {
              const status = event.target.value as TaskStatus;
              // Moving to the end of the target column: the server orders by
              // position, and there is no client-side list to compute an index
              // from once the board is paginated.
              void move.mutateAsync({ taskId: task.id, status, position: 0 });
            }}
          >
            {COLUMNS.map((column) => (
              <option key={column.status} value={column.status}>
                {column.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </li>
  );
};

const NewTaskForm = ({
  projectId,
  status,
  onDone,
}: {
  projectId: string | undefined;
  status: TaskStatus;
  onDone: () => void;
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const createTask = useCreateTask(projectId);
  const members = useMembers(projectId);
  const errors = useFormErrors();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    errors.reset();
    errors.setSubmitting(true);
    try {
      await createTask.mutateAsync({
        // Created directly into the column whose "Add task" button was pressed.
        // Without this the card lands in To do, which contradicts what the user
        // just did — the server defaults `status` to todo when it is omitted.
        status,
        title,
        description: description || undefined,
        priority,
        assigneeId: assigneeId || null,
        // The API requires a datetime with an offset, and `datetime-local` gives
        // a bare local time with none. Converting here is what stops a due date
        // from being read as UTC midnight.
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      });
      onDone();
    } catch (error) {
      errors.setError(error);
      errors.setSubmitting(false);
    }
  };

  return (
    <form className="card form" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <TextInput label="Title" value={title} onChange={setTitle} error={errors.messageFor('title')} required />
      <TextArea
        label="Description"
        value={description}
        onChange={setDescription}
        error={errors.messageFor('description')}
        rows={3}
      />
      <Select
        label="Priority"
        value={priority}
        onChange={setPriority}
        error={errors.messageFor('priority')}
        options={[
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
          { value: 'urgent', label: 'Urgent' },
        ]}
      />
      <Select
        label="Assignee"
        value={assigneeId}
        onChange={setAssigneeId}
        error={errors.messageFor('assigneeId')}
        options={[
          { value: '', label: 'Unassigned' },
          ...(members.data ?? []).map((member) => ({ value: member.userId, label: member.displayName })),
        ]}
      />
      <TextInput
        label="Due date"
        type="datetime-local"
        value={dueAt}
        onChange={setDueAt}
        error={errors.messageFor('dueAt')}
      />
      {errors.hasError ? (
        <p className="form__error" role="alert">
          {errors.formMessage}
        </p>
      ) : null}
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={errors.isSubmitting}>
          {errors.isSubmitting ? 'Adding…' : 'Add task'}
        </button>
        <button type="button" className="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
};
