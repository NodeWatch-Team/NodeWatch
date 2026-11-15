# ambiente_teste.ps1 - ambiente de teste local do painel do analista (Windows PowerShell).
#
# Cria o .venv do projeto se faltar, instala as dependencias fixadas se faltarem e abre o painel numa pasta
# isolada (artefatos_teste/), na porta 5001, com datasets sinteticos prontos. Ver scripts/ambiente_teste.py.
#
# Uso, na raiz do projeto:
#   powershell -ExecutionPolicy Bypass -File scripts\ambiente_teste.ps1                abre http://127.0.0.1:5001/
#   powershell -ExecutionPolicy Bypass -File scripts\ambiente_teste.ps1 -Testes        roda a suite de testes e sai
#   powershell -ExecutionPolicy Bypass -File scripts\ambiente_teste.ps1 --limpar       zera a pasta de teste
#   (os demais argumentos vao direto para ambiente_teste.py: --porta, --hismall, --preparar, --linhas)
#
# Arquivo ASCII puro: o Windows PowerShell 5.1 le .ps1 sem BOM como ANSI.

param([switch]$Testes, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Resto)

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
$py = Join-Path $raiz ".venv\Scripts\python.exe"

if (-not (Test-Path $py)) {
    Write-Host "[1/3] Criando o .venv (Python 3.14)..." -ForegroundColor Yellow
    $lancador = Get-Command py -ErrorAction SilentlyContinue
    if ($lancador) { & py -3.14 -m venv .venv } else { & python -m venv .venv }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $py)) { Write-Host "[ERRO] Nao foi possivel criar o .venv." -ForegroundColor Red; exit 1 }
} else {
    Write-Host "[1/3] .venv encontrado." -ForegroundColor Green
}

& $py -c "import flask, sklearn, pandas, pytest" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[2/3] Instalando as dependencias fixadas (requirements.txt e requirements-ml.txt)..." -ForegroundColor Yellow
    & $py -m pip install --disable-pip-version-check -r requirements.txt -r requirements-ml.txt
    if ($LASTEXITCODE -ne 0) { Write-Host "[ERRO] Falha ao instalar as dependencias." -ForegroundColor Red; exit 1 }
} else {
    Write-Host "[2/3] Dependencias instaladas." -ForegroundColor Green
}

if ($Testes) {
    Write-Host "[3/3] Rodando os testes..." -ForegroundColor Yellow
    & $py -m pytest testes -q
    exit $LASTEXITCODE
}

Write-Host "[3/3] Abrindo o ambiente de teste..." -ForegroundColor Yellow
& $py scripts\ambiente_teste.py @Resto
exit $LASTEXITCODE
