"""Regressões da revisão de aceitação (interface): telas estreitas, carregamento inicial e página aberta como arquivo.

Os três defeitos foram reproduzidos no Chrome; aqui fica a garantia de que as regras que os corrigem continuam no lugar.
A verificação visual em si (320, 390, 768, 1280 e 1440 px) é feita no navegador e está em docs/ui/PAINEL_ANALISTA.md.
"""

from __future__ import annotations

import re
from pathlib import Path

INTERFACE = Path(__file__).resolve().parents[2] / "interface"
CSS = (INTERFACE / "assets" / "painel.css").read_text(encoding="utf-8")


def _regras(seletor_contem: str) -> list:
    return [corpo for sel, corpo in re.findall(r"([^{}]+)\{([^{}]*)\}", CSS) if seletor_contem in sel]


def test_grades_de_varias_colunas_nunca_exigem_mais_que_a_largura_disponivel():
    # em 320 px, "minmax(320px, 1fr)" mais o recuo alargava a página inteira
    fixos = re.findall(r"repeat\(auto-fit, minmax\((\d+px), 1fr\)\)", CSS)
    assert fixos == [], f"colunas com mínimo fixo: {fixos}"
    assert len(re.findall(r"repeat\(auto-fit, minmax\(min\(\d+px, 100%\), 1fr\)\)", CSS)) >= 5


def test_grades_de_uma_coluna_usam_a_largura_disponivel_e_nao_a_do_conteudo():
    # o seletor de dataset com opções longas (72 caracteres) alargava main e as seções até 634 px numa tela de 320 px
    corpos = _regras("main, .secao .corpo")
    assert corpos and "grid-template-columns: minmax(0, 1fr)" in corpos[0]
    seletores = next(sel for sel, _ in re.findall(r"([^{}]+)\{([^{}]*)\}", CSS) if "main, .secao .corpo" in sel)
    for item in ("main", ".secao .corpo", ".grade", ".contas", ".escala", "dialog .corpo"):
        assert item in seletores, item
    assert any("min-width: 0" in c for c in _regras(".grade > *"))
    controles = _regras('input[type="text"]')
    assert any("max-width: 100%" in c and "min-width: 0" in c for c in controles)


def test_rotulos_da_escala_do_score_quebram_linha_em_tela_estreita():
    estreita = CSS[CSS.index("@media (max-width: 720px)"):]
    assert ".escala .faixas > div {" in estreita and "white-space: normal" in estreita.split(".escala .faixas > div {")[1].split("}")[0]


def test_assistente_fica_fixo_no_canto_inferior_direito():
    # o botão é fixo no canto inferior direito (pedido do usuário): um único componente, fora do topo e do <main>
    app = (INTERFACE / "assets" / "painel-app.js").read_text(encoding="utf-8")
    assert app.count("h(Assistente,") == 1
    topo = app[app.index("h('header', { className: 'topo' }"):app.index("h(PainelLateral")]
    principal = app[app.rindex("h('main', { id: 'conteudo' },"):app.index("h(Assistente,")]
    assert "h(Assistente," not in topo and "h(Assistente," not in principal
    regra = " ".join(_regras(".assistente"))
    assert "position: fixed" in regra and "right: 16px" in regra and "bottom: 16px" in regra
    assert "padding-bottom" in " ".join(_regras("main"))  # o botão não cobre o fim do conteúdo
    estreita = CSS[CSS.index("@media (max-width: 720px)"):]
    assert ".assistente .abrir .rotulo-curto { display: inline; }" in estreita
    secoes = (INTERFACE / "assets" / "painel-secoes.js").read_text(encoding="utf-8")
    assert "'rotulo-longo' }, 'Assistente de dúvidas'" in secoes and "'rotulo-curto' }, 'Dúvidas'" in secoes


def test_pagina_mostra_carregamento_antes_de_montar():
    html = (INTERFACE / "painel.html").read_text(encoding="utf-8")
    raiz = html[html.index('<div id="raiz">'):html.index("</div>", html.index('<div id="raiz">'))]
    assert 'role="status"' in raiz and "Abrindo o painel" in raiz


def test_painel_aberto_como_arquivo_explica_como_abrir_em_vez_de_acusar_o_servidor():
    app = (INTERFACE / "assets" / "painel-app.js").read_text(encoding="utf-8")
    assert "location.protocol === 'file:'" in app and "não abre como arquivo" in app and "http://127.0.0.1:5000/" in app
    assert app.index("location.protocol === 'file:'") < app.index("sessao.iniciar().then")  # nem tenta abrir sessão


def test_formulario_de_envio_tem_so_o_arquivo_de_transacoes_e_nao_limita_o_tamanho():
    # sem campo de padrões (tipologias) e sem conferência de tamanho na tela: o envio não tem limite
    secoes = (INTERFACE / "assets" / "painel-secoes.js").read_text(encoding="utf-8")
    envio = secoes[secoes.index("const enviar = async ev"):secoes.index("const validar = async")]
    assert "fd.append('arquivo', arq)" in envio and "padroes" not in envio and ".size" not in envio
    form = secoes[secoes.index("'Enviar arquivo'"):secoes.index("'Escolher dataset'")]
    assert "type: 'file'" in form and form.count("type: 'file'") == 1
    for proibido in ("Padrões", "padroes", "tipologia", "HI-Small_Patterns", "envio_bytes", "padroes_bytes", "até ' + f.bytes"):
        assert proibido not in form and proibido not in envio, proibido


def test_envio_de_dataset_ignora_o_limite_global_do_app(tmp_path):
    # o MAX_CONTENT_LENGTH do app vale para as rotas da interface antiga; o envio de datasets do painel não tem limite
    import io
    import time

    from src.sentinel_ai import app
    from testes.painel.conftest import CENARIO, abrir_cliente, escrever

    (tmp_path / "artefatos_ml").mkdir()
    cli = abrir_cliente(tmp_path, None)
    conteudo = escrever(tmp_path / "c.csv", CENARIO, com_rotulo=True).read_bytes()
    original = app.config["MAX_CONTENT_LENGTH"]
    app.config["MAX_CONTENT_LENGTH"] = 1000
    try:
        assert len(conteudo) > 1000
        r = cli.post("/api/painel/datasets", data={"arquivo": (io.BytesIO(conteudo), "grande.csv")},
                     content_type="multipart/form-data")
        legado = cli.post("/api/ml/importar", data={"arquivo": (io.BytesIO(conteudo), "grande.csv")},
                          content_type="multipart/form-data")
    finally:
        app.config["MAX_CONTENT_LENGTH"] = original
    assert r.status_code == 201, r.get_json()
    did = r.get_json()["id"]
    for _ in range(200):
        reg = cli.get(f"/api/painel/datasets/{did}").get_json()
        if reg["status"] != "validando":
            break
        time.sleep(0.02)
    assert reg["status"] == "valido" and reg["bytes"] == len(conteudo)
    assert legado.status_code == 413  # a interface antiga, que lê o corpo na memória, mantém o seu limite
