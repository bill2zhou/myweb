# 放行 TE-Server 的入站端口（默认 80），并列出可用的局域网地址。
# 用法（管理员 PowerShell）：
#   powershell -ExecutionPolicy Bypass -File scripts/open-firewall.ps1
# 也可指定端口：
#   powershell -ExecutionPolicy Bypass -File scripts/open-firewall.ps1 -Port 8080

param(
    [int]$Port = 80,
    [string]$RuleName = "TE-Server"
)

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "需要管理员权限。请右键「以管理员身份运行」PowerShell 后重试。" -ForegroundColor Red
    exit 1
}

$existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "防火墙规则「$RuleName」已存在，先删除旧规则…" -ForegroundColor Yellow
    Remove-NetFirewallRule -DisplayName $RuleName
}

New-NetFirewallRule `
    -DisplayName $RuleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile Private, Domain `
    -Description "允许局域网访问 TE-Server (TCP $Port)" | Out-Null

Write-Host "已添加防火墙入站规则：$RuleName (TCP $Port)" -ForegroundColor Green

Write-Host ""
Write-Host "本机可用的局域网地址：" -ForegroundColor Cyan
Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } |
    ForEach-Object {
        $suffix = if ($Port -eq 80) { "" } else { ":$Port" }
        Write-Host ("  http://{0}{1}    [{2}]" -f $_.IPAddress, $suffix, $_.InterfaceAlias)
    }

Write-Host ""
Write-Host "提示：其它电脑请选择与访问方处于同一网段的那个地址。" -ForegroundColor Cyan
