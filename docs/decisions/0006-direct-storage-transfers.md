# 0006 — Direct browser ↔ storage transfers

**Decision.** The browser uploads inputs and downloads outputs directly from object storage
with signed, short-lived requests bound to one key, method, size and content type. The API only
exchanges metadata.

**Reason.** Serverless functions have small request-body limits and cost per transferred byte
and second; files up to gigabytes must not pass through them. Signed requests keep the bucket
private.

**Alternatives.** Proxying uploads through the API (limits, cost); multipart chunked uploads
through functions (complex, still costly).

**Trade-offs.** The bucket needs CORS; the upload cannot be inspected before it lands, so it is
verified afterwards (size and content detection on completion, again in the worker). For
self-hosting, a local driver provides the same contract through an HMAC-signed route.

**Impact.** File size limits are set by product decisions, not by the hosting platform.
