@echo off
REM ============================================================
REM deploy-github.bat - Despliegue automático a GitHub Actions
REM Hace: git init -> gh auth -> gh repo create -> push
REM ============================================================
chcp 65001 >nul
echo ╔═══════════════════════════════════════════════════════════╗
echo ║  🚀 DESPLIEGUE A GITHUB ACTIONS (gratis, 2000 min/mes)   ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.

REM 1. Verificar/instalar GitHub CLI
where gh >nul 2>&1
if %errorlevel% neq 0 (
    echo 📥 Instalando GitHub CLI (gh)...
    winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements 2>nul || (
        echo ❌ winget falló. Instala manualmente: https://cli.github.com/
        echo Presiona ENTER para salir...
        pause >nul
        exit /b 1
    )
    echo ✅ gh instalado. Reinicia esta terminal y vuelve a ejecutar.
    pause >nul
    exit /b 0
)
echo ✅ GitHub CLI disponible

REM 2. Autenticar si no hay token
gh auth status >nul 2>&1
if %errorlevel% neq 0 (
    echo 🔐 Autenticando con GitHub (se abre navegador)...
    gh auth login --web --git-protocol https
    if %errorlevel% neq 0 (
        echo ❌ Error en autenticación
        pause >nul
        exit /b 1
    )
    echo ✅ Autenticado
)

REM 3. Inicializar git si no existe
if not exist .git (
    echo 📁 Inicializando repositorio git...
    git init
    git add .
    git commit -m "Initial commit: Canal Automatizado Shorts"
    echo ✅ Git init + commit
)

REM 4. Crear repo en GitHub y push
echo 🌐 Creando repositorio en GitHub...
gh repo create canal-automatizado-shorts --public --source=. --push --remote=origin 2>nul || (
    echo ℹ️  Repo ya existe o error, intentando push directo...
    git push -u origin main 2>nul || git push -u origin master
)
if %errorlevel% equ 0 (
    echo ✅ Repo creado y código subido
) else (
    echo ⚠️  Error en push. Intenta manual:
    echo    git remote add origin https://github.com/TU_USUARIO/canal-automatizado-shorts.git
    echo    git push -u origin main
)

REM 5. Instrucciones secrets
echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║  🎉 CÓDIGO SUBIDO A GITHUB                                 ║
echo ╠═══════════════════════════════════════════════════════════╣
echo ║  AHORA VE A: https://github.com/TU_USUARIO/canal-automatizado-shorts/settings/secrets/actions
echo ║  Y AÑADE ESTOS 4 SECRETS (New repository secret):
echo ║
echo ║  1. YOUTUBE_CLIENT_ID      -> (tu client ID de Google Cloud)
echo ║  2. YOUTUBE_CLIENT_SECRET  -> (tu client secret)
echo ║  3. YOUTUBE_REFRESH_TOKEN  -> (ejecuta: gh secret set YOUTUBE_REFRESH_TOKEN -b "TU_TOKEN")
echo ║  4. CONTENT_NICHE          -> curiosidades del espacio (o tu nicho)
echo ║
echo ║  Para el refresh token, ejecuta LOCALMENTE una vez:
echo ║    docker run --rm -it -v %CD%:/app node:22 bash -c "cd /app && npm i && node scripts/get-youtube-token.js"
echo ║  O usa GitHub Codespaces (gratis) para generarlo.
echo ║
echo ║  Luego: Actions -> Daily Short Generator -> Run workflow
echo ╚═══════════════════════════════════════════════════════════╝
pause