$ErrorActionPreference = 'Stop'
$runtimePath = Join-Path $PSScriptRoot 'storage/ollama/runtime/ollama.exe'
if (-not (Test-Path -LiteralPath $runtimePath)) {
    $installedCommand = Get-Command ollama -ErrorAction SilentlyContinue
    if ($installedCommand) { $runtimePath = $installedCommand.Source }
    else { $runtimePath = Join-Path $env:LOCALAPPDATA 'Programs/Ollama/ollama.exe' }
}
if (-not (Test-Path -LiteralPath $runtimePath)) { throw 'Instale o Ollama: https://ollama.com/download/windows' }
$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:OLLAMA_NO_CLOUD = '1'
$env:OLLAMA_MODELS = Join-Path $PSScriptRoot 'storage/ollama/models'
New-Item -ItemType Directory -Force -Path $env:OLLAMA_MODELS | Out-Null
Write-Host "Ollama local: $runtimePath"
Write-Host "Para baixar o modelo em outro terminal: & '$runtimePath' pull qwen2.5:3b"
& $runtimePath serve
