"""Rotas e instruções de acesso: / é o painel do analista (a interface antiga foi removida); NODEWATCH_ORIGENS=null é exceção."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

pytest.importorskip("flask")

from src import sentinel_ai  # noqa: E402
from src.sentinel_ai import app, linhas_de_inicio  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
EXTERNA = "https://site-externo.example"


@pytest.fixture
def cliente():
    app.config["TESTING"] = True
    return app.test_client()


# -- o que cada rota serve ----------------------------------------------------------------
def test_raiz_serve_o_painel_do_analista(cliente):
    r = cliente.get("/")
    html = r.get_data(as_text=True)
    assert r.status_code == 200
    assert "<title>NodeWatch — Painel do analista</title>" in html and "assets/painel-app.js" in html
    # read_text converte CRLF em LF; o servidor manda os bytes do arquivo (CRLF num checkout com autocrlf no Windows)
    assert html.replace("\r\n", "\n") == (RAIZ / "interface" / "painel.html").read_text(encoding="utf-8")
    assert "Grafos (demonstração)" not in html and "babel" not in html.lower().replace("sem babel", "")


def test_so_o_painel_e_servido(cliente):
    assert "Painel do analista" in sentinel_ai.index.__doc__
    rotas = {r.rule for r in app.url_map.iter_rules()}
    assert "/legado" not in rotas and "/api/chat" not in rotas          # interface antiga e o chat dela foram removidos
    assert cliente.get("/legado").status_code == 404
    html = (RAIZ / "interface" / "painel.html").read_text(encoding="utf-8")
    assert "/legado" not in html                                         # sem redirecionamento para a interface antiga


# -- mensagens de início ------------------------------------------------------------------
def test_inicio_mostra_so_o_painel():
    linhas = linhas_de_inicio("127.0.0.1", 5000, [])
    texto = "\n".join(linhas)
    painel = next(l for l in linhas if "Painel do analista" in l)
    assert painel.strip() == ">> Painel do analista: http://127.0.0.1:5000/"
    # as mensagens de início seguem o resto do arquivo: sem acentos, para não corromper em terminais e logs cp1252
    assert all(l.isascii() for l in linhas)
    assert "legado" not in texto and "#ml" not in texto and "Interface antiga" not in texto
    assert "Origens extras" not in texto and "[AVISO]" not in texto


def test_inicio_avisa_do_risco_quando_null_esta_liberada():
    linhas = linhas_de_inicio("127.0.0.1", 5000, ["null"])
    texto = "\n".join(linhas)
    assert all(l.isascii() for l in linhas) and all(l.isascii() for l in linhas_de_inicio("0.0.0.0", 5000, []))
    assert "Origens extras liberadas (NODEWATCH_ORIGENS): null" in texto
    assert "iframes sandbox de qualquer site" in texto and "reinicie o servidor sem NODEWATCH_ORIGENS" in texto
    assert "iframes" not in "\n".join(linhas_de_inicio("127.0.0.1", 5000, ["http://a.test"]))


def test_inicio_usa_as_linhas_testadas_e_o_aviso_da_chave_cita_o_assistente():
    fonte = (RAIZ / "src" / "sentinel_ai.py").read_text(encoding="utf-8")
    principal = fonte[fonte.index('if __name__ == "__main__":'):]
    assert 'print("\\n".join(linhas_de_inicio()))' in principal
    assert "Assistente de duvidas do painel" in principal and "interface antiga" not in principal
    assert "assistente responde no modo local" in principal
    assert "Legado:" not in principal and "5000/#ml" not in fonte


@pytest.mark.parametrize("script", ["start_presentation.ps1", "start_presentation.sh"])
def test_scripts_de_apresentacao_mostram_o_endereco_certo(script):
    texto = (RAIZ / script).read_text(encoding="utf-8-sig")
    assert "Painel do analista: http://127.0.0.1:5000/" in texto
    assert "/legado" not in texto and "5000/#ml" not in texto


# -- documentação --------------------------------------------------------------------------
DOCS_ATUAIS = ("README.md", "docs/ui/PAINEL_ANALISTA.md", "docs/SENTINEL_AI.md", "docs/ml/README.md",
               "Inicializador Rápido/README.md")


def test_documentacao_indica_o_painel_em_raiz():
    painel = (RAIZ / "docs" / "ui" / "PAINEL_ANALISTA.md").read_text(encoding="utf-8")
    assert "| `http://127.0.0.1:5000/` | **Painel do analista**" in painel
    readme = (RAIZ / "README.md").read_text(encoding="utf-8")
    assert "| `http://127.0.0.1:5000/` | **Painel do analista**" in readme
    assert "Em `http://127.0.0.1:5000/#ml" not in readme


@pytest.mark.parametrize("arquivo", DOCS_ATUAIS)
def test_documentos_atuais_nao_mandam_para_a_interface_antiga(arquivo):
    texto = (RAIZ / arquivo).read_text(encoding="utf-8")
    assert "5000/#" not in texto and "5000/legado" not in texto, arquivo
    assert "/api/chat" not in texto and "/api/ml/" not in texto, arquivo
    for removido in ("EVENTOS.md", "ANALISE_DATASETS.md", "BENCHMARK_EVENTOS.md", "README-INTERFACE.md", "evidencias/"):
        assert removido not in texto, (arquivo, removido)


def test_documentos_longos_avisam_que_descrevem_codigo_removido():
    for arquivo in ("docs/COMO_FUNCIONA_O_NODEWATCH.md", "docs/APRESENTACAO_NODEWATCH.md"):
        topo = (RAIZ / arquivo).read_text(encoding="utf-8")[:2000]
        assert "parte deste documento descreve código removido" in topo, arquivo


def test_documentacao_trata_null_como_excecao_temporaria_com_o_risco():
    painel = (RAIZ / "docs" / "ui" / "PAINEL_ANALISTA.md").read_text(encoding="utf-8")
    trecho = painel[painel.index("**Exceção: liberar uma origem extra.**"):painel.index("## Fluxo de uso")]
    assert "Não é um modo normal de acesso" in trecho and "**temporariamente**" in trecho
    assert "iframe" in trecho and "sandbox" in trecho and "**Para desligar:**" in trecho and "Remove-Item Env:NODEWATCH_ORIGENS" in trecho
    assert "vem **desligada**" in painel


# -- origens: padrão e com null ligada ------------------------------------------------------
def test_padrao_sem_origens_extras_recusa_null_e_externa(cliente):
    assert sentinel_ai.ORIGENS_EXTRAS == [] or os.environ.get("NODEWATCH_ORIGENS")
    if os.environ.get("NODEWATCH_ORIGENS"):
        pytest.skip("NODEWATCH_ORIGENS definida no ambiente deste teste")
    for origem in ("null", EXTERNA):
        for metodo, rota in (("get", "/api/painel/estado"), ("get", "/api/painel/datasets"), ("post", "/api/painel/sessao")):
            r = getattr(cliente, metodo)(rota, headers={"Origin": origem}, json={} if metodo == "post" else None)
            assert r.status_code == 403 and "Access-Control-Allow-Origin" not in r.headers, (origem, rota)
    pre = cliente.options("/api/painel/analises", headers={"Origin": "null", "Access-Control-Request-Method": "POST"})
    assert pre.status_code == 403 and "Access-Control-Allow-Origin" not in pre.headers
    assert cliente.get("/api/painel/estado").status_code == 200        # a própria página (sem Origin) continua aceita


_COM_NULL = r"""
import json, sys
sys.path.insert(0, sys.argv[1])
from src import sentinel_ai
c = sentinel_ai.app.test_client()
def ver(metodo, rota, origem, **kw):
    r = getattr(c, metodo)(rota, headers={"Origin": origem, **kw.pop("headers", {})}, **kw)
    return [r.status_code, r.headers.get("Access-Control-Allow-Origin")]
print(json.dumps({
    "extras": sentinel_ai.ORIGENS_EXTRAS,
    "null_get": ver("get", "/api/painel/datasets", "null"),
    "null_pre": ver("options", "/api/painel/sessao", "null", headers={"Access-Control-Request-Method": "POST"}),
    "externa_get": ver("get", "/api/painel/datasets", "https://site-externo.example"),
    "externa_post": ver("post", "/api/painel/sessao", "https://site-externo.example", json={}),
    "externa_pre": ver("options", "/api/painel/analises", "https://site-externo.example", headers={"Access-Control-Request-Method": "POST"}),
    "sem_origem": [c.get("/api/painel/estado").status_code, None],   # a própria página / scripts locais
    "curinga": [k for k, v in c.get("/api/painel/datasets", headers={"Origin": "null"}).headers.items() if v == "*"],
    "aviso": "iframes sandbox" in "\n".join(sentinel_ai.linhas_de_inicio()),
}))
"""


def test_com_null_ligada_so_null_passa_e_externa_continua_recusada():
    """Processo separado: NODEWATCH_ORIGENS é lida na importação do servidor."""
    env = dict(os.environ, NODEWATCH_ORIGENS="null")
    saida = subprocess.run([sys.executable, "-c", _COM_NULL, str(RAIZ)], capture_output=True, text=True, env=env,
                           cwd=RAIZ, timeout=120, encoding="utf-8")
    assert saida.returncode == 0, saida.stderr[-2000:]
    r = json.loads(saida.stdout.strip().splitlines()[-1])
    assert r["extras"] == ["null"] and r["aviso"] is True
    assert r["null_get"] == [200, "null"] and r["null_pre"] == [200, "null"]
    assert r["externa_get"] == [403, None] and r["externa_post"] == [403, None] and r["externa_pre"] == [403, None]
    assert r["sem_origem"][0] == 200 and r["curinga"] == []


def test_curinga_nunca_e_aceito_na_variavel():
    env = dict(os.environ, NODEWATCH_ORIGENS="*")
    codigo = ("import sys, json; sys.path.insert(0, sys.argv[1]); from src import sentinel_ai as s; "
              "c = s.app.test_client(); r = c.get('/api/painel/datasets', headers={'Origin': 'https://site-externo.example'}); "
              "print(json.dumps([s.ORIGENS_EXTRAS, r.status_code, r.headers.get('Access-Control-Allow-Origin')]))")
    saida = subprocess.run([sys.executable, "-c", codigo, str(RAIZ)], capture_output=True, text=True, env=env, cwd=RAIZ,
                           timeout=120, encoding="utf-8")
    assert saida.returncode == 0, saida.stderr[-2000:]
    assert json.loads(saida.stdout.strip().splitlines()[-1]) == [[], 403, None]
