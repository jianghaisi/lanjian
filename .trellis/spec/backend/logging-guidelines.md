> V3 status: `candidate-for-v3`. General privacy intent is covered by `v3-error-privacy.md`; feature-specific log fields are not accepted.

# Logging and privacy

- Use structured local records with timestamp, level, event, operationId/jobId and safe metadata.
- Never log API keys, Authorization headers, encrypted secret blobs, full prompts or full manuscript content.
- AI logs contain provider host, model, timing, token usage when returned, status and redacted error code.
- File logs contain project-relative paths, never unrelated absolute paths.
- Logs rotate locally and have a retention limit.
- A diagnostic export is explicitly user-triggered and redacted again before writing.
- Langfuse and remote telemetry are prohibited.

Detailed-outline adoption logs may include proposal/chapter/volume IDs, operation outcome, elapsed time, and truncated fingerprints. They must not include candidate text, formal outline text, manuscript content, prompts, or API credentials.
