"""Gera os arquivos INVENTADOS do tutorial de docs/COMO_FUNCIONA_O_NODEWATCH.md.

Nenhuma linha vem de um dado real: contas, bancos, valores e datas foram criados à
mão para ilustrar o formato e a leitura do resultado. Os scores desses arquivos não
dizem nada sobre o desempenho do modelo.

Uso: python docs/exemplos/gerar_exemplos_inventados.py
"""

from pathlib import Path

PASTA = Path(__file__).resolve().parent

CAB_PT = ("id_transacao,timestamp,banco_origem,conta_origem,banco_destino,conta_destino,"
          "valor_pago,moeda_pagamento,valor_recebido,moeda_recebimento,formato")


def tx(i, quando, bo, co, bd, cd, valor, formato="ACH", moeda="US Dollar", recebida=None):
    return f"tx-{i:03d},{quando},{bo},{co},{bd},{cd},{valor},{moeda},{valor},{recebida or moeda},{formato}"


# A conta MERCADO1 faz pagamentos pequenos e regulares; depois recebe um valor alto de
# ORIGEM9 e o repassa em poucos minutos, em moeda diferente, para contas novas.
linhas = [
    tx(1, "2025-03-10T09:00:00Z", 301, "MERCADO1", 302, "FORNEC01", 120.50),
    tx(2, "2025-03-10T15:00:00Z", 301, "MERCADO1", 302, "FORNEC02", 98.00),
    tx(3, "2025-03-11T09:00:00Z", 301, "MERCADO1", 302, "FORNEC01", 131.20),
    tx(4, "2025-03-11T15:00:00Z", 301, "MERCADO1", 302, "FORNEC02", 87.75),
    tx(5, "2025-03-12T09:00:00Z", 301, "MERCADO1", 302, "FORNEC01", 110.00),
    tx(6, "2025-03-12T09:00:40Z", 305, "CLIENTE7", 301, "MERCADO1", 45.90, "Credit Card"),
    tx(7, "2025-03-12T15:00:00Z", 301, "MERCADO1", 302, "FORNEC02", 92.30),
    tx(8, "2025-03-13T09:00:00Z", 301, "MERCADO1", 302, "FORNEC01", 125.60),
    tx(9, "2025-03-13T10:00:00Z", 309, "ORIGEM9", 301, "MERCADO1", 48000.00),
    tx(10, "2025-03-13T10:05:00Z", 301, "MERCADO1", 310, "NOVA0001", 23500.00, recebida="Euro"),
    tx(11, "2025-03-13T10:06:00Z", 301, "MERCADO1", 311, "NOVA0002", 23400.00, recebida="Euro"),
    tx(12, "2025-03-13T10:07:00Z", 310, "NOVA0001", 301, "MERCADO1", 900.00),
]
ruins = [
    "tx-013,ontem,301,MERCADO1,302,FORNEC01,10.00,US Dollar,10.00,US Dollar,ACH",   # data inválida
    "tx-014,2025-03-13T11:00:00Z,301,MERCADO1,302,FORNEC01,-5.00,US Dollar,5.00,US Dollar,ACH",  # valor negativo
    linhas[0],  # id repetido
]
(PASTA / "transacoes_inventadas.csv").write_text(CAB_PT + "\n" + "\n".join(linhas + ruins) + "\n", encoding="utf-8")

(PASTA / "transacoes_inventadas_formato_ibm.csv").write_text(
    "Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,Amount Paid,Payment Currency,Payment Format\n"
    "2025/03/10 09:00,301,MERCADO1,302,FORNEC01,120.50,US Dollar,120.50,US Dollar,ACH\n"
    "2025/03/10 15:00,301,MERCADO1,302,FORNEC02,98.00,US Dollar,98.00,US Dollar,ACH\n", encoding="utf-8")

print("gerados em", PASTA)
