import { useEffect, useMemo, useState } from "react";
import {
  activateShutdown,
  deactivateShutdown,
  fetchMe,
  fetchOverview,
  login,
  type EmergencyUser,
  type OverviewResponse
} from "./api";
import "./styles.css";

type Page = "overview" | "shutdown";

type Session = {
  accessToken: string;
  user: EmergencyUser;
};

const SESSION_STORAGE_KEY = "emergency_shutdown_console_session";

const readPageFromHash = (): Page => {
  return window.location.hash === "#shutdown" ? "shutdown" : "overview";
};

const setPageHash = (page: Page) => {
  const nextHash = page === "shutdown" ? "#shutdown" : "#overview";
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
  }
};

const formatBytes = (value: number) => {
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current.toFixed(current >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatDateTime = (value: string | null) => {
  if (!value) return "Not available";
  return new Date(value).toLocaleString();
};

const hiddenCommands = [
  {
    id: "shutdown",
    label: "Shutdown Control",
    page: "shutdown" as const,
    description: "Open the emergency shutdown page",
    keywords: ["shutdown", "server off", "turn off", "offline", "power", "disable"]
  }
];

export default function App() {
  const [page, setPage] = useState<Page>(() => readPageFromHash());
  const [searchQuery, setSearchQuery] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [loginPhoneNumber, setLoginPhoneNumber] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState("Emergency shutdown requested.");
  const [actionBusy, setActionBusy] = useState(false);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return hiddenCommands.filter((command) =>
      [command.label, command.description, ...command.keywords].some((value) =>
        value.toLowerCase().includes(query)
      )
    );
  }, [searchQuery]);

  const refreshOverview = async (token: string) => {
    const data = await fetchOverview(token);
    setOverview(data);
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) {
        setBootstrapping(false);
        return;
      }

      try {
        const parsed = JSON.parse(raw) as Session;
        if (!parsed?.accessToken) {
          localStorage.removeItem(SESSION_STORAGE_KEY);
          setBootstrapping(false);
          return;
        }

        const me = await fetchMe(parsed.accessToken);
        const initialOverview = await fetchOverview(parsed.accessToken);
        if (cancelled) return;
        setSession({
          accessToken: parsed.accessToken,
          user: me.user
        });
        setOverview(initialOverview);
      } catch {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        if (!cancelled) {
          setSession(null);
          setOverview(null);
        }
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPageHash(page);
  }, [page]);

  useEffect(() => {
    const onHashChange = () => setPage(readPageFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loginBusy) return;
    setLoginBusy(true);
    setLoginError(null);
    setMessage(null);
    try {
      const data = await login(loginPhoneNumber, loginPassword);
      const nextSession: Session = {
        accessToken: data.accessToken,
        user: data.user
      };
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      await refreshOverview(data.accessToken);
      setPage("overview");
      setLoginPassword("");
    } catch (error: any) {
      setLoginError(error?.message ?? "Login failed");
    } finally {
      setLoginBusy(false);
      setBootstrapping(false);
    }
  };

  const signOut = () => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    setSession(null);
    setOverview(null);
    setPage("overview");
    setSearchQuery("");
    setMessage(null);
  };

  const openHiddenCommand = (nextPage: Page) => {
    setPage(nextPage);
    setSearchQuery("");
    setMessage(null);
  };

  const activate = async () => {
    if (!session || actionBusy) return;
    setActionBusy(true);
    setMessage(null);
    try {
      const data = await activateShutdown(session.accessToken, reason);
      setOverview((prev) =>
        prev
          ? { ...prev, shutdown: data.shutdown }
          : prev
      );
      await refreshOverview(session.accessToken);
      setMessage("Emergency shutdown is now active across the main system.");
      setPage("shutdown");
    } catch (error: any) {
      setMessage(error?.message ?? "Could not activate shutdown.");
    } finally {
      setActionBusy(false);
    }
  };

  const deactivate = async () => {
    if (!session || actionBusy) return;
    setActionBusy(true);
    setMessage(null);
    try {
      const data = await deactivateShutdown(session.accessToken);
      setOverview((prev) =>
        prev
          ? { ...prev, shutdown: data.shutdown }
          : prev
      );
      await refreshOverview(session.accessToken);
      setMessage("Emergency shutdown has been cleared. The main system can accept traffic again.");
      setPage("overview");
    } catch (error: any) {
      setMessage(error?.message ?? "Could not restore the system.");
    } finally {
      setActionBusy(false);
    }
  };

  if (bootstrapping) {
    return <div className="loading-screen">Loading emergency control...</div>;
  }

  if (!session) {
    return (
      <div className="login-shell">
        <div className="login-panel">
          <div className="eyebrow">Emergency Control</div>
          <h1>Break-glass access</h1>
          <p className="lead">
            Sign in with your mobile number and password to access the separate shutdown console.
          </p>
          <form className="login-form" onSubmit={handleLogin}>
            <label>
              <span>Mobile number</span>
              <input
                type="tel"
                value={loginPhoneNumber}
                onChange={(event) => setLoginPhoneNumber(event.target.value)}
                placeholder="9876543210"
                autoFocus
                required
              />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="Enter password"
                required
              />
            </label>
            {loginError && <div className="notice notice-error">{loginError}</div>}
            <button className="primary-button" type="submit" disabled={loginBusy}>
              {loginBusy ? "Signing in..." : "Open control room"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <div className="brand-title">Sentinel</div>
            <div className="brand-subtitle">Emergency control room</div>
          </div>
        </div>

        <div className="search-block">
          <label className="search-label" htmlFor="command-search">
            Search commands
          </label>
          <input
            id="command-search"
            className="search-input"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && searchResults.length > 0) {
                event.preventDefault();
                openHiddenCommand(searchResults[0].page);
              }
            }}
            placeholder="Type shutdown"
          />
          {searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map((command) => (
                <button
                  key={command.id}
                  className="search-result"
                  onClick={() => openHiddenCommand(command.page)}
                >
                  <span>{command.label}</span>
                  <small>{command.description}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <nav className="nav">
          <button
            className={`nav-item ${page === "overview" ? "active" : ""}`}
            onClick={() => setPage("overview")}
          >
            Overview
          </button>
          {page === "shutdown" && (
            <button className="nav-item active" onClick={() => setPage("shutdown")}>
              Shutdown
            </button>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-label">Signed in as</div>
            <div className="user-name">
              {session.user.firstName || session.user.lastName
                ? `${session.user.firstName} ${session.user.lastName}`.trim()
                : session.user.phoneNumber}
            </div>
            <div className="user-meta">{session.user.phoneNumber}</div>
          </div>
          <button className="ghost-button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="page-header">
          <div>
            <div className="eyebrow">System state</div>
            <h1>{page === "overview" ? "Overview" : "Shutdown control"}</h1>
          </div>
          <div className={`status-pill ${overview?.shutdown.shutdownActive ? "danger" : "safe"}`}>
            {overview?.shutdown.shutdownActive ? "Shutdown active" : "System available"}
          </div>
        </header>

        {message && <div className="notice">{message}</div>}

        {page === "overview" && overview && (
          <section className="page-grid">
            <div className="hero-card">
              <div className="eyebrow">Main app</div>
              <h2>{overview.shutdown.shutdownActive ? "Traffic blocked" : "Traffic open"}</h2>
              <p>
                {overview.shutdown.shutdownActive
                  ? "The main gateway is blocking all normal traffic. Use the shutdown page to restore access."
                  : "The main gateway is accepting normal traffic. Search for shutdown to open the hidden control page."}
              </p>
            </div>

            <div className="stats-grid">
              <article className="stat-card">
                <span>Storage in use</span>
                <strong>{formatBytes(overview.stats.totalStorageBytes)}</strong>
                <small>Across active files</small>
              </article>
              <article className="stat-card">
                <span>Users</span>
                <strong>{overview.stats.activeUsers}</strong>
                <small>{overview.stats.totalUsers} total accounts</small>
              </article>
              <article className="stat-card">
                <span>Files</span>
                <strong>{overview.stats.totalFiles}</strong>
                <small>{overview.stats.totalFolders} folders</small>
              </article>
              <article className="stat-card">
                <span>Items</span>
                <strong>{overview.stats.totalItems}</strong>
                <small>Active records</small>
              </article>
            </div>

            <div className="panel">
              <div className="panel-title">Shutdown state</div>
              <div className="state-row">
                <span>Status</span>
                <strong>{overview.shutdown.shutdownActive ? "Active" : "Inactive"}</strong>
              </div>
              <div className="state-row">
                <span>Reason</span>
                <strong>{overview.shutdown.shutdownReason ?? "Not active"}</strong>
              </div>
              <div className="state-row">
                <span>Changed at</span>
                <strong>{formatDateTime(overview.shutdown.updatedAt)}</strong>
              </div>
              <div className="state-row">
                <span>Changed by</span>
                <strong>{overview.shutdown.shutdownBy?.email ?? "Unknown"}</strong>
              </div>
            </div>

            <div className="panel">
              <div className="panel-title">Recent emergency actions</div>
              {overview.recentEvents.length === 0 ? (
                <div className="empty">No emergency actions have been recorded yet.</div>
              ) : (
                <div className="event-list">
                  {overview.recentEvents.map((event) => (
                    <div className="event-row" key={event.id}>
                      <div>
                        <strong>{event.action.replace("emergency.shutdown.", "")}</strong>
                        <small>{event.actorEmail ?? "Unknown actor"}</small>
                      </div>
                      <span>{formatDateTime(event.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {page === "shutdown" && overview && (
          <section className="shutdown-layout">
            <div className="panel danger-panel">
              <div className="panel-title">Emergency shutdown</div>
              <p className="panel-copy">
                This control blocks the main Secure Storage gateway for everyone, including admin users.
                Only this separate control console stays available for recovery.
              </p>

              <label className="field">
                <span>Reason</span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Explain why the system is being disabled."
                  rows={4}
                />
              </label>

              <div className="action-row">
                <button
                  className="danger-button"
                  onClick={activate}
                  disabled={actionBusy || overview.shutdown.shutdownActive}
                >
                  {actionBusy ? "Applying..." : "Activate shutdown"}
                </button>
                <button
                  className="primary-button secondary"
                  onClick={deactivate}
                  disabled={actionBusy || !overview.shutdown.shutdownActive}
                >
                  {actionBusy ? "Applying..." : "Restore system"}
                </button>
              </div>
            </div>

            <div className="panel">
              <div className="panel-title">Current state</div>
              <div className="state-row">
                <span>Status</span>
                <strong>{overview.shutdown.shutdownActive ? "Active" : "Inactive"}</strong>
              </div>
              <div className="state-row">
                <span>Reason</span>
                <strong>{overview.shutdown.shutdownReason ?? "Not active"}</strong>
              </div>
              <div className="state-row">
                <span>Started</span>
                <strong>{formatDateTime(overview.shutdown.shutdownStartedAt)}</strong>
              </div>
              <div className="state-row">
                <span>Last updated</span>
                <strong>{formatDateTime(overview.shutdown.updatedAt)}</strong>
              </div>
              <div className="state-row">
                <span>Actor</span>
                <strong>{overview.shutdown.shutdownBy?.email ?? "Unknown"}</strong>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
