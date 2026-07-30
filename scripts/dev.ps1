<#
    Starts the Django API and the Vite dev server together.

    Usage:  powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
#>

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

# Node ships without being added to PATH on some Windows setups.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $nodeDir = "C:\Program Files\nodejs"
    if (Test-Path $nodeDir) {
        $env:Path = "$nodeDir;$env:Path"
    } else {
        throw "Node.js not found. Install it, or add it to PATH."
    }
}

$python = "$env:USERPROFILE\miniconda3\envs\venv\python.exe"
if (-not (Test-Path $python)) {
    if (Get-Command python -ErrorAction SilentlyContinue) {
        $python = "python"
        Write-Host "conda env 'venv' not found; using python from PATH." -ForegroundColor Yellow
    } else {
        throw "No Python found. Run 'conda activate venv' first."
    }
}

Write-Host "Applying migrations..." -ForegroundColor Cyan
& $python "$root\backend\manage.py" migrate

Write-Host "Starting Django on http://127.0.0.1:8000 ..." -ForegroundColor Cyan
$api = Start-Process -FilePath $python `
    -ArgumentList "$root\backend\manage.py", "runserver", "127.0.0.1:8000" `
    -WorkingDirectory "$root\backend" -PassThru

try {
    if (-not (Test-Path "$root\frontend\node_modules")) {
        Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
        Push-Location "$root\frontend"
        npm install
        Pop-Location
    }

    Write-Host "Starting Vite on http://localhost:5173 ..." -ForegroundColor Cyan
    Push-Location "$root\frontend"
    npm run dev
    Pop-Location
} finally {
    if ($api -and -not $api.HasExited) {
        Write-Host "Stopping Django..." -ForegroundColor Cyan
        Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
    }
}
