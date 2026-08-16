// Error REST wire contract. Every non-2xx JSON response from the server's
// error handler (server/src/http/errors.ts) has this shape. The web api
// layer parses it defensively (fields may be absent on a malformed body)
// but this is what the server emits.

/** Stable, sanitized error envelope returned on any handled HTTP error. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
