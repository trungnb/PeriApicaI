import { AssessmentLogPayload } from '../types/dental';

export type AccuracyCategory = 'EXACT_MATCH' | 'MOSTLY_ACCURATE' | 'PARTIALLY_ACCURATE' | 'INACCURATE';

export const getAccuracyCategory = (log: AssessmentLogPayload): AccuracyCategory => {
  const aiKeys = new Set<string>();
  log.aiAnalysis?.findings?.forEach((f) => {
    f.detectedErrors?.forEach((e) => {
      if (e.errorKey) aiKeys.add(e.errorKey);
    });
  });
  const finalKeys = new Set<string>(
    (log.finalConfirmedErrors || []).filter((k) => k !== 'not_periapical')
  );

  const aiArray = Array.from(aiKeys);
  const finalArray = Array.from(finalKeys);
  const intersection = aiArray.filter(x => finalKeys.has(x)).length;
  const union = new Set([...aiArray, ...finalArray]).size;

  if (union === 0 || intersection === union || log.userValidation?.concurred) {
    return 'EXACT_MATCH';
  }
  if (intersection === 0) {
    return 'INACCURATE';
  }
  if (Math.abs(aiArray.length - finalArray.length) <= 1) {
    return 'MOSTLY_ACCURATE';
  }
  return 'PARTIALLY_ACCURATE';
};

export const ACCURACY_CATEGORY_CONFIG: Record<AccuracyCategory, {
  colorClass: string;
  badgeClass: string;
}> = {
  EXACT_MATCH: {
    colorClass: 'bg-emerald-500',
    badgeClass: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  },
  MOSTLY_ACCURATE: {
    colorClass: 'bg-blue-500',
    badgeClass: 'bg-blue-100 text-blue-700 border border-blue-200',
  },
  PARTIALLY_ACCURATE: {
    colorClass: 'bg-amber-500',
    badgeClass: 'bg-amber-100 text-amber-700 border border-amber-200',
  },
  INACCURATE: {
    colorClass: 'bg-rose-500',
    badgeClass: 'bg-rose-100 text-rose-700 border border-rose-200',
  },
};

export const isLogAdminVerified = (log: AssessmentLogPayload) => {
  return Boolean(
    log.technicalEvaluation?.reviewState === 'reviewed' ||
    log.userValidation?.userNotes?.includes('Admin') || 
    log.verifiedNotes?.includes('Admin') || 
    log.verifiedBy === 'Admin' ||
    (log.accuracyScore && log.accuracyScore.includes('Admin ⭐'))
  );
};

export const getCleanConfirmedErrors = (log: AssessmentLogPayload): string[] => {
  return (log.finalConfirmedErrors || []).filter((k) => k !== 'not_periapical');
};
