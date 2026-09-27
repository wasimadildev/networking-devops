import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { authApi } from '../api/endpoints';
import { signOut, useSession } from '../auth/session-store';

/**
 * The signed-in shell: header, project switcher, and the routed page.
 *
 * `useState` here is for "is the menu open" — UI state, not server state. The
 * session comes from the store and the projects from TanStack Query, so nothing
 * in this file fetches.
 */
export const AppLayout = () => {
  const session = useSession();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const onSignOut = async () => {
    setMenuOpen(false);
    await authApi.logout();
    signOut();
    // Replaced rather than pushed: signing out should not leave the app's
    // history behind, so the browser Back button cannot return to a page whose
    // every query now fails.
    void navigate('/login', { replace: true });
  };

  return (
    <div className="shell">
      <header className="shell__header">
        <Link to="/projects" className="shell__brand">
          TaskFlow
        </Link>

        <nav className="shell__nav" aria-label="Main">
          <NavLink to="/projects">Projects</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>

        <div className="shell__account">
          {/* A real disclosure button rather than a div with a click handler, so
              it is reachable by keyboard and announces its expanded state. */}
          <button
            type="button"
            className="button button--ghost"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {session.user?.displayName ?? 'Account'}
          </button>
          {menuOpen ? (
            <div className="menu" role="menu">
              <Link role="menuitem" to="/settings" onClick={() => setMenuOpen(false)}>
                Settings
              </Link>
              <Link role="menuitem" to="/settings/security" onClick={() => setMenuOpen(false)}>
                Security
              </Link>
              <button type="button" role="menuitem" onClick={() => void onSignOut()}>
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="shell__main">
        <Outlet />
      </main>
    </div>
  );
};
