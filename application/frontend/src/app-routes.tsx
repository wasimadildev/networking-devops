import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './auth/session-store';
import { AppLayout } from './components/app-layout';
import { LoadingState } from './components/states';
import { LoginPage, RegisterPage } from './pages/auth-pages';
import { ProfilePage, SecurityPage } from './pages/account-pages';
import { BoardPage } from './pages/board-page';
import { ProjectSettingsPage } from './pages/project-settings-page';
import { ProjectsPage } from './pages/projects-page';
import { TaskPage } from './pages/task-page';

/**
 * The route table.
 *
 * The guard renders nothing while the session is restoring, rather than
 * redirecting. Redirecting during the restore would bounce a signed-in user to
 * /login on every page load — the tokens are still being exchanged when the first
 * render happens, and the guard cannot tell "not signed in" from "not yet known".
 */
const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const session = useSession();

  if (session.status === 'restoring') {
    return (
      <div className="boot">
        <LoadingState label="Starting TaskFlow" />
      </div>
    );
  }

  if (session.status === 'anonymous') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

/** Keeps a signed-in user off the login and register pages. */
const RedirectIfAuthed = ({ children }: { children: React.ReactNode }) => {
  const session = useSession();

  if (session.status === 'restoring') {
    return (
      <div className="boot">
        <LoadingState label="Starting TaskFlow" />
      </div>
    );
  }

  if (session.status === 'authenticated') {
    return <Navigate to="/projects" replace />;
  }

  return <>{children}</>;
};

export const AppRoutes = () => (
  <Routes>
    <Route
      path="/login"
      element={
        <RedirectIfAuthed>
          <LoginPage />
        </RedirectIfAuthed>
      }
    />
    <Route
      path="/register"
      element={
        <RedirectIfAuthed>
          <RegisterPage />
        </RedirectIfAuthed>
      }
    />

    <Route
      element={
        <RequireAuth>
          <AppLayout />
        </RequireAuth>
      }
    >
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/projects/:projectId" element={<BoardPage />} />
      <Route path="/projects/:projectId/settings" element={<ProjectSettingsPage />} />
      <Route path="/tasks/:taskId" element={<TaskPage />} />
      <Route path="/settings" element={<ProfilePage />} />
      <Route path="/settings/security" element={<SecurityPage />} />
    </Route>

    {/* A bare path is a redirect, not a 404: a bookmarked old URL should still
        land somewhere sensible. */}
    <Route path="/" element={<Navigate to="/projects" replace />} />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

const NotFound = () => (
  <div className="boot">
    <div className="card state">
      <h1>Page not found</h1>
      <p>That page does not exist.</p>
      <a className="button" href="/projects">
        Back to projects
      </a>
    </div>
  </div>
);
