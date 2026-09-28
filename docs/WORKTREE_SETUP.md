# Codex Worktree Setup

Clone to `D:\Documents\Codex\HAU-USC Logistics\active\logistics-hub`.

Until bootstrap merges, base Part 1 on `origin/bootstrap/office-ops-v0.1`. Afterwards use `origin/main`.

Run:
```powershell
git clone https://github.com/invicta-ctrl/logistics-hub.git
cd logistics-hub
git fetch origin --prune
powershell -ExecutionPolicy Bypass -File .\scripts\setup-worktree.ps1 -BaseRef origin/bootstrap/office-ops-v0.1 -Part part-01-ydd-foundation
```

Rules: one writer/worktree; one Part at a time; no permanent staging/prod branches; preserve dirty/unknown work; create the next Part only from the accepted prior baseline.

Branches: feature/part-01-ydd-foundation; feature/part-02-inventory-catalog; feature/part-03-stock-pantry; feature/part-04-lending; feature/part-05-activity-audit; feature/part-06-admin-hardening.
