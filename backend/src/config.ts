export const config = {
  port: Number(process.env.PORT ?? 3300),
  trustProxy:
    process.env.TRUST_PROXY === "true" || process.env.NODE_ENV === "production",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/secure_storage",
  jwtSecret: process.env.EMERGENCY_JWT_SECRET ?? "dev-emergency-jwt-secret",
  accessTokenTtlHours: Number(process.env.EMERGENCY_ACCESS_TTL_HOURS ?? 12),
  corsOrigins: process.env.EMERGENCY_CORS_ORIGINS
    ? process.env.EMERGENCY_CORS_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean)
    : []
};

if (process.env.NODE_ENV === "production" && config.jwtSecret === "dev-emergency-jwt-secret") {
  throw new Error("EMERGENCY_JWT_SECRET must be set in production");
}
