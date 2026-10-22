$ErrorActionPreference = 'Stop'
$toolRoot = Join-Path $PSScriptRoot 'build/toolchain'
New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
$ProgressPreference = 'SilentlyContinue'
function Download-Verified($Url, $Path, $Algorithm, $Expected) {
    if (!(Test-Path -LiteralPath $Path) -or (Get-FileHash -LiteralPath $Path -Algorithm $Algorithm).Hash -ne $Expected) {
        Invoke-WebRequest -Uri $Url -OutFile $Path
    }
    if ((Get-FileHash -LiteralPath $Path -Algorithm $Algorithm).Hash -ne $Expected) { throw "Checksum inválido: $Path" }
}
Write-Output 'Consultando metadados oficiais do Eclipse Adoptium e Google Android...'
$jdkAssets = Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse'
$jdkPackage = $jdkAssets[0].binary.package
$jdkZip = Join-Path $toolRoot 'jdk21.zip'
Write-Output 'Baixando JDK21 com validação SHA256...'
Download-Verified $jdkPackage.link $jdkZip 'SHA256' $jdkPackage.checksum
$jdkExtract = Join-Path $toolRoot 'jdk'
if (!(Test-Path -LiteralPath $jdkExtract)) { Expand-Archive -LiteralPath $jdkZip -DestinationPath $jdkExtract }
$jdkPath = (Get-ChildItem -LiteralPath $jdkExtract -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/javac.exe') } | Select-Object -First 1).FullName
if (!$jdkPath) { throw 'JDK21 não localizado no arquivo oficial.' }
[xml]$repository = (Invoke-WebRequest 'https://dl.google.com/android/repository/repository2-1.xml').Content
$packages = $repository.SelectNodes("//*[local-name()='remotePackage']")
$sdkPath = Join-Path $toolRoot 'sdk'
foreach ($definition in @(@{Package='build-tools;36.0.0';Folder='build-tools/36.0.0';Probe='aapt2.exe';Name='buildtools'}, @{Package='platforms;android-36';Folder='platforms/android-36';Probe='android.jar';Name='platform'})) {
    $destination = Join-Path $sdkPath $definition.Folder
    if (Test-Path -LiteralPath (Join-Path $destination $definition.Probe)) { continue }
    $package = $packages | Where-Object { $_.path -eq $definition.Package } | Select-Object -First 1
    if (!$package) { throw "Pacote oficial ausente: $($definition.Package)" }
    $archive = $package.SelectNodes("./*[local-name()='archives']/*[local-name()='archive']") | Where-Object { !$_.SelectSingleNode("./*[local-name()='host-os']") -or $_.SelectSingleNode("./*[local-name()='host-os']").InnerText -eq 'windows' } | Select-Object -First 1
    $complete = $archive.SelectSingleNode("./*[local-name()='complete']")
    $relative = $complete.SelectSingleNode("./*[local-name()='url']").InnerText
    $checksum = $complete.SelectSingleNode("./*[local-name()='checksum']").InnerText
    $zip = Join-Path $toolRoot ($definition.Name + '.zip')
    Write-Output "Baixando $($definition.Package) com validação SHA1..."
    Download-Verified ('https://dl.google.com/android/repository/' + $relative) $zip 'SHA1' $checksum
    $extract = Join-Path $toolRoot ($definition.Name + '-archive')
    if (!(Test-Path -LiteralPath $extract)) { Expand-Archive -LiteralPath $zip -DestinationPath $extract }
    $source = Get-ChildItem -LiteralPath $extract -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName $definition.Probe) } | Select-Object -First 1
    if (!$source) { throw "Estrutura inesperada: $($definition.Package)" }
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Get-ChildItem -LiteralPath $source.FullName -Force | Copy-Item -Destination $destination -Recurse -Force
}
& (Join-Path $PSScriptRoot 'build-local.ps1') -SdkPath $sdkPath -JdkPath $jdkPath
if ($LASTEXITCODE -ne 0) { throw 'Falha na compilação Android.' }
[xml]$appManifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'app/src/main/AndroidManifest.xml') -Raw
$appVersion = $appManifest.manifest.GetAttribute('versionName', 'http://schemas.android.com/apk/res/android')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'build/local/chargegrid-tap-teste.apk') -Destination (Join-Path $PSScriptRoot "build/local/chargegrid-tap-v$appVersion.apk") -Force
Write-Output "APK v$appVersion compilado e assinado. Ferramentas ficaram em build/toolchain."
