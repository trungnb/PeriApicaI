import { providerExecutionConfig, isTerminalExecutionError } from './geminiService';
import { Type, GoogleGenAI } from '@google/genai';
import { LRUCache } from 'lru-cache';
import { executeWithFailover, ExecutionBudget, isRateLimitOrQuotaError, isTransientError, isInvalidApiKeyError } from './geminiService';
import { PATHOLOGY_DICT } from '../../constants/dictionaries';
import { validatePathologyOutput } from '../../utils/semanticValidation';
import { randomUUID } from 'crypto';
import { createInferenceLineage } from './inferenceLineage';
import type { InferenceLineage } from '../../types/dental';
import { resetAssessmentSnapshotsForTests, type RoleModelAssignment } from './assessmentModelSnapshot';

export interface SegmentPathologyOptions {
  assessmentId?: string;
  roleA?: RoleModelAssignment;
  roleB?: RoleModelAssignment;
}

export interface PathologySegmentResult {
  overallSummary: string;
  observationChain?: string[];
  pathologies: Array<{
    id?: string;
    key: string;
    confidence: number;
    modelAScore?: number;
    modelBScore?: number;
    polygon_points: number[][];
    geometryStatus?: 'valid' | 'unavailable' | 'malformed';
    clinicalNote: string;
    treatmentRecommendation: string;
    provenance?: 'matched_consensus' | 'model_a_only' | 'model_b_only' | 'single_mode';
    humanReviewed?: boolean;
  }>;
  inferenceLineage?: InferenceLineage;
}

export interface SegmentPathologyServiceResponse {
  success: boolean;
  result?: PathologySegmentResult;
  usedModel?: string;
  isCustomKeyFailed?: boolean;
  isAllExhausted?: boolean;
  isQuotaExhausted?: boolean;
  isTransient?: boolean;
  error?: string;
}

/**
 * The model never owns lesion identity. Once semantic validation and optional
 * consensus synthesis are complete, this server boundary assigns an opaque ID
 * to each final lesion before transport or caching.
 */
export function assignServerLesionIds(result: PathologySegmentResult): PathologySegmentResult {
  const seen = new Set<string>();
  return {
    ...result,
    pathologies: result.pathologies.map((pathology) => {
      const existingId = typeof pathology.id === 'string' ? pathology.id.trim() : '';
      // Existing canonical IDs are immutable. Only newly issued IDs must be
      // made unique within this finalized server response.
      if (existingId) {
        seen.add(existingId);
        return { ...pathology, id: existingId };
      }
      let id = `lesion_${randomUUID()}`;
      while (seen.has(id)) id = `lesion_${randomUUID()}`;
      seen.add(id);
      return { ...pathology, id };
    }),
  };
}

// ─── Pathology Cache ─────────────────────────────────────────
export const pathologyVerifyCache = new LRUCache<string, PathologySegmentResult>({
  max: 100,
  ttl: 1000 * 60 * 60 * 6, // 6 hours
});

const originalPathologyCacheClear = pathologyVerifyCache.clear.bind(pathologyVerifyCache);
pathologyVerifyCache.clear = () => {
  resetAssessmentSnapshotsForTests();
  return originalPathologyCacheClear();
};

// ─── 8-Class Standardized Schema with CoT & Polygon Contours ────
export const PATHOLOGY_SEGMENT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    overallSummary: {
      type: Type.STRING,
      description: 'Concise clinical summary of detected structures & pathologies.',
    },
    observationChain: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Step-by-step observation chain evaluating bone, teeth, and restorations.',
    },
    pathologies: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          key: {
            type: Type.STRING,
            enum: [
              'periapical_radiolucency',
              'alveolar_bone_loss',
              'enamel_radiolucency',
              'dentin_radiolucency',
              'crown_restoration',
              'filling_restoration',
              'root_canal_filling',
              'dental_implant',
            ],
            description: 'Standardized pathology or anatomical finding key.',
          },
          confidence: {
            type: Type.NUMBER,
            description: 'Confidence score (0-100).',
          },
          polygon_points: {
            type: Type.ARRAY,
            items: {
              type: Type.ARRAY,
              items: { type: Type.INTEGER },
              description: '[y, x] normalized integer point (0-1000).',
            },
            description: 'Ordered 8-20 [y, x] polygon boundary vertices.',
          },
        },
        required: ['key', 'confidence', 'polygon_points'],
      },
      description: 'Detected pathologies/structures with 2D spatial polygon contours.',
    },
  },
  required: ['overallSummary', 'observationChain', 'pathologies'],
};

// ─── System Instruction (v2.0 Single-Pass CoT & Spatial Grounding) ───────
export function buildPathologyInstruction(
  toothFdi: string,
  outputLanguage: string,
): string {
  const isEn = outputLanguage === 'EN' || outputLanguage === 'en' || outputLanguage === 'English' || String(outputLanguage).toUpperCase() === 'EN';
  const langPrompt = isEn ? 'English' : 'Tiếng Việt';

  return `You are a Board-Certified Oral and Maxillofacial Radiologist and Dental AI Spatial Grounding Specialist.

TASK: Perform a Single-Pass Chain-of-Thought (CoT) clinical reasoning process and precise 2D spatial polygon segmentation on this dental periapical radiograph for target tooth FDI ${toothFdi}.

SINGLE-PASS CHAIN-OF-THOUGHT (CoT) WORKFLOW:

STAGE 1 — DIAGNOSTIC REASONING OBSERVATIONS (Fill 'observationChain'):
Perform step-by-step visual inspections before outputting spatial polygons. Write 3-5 clear text statements into 'observationChain':
1. Periapical Bone Status: Inspect the root apex of FDI ${toothFdi}. Is the lamina dura continuous? Is there a radiolucent lesion or widened PDL?
2. Alveolar Bone Crest: Inspect the crestal bone margin relative to the CEJ (is it > 2mm below CEJ indicating horizontal/vertical bone loss?).
3. Crown & Proximal Surfaces: Inspect enamel and dentin for carious demineralization or radiolucent notches.
4. Restorations & Materials: Identify radiopaque materials (composite/amalgam fillings, ceramic crowns, gutta-percha root canal fillings, dental implants).

STAGE 2 — 2D SPATIAL POLYGON CONTOURING (Fill 'pathologies'):
For every identified structure or pathology from Stage 1, trace a tight, organic, closed boundary contour as an array of 8 to 20 normalized [y, x] integer points in 'polygon_points' (scale 0 to 1000 where [0,0] is top-left and [1000,1000] is bottom-right).
Only return 'key', 'confidence', and 'polygon_points'. DO NOT write text descriptions or clinical notes for individual findings.

STANDARDIZED 8-CLASS TAXONOMY:
1. 'periapical_radiolucency': Radiolucent area surrounding root apex (loss of lamina dura, widened PDL, periapical periodontitis / lesion).
2. 'alveolar_bone_loss': Alveolar bone crest residing > 2mm apical to the CEJ (horizontal or vertical bone destruction).
3. 'enamel_radiolucency': Demineralization / carious defect confined strictly within the outer enamel layer.
4. 'dentin_radiolucency': Radiolucent lesion penetrating through the DEJ into the dentin structure.
5. 'crown_restoration': Full coverage artificial porcelain/metal crown on tooth.
6. 'filling_restoration': Amalgam, composite, or GIC restorative filling in crown/proximal surfaces.
7. 'root_canal_filling': Radiopaque obturation material (gutta-percha) inside the pulp root canal.
8. 'dental_implant': Titanium screw implant fixture in the alveolar bone.

OUTPUT RULES:
1. Language: Write overallSummary and observationChain in ${langPrompt}.
2. Ensure high coordinate precision following the exact curvature of the lesion/structure.
`;
}

// ─── Helper functions for Bounding Box IoU (BB-IoU) Spatial Matching ───
function getBoundingBox(points: number[][]) {
  if (!Array.isArray(points) || points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of points) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const [y, x] = pt;
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return minX === Infinity ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY };
}

function calculateIoU(box1: any, box2: any) {
  const xA = Math.max(box1.minX, box2.minX);
  const yA = Math.max(box1.minY, box2.minY);
  const xB = Math.min(box1.maxX, box2.maxX);
  const yB = Math.min(box1.maxY, box2.maxY);

  const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  if (interArea === 0) return 0;

  const box1Area = (box1.maxX - box1.minX) * (box1.maxY - box1.minY);
  const box2Area = (box2.maxX - box2.minX) * (box2.maxY - box2.minY);

  return interArea / (box1Area + box2Area - interArea);
}

/**
 * Maps the flat optimized pathology response from Gemini back to the legacy schema structure.
 * Localizes descriptions and treatment protocols using PATHOLOGY_DICT for 100% backward compatibility.
 */
export function mapOptimizedPathologyToLegacy(optimized: any, language: string): any {
  if (!optimized) return null;
  const isEn = language === 'EN' || language === 'en' || language === 'English' || String(language).toUpperCase() === 'EN';
  
  const rawPathologies = Array.isArray(optimized.pathologies) ? optimized.pathologies : [];

  const mappedPathologies = rawPathologies.map((path: any) => {
    const dictItem = PATHOLOGY_DICT[path.key as keyof typeof PATHOLOGY_DICT];
    const clinicalNote = dictItem
      ? (isEn ? dictItem.descriptionEn || dictItem.description : dictItem.description)
      : (isEn ? 'Radiographic pathology or structure detected.' : 'Phát hiện tổn thương hoặc cấu trúc giải phẫu.');
    const treatmentRecommendation = dictItem
      ? (isEn ? dictItem.protocol?.primaryTreatmentEn || dictItem.protocol?.primaryTreatment : dictItem.protocol?.primaryTreatment)
      : (isEn ? 'Clinical follow-up or monitoring advised.' : 'Khuyến nghị theo dõi lâm sàng.');

    const points = Array.isArray(path.polygon_points) ? path.polygon_points : [];
    const hasGeom = points.length >= 3;
    let geometryStatus = path.geometryStatus;
    if (!geometryStatus) {
      geometryStatus = hasGeom ? 'valid' : (points.length > 0 ? 'malformed' : 'unavailable');
    }

    return {
      ...(typeof path.id === 'string' && path.id.trim() ? { id: path.id.trim() } : {}),
      key: path.key,
      confidence: (typeof path.confidence === 'number' && Number.isFinite(path.confidence)) ? path.confidence : undefined,
      modelAScore: typeof path.modelAScore === 'number' ? path.modelAScore : undefined,
      modelBScore: typeof path.modelBScore === 'number' ? path.modelBScore : undefined,
      polygon_points: hasGeom ? points : [],
      geometryStatus,
      clinicalNote,
      treatmentRecommendation,
      provenance: path.provenance || 'single_mode',
    };
  });

  return {
    overallSummary: optimized.overallSummary || '',
    observationChain: optimized.observationChain || [],
    pathologies: mappedPathologies,
  };
}

/**
 * Synthesizes 2D pathology findings and spatial polygons from two concurrent models (e.g. Pro & Flash)
 * using Spatial BB-IoU Matching and Point Density Selection.
 * Findings are preserved even if polygon localisation fails.
 */
export function synthesizePathologyConsensus(
  resA: PathologySegmentResult,
  resB: PathologySegmentResult,
  isEn: boolean
): PathologySegmentResult {
  // Combine observation chains
  const obsA = Array.isArray(resA.observationChain) ? resA.observationChain : [];
  const obsB = Array.isArray(resB.observationChain) ? resB.observationChain : [];
  const mergedObservationChain = Array.from(new Set([...obsA, ...obsB]));

  // Combine overall summary cleanly
  const sumA = resA.overallSummary || '';
  const sumB = resB.overallSummary || '';
  const overallSummary = sumA && sumB
    ? (sumA === sumB ? sumA : `${sumA} ${sumB}`)
    : (sumA || sumB || (isEn ? 'Consensus pathology evaluation complete.' : 'Đã hoàn tất đánh giá hội chẩn bất thường.'));

  const pathsA = Array.isArray(resA.pathologies) ? resA.pathologies : [];
  const pathsB = Array.isArray(resB.pathologies) ? resB.pathologies : [];

  const mergedPathologies: PathologySegmentResult['pathologies'] = [];
  const handledBIndices = new Set<number>();

  // Process findings from Model A
  for (const itemA of pathsA) {
    const hasGeomA = Array.isArray(itemA.polygon_points) && itemA.polygon_points.length >= 3;
    const boxA = hasGeomA ? getBoundingBox(itemA.polygon_points) : null;
    let bestMatchIdx = -1;
    let highestIoU = 0;
    let fallbackSemanticMatchIdx = -1;

    for (let i = 0; i < pathsB.length; i++) {
      if (handledBIndices.has(i)) continue;
      const itemB = pathsB[i];
      if (itemB.key === itemA.key) {
        const hasGeomB = Array.isArray(itemB.polygon_points) && itemB.polygon_points.length >= 3;
        if (hasGeomA && hasGeomB && boxA) {
          const boxB = getBoundingBox(itemB.polygon_points);
          const iou = calculateIoU(boxA, boxB);
          // IoU threshold > 0.4 confirms they are looking at the same physical lesion
          if (iou > 0.4 && iou > highestIoU) {
            highestIoU = iou;
            bestMatchIdx = i;
          }
        } else if (!hasGeomA || !hasGeomB) {
          // If one or both models lack usable polygon geometry for this key on the target tooth,
          // record a semantic candidate match
          if (fallbackSemanticMatchIdx === -1) {
            fallbackSemanticMatchIdx = i;
          }
        }
      }
    }

    const matchIdx = bestMatchIdx !== -1 ? bestMatchIdx : fallbackSemanticMatchIdx;

    if (matchIdx !== -1) {
      // Both models detected this pathology key (High Consensus)
      const matchB = pathsB[matchIdx];
      handledBIndices.add(matchIdx);
      
      const confA = typeof itemA.confidence === 'number' && Number.isFinite(itemA.confidence) ? itemA.confidence : 0;
      const confB = typeof matchB.confidence === 'number' && Number.isFinite(matchB.confidence) ? matchB.confidence : 0;
      const mergedConfidence = Math.round((confA + confB) / 2);
      
      const lenA = (itemA.polygon_points && itemA.polygon_points.length >= 3) ? itemA.polygon_points.length : 0;
      const lenB = (matchB.polygon_points && matchB.polygon_points.length >= 3) ? matchB.polygon_points.length : 0;
      
      let chosenPolygon: number[][] = [];
      let geometryStatus: 'valid' | 'unavailable' | 'malformed' = 'unavailable';

      if (lenA >= 3 && lenB >= 3) {
        // Point Density: prefer polygon with more points
        chosenPolygon = lenA >= lenB ? itemA.polygon_points : matchB.polygon_points;
        geometryStatus = 'valid';
      } else if (lenA >= 3) {
        chosenPolygon = itemA.polygon_points;
        geometryStatus = 'valid';
      } else if (lenB >= 3) {
        chosenPolygon = matchB.polygon_points;
        geometryStatus = 'valid';
      } else {
        chosenPolygon = [];
        geometryStatus = (itemA.geometryStatus === 'malformed' || matchB.geometryStatus === 'malformed')
          ? 'malformed'
          : 'unavailable';
      }
      
      const higherConfItem = confA >= confB ? itemA : matchB;

      mergedPathologies.push({
        key: itemA.key,
        confidence: mergedConfidence,
        modelAScore: confA,
        modelBScore: confB,
        polygon_points: chosenPolygon,
        geometryStatus,
        clinicalNote: higherConfItem.clinicalNote || itemA.clinicalNote,
        treatmentRecommendation: higherConfItem.treatmentRecommendation || itemA.treatmentRecommendation,
        provenance: 'matched_consensus'
      });
      } else if ((typeof itemA.confidence === 'number' && Number.isFinite(itemA.confidence) ? itemA.confidence : 0) >= 65) {
      // Single-model detection preserved if confidence >= 65%
      const hasGeom = Array.isArray(itemA.polygon_points) && itemA.polygon_points.length >= 3;
      mergedPathologies.push({
        ...itemA,
        confidence: itemA.confidence,
        polygon_points: hasGeom ? itemA.polygon_points : [],
        geometryStatus: itemA.geometryStatus || (hasGeom ? 'valid' : (itemA.polygon_points?.length ? 'malformed' : 'unavailable')),
        modelAScore: itemA.confidence,
        modelBScore: undefined,
        provenance: 'model_a_only'
      });
    }
  }

  // Process remaining unmatched findings from Model B
  for (let i = 0; i < pathsB.length; i++) {
    if (!handledBIndices.has(i)) {
      const itemB = pathsB[i];
      if ((typeof itemB.confidence === 'number' && Number.isFinite(itemB.confidence) ? itemB.confidence : 0) >= 65) {
        const hasGeom = Array.isArray(itemB.polygon_points) && itemB.polygon_points.length >= 3;
        mergedPathologies.push({
          ...itemB,
          confidence: itemB.confidence,
          polygon_points: hasGeom ? itemB.polygon_points : [],
          geometryStatus: itemB.geometryStatus || (hasGeom ? 'valid' : (itemB.polygon_points?.length ? 'malformed' : 'unavailable')),
          modelAScore: undefined,
          modelBScore: itemB.confidence,
          provenance: 'model_b_only'
        });
      }
    }
  }

  return {
    overallSummary,
    observationChain: mergedObservationChain,
    pathologies: mergedPathologies,
  };
}

// ─── Main Execution Function ──────────────────────────────────
export async function segmentPathologyWithGemini(
  imageBase64: string,
  mimeType: string,
  toothFdi: string,
  outputLanguage: string,
  preferredModel?: string,
  customApiKey?: string,
  onStatusUpdate?: (status: string) => void,
  analysisMode?: string,
  selectedModelB?: string,
  externalBudget?: ExecutionBudget,
  options?: SegmentPathologyOptions
): Promise<SegmentPathologyServiceResponse> {
  const isEn = outputLanguage === 'EN' || outputLanguage === 'en' || outputLanguage === 'English' || String(outputLanguage).toUpperCase() === 'EN';
  const systemInstruction = buildPathologyInstruction(toothFdi, outputLanguage);
  const promptText = `Analyze this periapical radiograph for FDI ${toothFdi}. Perform Single-Pass CoT observation and segment all 8 standardized pathological & anatomical structures with exact [y, x] polygon boundary contours.`;

  const imagePart = {
    inlineData: {
      mimeType: mimeType === 'image/svg+xml' ? 'image/jpeg' : mimeType,
      data: imageBase64,
    },
  };

  try {
    const budget = externalBudget || new ExecutionBudget(
      4,
      undefined,
      analysisMode === 'consensus' ? 2 : 4
    );

    if (analysisMode === 'consensus') {
      // -------------------------------------------------------------
      // PARALLEL CONSENSUS PIPELINE (Model A & Model B in Parallel)
      // -------------------------------------------------------------
      const modelA = preferredModel || 'gemini-flash-latest';
      const modelB = selectedModelB || 'gemini-flash-lite-latest';

      onStatusUpdate?.(isEn 
        ? `👥 Initializing Parallel Consensus Vision Pipeline (${modelA} + ${modelB})...` 
        : `👥 Đang khởi chạy Luồng Phân tích Song song (${modelA} + ${modelB})...`);

      const [resA, resB] = await Promise.allSettled([
        executeWithFailover(
          async (aiClient: GoogleGenAI, modelName: string) => {
            onStatusUpdate?.(isEn 
              ? `🔬 Querying Model 1 (${modelName})...` 
              : `🔬 Đang phân tích Mô hình 1 (${modelName})...`);
            const response = await aiClient.models.generateContent({
              model: modelName,
              contents: { parts: [imagePart, { text: promptText }] },
              config: {
                ...providerExecutionConfig(budget),
                systemInstruction,
                temperature: 0.0,
                responseMimeType: 'application/json',
                responseSchema: PATHOLOGY_SEGMENT_SCHEMA,
              },
            });
            budget.checkSignal();
            if (!response.text) throw new Error('Empty response from Model 1');
            return validatePathologyOutput(JSON.parse(response.text));
          },
          modelA,
          customApiKey,
          onStatusUpdate,
          budget,
          'branchA',
          options?.roleA?.credentialPreference,
          {
            role: 'pathology_branch_a',
            modelLadder: options?.roleA?.modelLadder,
            configRevision: options?.roleA?.compatibilityConfigIdentity,
            credentialAffinity: options?.roleA?.credentialPreference,
            assessmentId: options?.assessmentId,
          }
        ),
        executeWithFailover(
          async (aiClient: GoogleGenAI, modelName: string) => {
            onStatusUpdate?.(isEn 
              ? `🔬 Querying Model 2 (${modelName})...` 
              : `🔬 Đang phân tích Mô hình 2 (${modelName})...`);
            const response = await aiClient.models.generateContent({
              model: modelName,
              contents: { parts: [imagePart, { text: promptText }] },
              config: {
                ...providerExecutionConfig(budget),
                systemInstruction,
                temperature: 0.0,
                responseMimeType: 'application/json',
                responseSchema: PATHOLOGY_SEGMENT_SCHEMA,
              },
            });
            budget.checkSignal();
            if (!response.text) throw new Error('Empty response from Model 2');
            return validatePathologyOutput(JSON.parse(response.text));
          },
          modelB,
          customApiKey,
          onStatusUpdate,
          budget,
          'branchB',
          options?.roleB?.credentialPreference,
          {
            role: 'pathology_branch_b',
            modelLadder: options?.roleB?.modelLadder,
            configRevision: options?.roleB?.compatibilityConfigIdentity,
            credentialAffinity: options?.roleB?.credentialPreference,
            assessmentId: options?.assessmentId,
          }
        ),
      ]);

      budget.checkSignal();
      const fulfilledA = resA.status === 'fulfilled' ? resA.value : null;
      const fulfilledB = resB.status === 'fulfilled' ? resB.value : null;

      const resultA = fulfilledA ? (fulfilledA.result as PathologySegmentResult) : null;
      const resultB = fulfilledB ? (fulfilledB.result as PathologySegmentResult) : null;

      if (!resultA && !resultB) {
        const reasonA: any = resA.status === 'rejected' ? resA.reason : null;
        const reasonB: any = resB.status === 'rejected' ? resB.reason : null;
        if (isTerminalExecutionError(reasonA)) throw reasonA;
        if (isTerminalExecutionError(reasonB)) throw reasonB;
        const isCustom = Boolean(reasonA?.isCustomKeyFailed || reasonB?.isCustomKeyFailed);
        const isQuota = Boolean(reasonA?.isQuotaExhausted || reasonB?.isQuotaExhausted);
        const isTransient = Boolean(reasonA?.isTransient || reasonB?.isTransient);
        const isAll = Boolean(reasonA?.isAllExhausted || reasonB?.isAllExhausted || (!isCustom && !customApiKey && isQuota));
        const combinedErr: any = new Error(
          reasonA?.message || reasonB?.message || (isEn ? 'All vision models failed to segment radiograph.' : 'Tất cả các mô hình AI đều không thể phân đoạn ảnh.')
        );
        combinedErr.isCustomKeyFailed = isCustom;
        combinedErr.isAllExhausted = isAll;
        combinedErr.isQuotaExhausted = isQuota;
        combinedErr.isTransient = isTransient;
        combinedErr.originalError = reasonA || reasonB;
        throw combinedErr;
      }

      let finalResult: PathologySegmentResult;
      let usedModelString = '';

      const diversityStatus = (resultA && resultB && fulfilledA && fulfilledB && fulfilledA.usedModel === fulfilledB.usedModel)
        ? 'DEGRADED_DIVERSITY'
        : 'DIVERSE';

      if (resultA && resultB && fulfilledA && fulfilledB) {
        onStatusUpdate?.(isEn ? '✅ Synthesizing Spatial Union Consensus...' : '✅ Đang dung hợp đa giác không gian giữa 2 mô hình...');
        finalResult = synthesizePathologyConsensus(resultA, resultB, isEn);
        usedModelString = `${fulfilledA.usedModel} + ${fulfilledB.usedModel}`;
      } else if (resultA && fulfilledA) {
        finalResult = resultA;
        usedModelString = fulfilledA.usedModel;
      } else if (resultB && fulfilledB) {
        finalResult = resultB!;
        usedModelString = fulfilledB.usedModel;
      }

      // Inject provenance for single mode fallback if finalResult is not yet updated
      if (!resultB || !resultA) {
        finalResult!.pathologies.forEach(p => { p.provenance = p.provenance || 'single_mode'; });
      }

      const inferenceLineage = createInferenceLineage({
        modality: 'pathology',
        executionMode: 'dual',
        branches: [
          ...(resultA && fulfilledA ? [{
            branch: 'model_a' as const,
            requestedModel: modelA,
            actualModel: fulfilledA.usedModel,
            usedKeyType: fulfilledA.usedKeyType,
          }] : []),
          ...(resultB && fulfilledB ? [{
            branch: 'model_b' as const,
            requestedModel: modelB,
            actualModel: fulfilledB.usedModel,
            usedKeyType: fulfilledB.usedKeyType,
          }] : []),
        ],
        consensusStatus: resultA && resultB ? 'consensus_synthesized' : 'partial_fallback',
      });
      const mappedFinalResult = {
        ...assignServerLesionIds(mapOptimizedPathologyToLegacy(finalResult!, outputLanguage)),
        diversityStatus,
        inferenceLineage,
      };

      return {
        success: true,
        result: mappedFinalResult,
        usedModel: usedModelString,
      };
    } else {
      // -------------------------------------------------------------
      // SINGLE MODEL PIPELINE (Single-Pass CoT Grounding)
      // -------------------------------------------------------------
      const failoverRes = await executeWithFailover(
        async (aiClient: GoogleGenAI, modelName: string) => {
          onStatusUpdate?.(isEn 
            ? `🔬 Segmenting structures with ${modelName}...` 
            : `🔬 Đang phân đoạn cấu trúc bằng ${modelName}...`);
          const response = await aiClient.models.generateContent({
            model: modelName,
            contents: { parts: [imagePart, { text: promptText }] },
            config: {
              ...providerExecutionConfig(budget),
              systemInstruction,
              temperature: 0.0,
              responseMimeType: 'application/json',
              responseSchema: PATHOLOGY_SEGMENT_SCHEMA,
            },
          });

          budget.checkSignal();
          if (!response.text) {
            throw new Error('Empty response text from Gemini');
          }
          const parsed = validatePathologyOutput(JSON.parse(response.text));
          if (parsed && Array.isArray(parsed.pathologies)) {
            parsed.pathologies.forEach((p: any) => p.provenance = 'single_mode');
          }
          return parsed;
        },
        preferredModel,
        customApiKey,
        onStatusUpdate,
        budget,
        'branchSingle',
        options?.roleA?.credentialPreference,
        {
          role: 'pathology_branch_a',
          modelLadder: options?.roleA?.modelLadder,
          configRevision: options?.roleA?.compatibilityConfigIdentity,
          credentialAffinity: options?.roleA?.credentialPreference,
          assessmentId: options?.assessmentId,
        }
      );

      const inferenceLineage = createInferenceLineage({
        modality: 'pathology',
        executionMode: 'single',
        branches: [{
          branch: 'single',
          requestedModel: preferredModel || 'gemini-flash-latest',
          actualModel: failoverRes.usedModel,
          usedKeyType: failoverRes.usedKeyType,
        }],
        consensusStatus: 'not_applicable',
      });
      const mappedFinalResult = {
        ...assignServerLesionIds(mapOptimizedPathologyToLegacy(failoverRes.result, outputLanguage)),
        inferenceLineage,
      };

      return {
        success: true,
        result: mappedFinalResult,
        usedModel: failoverRes.usedModel,
      };
    }
  } catch (unknownError: unknown) {
    const err = unknownError as any;
    if (isTerminalExecutionError(err)) throw err;
    const isUsingCustom = Boolean(customApiKey && String(customApiKey).trim());
    const isInvalidKey = isInvalidApiKeyError(err) || isInvalidApiKeyError(err?.originalError) || err?.isInvalidKey === true;
    const isQuota = isRateLimitOrQuotaError(err) || isRateLimitOrQuotaError(err?.originalError) || err?.isQuotaExhausted === true || err?.message?.includes('QUOTA_EXHAUSTED');
    const isTransient = isTransientError(err) || isTransientError(err?.originalError) || err?.isTransient === true;

    // A custom key failure must have concrete evidence: explicit invalid key, quota exhaustion on custom key, or isCustomKeyFailed flag
    const isCustomKeyFailed = isUsingCustom && (err?.isCustomKeyFailed === true || isInvalidKey || isQuota || err?.message?.includes('CUSTOM_KEY_INVALID') || err?.message?.includes('CUSTOM_KEY_QUOTA_EXHAUSTED'));
    const isAllExhausted = !isUsingCustom && isQuota;

    return {
      success: false,
      isCustomKeyFailed,
      isQuotaExhausted: isQuota,
      isAllExhausted,
      isTransient: isTransient && !isInvalidKey && !isQuota,
      error: err?.message || 'Pathology segmentation failed',
    };
  }
}
