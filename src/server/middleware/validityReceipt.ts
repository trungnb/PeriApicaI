import type { NextFunction, Request, Response } from 'express';
import { isValidReceptor, isValidTechnique } from './validation';
import { digestValidityImage, verifyValidityReceipt, type ValidityReceiptBinding } from '../services/validityReceipt';
import { createValidityAudit } from '../services/validityAudit';

function reject(res: Response, errorType: string, message: string): void {
  res.status(400).json({ success: false, errorType, error: message, userMessage: message });
}

/** Enforces server-issued validity proof before either provider route can run. */
export function requireValidityReceipt(req: Request, res: Response, next: NextFunction): void {
  const toothFdi = res.locals.canonicalTooth?.fdiNumber || req.body.toothFdi;
  const imageDigest = digestValidityImage(req.body.imageBase64);
  const assessmentId = typeof req.body.assessmentId === 'string' ? req.body.assessmentId.trim() : '';
  const technique = req.body.technique;
  const receptorType = req.body.receptorType;
  if (!imageDigest || !assessmentId || !toothFdi || !isValidTechnique(technique) || !isValidReceptor(receptorType)) {
    reject(res, 'VALIDITY_RECEIPT_BINDING_INVALID', 'A valid assessment, image, tooth, technique, and receptor are required.');
    return;
  }
  const binding: ValidityReceiptBinding = { imageDigest, toothFdi, technique, receptorType, assessmentId };
  const verified = verifyValidityReceipt(req.body.validityReceipt, binding);
  if (verified.ok === true) {
    res.locals.validityReceipt = verified.payload;
    res.locals.validityAudit = createValidityAudit(verified.payload);
    next();
    return;
  }
  const errorType = verified.reason === 'missing'
      ? 'VALIDITY_RECEIPT_REQUIRED'
      : verified.reason === 'expired'
        ? 'VALIDITY_RECEIPT_EXPIRED'
        : 'VALIDITY_RECEIPT_INVALID';
  reject(res, errorType, 'A current server-verified image validity receipt is required before analysis.');
}
