param(
  [Parameter(Mandatory=$true)][string]$CertificateDir,
  [Parameter(Mandatory=$true)][string]$IpAddresses,
  [Parameter(Mandatory=$true)][string]$Passphrase
)
$ErrorActionPreference = "Stop"
$securePassword = ConvertTo-SecureString -String $Passphrase -AsPlainText -Force
$caPfx = Join-Path $CertificateDir "pulstavla-root.pfx"
$caCer = Join-Path $CertificateDir "pulstavla-root.cer"
$serverPfx = Join-Path $CertificateDir "server.pfx"
$store = "Cert:\CurrentUser\My"
$ca = Get-ChildItem $store | Where-Object { $_.Subject -eq "CN=Pulstavlan Local Root" -and $_.HasPrivateKey } | Select-Object -First 1
if (-not $ca -and (Test-Path $caPfx)) {
  $imported = Import-PfxCertificate -FilePath $caPfx -CertStoreLocation $store -Password $securePassword -Exportable
  $ca = $imported | Select-Object -First 1
}
if (-not $ca) {
  $ca = New-SelfSignedCertificate -Type Custom -Subject "CN=Pulstavlan Local Root" -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -KeyUsage CertSign,CRLSign,DigitalSignature -CertStoreLocation $store -NotAfter (Get-Date).AddYears(10) -TextExtension @("2.5.29.19={critical}{text}ca=1&pathlength=0")
  Export-PfxCertificate -Cert $ca -FilePath $caPfx -Password $securePassword | Out-Null
}
Export-Certificate -Cert $ca -FilePath $caCer -Type CERT -Force | Out-Null
$san = "DNS=localhost"
foreach ($ip in ($IpAddresses -split "," | Select-Object -Unique)) {
  if ($ip -match "^[0-9.]+$") { $san += "&IPAddress=$ip" }
}
$leaf = New-SelfSignedCertificate -Type Custom -Subject "CN=Pulstavlan Server" -Signer $ca -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -KeyUsage DigitalSignature,KeyEncipherment -CertStoreLocation $store -NotAfter (Get-Date).AddDays(397) -TextExtension @("2.5.29.17={text}$san", "2.5.29.37={text}1.3.6.1.5.5.7.3.1")
try {
  Export-PfxCertificate -Cert $leaf -FilePath $serverPfx -Password $securePassword -Force | Out-Null
} finally {
  Remove-Item -LiteralPath (Join-Path $store $leaf.Thumbprint) -ErrorAction SilentlyContinue
}

if (-not (Test-Path $serverPfx) -or -not (Test-Path $caCer)) { throw "Certifikatfilerna kunde inte skapas." }
