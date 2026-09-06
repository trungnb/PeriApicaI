import path from 'path';
import fs from 'fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { serverLog } from '../config/env';
import { isStorageTestOfflineMode } from '../config/storagePaths';

export function getServiceAccountCredentials(): any | null {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      let rawEnv = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      if ((rawEnv.startsWith("'") && rawEnv.endsWith("'")) || (rawEnv.startsWith('"') && rawEnv.endsWith('"'))) {
        rawEnv = rawEnv.slice(1, -1);
      }
      return JSON.parse(rawEnv);
    }
    const adminPath = path.join(process.cwd(), 'admin_SDK.json');
    if (fs.existsSync(adminPath)) {
      const content = fs.readFileSync(adminPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err: any) {
    serverLog('ERROR', 'FirebaseConfig', 'Lỗi parse Firebase Service Account Credentials', err);
  }
  return null;
}

let firestoreDbInstance: Firestore | null = null;
let storageTestFirestoreInstance: Firestore | null = null;

export function configureFirestoreInstanceForStorageTests(instance: Firestore): void {
  if (!isStorageTestOfflineMode()) {
    throw new Error('Fake Firestore may only be configured inside an R17 offline storage sandbox.');
  }
  storageTestFirestoreInstance = instance;
}

export function resetFirestoreInstanceForStorageTests(): void {
  if (!isStorageTestOfflineMode()) {
    throw new Error('Fake Firestore may only be reset inside an R17 offline storage sandbox.');
  }
  storageTestFirestoreInstance = null;
}

export function getFirestoreInstance(): Firestore | null {
  if (isStorageTestOfflineMode()) return storageTestFirestoreInstance;
  if (firestoreDbInstance) return firestoreDbInstance;

  try {
    const creds = getServiceAccountCredentials();
    if (creds) {
      if (getApps().length === 0) {
        initializeApp({ credential: cert(creds) });
      }
      firestoreDbInstance = getFirestore();
      firestoreDbInstance.settings({ ignoreUndefinedProperties: true });
      serverLog('INFO', 'FirebaseInit', 'Đã khởi tạo Firebase Admin SDK Firestore thành công');
      return firestoreDbInstance;
    }
  } catch (err: any) {
    serverLog('ERROR', 'FirebaseInit', 'Không thể khởi tạo Firebase Admin SDK', err);
  }

  return null;
}
