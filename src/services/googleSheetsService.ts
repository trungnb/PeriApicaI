const CLIENT_ID = ((import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string) || '';

let testClientIdOverride: string | null = null;

/** Test seam only; production always reads the Vite public client ID. */
export function configureGoogleSheetsServiceForTests(clientId: string | null = null): void {
  testClientIdOverride = clientId;
}

/**
 * Loads the Google Identity Services (GIS) client library dynamically.
 */
function loadGsiScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && (window as any).google?.accounts?.oauth2) {
      return resolve();
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Không thể tải SDK Google Identity Services. Vui lòng kiểm tra kết nối mạng.'));
    document.body.appendChild(script);
  });
}

/**
 * Requests an OAuth 2.0 Access Token with Google Drive / Sheets scope using GIS.
 */
export async function getGoogleAccessToken(): Promise<string> {
  await loadGsiScript();

  return new Promise((resolve, reject) => {
    try {
      const clientId = testClientIdOverride ?? CLIENT_ID;
      if (!clientId) {
        return reject(new Error('Chưa cấu hình Google Client ID (VITE_GOOGLE_CLIENT_ID).'));
      }

      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets',
        callback: (response: any) => {
          if (response.error) {
            if (response.error === 'popup_closed') {
              reject(new Error('Cửa sổ đăng nhập Google đã bị đóng. Vui lòng thử lại và hoàn tất xác thực.'));
            } else if (response.error === 'access_denied') {
              reject(new Error('Bạn đã từ chối cấp quyền truy cập Google Drive.'));
            } else {
              reject(new Error(response.error_description || response.error));
            }
          } else if (response.access_token) {
            resolve(response.access_token);
          } else {
            reject(new Error('Không nhận được Access Token từ Google OAuth.'));
          }
        },
        error_callback: (err: any) => {
          const msg = err?.message || err?.type || '';
          if (msg.includes('popup_closed') || msg.includes('Popup window closed')) {
            reject(new Error('Cửa sổ đăng nhập Google đã bị đóng. Vui lòng nhấp lại để đăng nhập.'));
          } else if (msg.includes('popup_blocked')) {
            reject(new Error('Trình duyệt đã chặn cửa sổ Popup. Vui lòng cho phép hiện Pop-up cho trang web này.'));
          } else {
            reject(new Error(msg || 'Đã đóng cửa sổ đăng nhập Google hoặc gặp lỗi xác thực.'));
          }
        },
      });

      // Manual export must always be an explicit account decision. Do not
      // reuse a token or provide account hints that would skip the chooser.
      client.requestAccessToken({ prompt: 'select_account' });
    } catch (err: any) {
      reject(new Error(err?.message || 'Lỗi khởi tạo đăng nhập Google.'));
    }
  });
}

/**
 * Creates a new formatted Google Spreadsheet on the user's Google Drive
 * and populates it with headers and data rows.
 */
export async function exportDataToGoogleSheets(
  sheetTitle: string,
  headers: string[],
  rows: (string | number)[][],
  headerColor?: { red: number; green: number; blue: number }
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  let token = await getGoogleAccessToken();
  const defaultColor = { red: 0.08, green: 0.45, blue: 0.45 }; // Màu Teal nguyên bản

  // 1. Create spreadsheet with formatted header row
  const payload = {
    properties: {
      title: sheetTitle,
    },
    sheets: [
      {
        properties: {
          title: 'Sheet1',
          gridProperties: {
            frozenRowCount: 1,
          },
        },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: [
              {
                values: headers.map(header => ({
                  userEnteredValue: { stringValue: String(header) },
                  userEnteredFormat: {
                    backgroundColor: headerColor || defaultColor,
                    textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                    horizontalAlignment: 'CENTER',
                  }
                }))
              }
            ]
          }
        ]
      },
    ],
  };

  let createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  // If 401 Unauthorized, token might be expired. Retry once with fresh token.
  if (createRes.status === 401) {
    token = await getGoogleAccessToken();
    createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  if (!createRes.ok) {
    const errJson = await createRes.json().catch(() => ({}));
    throw new Error(errJson.error?.message || 'Không thể tạo file Google Sheets. Vui lòng thử lại.');
  }

  const sheetData = await createRes.json();
  const spreadsheetId = sheetData.spreadsheetId;
  const spreadsheetUrl = sheetData.spreadsheetUrl;

  // 2. Append rows in chunks of 2,000 to prevent request payload size limits
  if (rows && rows.length > 0) {
    const CHUNK_SIZE = 2000;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A2:append?valueInputOption=USER_ENTERED`;
      const appendRes = await fetch(appendUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: chunk,
        }),
      });

      if (!appendRes.ok) {
        console.warn(`[GoogleSheetsExport] Append chunk ${i} failed`, await appendRes.text().catch(() => ''));
      }
    }
  }

  return { spreadsheetId, spreadsheetUrl };
}
