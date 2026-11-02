import { DiscoveryDeps } from '../projects/discovery-types.js';
import { intFromEnv } from '../projects/project-config.js';
import { ProjectService, limitsFromEnv } from '../projects/project-service.js';
import { getProjectStore } from '../projects/project-store.js';
import { getConfig } from '../config/config.js';
import { createDefaultDiscoveryAgent } from './discovery/discovery-agent.js';

/** Process-wide project service wired to the real store and the Anthropic-backed discovery agent. */
let instance: ProjectService | null = null;

export function discoveryDepsFromEnv(env: NodeJS.ProcessEnv = process.env): DiscoveryDeps {
  const timeoutMs = intFromEnv('DISCOVERY_TIMEOUT_MS', 30000, env);
  return {
    runAgent: createDefaultDiscoveryAgent(env),
    isConfigured: () => !!getConfig().anthropic.apiKey,
    timeoutMs,
    graceMs: 10000,
    dailyLimit: intFromEnv('DISCOVERY_DAILY_LIMIT', 500, env),
    historyMessages: intFromEnv('DISCOVERY_HISTORY_MESSAGES', 20, env),
  };
}

export function getProjectService(): ProjectService {
  if (!instance) {
    instance = new ProjectService({
      store: getProjectStore(),
      limits: limitsFromEnv(),
      discovery: discoveryDepsFromEnv(),
    });
  }
  return instance;
}

/** Test hook. */
export function setProjectServiceForTests(service: ProjectService | null): void {
  instance = service;
}
