"""Módulo de Machine Learning do NodeWatch: detecção de lavagem de dinheiro.

Uma tarefa, ``lavagem``: pontua transações do IBM AML HI-Small (sintético)
pelo rótulo ``Is Laundering``, com 49 atributos que só olham o passado de
cada conta. O modelo distribuído fica em ``modelos/`` e é instalado em
``artefatos_ml/`` por :mod:`src.ml.provisionamento`.

Uso pela linha de comando (treino, avaliação, previsão em arquivos):
``python -m src.treino.cli --help``.
"""

VERSAO_MODULO = "0.1.0"
