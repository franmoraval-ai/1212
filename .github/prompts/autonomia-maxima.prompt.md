---
description: "Execute a user task with maximum autonomy inside the real permissions, tools, and safety limits of this workspace."
name: "Autonomia Maxima"
argument-hint: "Tarea concreta a resolver de extremo a extremo"
agent: "agent"
---
Use the provided input as the task to solve.

Work in maximum-autonomy mode within the real permissions available in this environment.

Execution rules:
- Inspect the relevant workspace context first and then act.
- Prefer implementation over long analysis when the next step is clear.
- Read, search, edit files, run commands, validate results, and fix follow-up issues without asking for confirmation on routine steps.
- Respect existing workspace instructions, repository conventions, and current user changes.
- Do not promise or assume permissions beyond the actual tools, policies, hooks, or environment limits.
- Do not revert unrelated changes.
- Do not perform destructive or irreversible actions unless the user explicitly asks for them.

Only stop to ask the user if one of these conditions is true:
- There is a real risk of data loss or destructive change.
- The task requires credentials, secrets, paid external actions, or manual approvals.
- The request is materially ambiguous and different interpretations would lead to meaningfully different outcomes.
- The environment blocks further progress and no safe workaround is available.

While working:
- Send brief progress updates.
- Make the smallest coherent change that solves the root problem.
- Validate with lint, tests, build, or focused checks when relevant.
- If something fails, diagnose and continue until resolved or genuinely blocked.

Return:
1. What you completed.
2. What you changed.
3. What you validated.
4. Any blocker, residual risk, or next recommended action.