import { API_BASE_URL } from '@/lib/api-config'
import { ApiError, getErrorMessage, logoutAfterAuthFailure, refreshAccessToken } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

export type UploadOptions = {
  // Multipart field name the backend reads with `request.file()` (e.g. 'logo',
  // 'avatar'). The server only looks at the first file part, but the name is
  // still the documented contract.
  field: string
  /**
   * Extra TEXT parts sent alongside the file, in the same multipart body.
   *
   * 🔑 Added by [F-DISPUTE], which is the first route that takes a file AND a
   * field: `POST /disputes/{id}/evidence` wants `evidence` (the file) plus a
   * mandatory `message`, and refuses anything else. Before this, `uploadFile`
   * could only ever send the file, so the dispute form would have had to drop
   * down to `fetch` — and `fetch` has NO upload-progress event, which is the
   * one thing this module exists to provide. That is exactly the gap review
   * flagged on [F4]; do not reintroduce it.
   *
   * ⚠️ THE PART COUNT IS A CONTRACT, NOT A DETAIL. That route caps the body at
   * `files: 1, fields: 1, parts: 2`, so ONE extra entry here — even an empty
   * hidden one — makes the whole request a 400. Callers pass exactly what the
   * route documents.
   *
   * Omitted by the avatar and team-logo callers, whose routes read the file and
   * nothing else: the body they send is byte-identical to before.
   */
  fields?: Record<string, string>
  // Percent (0-100), derived from XHR's native `upload.onprogress` — `fetch`
  // has no upload-progress event, which is the whole reason this file uses
  // XMLHttpRequest instead of apiFetch.
  onProgress?: (percent: number) => void
}

// Mirrors buildApiUrl in api.ts (kept private there): same relative /api
// prefix, so an absolute URL passed in is left untouched.
function buildUploadUrl(path: string) {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }

  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

function parseXhrPayload(xhr: XMLHttpRequest): unknown {
  const text = xhr.responseText

  if (!text) {
    return null
  }

  const contentType = xhr.getResponseHeader('content-type') ?? ''

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  return text
}

function sendUpload<T>(
  path: string,
  file: File,
  options: UploadOptions,
  allowRefresh: boolean,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', buildUploadUrl(path))
    xhr.withCredentials = true

    const accessToken = useAuthStore.getState().accessToken
    if (accessToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`)
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onProgress?.(Math.round((event.loaded / event.total) * 100))
      }
    }

    xhr.onload = () => {
      if (xhr.status === 401 && allowRefresh) {
        // Same one-shot retry as apiFetch's `request()`: refresh once, resend
        // once, never loop. `allowRefresh: false` on the retry guarantees that.
        void refreshAccessToken().then((refreshed) => {
          if (refreshed) {
            sendUpload<T>(path, file, options, false).then(resolve, reject)
            return
          }

          // Le refresh a été TENTÉ et REFUSÉ : la session est morte, on la purge comme le
          // fait `request()` dans api.ts. Un token simplement expiré n'arrive jamais ici —
          // il a été absorbé par le retry ci-dessus, sans que l'utilisateur voie rien.
          void logoutAfterAuthFailure()

          const payload = parseXhrPayload(xhr)
          reject(new ApiError(xhr.status, payload, getErrorMessage(xhr.status, payload)))
        })
        return
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        const payload = parseXhrPayload(xhr)
        reject(new ApiError(xhr.status, payload, getErrorMessage(xhr.status, payload)))
        return
      }

      resolve(parseXhrPayload(xhr) as T)
    }

    xhr.onerror = () => {
      reject(new ApiError(0, null, 'Network error during upload.'))
    }

    xhr.onabort = () => {
      reject(new ApiError(0, null, 'Upload aborted.'))
    }

    const formData = new FormData()
    // Text parts FIRST, file last. The multipart body is a STREAM and busboy hands the parts
    // over in wire order; the small fields are therefore parsed before the handler starts
    // buffering a 5 MB body. The current handler happens to loop over every part before it
    // validates, so this buys nothing today — it is ordering hygiene, so that a server that
    // ever short-circuits on a missing field can do so without reading the upload first.
    for (const [name, value] of Object.entries(options.fields ?? {})) {
      formData.append(name, value)
    }
    formData.append(options.field, file)
    xhr.send(formData)
  })
}

// XMLHttpRequest-based sibling of apiFetch: same relative URL, same Bearer
// token from the auth store, same `credentials: include` (withCredentials),
// same ApiError on a non-2xx response — but over XHR so upload progress can
// be reported, which fetch cannot do.
export function uploadFile<T>(path: string, file: File, options: UploadOptions): Promise<T> {
  return sendUpload<T>(path, file, options, true)
}
