---
name: td-work
description: Implement or resume a scoped Tattoo Drip task with focused validation.
argument-hint: "goal or existing task-note path"
disable-model-invocation: true
---

Handle this task: $ARGUMENTS

Use the current conversation when arguments are empty. Resolve `.claude/task-notes/...` from the repository root, including when started in an app/package area. Read a supplied handoff before investigating; verify its findings against changes since the handoff.

- Check the working tree and preserve existing edits. Identify the affected area and acceptance check; read its instructions and only the matching guidance from [the index](../../../docs/README.md). Do not read every linked document or invoke every skill.
- For a clear small change, implement directly. For an uncertain approach or changes to schema, tenancy, auth or the API contract, outline the affected behavior, files and validation before implementing. Clarify only missing decisions that affect correctness; planning adds no extra approval requirement.
- Search filenames/symbols in the affected area, then read bounded sections. Delegate independent investigation only when it reduces elapsed work or keeps noisy evidence out of this conversation; request concise findings and source paths. Avoid redundant investigations.
- Implement and run checks for changed behavior. Keep necessary security/isolation coverage and generation steps. Retain complete failure evidence in a local log if output is large; preserve the exit status and inspect the cause. Repeat successful checks only after relevant changes or new evidence.
- Finish with the resulting behavior, changed paths, validation and any remaining blocker. Use [workflow guidance](../../../docs/agent-workflow.md) only for session or memory decisions. Creating commits, publishing or messaging others requires user authorization.
