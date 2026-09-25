<# deploy-github.ps1 - Deploy to GitHub Actions #>

Write-Host "============================================================"
Write-Host "  DEPLOY A GITHUB ACTIONS (gratis, 2000 min/mes)"
Write-Host "============================================================"
Write-Host ""

# 1. Verificar/instalar GitHub CLI
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "Instalando GitHub CLI (gh)..." -ForegroundColor Yellow
    try {
        winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements
        Write-Host "gh instalado. REINICIA PowerShell y vuelve a ejecutar." -ForegroundColor Green
        Read-Host "Presiona ENTER para salir"
        exit 0
    } catch {
        Write-Host "Error instalando gh. Instala manual: https://cli.github.com/" -ForegroundColor Red
        Read-Host "Presiona ENTER para salir"
        exit 1
    }
}
Write-Host "GitHub CLI disponible" -ForegroundColor Green

# 2. Autenticar
try {
    gh auth status -h github.com | Out-Null
} catch {
    Write-Host "Autenticando con GitHub (se abre navegador)..." -ForegroundColor Yellow
    gh auth login --web --git-protocol https
    Write-Host "Autenticado" -ForegroundColor Green
}

# 3. Git init
if (-not (Test-Path ".git")) {
    Write-Host "Inicializando repositorio git..." -ForegroundColor Yellow
    git init
    git add .
    git commit -m "Initial commit: Canal Automatizado Shorts"
    Write-Host "Git init + commit" -ForegroundColor Green
}

# 4. Crear repo y push
Write-Host "Creando repositorio en GitHub..." -ForegroundColor Yellow
try {
    gh repo create canal-automatizado-shorts --public --source=. --push --remote=origin
    Write-Host "Repo creado y codigo subido" -ForegroundColor Green
} catch {
    Write-Host "Repo ya existe, intentando push..." -ForegroundColor Yellow
    try { git push -u origin main } catch { git push -u origin master }
    Write-Host "Push completado" -ForegroundColor Green
}

# 5. Instrucciones
Write-Host ""
Write-Host "============================================================"
Write-Host "  CODIGO SUBIDO A GITHUB"
Write-Host "============================================================"
Write-Host "AHORA VE A: https://github.com/TU_USUARIO/canal-automatizado-shorts/settings/secrets/actions"
Write-Host "Y ANADE ESTOS 4 SECRETS (New repository secret):"
Write-Host ""
Write-Host "1. YOUTUBE_CLIENT_ID      -> (tu client ID de Google Cloud)"
Write-Host "2. YOUTUBE_CLIENT_SECRET  -> (tu client secret)"
Write-Host "3. YOUTUBE_REFRESH_TOKEN  -> (ver abajo como obtenerlo)"
Write-Host "4. CONTENT_NICHE          -> curiosidades del espacio (o tu nicho)"
Write-Host ""
Write-Host "COMO OBTENER YOUTUBE_REFRESH_TOKEN (elige UNA):"
Write-Host ""
Write-Host "OPCION A - GitHub Codespaces (gratis, en navegador):"
Write-Host "  1. En tu repo: Code -> Codespaces -> Create codespace"
Write-Host "  2. En terminal del codespace:"
Write-Host "       npm install"
Write-Host "       node scripts/get-youtube-token.js"
Write-Host "  3. Copia el refresh token -> pegalo en secret YOUTUBE_REFRESH_TOKEN"
Write-Host ""
Write-Host "OPCION B - En tu PC (requiere Docker Desktop):"
Write-Host '  docker run --rm -it -v ${PWD}:/app node:22 bash -c "cd /app && npm i && node scripts/get-youtube-token.js"'
Write-Host ""
Write-Host "LUEGO: Actions -> Daily Short Generator -> Run workflow"
Write-Host "============================================================"
Read-Host "Presiona ENTER para salir"