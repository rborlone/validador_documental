import type {
  DocumentDetail,
  DocumentListResponse,
  DocumentTypesResponse,
  ProblemDetails,
  UploadResponse,
} from './types';

export const API_URL: string = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

export const apiUrl = (path: string): string => `${API_URL}${path}`;

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails | null;

  constructor(status: number, message: string, problem: ProblemDetails | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

function problemMessage(status: number, problem: ProblemDetails | null): string {
  if (problem?.detail) return problem.detail;
  if (problem?.title) return problem.title;
  if (status === 0) return 'No se pudo conectar con el servidor.';
  if (status === 404) return 'No encontrado.';
  if (status === 413) return 'El archivo excede el tamaño permitido.';
  return `Error del servidor (${status}).`;
}

function parseProblem(text: string): ProblemDetails | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as ProblemDetails) : null;
  } catch {
    return null;
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, problemMessage(0, null));
  }
  if (!res.ok) {
    const problem = parseProblem(await res.text().catch(() => ''));
    throw new ApiError(res.status, problemMessage(res.status, problem), problem);
  }
  return (await res.json()) as T;
}

export const api = {
  listDocuments: (limit = 50, signal?: AbortSignal) =>
    getJson<DocumentListResponse>(`/api/documents?limit=${limit}`, signal),

  getDocument: (id: string, signal?: AbortSignal) =>
    getJson<DocumentDetail>(`/api/documents/${encodeURIComponent(id)}`, signal),

  listDocumentTypes: (signal?: AbortSignal) => getJson<DocumentTypesResponse>('/api/document-types', signal),

  contentUrl: (id: string) => apiUrl(`/api/documents/${encodeURIComponent(id)}/content`),

  eventsUrl: () => apiUrl('/api/events'),

  /**
   * Sube archivos con XMLHttpRequest para poder informar el progreso.
   * `onProgress` recibe una fracción entre 0 y 1.
   */
  uploadDocuments(
    files: File[],
    options: { expectedType?: string | null; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ): Promise<UploadResponse> {
    const form = new FormData();
    for (const file of files) form.append('files', file, file.name);
    if (options.expectedType) form.append('expectedType', options.expectedType);

    return new Promise<UploadResponse>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', apiUrl('/api/documents'));
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.responseType = 'text';

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            options.onProgress?.(1);
            resolve(JSON.parse(xhr.responseText) as UploadResponse);
          } catch {
            reject(new ApiError(xhr.status, 'Respuesta inválida del servidor.'));
          }
          return;
        }
        const problem = parseProblem(xhr.responseText);
        reject(new ApiError(xhr.status, problemMessage(xhr.status, problem), problem));
      };
      xhr.onerror = () => reject(new ApiError(0, problemMessage(0, null)));
      xhr.onabort = () => reject(new DOMException('Subida cancelada', 'AbortError'));

      options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(form);
    });
  },
};
