# Server Shutdown Control

Standalone emergency control console for Secure Storage.

This folder is intentionally self-contained so it can be moved to its own GitHub repository later.

Structure:

- `frontend/`: separate Netlify app
- `backend/`: separate Railway service

The backend uses the same PostgreSQL database as the main app and writes the shared shutdown state into the `emergency_shutdown_controls` table.

When emergency shutdown is active:

- the main gateway blocks normal traffic for everyone
- this emergency backend remains available so the system can be restored

## Local Development

Backend:

```bash
cd server-shutdown-control/backend
npm run dev
```

Frontend:

```bash
cd server-shutdown-control/frontend
npm run dev
```

## Environment

Backend expects:

- `DATABASE_URL`
- `EMERGENCY_JWT_SECRET`
- `EMERGENCY_CORS_ORIGINS`

Frontend expects:

- `VITE_EMERGENCY_API_BASE`
