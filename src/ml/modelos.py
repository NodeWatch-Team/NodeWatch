"""Artefato do modelo: codificador e cabeça por tarefa, grades de treino.

``ModeloUnificado`` é o único artefato salvo (``modelo_unificado.joblib``). Ele reúne:

* ``codificadores`` — ``financeiro`` (:class:`~src.ml.preparacao.PreparadorFinanceiro`:
  câmbio, formatos, moedas, colunas e quantis do treino);
* ``cabecas`` — ``lavagem`` (:class:`CabecaClassificacao` binária).

O nome "unificado" vem da versão anterior, que também guardava as cabeças do
módulo didático de telemetria de rede (removidas em 17/11/2026). As classes e
os caminhos deste módulo não podem mudar sem salvar o artefato de novo: o
arquivo ``joblib`` guarda referências a ``src.ml.modelos`` e ``src.ml.preparacao``.

Segurança: arquivos ``joblib`` executam código ao serem carregados. Carregue
apenas artefatos gerados por você.
"""

from __future__ import annotations

import copy
import json
import platform
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import joblib
from joblib import effective_n_jobs
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.ensemble._forest import ForestClassifier
from sklearn.linear_model import LogisticRegression

from src.ml import VERSAO_MODULO
from src.ml.esquemas import ESQUEMAS

NOME_ARTEFATO = "modelo_unificado.joblib"
# Abaixo deste número de linhas a previsão roda com 1 thread: em lotes pequenos, criar
# threads custa mais que prever.
LIMITE_LINHAS_UMA_THREAD = 1_000


@dataclass
class Candidato:
    nome: str
    familia: str
    linear: bool
    params: Dict[str, Any]
    fabrica: Callable[[], Any]


def _lr(semente: int, **kw) -> Callable[[], Any]:
    # tol=1e-6: com a perda média ponderada da lavagem (~0,004, prevalência de 0,1%), a
    # tolerância padrão (1e-4) parava o lbfgs em 17 iterações, antes do ótimo.
    return lambda: LogisticRegression(max_iter=3000, tol=1e-6, random_state=semente, **kw)


def _rf(semente: int, n_jobs: int, **kw) -> Callable[[], Any]:
    return lambda: RandomForestClassifier(random_state=semente, n_jobs=n_jobs, max_features="sqrt", **kw)


def _hgb(semente: int, **kw) -> Callable[[], Any]:
    return lambda: HistGradientBoostingClassifier(random_state=semente, early_stopping=False, **kw)


def recriar_estimador(familia: str, params: Dict[str, Any], semente: int, n_jobs: int) -> Any:
    """Novo estimador (não ajustado) com a configuração escolhida."""
    if familia == "logistica":
        return _lr(semente, **params)()
    if familia == "random_forest":
        return _rf(semente, n_jobs, **params)()
    if familia == "hist_gradient_boosting":
        return _hgb(semente, **params)()
    raise ValueError(f"família desconhecida: {familia}")


def _montar(familia: str, linear: bool, fabrica_de: Callable[..., Callable[[], Any]],
            params: Dict[str, Any], *args) -> Candidato:
    rotulo = ",".join(f"{k}={v}" for k, v in params.items())
    return Candidato(f"{familia}[{rotulo}]", familia, linear, params, fabrica_de(*args, **params))


def grade_financeira(tipo: str, semente: int, n_jobs: int) -> List[Candidato]:
    """Busca pequena (treino subamostrado com pesos → AP na validação)."""
    if tipo == "rapida":
        return [
            _montar("logistica", True, _lr, {"C": 1.0}, semente),
            _montar("hist_gradient_boosting", False, _hgb, {"max_iter": 30}, semente),
        ]
    c: List[Candidato] = []
    for C in (0.1, 1.0):
        c.append(_montar("logistica", True, _lr, {"C": C}, semente))
    c.append(_montar("random_forest", False, _rf, {
        "n_estimators": 100, "min_samples_leaf": 50, "max_samples": 0.5,
    }, semente, n_jobs))
    for folhas in (31, 63):
        c.append(_montar("hist_gradient_boosting", False, _hgb, {
            "max_iter": 300, "learning_rate": 0.1, "max_leaf_nodes": folhas, "l2_regularization": 1.0,
        }, semente))
    return c


# ---------------------------------------------------------------------------
# Cabeças
# ---------------------------------------------------------------------------
@dataclass
class CabecaClassificacao:
    """Uma tarefa supervisionada: pipeline ajustado + contrato de entrada/saída."""

    tarefa: str
    pipeline: Any
    classes: List[Any]
    colunas_entrada: List[str]
    familia: str
    params: Dict[str, Any]
    limiar_alerta: float
    usa_classe_atual: bool = False  # só o módulo de rede usava; fica porque o artefato salvo traz o campo
    metadados: Dict[str, Any] = field(default_factory=dict)

    status: str = "treinada"

    def probabilidades(self, X: pd.DataFrame, lote: int = 250_000) -> np.ndarray:
        """Probabilidades na ordem de ``self.classes`` (lotes limitam a memória).

        Pode ser chamada por várias threads ao mesmo tempo: nenhum atributo do
        pipeline é alterado durante a previsão (ver :func:`_copia_uma_thread`).
        """
        if list(X.columns) != self.colunas_entrada:
            raise ValueError("Colunas de entrada diferentes das usadas no treino.")
        ordem_modelo = list(self.pipeline.classes_)
        idx = [ordem_modelo.index(c) for c in self.classes]
        pipe = self.pipeline if len(X) >= LIMITE_LINHAS_UMA_THREAD else self._pipeline_uma_thread()
        partes = []
        for i in range(0, len(X), lote):
            parte = X.iloc[i:i + lote]
            p = _proba_floresta_em_ordem(pipe, parte)  # floresta com threads: soma determinística
            partes.append((pipe.predict_proba(parte) if p is None else p)[:, idx])
        return np.vstack(partes) if partes else np.empty((0, len(self.classes)))

    def _pipeline_uma_thread(self) -> Any:
        # Guardado fora dos campos do dataclass e descartado ao salvar (__getstate__).
        copia = self.__dict__.get("_cache_uma_thread")
        if copia is None:
            copia = _copia_uma_thread(self.pipeline)
            self.__dict__["_cache_uma_thread"] = copia
        return copia

    def __getstate__(self) -> Dict[str, Any]:
        estado = dict(self.__dict__)
        estado.pop("_cache_uma_thread", None)
        return estado


_ARVORES_POR_RODADA = 4  # por thread: limita quantas previsões de árvore ficam na memória antes de somar


def _proba_floresta_em_ordem(pipeline: Any, X: pd.DataFrame) -> Optional[np.ndarray]:
    """``predict_proba`` de floresta com várias threads e a soma das árvores sempre na ordem delas.

    O ``predict_proba`` do sklearn soma a previsão de cada árvore na ordem em que as threads terminam. Em ponto
    flutuante a soma depende da ordem, e o score variava no último bit de uma execução para outra (medido no
    HI-Small: 120.386 de 5.078.345 transações com score original diferente em até 1,1e-16 entre duas análises
    do mesmo arquivo; uma delas trocou de alerta, score 701 numa e 700 na outra). Aqui as árvores continuam
    rodando em paralelo, mas a soma segue a ordem das árvores, a mesma da execução com 1 thread: o resultado é
    idêntico, bit a bit, ao de ``n_jobs=1`` e não muda entre execuções.

    Devolve ``None`` quando não se aplica (não é floresta de classificação de uma saída, ou roda com 1 thread):
    aí vale o ``predict_proba`` do próprio estimador, que já é determinístico.
    """
    est = pipeline.steps[-1][1] if hasattr(pipeline, "steps") else pipeline
    if not isinstance(est, ForestClassifier) or getattr(est, "n_outputs_", 1) != 1:
        return None
    arvores = est.estimators_
    threads = min(effective_n_jobs(est.n_jobs), len(arvores))
    if threads <= 1:
        return None
    Xt = pipeline[:-1].transform(X) if hasattr(pipeline, "steps") and len(pipeline.steps) > 1 else X
    Xv = est._validate_X_predict(Xt)  # o mesmo preparo que o predict_proba da floresta faz uma vez
    soma = np.zeros((Xv.shape[0], est.n_classes_), dtype=np.float64)
    passo = threads * _ARVORES_POR_RODADA
    with ThreadPoolExecutor(max_workers=threads) as executor:
        for i in range(0, len(arvores), passo):
            # map devolve na ordem das árvores, não na ordem em que terminam
            for p in executor.map(lambda arvore: arvore.predict_proba(Xv, check_input=False), arvores[i:i + passo]):
                soma += p
    soma /= len(arvores)
    return soma


def _copia_uma_thread(pipeline: Any) -> Any:
    """Cópia rasa do pipeline com ``n_jobs=1`` no estimador final.

    Em lotes pequenos, criar threads custa mais que prever. A versão anterior
    trocava ``n_jobs`` no estimador compartilhado durante a previsão; com duas
    threads prevendo ao mesmo tempo (API e trabalhador de eventos), uma podia
    restaurar o valor no meio da previsão da outra. A cópia compartilha as
    árvores e os transformadores ajustados (só lidos na previsão) e nunca
    altera o original. O resultado é idêntico: a floresta só reparte as
    árvores entre threads.
    """
    est = pipeline.steps[-1][1] if hasattr(pipeline, "steps") else pipeline
    if getattr(est, "n_jobs", None) in (None, 1):
        return pipeline
    est1 = copy.copy(est)
    est1.n_jobs = 1
    if not hasattr(pipeline, "steps"):
        return est1
    pipe1 = copy.copy(pipeline)
    pipe1.steps = list(pipeline.steps[:-1]) + [(pipeline.steps[-1][0], est1)]
    return pipe1


# ---------------------------------------------------------------------------
# Modelo unificado
# ---------------------------------------------------------------------------
def versoes() -> Dict[str, str]:
    return {
        "modulo_ml": VERSAO_MODULO,
        "python": platform.python_version(),
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "scikit-learn": sklearn.__version__,
        "joblib": joblib.__version__,
    }


@dataclass
class ModeloUnificado:
    codificadores: Dict[str, Any] = field(default_factory=dict)
    cabecas: Dict[str, Any] = field(default_factory=dict)
    metadados: Dict[str, Any] = field(default_factory=dict)

    def tarefas_disponiveis(self) -> Dict[str, str]:
        return {nome: getattr(c, "status", "desconhecido") for nome, c in self.cabecas.items()}

    def cabeca(self, tarefa: str) -> Any:
        if tarefa not in self.cabecas:
            raise KeyError(f"Tarefa '{tarefa}' não treinada. Disponíveis: {self.tarefas_disponiveis()}")
        c = self.cabecas[tarefa]
        if getattr(c, "status", "") != "treinada":
            raise RuntimeError(f"Tarefa '{tarefa}' com status {c.status}.")
        return c

    def registrar(self, tarefa: str, cabeca: Any, codificador_nome: str, codificador: Any) -> None:
        self.cabecas[tarefa] = cabeca
        self.codificadores[codificador_nome] = codificador
        self.metadados.setdefault("historico", []).append({
            "tarefa": tarefa, "registrada_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        })

    def prever(self, tarefa: str, *args, **kwargs):
        from src.ml import previsao
        if tarefa == "lavagem":
            return previsao.prever_lavagem(self, *args, **kwargs)
        self.cabeca(tarefa)  # levanta o erro adequado
        raise KeyError(tarefa)

    # ------------------------------------------------------------------
    def salvar(self, pasta: Path) -> Path:
        pasta = Path(pasta)
        pasta.mkdir(parents=True, exist_ok=True)
        self.metadados["versoes"] = versoes()
        self.metadados["salvo_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        destino = pasta / NOME_ARTEFATO
        joblib.dump(self, destino, compress=3)
        resumo = {
            "artefato": NOME_ARTEFATO,
            "tarefas": self.tarefas_disponiveis(),
            "metadados": self.metadados,
            "cabecas": {
                nome: {"familia": c.familia, "params": c.params, "classes": [str(x) for x in c.classes],
                       "colunas_entrada": c.colunas_entrada, "limiar_alerta": c.limiar_alerta,
                       "usa_classe_atual": c.usa_classe_atual, "metadados": c.metadados}
                for nome, c in self.cabecas.items()
            },
        }
        (pasta / "metadados_modelo.json").write_text(
            json.dumps(resumo, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        pasta_esq = pasta / "esquemas"
        pasta_esq.mkdir(exist_ok=True)
        for nome, esq in ESQUEMAS.items():
            (pasta_esq / f"{nome}.json").write_text(
                json.dumps(esq.para_dict(), ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        return destino

    @staticmethod
    def carregar(pasta: Path) -> "ModeloUnificado":
        caminho = Path(pasta) / NOME_ARTEFATO
        if not caminho.is_file():
            raise FileNotFoundError(f"Artefato não encontrado: {caminho}. Rode 'treinar' antes.")
        try:
            modelo = joblib.load(caminho)
        except (AttributeError, ModuleNotFoundError) as exc:  # pickle de uma versão com classes que já saíram
            raise RuntimeError(
                f"{caminho} foi salvo por uma versão anterior do NodeWatch e usa classes que não existem mais "
                f"({exc}). Se é o modelo distribuído, rode python -m src.ml.provisionamento (ou inicie o "
                "servidor) para trocá-lo pela versão atual; um modelo treinado nesta máquina precisa ser "
                "treinado de novo.") from None
        if not isinstance(modelo, ModeloUnificado):
            raise TypeError(f"{caminho} não contém um ModeloUnificado.")
        salvo = modelo.metadados.get("versoes", {}).get("scikit-learn")
        if salvo and salvo != sklearn.__version__:
            import warnings
            warnings.warn(f"Artefato salvo com scikit-learn {salvo}; ambiente atual {sklearn.__version__}.")
        return modelo

    @staticmethod
    def carregar_ou_novo(pasta: Path) -> "ModeloUnificado":
        try:
            return ModeloUnificado.carregar(pasta)
        except FileNotFoundError:
            return ModeloUnificado()


