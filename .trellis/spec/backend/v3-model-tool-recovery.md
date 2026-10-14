# V3 model tool replay and error recovery

## Scope

Gemini tool history, four remote transports, model text probes and assistant prompt recall. No changes to protocols, model IDs, generation rules, credentials, configuration schemas or automatic retries.

## Contracts

- Validate Gemini private history first. Omit empty text parts without a function call or thought signature only during wire serialization. Preserve signed empty tails, thought text, provider IDs, arguments and stored history. Reject invalid or foreign envelopes and incomplete calls.
- HTTP errors use application-authored recovery messages. Error bodies are read only for classification, capped at 8192 bytes and five seconds, then discarded. Never return provider text, echoed secrets or manuscript fragments.
- 401 requires credential repair. 403 can be permissions, grouping, firewall or access restrictions. 404 directs users to check the service address/model/protocol, without blindly removing version prefixes. Explicit exhausted quota requires account repair; generic 429 advises waiting and checking account limits. 5xx advises retrying later or checking service availability.
- Request/read timeout guidance must not invent seconds from a different timeout. Preserve explicit cancellation identity; network interruptions return safe actionable messages.
- Distinguish output budget exhaustion, safety refusal, malformed tools and missing terminal states. Partial calls remain non-executable. A history identity mismatch requires a new conversation; completed operations remain for review.
- Text probe success is labelled “文字测试通过”, explicitly “尚未验证工具调用”. It does not prove or deny tool support. “取回原要求” restores input without sending it; preserve existing drafts and require explicit submit.
- Preserve existing narrowly defined transport fallback behavior. This change adds no protocol downgrade, parameter stripping, automatic model switch or new retries.

## Verification

- Gemini loopback rejects unsigned empty data on round two; the repaired body succeeds while signed tails and original history remain intact.
- Four-protocol HTTP rejection, quota/firewall, cancellation, timeout, stream interruption and no-retry/redaction regressions.
- Existing incomplete, duplicate-ID, signature and cross-protocol history guards remain tested.
- Native model UI displays the limited text-test evidence; assistant error UI explains recovery and keyboard recall sends no request.
- Typecheck, architecture, focused model/assistant suite and production build. Live provider checks are bounded synthetic diagnostics, not model identity or all-mode certification.

## Rollback

Revert only the dedicated fix commit. No migration or rule revision change is required. Source publication does not replace previously released installers.
