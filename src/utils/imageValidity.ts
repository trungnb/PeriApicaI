import {
  AnalysisWorkspaceSnapshot,
  AppEngineMode,
  ImageValidityResult,
  ReceptorType,
  TechniqueType,
  ValidityGateDecision,
  ValidityGateState,
  ValidityReceipt,
  TargetToothMatchStatus,
  RadiographOrientationStatus,
} from '../types/dental';
import { isValidFdi } from '../server/middleware/validation';

/**
 * Validates raw model output against the ImageValidityResult schema.
 * Performs strict runtime type checking, enum verification, and FDI bounds clamping.
 * Returns null if the payload is malformed or invalid.
 */
export function validateImageValidityOutput(raw: any): ImageValidityResult | null {
  if (!raw || typeof raw !== 'object') return null;

  // Strict boolean validation
  if (typeof raw.isPeriapicalRadiograph !== 'boolean') return null;
  if (typeof raw.isAssessable !== 'boolean') return null;
  if (typeof raw.targetToothVisible !== 'boolean') return null;

  // Strict enum checking for targetToothMatch
  const validMatchValues: TargetToothMatchStatus[] = ['match', 'mismatch', 'uncertain', 'not_assessable'];
  if (!validMatchValues.includes(raw.targetToothMatch)) {
    return null;
  }

  // Strict enum checking for orientation
  const validOrientationValues: RadiographOrientationStatus[] = ['plausible', 'possibly_incorrect', 'uncertain', 'not_assessable'];
  if (!validOrientationValues.includes(raw.orientation)) {
    return null;
  }

  // Validate detected tooth candidates: must be canonical FDI numbers, bounded to max 5
  const rawCandidates = Array.isArray(raw.detectedToothCandidates)
    ? raw.detectedToothCandidates
    : [];

  const validCandidates: number[] = [];
  const seen = new Set<number>();

  for (const item of rawCandidates) {
    const num = typeof item === 'number' ? item : parseInt(String(item), 10);
    if (!isNaN(num) && isValidFdi(String(num)) && !seen.has(num)) {
      seen.add(num);
      validCandidates.push(num);
      if (validCandidates.length >= 5) break;
    }
  }

  return {
    isPeriapicalRadiograph: raw.isPeriapicalRadiograph,
    isAssessable: raw.isAssessable,
    targetToothVisible: raw.targetToothVisible,
    targetToothMatch: raw.targetToothMatch,
    detectedToothCandidates: validCandidates,
    orientation: raw.orientation,
  };
}

/**
 * Evaluates the categorical validity decision from a validated ImageValidityResult.
 *
 * Decision hierarchy:
 * 1. Clearly non-periapical: invalid ('not_periapical')
 * 2. Non-assessable: invalid ('not_assessable')
 * 3. Target tooth absent: invalid ('target_absent')
 * 4. Definite FDI mismatch: invalid ('mismatch')
 * 5. Not assessable FDI match: invalid ('not_assessable')
 * 6. Uncertain FDI match: warning ('uncertain')
 * 7. Matching FDI: valid
 *
 * Note: Orientation is supporting metadata. Orientation uncertainty or possible incorrectness
 * does not by itself convert an otherwise valid image into an invalid state.
 */
export function evaluateValidityDecision(result?: ImageValidityResult | null): ValidityGateDecision {
  if (!result) {
    return { state: 'unavailable' };
  }

  if (!result.isPeriapicalRadiograph) {
    return { state: 'invalid', issue: 'not_periapical' };
  }

  if (!result.isAssessable) {
    return { state: 'invalid', issue: 'not_assessable' };
  }

  if (!result.targetToothVisible) {
    return { state: 'invalid', issue: 'target_absent' };
  }

  if (result.targetToothMatch === 'mismatch') {
    return { state: 'invalid', issue: 'mismatch' };
  }

  if (result.targetToothMatch === 'not_assessable') {
    return { state: 'invalid', issue: 'not_assessable' };
  }

  if (result.targetToothMatch === 'uncertain') {
    return { state: 'warning', issue: 'uncertain' };
  }

  if (result.targetToothMatch === 'match') {
    return { state: 'valid' };
  }

  // Default fallback for any unexpected condition
  return { state: 'warning', issue: 'uncertain' };
}

/**
 * Deterministically constructs user-facing presentation messages from structured validity decisions.
 * Precedence is strictly inherited from evaluateValidityDecision hierarchy.
 */
export function getDeterministicValidityMessage(
  decision: ValidityGateDecision,
  language: 'VI' | 'EN' = 'VI',
  targetToothFdi?: string
): string {
  const isEn = language === 'EN';
  if (decision.state === 'unavailable') {
    return isEn ? 'Could not verify image suitability at this time.' : 'Không thể kiểm tra tính hợp lệ của ảnh lúc này.';
  }
  if (decision.state === 'warning') {
    const toothLabel = targetToothFdi ? (isEn ? `Tooth ${targetToothFdi}` : `Răng ${targetToothFdi}`) : (isEn ? 'target tooth' : 'răng mục tiêu');
    return isEn
      ? `The AI cannot verify with certainty that ${toothLabel} matches the visible anatomy. Please confirm to proceed.`
      : `AI chưa thể xác minh chắc chắn rằng ${toothLabel} khớp với hình ảnh. Vui lòng xác nhận nếu bạn muốn tiếp tục.`;
  }
  if (decision.state === 'invalid') {
    switch (decision.issue) {
      case 'not_periapical':
        return isEn
          ? 'The uploaded image does not appear to be an intraoral periapical radiograph. Please replace with a valid periapical image.'
          : 'Ảnh không phải là phim chụp quanh chóp (cận chóp). Vui lòng chọn ảnh phim quanh chóp chuẩn.';
      case 'not_assessable':
        return isEn
          ? 'The image is not assessable due to severe blur, blankness, or corruption. Please upload a clear radiograph.'
          : 'Ảnh không thể đánh giá được do quá mờ, trống hoặc bị hỏng. Vui lòng chọn ảnh chụp rõ nét hơn.';
      case 'target_absent': {
        const absentTooth = targetToothFdi ? (isEn ? `Tooth ${targetToothFdi}` : `Răng ${targetToothFdi}`) : (isEn ? 'target tooth' : 'răng mục tiêu');
        return isEn
          ? `The target tooth region (${absentTooth}) is absent or out of frame. Please select another tooth or replace the image.`
          : `Vùng răng mục tiêu (${absentTooth}) không có trong ảnh. Vui lòng chọn lại răng hoặc đổi ảnh.`;
      }
      case 'mismatch': {
        const mismatchTooth = targetToothFdi ? (isEn ? `Tooth ${targetToothFdi}` : `Răng ${targetToothFdi}`) : (isEn ? 'target tooth' : 'răng mục tiêu');
        return isEn
          ? `Visible tooth anatomy contradicts selected ${mismatchTooth}. Please verify tooth selection or replace the image.`
          : `Giải phẫu răng trong ảnh không khớp với ${mismatchTooth} đã chọn. Vui lòng kiểm tra lại răng đã chọn hoặc đổi ảnh.`;
      }
      default:
        return isEn
          ? 'The uploaded image is not suitable for clinical analysis.'
          : 'Ảnh tải lên chưa phù hợp để phân tích lâm sàng.';
    }
  }
  return isEn ? 'Image suitability verified.' : 'Đã xác minh hình ảnh phù hợp.';
}

/**
 * A client-side affordance guard for analysis controls. The server remains the
 * authority through its R29 receipt verification; this prevents a stale or
 * in-progress client workspace from starting an analysis request at all.
 */
export function canProceedWithValidity(context: {
  validityGateState: ValidityGateState;
  validityReceipt: ValidityReceipt | null;
  validityConfirmedSnapshot: AnalysisWorkspaceSnapshot | null;
  imageDataUrl: string | null;
  toothFdi: string;
  assessmentId: string;
  technique: TechniqueType;
  receptor: ReceptorType;
  mode: AppEngineMode;
}): boolean {
  const snapshot = context.validityConfirmedSnapshot;
  return (context.validityGateState === 'valid' || context.validityGateState === 'user_confirmed')
    && Boolean(context.validityReceipt)
    && Boolean(snapshot)
    && snapshot.toothFdi === context.toothFdi
    && snapshot.imageDataUrl === context.imageDataUrl
    && snapshot.assessmentId === context.assessmentId
    && snapshot.technique === context.technique
    && snapshot.receptor === context.receptor
    && snapshot.mode === context.mode;
}
