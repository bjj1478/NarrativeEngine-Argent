# Finds — and optionally closes — processes left holding the app's dev ports.
#
# Why this exists: `concurrently -k` ties the server and Vite together only while
# their parent is alive. If the console window is closed outright (or the process
# tree is force-killed), the grandchildren survive and keep holding 5173/3001.
# A leftover process is the reason the app can look permanently broken no matter
# how many times it is restarted, so the launcher needs a way to clear it.
#
# Usage:
#   dev-ports.ps1 -Action list   -> print what is holding the ports; exit 1 if any
#   dev-ports.ps1 -Action stop   -> stop the app's own leftovers; exit 1 if any remain
#
# Only ever stops node processes. Anything else holding the port is reported and
# left alone — it is not ours to kill.

[CmdletBinding()]
param(
    [ValidateSet('list', 'stop')]
    [string]$Action = 'list',

    [int[]]$Ports = @(5173, 3001)
)

$ErrorActionPreference = 'Stop'

function Get-PortHolders {
    param([int[]]$Ports)

    $holders = @()
    foreach ($port in $Ports) {
        $conns = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
                 Where-Object { $_.LocalPort -eq $port }
        foreach ($conn in $conns) {
            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($null -eq $proc) { continue }
            $holders += [pscustomobject]@{
                Port    = $port
                Pid     = $conn.OwningProcess
                Name    = $proc.ProcessName
                Started = $proc.StartTime
                IsOurs  = ($proc.ProcessName -eq 'node')
            }
        }
    }
    # One process can hold both ports; report it once per port but stop it once.
    return $holders
}

$holders = @(Get-PortHolders -Ports $Ports)

if ($holders.Count -eq 0) {
    if ($Action -eq 'list') { Write-Output 'No running instance detected - OK.' }
    exit 0
}

foreach ($h in $holders) {
    $label = if ($h.IsOurs) { 'Narrative Engine' } else { 'NOT the Narrative Engine' }
    Write-Output ("  port {0} - {1} (pid {2}) - {3}" -f $h.Port, $h.Name, $h.Pid, $label)
}

if ($Action -eq 'list') { exit 1 }

# --- stop ---
$foreign = @($holders | Where-Object { -not $_.IsOurs })
if ($foreign.Count -gt 0) {
    Write-Output ''
    Write-Output 'Some of these are not part of this app, so they were left running.'
    Write-Output 'You will need to close that program yourself, or change the port.'
}

$ours = @($holders | Where-Object { $_.IsOurs })
foreach ($procId in ($ours | Select-Object -ExpandProperty Pid -Unique)) {
    try {
        Stop-Process -Id $procId -Force -ErrorAction Stop
        Write-Output ("  Closed leftover process (pid {0})." -f $procId)
    } catch {
        Write-Output ("  Could not close pid {0}: {1}" -f $procId, $_.Exception.Message)
    }
}

Start-Sleep -Seconds 2

$remaining = @(Get-PortHolders -Ports $Ports)
if ($remaining.Count -gt 0) {
    Write-Output ''
    Write-Output 'Some ports are still busy:'
    foreach ($h in $remaining) {
        Write-Output ("  port {0} - {1} (pid {2})" -f $h.Port, $h.Name, $h.Pid)
    }
    exit 1
}

Write-Output ''
Write-Output 'All leftover processes closed - ports are free.'
exit 0
