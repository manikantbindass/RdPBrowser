param([Parameter(Mandatory)][ValidateSet('import','verify','cleanup')] [string]$Operation,[string]$Artifact)
$ErrorActionPreference='Stop'
if ($Operation -eq 'import') {
  if (!$env:WINDOWS_CERTIFICATE -or !$env:WINDOWS_CERTIFICATE_PASSWORD) { throw 'Missing Windows code-signing certificate or password' }
  $certificateFile=Join-Path $env:RUNNER_TEMP 'rsx-release-signing.pfx'
  try {
    [IO.File]::WriteAllBytes($certificateFile,[Convert]::FromBase64String($env:WINDOWS_CERTIFICATE))
    $password=ConvertTo-SecureString $env:WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force
    $signer=@(Import-PfxCertificate -FilePath $certificateFile -CertStoreLocation Cert:\CurrentUser\My -Password $password | Where-Object HasPrivateKey)
    if ($signer.Count -ne 1 -or $signer[0].Thumbprint -notmatch '^[0-9A-F]{40}$') { throw 'Expected a single code-signing identity' }
    "WINDOWS_SIGNING_THUMBPRINT=$($signer[0].Thumbprint)" | Out-File -Append -Encoding utf8 $env:GITHUB_ENV
  } finally { Remove-Item -LiteralPath $certificateFile -Force -ErrorAction SilentlyContinue }
} elseif ($Operation -eq 'verify') {
  $signature=Get-AuthenticodeSignature -LiteralPath $Artifact
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $env:WINDOWS_SIGNING_THUMBPRINT -or !$signature.TimeStamperCertificate) {
    throw 'Installer Authenticode signature or timestamp did not verify'
  }
} elseif ($env:WINDOWS_SIGNING_THUMBPRINT -match '^[0-9A-F]{40}$') {
  Remove-Item -LiteralPath "Cert:\CurrentUser\My\$env:WINDOWS_SIGNING_THUMBPRINT" -Force -ErrorAction SilentlyContinue
}
