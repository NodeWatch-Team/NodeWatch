"""Ambiente de teste local do painel do analista.

Sobe o painel numa pasta isolada (``artefatos_teste/``, fora do Git), com o modelo distribuído instalado nela
e datasets sintéticos prontos na lista. Nada aqui toca em ``artefatos_ml/`` do projeto: as análises, os logs
e os datasets enviados durante os testes ficam em ``artefatos_teste/``. Apagar a pasta zera o ambiente.

Uso, na raiz do projeto (com o ``.venv``; ``scripts\\ambiente_teste.ps1`` cria o ``.venv`` se faltar):

    .venv\\Scripts\\python scripts\\ambiente_teste.py                 prepara (se preciso) e abre em http://127.0.0.1:5001/
    .venv\\Scripts\\python scripts\\ambiente_teste.py --preparar      só prepara a pasta (modelo e datasets) e sai
    .venv\\Scripts\\python scripts\\ambiente_teste.py --limpar        apaga artefatos_teste/ e prepara de novo
    .venv\\Scripts\\python scripts\\ambiente_teste.py --hismall C:\\dados\\HI-Small_Trans.zip   inclui o HI-Small na lista
    .venv\\Scripts\\python scripts\\ambiente_teste.py --porta 5002

Datasets gerados (sintéticos, determinísticos: mesma semente, mesmo arquivo):

    dados/sintetico_5k_rotulado.csv      5 mil transações com rótulo: análise em poucos segundos
    dados/sintetico_5k_sem_rotulo.csv    as mesmas, sem a coluna de rótulo (precisão e recall "não disponível")
    dados/sintetico_200k_rotulado.csv    200 mil com rótulo: o log passa de 8 M px e usa a rolagem proporcional
    para_enviar/sintetico_5k_rotulado.csv
                                         para testar o envio pela tela

O painel do analista (``/`` e ``/api/painel``) usa só a pasta isolada.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path
from typing import List, Tuple

import numpy as np
import pandas as pd

PROJETO = Path(__file__).resolve().parent.parent
if str(PROJETO) not in sys.path:
    sys.path.insert(0, str(PROJETO))

PASTA_TESTE = PROJETO / "artefatos_teste"
PORTA_PADRAO = 5001
SEMENTE = 20261115
INICIO = pd.Timestamp("2022-09-01 00:00")
DIAS = 6
CABECALHO = ("Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,Amount Paid,"
             "Payment Currency,Payment Format")
FORMATOS = ["Cheque", "Credit Card", "ACH", "Cash", "Reinvestment", "Wire", "Bitcoin"]
PESO_FORMATOS = [0.36, 0.26, 0.12, 0.10, 0.09, 0.04, 0.03]
# moeda → (peso, unidades da moeda por dólar, aproximado: só para os valores terem ordem de grandeza plausível)
MOEDAS = {"US Dollar": (0.55, 1.0), "Euro": (0.15, 0.92), "Swiss Franc": (0.04, 0.9), "Yuan": (0.04, 7.2),
          "Shekel": (0.03, 3.7), "Rupee": (0.04, 83.0), "Yen": (0.03, 150.0), "UK Pound": (0.03, 0.79),
          "Ruble": (0.03, 90.0), "Canadian Dollar": (0.02, 1.36), "Australian Dollar": (0.02, 1.5),
          "Brazil Real": (0.01, 5.0), "Mexican Peso": (0.01, 17.0)}


# ---------------------------------------------------------------------------------------------------------------
# Datasets sintéticos
# ---------------------------------------------------------------------------------------------------------------
def _contas(rng: np.random.Generator, n: int) -> Tuple[np.ndarray, np.ndarray]:
    bancos = rng.integers(1, 3000, size=n)
    numeros = np.array([f"{x:09X}" for x in rng.integers(0x100000000, 0xFFFFFFFFF, size=n)], dtype=object)
    return bancos, numeros


def _comuns(rng: np.random.Generator, n: int, n_contas: int) -> pd.DataFrame:
    """Transações comuns (rótulo 0): contas com atividade desigual, valores log-normais, uma semana de dados."""
    peso = 1.0 / np.arange(1, n_contas + 1) ** 0.8
    peso /= peso.sum()
    o = rng.choice(n_contas, size=n, p=peso)
    d = rng.choice(n_contas, size=n, p=peso)
    nomes = list(MOEDAS)
    moeda = rng.choice(nomes, size=n, p=np.array([MOEDAS[m][0] for m in nomes]) / sum(v[0] for v in MOEDAS.values()))
    usd = np.round(rng.lognormal(7.0, 1.8, size=n), 2) + 0.01
    fmt = rng.choice(FORMATOS, size=n, p=PESO_FORMATOS)
    moeda = np.where(fmt == "Bitcoin", "Bitcoin", moeda)
    return pd.DataFrame({"minuto": rng.integers(0, DIAS * 1440, size=n), "o": o, "d": d, "moeda": moeda,
                         "usd": usd, "formato": fmt, "rotulo": 0, "tentativa": 0, "tipologia": ""})


def _padroes(rng: np.random.Generator, n_tentativas: int, n_contas: int) -> pd.DataFrame:
    """Tentativas de lavagem (rótulo 1), registradas também no arquivo de padrões: leque de saída, leque de
    entrada e ciclo, com horários em sequência."""
    linhas: List[dict] = []
    for t in range(1, n_tentativas + 1):
        tipo = ("FAN-OUT", "FAN-IN", "CYCLE")[t % 3]
        inicio = int(rng.integers(72 * 60, DIAS * 1440 - 600))   # depois das 72 h de histórico
        centro = int(rng.integers(0, n_contas))
        k = int(rng.integers(3, 9))
        outras = rng.choice(n_contas, size=k, replace=False)
        valor = float(np.round(rng.lognormal(9.5, 0.6), 2))
        if tipo == "CYCLE":
            caminho = [centro] + [int(x) for x in outras[:3]] + [centro]
            pares = list(zip(caminho[:-1], caminho[1:]))
        elif tipo == "FAN-OUT":
            pares = [(centro, int(x)) for x in outras]
        else:
            pares = [(int(x), centro) for x in outras]
        for i, (o, d) in enumerate(pares):
            linhas.append({"minuto": inicio + 7 * i + int(rng.integers(0, 5)), "o": o, "d": d, "moeda": "US Dollar",
                           "usd": round(valor * float(rng.uniform(0.85, 1.0)), 2),
                           "formato": "ACH" if tipo == "CYCLE" else "Wire", "rotulo": 1, "tentativa": t,
                           "tipologia": tipo})
    return pd.DataFrame(linhas)


def gerar(n: int, semente: int) -> pd.DataFrame:
    rng = np.random.default_rng(semente)
    n_contas = max(200, n // 10)
    n_tent = max(5, n // 400)
    pad = _padroes(rng, n_tent, n_contas)
    df = pd.concat([_comuns(rng, n - len(pad), n_contas), pad], ignore_index=True)
    bancos, numeros = _contas(rng, n_contas)
    df["banco_o"], df["conta_o"] = bancos[df["o"]], numeros[df["o"]]
    df["banco_d"], df["conta_d"] = bancos[df["d"]], numeros[df["d"]]
    df["valor"] = np.round(df["usd"] * df["moeda"].map(lambda m: MOEDAS.get(m, (0, 1 / 30_000))[1]), 2).clip(lower=0.01)
    df["ts"] = (INICIO + pd.to_timedelta(df["minuto"], unit="m")).dt.strftime("%Y/%m/%d %H:%M")
    # quase em ordem cronológica, como o IBM AML (que também não é estritamente ordenado)
    return df.sort_values(["minuto"], kind="stable").reset_index(drop=True)


def escrever_csv(df: pd.DataFrame, caminho: Path, com_rotulo: bool) -> None:
    colunas = ["ts", "banco_o", "conta_o", "banco_d", "conta_d", "valor", "moeda", "valor", "moeda", "formato"]
    saida = df[colunas + (["rotulo"] if com_rotulo else [])]
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with open(caminho, "w", encoding="utf-8", newline="") as fh:
        fh.write(CABECALHO + (",Is Laundering" if com_rotulo else "") + "\n")
        saida.to_csv(fh, header=False, index=False, float_format="%.2f", lineterminator="\n")


# ---------------------------------------------------------------------------------------------------------------
# Pasta isolada
# ---------------------------------------------------------------------------------------------------------------
def preparar(pasta: Path, hismall: Path | None = None, linhas_grande: int = 200_000) -> None:
    from src.ml import provisionamento

    pasta.mkdir(parents=True, exist_ok=True)
    # modelo distribuído e avaliação histórica copiados para a pasta: o painel de teste lê só dela
    for origem in ("modelos", "docs/ml/resultados"):
        destino = pasta / origem
        if not destino.exists():
            shutil.copytree(PROJETO / origem, destino)
    print("\n".join(provisionamento._linhas(provisionamento.garantir_modelo(pasta))))

    dados, envio = pasta / "dados", pasta / "para_enviar"
    pequeno = gerar(5_000, SEMENTE)
    for caminho, df, rot in ((dados / "sintetico_5k_rotulado.csv", pequeno, True),
                             (dados / "sintetico_5k_sem_rotulo.csv", pequeno, False),
                             (envio / "sintetico_5k_rotulado.csv", pequeno, True)):
        if not caminho.exists():
            escrever_csv(df, caminho, rot)
    grande = dados / f"sintetico_{linhas_grande // 1000}k_rotulado.csv"
    if not grande.exists():
        escrever_csv(gerar(linhas_grande, SEMENTE + 1), grande, True)
    if hismall is not None:
        hismall = Path(hismall)
        if not hismall.is_file():
            raise SystemExit(f"[ERRO] HI-Small não encontrado: {hismall}")
        destino = dados / hismall.name
        if not destino.exists() or destino.stat().st_size != hismall.stat().st_size:
            print(f"Copiando {hismall.name} ({hismall.stat().st_size / 1e6:.0f} MB) para {destino.parent} ...")
            shutil.copy2(hismall, destino)
    print(f"Pasta de teste pronta: {pasta}")
    for arq in sorted(p for p in (dados.glob("*") if dados.exists() else []) if p.is_file()):
        print(f"  na lista do painel: {arq.name} ({arq.stat().st_size / 1e6:.1f} MB)")
    print(f"  para enviar pela tela: {envio}")


def servir(pasta: Path, porta: int) -> None:
    from src import api_painel
    from src.sentinel_ai import app, encerrar_eventos

    api_painel.configurar(pasta)  # dados, análises, logs e modelo do painel: só desta pasta
    print(f"\n  Ambiente de teste do NodeWatch: http://127.0.0.1:{porta}/")
    print(f"  Pasta isolada: {pasta}  (apague-a para zerar)\n  Para parar: Ctrl+C\n")
    try:
        app.run(host="127.0.0.1", port=porta, debug=False, threaded=True)
    finally:
        encerrar_eventos()


def main(argv: List[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Ambiente de teste local do painel do analista (pasta isolada).")
    p.add_argument("--porta", type=int, default=PORTA_PADRAO, help=f"porta do servidor (padrão {PORTA_PADRAO})")
    p.add_argument("--pasta", type=Path, default=PASTA_TESTE, help="pasta isolada (padrão artefatos_teste/)")
    p.add_argument("--preparar", action="store_true", help="só prepara a pasta (modelo e datasets) e sai")
    p.add_argument("--limpar", action="store_true", help="apaga a pasta isolada antes de preparar")
    p.add_argument("--hismall", type=Path, help="HI-Small_Trans.csv ou .zip para incluir na lista do painel")
    p.add_argument("--linhas", type=int, default=200_000, help="tamanho do dataset sintético grande (padrão 200000)")
    a = p.parse_args(argv)
    pasta = a.pasta.resolve()
    if pasta == PROJETO or pasta == PROJETO / "artefatos_ml":
        raise SystemExit("[ERRO] A pasta de teste não pode ser a do projeto nem artefatos_ml/.")
    if a.limpar and pasta.exists():
        shutil.rmtree(pasta)
        print(f"Pasta de teste apagada: {pasta}")
    preparar(pasta, a.hismall, a.linhas)
    if not a.preparar:
        servir(pasta, a.porta)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
