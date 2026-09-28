param([string]$BaseRef="origin/bootstrap/office-ops-v0.1",[string]$Part="part-01-ydd-foundation")
$ErrorActionPreference="Stop"
$repo=(Resolve-Path ".").Path
if(-not(Test-Path(Join-Path $repo ".git"))){throw "Run from logistics-hub repository root."}
$status=git status --porcelain
if($status){throw "Main checkout is dirty. Preserve/resolve it first."}
git fetch origin --prune
$root=Join-Path(Split-Path $repo -Parent)"worktrees";New-Item -ItemType Directory -Force -Path $root|Out-Null
$branch="feature/$Part";$path=Join-Path $root("logistics-hub-"+$Part)
if(Test-Path $path){throw "Worktree exists: $path"}
git show-ref --verify --quiet("refs/heads/"+$branch)
if($LASTEXITCODE -eq 0){git worktree add $path $branch}else{git worktree add -b $branch $path $BaseRef}
if($LASTEXITCODE -ne 0){throw "git worktree add failed"}
Write-Host "Created $branch at $path"
Write-Host "Open it in Codex and read AGENTS.md -> .codex/CURRENT.md -> accepted spec."
