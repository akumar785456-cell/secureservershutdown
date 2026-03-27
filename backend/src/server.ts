import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Pool, type PoolClient } from "pg";
import { config } from "./config.js";

const app = Fastify({ logger: true, trustProxy: config.trustProxy });
const pool = new Pool({ connectionString: config.databaseUrl });

type EmergencyUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  status: string;
  isAdmin: boolean;
  passwordHash?: string | null;
};

type EmergencyAccessClaims = {
  sub: string;
  phoneNumber: string;
  kind: "emergency_access";
  iat?: number;
  exp?: number;
};

type ShutdownState = {
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

type OverviewStats = {
  totalUsers: number;
  activeUsers: number;
  totalItems: number;
  totalFiles: number;
  totalFolders: number;
  totalStorageBytes: number;
};

type RecentEvent = {
  id: string;
  action: string;
  createdAt: string;
  actorEmail: string | null;
};

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    emergencyUser?: EmergencyUser;
  }
}

const SHUTDOWN_CACHE_MS = 1000;
let shutdownStateCache:
  | {
      value: ShutdownState;
      loadedAt: number;
    }
  | undefined;
let warnedMissingShutdownTable = false;

const defaultShutdownState = (): ShutdownState => ({
  shutdownActive: false,
  shutdownReason: null,
  shutdownStartedAt: null,
  shutdownEndedAt: null,
  updatedAt: null,
  shutdownBy: null
});

const normalizePhoneNumber = (phoneNumber: string) => {
  if (!phoneNumber) {
    throw new Error("phone_number_required");
  }

  const digitsOnly = phoneNumber.replace(/[^\d]/g, "");
  let localNumber = "";

  if (digitsOnly.length === 10) {
    localNumber = digitsOnly;
  } else if (digitsOnly.length === 11 && digitsOnly.startsWith("0")) {
    localNumber = digitsOnly.slice(1);
  } else if (digitsOnly.length === 12 && digitsOnly.startsWith("91")) {
    localNumber = digitsOnly.slice(2);
  } else {
    throw new Error("invalid_phone_number");
  }

  if (!/^[6-9]\d{9}$/.test(localNumber)) {
    throw new Error("invalid_phone_number");
  }

  return `91${localNumber}`;
};

const getBearerToken = (request: { headers: Record<string, unknown> }) => {
  const auth = request.headers.authorization;
  if (!auth || Array.isArray(auth)) return null;
  const [scheme, token] = String(auth).split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
};

const signAccessToken = (userId: string, phoneNumber: string) =>
  jwt.sign(
    {
      sub: userId,
      phoneNumber,
      kind: "emergency_access"
    },
    config.jwtSecret,
    { expiresIn: `${config.accessTokenTtlHours}h` }
  );

const verifyAccessToken = (token: string) =>
  jwt.verify(token, config.jwtSecret) as EmergencyAccessClaims;

const writeAuditLog = async (params: {
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}) => {
  try {
    await pool.query(
      `
      INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata)
      VALUES ($1,$2,$3,$4,$5)
      `,
      [
        params.actorUserId ?? null,
        params.action,
        params.targetType,
        params.targetId ?? null,
        params.metadata ? JSON.stringify(params.metadata) : null
      ]
    );
  } catch (error) {
    app.log.error({ err: error }, "emergency_audit_log_failed");
  }
};

const fetchEmergencyUserByPhone = async (phoneNumber: string, client: Pick<PoolClient, "query">) => {
  const res = await client.query(
    `
    SELECT
      u.id,
      u.email,
      u.first_name,
      u.last_name,
      u.phone_number,
      u.status,
      u.password_hash,
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id
          AND r.name = 'admin'
      ) AS is_admin
    FROM users u
    WHERE u.phone_number = $1
    LIMIT 1
    `,
    [phoneNumber]
  );

  if ((res.rowCount ?? 0) === 0) {
    return null;
  }

  const row = res.rows[0];
  return {
    id: row.id as string,
    email: row.email as string,
    firstName: String(row.first_name ?? ""),
    lastName: String(row.last_name ?? ""),
    phoneNumber: String(row.phone_number ?? ""),
    status: String(row.status ?? "disabled"),
    passwordHash: (row.password_hash as string | null) ?? null,
    isAdmin: Boolean(row.is_admin)
  } satisfies EmergencyUser;
};

const fetchEmergencyUserById = async (userId: string, client: Pick<PoolClient, "query">) => {
  const res = await client.query(
    `
    SELECT
      u.id,
      u.email,
      u.first_name,
      u.last_name,
      u.phone_number,
      u.status,
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id
          AND r.name = 'admin'
      ) AS is_admin
    FROM users u
    WHERE u.id = $1
    LIMIT 1
    `,
    [userId]
  );

  if ((res.rowCount ?? 0) === 0) {
    return null;
  }

  const row = res.rows[0];
  return {
    id: row.id as string,
    email: row.email as string,
    firstName: String(row.first_name ?? ""),
    lastName: String(row.last_name ?? ""),
    phoneNumber: String(row.phone_number ?? ""),
    status: String(row.status ?? "disabled"),
    isAdmin: Boolean(row.is_admin)
  } satisfies EmergencyUser;
};

const invalidateShutdownStateCache = () => {
  shutdownStateCache = undefined;
};

const getShutdownState = async (): Promise<ShutdownState> => {
  const now = Date.now();
  if (shutdownStateCache && now - shutdownStateCache.loadedAt < SHUTDOWN_CACHE_MS) {
    return shutdownStateCache.value;
  }

  try {
    const res = await pool.query(
      `
      SELECT
        esc.shutdown_active,
        esc.shutdown_reason,
        esc.shutdown_started_at,
        esc.shutdown_ended_at,
        esc.updated_at,
        u.id AS shutdown_by_user_id,
        u.email AS shutdown_by_email,
        u.phone_number AS shutdown_by_phone_number,
        u.first_name AS shutdown_by_first_name,
        u.last_name AS shutdown_by_last_name
      FROM emergency_shutdown_controls esc
      LEFT JOIN users u ON u.id = esc.shutdown_by_user_id
      WHERE esc.id = true
      LIMIT 1
      `
    );

    const row = res.rows[0];
    const value: ShutdownState = row
      ? {
          shutdownActive: Boolean(row.shutdown_active),
          shutdownReason: row.shutdown_reason ?? null,
          shutdownStartedAt: row.shutdown_started_at
            ? new Date(row.shutdown_started_at).toISOString()
            : null,
          shutdownEndedAt: row.shutdown_ended_at
            ? new Date(row.shutdown_ended_at).toISOString()
            : null,
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
          shutdownBy: row.shutdown_by_user_id
            ? {
                id: row.shutdown_by_user_id as string,
                email: row.shutdown_by_email ?? null,
                phoneNumber: row.shutdown_by_phone_number ?? null,
                name: [row.shutdown_by_first_name, row.shutdown_by_last_name].filter(Boolean).join(" ") || null
              }
            : null
        }
      : defaultShutdownState();

    shutdownStateCache = { value, loadedAt: now };
    return value;
  } catch (error: any) {
    if (error?.code === "42P01") {
      if (!warnedMissingShutdownTable) {
        warnedMissingShutdownTable = true;
        app.log.warn("emergency_shutdown_controls table is missing; emergency shutdown state is unavailable");
      }
      const value = defaultShutdownState();
      shutdownStateCache = { value, loadedAt: now };
      return value;
    }
    throw error;
  }
};

const requireAuth = async (request: any, reply: any) => {
  const token = getBearerToken(request);
  if (!token) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }

  let claims: EmergencyAccessClaims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }

  if (claims.kind !== "emergency_access" || !claims.sub) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }

  const user = await fetchEmergencyUserById(claims.sub, pool);
  if (!user) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }

  if (user.status !== "active") {
    reply.code(403).send({ error: "user_disabled" });
    return false;
  }

  if (!user.isAdmin) {
    reply.code(403).send({ error: "forbidden" });
    return false;
  }

  request.userId = user.id;
  request.emergencyUser = user;
  return true;
};

const loadOverviewStats = async (): Promise<OverviewStats> => {
  const [usersRes, itemsRes] = await Promise.all([
    pool.query(
      `
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_users
      FROM users
      `
    ),
    pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')::int AS total_items,
        COUNT(*) FILTER (WHERE status = 'active' AND type = 'file')::int AS total_files,
        COUNT(*) FILTER (WHERE status = 'active' AND type = 'folder')::int AS total_folders,
        COALESCE(SUM(size_bytes) FILTER (WHERE status = 'active' AND type = 'file'), 0)::bigint AS total_storage_bytes
      FROM items
      `
    )
  ]);

  return {
    totalUsers: Number(usersRes.rows[0]?.total_users ?? 0),
    activeUsers: Number(usersRes.rows[0]?.active_users ?? 0),
    totalItems: Number(itemsRes.rows[0]?.total_items ?? 0),
    totalFiles: Number(itemsRes.rows[0]?.total_files ?? 0),
    totalFolders: Number(itemsRes.rows[0]?.total_folders ?? 0),
    totalStorageBytes: Number(itemsRes.rows[0]?.total_storage_bytes ?? 0)
  };
};

const loadRecentEvents = async (): Promise<RecentEvent[]> => {
  const res = await pool.query(
    `
    SELECT
      a.id,
      a.action,
      a.created_at,
      u.email AS actor_email
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE a.action IN ('emergency.shutdown.activate', 'emergency.shutdown.deactivate')
    ORDER BY a.created_at DESC
    LIMIT 8
    `
  );

  return res.rows.map((row) => ({
    id: row.id as string,
    action: row.action as string,
    createdAt: new Date(row.created_at).toISOString(),
    actorEmail: (row.actor_email as string | null) ?? null
  }));
};

app.register(cors, {
  origin: (origin, cb) => {
    if (!origin || config.corsOrigins.length === 0) {
      cb(null, true);
      return;
    }
    cb(null, config.corsOrigins.includes(origin));
  },
  allowedHeaders: ["Authorization", "Content-Type"],
  methods: ["GET", "POST", "OPTIONS"]
});

app.get("/health", async () => ({ status: "ok" }));

app.post("/auth/login", async (request, reply) => {
  const body = request.body as { phoneNumber?: string; password?: string };
  if (!body?.phoneNumber || !body?.password) {
    reply.code(400).send({ error: "phone_number_and_password_required" });
    return;
  }

  let normalizedPhone: string;
  try {
    normalizedPhone = normalizePhoneNumber(body.phoneNumber);
  } catch (error: any) {
    reply.code(400).send({ error: error?.message ?? "invalid_phone_number" });
    return;
  }

  const user = await fetchEmergencyUserByPhone(normalizedPhone, pool);
  if (!user || !user.passwordHash || !user.isAdmin) {
    await writeAuditLog({
      actorUserId: user?.id ?? null,
      action: "emergency.auth.login_failed",
      targetType: "user",
      targetId: user?.id ?? null,
      metadata: { phoneNumber: normalizedPhone, reason: "invalid_credentials" }
    });
    reply.code(401).send({ error: "invalid_credentials" });
    return;
  }

  if (user.status !== "active") {
    reply.code(403).send({ error: "user_disabled" });
    return;
  }

  const passwordValid = await bcrypt.compare(body.password, user.passwordHash);
  if (!passwordValid) {
    await writeAuditLog({
      actorUserId: user.id,
      action: "emergency.auth.login_failed",
      targetType: "user",
      targetId: user.id,
      metadata: { phoneNumber: normalizedPhone, reason: "invalid_credentials" }
    });
    reply.code(401).send({ error: "invalid_credentials" });
    return;
  }

  const accessToken = signAccessToken(user.id, user.phoneNumber);
  await writeAuditLog({
    actorUserId: user.id,
    action: "emergency.auth.login",
    targetType: "user",
    targetId: user.id,
    metadata: {
      phoneNumber: normalizedPhone,
      userAgent: request.headers["user-agent"] ?? null
    }
  });

  reply.send({
    accessToken,
    accessExpiresInHours: config.accessTokenTtlHours,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber
    }
  });
});

app.get("/auth/me", async (request, reply) => {
  if (!(await requireAuth(request, reply))) return;

  reply.send({
    user: {
      id: request.emergencyUser!.id,
      email: request.emergencyUser!.email,
      firstName: request.emergencyUser!.firstName,
      lastName: request.emergencyUser!.lastName,
      phoneNumber: request.emergencyUser!.phoneNumber
    },
    shutdown: await getShutdownState()
  });
});

app.get("/overview", async (request, reply) => {
  if (!(await requireAuth(request, reply))) return;

  const [stats, shutdown, recentEvents] = await Promise.all([
    loadOverviewStats(),
    getShutdownState(),
    loadRecentEvents()
  ]);

  reply.send({
    stats,
    shutdown,
    recentEvents
  });
});

app.get("/shutdown/status", async (request, reply) => {
  if (!(await requireAuth(request, reply))) return;
  reply.send(await getShutdownState());
});

app.post("/shutdown/activate", async (request, reply) => {
  if (!(await requireAuth(request, reply))) return;

  const body = request.body as { reason?: string };
  const reason = String(body?.reason ?? "").trim();
  if (!reason) {
    reply.code(400).send({ error: "reason_required" });
    return;
  }

  try {
    await pool.query(
      `
      INSERT INTO emergency_shutdown_controls (
        id,
        shutdown_active,
        shutdown_reason,
        shutdown_started_at,
        shutdown_ended_at,
        shutdown_by_user_id,
        updated_at
      )
      VALUES (true, true, $1, now(), NULL, $2, now())
      ON CONFLICT (id) DO UPDATE
      SET shutdown_active = true,
          shutdown_reason = EXCLUDED.shutdown_reason,
          shutdown_started_at = now(),
          shutdown_ended_at = NULL,
          shutdown_by_user_id = EXCLUDED.shutdown_by_user_id,
          updated_at = now()
      `,
      [reason, request.userId]
    );
  } catch (error: any) {
    if (error?.code === "42P01") {
      reply.code(503).send({ error: "emergency_shutdown_unavailable" });
      return;
    }
    throw error;
  }

  invalidateShutdownStateCache();
  const shutdown = await getShutdownState();
  await writeAuditLog({
    actorUserId: request.userId,
    action: "emergency.shutdown.activate",
    targetType: "emergency_shutdown",
    metadata: { reason }
  });

  reply.send({ status: "ok", shutdown });
});

app.post("/shutdown/deactivate", async (request, reply) => {
  if (!(await requireAuth(request, reply))) return;

  const body = request.body as { note?: string };
  const note = String(body?.note ?? "").trim() || null;

  try {
    await pool.query(
      `
      INSERT INTO emergency_shutdown_controls (
        id,
        shutdown_active,
        shutdown_reason,
        shutdown_started_at,
        shutdown_ended_at,
        shutdown_by_user_id,
        updated_at
      )
      VALUES (true, false, NULL, NULL, now(), $1, now())
      ON CONFLICT (id) DO UPDATE
      SET shutdown_active = false,
          shutdown_reason = NULL,
          shutdown_ended_at = now(),
          shutdown_by_user_id = EXCLUDED.shutdown_by_user_id,
          updated_at = now()
      `,
      [request.userId]
    );
  } catch (error: any) {
    if (error?.code === "42P01") {
      reply.code(503).send({ error: "emergency_shutdown_unavailable" });
      return;
    }
    throw error;
  }

  invalidateShutdownStateCache();
  const shutdown = await getShutdownState();
  await writeAuditLog({
    actorUserId: request.userId,
    action: "emergency.shutdown.deactivate",
    targetType: "emergency_shutdown",
    metadata: { note }
  });

  reply.send({ status: "ok", shutdown });
});

const start = async () => {
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    app.log.info(`emergency backend listening on ${config.port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
