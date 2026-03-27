import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { activateShutdown, deactivateShutdown, fetchMe, fetchOverview, login } from "./api";
import "./styles.css";
const SESSION_STORAGE_KEY = "emergency_shutdown_console_session";
const readPageFromHash = () => {
    return window.location.hash === "#shutdown" ? "shutdown" : "overview";
};
const setPageHash = (page) => {
    const nextHash = page === "shutdown" ? "#shutdown" : "#overview";
    if (window.location.hash !== nextHash) {
        window.history.replaceState(null, "", nextHash);
    }
};
const formatBytes = (value) => {
    if (value <= 0)
        return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let current = value;
    let unitIndex = 0;
    while (current >= 1024 && unitIndex < units.length - 1) {
        current /= 1024;
        unitIndex += 1;
    }
    return `${current.toFixed(current >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};
const formatDateTime = (value) => {
    if (!value)
        return "Not available";
    return new Date(value).toLocaleString();
};
const hiddenCommands = [
    {
        id: "shutdown",
        label: "Shutdown Control",
        page: "shutdown",
        description: "Open the emergency shutdown page",
        keywords: ["shutdown", "server off", "turn off", "offline", "power", "disable"]
    }
];
export default function App() {
    const [page, setPage] = useState(() => readPageFromHash());
    const [searchQuery, setSearchQuery] = useState("");
    const [session, setSession] = useState(null);
    const [overview, setOverview] = useState(null);
    const [bootstrapping, setBootstrapping] = useState(true);
    const [loginPhoneNumber, setLoginPhoneNumber] = useState("");
    const [loginPassword, setLoginPassword] = useState("");
    const [loginError, setLoginError] = useState(null);
    const [loginBusy, setLoginBusy] = useState(false);
    const [message, setMessage] = useState(null);
    const [reason, setReason] = useState("Emergency shutdown requested.");
    const [actionBusy, setActionBusy] = useState(false);
    const searchResults = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query)
            return [];
        return hiddenCommands.filter((command) => [command.label, command.description, ...command.keywords].some((value) => value.toLowerCase().includes(query)));
    }, [searchQuery]);
    const refreshOverview = async (token) => {
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
                const parsed = JSON.parse(raw);
                if (!parsed?.accessToken) {
                    localStorage.removeItem(SESSION_STORAGE_KEY);
                    setBootstrapping(false);
                    return;
                }
                const me = await fetchMe(parsed.accessToken);
                const initialOverview = await fetchOverview(parsed.accessToken);
                if (cancelled)
                    return;
                setSession({
                    accessToken: parsed.accessToken,
                    user: me.user
                });
                setOverview(initialOverview);
            }
            catch {
                localStorage.removeItem(SESSION_STORAGE_KEY);
                if (!cancelled) {
                    setSession(null);
                    setOverview(null);
                }
            }
            finally {
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
    const handleLogin = async (event) => {
        event.preventDefault();
        if (loginBusy)
            return;
        setLoginBusy(true);
        setLoginError(null);
        setMessage(null);
        try {
            const data = await login(loginPhoneNumber, loginPassword);
            const nextSession = {
                accessToken: data.accessToken,
                user: data.user
            };
            localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
            setSession(nextSession);
            await refreshOverview(data.accessToken);
            setPage("overview");
            setLoginPassword("");
        }
        catch (error) {
            setLoginError(error?.message ?? "Login failed");
        }
        finally {
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
    const openHiddenCommand = (nextPage) => {
        setPage(nextPage);
        setSearchQuery("");
        setMessage(null);
    };
    const activate = async () => {
        if (!session || actionBusy)
            return;
        setActionBusy(true);
        setMessage(null);
        try {
            const data = await activateShutdown(session.accessToken, reason);
            setOverview((prev) => prev
                ? { ...prev, shutdown: data.shutdown }
                : prev);
            await refreshOverview(session.accessToken);
            setMessage("Emergency shutdown is now active across the main system.");
            setPage("shutdown");
        }
        catch (error) {
            setMessage(error?.message ?? "Could not activate shutdown.");
        }
        finally {
            setActionBusy(false);
        }
    };
    const deactivate = async () => {
        if (!session || actionBusy)
            return;
        setActionBusy(true);
        setMessage(null);
        try {
            const data = await deactivateShutdown(session.accessToken);
            setOverview((prev) => prev
                ? { ...prev, shutdown: data.shutdown }
                : prev);
            await refreshOverview(session.accessToken);
            setMessage("Emergency shutdown has been cleared. The main system can accept traffic again.");
            setPage("overview");
        }
        catch (error) {
            setMessage(error?.message ?? "Could not restore the system.");
        }
        finally {
            setActionBusy(false);
        }
    };
    if (bootstrapping) {
        return _jsx("div", { className: "loading-screen", children: "Loading emergency control..." });
    }
    if (!session) {
        return (_jsx("div", { className: "login-shell", children: _jsxs("div", { className: "login-panel", children: [_jsx("div", { className: "eyebrow", children: "Emergency Control" }), _jsx("h1", { children: "Break-glass access" }), _jsx("p", { className: "lead", children: "Sign in with your mobile number and password to access the separate shutdown console." }), _jsxs("form", { className: "login-form", onSubmit: handleLogin, children: [_jsxs("label", { children: [_jsx("span", { children: "Mobile number" }), _jsx("input", { type: "tel", value: loginPhoneNumber, onChange: (event) => setLoginPhoneNumber(event.target.value), placeholder: "9876543210", autoFocus: true, required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "Password" }), _jsx("input", { type: "password", value: loginPassword, onChange: (event) => setLoginPassword(event.target.value), placeholder: "Enter password", required: true })] }), loginError && _jsx("div", { className: "notice notice-error", children: loginError }), _jsx("button", { className: "primary-button", type: "submit", disabled: loginBusy, children: loginBusy ? "Signing in..." : "Open control room" })] })] }) }));
    }
    return (_jsxs("div", { className: "shell", children: [_jsxs("aside", { className: "sidebar", children: [_jsxs("div", { className: "brand", children: [_jsx("div", { className: "brand-mark" }), _jsxs("div", { children: [_jsx("div", { className: "brand-title", children: "Sentinel" }), _jsx("div", { className: "brand-subtitle", children: "Emergency control room" })] })] }), _jsxs("div", { className: "search-block", children: [_jsx("label", { className: "search-label", htmlFor: "command-search", children: "Search commands" }), _jsx("input", { id: "command-search", className: "search-input", value: searchQuery, onChange: (event) => setSearchQuery(event.target.value), onKeyDown: (event) => {
                                    if (event.key === "Enter" && searchResults.length > 0) {
                                        event.preventDefault();
                                        openHiddenCommand(searchResults[0].page);
                                    }
                                }, placeholder: "Type shutdown" }), searchResults.length > 0 && (_jsx("div", { className: "search-results", children: searchResults.map((command) => (_jsxs("button", { className: "search-result", onClick: () => openHiddenCommand(command.page), children: [_jsx("span", { children: command.label }), _jsx("small", { children: command.description })] }, command.id))) }))] }), _jsxs("nav", { className: "nav", children: [_jsx("button", { className: `nav-item ${page === "overview" ? "active" : ""}`, onClick: () => setPage("overview"), children: "Overview" }), page === "shutdown" && (_jsx("button", { className: "nav-item active", onClick: () => setPage("shutdown"), children: "Shutdown" }))] }), _jsxs("div", { className: "sidebar-footer", children: [_jsxs("div", { className: "user-card", children: [_jsx("div", { className: "user-label", children: "Signed in as" }), _jsx("div", { className: "user-name", children: session.user.firstName || session.user.lastName
                                            ? `${session.user.firstName} ${session.user.lastName}`.trim()
                                            : session.user.phoneNumber }), _jsx("div", { className: "user-meta", children: session.user.phoneNumber })] }), _jsx("button", { className: "ghost-button", onClick: signOut, children: "Sign out" })] })] }), _jsxs("main", { className: "main", children: [_jsxs("header", { className: "page-header", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: "System state" }), _jsx("h1", { children: page === "overview" ? "Overview" : "Shutdown control" })] }), _jsx("div", { className: `status-pill ${overview?.shutdown.shutdownActive ? "danger" : "safe"}`, children: overview?.shutdown.shutdownActive ? "Shutdown active" : "System available" })] }), message && _jsx("div", { className: "notice", children: message }), page === "overview" && overview && (_jsxs("section", { className: "page-grid", children: [_jsxs("div", { className: "hero-card", children: [_jsx("div", { className: "eyebrow", children: "Main app" }), _jsx("h2", { children: overview.shutdown.shutdownActive ? "Traffic blocked" : "Traffic open" }), _jsx("p", { children: overview.shutdown.shutdownActive
                                            ? "The main gateway is blocking all normal traffic. Use the shutdown page to restore access."
                                            : "The main gateway is accepting normal traffic. Search for shutdown to open the hidden control page." })] }), _jsxs("div", { className: "stats-grid", children: [_jsxs("article", { className: "stat-card", children: [_jsx("span", { children: "Storage in use" }), _jsx("strong", { children: formatBytes(overview.stats.totalStorageBytes) }), _jsx("small", { children: "Across active files" })] }), _jsxs("article", { className: "stat-card", children: [_jsx("span", { children: "Users" }), _jsx("strong", { children: overview.stats.activeUsers }), _jsxs("small", { children: [overview.stats.totalUsers, " total accounts"] })] }), _jsxs("article", { className: "stat-card", children: [_jsx("span", { children: "Files" }), _jsx("strong", { children: overview.stats.totalFiles }), _jsxs("small", { children: [overview.stats.totalFolders, " folders"] })] }), _jsxs("article", { className: "stat-card", children: [_jsx("span", { children: "Items" }), _jsx("strong", { children: overview.stats.totalItems }), _jsx("small", { children: "Active records" })] })] }), _jsxs("div", { className: "panel", children: [_jsx("div", { className: "panel-title", children: "Shutdown state" }), _jsxs("div", { className: "state-row", children: [_jsx("span", { children: "Status" }), _jsx("strong", { children: overview.shutdown.shutdownActive ? "Active" : "Inactive" })] }), _jsxs("div", { className: "state-row", children: [_jsx("span", { children: "Reason" }), _jsx("strong", { children: overview.shutdown.shutdownReason ?? "Not active" })] }), _jsxs("div", { className: "state-row", children: [_jsx("span", { children: "Changed at" }), _jsx("strong", { children: formatDateTime(overview.shutdown.updatedAt) })] }), _jsxs("div", { className: "state-row", children: [_jsx("span", { children: "Changed by" }), _jsx("strong", { children: overview.shutdown.shutdownBy?.email ?? "Unknown" })] })] }), _jsxs("div", { className: "panel", children: [_jsx("div", { className: "panel-title", children: "Recent emergency actions" }), overview.recentEvents.length === 0 ? (_jsx("div", { className: "empty", children: "No emergency actions have been recorded yet." })) : (_jsx("div", { className: "event-list", children: overview.recentEvents.map((event) => (_jsxs("div", { className: "event-row", children: [_jsxs("div", { children: [_jsx("strong", { children: event.action.replace("emergency.shutdown.", "") }), _jsx("small", { children: event.actorEmail ?? "Unknown actor" })] }), _jsx("span", { children: formatDateTime(event.createdAt) })] }, event.id))) }))] })] })), page === "shutdown" && overview && (_jsxs("section", { className: "shutdown-layout", children: [_jsxs("div", { className: "panel danger-panel", children: [_jsx("div", { className: "panel-title", children: "Emergency shutdown" }), _jsx("p", { className: "panel-copy", children: "This control blocks the main Secure Storage gateway for everyone, including admin users. Only this separate control console stays available for recovery." }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Reason" }), _jsx("textarea", { value: reason, onChange: (event) => setReason(event.target.value), placeholder: "Explain why the system is being disabled.", rows: 4 })] }), _jsxs("div", { className: "action-row", children: [_jsx("button", { className: "danger-button", onClick: activate, disabled: actionBusy || overview.shutdown.shutdownActive, children: actionBusy ? "Applying..." : "Activate shutdown" }), _jsx("button", { className: "primary-button secondary", onClick: deactivate, disabled: actionBusy || !overview.shutdown.shutdownActive, children: actionBusy ? "Applying..." : "Restore system" })] })] }), _jsxs("div", { className: "panel", children: [_jsx("div", { className: "panel-title", children: "Current state" }), _jsxs("div", { className: "state-row", children: [_jsx("span", { children: "Status" }), _jsx("strong", { children: overview.shutdown.shutdownActive ? "Active" : "Inactive" })] }), _jsxs("div", { className: "state-row", children: [_jsx("span", { children: "Reason" }), _jsx("strong", { children: overview.shutdown.shutdownReason ?? "Not active" })] }), _jsxs("div", { className: "state-row", children: [_jsx("span", { children: "Started" }), _jsx("strong", { children: formatDateTime(overview.shutdown.shutdownStartedAt) })] }), _jsxs("div", { className: "state-row", children: [_jsx("span", { children: "Last updated" }), _jsx("strong", { children: formatDateTime(overview.shutdown.updatedAt) })] }), _jsxs("div", { className: "state-row", children: [_jsx("span", { children: "Actor" }), _jsx("strong", { children: overview.shutdown.shutdownBy?.email ?? "Unknown" })] })] })] }))] })] }));
}
