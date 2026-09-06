import { providerExecutionConfig } from './geminiService';
import { Type, GoogleGenAI } from '@google/genai';
import { ImageValidityResult } from '../../types/dental';
import { validateImageValidityOutput } from '../../utils/imageValidity';
import { executeWithFailover, ExecutionBudget } from './geminiService';
import { serverLog } from '../config/env';

export const IMAGE_VALIDITY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    isPeriapicalRadiograph: {
      type: Type.BOOLEAN,
      description: 'True if intraoral periapical radiograph with crown, root, and periapical area; false if bitewing, panoramic, photo, or non-dental.',
    },
    isAssessable: {
      type: Type.BOOLEAN,
      description: 'True if visual quality permits diagnostic evaluation; false if unreadable, corrupted, or blank.',
    },
    targetToothVisible: {
      type: Type.BOOLEAN,
      description: 'True if target tooth region is present within frame; false if absent or cut off.',
    },
    targetToothMatch: {
      type: Type.STRING,
      enum: ['match', 'mismatch', 'uncertain', 'not_assessable'],
      description: 'Match status of visible anatomy against target FDI.',
    },
    detectedToothCandidates: {
      type: Type.ARRAY,
      items: { type: Type.INTEGER },
      description: 'Confident visible canonical FDI numbers (e.g. [11, 21]), or empty array.',
    },
    orientation: {
      type: Type.STRING,
      enum: ['plausible', 'possibly_incorrect', 'uncertain', 'not_assessable'],
      description: 'Radiograph orientation status.',
    },
  },
  required: [
    'isPeriapicalRadiograph',
    'isAssessable',
    'targetToothVisible',
    'targetToothMatch',
    'detectedToothCandidates',
    'orientation',
  ],
};

export function buildValiditySystemInstruction(
  tooth: { fdiNumber: string; arch?: string; quadrant?: number; type?: string; nameVi?: string; nameEn?: string },
  _language: 'VI' | 'EN' = 'VI'
): string {
  return `You are a specialized dental radiologist AI serving as a PRE-ANALYSIS VALIDITY GATE for periapical radiographs.

TARGET TOOTH CONTEXT:
- FDI Code: ${tooth.fdiNumber}
- Arch: ${tooth.arch || 'Unknown'}
- Quadrant: ${tooth.quadrant || 'Unknown'}
- Type: ${tooth.type || 'Unknown'}
- Name: ${tooth.nameEn || tooth.nameVi || `Tooth ${tooth.fdiNumber}`}

YOUR TASK:
Assess ONLY image suitability and validity before clinical analysis:
1. Is it an intraoral periapical radiograph? (False if panoramic, bitewing, photo, document, non-dental)
2. Is the image assessable? (False if unreadable, corrupted, or blank)
3. Is target tooth region visible within frame?
4. Target tooth match: 'match' (anatomy corresponds), 'mismatch' (clearly contradicts target), 'uncertain' (ambiguous), 'not_assessable' (non-assessable/non-periapical).
5. Confident visible canonical FDI numbers (e.g. 11, 21, 36), or empty array if none/uncertain.
6. Orientation ('plausible', 'possibly_incorrect', 'uncertain', 'not_assessable').

DO NOT perform pathology diagnosis, DO NOT list caries or lesions, DO NOT generate polygons, and DO NOT evaluate technical positioning errors.`;
}

export interface ValidateImageParams {
  cleanBase64: string;
  mimeType: string;
  tooth: { fdiNumber: string; arch?: string; quadrant?: number; type?: string; nameVi?: string; nameEn?: string };
  language?: 'VI' | 'EN';
  customApiKey?: string;
  preferredModel?: string;
  signal?: AbortSignal;
  deadlineAt?: number;
  onStatusUpdate?: (status: string) => void;
  modelLadder?: string[];
  configRevision?: string;
  credentialAffinity?: any;
  assessmentId?: string;
}

export interface ValidateImageResult {
  validity: ImageValidityResult;
  usedModel: string;
  durationMs: number;
}

/**
 * Runs the lightweight pre-flight image validity classifier using existing Gemini failover infrastructure.
 */
export async function validateImageWithGemini(params: ValidateImageParams): Promise<ValidateImageResult> {
  const {
    cleanBase64,
    mimeType,
    tooth,
    language = 'VI',
    customApiKey,
    preferredModel,
    signal,
    deadlineAt = Date.now() + 35000,
    onStatusUpdate,
    modelLadder,
    configRevision,
    credentialAffinity,
    assessmentId,
  } = params;

  const startTime = Date.now();
  const systemInstruction = buildValiditySystemInstruction(tooth, language);
  const promptText = `Verify image validity and suitability for target tooth FDI ${tooth.fdiNumber}.`;

  const imagePart = {
    inlineData: {
      mimeType: mimeType === 'image/svg+xml' ? 'image/jpeg' : mimeType,
      data: cleanBase64,
    },
  };

  const budget = new ExecutionBudget(2, signal, 2, deadlineAt);

  const runner = async (aiClient: GoogleGenAI, modelName: string) => {
    onStatusUpdate?.(
      language === 'EN'
        ? `🔍 Validating image suitability (${modelName})...`
        : `🔍 Đang kiểm tra độ phù hợp của ảnh (${modelName})...`
    );

    const response = await aiClient.models.generateContent({
      model: modelName,
      contents: { parts: [imagePart, { text: promptText }] },
      config: {
        ...providerExecutionConfig(budget),
        systemInstruction,
        temperature: 0.0,
        responseMimeType: 'application/json',
        responseSchema: IMAGE_VALIDITY_SCHEMA,
      },
    });

    budget.checkSignal();
    if (!response.text) {
      throw new Error('Empty response from AI validity model');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      const err: any = new Error('Malformed JSON from validity model');
      err.isMalformed = true;
      throw err;
    }

    const validated = validateImageValidityOutput(parsed);
    if (!validated) {
      const err: any = new Error('Validity output did not conform to schema');
      err.isMalformed = true;
      throw err;
    }

    return validated;
  };

  const { result, usedModel } = await executeWithFailover(
    runner,
    preferredModel,
    customApiKey,
    onStatusUpdate,
    budget,
    'branchValidity',
    credentialAffinity,
    {
      role: 'validity',
      modelLadder,
      configRevision,
      credentialAffinity,
      assessmentId,
    }
  );

  const durationMs = Date.now() - startTime;
  serverLog('INFO', 'ValidityGate', `Validated image for FDI ${tooth.fdiNumber} in ${durationMs}ms using ${usedModel}`);

  return {
    validity: result,
    usedModel,
    durationMs,
  };
}
