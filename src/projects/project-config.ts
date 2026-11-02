/**
 * Runtime switches for the project discovery workspace. Read from the
 * environment on every call so the flag can be flipped without code changes
 * (and toggled in tests).
 */

export function isProjectDiscoveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PROJECT_DISCOVERY_ENABLED === 'true';
}

/** Static assets that must not be served while the feature is off. Lowercased, decoded paths. */
export const GATED_STATIC_PATHS: ReadonlySet<string> = new Set([
  '/project.html',
  '/js/project.js',
  '/css/project.css',
]);

export function intFromEnv(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt(env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Explicit origin allowlist for state-changing project requests (beyond same-origin). */
export function explicitAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.PROJECT_ALLOWED_ORIGINS ?? env.CORS_ORIGINS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => s && s !== '*');
}
