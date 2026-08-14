<#
    Publishes the bot service to Bitbucket.

    The company repository holds the service alone - no docs, no README, no history
    from this repository. This builds a clean tree from whatever is committed here,
    commits it as one commit, and replaces the remote branch with it.

        .\scripts\publish-bot.ps1

    Force-pushing is deliberate: the remote is a mirror of teams/, not somewhere
    anyone commits. Nothing there is ever lost that is not already here.
#>

$ErrorActionPreference = 'Stop'

$Remote  = 'https://Praveen_Reddy129@bitbucket.org/CodeRepoInfinitylearn/hrgenie-bot-service.git'
$Branch  = 'main'
$Root    = Split-Path -Parent $PSScriptRoot
$Staging = Join-Path $env:TEMP ("hrgenie-publish-" + [guid]::NewGuid().ToString('N'))

Set-Location $Root

# Refuse to publish what has not been committed: the export below reads HEAD, so
# uncommitted work would be silently left behind.
git diff --quiet HEAD -- teams
if ($LASTEXITCODE -ne 0) {
  Write-Host "teams/ has uncommitted changes. Commit them first:" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  git add -A teams"
  Write-Host "  git commit -m `"...`""
  exit 1
}

Write-Host "Running the tests before anything leaves the machine..."
Push-Location (Join-Path $Root 'teams')
npm test | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Tests failed - nothing published." }
Pop-Location

New-Item -ItemType Directory -Force -Path $Staging | Out-Null
$tar = Join-Path $Staging 'teams.tar'
git archive --format=tar --output=$tar "HEAD:teams"
tar -x -f $tar -C $Staging
Remove-Item $tar
Remove-Item -Recurse -Force (Join-Path $Staging 'docs') -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path $Staging 'README.md') -ErrorAction SilentlyContinue

Set-Location $Staging
git init -q -b $Branch
git add -A
git -c user.name="Praveen" -c user.email="praveen99665522@gmail.com" commit -q -m "HR Genie Teams bot service"
git remote add bitbucket $Remote
git push --force bitbucket "$($Branch):$($Branch)"

$count = (git ls-files | Measure-Object -Line).Lines
Set-Location $Root
Remove-Item -Recurse -Force $Staging -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Published $count files to $Branch." -ForegroundColor Green
Write-Host "Now trigger the pipeline."
