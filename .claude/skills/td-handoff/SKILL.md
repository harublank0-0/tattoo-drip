---
name: td-handoff
description: Save the current Tattoo Drip task as a compact resumable handoff.
argument-hint: "short task name"
disable-model-invocation: true
---

Prepare a handoff for: $ARGUMENTS

Use the current task when arguments are empty. Keep the handoff in the existing task ledger, or one repo-root `.claude/task-notes/<task>.md` file; use a simple filename slug and keep the resolved path inside that directory. Update the existing note rather than creating competing summaries.

Capture the goal/acceptance check, area/branch and user edits, verified findings with source paths, changed paths, exact validation commands/results and unrun checks, open decisions/blockers, and next concrete action. Use the current conversation plus a bounded working-tree check; do not repeat completed exploration or rerun checks just to write the note.

Keep only what another session needs to resume. Link canonical docs; omit transcripts, copied code, full diffs, log dumps, secrets and speculative facts. Mark uncertainty explicitly. Record needed canonical corrections as follow-up. Saving a handoff edits only its note/ledger unless the user also requested documentation changes.

End with the note path and a short resume prompt that explicitly names the note. Saving a handoff does not authorize a commit, push, deployment or external message. See [session guidance](../../../docs/agent-workflow.md#everyday-sessions-and-handoffs) when needed.
