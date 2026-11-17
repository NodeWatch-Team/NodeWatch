"""Log da execução na tela de análise: fluxo de transações gravadas, latência do último bloco, precisão e recall
parciais (acumulados no pipeline) e a marcação "base usada no treino do modelo".

Também confere, sem navegador, as regras estáticas da interface (ordem dos scripts, layout em duas colunas que
empilha em telas estreitas e textos obrigatórios do log). A verificação visual fica em docs/ui/PAINEL_ANALISTA.md.
"""

from __future__ import annotations

import hashlib
import io
import re
import threading
import time
from pathlib import Path

import pytest

pytest.importorskip("flask")

from src.painel import api as api_painel  # noqa: E402
from src.painel import armazenamento as arm  # noqa: E402
from src.painel import pipeline as pl  # noqa: E402
from testes.painel.conftest import CENARIO, D, Ambiente, Portao, abrir_cliente, escrever, linha  # noqa: E402

INTERFACE = Path(__file__).resolve().parents[2] / "interface"
ASSETS = INTERFACE / "assets"


def _rotuladas(n: int = 30):
    """n transações em minutos distintos (blocos de 5 exatos), com rótulo; algumas com alerta."""
    saida = []
    for i in range(n):
        valor = 80_000 + i if i % 3 == 0 else 1_000 + i          # i % 3 == 0 → alerta (regra do modelo de teste)
        saida.append(linha(f"{D} {10 + i // 60:02d}:{i % 60:02d}", 1, f"C{i % 7}", 2, f"K{i % 5}", valor,
                           rotulo=1 if i % 4 == 0 else 0))
    return saida


def _enviar(c, conteudo: bytes, nome: str = "d.csv"):
    r = c.post("/api/painel/datasets", data={"arquivo": (io.BytesIO(conteudo), nome)}, content_type="multipart/form-data")
    assert r.status_code == 201, r.get_json()
    for _ in range(300):
        reg = c.get(f"/api/painel/datasets/{r.get_json()['id']}").get_json()
        if reg["status"] != "validando":
            assert reg["status"] in ("valido", "valido_com_recusas"), reg
            return reg
        time.sleep(0.02)
    raise AssertionError("validação não terminou")


def _esperar_fim(c, aid: str, durante=None) -> dict:
    for _ in range(1000):
        if durante:
            durante()
        m = c.get(f"/api/painel/analises/{aid}").get_json()
        if m["status"] != "em_andamento":
            return m
        time.sleep(0.01)
    raise AssertionError("análise não terminou")


def _analisar(c, did: str) -> dict:
    r = c.post("/api/painel/analises", json={"dataset_id": did})
    assert r.status_code == 201, r.get_json()
    return _esperar_fim(c, r.get_json()["id"])


def _pontuacao(m: dict) -> dict:
    return next(e for e in m["etapas"] if e["id"] == "pontuacao")


def _recontar(linhas):
    com = [x for x in linhas if x["rotulo"] is not None]
    return {"com_rotulo": len(com), "vp": sum(1 for x in com if x["rotulo"] == 1 and x["alerta"]),
            "fp": sum(1 for x in com if x["rotulo"] == 0 and x["alerta"]),
            "fn": sum(1 for x in com if x["rotulo"] == 1 and not x["alerta"])}


def _modo_journal(c, aid: str) -> str:
    con = arm.conectar(api_painel._c()["analises"].caminho_db(aid))
    try:
        return con.execute("PRAGMA journal_mode").fetchone()[0].lower()
    finally:
        con.close()


@pytest.fixture
def cliente(tmp_path, fabrica_modelo):
    yield abrir_cliente(tmp_path, fabrica_modelo())
    api_painel._ctx.clear()


@pytest.fixture
def em_curso(tmp_path, fabrica_modelo):
    """Análise de 30 transações rotuladas parada dentro do 3º bloco (10 já gravadas): ``(cliente, id, portão)``."""
    portao = Portao()
    c = abrir_cliente(tmp_path, fabrica_modelo(portao.em(3)), bloco=5)
    reg = _enviar(c, escrever(tmp_path / "rot.csv", _rotuladas(30), com_rotulo=True).read_bytes())
    aid = c.post("/api/painel/analises", json={"dataset_id": reg["id"]}).get_json()["id"]
    assert portao.chegou.wait(30)
    yield c, aid, portao
    portao.liberar.set()
    _esperar_fim(c, aid)
    api_painel._ctx.clear()


# -- durante a análise -------------------------------------------------------------------------------------
def test_fluxo_responde_durante_a_analise_com_o_prefixo_gravado(em_curso):
    c, aid, _ = em_curso
    m = c.get(f"/api/painel/analises/{aid}").get_json()
    assert m["status"] == "em_andamento" and m["contagens"]["pontuadas"] == 10
    r = c.get(f"/api/painel/analises/{aid}/fluxo?de=1&ate=200")
    assert r.status_code == 200
    d = r.get_json()
    assert d["gravadas"] == 10 and d["validas"] == 30 and d["analise"] == {"id": aid, "status": "em_andamento"}
    assert [x["id_exibicao"] for x in d["linhas"]] == list(range(1, 11))
    assert d["rotulo_disponivel"] is True and d["tipologias_disponiveis"] is False and "motivo_sem_tipologias" not in d
    primeira = d["linhas"][0]
    for campo in ("data_hora", "banco_origem", "conta_origem", "banco_destino", "conta_destino", "valor_pago",
                  "moeda_pagamento", "formato", "score", "faixa", "alerta", "rotulo", "tipologias"):
        assert campo in primeira, campo
    # um intervalo dentro do gravado e outro além dele
    assert [x["id_exibicao"] for x in c.get(f"/api/painel/analises/{aid}/fluxo?de=4&ate=6").get_json()["linhas"]] == [4, 5, 6]
    assert c.get(f"/api/painel/analises/{aid}/fluxo?de=11&ate=20").get_json()["linhas"] == []
    # as rotas de consulta dos resultados continuam fechadas durante a análise
    assert c.get(f"/api/painel/analises/{aid}/visao").status_code == 409
    assert c.get(f"/api/painel/analises/{aid}/transacoes").status_code == 409
    assert c.get(f"/api/painel/analises/{aid}/grafo").status_code == 409


def test_manifesto_traz_ultimo_bloco_e_metricas_parciais_coerentes(em_curso):
    c, aid, _ = em_curso
    m = c.get(f"/api/painel/analises/{aid}").get_json()
    ub = _pontuacao(m)["progresso"]["ultimo_bloco"]
    assert ub["transacoes"] == 5 and ub["total_ms"] >= 0 and ub["medido_em"].endswith("Z")
    assert ub["total_ms"] == pytest.approx(ub["atributos_ms"] + ub["inferencia_ms"] + ub["gravacao_ms"], abs=0.2)
    linhas = c.get(f"/api/painel/analises/{aid}/fluxo?de=1&ate=200").get_json()["linhas"]
    mp = m["metricas_parciais"]
    assert mp["pontuadas"] == 10 and {k: mp[k] for k in ("com_rotulo", "vp", "fp", "fn")} == _recontar(linhas)
    assert "sha256_treino" not in m["modelo"] and "limites_treino" not in m["modelo"]  # modelo de teste sem esses dados
    # RAM e CPU nunca vão para o manifesto
    texto = str(m)
    assert "cpu" not in texto.lower() and "memoria_maquina" not in texto and "processo_pct" not in texto


# -- depois de concluir --------------------------------------------------------------------------------------
def test_apos_concluir_fluxo_completo_banco_finalizado_e_parciais_iguais_as_oficiais(em_curso):
    c, aid, portao = em_curso
    portao.liberar.set()
    vistos = []
    fim = _esperar_fim(c, aid, durante=lambda: vistos.append(
        c.get(f"/api/painel/analises/{aid}/fluxo?de=1&ate=200").status_code))  # log aberto até o fim
    assert fim["status"] == "concluida" and set(vistos) <= {200}
    d = c.get(f"/api/painel/analises/{aid}/fluxo?de=1&ate=200").get_json()
    assert d["gravadas"] == 30 and [x["id_exibicao"] for x in d["linhas"]] == list(range(1, 31))
    assert _pontuacao(fim)["progresso"]["ultimo_bloco"]["transacoes"] == 5  # persiste depois de fechar a etapa
    assert _modo_journal(c, aid) == "delete"
    dd = c.get(f"/api/painel/operacao/metricas?analise={aid}").get_json()["do_dataset"]
    mp = fim["metricas_parciais"]
    assert (mp["vp"], mp["fp"], mp["fn"]) == (dd["verdadeiros_positivos"], dd["falsos_positivos"], dd["falsos_negativos"])
    assert mp["com_rotulo"] == dd["transacoes_com_rotulo"] == 30 and mp["pontuadas"] == dd["pontuadas"] == 30
    assert {k: mp[k] for k in ("com_rotulo", "vp", "fp", "fn")} == _recontar(d["linhas"])
    assert dd["periodo"] == {"inicio": "2024-01-05T10:00", "fim": "2024-01-05T10:29"}


def test_cenario_do_conftest_parciais_batem_com_as_metricas_do_dataset(cliente, tmp_path):
    reg = _enviar(cliente, escrever(tmp_path / "c.csv", CENARIO, com_rotulo=True).read_bytes())
    fim = _analisar(cliente, reg["id"])
    mp = fim["metricas_parciais"]
    assert (mp["vp"], mp["fp"], mp["fn"], mp["com_rotulo"], mp["pontuadas"]) == (4, 1, 0, 13, 13)
    dd = cliente.get(f"/api/painel/operacao/metricas?analise={fim['id']}").get_json()["do_dataset"]
    assert (dd["verdadeiros_positivos"], dd["falsos_positivos"], dd["falsos_negativos"]) == (4, 1, 0)
    assert dd["precisao"] == pytest.approx(0.8) and dd["recall"] == 1.0
    assert dd["pontuadas"] == 13 and dd["periodo"]["inicio"] == "2024-01-05T09:00"
    assert dd["base_no_treino"] == "nao_confirmado"


def test_leituras_concorrentes_nao_impedem_finalizar_o_banco(tmp_path, fabrica_modelo):
    # o log consulta o SQLite durante a pontuação; sair do WAL no fim exige trava exclusiva
    amb = Ambiente(tmp_path, fabrica_modelo(), bloco=5)
    reg = amb.enviar(escrever(tmp_path / "rot.csv", _rotuladas(240), com_rotulo=True))
    m = amb.analises.iniciar(reg["id"])
    db, parar, leituras, falhas = amb.analises.caminho_db(m["id"]), threading.Event(), [0], []

    def ler():  # como a rota /fluxo: só abre o banco depois que o manifesto conta transações gravadas
        while not parar.is_set():
            if not amb.analises.obter(m["id"])["contagens"]["pontuadas"]:
                continue
            try:
                con = arm.conectar(db)
            except FileNotFoundError:
                continue
            try:
                arm.intervalo(con, 1, 200)
                leituras[0] += 1
            except Exception as exc:  # noqa: BLE001
                falhas.append(repr(exc))
            finally:
                con.close()

    leitor = threading.Thread(target=ler, daemon=True)
    leitor.start()
    try:
        fim = amb.analises.esperar(m["id"], 120)
    finally:
        parar.set()
        leitor.join(10)
    assert fim["status"] == "concluida", fim.get("erros")
    assert leituras[0] > 0 and not falhas, falhas[:3]
    con = arm.conectar(db)
    try:
        assert con.execute("PRAGMA journal_mode").fetchone()[0].lower() == "delete"
        assert len(arm.intervalo(con, 1, 200)) == 200
    finally:
        con.close()


# -- sem banco, validações e análise inexistente ----------------------------------------------------------------
def test_cancelada_antes_de_pontuar_fluxo_vazio_sem_503(cliente, tmp_path, monkeypatch):
    reg = _enviar(cliente, escrever(tmp_path / "rot.csv", _rotuladas(10), com_rotulo=True).read_bytes())
    original = pl.GerenciadorAnalises._abrir_etapa

    def cancelar_na_ordenacao(self, m, eid):
        if eid == "ordenacao":
            self._cancelar[m["id"]].set()
        return original(self, m, eid)

    monkeypatch.setattr(pl.GerenciadorAnalises, "_abrir_etapa", cancelar_na_ordenacao)
    fim = _analisar(cliente, reg["id"])
    assert fim["status"] == "cancelada" and "metricas_parciais" not in fim
    r = cliente.get(f"/api/painel/analises/{fim['id']}/fluxo?de=1&ate=200")
    assert r.status_code == 200 and r.get_json()["gravadas"] == 0 and r.get_json()["linhas"] == []


def test_banco_ausente_responde_lista_vazia(cliente, tmp_path):
    reg = _enviar(cliente, escrever(tmp_path / "rot.csv", _rotuladas(10), com_rotulo=True).read_bytes())
    fim = _analisar(cliente, reg["id"])
    api_painel._c()["analises"].caminho_db(fim["id"]).unlink()
    r = cliente.get(f"/api/painel/analises/{fim['id']}/fluxo?de=1&ate=10")
    assert r.status_code == 200 and r.get_json()["gravadas"] == 0 and r.get_json()["linhas"] == []


@pytest.mark.parametrize("consulta", ["de=0&ate=10", "de=5&ate=4", "de=1&ate=201", "de=x&ate=10", "de=-3&ate=1"])
def test_validacao_dos_parametros(cliente, tmp_path, consulta):
    reg = _enviar(cliente, escrever(tmp_path / "rot.csv", _rotuladas(5), com_rotulo=True).read_bytes())
    fim = _analisar(cliente, reg["id"])
    r = cliente.get(f"/api/painel/analises/{fim['id']}/fluxo?{consulta}")
    assert r.status_code == 400 and r.get_json()["campo"] == "fluxo" and r.get_json()["mensagem"]


def test_analise_inexistente_404(cliente):
    assert cliente.get("/api/painel/analises/an-inexistente/fluxo?de=1&ate=10").status_code == 404


def test_latencia_da_consulta_do_log_aparece_no_desempenho(cliente, tmp_path):
    reg = _enviar(cliente, escrever(tmp_path / "rot.csv", _rotuladas(5), com_rotulo=True).read_bytes())
    fim = _analisar(cliente, reg["id"])
    cliente.get(f"/api/painel/analises/{fim['id']}/fluxo?de=1&ate=5")
    lat = {x["operacao"]: x for x in cliente.get("/api/painel/operacao/desempenho").get_json()["latencias"]}
    assert "fluxo de transações" in lat
    assert lat["fluxo de transações"]["ultima_ms"] >= 0 and lat["fluxo de transações"]["medido_em"].endswith("Z")


# -- rótulo e base do treino ---------------------------------------------------------------------------------------
def test_sem_rotulo_nao_ha_metricas_parciais_nem_do_dataset(cliente, tmp_path):
    sem = [x.rsplit(",", 1)[0] for x in CENARIO]
    reg = _enviar(cliente, escrever(tmp_path / "sem.csv", sem).read_bytes())
    fim = _analisar(cliente, reg["id"])
    assert fim["rotulo"]["disponivel"] is False
    assert "metricas_parciais" not in fim or fim["metricas_parciais"]["com_rotulo"] == 0
    linhas = cliente.get(f"/api/painel/analises/{fim['id']}/fluxo?de=1&ate=200").get_json()
    assert linhas["rotulo_disponivel"] is False and all(x["rotulo"] is None for x in linhas["linhas"])
    dd = cliente.get(f"/api/painel/operacao/metricas?analise={fim['id']}").get_json()["do_dataset"]
    assert dd["disponivel"] is False and dd["base_no_treino"] == "nao_confirmado"


def test_base_no_treino_confirmada_quando_o_hash_e_o_do_treino(tmp_path, fabrica_modelo):
    modelo = fabrica_modelo()
    conteudo = escrever(tmp_path / "c.csv", CENARIO, com_rotulo=True).read_bytes()
    limites = {"inicio": "2024-01-01", "treino_ate": "2024-01-03", "validacao_ate": "2024-01-04",
               "teste_ate": "2024-01-06", "inicio_cauda": "2024-01-06"}
    modelo.cab.metadados.update(sha256=hashlib.sha256(conteudo).hexdigest(), limites=limites)
    c = abrir_cliente(tmp_path, modelo)
    try:
        reg = _enviar(c, conteudo)
        assert reg["validacao"]["sha256"] == modelo.cab.metadados["sha256"]
        fim = _analisar(c, reg["id"])
        assert fim["modelo"]["sha256_treino"] == fim["dataset"]["sha256"] and fim["modelo"]["limites_treino"] == limites
        dd = c.get(f"/api/painel/operacao/metricas?analise={fim['id']}").get_json()["do_dataset"]
        assert dd["base_no_treino"] == "confirmado" and dd["treino"]["limites"]["treino_ate"] == "2024-01-03"
        # o mesmo conteúdo com outro empacotamento (outro arquivo, outro hash) não é confirmado
        outro = conteudo.replace(b"\n", b"\r\n")
        reg2 = _enviar(c, outro, nome="c_crlf.csv")
        assert reg2["validacao"]["sha256"] != reg["validacao"]["sha256"]
        fim2 = _analisar(c, reg2["id"])
        dd2 = c.get(f"/api/painel/operacao/metricas?analise={fim2['id']}").get_json()["do_dataset"]
        assert dd2["base_no_treino"] == "nao_confirmado"
    finally:
        api_painel._ctx.clear()


def test_manifesto_antigo_sem_campos_novos_e_nao_confirmado(cliente, tmp_path):
    reg = _enviar(cliente, escrever(tmp_path / "c.csv", CENARIO, com_rotulo=True).read_bytes())
    fim = _analisar(cliente, reg["id"])
    ger = api_painel._c()["analises"]
    with ger._trava:  # como um manifesto gravado por versão anterior
        m = ger._manifestos[fim["id"]]
        m.pop("metricas_parciais")
        for k in ("sha256_treino", "limites_treino"):
            m["modelo"].pop(k, None)
        m["contagens"].pop("periodo")
    api_painel._c()["metricas_dataset"].clear()
    dd = cliente.get(f"/api/painel/operacao/metricas?analise={fim['id']}").get_json()["do_dataset"]
    assert dd["disponivel"] and dd["base_no_treino"] == "nao_confirmado" and dd["periodo"] is None


# -- interface (estático) ----------------------------------------------------------------------------------------
CSS = (ASSETS / "painel.css").read_text(encoding="utf-8")
LOG = (ASSETS / "painel-log.js").read_text(encoding="utf-8")
SECOES = (ASSETS / "painel-secoes.js").read_text(encoding="utf-8")


def test_ordem_dos_scripts_no_painel():
    html = (INTERFACE / "painel.html").read_text(encoding="utf-8")
    ordem = [html.index(f'src="assets/{s}"') for s in
             ("painel-base.js", "painel-log.js", "painel-secoes.js", "painel-app.js")]
    assert ordem == sorted(ordem)


def _regras(trecho: str) -> list:
    return [(sel.split("*/")[-1].strip(), corpo) for sel, corpo in re.findall(r"([^{}]+)\{([^{}]*)\}", CSS) if trecho in sel]


def test_execucao_em_uma_coluna_com_o_log_na_largura_toda():
    # a lista lateral de etapas saiu: o acompanhamento e o log ficam um abaixo do outro, o log na largura toda
    seletores = [sel.split("*/")[-1].strip() for sel, _ in re.findall(r"([^{}]+)\{([^{}]*)\}", CSS)]
    assert not [s for s in seletores if re.search(r"\.execucao(\.terminada)?( |,|$)|\.execucao-etapas|\.etapas?\b", s)]
    assert any("container: log / inline-size" in c for sel, c in _regras(".log-analise") if sel == ".log-analise")
    novas = " ".join(sel + c for sel, c in _regras("")
                     if ".log-" in sel or ".trilha-etapas" in sel or ".acomp" in sel)
    assert novas and not re.search(r"minmax\(\d+px, 1fr\)", novas)
    # os nomes das etapas quebram linha em vez de serem cortados; volume e detalhe vão até duas linhas (texto na dica)
    rotulo = " ".join(c for sel, c in _regras(".trilha-etapas .rotulo-passo"))
    assert "overflow-wrap: anywhere" in rotulo and "ellipsis" not in rotulo and "nowrap" not in rotulo
    assert any("-webkit-line-clamp: 2" in c for _, c in _regras(".trilha-etapas .info-passo"))
    assert "title: e.detalhe" in SECOES


def test_etapas_aparecem_uma_vez_no_acompanhamento_da_analise():
    for removido in ("function Progresso", "ResumoEtapas", "CabecaExecucao", "Etapas executadas", "execucao-etapas"):
        assert removido not in SECOES, removido
    # uma única lista de etapas (TrilhaEtapas), usada ao vivo e no cartão de conclusão
    assert SECOES.count("m.etapas.map(") == 1 and SECOES.count("h(TrilhaEtapas, { m })") == 2
    vivo = SECOES[SECOES.index("function AcompanhamentoVivo"):SECOES.index("const SinalFim")]
    for texto in ("'Análise em andamento'", "andamentoAnalise(m)", "BarraProgresso", "h(TrilhaEtapas, { m })", "'Decorrido'",
                  "'Restante'", "'Processadas'", "'Total'", "'Alertas'", "Cancelar análise", "Mantenha esta aba aberta",
                  "Manter a análise nesta aba", "'aria-live': 'polite'"):
        assert texto in vivo, texto
    trilha = SECOES[SECOES.index("function TrilhaEtapas"):SECOES.index("function TabelaProblemas")]
    for texto in ("e.nome", "duracaoEtapa(e)", "volumeEtapa(e)", "e.detalhe", "'aria-current'", "className: 'enche'"):
        assert texto in trilha, texto
    execucao = SECOES[SECOES.index("const processamento"):SECOES.index("const novaAnalise")]
    assert "h(AcompanhamentoAnalise," in execucao and "h(LogAnalise," in execucao and "className: 'execucao'" not in execucao
    # na troca de ordem (início e fim da análise) o React recria a nova análise e não move a execução: mover um nó
    # zera a rolagem do log sem evento de rolagem
    assert "novaAnalise('nova')" in SECOES and "novaAnalise('nova-depois')" in SECOES


def test_tempo_da_etapa_vem_do_manifesto():
    trilha = SECOES[SECOES.index("function duracaoEtapa"):SECOES.index("function TrilhaEtapas")]
    assert "e.duracao_s" in trilha and "Date.parse(e.inicio)" in trilha and "Math.random" not in trilha


def test_painel_do_log_cabecalho_metricas_e_lista():
    lista = LOG[LOG.index("function ListaFluxo"):LOG.index("function ResumoPrecisaoRecall")]
    painel = lista[lista.index("className: 'log-painel'"):lista.index("className: 'log-rolagem'")]
    for texto in ("log-cabeca", "titulo, status", "notas", "log-nav", "Mais recentes", "Posição", "metricas"):
        assert texto in painel, texto
    for texto in ("Ao vivo · seguindo as mais recentes", "Ao vivo · leitura livre a partir do nº", "'Análise ' + (NOME_STATUS"):
        assert texto in lista, texto
    # as métricas ficam fora da área rolável: sem área fixa (sticky) dentro do log
    assert "log-fixo" not in LOG and "log-fixo" not in CSS
    assert not any("position: sticky" in c for sel, c in _regras(".log-"))
    assert "className: 'log-metricas-area', role: 'group'" in LOG and "'Métricas de execução'" in LOG
    # cada linha da entrada tem classe própria (grade de duas colunas no painel largo); a previsão vem logo após o cabeçalho
    entrada = LOG[LOG.index("const Entrada = React.memo"):LOG.index("const pagina = id")]
    ordem = [entrada.index(c) for c in ("'log-cab'", "'log-previsao'", "'log-origem'", "'log-destino'", "'log-valor-linha'")]
    assert ordem == sorted(ordem)
    largo = CSS[CSS.index("@container log (min-width: 760px)"):]
    assert "grid-template-areas" in largo.split("}")[0] + largo


def test_altura_das_entradas_pela_largura_do_painel_do_log():
    # a altura fixa da lista virtualizada depende da largura do painel (container), não da janela
    # cada bloco vai até a próxima regra @ (o bloco largo tem regras aninhadas)
    blocos = re.findall(r"@container log \((max|min)-width: ([\d.]+)px\) \{(.*?)(?=@container|@media|$)", CSS, flags=re.S)
    larguras = {(t, float(w)) for t, w, corpo in blocos if "--log-linha" in corpo}
    assert {("max", 759.98), ("max", 600.0), ("max", 420.0), ("max", 340.0), ("min", 760.0)} <= larguras
    assert not re.search(r"@media[^{]*\{[^@]*\.log-rolagem \{ --log-linha", CSS)


def test_log_sem_temporizadores_soltos_nem_valores_fixos():
    assert "setTimeout" not in LOG and "Math.random" not in LOG and "setInterval" not in LOG
    assert not re.search(r"(precisao|recall)\s*[:=]\s*\d", LOG)
    for texto in ("aria-setsize", "aria-posinset", "indisponível", "Sem classificação", "Rótulo do dataset", "parcial: ",
                  "gerado pelo NodeWatch", "registrada no dataset", "não significa que não seja lavagem",
                  "Não disponível para este dataset", "calculado sobre", "possível lavagem", "Ir para as mais recentes",
                  "requestAnimationFrame", "Log da execução"):
        assert texto in LOG, texto
    assert not re.search(r"fraude confirmada|lavagem confirmada|tipologia prevista", LOG, flags=re.I)
    assert "'padrao_nao_identificado'" not in LOG


def test_log_exportado_no_padrao_do_projeto():
    assert LOG.lstrip().startswith("/*") and "(function () {\n  'use strict';" in LOG.replace("\r\n", "\n")
    assert re.search(r"Object\.assign\(window\.NW, \{[^}]*LogAnalise[^}]*MetricasExecucao[^}]*ListaFluxo[^}]*"
                     r"ResumoPrecisaoRecall", LOG)
