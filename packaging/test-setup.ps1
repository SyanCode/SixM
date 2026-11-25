# Essaie l'installateur produit dans dist/ : installation, lancement, mise à jour, désinstallation.
# N'utilise qu'un dossier temporaire : ni raccourci, ni registre, ni réglages de l'utilisateur.
$ErrorActionPreference = 'Stop'
$setup = (Get-ChildItem "$PSScriptRoot\..\dist\SixM-Setup-*.exe" | Select-Object -First 1).FullName
$base = Join-Path ([IO.Path]::GetTempPath()) ("sixm-setup-" + [Guid]::NewGuid().ToString('N'))
$dir = Join-Path $base 'Programmes été\SixM'
$env:SIXM_HOME = Join-Path $base 'data'
$env:SIXM_NO_WINDOW = '1'
function Check($ok, $what) { if (-not $ok) { throw "ECHEC : $what" } else { "ok  $what" } }
function Setup { $p = Start-Process $setup -ArgumentList (@('--silent', '--no-shortcuts', '--no-launch', '--dir', "`"$dir`"") + $args) -Wait -PassThru; $p.ExitCode }

Check ((Setup) -eq 0) 'installation silencieuse'
Check (Test-Path "$dir\SixM.exe") 'SixM.exe présent'
Check ((& "$dir\node\node.exe" "$dir\app\bin\sixm.js" help) -match 'usage') 'sixm.js fonctionne avec le Node fourni'

Start-Process "$dir\SixM.exe" -WorkingDirectory $base
$lock = Join-Path $env:SIXM_HOME 'app.json'
for ($i = 0; $i -lt 60 -and -not (Test-Path $lock); $i++) { Start-Sleep -Milliseconds 250 }
$url = (Get-Content $lock -Raw | ConvertFrom-Json).url
$origin, $token = $url -split '/#'
$state = Invoke-RestMethod "$origin/api/state" -Headers @{ 'x-sixm-token' = $token }
Check ($state.session.status -eq 'idle') 'interface en marche'
$first = (Get-Content $lock -Raw | ConvertFrom-Json).pid
Start-Process "$dir\SixM.exe" -WorkingDirectory $base
Start-Sleep -Seconds 3
$nodes = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -eq "$dir\node\node.exe" })
Check ($nodes.Count -eq 1 -and $nodes[0].ProcessId -eq $first) 'un second lancement réutilise SixM'
$hosted = Invoke-RestMethod "$origin/api/hosts" -Method Post -Headers @{ 'x-sixm-token' = $token } -Body '{"name":"Essai","port":30971}'
Invoke-RestMethod "$origin/api/hosts/start" -Method Post -Headers @{ 'x-sixm-token' = $token } -Body "{`"id`":`"$($hosted.id)`"}" | Out-Null
Start-Sleep -Seconds 2
Check ((Invoke-RestMethod 'http://localhost:30971/info.json').name -eq 'Essai') 'un serveur hébergé démarre'

Set-Content "$dir\ancien.txt" 'x'
Check ((Setup) -eq 0) 'mise à jour pendant que SixM tourne'
Check (-not (Test-Path "$dir\ancien.txt")) 'dossier remplacé'
Check (@(Get-ChildItem (Split-Path $dir) -Directory).Count -eq 1) 'aucun dossier temporaire'

$mine = Join-Path $base 'a-moi'; New-Item -ItemType Directory $mine | Out-Null; Set-Content "$mine\doc.txt" 'x'
$p = Start-Process $setup -ArgumentList @('--silent', '--no-shortcuts', '--no-launch', '--dir', "`"$mine`"") -Wait -PassThru
Check ($p.ExitCode -eq 1 -and (Test-Path "$mine\doc.txt")) 'refuse un dossier étranger'

Start-Process "$dir\Uninstall.exe" -ArgumentList '--uninstall', '--silent' -Wait
for ($i = 0; $i -lt 60 -and (Test-Path $dir); $i++) { Start-Sleep -Milliseconds 250 }
Check (-not (Test-Path $dir)) 'désinstallation'
Check (Test-Path $env:SIXM_HOME) 'réglages conservés'
Remove-Item $base -Recurse -Force -ErrorAction SilentlyContinue
'installateur vérifié'
