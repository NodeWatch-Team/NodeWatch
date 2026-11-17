@echo off
rem Inicia o NodeWatch no Windows por duplo clique (o passo a passo esta em scripts\iniciar_nodewatch.ps1).
rem O PowerShell abre numa janela propria ("NodeWatch") e este .bat termina em seguida: assim o Ctrl+C
rem encerra o servidor sem a pergunta "Deseja finalizar o arquivo em lotes (S/N)?" do cmd.
rem -ExecutionPolicy Bypass vale so para esta execucao; a politica do sistema nao muda.
start "NodeWatch" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\iniciar_nodewatch.ps1"
