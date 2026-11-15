"""Ponto único de controle do que a interface mostra (``EXIBIR`` em painel-base.js).

Itens escondidos somem só da tela; API, SQLite, manifesto e cálculos continuam iguais (os testes de backend
seguem valendo). Aqui: a constante existe, começa com os itens escondidos, cada trecho escondido passa por ela,
e os textos mudam de verdade quando ela é ligada ou desligada (executando os scripts no Node, se houver).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ASSETS = Path(__file__).resolve().parents[2] / "interface" / "assets"
BASE = (ASSETS / "painel-base.js").read_text(encoding="utf-8")
LOG = (ASSETS / "painel-log.js").read_text(encoding="utf-8")
SECOES = (ASSETS / "painel-secoes.js").read_text(encoding="utf-8")
CHAVES = ("rotulo", "coluna_rotulo", "base_treino", "fuso")


def test_ponto_unico_existe_e_comeca_escondendo_os_itens_decididos():
    bloco = BASE[BASE.index("const EXIBIR = Object.freeze({"):]
    bloco = bloco[:bloco.index("});")]
    for chave in CHAVES:
        assert re.search(rf"\b{chave}: false\b", bloco), chave
    assert "EXIBIR, exibir" in BASE and "const exibir = chave => EXIBIR[chave] === true;" in BASE


def test_cada_item_escondido_passa_pelo_ponto_unico():
    assert "const ROTULO = exibir('rotulo')" in SECOES and "const ROTULO = exibir('rotulo')" in LOG
    # rótulo: resumo, visão, coluna da tabela, detalhes, legenda geral e entrada do log
    for trecho in ("ROTULO ? ['Rótulo do dataset'", "ROTULO ? h('div', { className: 'bloco' }, h('h3', null, h(Icone, { nome: 'info' }), 'Rótulo do dataset",
                   ".filter(c => c.id !== 'rotulo' || ROTULO)", "ROTULO ? cartao('Rótulo do dataset'"):
        assert trecho in SECOES, trecho
    assert "ROTULO ? h('div', { className: 'log-rotulo' }" in LOG
    # coluna de rótulo (Is Laundering) em "Colunas reconhecidas", fuso e base do treino
    assert "exibir('coluna_rotulo') || !(v.rotulo.disponivel && c.original === v.rotulo.coluna)" in SECOES
    assert "(exibir('fuso') ? ' — ' + v.periodo.fuso : '')" in SECOES
    assert "const treino = BASE_TREINO ? h(AvisoBaseTreino" in LOG
    assert SECOES.count("exibir('base_treino') ?") == 2


def test_contador_de_colunas_usa_a_lista_filtrada():
    assert "'Detalhes técnicos: colunas reconhecidas (' + colunas.length + ')'" in SECOES
    assert "v.colunas.length" not in SECOES


def _node_ou_pula() -> str:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node não está instalado: os scripts da interface não podem ser executados aqui")
    return node


def _executar(trocar: dict) -> dict:
    """Carrega painel-base.js e painel-log.js no Node (React mínimo) e devolve o que eles exportam."""
    base = BASE
    for chave, valor in trocar.items():
        base = re.sub(rf"(\b{chave}: )(true|false)\b", rf"\g<1>{'true' if valor else 'false'}", base, count=1)
    programa = (
        "const window = globalThis; globalThis.window = window;\n"
        "globalThis.React = { createElement: () => null, memo: f => f, useState: v => [v, () => {}], useRef: v => ({ current: v }),"
        " useEffect: () => {}, useLayoutEffect: () => {}, Fragment: 'f' };\n"
        + base + "\n" + LOG + "\n"
        "const f = window.NW.f;\n"
        "console.log(JSON.stringify({ exibir: Object.fromEntries(" + json.dumps(list(CHAVES)) + ".map(k => [k, window.NW.exibir(k)])),"
        " textos: window.NW.TEXTO_METRICAS, gb: [f.gb(980e6), f.gb(1.02e9), f.gb(16e9), f.gb(null)] }));\n"
    )
    # o programa vai pela entrada padrão: na linha de comando ele passaria do limite do Windows
    r = subprocess.run([_node_ou_pula(), "-"], input=programa, capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_desligado_textos_neutros_sem_rotulo():
    d = _executar({})
    assert d["exibir"] == {k: False for k in CHAVES}
    t = d["textos"]
    assert t["conferiveis"] == "conferíveis" and t["positivos"] == "casos de referência"
    assert not any("rótulo" in (v or "").lower() or "is laundering" in (v or "").lower() for v in t.values())
    assert t["precisao"] and t["recall"]          # substituem as legendas da API, que falam em "rotulada"


def test_ligado_volta_o_texto_original():
    d = _executar({"rotulo": True, "base_treino": True})
    assert d["exibir"]["rotulo"] is True and d["exibir"]["base_treino"] is True and d["exibir"]["fuso"] is False
    t = d["textos"]
    assert t["conferiveis"] == "com rótulo" and "Is Laundering" in t["sem_referencia"]
    assert t["precisao"] is None and t["recall"] is None    # usa a legenda da API


def test_memoria_sempre_em_gb():
    assert _executar({})["gb"] == ["0,98 GB", "1,02 GB", "16,00 GB", "—"]
