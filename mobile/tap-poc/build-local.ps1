param(
    [string]$SdkPath = "$env:LOCALAPPDATA/Android/Sdk",
    [string]$JdkPath = $env:JAVA_HOME,
    [string]$BuildTools = '36.0.0',
    [string]$ProvisioningFile = ''
)
$ErrorActionPreference = 'Stop'
function Run-Checked([string]$Tool, [string[]]$ToolArgs) {
    $previousJavaHome = $env:JAVA_HOME
    try {
        $env:JAVA_HOME = $JdkPath
        & $Tool @ToolArgs
        if ($LASTEXITCODE -ne 0) { throw "Falha ao executar $Tool" }
    } finally {
        $env:JAVA_HOME = $previousJavaHome
    }
}
$outPath = Join-Path $PSScriptRoot 'build/local'
$toolsPath = Join-Path $SdkPath "build-tools/$BuildTools"
$androidJar = Join-Path $SdkPath 'platforms/android-36/android.jar'
if (-not $JdkPath -or -not (Test-Path -LiteralPath "$JdkPath/bin/javac.exe")) { throw 'Informe -JdkPath com um JDK instalado.' }
if (-not (Test-Path -LiteralPath $androidJar)) { throw 'Instale a plataforma Android SDK 36 pelo Android Studio.' }
New-Item -ItemType Directory -Force -Path "$outPath/classes", "$outPath/dex" | Out-Null
$terminalSource = "$PSScriptRoot/app/src/main/java/br/com/chargegrid/taptest/TerminalConfig.java"
if ($ProvisioningFile) {
    $terminal = Get-Content -LiteralPath $ProvisioningFile -Raw | ConvertFrom-Json
    if ($terminal.server -ne 'https://charge-grid-hub.onrender.com' -or
        $terminal.handle -notmatch '^[A-Za-z0-9_-]{1,100}$' -or $terminal.key -notmatch '^[a-f0-9]{64}$') {
        throw 'Configuração privada do terminal inválida.'
    }
    New-Item -ItemType Directory -Force -Path "$outPath/generated" | Out-Null
    $terminalSource = "$outPath/generated/TerminalConfig.java"
    $terminalJava = 'package br.com.chargegrid.taptest; final class TerminalConfig { static final boolean CONFIGURED=true; static final String SERVER="' + $terminal.server + '"; static final String HANDLE="' + $terminal.handle + '"; static final String KEY="' + $terminal.key + '"; }'
    [System.IO.File]::WriteAllText($terminalSource, $terminalJava)
}
[xml]$manifestXml = Get-Content -LiteralPath "$PSScriptRoot/app/src/main/AndroidManifest.xml" -Raw -Encoding UTF8
$manifestXml.manifest.SetAttribute('package', 'br.com.chargegrid.taptest')
$manifestXml.Save("$outPath/AndroidManifest.xml")
Run-Checked "$toolsPath/aapt2.exe" @('link', '-o', "$outPath/base.apk", '-I', $androidJar,
    '--manifest', "$outPath/AndroidManifest.xml", '--min-sdk-version', '30', '--target-sdk-version', '35')
Run-Checked "$JdkPath/bin/javac.exe" @('-encoding', 'UTF-8', '--release', '8',
    '-classpath', $androidJar, '-d', "$outPath/classes",
    "$PSScriptRoot/app/src/main/java/br/com/chargegrid/taptest/MainActivity.java", $terminalSource)
Run-Checked "$JdkPath/bin/jar.exe" @('cf', "$outPath/classes.jar", '-C', "$outPath/classes", '.')
Run-Checked "$toolsPath/d8.bat" @('--min-api', '30', '--lib', $androidJar, '--output', "$outPath/dex", "$outPath/classes.jar")
Run-Checked "$JdkPath/bin/jar.exe" @('uf', "$outPath/base.apk", '-C', "$outPath/dex", 'classes.dex')
Run-Checked "$toolsPath/zipalign.exe" @('-f', '4', "$outPath/base.apk", "$outPath/aligned.apk")
$keyPath = Join-Path $outPath 'test.keystore'
if (-not (Test-Path -LiteralPath $keyPath)) {
    # Local test certificate only. Never use this key/password for production.
    Run-Checked "$JdkPath/bin/keytool.exe" @('-genkeypair', '-keystore', $keyPath, '-storepass', 'android',
        '-keypass', 'android', '-alias', 'taptest', '-keyalg', 'RSA', '-validity', '3650', '-dname', 'CN=ChargeGrid Local Test')
}
Run-Checked "$toolsPath/apksigner.bat" @('sign', '--ks', $keyPath, '--ks-key-alias', 'taptest',
    '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', "$outPath/chargegrid-tap-teste.apk", "$outPath/aligned.apk")
Run-Checked "$toolsPath/apksigner.bat" @('verify', '--verbose', "$outPath/chargegrid-tap-teste.apk")
Write-Host "APK: $outPath/chargegrid-tap-teste.apk"
