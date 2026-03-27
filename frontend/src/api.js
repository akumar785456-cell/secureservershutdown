const API_BASE = import.meta.env.VITE_EMERGENCY_API_BASE ?? "http://localhost:3300";
const toErrorMessage = (data, fallback) => {
    if (data?.error === "phone_number_required" || data?.error === "phone_number_and_password_required") {
        return "Mobile number and password are required.";
    }
    if (data?.error === "invalid_phone_number") {
        return "Please enter a valid 10-digit Indian mobile number.";
    }
    if (data?.error === "invalid_credentials") {
        return "Invalid mobile number or password.";
    }
    if (data?.error === "user_disabled") {
        return "This account is currently disabled.";
    }
    if (data?.error === "forbidden") {
        return "This account does not have emergency access.";
    }
    if (data?.error === "reason_required") {
        return "A reason is required before activating shutdown.";
    }
    if (data?.error === "system_shutdown_active") {
        return data?.message ?? "The main system is currently disabled.";
    }
    if (data?.error === "emergency_shutdown_unavailable") {
        return "Emergency shutdown controls are unavailable until the latest migration is applied.";
    }
    if (data?.message) {
        return data.message;
    }
    return fallback;
};
const authFetch = async (token, path, init) => {
    const res = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            ...(init?.headers ?? {})
        }
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(toErrorMessage(data, "Request failed"));
    }
    return res.json();
};
export const login = async (phoneNumber, password) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phoneNumber, password })
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(toErrorMessage(data, "Login failed"));
    }
    return res.json();
};
export const fetchMe = (token) => authFetch(token, "/auth/me");
export const fetchOverview = (token) => authFetch(token, "/overview");
export const activateShutdown = async (token, reason) => authFetch(token, "/shutdown/activate", {
    method: "POST",
    body: JSON.stringify({ reason })
});
export const deactivateShutdown = async (token, note) => authFetch(token, "/shutdown/deactivate", {
    method: "POST",
    body: JSON.stringify({ note })
});
