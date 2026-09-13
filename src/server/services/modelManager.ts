import { GoogleGenAI } from '@google/genai';
import crypto from 'node:crypto';
import { serverLog } from '../config/env';

export type SafeCredentialSource = 'system_primary' | 'system_backup';
export type AnalysisRole = 'validity' | 'technical_branch_a' | 'technical_branch_b' | 'pathology_branch_a' | 'pathology_branch_b';

export interface DiscoveredModel {
  id: string;
  displayName: string;
  description?: string;
  supportedGenerationMethods?: string[];
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  version?: string;
}
export type DiscoveredModelMetadata = DiscoveredModel;

export interface RoleModelAssignment {
  primaryModel: string;
  fallbackModels: string[];
  modelLadder: string[];
  credentialPreference: SafeCredentialSource[];
  generationConfig: { temperature: number; responseMimeType: string };
  compatibilityConfigIdentity?: string;
  compatibilityStatus?: string;
}

export interface AssessmentModelSnapshot {
  snapshotId: string;
  matrixRevision: string;
  ladderRevision: string;
  resolverPlanType: 'ordered_ladder_v1';
  analysisConfigVersion: string;
  policyMode: 'adaptive';
  createdAt: number;
  ladder: string[];
  primaryModel: string;
  roles: Record<AnalysisRole, RoleModelAssignment>;
}

export const FALLBACK_MODEL_IDS = ['gemini-flash-latest', 'gemini-pro-latest', 'gemini-flash-lite-latest'] as const;
const FALLBACK_MODELS: DiscoveredModel[] = FALLBACK_MODEL_IDS.map((id) => ({ id, displayName: id }));
const DISCOVERY_TTL_MS = 10 * 60 * 1000;
const SNAPSHOT_TTL_MS = 2 * 60 * 60 * 1000;
const CIRCUIT_TTL_MS = 60 * 1000;
const discoveryCache = new Map<string, { models: DiscoveredModel[]; expiresAt: number }>();
const circuitBreakers = new Map<string, number>();
const assessmentSnapshots = new Map<string, { ladder: string[]; primaryModel: string; createdAt: number }>();
const assessmentRoleLadders = new Map<string, Record<AnalysisRole, string[]>>();

const normalizeModelId = (value: unknown): string => {
  const id = String(value || '').trim();
  return id.startsWith('models/') ? id.slice(7) : id;
};

const configuredPrimaryKey = () => String(process.env.zknjght_key || process.env.GEMINI_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
const cacheKeyFor = (apiKey: string) => crypto.createHash('sha256').update(apiKey || 'system').digest('hex');

/** Runtime truth comes only from Google SDK metadata; no web policy scraping. */
export async function discoverAvailableVisionModels(apiKey?: string): Promise<DiscoveredModel[]> {
  const key = (apiKey || configuredPrimaryKey()).trim();
  const cacheKey = cacheKeyFor(key);
  const cached = discoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.models;
  try {
    const client = new GoogleGenAI({ apiKey: key });
    const models: DiscoveredModel[] = [];
    for await (const model of await client.models.list()) {
      const id = normalizeModelId((model as any).name);
      const methods = ((model as any).supportedGenerationMethods || (model as any).supportedActions || []) as string[];
      const descriptor = `${id} ${(model as any).displayName || ''} ${(model as any).description || ''}`;
      if (!id || !methods.includes('generateContent') || /embedding|audio|tts|imagen/i.test(descriptor)) continue;
      if (!/gemini|vision/i.test(descriptor) || /image|transcrib|lyria|robotic|computer|deep-research|agent/i.test(descriptor)) continue;
      models.push({ id, displayName: (model as any).displayName || id, description: (model as any).description || undefined, supportedGenerationMethods: methods, inputTokenLimit: (model as any).inputTokenLimit, outputTokenLimit: (model as any).outputTokenLimit, version: (model as any).version });
    }
    const result = models.length ? models : [...FALLBACK_MODELS];
    discoveryCache.set(cacheKey, { models: result, expiresAt: Date.now() + DISCOVERY_TTL_MS });
    return result;
  } catch (error) {
    serverLog('WARN', 'ModelManager', `Google SDK model discovery failed; using fallback ladder: ${String((error as any)?.message || error)}`);
    const result = [...FALLBACK_MODELS];
    discoveryCache.set(cacheKey, { models: result, expiresAt: Date.now() + DISCOVERY_TTL_MS });
    return result;
  }
}

export function getDiscoveredModels(apiKey?: string): DiscoveredModel[] {
  const key = (apiKey || configuredPrimaryKey()).trim();
  const cacheKey = cacheKeyFor(key);
  const now = Date.now();
  const cached = discoveryCache.get(cacheKey);
  if (cached) {
    if (cached.expiresAt <= now) {
      discoveryCache.delete(cacheKey);
    } else {
      return cached.models.length ? [...cached.models] : [...FALLBACK_MODELS];
    }
  }
  return [...FALLBACK_MODELS];
}

const newestFirst = (a: string, b: string): number => {
  const parse = (id: string) => {
    const [, major = '0', minor = '0', patch = '0'] = id.match(/gemini-(\d+)(?:\.(\d+))?(?:\.(\d+))?/i) || [];
    return [/-latest$/i.test(id) ? 1 : 0, Number(major), Number(minor), Number(patch)];
  };
  const av = parse(a);
  const bv = parse(b);
  return bv[1] - av[1] || bv[2] - av[2] || bv[3] - av[3] || bv[0] - av[0];
};

export function buildModelLadder(preferredModel?: string, discoveredModels: DiscoveredModel[] = getDiscoveredModels()): string[] {
  const ids = discoveredModels.map((model) => normalizeModelId(typeof model === 'string' ? model : model.id)).filter(Boolean);
  const valid = ids.length ? ids : [...FALLBACK_MODEL_IDS];
  const flash = valid.filter((id) => /flash/i.test(id) && !/lite/i.test(id)).sort(newestFirst);
  const pro = valid.filter((id) => /pro/i.test(id)).sort(newestFirst);
  const lite = valid.filter((id) => /lite|flash-lite/i.test(id)).sort(newestFirst);
  const ordered = [preferredModel && valid.includes(normalizeModelId(preferredModel)) ? normalizeModelId(preferredModel) : '', ...flash, ...pro, ...lite];
  const ladder = [...new Set(ordered.filter(Boolean))];
  return ladder.length ? ladder : [...FALLBACK_MODEL_IDS];
}

function buildRoleLadder(role: AnalysisRole, baseLadder: string[], preferredModel?: string): string[] {
  const flash = baseLadder.filter((id) => /flash/i.test(id) && !/lite/i.test(id));
  const pro = baseLadder.filter((id) => /pro/i.test(id));
  const lite = baseLadder.filter((id) => /lite/i.test(id));
  const ordered = role === 'validity'
    ? [...lite, ...flash, ...pro]
    : role.endsWith('_branch_b')
      ? [...pro, ...flash, ...lite]
      : [...flash, ...pro, ...lite];
  const preferred = preferredModel && baseLadder.includes(normalizeModelId(preferredModel)) ? normalizeModelId(preferredModel) : '';
  return [...new Set([preferred, ...ordered].filter(Boolean))];
}

function revision(ladder: string[]): string {
  return crypto.createHash('sha256').update(ladder.join('|')).digest('hex').slice(0, 16);
}

function roleAssignment(primaryModel: string, ladder: string[], branchB = false): RoleModelAssignment {
  return { primaryModel, fallbackModels: ladder.filter((model) => model !== primaryModel), modelLadder: ladder, credentialPreference: branchB ? ['system_backup', 'system_primary'] : ['system_primary', 'system_backup'], generationConfig: { temperature: 0, responseMimeType: 'application/json' }, compatibilityConfigIdentity: revision(ladder), compatibilityStatus: 'RUNTIME_DISCOVERED' };
}

function snapshotView(assessmentId: string, state: { ladder: string[]; primaryModel: string; createdAt: number }, roleLadders = {} as Record<AnalysisRole, string[]>): AssessmentModelSnapshot {
  const ladderRevision = revision(state.ladder);
  const ladderFor = (role: AnalysisRole) => roleLadders[role]?.length ? roleLadders[role] : buildRoleLadder(role, state.ladder);
  const validity = ladderFor('validity');
  const technicalA = ladderFor('technical_branch_a');
  const technicalB = ladderFor('technical_branch_b');
  const pathologyA = ladderFor('pathology_branch_a');
  const pathologyB = ladderFor('pathology_branch_b');
  const roles = {
    validity: roleAssignment(validity[0] || state.primaryModel, validity),
    technical_branch_a: roleAssignment(technicalA[0] || state.primaryModel, technicalA),
    technical_branch_b: roleAssignment(technicalB[0] || state.primaryModel, technicalB, true),
    pathology_branch_a: roleAssignment(pathologyA[0] || state.primaryModel, pathologyA),
    pathology_branch_b: roleAssignment(pathologyB[0] || state.primaryModel, pathologyB, true),
  } as Record<AnalysisRole, RoleModelAssignment>;
  return { snapshotId: assessmentId, matrixRevision: ladderRevision, ladderRevision, resolverPlanType: 'ordered_ladder_v1', analysisConfigVersion: 'runtime-discovered', policyMode: 'adaptive', createdAt: state.createdAt, ladder: [...state.ladder], primaryModel: state.primaryModel, roles };
}

export function getOrCreateAssessmentSnapshot(
  assessmentId?: string,
  preferredModel?: string | Partial<Record<AnalysisRole, string>>,
  apiKey?: string,
  discoveredModelsOverride?: DiscoveredModel[]
): AssessmentModelSnapshot {
  const now = Date.now();
  for (const [key, snapshot] of assessmentSnapshots) {
    if (now - snapshot.createdAt > SNAPSHOT_TTL_MS) {
      assessmentSnapshots.delete(key);
      assessmentRoleLadders.delete(key);
    }
  }
  const id = String(assessmentId || '').trim() || `anonymous-${now}`;
  const credentialHash = cacheKeyFor((apiKey || '').trim());
  const snapshotCacheKey = `${id}:${credentialHash}`;
  const existing = assessmentSnapshots.get(snapshotCacheKey);
  if (existing) return snapshotView(id, existing, assessmentRoleLadders.get(snapshotCacheKey));
  const preferred = typeof preferredModel === 'string' ? preferredModel : undefined;
  const discovered = discoveredModelsOverride || getDiscoveredModels(apiKey);
  const ladder = buildModelLadder(preferred, discovered);
  const rolePreferences = typeof preferredModel === 'string'
    ? Object.fromEntries(['validity', 'technical_branch_a', 'technical_branch_b', 'pathology_branch_a', 'pathology_branch_b'].map((role) => [role, preferredModel])) as Partial<Record<AnalysisRole, string>>
    : preferredModel || {};
  const roleLadders = Object.fromEntries((['validity', 'technical_branch_a', 'technical_branch_b', 'pathology_branch_a', 'pathology_branch_b'] as AnalysisRole[]).map((role) => [role, buildRoleLadder(role, ladder, rolePreferences[role])])) as Record<AnalysisRole, string[]>;
  const state = { ladder, primaryModel: ladder[0], createdAt: now };
  if (assessmentId) {
    assessmentSnapshots.set(snapshotCacheKey, state);
    assessmentRoleLadders.set(snapshotCacheKey, roleLadders);
  }
  return snapshotView(id, state, roleLadders);
}

export function releaseAssessmentModelSnapshot(assessmentId: string): void {
  const prefix = `${assessmentId}:`;
  for (const key of assessmentSnapshots.keys()) {
    if (key === assessmentId || key.startsWith(prefix)) {
      assessmentSnapshots.delete(key);
      assessmentRoleLadders.delete(key);
    }
  }
}
export function resetAssessmentSnapshotsForTests(): void { assessmentSnapshots.clear(); assessmentRoleLadders.clear(); }
export function resetDiscoveryCacheForTests(): void { discoveryCache.clear(); }
export function setDiscoveryCacheForTests(apiKey: string | undefined, models: DiscoveredModel[]): void {
  const key = (apiKey || configuredPrimaryKey()).trim();
  const cacheKey = cacheKeyFor(key);
  discoveryCache.set(cacheKey, { models: [...models], expiresAt: Date.now() + DISCOVERY_TTL_MS });
}


export function recordFailure(model: string, key = '*'): void { circuitBreakers.set(`${normalizeModelId(model)}:${key}`, Date.now() + CIRCUIT_TTL_MS); }
export function isCircuitOpen(model: string, key = '*'): boolean {
  const id = normalizeModelId(model);
  const openUntil = Math.max(circuitBreakers.get(`${id}:${key}`) || 0, circuitBreakers.get(`${id}:*`) || 0);
  if (!openUntil || openUntil <= Date.now()) { circuitBreakers.delete(`${id}:${key}`); return false; }
  return true;
}

export function getControlPlaneState() {
  const ladder = buildModelLadder(undefined, getDiscoveredModels());
  const snapshot = snapshotView('control-plane', { ladder, primaryModel: ladder[0], createdAt: Date.now() });
  return { policyMode: 'adaptive' as const, cohortId: 'runtime', matrixRevision: snapshot.matrixRevision, ladderRevision: snapshot.ladderRevision, analysisConfigVersion: snapshot.analysisConfigVersion, activeMatrix: Object.fromEntries(Object.entries(snapshot.roles).map(([role, assignment]) => [role, assignment.primaryModel])), roleAssignments: snapshot.roles, roleLadders: Object.fromEntries(Object.entries(snapshot.roles).map(([role, assignment]) => [role, assignment.modelLadder])), selectionRationales: Object.fromEntries(Object.keys(snapshot.roles).map((role) => [role, 'Google SDK runtime discovery'])), candidates: getDiscoveredModels().map((model) => ({ modelId: model.id, family: /pro/i.test(model.id) ? 'PRO' : /lite/i.test(model.id) ? 'FLASH_LITE' : 'FLASH', lifecycle: 'RUNTIME', isEligible: true, isCompatible: true, healthScore: 100, compositeScore: 100 })) };
}

export function getSanitizedRegistrySummary() {
  const models = getDiscoveredModels();
  const checkedAt = new Date().toISOString();
  return { registryVersion: 'runtime', lastCheckedAt: checkedAt, isFresh: true, sources: { system_primary: { status: 'READY', modelCount: models.length, models, lastSuccessfulCheckAt: checkedAt }, system_backup: { status: 'READY', modelCount: models.length, models, lastSuccessfulCheckAt: checkedAt } }, models };
}

export async function initializeModelManager(): Promise<void> {
  await discoverAvailableVisionModels();
}
