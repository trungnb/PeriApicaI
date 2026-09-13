import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { isValidBase64Image, extractAndValidateImage } from '../src/server/middleware/validation';
import {
  parsePublicTechnicalSaveDto,
  parsePublicPathologySaveDto,
  PublicPersistenceValidationError,
} from '../src/server/middleware/publicPersistenceDto';
import { createValidityAudit, verifyAttestedValidityAudit } from '../src/server/services/validityAudit';
import {
  createInferenceLineage,
  computeTechnicalResultDigest,
  computePathologyResultDigest,
} from '../src/server/services/inferenceLineage';
import { reportContributions, pathologyContributions } from '../src/server/services/systemStatsService';
import { redactObjectSecrets, sanitizeCredentialString } from '../src/utils/apiKeySecurity';
import {
  getDiscoveredModels,
  buildModelLadder,
  getOrCreateAssessmentSnapshot,
  releaseAssessmentModelSnapshot,
  resetAssessmentSnapshotsForTests,
  resetDiscoveryCacheForTests,
  setDiscoveryCacheForTests,
} from '../src/server/services/modelManager';
import { sanitizeSpreadsheetCell } from '../src/server/routes/adminRoutes';

// Helpers for test images
const RAW_JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, ...new Array(50).fill(0), 0xff, 0xd9];
const RAW_PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, ...new Array(50).fill(0)];
const RAW_WEBP_BYTES = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, ...new Array(50).fill(0)];

const VALID_JPEG_BASE64 = 'data:image/jpeg;base64,' + Buffer.from(RAW_JPEG_BYTES).toString('base64');
const VALID_PNG_BASE64 = 'data:image/png;base64,' + Buffer.from(RAW_PNG_BYTES).toString('base64');
const VALID_WEBP_BASE64 = 'data:image/webp;base64,' + Buffer.from(RAW_WEBP_BYTES).toString('base64');
const RAW_PNG_BASE64_NO_PREFIX = Buffer.from(RAW_PNG_BYTES).toString('base64');
const RAW_WEBP_BASE64_NO_PREFIX = Buffer.from(RAW_WEBP_BYTES).toString('base64');
const JUNK_TEXT_BASE64 = 'data:image/jpeg;base64,' + Buffer.from('This is a text string that is not a valid JPEG or PNG image at all, it is just ASCII junk.').toString('base64');

describe('M-01 & MIME Consistency', () => {
  test('accepts valid JPEG base64', () => {
    assert.equal(isValidBase64Image(VALID_JPEG_BASE64), true);
  });

  test('accepts valid PNG base64', () => {
    assert.equal(isValidBase64Image(VALID_PNG_BASE64), true);
  });

  test('accepts valid WebP base64', () => {
    assert.equal(isValidBase64Image(VALID_WEBP_BASE64), true);
  });

  test('rejects junk text disguised as base64 image', () => {
    assert.equal(isValidBase64Image(JUNK_TEXT_BASE64), false);
  });

  test('rejects mismatched MIME declaration (declared PNG but is JPEG)', () => {
    const fakePngWithJpegBytes = 'data:image/png;base64,' + Buffer.from(RAW_JPEG_BYTES).toString('base64');
    assert.equal(isValidBase64Image(fakePngWithJpegBytes), false);
  });

  test('extractAndValidateImage detects correct MIME from raw base64 without prefix', () => {
    const pngInfo = extractAndValidateImage(RAW_PNG_BASE64_NO_PREFIX);
    assert.ok(pngInfo);
    assert.equal(pngInfo.mimeType, 'image/png');

    const webpInfo = extractAndValidateImage(RAW_WEBP_BASE64_NO_PREFIX);
    assert.ok(webpInfo);
    assert.equal(webpInfo.mimeType, 'image/webp');
  });

  test('extractAndValidateImage rejects explicit MIME mismatch', () => {
    const result = extractAndValidateImage(RAW_PNG_BASE64_NO_PREFIX, 'image/jpeg');
    assert.equal(result, null);
  });
});

describe('H-01: Public Persistence Proof & Assessment Binding', () => {
  const assessmentId = 'test-assessment-123';
  const imageDigest = crypto.createHash('sha256').update(Buffer.from(RAW_JPEG_BYTES).toString('base64')).digest('hex');

  const validReceiptPayload = {
    v: 1 as const,
    purpose: 'proceed' as const,
    imageDigest,
    toothFdi: '11',
    technique: 'Paralleling' as const,
    receptorType: 'Digital Sensor' as const,
    assessmentId,
    decision: 'valid' as const,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 300000,
  };

  const validFindings = [{
    domainId: 'domain_1' as const,
    domainName: 'Domain 1',
    hasErrors: true,
    detectedErrors: [{
      errorKey: 'missing_apical',
      errorName: 'Mất cuống',
      confidence: 90,
      clinicalObservation: 'Observation',
    }],
    domainSummary: 'Summary',
  }];
  const overallQuality = 'Diagnostic' as const;

  const validAudit = createValidityAudit(validReceiptPayload);
  const resultDigest = computeTechnicalResultDigest(validFindings, overallQuality);
  const validLineage = createInferenceLineage({
    modality: 'technical',
    executionMode: 'single',
    assessmentId,
    sourceImageDigest: imageDigest,
    resultDigest,
    branches: [{ branch: 'single', requestedModel: 'gemini-3.8-flash', actualModel: 'gemini-3.8-flash', usedKeyType: 'system_primary' }],
    consensusStatus: 'not_applicable',
  });

  test('rejects payload without attested validityAudit or inferenceLineage', () => {
    const unauthenticatedPayload = {
      payload: {
        assessmentId,
        tooth: { fdiNumber: '11' },
        technique: 'Paralleling',
        receptorType: 'Digital Sensor',
        sessionStatus: 'COMPLETED',
        lastCompletedStep: 5,
        aiAnalysis: { overallQuality, findings: validFindings },
        userValidation: { concurred: true, overriddenErrors: [] },
        finalConfirmedErrors: [],
      },
    };

    assert.throws(
      () => parsePublicTechnicalSaveDto(unauthenticatedPayload),
      (err: any) => err instanceof PublicPersistenceValidationError || err.message.includes('envelope') || err.message.includes('audit'),
    );
  });

  test('rejects proof from Assessment A used for Assessment B', () => {
    const replayPayload = {
      payload: {
        assessmentId: 'forged-assessment-999',
        tooth: { fdiNumber: '11' },
        technique: 'Paralleling',
        receptorType: 'Digital Sensor',
        sessionStatus: 'COMPLETED',
        lastCompletedStep: 5,
        aiAnalysis: {
          overallQuality,
          findings: validFindings,
          validityAudit: validAudit, // contains assessmentId: test-assessment-123
          inferenceLineage: validLineage, // contains assessmentId: test-assessment-123
        },
        userValidation: { concurred: true, overriddenErrors: [] },
        finalConfirmedErrors: ['missing_apical'],
      },
      imageDataUrl: VALID_JPEG_BASE64,
    };

    assert.throws(
      () => parsePublicTechnicalSaveDto(replayPayload),
      (err: any) => err instanceof PublicPersistenceValidationError && err.message.includes('assessment ID'),
    );
  });

  test('rejects tampered analysis findings after receiving proof (resultDigest mismatch)', () => {
    const tamperedPayload = {
      payload: {
        assessmentId,
        tooth: { fdiNumber: '11' },
        technique: 'Paralleling',
        receptorType: 'Digital Sensor',
        sessionStatus: 'COMPLETED',
        lastCompletedStep: 5,
        aiAnalysis: {
          overallQuality,
          findings: [{
            ...validFindings[0],
            detectedErrors: [{
              errorKey: 'foreshortening', // tampered error key
              errorName: 'Hình bị co ngắn',
              confidence: 95,
              clinicalObservation: 'Tampered observation',
            }],
          }],
          validityAudit: validAudit,
          inferenceLineage: validLineage,
        },
        userValidation: { concurred: true, overriddenErrors: [] },
        finalConfirmedErrors: ['foreshortening'],
      },
      imageDataUrl: VALID_JPEG_BASE64,
    };

    assert.throws(
      () => parsePublicTechnicalSaveDto(tamperedPayload),
      (err: any) => err instanceof PublicPersistenceValidationError && err.message.includes('digest'),
    );
  });

  test('accepts valid payload with canonical errors and matching proof', () => {
    const validSavePayload = {
      payload: {
        assessmentId,
        tooth: { fdiNumber: '11' },
        technique: 'Paralleling',
        receptorType: 'Digital Sensor',
        sessionStatus: 'COMPLETED',
        lastCompletedStep: 5,
        aiAnalysis: {
          overallQuality,
          findings: validFindings,
          validityAudit: validAudit,
          inferenceLineage: validLineage,
        },
        userValidation: { concurred: true, overriddenErrors: [] },
        finalConfirmedErrors: ['missing_apical'],
      },
      imageDataUrl: VALID_JPEG_BASE64,
    };

    const parsed = parsePublicTechnicalSaveDto(validSavePayload);
    assert.equal(parsed.record.assessmentId, assessmentId);
    assert.equal(parsed.record.finalConfirmedErrors[0], 'missing_apical');
  });

  test('accepts valid payload when shareConsent=false without raw image', () => {
    const noConsentPayload = {
      payload: {
        assessmentId,
        tooth: { fdiNumber: '11' },
        technique: 'Paralleling',
        receptorType: 'Digital Sensor',
        sessionStatus: 'COMPLETED',
        lastCompletedStep: 5,
        shareConsent: false,
        aiAnalysis: {
          overallQuality,
          findings: validFindings,
          validityAudit: validAudit,
          inferenceLineage: validLineage,
        },
        userValidation: { concurred: true, overriddenErrors: [] },
        finalConfirmedErrors: ['missing_apical'],
      },
    };

    const parsed = parsePublicTechnicalSaveDto(noConsentPayload);
    assert.equal(parsed.record.assessmentId, assessmentId);
    assert.equal(parsed.imageDataUrl, undefined);
  });

  test('accepts valid pathology save payload with matching proof', () => {
    const detectedPathologies = [{
      id: 'lesion-1',
      pathologyKey: 'periapical_radiolucency',
      domainId: 'domain_p1',
      confidence: 88,
      bbox: [100, 200, 300, 400],
      polygonPoints: [[100, 200], [150, 250], [200, 300], [100, 200]],
      color: '#ef4444',
      fillColor: '#ef444433',
    }];
    const pathResultDigest = computePathologyResultDigest(detectedPathologies);
    const pathLineage = createInferenceLineage({
      modality: 'pathology',
      executionMode: 'dual',
      assessmentId,
      sourceImageDigest: imageDigest,
      resultDigest: pathResultDigest,
      branches: [
        { branch: 'model_a', requestedModel: 'gemini-3.8-flash', actualModel: 'gemini-3.8-flash', usedKeyType: 'system_primary' },
        { branch: 'model_b', requestedModel: 'gemini-3.1-pro-preview', actualModel: 'gemini-3.1-pro-preview', usedKeyType: 'system_backup' },
      ],
      consensusStatus: 'consensus_synthesized',
    });

    const pathologySavePayload = {
      assessmentId,
      tooth: { fdiNumber: '11' },
      technique: 'Paralleling',
      receptorType: 'Digital Sensor',
      sessionStatus: 'COMPLETED',
      lastCompletedStep: 5,
      detectedPathologies,
      confirmedPathologies: detectedPathologies,
      validityAudit: validAudit,
      inferenceLineage: pathLineage,
    };

    const parsed = parsePublicPathologySaveDto(pathologySavePayload);
    assert.equal(parsed.record.assessmentId, assessmentId);
    assert.equal(parsed.record.detectedPathologies.length, 1);
  });

  test('strictly rejects legacy validity audit envelope lacking assessmentId even with valid HMAC', () => {
    const legacyMetadata = {
      schemaVersion: 1,
      sourceImageDigest: imageDigest,
      validityDecision: 'valid' as const,
      targetFdi: '11',
      technique: 'Paralleling' as const,
      receptorType: 'Digital Sensor' as const,
      validatedAt: new Date().toISOString(),
      enforcementVersion: 'r29-v1' as const,
    };
    const signingSecret = process.env.VALIDITY_RECEIPT_SIGNING_SECRET || 'dev-validity-receipt-secret-change-me';
    const legacySignature = crypto.createHmac('sha256', signingSecret)
      .update(`validity-audit:v1:${JSON.stringify(legacyMetadata)}`)
      .digest('base64url');
    const legacyEnvelope = { ...legacyMetadata, attestation: legacySignature };

    // Direct audit verification fails
    assert.throws(
      () => verifyAttestedValidityAudit(legacyEnvelope),
      (err: any) => err.message === 'VALIDITY_AUDIT_ATTESTATION_INVALID'
    );

    // Technical persistence DTO fails
    const legacyTechPayload = {
      payload: {
        assessmentId,
        tooth: { fdiNumber: '11' },
        technique: 'Paralleling',
        receptorType: 'Digital Sensor',
        sessionStatus: 'COMPLETED',
        lastCompletedStep: 5,
        aiAnalysis: {
          overallQuality,
          findings: validFindings,
          validityAudit: legacyEnvelope,
          inferenceLineage: validLineage,
        },
        userValidation: { concurred: true, overriddenErrors: [] },
        finalConfirmedErrors: ['missing_apical'],
      },
      imageDataUrl: VALID_JPEG_BASE64,
    };
    assert.throws(
      () => parsePublicTechnicalSaveDto(legacyTechPayload),
      (err: any) => err instanceof PublicPersistenceValidationError
    );

    // Pathology persistence DTO fails
    const legacyPathPayload = {
      assessmentId,
      tooth: { fdiNumber: '11' },
      technique: 'Paralleling',
      receptorType: 'Digital Sensor',
      sessionStatus: 'COMPLETED',
      lastCompletedStep: 5,
      detectedPathologies: [],
      confirmedPathologies: [],
      validityAudit: legacyEnvelope,
      inferenceLineage: validLineage,
    };
    assert.throws(
      () => parsePublicPathologySaveDto(legacyPathPayload),
      (err: any) => err instanceof PublicPersistenceValidationError
    );
  });

  test('rejects public pathology save when lineage assessmentId mismatches payload', () => {
    const validPathLineage = createInferenceLineage({
      modality: 'pathology',
      executionMode: 'single',
      assessmentId,
      sourceImageDigest: imageDigest,
      resultDigest: computePathologyResultDigest([]),
      branches: [{ branch: 'single', requestedModel: 'gemini-3.8-flash', actualModel: 'gemini-3.8-flash', usedKeyType: 'system_primary' }],
      consensusStatus: 'not_applicable',
    });
    const mismatchedPathologyPayload = {
      assessmentId: 'payload-id-abc',
      tooth: { fdiNumber: '11' },
      technique: 'Paralleling',
      receptorType: 'Digital Sensor',
      sessionStatus: 'COMPLETED',
      lastCompletedStep: 5,
      detectedPathologies: [],
      confirmedPathologies: [],
      validityAudit: validAudit, // contains test-assessment-123
      inferenceLineage: validPathLineage, // contains test-assessment-123
    };
    assert.throws(
      () => parsePublicPathologySaveDto(mismatchedPathologyPayload),
      (err: any) => err instanceof PublicPersistenceValidationError && err.message.includes('assessment ID')
    );
  });

  test('systemStatsService ignores unknown taxonomy keys', () => {
    const log = {
      sessionStatus: 'COMPLETED',
      lastCompletedStep: 5,
      aiAnalysis: { overallQuality: 'Diagnostic', isPeriapicalRadiograph: true },
      finalConfirmedErrors: ['missing_apical', 'evil_injected_key', 'foreshortening'],
    };
    const contribs = reportContributions(log);
    assert.equal(contribs['reports.errorDistribution.missing_apical'], 1);
    assert.equal(contribs['reports.errorDistribution.foreshortening'], 1);
    assert.equal(contribs['reports.errorDistribution.evil_injected_key'], undefined);
  });
});

describe('M-03 & BYOK Ladder Mechanism', () => {
  test('custom BYOK discovery does not pollute system discovery cache or ladder', () => {
    resetDiscoveryCacheForTests();
    resetAssessmentSnapshotsForTests();

    // Mock system discovery
    setDiscoveryCacheForTests(undefined, [
      { id: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash Lite' },
      { id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash' },
      { id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro' },
    ]);

    // Mock custom BYOK discovery containing unique custom model
    const customKey = 'custom-test-byok-key';
    setDiscoveryCacheForTests(customKey, [
      { id: 'gemini-2.5-flash', displayName: 'Custom Gemini 2.5 Flash' },
      { id: 'gemini-2.0-flash', displayName: 'Custom Gemini 2.0 Flash' },
    ]);

    // System snapshot should only contain system models
    const sysSnapshot = getOrCreateAssessmentSnapshot('system-assessment-1');
    assert.equal(sysSnapshot.roles.technical_branch_a.primaryModel, 'gemini-3.8-flash');
    assert.ok(!sysSnapshot.ladder.includes('gemini-2.5-flash'), 'System ladder must not contain custom model');

    // BYOK snapshot with custom key should resolve custom models
    const customSnapshot = getOrCreateAssessmentSnapshot('byok-assessment-1', undefined, customKey);
    assert.equal(customSnapshot.roles.technical_branch_a.primaryModel, 'gemini-2.5-flash');

    // Repeated call within same assessment returns stable snapshot
    const customSnapshotCached = getOrCreateAssessmentSnapshot('byok-assessment-1', undefined, customKey);
    assert.equal(customSnapshotCached.ladderRevision, customSnapshot.ladderRevision);
  });

  test('ladder preserves role-specific ordering across all 5 roles', () => {
    const models = [
      { id: 'gemini-3.1-pro-preview', displayName: 'Pro' },
      { id: 'gemini-3.8-flash', displayName: 'Flash' },
      { id: 'gemini-3.5-flash-lite', displayName: 'Lite' },
    ];
    setDiscoveryCacheForTests('role-test-key', models);

    const snapshot = getOrCreateAssessmentSnapshot('role-ordering-check', undefined, 'role-test-key');
    assert.equal(snapshot.roles.validity.primaryModel, 'gemini-3.5-flash-lite', 'Validity must be Lite-first');
    assert.equal(snapshot.roles.technical_branch_a.primaryModel, 'gemini-3.8-flash', 'Technical A must be Flash-first');
    assert.equal(snapshot.roles.technical_branch_b.primaryModel, 'gemini-3.1-pro-preview', 'Technical B must be Pro-first');
    assert.equal(snapshot.roles.pathology_branch_a.primaryModel, 'gemini-3.8-flash', 'Pathology A must be Flash-first');
    assert.equal(snapshot.roles.pathology_branch_b.primaryModel, 'gemini-3.1-pro-preview', 'Pathology B must be Pro-first');
  });

  test('system and BYOK with identical assessmentId maintain completely isolated snapshots', () => {
    resetDiscoveryCacheForTests();
    resetAssessmentSnapshotsForTests();

    const sharedAssessmentId = 'shared-assessment-coldstart-123';

    // System models
    setDiscoveryCacheForTests(undefined, [
      { id: 'gemini-3.8-flash', displayName: 'System Gemini 3.8 Flash' },
      { id: 'gemini-3.5-flash-lite', displayName: 'System Gemini 3.5 Flash Lite' },
    ]);

    // BYOK models
    const byokKey = 'byok-user-key-xyz';
    setDiscoveryCacheForTests(byokKey, [
      { id: 'gemini-2.5-flash', displayName: 'BYOK Gemini 2.5 Flash' },
      { id: 'gemini-2.0-flash', displayName: 'BYOK Gemini 2.0 Flash' },
    ]);

    // 1. Create system snapshot for sharedAssessmentId
    const sysSnapshot = getOrCreateAssessmentSnapshot(sharedAssessmentId, undefined, undefined);
    assert.equal(sysSnapshot.roles.technical_branch_a.primaryModel, 'gemini-3.8-flash');

    // 2. Create BYOK snapshot for SAME sharedAssessmentId
    const byokSnapshot = getOrCreateAssessmentSnapshot(sharedAssessmentId, undefined, byokKey);
    assert.equal(byokSnapshot.roles.technical_branch_a.primaryModel, 'gemini-2.5-flash');

    // 3. System snapshot query again under same assessmentId must still return system model (not overwritten by BYOK)
    const sysSnapshot2 = getOrCreateAssessmentSnapshot(sharedAssessmentId, undefined, undefined);
    assert.equal(sysSnapshot2.roles.technical_branch_a.primaryModel, 'gemini-3.8-flash');
    assert.equal(sysSnapshot2.ladderRevision, sysSnapshot.ladderRevision);

    // 4. Repeated BYOK call under same assessmentId returns cached BYOK snapshot
    const byokSnapshot2 = getOrCreateAssessmentSnapshot(sharedAssessmentId, undefined, byokKey);
    assert.equal(byokSnapshot2.roles.technical_branch_a.primaryModel, 'gemini-2.5-flash');
    assert.equal(byokSnapshot2.ladderRevision, byokSnapshot.ladderRevision);

    // 5. releaseAssessmentModelSnapshot clears all scoped entries for this assessmentId
    releaseAssessmentModelSnapshot(sharedAssessmentId);

    // After release, new call reconstructs from discovery without cache
    setDiscoveryCacheForTests(byokKey, [
      { id: 'gemini-3.0-flash', displayName: 'BYOK Gemini 3.0 Flash' },
    ]);
    const byokSnapshotRebuilt = getOrCreateAssessmentSnapshot(sharedAssessmentId, undefined, byokKey);
    assert.equal(byokSnapshotRebuilt.roles.technical_branch_a.primaryModel, 'gemini-3.0-flash');
  });
});

describe('Session Cache Isolation', () => {
  test('different assessmentIds produce isolated cache keys', () => {
    const cleanBase64 = 'sample-image-base64-data';
    const toothFdi = '11';
    const technique = 'Paralleling';
    const receptorType = 'Digital Sensor';
    const outputLanguage = 'VI';
    const analysisMode = 'consensus';
    const selectedModelA = 'gemini-3.8-flash';
    const selectedModelB = 'gemini-3.1-pro-preview';
    const ladderRevision = 'rev123456';

    const computeKey = (assessmentId: string) => crypto
      .createHash('sha256')
      .update(assessmentId)
      .update(ladderRevision)
      .update(cleanBase64)
      .update(toothFdi)
      .update(technique)
      .update(receptorType)
      .update(outputLanguage)
      .update(analysisMode)
      .update(selectedModelA)
      .update(selectedModelB)
      .update('system')
      .digest('hex');

    const key1 = computeKey('assessment-session-A');
    const key2 = computeKey('assessment-session-B');
    const key1Repeat = computeKey('assessment-session-A');

    assert.notEqual(key1, key2, 'Different sessions must have different cache keys');
    assert.equal(key1, key1Repeat, 'Same session must have identical cache key');
  });
});

describe('M-04: errorDetails & Credential Redaction Limits', () => {
  test('redactObjectSecrets redacts sensitive keys', () => {
    const input = {
      apiKey: 'AIzaSySecret12345678901234567890',
      user: 'Doctor',
      nested: { customApiKey: 'AIzaSySecret99999999999999999999' },
    };
    const redacted = redactObjectSecrets(input);
    assert.equal(redacted.apiKey, '***REDACTED***');
    assert.equal(redacted.nested.customApiKey, '***REDACTED***');
    assert.equal(redacted.user, 'Doctor');
  });

  test('redactObjectSecrets truncates excessive depth without crashing', () => {
    let deep: any = { message: 'bottom' };
    for (let i = 0; i < 15; i++) {
      deep = { level: i, next: deep };
    }
    const result = redactObjectSecrets(deep);
    assert.ok(result);
  });

  test('redactObjectSecrets caps oversized arrays and key counts', () => {
    const largeArray = new Array(200).fill('entry');
    const result = redactObjectSecrets({ items: largeArray });
    assert.ok(Array.isArray(result.items));
    assert.ok(result.items.length <= 50, 'Array should be capped at max limit');
  });
});

describe('M-02: Spreadsheet & CSV Formula Injection Protection', () => {
  test('neutralizes formula injection characters (=, +, -, @, tab, CR)', () => {
    assert.equal(sanitizeSpreadsheetCell('=SUM(A1:A10)'), "'=SUM(A1:A10)");
    assert.equal(sanitizeSpreadsheetCell('+12345'), "'+12345");
    assert.equal(sanitizeSpreadsheetCell('-cmd|/C calc'), "'-cmd|/C calc");
    assert.equal(sanitizeSpreadsheetCell('@evil'), "'@evil");
    assert.equal(sanitizeSpreadsheetCell('\t=cmd'), "'\t=cmd");
  });

  test('leaves benign values untouched', () => {
    assert.equal(sanitizeSpreadsheetCell('Normal clinic note'), 'Normal clinic note');
    assert.equal(sanitizeSpreadsheetCell('Diagnostic'), 'Diagnostic');
    assert.equal(sanitizeSpreadsheetCell(100), '100');
    assert.equal(sanitizeSpreadsheetCell(''), '');
  });
});
