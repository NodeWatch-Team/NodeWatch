"""Linha de comando do módulo de ML (modelo de lavagem).

Exemplos (a partir da raiz do projeto, com o .venv ativo)::

    python -m src.ml.cli auditar
    python -m src.ml.cli treinar --tarefa lavagem
    python -m src.ml.cli avaliar --tarefa lavagem
    python -m src.ml.cli prever --tarefa lavagem --entrada trans.csv --historico HI-Small_Trans.zip --saida p.csv
    python -m src.ml.cli exemplos
    python -m src.ml.cli tarefas
    python -m src.ml.cli relatorio
    python -m src.ml.cli documentar
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List, Optional

from src.ml import auditoria, experimentos
from src.ml.config import carregar_config, pasta_artefatos
from src.ml.modelos import ModeloUnificado

# --fonte e --tarefa ficam por compatibilidade com os comandos documentados; só há a tarefa lavagem.
TAREFAS = ("lavagem",)


def _cmd_auditar(cfg, args) -> int:
    pasta = pasta_artefatos(cfg) / "auditoria"
    dados, contas, casados, pendentes = experimentos._carregar_financeiro(cfg)
    a = auditoria.auditar_financeiro(dados, cfg["financeiro"], contas, casados)
    a["arquivos_pendentes"] = pendentes
    print("auditoria financeira:", auditoria.salvar(a, pasta, "auditoria_financeiro"))
    return 0


def _cmd_treinar(cfg, args) -> int:
    experimentos.treinar_lavagem(cfg)
    return 0


def _cmd_avaliar(cfg, args) -> int:
    experimentos.avaliar_lavagem(cfg)
    return 0


def _cmd_prever(cfg, args) -> int:
    modelo = ModeloUnificado.carregar(pasta_artefatos(cfg))
    saida, rel = modelo.prever("lavagem", args.entrada, historico=args.historico)
    destino = Path(args.saida)
    destino.parent.mkdir(parents=True, exist_ok=True)
    saida.to_csv(destino, index=False)
    destino.with_suffix(".relatorio.json").write_text(
        json.dumps(rel, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"{len(saida)} previsões em {destino}")
    return 0


def _cmd_exemplos(cfg, args) -> int:
    pasta = pasta_artefatos(cfg) / "exemplos"
    modelo = ModeloUnificado.carregar(pasta_artefatos(cfg))
    entrada = experimentos.gerar_exemplo_lavagem(cfg)
    saida, rel = modelo.prever("lavagem", entrada, historico=cfg["financeiro"]["transacoes"])
    saida.to_csv(pasta / "previsoes_lavagem_exemplo.csv", index=False)
    (pasta / "previsoes_lavagem_exemplo.relatorio.json").write_text(
        json.dumps(rel, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"lavagem: {len(saida)} previsões a partir de {entrada.name}")
    return 0


def _cmd_tarefas(cfg, args) -> int:
    modelo = ModeloUnificado.carregar_ou_novo(pasta_artefatos(cfg))
    tarefas = modelo.tarefas_disponiveis()
    if not tarefas:
        print("nenhuma tarefa treinada em", pasta_artefatos(cfg))
    for nome, status in tarefas.items():
        print(f"{nome}: {status}")
    return 0


def _cmd_relatorio(cfg, args) -> int:
    from src.ml.relatorio import gerar_relatorio
    print("relatório:", gerar_relatorio(pasta_artefatos(cfg), Path(cfg["geral"]["pasta_docs"])))
    return 0


def _cmd_documentar(cfg, args) -> int:
    from src.ml.relatorio import escrever_documentacao
    for p in escrever_documentacao(Path(cfg["geral"]["pasta_docs"])):
        print(p)
    return 0


def construir_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m src.ml.cli", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--config", help="arquivo TOML (padrão: ml_config.local.toml ou ml_config.exemplo.toml)")
    sub = p.add_subparsers(dest="comando", required=True)
    a = sub.add_parser("auditar", help="audita os dados e grava JSON/MD em artefatos_ml/auditoria")
    a.add_argument("--fonte", choices=("financeiro",), default="financeiro")
    a.set_defaults(func=_cmd_auditar)
    t = sub.add_parser("treinar", help="ajusta no treino e escolhe na validação")
    t.add_argument("--tarefa", choices=TAREFAS, default="lavagem")
    t.set_defaults(func=_cmd_treinar)
    v = sub.add_parser("avaliar", help="avaliação final no teste com o artefato congelado")
    v.add_argument("--tarefa", choices=TAREFAS, default="lavagem")
    v.set_defaults(func=_cmd_avaliar)
    pr = sub.add_parser("prever", help="inferência em arquivos novos (sem reajuste)")
    pr.add_argument("--tarefa", choices=TAREFAS, default="lavagem")
    pr.add_argument("--entrada", required=True, help="CSV ou ZIP no formato do HI-Small (rótulo opcional)")
    pr.add_argument("--historico", help="transações anteriores, para o histórico das contas")
    pr.add_argument("--saida", required=True)
    pr.set_defaults(func=_cmd_prever)
    e = sub.add_parser("exemplos", help="gera uma entrada derivada sem rótulo e as previsões dela")
    e.set_defaults(func=_cmd_exemplos)
    ta = sub.add_parser("tarefas", help="lista as cabeças do modelo e seu status")
    ta.set_defaults(func=_cmd_tarefas)
    r = sub.add_parser("relatorio", help="gera docs/ml/RELATORIO_ML.md a partir dos resultados salvos")
    r.set_defaults(func=_cmd_relatorio)
    d = sub.add_parser("documentar", help="gera o dicionário de dados e os esquemas em docs/ml")
    d.set_defaults(func=_cmd_documentar)
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = construir_parser().parse_args(argv)
    cfg = carregar_config(args.config)
    try:
        return args.func(cfg, args)
    except FileNotFoundError as exc:
        # Dados de treino ausentes (máquina nova): o modelo distribuído continua instalado e intacto.
        print(f"[ERRO] {exc}", file=sys.stderr)
        if args.comando in ("auditar", "treinar", "avaliar"):
            print("       Para usar o painel não é preciso treinar: o modelo vem em modelos/ e é instalado com\n"
                  "       python -m src.ml.provisionamento.\n"
                  "       Para treinar de novo: baixe o IBM AML (HI-Small_Trans.csv, HI-Small_Patterns.txt e\n"
                  "       HI-Small_accounts.csv) em https://www.kaggle.com/datasets/ealtman2019/ibm-transactions-for-anti-money-laundering-aml\n"
                  "       (licença CDLA-Sharing-1.0), copie ml_config.exemplo.toml para ml_config.local.toml e aponte\n"
                  "       [financeiro].transacoes, contas e padroes para os arquivos baixados.", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
