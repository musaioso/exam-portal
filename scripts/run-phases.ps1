# Run a plan's phases, each in its own fresh OpenCode session.
#
#   .\scripts\run-phases.ps1 -List
#   .\scripts\run-phases.ps1 -DryRun
#   .\scripts\run-phases.ps1 [-From p2] [-Fresh] [-Model <id>]
#
# Ported from C:\Users\musaioso\remote\voice\run-phases.ps1.
#
# The driver reads the manifest and the per-phase result files only. It never
# reasons over a brief's body: each phase session reads its own brief, and the
# driver gates on the result JSON that session left behind. Each phase runs in
# a new, named OpenCode session, so the owner can open it from the session list
# and read exactly what that phase did.

[CmdletBinding()]
param(
    [string]$Plan = 'notebooklm-work-orders',
    [switch]$List,
    [switch]$DryRun,
    [string]$From,
    [switch]$Fresh,
    [string]$Model,
    [switch]$ClearLock
)

$ErrorActionPreference = 'Stop'

$root     = Split-Path -Parent $PSScriptRoot
$plansDir = Join-Path $root 'plan'
$stateDir = Join-Path $plansDir 'state'

function Find-Cli {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\ai.opencode.desktop\resources\opencode-cli.exe'),
        (Get-Command opencode-cli -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
        (Get-Command opencode     -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    throw 'cannot find the OpenCode CLI'
}

function Get-Manifest {
    $path = Join-Path $plansDir 'manifest.json'
    if (-not (Test-Path $path)) { throw "no manifest at $path" }
    return (Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Stop-Phase([string]$Message) {
    Write-Host "stopped: $Message"
    exit 1
}

function Show-LogTail([string]$LogPath, [int]$Count = 40) {
    Write-Host "log: $LogPath"
    if (Test-Path $LogPath) { Get-Content $LogPath -Tail $Count | ForEach-Object { Write-Host $_ } }
}

$manifest = Get-Manifest

if ($List) {
    Write-Host ("{0} - {1} - {2} phase(s)" -f $Plan, $manifest.title, @($manifest.phases).Count)
    foreach ($p in $manifest.phases) {
        $sp = Join-Path $stateDir ($p.id + '.json')
        $st = if (Test-Path $sp) { (Get-Content $sp -Raw -Encoding UTF8 | ConvertFrom-Json).status } else { 'pending' }
        Write-Host ("  {0}  {1,-10} {2}" -f $p.id, $st, $p.title)
    }
    exit 0
}

$phases = @($manifest.phases)
$workdir = if ($manifest.workdir) { $manifest.workdir } else { $root }
if (-not (Test-Path $workdir)) { Stop-Phase "workdir missing: $workdir" }

$cli = Find-Cli
if (-not $Model) {
    $Model = if ($env:PHASE_RUNNER_MODEL) { $env:PHASE_RUNNER_MODEL } else { 'opencode-go/deepseek-v4.1-flash' }
}

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

$lockPath = Join-Path $stateDir 'run.lock'
if ($ClearLock -and (Test-Path $lockPath)) { Remove-Item $lockPath -Force }
if (Test-Path $lockPath) {
    $holder = (Get-Content $lockPath -ErrorAction SilentlyContinue | Select-Object -First 1)
    $holderId = 0
    if ($holder -and [int]::TryParse([string]$holder, [ref]$holderId) -and
        (Get-Process -Id $holderId -ErrorAction SilentlyContinue)) {
        Stop-Phase "another run is active ($lockPath, pid $holderId)"
    }
    Remove-Item $lockPath -Force
}
Set-Content -Path $lockPath -Value $PID -Encoding ASCII

try {
    $startIndex = 0
    if ($From) {
        $idx = -1
        for ($i = 0; $i -lt $phases.Count; $i++) { if ($phases[$i].id -eq $From) { $idx = $i; break } }
        if ($idx -lt 0) { throw "-From $From is not a phase of $Plan" }
        $startIndex = $idx
    }

    for ($i = 0; $i -lt $phases.Count; $i++) {
        $phase    = $phases[$i]
        $phaseId  = [string]$phase.id
        $statePath = Join-Path $stateDir ($phaseId + '.json')
        $logPath   = Join-Path $stateDir ($phaseId + '.log')
        $briefPath = Join-Path $root $phase.brief

        if ($i -lt $startIndex) { Write-Host "skip $phaseId - before -From $From"; continue }

        if ((Test-Path $statePath) -and -not $Fresh) {
            $st = (Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json)
            if ($st.status -eq 'done') { Write-Host "skip $phaseId - done"; continue }
        }
        if ($Fresh -and (Test-Path $statePath)) { Remove-Item $statePath -Force }

        if (-not (Test-Path $briefPath)) { Stop-Phase "brief missing for $phaseId - $($phase.brief)" }

        # A unique session id per attempt: every phase starts in a fresh session,
        # and a retry is visibly a new one rather than a continuation.
        $session = "ses-nbwo-$phaseId-$(Get-Date -Format 'yyMMddHHmmss')"
        $title   = "$Plan $phaseId - $($phase.title)"

        if ($DryRun) {
            Write-Host ("{0}  {1}  session={2}  brief={3}" -f $phaseId, $phase.title, $session, $phase.brief)
            continue
        }

        Write-Host "run $phaseId - $($phase.title) - session $session"

        # The brief's body never rides on the command line: PowerShell 5.1
        # splits native arguments on embedded quotes and the briefs quote JSON.
        # The session reads its own brief from disk instead.
        $message = "Execute the phase brief at $briefPath. Read that file first, then the plan and spec it names. The brief is authoritative for scope; the plan is authoritative for the steps. Follow it exactly, do not start another phase, write the phase result JSON it asks for, then stop."

        $stderrPath = $logPath + '.stderr'
        $prevEap = $ErrorActionPreference
        $prevConsole = [Console]::OutputEncoding
        $prevOut = $OutputEncoding
        $ErrorActionPreference = 'Continue'
        [Console]::OutputEncoding = [Text.Encoding]::UTF8
        $OutputEncoding = [Text.Encoding]::UTF8
        Push-Location $workdir
        try {
            & $cli run --session $session --auto --format json --model $Model --title $title $message 2> $stderrPath |
                Tee-Object -FilePath $logPath | Out-Null
            $exitCode = $LASTEXITCODE
        }
        finally {
            $stderrText = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw -ErrorAction SilentlyContinue } else { '' }
            if (Test-Path $stderrPath) { Remove-Item $stderrPath -ErrorAction SilentlyContinue }
            $stdoutText = if (Test-Path $logPath) { Get-Content $logPath -Raw -ErrorAction SilentlyContinue } else { '' }
            Set-Content -Path $logPath -Value ((@($stdoutText, $stderrText) -join '').TrimEnd()) -Encoding UTF8
            [Console]::OutputEncoding = $prevConsole
            $OutputEncoding = $prevOut
            Pop-Location
            $ErrorActionPreference = $prevEap
        }

        if (-not (Test-Path $statePath)) {
            Show-LogTail $logPath
            Stop-Phase "phase $phaseId did not write $statePath"
        }

        $state = Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($state.status -ne 'done') {
            Show-LogTail $logPath
            Stop-Phase "phase $phaseId wrote '$($state.status)' - $($state.summary)"
        }
        if ($exitCode -ne 0) {
            Show-LogTail $logPath
            Stop-Phase "session failed with exit code $exitCode for $phaseId"
        }

        Write-Host "ok $phaseId - $($state.summary)"
    }
}
finally {
    Remove-Item $lockPath -ErrorAction SilentlyContinue
}
