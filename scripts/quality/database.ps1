$ErrorActionPreference='Stop'
$bin=if ($env:RSX_QUALITY_PG_BIN) { $env:RSX_QUALITY_PG_BIN } else { '.local-tests/node_modules/@embedded-postgres/windows-x64/native/bin' }
$suffix=if ($IsWindows) { '.exe' } else { '' }
if (!(Test-Path "$bin/pg_ctl$suffix")) { Write-Output 'BLOCKED: set RSX_QUALITY_PG_BIN to the PostgreSQL fixture binary directory'; exit 77 }
$bin=(Resolve-Path $bin).Path
$work=Join-Path (Get-Location).Path ('.local-tests/quality-db-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
[IO.File]::WriteAllText((Join-Path (Get-Location).Path '.local-tests/quality-db-current.txt'), $work)
$private=[Guid]::NewGuid().ToString('N')
$pw=Join-Path $work 'password'
[IO.File]::WriteAllText($pw,$private + "`n")
$data=Join-Path $work 'db'
$listener=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0)
$listener.Start()
$port=($listener.LocalEndpoint).Port
$listener.Stop()
$output=if ($env:RSX_QUALITY_OUTPUT) { $env:RSX_QUALITY_OUTPUT } else { Join-Path (Get-Location) '.quality-results' }
New-Item -ItemType Directory -Force $output | Out-Null
& "$bin/initdb$suffix" -D "$data" -U rsx_phase09 -A scram-sha-256 "--pwfile=$pw" --no-locale 2>&1 | Out-File "$work/init.log"
$result=$LASTEXITCODE
Remove-Item -LiteralPath $pw
if ($result -ne 0) { Get-Content "$work/init.log" -Tail 8; exit $result }
& "$bin/pg_ctl$suffix" -D "$data" -l "$work/server.log" -o "-h 127.0.0.1 -p $port" -w start
if ($LASTEXITCODE) { exit $LASTEXITCODE }
try {
  $env:INTEGRATION_DATABASE_URL="postgresql://rsx_phase09:${private}@127.0.0.1:${port}/postgres"
  node -e 'const {Pool}=require("./backend/node_modules/pg"); const p=new Pool({connectionString:process.env.INTEGRATION_DATABASE_URL}); (async()=>{try{await p.query("CREATE DATABASE phase09_test")}finally{await p.end()}})().catch(()=>{console.error("Fixture database creation failed");process.exitCode=1})'
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  $env:INTEGRATION_DATABASE_URL="postgresql://rsx_phase09:${private}@127.0.0.1:${port}/phase09_test"
  if (!$env:ADMIN_CHROME_PATH) {
    $chrome=Get-Command chrome -ErrorAction SilentlyContinue
    if ($chrome) { $env:ADMIN_CHROME_PATH=$chrome.Source }
  }
  & "$bin/postgres$suffix" --version
  $integration=0
  if ($args -notcontains '--browser-only') {
    npm run test:integration --prefix backend -- --json "--outputFile=$output/database-jest.json" 2>&1 | Tee-Object -FilePath "$work/backend-tests.log"
    $integration=$LASTEXITCODE
  }
  Push-Location admin-dashboard
  try {
    node node_modules/@playwright/test/cli.js test test/console.spec.js --reporter=json | Out-File -Encoding utf8 "$output/admin-playwright.json"
    $browser=$LASTEXITCODE
    Get-Content "$output/admin-playwright.json" -Raw | ConvertFrom-Json | Select-Object -ExpandProperty stats | ConvertTo-Json -Compress
  } finally { Pop-Location }
  if ($integration) { exit $integration }
  exit $browser
} finally {
  Remove-Item Env:INTEGRATION_DATABASE_URL,Env:ADMIN_CHROME_PATH -ErrorAction SilentlyContinue
  & "$bin/pg_ctl$suffix" -D "$data" -m fast -w stop
}
