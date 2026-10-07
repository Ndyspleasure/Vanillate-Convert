# 0002 — Browser-first processing

**Decision.** When a browser route exists, the files are within browser limits and the browser
supports the engine's needs (probed at runtime), the conversion runs in a Web Worker in the
visitor's browser. Otherwise it runs on the server, if server processing is available.

**Reason.** Privacy (files never leave the device), cost (no server work, no storage) and speed
for common, light conversions (images, data, subtitles, archives, text tools). A deployment
without workers is still useful.

**Alternatives.** Server-only (simpler, consistent output, but every file is uploaded and costs
money); WebAssembly ports of heavy engines in the browser (large downloads, memory limits,
inconsistent results — rejected for now).

**Trade-offs.** Two implementations for some conversions; browser output depends on the
browser's codecs (handled by capability probes and by not offering unsupported routes).

**Impact.** About 200 conversions run without any server; heavy formats use workers.
