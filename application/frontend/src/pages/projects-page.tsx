import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toApiError } from '../api/errors';
import type { Project } from '../api/types';
import { TextArea, TextInput } from '../components/form';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useCreateProject, useProjects } from '../hooks/use-projects';
import { useFormErrors } from '../hooks/use-form-errors';

/**
 * The project list, plus the create form.
 *
 * Every one of the three states is rendered explicitly. A list that only handles
 * success looks fine until the API is unreachable, at which point it shows an
 * empty page — indistinguishable from "you have no projects", which sends the
 * user off to create a duplicate.
 */
export const ProjectsPage = () => {
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [showForm, setShowForm] = useState(false);
  const projects = useProjects({ status });

  return (
    <div className="page">
      <div className="page__header">
        <h1>{status === 'active' ? 'Projects' : 'Archived projects'}</h1>
        <div className="page__actions">
          {/* A toggle rather than a select: two mutually exclusive views, and a
              tablist is what a screen reader should hear. */}
          <div role="group" aria-label="Filter projects by status">
            <button
              type="button"
              className={`button${status === 'active' ? ' button--primary' : ''}`}
              aria-pressed={status === 'active'}
              onClick={() => setStatus('active')}
            >
              Active
            </button>
            <button
              type="button"
              className={`button${status === 'archived' ? ' button--primary' : ''}`}
              aria-pressed={status === 'archived'}
              onClick={() => setStatus('archived')}
            >
              Archived
            </button>
          </div>
          <button
            type="button"
            className="button button--primary"
            aria-expanded={showForm}
            onClick={() => setShowForm((open) => !open)}
          >
            New project
          </button>
        </div>
      </div>

      {showForm ? <CreateProjectForm onDone={() => setShowForm(false)} /> : null}

      {projects.isPending ? <LoadingState label="Loading projects" /> : null}

      {projects.isError ? (
        <ErrorState
          message={toApiError(projects.error).message}
          requestId={toApiError(projects.error).requestId}
          onRetry={() => void projects.refetch()}
        />
      ) : null}

      {projects.isSuccess && projects.data.length === 0 ? (
        <EmptyState
          title={status === 'active' ? 'No projects yet' : 'Nothing archived'}
          description={
            status === 'active'
              ? 'Create a project to start tracking work. You will be its owner.'
              : 'Archived projects stay here and can be restored at any time.'
          }
        />
      ) : null}

      {projects.isSuccess && projects.data.length > 0 ? (
        <ul className="cards">
          {projects.data.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </ul>
      ) : null}
    </div>
  );
};

const ProjectCard = ({ project }: { project: Project }) => (
  <li className="card card--project">
    <h2>
      {/* The whole card is not a link: nesting a link over the whole card makes
          its accessible name the entire card, so a screen reader announces the
          description and counts as part of the link text. */}
      <Link to={`/projects/${project.id}`}>{project.name}</Link>
    </h2>
    {project.description ? <p>{project.description}</p> : null}
    <dl className="meta">
      <div>
        <dt>Your role</dt>
        <dd>{project.viewerRole}</dd>
      </div>
      <div>
        <dt>Members</dt>
        <dd>{project.memberCount}</dd>
      </div>
      <div>
        <dt>Open tasks</dt>
        <dd>
          {project.openTaskCount}
          <span className="meta__muted"> of {project.taskCount}</span>
        </dd>
      </div>
    </dl>
  </li>
);

/**
 * The slug is derived from the name as the user types, but stays editable.
 *
 * Auto-generating it is a convenience; hiding it would be wrong, because the slug
 * is part of the project's identity and appears in its URL. An owner who
 * renames a project should be able to see and change the slug they are about to
 * commit.
 */
const CreateProjectForm = ({ onDone }: { onDone: () => void }) => {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const createProject = useCreateProject();
  const errors = useFormErrors();

  const onNameChange = (value: string) => {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    errors.reset();
    errors.setSubmitting(true);
    try {
      await createProject.mutateAsync({ name, slug, description: description || undefined });
      onDone();
    } catch (error) {
      errors.setError(error);
      errors.setSubmitting(false);
    }
  };

  return (
    <form className="card form" onSubmit={(event) => void handleSubmit(event)} noValidate>
      <h2>New project</h2>
      <TextInput
        label="Name"
        value={name}
        onChange={onNameChange}
        error={errors.messageFor('name')}
        required
      />
      <TextInput
        label="Slug"
        value={slug}
        onChange={(value) => {
          setSlugTouched(true);
          setSlug(value);
        }}
        error={errors.messageFor('slug')}
        hint="Lowercase letters, numbers and hyphens. Used in the project URL."
        required
      />
      <TextArea
        label="Description"
        value={description}
        onChange={setDescription}
        error={errors.messageFor('description')}
      />
      {errors.hasError ? (
        <p className="form__error" role="alert">
          {errors.formMessage}
        </p>
      ) : null}
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={errors.isSubmitting}>
          {errors.isSubmitting ? 'Creating…' : 'Create project'}
        </button>
        <button type="button" className="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
};

/**
 * Lowercase, hyphenated, trimmed. A best-effort suggestion only — the server's
 * slug pattern is the authority, and its rejection is shown on the field.
 */
const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
