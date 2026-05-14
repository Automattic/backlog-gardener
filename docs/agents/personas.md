# Backlog Gardener Agent Personas

Canonical persona text lives in the runtime prompt persona files so prompts can include it directly instead of duplicating it:

- [Triage Agent — Signal Gardener](../../src/gardener/prompts/personas/triage.md)
- [Evaluator Agent — Engineering Triage Lead](../../src/gardener/prompts/personas/evaluator.md)
- [Verifier Agent — Debugging Partner](../../src/gardener/prompts/personas/verifier.md)

Prompt files reference these with persona includes, for example:

```md
{{persona:triage}}
```

This keeps the role definitions centralized while allowing each prompt to add stage-specific instructions.
