import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { serverLog } from '../config/env';
import { determineAccuracyCategory, isLogIncompleteHelper, isLogErrorHelper, getDateKeyFromLog } from '../utils/metadataHelpers';
import { CANONICAL_TECHNICAL_KEYS_SET } from '../../data/taxonomyData';
import { CANONICAL_PATHOLOGY_KEYS } from '../../utils/semanticValidation';
export { getDateKeyFromLog };

const CANONICAL_PATHOLOGY_KEYS_SET = new Set<string>(CANONICAL_PATHOLOGY_KEYS);


export const STATS_COLLECTION = 'system_stats';
export const USER_STATS_COLLECTION = 'user_stats';

export interface BaseStats {
  schemaVersion: number;
  updatedAt: string;
}

export interface ReportsStats {
  totalSessions: number;
  completedCount: number;
  incompleteCount: number;
  invalidImageCount: number;
  accuracyCounts: {
    EXACT_MATCH: number;
    MOSTLY_ACCURATE: number;
    PARTIALLY_ACCURATE: number;
    INACCURATE: number;
  };
  errorDistribution: Record<string, number>;
  uniqueUsersCount?: number;
  todayUsersCount?: number;
  userList?: Array<{
    userId: string;
    totalSessions: number;
    completedSessions: number;
    lastActive: string;
    lastTooth: string;
    rawMs: number;
  }>;
}

export interface PathologyStats {
  totalPathologyLogs: number;
  completedCount: number;
  incompleteCount: number;
  invalidImageCount: number;
  verifiedCount: number;
  unverifiedCount: number;
  pathologyDistribution: Record<string, number>;
  toothDistribution: Record<string, number>;
  uniqueUsersCount?: number;
  todayUsersCount?: number;
  userList?: Array<{
    deviceId: string;
    totalUploads: number;
    lastActive: string;
    firstActive: string;
  }>;
}

export interface BugsStats {
  totalBugs: number;
  severityDistribution: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  statusDistribution: {
    OPEN: number;
    IN_PROGRESS: number;
    RESOLVED: number;
    CLOSED: number;
  };
  sourceDistribution: {
    SYSTEM_AUTO: number;
    USER_SUBMITTED: number;
  };
}

export interface UsersStats {
  uniqueUsersCount: number;
  activeUsersCount: number;
}

export interface SystemStatsDoc extends BaseStats {
  reports: ReportsStats;
  pathology: PathologyStats;
  bugs: BugsStats;
  users: UsersStats;
}

export function createEmptyStats(): SystemStatsDoc {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    reports: {
      totalSessions: 0,
      completedCount: 0,
      incompleteCount: 0,
      invalidImageCount: 0,
      accuracyCounts: { EXACT_MATCH: 0, MOSTLY_ACCURATE: 0, PARTIALLY_ACCURATE: 0, INACCURATE: 0 },
      errorDistribution: {},
      uniqueUsersCount: 0,
      todayUsersCount: 0,
      userList: [],
    },
    pathology: {
      totalPathologyLogs: 0,
      completedCount: 0,
      incompleteCount: 0,
      invalidImageCount: 0,
      verifiedCount: 0,
      unverifiedCount: 0,
      pathologyDistribution: {},
      toothDistribution: {},
      uniqueUsersCount: 0,
      todayUsersCount: 0,
      userList: [],
    },
    bugs: {
      totalBugs: 0,
      severityDistribution: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      statusDistribution: { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0 },
      sourceDistribution: { SYSTEM_AUTO: 0, USER_SUBMITTED: 0 },
    },
    users: {
      uniqueUsersCount: 0,
      activeUsersCount: 0,
    },
  };
}

export function unflattenDelta(delta: MetricContributions, useIncrement = true): any {
  const result: any = {};
  for (const [key, val] of Object.entries(delta)) {
    if (val === 0) continue;
    const parts = key.split('.');
    let curr = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!curr[parts[i]]) curr[parts[i]] = {};
      curr = curr[parts[i]];
    }
    curr[parts[parts.length - 1]] = useIncrement ? FieldValue.increment(val) : val;
  }
  result.updatedAt = new Date().toISOString();
  return result;
}

export function unflattenStats(raw: any): SystemStatsDoc {
  const result = createEmptyStats();
  if (!raw || typeof raw !== 'object') return result;

  // Handle nested format
  if (raw.reports && typeof raw.reports === 'object' && typeof raw.reports.totalSessions === 'number') {
    mergeStats(result, raw as SystemStatsDoc);
    if (raw.updatedAt) result.updatedAt = raw.updatedAt;
    if (raw.schemaVersion) result.schemaVersion = raw.schemaVersion;
  }

  // Handle flat dotted keys or mixed
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'number') continue;
    if (k.startsWith('reports.')) {
      const sub = k.replace('reports.', '');
      if (sub.startsWith('accuracyCounts.')) {
        const accKey = sub.replace('accuracyCounts.', '');
        (result.reports.accuracyCounts as any)[accKey] = ((result.reports.accuracyCounts as any)[accKey] || 0) + v;
      } else if (sub.startsWith('errorDistribution.')) {
        const errKey = sub.replace('errorDistribution.', '');
        result.reports.errorDistribution[errKey] = (result.reports.errorDistribution[errKey] || 0) + v;
      } else {
        (result.reports as any)[sub] = ((result.reports as any)[sub] || 0) + v;
      }
    } else if (k.startsWith('pathology.')) {
      const sub = k.replace('pathology.', '');
      if (sub.startsWith('pathologyDistribution.')) {
        const pathKey = sub.replace('pathologyDistribution.', '');
        result.pathology.pathologyDistribution[pathKey] = (result.pathology.pathologyDistribution[pathKey] || 0) + v;
      } else if (sub.startsWith('toothDistribution.')) {
        const toothKey = sub.replace('toothDistribution.', '');
        result.pathology.toothDistribution[toothKey] = (result.pathology.toothDistribution[toothKey] || 0) + v;
      } else {
        (result.pathology as any)[sub] = ((result.pathology as any)[sub] || 0) + v;
      }
    } else if (k.startsWith('bugs.')) {
      const sub = k.replace('bugs.', '');
      if (sub.startsWith('severityDistribution.')) {
        const sevKey = sub.replace('severityDistribution.', '');
        (result.bugs.severityDistribution as any)[sevKey] = ((result.bugs.severityDistribution as any)[sevKey] || 0) + v;
      } else if (sub.startsWith('statusDistribution.')) {
        const stKey = sub.replace('statusDistribution.', '');
        (result.bugs.statusDistribution as any)[stKey] = ((result.bugs.statusDistribution as any)[stKey] || 0) + v;
      } else if (sub.startsWith('sourceDistribution.')) {
        const srcKey = sub.replace('sourceDistribution.', '');
        (result.bugs.sourceDistribution as any)[srcKey] = ((result.bugs.sourceDistribution as any)[srcKey] || 0) + v;
      } else {
        (result.bugs as any)[sub] = ((result.bugs as any)[sub] || 0) + v;
      }
    } else if (k.startsWith('users.')) {
      const sub = k.replace('users.', '');
      (result.users as any)[sub] = ((result.users as any)[sub] || 0) + v;
    }
  }

  if (raw.updatedAt) result.updatedAt = raw.updatedAt;
  if (raw.schemaVersion) result.schemaVersion = raw.schemaVersion;

  return result;
}

export function mergeStats(target: SystemStatsDoc, source: SystemStatsDoc): void {
  // reports
  target.reports.totalSessions += source.reports?.totalSessions || 0;
  target.reports.completedCount += source.reports?.completedCount || 0;
  target.reports.incompleteCount += source.reports?.incompleteCount || 0;
  target.reports.invalidImageCount += source.reports?.invalidImageCount || 0;
  
  if (source.reports?.accuracyCounts) {
    target.reports.accuracyCounts.EXACT_MATCH += source.reports.accuracyCounts.EXACT_MATCH || 0;
    target.reports.accuracyCounts.MOSTLY_ACCURATE += source.reports.accuracyCounts.MOSTLY_ACCURATE || 0;
    target.reports.accuracyCounts.PARTIALLY_ACCURATE += source.reports.accuracyCounts.PARTIALLY_ACCURATE || 0;
    target.reports.accuracyCounts.INACCURATE += source.reports.accuracyCounts.INACCURATE || 0;
  }
  
  for (const [k, v] of Object.entries(source.reports?.errorDistribution || {})) {
    target.reports.errorDistribution[k] = (target.reports.errorDistribution[k] || 0) + (v as number);
  }

  // pathology
  target.pathology.totalPathologyLogs += source.pathology?.totalPathologyLogs || 0;
  target.pathology.completedCount += source.pathology?.completedCount || 0;
  target.pathology.incompleteCount += source.pathology?.incompleteCount || 0;
  target.pathology.invalidImageCount += source.pathology?.invalidImageCount || 0;
  target.pathology.verifiedCount += source.pathology?.verifiedCount || 0;
  target.pathology.unverifiedCount += source.pathology?.unverifiedCount || 0;

  for (const [k, v] of Object.entries(source.pathology?.pathologyDistribution || {})) {
    target.pathology.pathologyDistribution[k] = (target.pathology.pathologyDistribution[k] || 0) + (v as number);
  }
  for (const [k, v] of Object.entries(source.pathology?.toothDistribution || {})) {
    target.pathology.toothDistribution[k] = (target.pathology.toothDistribution[k] || 0) + (v as number);
  }

  // bugs
  target.bugs.totalBugs += source.bugs?.totalBugs || 0;
  for (const [k, v] of Object.entries(source.bugs?.severityDistribution || {})) {
    (target.bugs.severityDistribution as any)[k] = ((target.bugs.severityDistribution as any)[k] || 0) + (v as number);
  }
  for (const [k, v] of Object.entries(source.bugs?.statusDistribution || {})) {
    (target.bugs.statusDistribution as any)[k] = ((target.bugs.statusDistribution as any)[k] || 0) + (v as number);
  }
  for (const [k, v] of Object.entries(source.bugs?.sourceDistribution || {})) {
    (target.bugs.sourceDistribution as any)[k] = ((target.bugs.sourceDistribution as any)[k] || 0) + (v as number);
  }

  // users
  target.users.uniqueUsersCount += source.users?.uniqueUsersCount || 0;
  target.users.activeUsersCount += source.users?.activeUsersCount || 0;
}

export type MetricContributions = Record<string, number>;

export function getStatsBucketKeys(dateKey: string) {
  // dateKey is YYYY-MM-DD
  const monthKey = dateKey ? dateKey.substring(0, 7) : 'unknown';
  const cleanDay = dateKey || 'unknown';
  return {
    daily: `daily_${cleanDay}`,
    monthly: `monthly_${monthKey}`,
    allTime: 'all_time'
  };
}

export function reportContributions(log: any): MetricContributions {
  const result: MetricContributions = {};
  result['reports.totalSessions'] = 1;
  const invalid = isLogErrorHelper(log);
  const incomplete = isLogIncompleteHelper(log);
  const completed = !invalid && !incomplete;

  if (invalid) {
    result['reports.invalidImageCount'] = 1;
  } else if (incomplete) {
    result['reports.incompleteCount'] = 1;
  } else if (completed) {
    result['reports.completedCount'] = 1;
    result[`reports.accuracyCounts.${determineAccuracyCategory(log)}`] = 1;
    for (const key of log.finalConfirmedErrors || []) {
      if (key && key !== 'not_periapical' && CANONICAL_TECHNICAL_KEYS_SET.has(key)) {
        result[`reports.errorDistribution.${key}`] = (result[`reports.errorDistribution.${key}`] || 0) + 1;
      }
    }
  }
  return result;
}

export function pathologyContributions(log: any): MetricContributions {
  const result: MetricContributions = {};
  result['pathology.totalPathologyLogs'] = 1;
  
  const completed = log.sessionStatus === 'COMPLETED' || log.lastCompletedStep === 5 || (log.stage || '').includes('Bước 5');
  const invalid = log.sessionStatus === 'FAILED_NON_DENTAL';
  
  if (invalid) {
    result['pathology.invalidImageCount'] = 1;
  } else if (completed) {
    result['pathology.completedCount'] = 1;
  } else {
    result['pathology.incompleteCount'] = 1;
  }

  const verified = Boolean(log.isReviewedByAdmin || log.verifiedBy);
  if (verified) result['pathology.verifiedCount'] = 1;
  else result['pathology.unverifiedCount'] = 1;

  const pathologies = log.finalConfirmedPathologies || log.confirmedPathologies || log.detectedPathologies || [];
  for (const pathology of pathologies) {
    const key = pathology?.pathologyKey || pathology?.key;
    if (key && CANONICAL_PATHOLOGY_KEYS_SET.has(key)) {
      result[`pathology.pathologyDistribution.${key}`] = (result[`pathology.pathologyDistribution.${key}`] || 0) + 1;
    }
  }

  if (log.tooth?.fdiNumber) {
    result[`pathology.toothDistribution.${String(log.tooth.fdiNumber)}`] = 1;
  }
  return result;
}

export function bugContributions(bug: any): MetricContributions {
  const result: MetricContributions = {};
  result['bugs.totalBugs'] = 1;
  
  const severity = (bug.severity || 'medium').toLowerCase();
  const source = (bug.source || 'USER_SUBMITTED') === 'SYSTEM_AUTO' ? 'SYSTEM_AUTO' : 'USER_SUBMITTED';
  const status = (bug.status || 'OPEN').toUpperCase();
  
  result[`bugs.severityDistribution.${severity}`] = 1;
  result[`bugs.sourceDistribution.${source}`] = 1;
  result[`bugs.statusDistribution.${status}`] = 1;
  
  return result;
}

export function contributionDelta(previous: MetricContributions, next: MetricContributions): MetricContributions {
  const result: MetricContributions = {};
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const delta = (next[key] || 0) - (previous[key] || 0);
    if (delta !== 0) result[key] = delta;
  }
  return result;
}

export async function executeIdempotentStatsWrite(
  db: Firestore,
  collection: 'reports' | 'bugs' | 'seg_reports',
  docId: string,
  incomingData: any,
  contributionsFor: (record: any) => MetricContributions,
): Promise<void> {
  const recordRef = db.collection(collection).doc(docId);
  const dateKey = getDateKeyFromLog(incomingData);
  const buckets = getStatsBucketKeys(dateKey);
  
  await db.runTransaction(async (transaction) => {
    // --- 1. ALL READS FIRST ---
    const existingDoc = await transaction.get(recordRef);
    const existingData = existingDoc.exists ? existingDoc.data() : null;

    const rawUserId = incomingData.userId || incomingData.deviceId || incomingData.user_id || incomingData.device_id;
    const cleanUid = rawUserId && (collection === 'reports' || collection === 'seg_reports') ? String(rawUserId).trim() : '';
    const userRef = cleanUid ? db.collection(USER_STATS_COLLECTION).doc(cleanUid) : null;
    const userDoc = userRef ? await transaction.get(userRef) : null;

    // --- 2. COMPUTE CONTRIBUTIONS & DELTAS ---
    let oldDateKey = dateKey;
    if (existingData) {
      oldDateKey = getDateKeyFromLog(existingData);
    }
    const oldBuckets = getStatsBucketKeys(oldDateKey);

    const previousContribs = existingData ? contributionsFor(existingData) : {};
    const nextContribs = contributionsFor(incomingData);

    const isSameBucket = oldDateKey === dateKey;

    const applyDelta = (bucketDocId: string, delta: MetricContributions) => {
      if (Object.keys(delta).length === 0) return;
      const bucketRef = db.collection(STATS_COLLECTION).doc(bucketDocId);
      const updates = unflattenDelta(delta, true);
      transaction.set(bucketRef, updates, { merge: true });
    };

    // --- 3. ALL WRITES AFTER READS ---
    transaction.set(recordRef, incomingData, { merge: true });

    if (isSameBucket) {
      const delta = contributionDelta(previousContribs, nextContribs);
      applyDelta(buckets.allTime, delta);
      applyDelta(buckets.monthly, delta);
      applyDelta(buckets.daily, delta);
    } else {
      // Remove from old bucket
      const removeDelta = contributionDelta(previousContribs, {});
      applyDelta(oldBuckets.allTime, removeDelta);
      applyDelta(oldBuckets.monthly, removeDelta);
      applyDelta(oldBuckets.daily, removeDelta);

      // Add to new bucket
      const addDelta = contributionDelta({}, nextContribs);
      applyDelta(buckets.allTime, addDelta);
      applyDelta(buckets.monthly, addDelta);
      applyDelta(buckets.daily, addDelta);
    }

    // Update user_stats and user aggregate counters if user identifier exists
    if (userRef && userDoc) {
      const isCompleted = !isLogErrorHelper(incomingData) && !isLogIncompleteHelper(incomingData);
      const isNewUser = !userDoc.exists;
      const userData = userDoc.exists ? userDoc.data() : null;
      const prevActiveDate = userData?.lastActive || '';
      const prevActiveMonth = prevActiveDate ? prevActiveDate.substring(0, 7) : '';
      const currentMonth = dateKey ? dateKey.substring(0, 7) : '';

      // If new session write (not updating existing session document)
      if (!existingData) {
        if (isNewUser) {
          applyDelta(buckets.allTime, { 'users.uniqueUsersCount': 1 });
        }
        if (prevActiveDate !== dateKey) {
          applyDelta(buckets.daily, { 'users.activeUsersCount': 1 });
        }
        if (prevActiveMonth !== currentMonth) {
          applyDelta(buckets.monthly, { 'users.activeUsersCount': 1 });
        }
      }

      transaction.set(userRef, {
        userId: cleanUid,
        totalSessions: FieldValue.increment(existingData ? 0 : 1),
        completedSessions: FieldValue.increment(isCompleted && (!existingData || isLogIncompleteHelper(existingData) || isLogErrorHelper(existingData)) ? 1 : 0),
        lastActive: dateKey > prevActiveDate ? dateKey : (prevActiveDate || dateKey),
        lastTooth: incomingData.tooth?.fdiNumber || userData?.lastTooth || '',
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }
  });
}

export async function executeAtomicStatsBulkDelete(
  db: Firestore,
  collectionName: 'reports' | 'bugs' | 'seg_reports',
  itemsToDelete: Array<{ id: string; data?: any }>
): Promise<{ success: boolean; collection: string; deletedCount: number; error?: string }> {
  if (!db || !itemsToDelete || itemsToDelete.length === 0) {
    return { success: true, collection: collectionName, deletedCount: 0 };
  }
  try {
    const chunkSize = 200;
    let deletedCount = 0;
    
    for (let i = 0; i < itemsToDelete.length; i += chunkSize) {
      const chunk = itemsToDelete.slice(i, i + chunkSize);
      const batch = db.batch();
      
      const bucketDeltas: Record<string, MetricContributions> = {};
      const addBucketDelta = (bucket: string, deltas: MetricContributions) => {
        if (!bucketDeltas[bucket]) bucketDeltas[bucket] = {};
        for (const [k, v] of Object.entries(deltas)) {
          bucketDeltas[bucket][k] = (bucketDeltas[bucket][k] || 0) + v;
        }
      };

      for (const { id, data } of chunk) {
        batch.delete(db.collection(collectionName).doc(id));
        if (data) {
          const dateKey = getDateKeyFromLog(data);
          const buckets = getStatsBucketKeys(dateKey);
          
          let prevContribs: MetricContributions = {};
          if (collectionName === 'reports') prevContribs = reportContributions(data);
          else if (collectionName === 'bugs') prevContribs = bugContributions(data);
          else if (collectionName === 'seg_reports') prevContribs = pathologyContributions(data);

          const removeDelta = contributionDelta(prevContribs, {});
          addBucketDelta(buckets.allTime, removeDelta);
          addBucketDelta(buckets.monthly, removeDelta);
          addBucketDelta(buckets.daily, removeDelta);
        }
      }

      for (const [bucket, delta] of Object.entries(bucketDeltas)) {
        if (Object.keys(delta).length > 0) {
          const updates = unflattenDelta(delta, true);
          batch.set(db.collection(STATS_COLLECTION).doc(bucket), updates, { merge: true });
        }
      }
      
      await batch.commit();
      deletedCount += chunk.length;
    }
    
    return { success: true, collection: collectionName, deletedCount };
  } catch (err: any) {
    return { success: false, collection: collectionName, deletedCount: 0, error: err?.message || String(err) };
  }
}

export async function rebuildSystemStats(db: Firestore): Promise<SystemStatsDoc> {
  serverLog('INFO', 'SystemStatsService', '🔄 Starting full system stats rebuild from scratch...');
  
  const [reportsSnap, segReportsSnap, bugsSnap] = await Promise.all([
    db.collection('reports').get(),
    db.collection('seg_reports').get(),
    db.collection('bugs').get()
  ]);

  serverLog('INFO', 'SystemStatsService', `📊 Found raw documents: ${reportsSnap.size} reports, ${segReportsSnap.size} seg_reports, ${bugsSnap.size} bugs`);

  const bucketDeltas: Record<string, MetricContributions> = {};
  const addBucketDelta = (bucket: string, deltas: MetricContributions) => {
    if (!bucketDeltas[bucket]) bucketDeltas[bucket] = {};
    for (const [k, v] of Object.entries(deltas)) {
      bucketDeltas[bucket][k] = (bucketDeltas[bucket][k] || 0) + v;
    }
  };

  const usersMap = new Map<string, any>();
  const dailyUserSets = new Map<string, Set<string>>();
  const monthlyUserSets = new Map<string, Set<string>>();
  const allTimeUserSet = new Set<string>();

  const handleUser = (data: any) => {
    const userId = data.userId || data.deviceId || data.user_id || data.device_id;
    if (!userId || typeof userId !== 'string' || !userId.trim()) return;
    const cleanUid = userId.trim();
    allTimeUserSet.add(cleanUid);

    const dateKey = getDateKeyFromLog(data);
    const monthKey = dateKey ? dateKey.substring(0, 7) : 'unknown';

    if (!dailyUserSets.has(dateKey)) dailyUserSets.set(dateKey, new Set());
    dailyUserSets.get(dateKey)!.add(cleanUid);

    if (!monthlyUserSets.has(monthKey)) monthlyUserSets.set(monthKey, new Set());
    monthlyUserSets.get(monthKey)!.add(cleanUid);

    const isCompleted = !isLogErrorHelper(data) && !isLogIncompleteHelper(data);
    if (!usersMap.has(cleanUid)) {
      usersMap.set(cleanUid, { totalSessions: 0, completedSessions: 0, lastActive: dateKey, lastTooth: data.tooth?.fdiNumber || '' });
    }
    const usr = usersMap.get(cleanUid);
    usr.totalSessions++;
    if (isCompleted) usr.completedSessions++;
    if (dateKey > usr.lastActive) usr.lastActive = dateKey;
    if (data.tooth?.fdiNumber) usr.lastTooth = data.tooth.fdiNumber;
  };

  const processSnaps = (snap: any, type: 'reports'|'bugs'|'seg_reports') => {
    for (const doc of snap.docs) {
      const data = doc.data();
      const dateKey = getDateKeyFromLog(data);
      const buckets = getStatsBucketKeys(dateKey);
      
      let contribs: MetricContributions = {};
      if (type === 'reports') {
        contribs = reportContributions(data);
        handleUser(data);
      } else if (type === 'bugs') {
        contribs = bugContributions(data);
      } else if (type === 'seg_reports') {
        contribs = pathologyContributions(data);
        handleUser(data);
      }

      addBucketDelta(buckets.allTime, contribs);
      addBucketDelta(buckets.monthly, contribs);
      addBucketDelta(buckets.daily, contribs);
    }
  };

  processSnaps(reportsSnap, 'reports');
  processSnaps(segReportsSnap, 'seg_reports');
  processSnaps(bugsSnap, 'bugs');
  
  // Convert userMap into user_stats entries
  let currentUserBatch = db.batch();
  let userBatchCount = 0;
  const userBatches = [currentUserBatch];
  
  for (const [uid, usrData] of usersMap.entries()) {
    if (userBatchCount >= 400) {
      currentUserBatch = db.batch();
      userBatches.push(currentUserBatch);
      userBatchCount = 0;
    }
    currentUserBatch.set(db.collection(USER_STATS_COLLECTION).doc(uid), {
      userId: uid,
      ...usrData,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    userBatchCount++;
  }

  if (allTimeUserSet.size > 0) {
    if (!bucketDeltas['all_time']) bucketDeltas['all_time'] = {};
    bucketDeltas['all_time']['users.uniqueUsersCount'] = allTimeUserSet.size;
  }
  for (const [day, uSet] of dailyUserSets.entries()) {
    const bucketKey = `daily_${day}`;
    if (!bucketDeltas[bucketKey]) bucketDeltas[bucketKey] = {};
    bucketDeltas[bucketKey]['users.activeUsersCount'] = uSet.size;
  }
  for (const [month, uSet] of monthlyUserSets.entries()) {
    const bucketKey = `monthly_${month}`;
    if (!bucketDeltas[bucketKey]) bucketDeltas[bucketKey] = {};
    bucketDeltas[bucketKey]['users.activeUsersCount'] = uSet.size;
  }

  // 1. Legacy collection deletion is disabled to prevent side-effects in production.
  serverLog('INFO', 'SystemStatsService', 'ℹ️ Legacy system_metadata and system_metrics cleanup skipped.');

  // 2. Delete existing system_stats buckets
  const existingStatsSnap = await db.collection(STATS_COLLECTION).get();
  if (!existingStatsSnap.empty) {
    const deleteBatch = db.batch();
    for (const doc of existingStatsSnap.docs) {
      deleteBatch.delete(doc.ref);
    }
    await deleteBatch.commit();
  }
  
  // 3. Write new buckets
  const bucketEntries = Object.entries(bucketDeltas);
  for (let i = 0; i < bucketEntries.length; i += 200) {
    const batch = db.batch();
    const chunk = bucketEntries.slice(i, i + 200);
    for (const [bucket, delta] of chunk) {
      const statsDoc = unflattenStats(delta);
      statsDoc.updatedAt = new Date().toISOString();
      statsDoc.schemaVersion = 1;
      batch.set(db.collection(STATS_COLLECTION).doc(bucket), statsDoc, { merge: true });
    }
    await batch.commit();
  }

  // 4. Commit user batches
  for (let i = 0; i < userBatches.length; i++) {
    if (i < userBatches.length - 1 || userBatchCount > 0) {
      await userBatches[i].commit();
    }
  }

  serverLog('INFO', 'SystemStatsService', '✅ System stats rebuild complete!');
  const allTimeDoc = await db.collection(STATS_COLLECTION).doc('all_time').get();
  return allTimeDoc.exists ? unflattenStats(allTimeDoc.data()) : createEmptyStats();
}

/**
 * Targeted USER-STATS reconciliation from authoritative records without touching
 * report, pathology, or bug counters.
 */
export async function reconcileUserStatsFromAuthoritative(
  db: Firestore
): Promise<{ uniqueUsersCount: number; activeUsersCountToday: number }> {
  serverLog('INFO', 'SystemStatsService', '🔄 Starting targeted USER-STATS reconciliation from authoritative records...');

  const [reportsSnap, segReportsSnap] = await Promise.all([
    db.collection('reports').get(),
    db.collection('seg_reports').get()
  ]);

  const usersMap = new Map<string, any>();
  const dailyUserSets = new Map<string, Set<string>>();
  const monthlyUserSets = new Map<string, Set<string>>();
  const allTimeUserSet = new Set<string>();

  const processDoc = (doc: any) => {
    const data = doc.data();
    const userId = data.userId || data.deviceId || data.user_id || data.device_id;
    if (!userId || typeof userId !== 'string' || !userId.trim()) return;
    const cleanUid = userId.trim();
    allTimeUserSet.add(cleanUid);

    const dateKey = getDateKeyFromLog(data);
    const monthKey = dateKey ? dateKey.substring(0, 7) : 'unknown';

    if (!dailyUserSets.has(dateKey)) dailyUserSets.set(dateKey, new Set());
    dailyUserSets.get(dateKey)!.add(cleanUid);

    if (!monthlyUserSets.has(monthKey)) monthlyUserSets.set(monthKey, new Set());
    monthlyUserSets.get(monthKey)!.add(cleanUid);

    const isCompleted = !isLogErrorHelper(data) && !isLogIncompleteHelper(data);
    if (!usersMap.has(cleanUid)) {
      usersMap.set(cleanUid, { totalSessions: 0, completedSessions: 0, lastActive: dateKey, lastTooth: data.tooth?.fdiNumber || '' });
    }
    const usr = usersMap.get(cleanUid);
    usr.totalSessions++;
    if (isCompleted) usr.completedSessions++;
    if (dateKey > usr.lastActive) usr.lastActive = dateKey;
    if (data.tooth?.fdiNumber) usr.lastTooth = data.tooth.fdiNumber;
  };

  reportsSnap.docs.forEach(processDoc);
  segReportsSnap.docs.forEach(processDoc);

  // 1. Write user_stats entries
  let currentUserBatch = db.batch();
  let userBatchCount = 0;
  const userBatches = [currentUserBatch];

  for (const [uid, usrData] of usersMap.entries()) {
    if (userBatchCount >= 400) {
      currentUserBatch = db.batch();
      userBatches.push(currentUserBatch);
      userBatchCount = 0;
    }
    currentUserBatch.set(db.collection(USER_STATS_COLLECTION).doc(uid), {
      userId: uid,
      ...usrData,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    userBatchCount++;
  }

  for (let i = 0; i < userBatches.length; i++) {
    if (i < userBatches.length - 1 || userBatchCount > 0) {
      await userBatches[i].commit();
    }
  }

  // 2. Update system_stats buckets for users
  const bucketUpdates: Record<string, any> = {};
  bucketUpdates['all_time'] = {
    'users.uniqueUsersCount': allTimeUserSet.size,
  };

  for (const [day, uSet] of dailyUserSets.entries()) {
    const bucketKey = `daily_${day}`;
    if (!bucketUpdates[bucketKey]) bucketUpdates[bucketKey] = {};
    bucketUpdates[bucketKey]['users.activeUsersCount'] = uSet.size;
  }

  for (const [month, uSet] of monthlyUserSets.entries()) {
    const bucketKey = `monthly_${month}`;
    if (!bucketUpdates[bucketKey]) bucketUpdates[bucketKey] = {};
    bucketUpdates[bucketKey]['users.activeUsersCount'] = uSet.size;
  }

  const updateEntries = Object.entries(bucketUpdates);
  for (let i = 0; i < updateEntries.length; i += 200) {
    const batch = db.batch();
    const chunk = updateEntries.slice(i, i + 200);
    for (const [bucket, delta] of chunk) {
      const updates = unflattenDelta(delta, false);
      batch.set(db.collection(STATS_COLLECTION).doc(bucket), updates, { merge: true });
    }
    await batch.commit();
  }

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayActive = dailyUserSets.get(todayStr)?.size || 0;

  serverLog('INFO', 'SystemStatsService', `✅ Targeted user stats reconciliation complete! Unique users: ${allTimeUserSet.size}, Today active: ${todayActive}`);
  return { uniqueUsersCount: allTimeUserSet.size, activeUsersCountToday: todayActive };
}

export async function aggregateStatsForDateRange(
  db: Firestore | null | undefined,
  options?: {
    preset?: string;
    startDate?: string;
    endDate?: string;
  }
): Promise<SystemStatsDoc> {
  if (!db) {
    return createEmptyStats();
  }

  const preset = options?.preset || 'all';
  const startDate = options?.startDate;
  const endDate = options?.endDate;

  const today = new Date();
  const formatYmd = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const todayKey = `daily_${formatYmd(today)}`;

  // Single-read fast path for All Time
  if (preset === 'all' && !startDate && !endDate) {
    const [allTime, todaySnap] = await Promise.all([
      db.collection(STATS_COLLECTION).doc('all_time').get(),
      db.collection(STATS_COLLECTION).doc(todayKey).get(),
    ]);
    const result = allTime.exists ? unflattenStats(allTime.data()) : createEmptyStats();
    if (todaySnap.exists) {
      const todayStats = unflattenStats(todaySnap.data());
      result.users.activeUsersCount = todayStats.users?.activeUsersCount || 0;
    }
    return result;
  }

  let startKey = startDate || '';
  let endKey = endDate || '';

  if (preset === 'today') {
    startKey = formatYmd(today);
    endKey = formatYmd(today);
  } else if (preset === '7days') {
    const d = new Date(today);
    d.setDate(d.getDate() - 6);
    startKey = formatYmd(d);
    endKey = formatYmd(today);
  } else if (preset === '30days') {
    const d = new Date(today);
    d.setDate(d.getDate() - 29);
    startKey = formatYmd(d);
    endKey = formatYmd(today);
  }

  if (!startKey && !endKey) {
    const [allTime, todaySnap] = await Promise.all([
      db.collection(STATS_COLLECTION).doc('all_time').get(),
      db.collection(STATS_COLLECTION).doc(todayKey).get(),
    ]);
    const result = allTime.exists ? unflattenStats(allTime.data()) : createEmptyStats();
    if (todaySnap.exists) {
      const todayStats = unflattenStats(todaySnap.data());
      result.users.activeUsersCount = todayStats.users?.activeUsersCount || 0;
    }
    return result;
  }

  const result = createEmptyStats();
  const start = new Date(startKey);
  const end = new Date(endKey);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return result;
  }
  
  // Generate daily bucket IDs
  const days: string[] = [];
  const curr = new Date(start);
  while (curr <= end) {
    days.push(`daily_${formatYmd(curr)}`);
    curr.setDate(curr.getDate() + 1);
  }

  // Fetch only the daily documents in chunks of 100 via getAll
  for (let i = 0; i < days.length; i += 100) {
    const chunk = days.slice(i, i + 100);
    try {
      const snaps = await db.getAll(...chunk.map(id => db.collection(STATS_COLLECTION).doc(id)));
      for (const snap of snaps) {
        if (snap.exists) {
          mergeStats(result, unflattenStats(snap.data()));
        }
      }
    } catch (e) {
      serverLog('WARN', 'StatsAggregation', 'Failed to fetch daily stats chunk:', e);
    }
  }

  // Ensure uniqueUsersCount is available from all_time
  if (result.users.uniqueUsersCount === 0) {
    try {
      const allTimeSnap = await db.collection(STATS_COLLECTION).doc('all_time').get();
      if (allTimeSnap.exists) {
        const allTimeStats = unflattenStats(allTimeSnap.data());
        result.users.uniqueUsersCount = allTimeStats.users?.uniqueUsersCount || 0;
      }
    } catch (e) {
      // Ignored
    }
  }

  return result;
}
