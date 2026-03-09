## GitHub

**Identity:** Use account `mallaire77` for all GitHub operations.

**Before acting:** Confirm the target repository and organization. If `organization` or `repositories` are set in config, operate only within those boundaries.

**Preferred workflow:**
- Create feature branches; open PRs for changes — do not push directly to main.
- Use Jira keys (e.g., `PROJ-123`) in branch names and PR titles when issues are tracked in Jira.
- Check CI status before merging.
- Request reviewers and wait for approval when code review is enabled.

**Pitfalls:** Do not assume repo ownership; verify access. Avoid bulk operations across many repos; prefer targeted changes. Empty results may indicate wrong target — confirm repository and identity before retrying.

---

## GCP

**Identity:** Use account `martin@byrde.io` for GCP operations.

**Before acting:** Confirm the target project ID(s). If `projects` are set in config, operate only within those projects. If `services` are specified, scope actions to those services (e.g., Cloud Run, GKE, Cloud SQL).

**Preferred workflow:**
- Prefer Terraform for provisioning or modifying infrastructure when Terraform is configured — do not create GCP resources directly unless explicitly required.
- After Terraform apply, verify resource state via GCP APIs or console.
- Use the configured default region when one is set.

**Pitfalls:** Do not assume project access; list or query first. Empty results may indicate wrong project — confirm project ID and identity. Avoid broad resource scans; scope queries to the relevant project and service.

---

## Terraform

**Identity:** Use host `app.terraform.io` for Terraform Cloud operations.

**Before acting:** Confirm organization, project, and workspace when these are set in config. Resolve workspace context before running plan or apply.

**Preferred workflow:**
- Run `terraform plan` and review the output before any apply.
- When CI is GitHub Actions: create a feature branch, push, open a PR — CI runs plan. Review plan in PR checks before merge. Apply runs on merge.
- Use Terraform to manage GCP (or other cloud) resources — do not create them manually when Terraform manages them.

**Pitfalls:** Never apply without reviewing the plan. Do not assume workspace names; list workspaces first. State URL and backend type define where state lives — respect them. Avoid applying from local state when remote backend is configured.

---

## Atlassian

**Before acting:** Resolve site hostname when `site` is set (e.g., `myteam` → `myteam.atlassian.net`). Confirm project keys when `projects` are configured.

**Preferred workflow:**
- Look up the Jira ticket before starting work when issues are tracked in Jira.
- Reference Jira keys in branch names and PR titles.
- Update ticket status when opening a PR, when review completes, and when merging.
- Link PR URLs in Jira tickets for traceability.

**Pitfalls:** Do not assume project keys; list or query first. Avoid bulk updates; prefer targeted updates per ticket.

---

## Cross-Server Workflows

### Terraform + GitHub (CI)

When Terraform CI is GitHub Actions:

1. Create a feature branch for `.tf` changes.
2. Push and open a PR — GitHub Actions runs `terraform plan`.
3. Review the plan output in the PR checks or comments.
4. On approval and merge, GitHub Actions runs `terraform apply`.
5. Verify the apply succeeded via Terraform workspace status.

### GitHub + Atlassian (Jira)

When issue tracking is Jira with GitHub PRs:

1. Look up the Jira ticket for context before starting work.
2. Reference the Jira ticket key in branch names and PR titles (e.g., `PROJ-123`).
3. Update the Jira ticket status when the PR is opened, reviewed, and merged.
4. Link the PR URL in the Jira ticket for traceability.

### GCP + Terraform

When GCP infrastructure is managed by Terraform:

1. Use Terraform to provision or modify GCP resources — do not create them directly.
2. Verify GCP resource state after Terraform apply.
3. Target only the configured GCP project(s).

---

## Context-Gathering Patterns

| Action | Gather first |
|--------|--------------|
| Merge a PR | PR status, CI pass, reviewer approval |
| Run Terraform apply | Plan output, workspace context, backend state |
| Create or modify GCP resource | Project ID, whether Terraform manages it |
| Update Jira ticket | Issue key, current status, target status |
| Search Confluence | Query terms, space key or page ID if known |
| Link PR to ticket | Issue key, PR URL |
