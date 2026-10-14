# Model references and tool transport capabilities

## Scope and signatures

Applies to `modelCapabilities(target)`, `compileGeneration(profile, task, target, operation)` and model parameter UI. `officialModelRule(protocol, baseUrl, model)` matches the exact official endpoint, protocol and model. An explicit `parameterPolicy.ruleId` selects parameter mappings; it does not establish a gateway's tool transport capabilities.

## Contract

- Keep explicit parameter bindings, model IDs, protocol, reasoning effort and budgets unchanged.
- Obtain Chat `capabilities.tools` from the exact official match, independently of the selected parameter reference. Selecting another reference must not bypass a known official tool restriction.
- Unknown gateways and aliases remain unverified. Allow their ordinary tool request without automatic retries, protocol/model switching or parameter stripping; provider validation and complete-response checks still apply.
- Official GPT-6.1 Sol/Astra Chat tools require Responses. Official GPT-6 Sol/Luna Chat tools require explicit `none`; error text gives that actionable guidance. See [GPT-6.1 Sol documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol).
- Update the model rule revision when changing effective capability behavior; signed/private histories retain their existing scope checks.
- Incomplete streams preserve visible fragments but never return executable partial tools. Public errors must not expose provider payloads or credentials, or imply that every protocol failure is caused by the user's prompt.

## Validation matrix

| Case | Expected behavior |
| --- | --- |
| Gateway + GPT reference + high effort | Preserve request parameters; tools remain unknown; send once |
| Exact official endpoint/model + alternate reference | Keep official tool restriction before HTTP |
| Official Responses | Permit tools through existing Responses adapter |
| Missing terminal, malformed arguments or stream error | Reject step; preserve visible fragments; no partial tool |
| Gateway HTTP 400 | Report rejection; no parameter stripping or protocol fallback |

## Examples and tests

Good: bind a reference for a gateway alias while preserving the alias on the wire. Base: unbound gateway uses existing compatibility parameters. Wrong: copying `selectedReference.toolsChat` into every gateway's capabilities. Correct: resolve official tool restrictions from the actual endpoint/protocol/exact model.

`model-rule-registry.test.ts` covers official/gateway/alias/missing-endpoint/reference combinations. `gateway-tool-compatibility.test.ts` uses loopback HTTP for streamed call/result/final-reply roundtrips, exact request preservation, malformed responses, redaction and no retries. Existing native protocol, cancellation and parameter regressions remain required. Live-provider success is evidence for that tested combination, not proof of underlying model identity or universal gateway support.
