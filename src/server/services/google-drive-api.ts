/**
 * Google Drive API Service — helper de bajo nivel para Drive API v3.
 *
 * Todas las operaciones son server-side exclusivamente.
 * Access tokens son efímeros: se generan desde el refresh token y se usan en-request.
 *
 * Scope: https://www.googleapis.com/auth/drive.file
 */

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const SELLUP_FOLDER_NAME = 'SellUp';
const SELLUP_FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface DriveFolderResult {
  id: string;
  name: string;
}

/**
 * Obtiene un access token fresco a partir de un refresh token.
 * El access token es efímero — no persistir.
 */
export async function getGoogleDriveAccessToken(
  refreshToken: string
): Promise<{ success: true; accessToken: string } | { success: false; error: string }> {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { success: false, error: 'Google Drive credentials not configured.' };
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  let data: DriveTokenResponse;

  try {
    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Token refresh failed (${res.status}): ${text}` };
    }

    data = await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { success: false, error: `Network error refreshing token: ${msg}` };
  }

  if (!data.access_token) {
    return { success: false, error: 'Google did not return an access token.' };
  }

  return { success: true, accessToken: data.access_token };
}

/**
 * Prueba la conexión a Drive obteniendo el perfil del usuario.
 * Usa GET /drive/v3/about?fields=user — llamada de bajo impacto, no crea archivos.
 */
export async function testDriveConnection(
  accessToken: string
): Promise<{ success: true; email: string } | { success: false; error: string }> {
  try {
    const res = await fetch(`${GOOGLE_DRIVE_API_BASE}/about?fields=user`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Drive API error (${res.status}): ${text}` };
    }

    const data: { user?: { emailAddress?: string } } = await res.json();
    return { success: true, email: data.user?.emailAddress ?? '' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: `Network error: ${msg}` };
  }
}

/**
 * Crea la carpeta raíz "SellUp" en el Drive del usuario.
 * Usa mimeType application/vnd.google-apps.folder según documentación Drive API v3.
 * Scope drive.file es suficiente para crear carpetas nuevas.
 */
export async function createSellUpDriveFolder(
  accessToken: string
): Promise<{ success: true; folder: DriveFolderResult } | { success: false; error: string }> {
  try {
    const res = await fetch(`${GOOGLE_DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: SELLUP_FOLDER_NAME,
        mimeType: SELLUP_FOLDER_MIME,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Drive API error creating folder (${res.status}): ${text}` };
    }

    const data: { id?: string; name?: string } = await res.json();

    if (!data.id || !data.name) {
      return { success: false, error: 'Drive API returned incomplete folder data.' };
    }

    return { success: true, folder: { id: data.id, name: data.name } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: `Network error creating folder: ${msg}` };
  }
}

/**
 * Crea un archivo en la carpeta SellUp del usuario.
 * Helper preparado para módulos futuros (propuestas, business cases, etc.).
 *
 * @param accessToken   - Access token fresco del usuario
 * @param folderId      - ID de la carpeta SellUp del usuario
 * @param name          - Nombre del archivo
 * @param mimeType      - MIME type del archivo (e.g. 'application/vnd.google-apps.document')
 * @param content       - Contenido del archivo (opcional, para archivos de texto)
 * @param contentType   - Content-Type del body (opcional)
 */
export async function createSellUpDriveFile(
  accessToken: string,
  folderId: string,
  name: string,
  mimeType: string,
  content?: string,
  contentType?: string
): Promise<{ success: true; fileId: string; fileName: string } | { success: false; error: string }> {
  try {
    const metadata = { name, mimeType, parents: [folderId] };

    let body: BodyInit;
    let contentTypeHeader: string;

    if (content !== undefined) {
      // Multipart upload: metadata + content
      const boundary = `-------314159265358979323846`;
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const multipartBody =
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        `Content-Type: ${contentType ?? 'text/plain'}\r\n\r\n` +
        content +
        closeDelimiter;

      body = multipartBody;
      contentTypeHeader = `multipart/related; boundary="${boundary}"`;
    } else {
      body = JSON.stringify(metadata);
      contentTypeHeader = 'application/json';
    }

    const res = await fetch(`${GOOGLE_DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': contentTypeHeader,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Drive file creation failed (${res.status}): ${text}` };
    }

    const data: { id?: string; name?: string } = await res.json();

    if (!data.id || !data.name) {
      return { success: false, error: 'Drive API returned incomplete file data.' };
    }

    return { success: true, fileId: data.id, fileName: data.name };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: `Network error creating file: ${msg}` };
  }
}
