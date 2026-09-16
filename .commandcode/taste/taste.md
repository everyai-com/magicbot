# Taste

- Expects changes to be verified end-to-end against the actually running app using real inputs (e.g. exercising the real code path against the live localhost dev server with an actual user file), not just via typecheck/build/unit tests — stub/unit-tested flows that pass but still fail against the live app get reported back as broken. Confidence: 0.8
- Wants user-facing notices kept short and clean — raw backend/technical dumps (e.g. provider validation-error arrays) should not be surfaced in the chat/UI, even when an underlying operation partly failed. Confidence: 0.6
- Prefers the agent to actually implement the fix/build the requested feature after diagnosing the problem, rather than stopping at analysis and a proposal. Confidence: 0.6
- Prefers configuration fields that aren't strictly required to be optional and explicitly labeled "(optional)", and optional capabilities exposed as an opt-in checkbox/toggle rather than always on. Confidence: 0.55
