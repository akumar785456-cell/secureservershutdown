const API_BASE = import.meta.env.VITE_EMERGENCY_API_BASE ?? "http://localhost:3300";

export type EmergencyUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
};

export type ShutdownState = {
  shutdownActive: boolean;
  shutdownReason: string | null;
  shutdownStartedAt: string | null;
  shutdownEndedAt: string | null;
  updatedAt: string | null;
  shutdownBy: {
    id: string;
    email: string | null;
    phoneNumber: string | null;
    name: string | null;
  } | null;
};

export type OverviewStats = {
  totalUsers: number;
  activeUsers: number;
  totalItems: number;
  totalFiles: number;
  totalFolders: number;
  totalStorageBytes: number;
};

export type RecentEvent = {
  id: string;
  action: string;
  createdAt: string;
  actorEmail: string | null;
};

export type LoginResponse = {
  accessToken: string;
  accessExpiresInHours: number;
  user: EmergencyUser;
};

export type MeResponse = {
  user: EmergencyUser;
  shutdown: ShutdownState;
};

export type OverviewResponse = {
  stats: OverviewStats;
  shutdown: ShutdownState;
  recentEvents: RecentEvent[];
};

const toErrorMessage = (data: any, fallback: string) => {
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
    return "This account does not have access to this workspace.";
  }
  if (data?.error === "reason_required") {
    return "Add a short internal note before saving this change.";
  }
  if (data?.error === "system_shutdown_active") {
    return data?.message ?? "Access is currently limited.";
  }
  if (data?.error === "emergency_shutdown_unavailable") {
    return "This workspace panel is temporarily unavailable until the latest setup is applied.";
  }
  if (data?.message) {
    return data.message;
  }
  return fallback;
};

const authFetch = async (token: string, path: string, init?: RequestInit) => {
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

export const login = async (phoneNumber: string, password: string) => {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber, password })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(toErrorMessage(data, "Login failed"));
  }

  return res.json() as Promise<LoginResponse>;
};

export const fetchMe = (token: string) =>
  authFetch(token, "/auth/me") as Promise<MeResponse>;

export const fetchOverview = (token: string) =>
  authFetch(token, "/overview") as Promise<OverviewResponse>;

export const activateShutdown = async (token: string, reason: string) =>
  authFetch(token, "/shutdown/activate", {
    method: "POST",
    body: JSON.stringify({ reason })
  }) as Promise<{ status: "ok"; shutdown: ShutdownState }>;

export const deactivateShutdown = async (token: string, note?: string) =>
  authFetch(token, "/shutdown/deactivate", {
    method: "POST",
    body: JSON.stringify({ note })
  }) as Promise<{ status: "ok"; shutdown: ShutdownState }>;
