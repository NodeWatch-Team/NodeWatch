<!--capa
rotulo: Material de estudo e apresentação
titulo: NodeWatch: como explicar o projeto com segurança
sub: Resumo de estudo, perguntas prováveis da professora, roteiro de cinco minutos e lembretes para o ensaio.
Projeto: NodeWatch, Grupo 4
Integrantes: Caio Winkler Marangoni, Guilherme Lombardi, Ryan dos Santos Veloso, Julia Emily Leonardo Barbosa e Guilherme Liborio Camargo
Versão descrita: main de 17/11/2026 (depois da reorganização do repositório)
Modelo: lavagem-20261102T083253Z (não foi retreinado para este material)
Data: 17/11/2026
-->

# NodeWatch: como explicar o projeto com segurança

**Como usar.** Leia o resumo, estude primeiro as cinco perguntas marcadas com ★ e ensaie o roteiro com cronômetro. Os arquivos que sustentam cada número estão na seção 5, separados das falas, junto com o que ainda precisa de confirmação.

**Duas gerações de números.** Os resultados oficiais vêm do modelo atual, reavaliado em 02/11/2026 (*Average Precision* 0,464). A comparação com XGBoost e com regras explícitas foi feita antes de uma correção, com a floresta da época (0,461). Compare números apenas dentro da mesma geração.

**O que mudou em 17/11/2026.** O repositório foi reorganizado: saíram a interface antiga (`/legado`), a CLI de grafos (DFS, SCC e centralidade), o processamento de eventos e o módulo didático de telemetria de rede (`estado_rede`). O NodeWatch hoje é **um modelo de lavagem e o painel do analista**. Se a professora perguntar pelo que saiu, a resposta está na pergunta 11.

# 1 Resumo de estudo

## O problema e o que é um alerta

O NodeWatch é um protótipo acadêmico que ajuda uma pessoa analista a decidir **o que investigar primeiro** em transações financeiras. Ele nasceu com grafos e depois ganhou ML (*Machine Learning*, em que o programa aprende com exemplos em vez de seguir regras escritas à mão).

**Um alerta aparece quando o score, a nota dada pelo modelo, alcança um limiar. Ele é um pedido de atenção, não uma prova.** Sozinho, não comprova nada: o modelo aprendeu lavagem sintética, não fraude confirmada; o score serve para ordenar e não é uma probabilidade calibrada; e 37% dos alertas do teste estavam errados. A conclusão é de uma pessoa, com outras evidências. Sem alerta também não quer dizer seguro: 59% da lavagem do teste não gerou alerta.

## Os dados

| Base | O que representa | Cuidado |
|---|---|---|
| **IBM AML HI-Small** | 5.078.345 transações **sintéticas**, de 01 a 18/09/2022, das quais 5.177 foram marcadas como lavagem pelo simulador | Não são operações de um banco. Os arquivos de contas e de padrões nunca viram atributo |
| **`dados/exemplos/transacoes_inventadas.csv`** | 15 transações inventadas à mão, para demonstrar o fluxo | Só exemplo: não mede a qualidade do modelo |

## O que o sistema faz

- **Transações (ML).** Dá uma nota a cada transação a partir de 49 atributos, que são números calculados só com o passado de cada conta: contagens e somas em janelas de 6, 24 e 72 h, par de contas novo, valor atípico, tempo desde o último recebimento, contrapartes distintas, formato de pagamento e moeda.
- **Grafo (investigação).** Contas são vértices e transações são arestas. O modelo usa medidas de 1 salto (contrapartes distintas, par novo); o painel desenha a rede da conta em foco, salto a salto, e mostra quais repasses têm horários compatíveis.
- **Painel do analista.** Envio e validação do arquivo, acompanhamento da análise em cinco etapas medidas, visão geral, contas prioritárias, grafo, tabela com filtros, desempenho e logs. O Assistente de dúvidas (tecnologia Sentinel AI) explica a análise aberta.

## O caminho dos dados, com um exemplo inventado

Em `tx-011`, a conta `MERCADO1` recebe 48.000 e, seis minutos depois, paga 23.400 a uma conta nova.

| Etapa | O que o sistema faz | No exemplo `tx-011` |
|---|---|---|
| **Envio** | A página envia o CSV ou ZIP ao servidor local; a sessão da aba autoriza o pedido | Arquivo com 15 linhas |
| **Validação** | Reconhece o formato pelas colunas e recusa linhas ruins, com o motivo. Nada é preenchido | 12 válidas e 3 recusadas: data "ontem", valor negativo e identificador repetido |
| **Ordenação** | Ordena por data e hora; o ID de exibição segue essa ordem | `tx-011` vira **TX-11** |
| **Atributos** | Calcula os 49 atributos com o estado das contas **antes** daquele minuto | Par novo; moedas diferentes; 6 min desde o recebimento; 3 envios em 24 h |
| **Pontuação** | A Random Forest salva dá o valor bruto; nada é treinado | 0,0231 |
| **Score e alerta** | Converte para 0–1000, ancorado no limiar 0,0910 (= 701) | **177**, faixa baixa: **sem alerta** |
| **Gravação** | Grava a linha no SQLite da análise; o estado das contas é atualizado, o modelo não muda | Linha na tabela. Sem rótulo, não há precisão nem recall |

O repasse parece suspeito para nós, mas o modelo reage ao que aprendeu com o simulador. Isso mostra, de uma vez, que sem alerta não significa seguro e que um arquivo inventado não mede a qualidade do modelo.

## Os modelos avaliados

O critério de escolha foi a **AP** (*Average Precision*, qualidade da ordenação de uma classe rara) na validação. **Precisão** é a fração de alertas certos; **recall**, a fração de casos reais encontrados.

| Modelo | Papel | AP de validação |
|---|---|---|
| **Random Forest** | **Escolhida**: árvores independentes, média das respostas | 0,499 |
| HistGradientBoosting | Candidata: árvores em sequência | 0,445 |
| Regressão logística | Candidata e referência linear | 0,190 |
| Taxa do formato | Baseline sem aprendizado: taxa de lavagem por formato de pagamento | 0,0068 |

A floresta foi escolhida pela métrica na validação: ela capta combinações entre atributos e dispensa normalização. Todos os modelos vêm do **scikit-learn**. **NumPy é uma biblioteca, não um modelo**: com ela foram escritos os atributos e métricas próprias. **XGBoost não está no código**: só foi medido em scripts isolados da auditoria.

## Treino, inferência e histórico

**Treino** muda o modelo e só roda pela linha de comando (`python -m src.treino.cli`). **Inferência** aplica o modelo pronto a dados novos: é o que o painel faz. **Atualizar o histórico** muda só as contagens e somas das contas daquela análise. Nenhuma tela ou rota treina o modelo.

## Sessão e execução

Abrir a página só cria uma sessão, uma autorização temporária daquela aba, renovada a cada 15 s. Validar não gera previsões. A análise só começa com o clique em **Analisar** e roda no servidor local. Sem pulso por 150 s, a sessão expira e a análise para no próximo ponto seguro, fica **parcial** e não é retomada sozinha. A sessão controla o uso; não é autenticação.

## Resultados, limitações e próximos passos

Teste: 09 e 10/09/2022, 862.792 transações, 956 positivas.

| Medida no teste | Referência simples | Modelo | O que significa |
|---|---|---|---|
| AP | 0,0064 (taxa do formato) | **0,464** | Qualidade da ordenação; o acaso daria 0,0011 |
| Precisão e recall no limiar | 0,007 e 0,872 | **0,627 e 0,407** | 389 certos em 620 alertas; 389 achados em 956 |
| Falsos alertas | — | **2,7 por 10 mil** | 231 no período |

| Situação | Componentes |
|---|---|
| **Disponível** | Painel do analista (análise de arquivo, investigação, desempenho e logs); treino e avaliação pela CLI; modelo distribuído com SHA-256 conferido; Assistente de dúvidas no modo local |
| **Não verificado** | Sentinel AI com chave real (as respostas não foram testadas depois da revisão do prompt de 17/11) |
| **Ausente** | XGBoost no código; fonte de dados ao vivo; autenticação; explicação por transação do modelo |

**Limitações.** Medido só em dados sintéticos. Período de teste já consultado três vezes, logo os números não são inéditos. Em positivos sem padrão conhecido (39% do teste), o recall é de 2%. O painel só conhece o passado que está no próprio arquivo: no começo do período os alertas ficam subestimados.

**Próximos passos, em ordem.** Congelar candidatos pela validação e medir uma vez em período novo (por exemplo o HI-Medium); definir custos de erro e capacidade de investigação para escolher o limiar; definir requisitos de latência e memória.

# 2 Perguntas e respostas

As perguntas estão em ordem de importância. Cada resposta foi escrita para durar de 20 a 40 segundos. Entenda o conceito essencial e use suas palavras: a professora pode reformular a pergunta.

**Estude primeiro as cinco perguntas ★.** Elas respondem aos comentários que o grupo recebeu da professora:

| Comentário relatado | Perguntas |
|---|---|
| Comparar a implementação associada ao NumPy com uma referência, e verificar se o ML ganha de regras | ★1 e ★2 |
| Investigar o custo da Random Forest e experimentar XGBoost | ★3 e ★4 |
| Identificar o modelo chamado de regressão e justificá-lo | ★5 |

## ★ 1. NumPy: o que foi implementado

**Pergunta:** "O que vocês implementaram com NumPy? Existe um modelo de vocês feito com essa biblioteca?"

**Resposta sugerida:** NumPy é uma biblioteca de vetores e cálculo numérico, não um algoritmo de aprendizado. Não escrevemos nenhum modelo à mão: todos vêm do scikit-learn. Com NumPy, implementamos o cálculo dos atributos das transações: em lote, ordenamos os eventos por conta e minuto e achamos os limites de cada janela por busca binária; no painel, mantemos um estado por conta que calcula os mesmos 49 atributos transação a transação. Conferimos esse código contra uma referência por força bruta.

**Conceito essencial:** biblioteca não é algoritmo, e importar NumPy não treina nada. O que é nosso é o cálculo *point-in-time*: cada atributo usa só o que aconteceu antes daquele minuto, na janela `[t − w, t)`. Se ela perguntar pelo modelo em NumPy, a resposta honesta é que ele não existe; seria uma peça didática nova, e vale confirmar se ela espera isso (seção 5.3).

## ★ 2. As duas comparações: correção e utilidade

**Pergunta:** "Vocês compararam a implementação de vocês com uma solução que já existe? Isso prova que o ML vale a pena?"

**Resposta sugerida:** São duas perguntas diferentes. A primeira é se o nosso código calcula certo: comparamos os atributos com força bruta e o cálculo incremental com o lote, e isso revelou um erro numérico nas somas, que corrigimos. A segunda é se aprender compensa: comparamos o modelo com regras e baselines. Não há modelo próprio para comparar com o scikit-learn, porque não escrevemos nenhum. Ainda falta confirmar tudo em dados novos.

**Conceito essencial:** comparar com uma referência do **mesmo cálculo** testa a correção. Comparar **métodos diferentes** testa a utilidade. Um resultado não substitui o outro.

| Comparação | O que responde | Situação |
|---|---|---|
| Atributos em NumPy × força bruta; incremental × lote × força bruta | Calcula certo? | **Existe**, nos testes do NodeWatch |
| Métricas próprias × fórmulas independentes | Calcula certo? | **Existe**, na auditoria |
| Modelo próprio em NumPy × scikit-learn | Calcula certo? | **Não se aplica**: não há modelo próprio |
| Random Forest × prevalência e taxa do formato | Compensa? | **Existe**, com o modelo atual |
| Random Forest × regras explícitas, como "formato ACH e primeira transação do par" | Compensa? | **Existe**, só na auditoria, com a floresta anterior à correção |
| Random Forest × Random Forest com 3 atributos de grafo a mais | Compensa? | **Existe**: não compensou (pergunta 11) |
| Candidato congelado em período novo | Vale fora do teste já usado? | **Falta** |

## ★ 3. Random Forest e custo de processamento

**Pergunta:** "Por que Random Forest? Ela não custa caro demais para processar?"

**Resposta sugerida:** A Random Forest combina muitas árvores de decisão, cada uma treinada com uma amostra diferente, e usa a média das respostas. Ela capta combinações entre atributos, dispensa normalização e teve o melhor resultado na validação. O custo existe, mas não era o gargalo: o treino levou de 28 a 52 segundos em CPU. O gargalo era recalcular atributos a cada transação, e o estado incremental resolveu isso: no painel, uma análise de 200 mil transações leva cerca de 45 segundos, dos quais cerca de 1 segundo é o modelo.

**Conceito essencial:** separe custo de treino, inferência, tamanho e atributos.

- **Tamanho:** o arquivo distribuído tem 3,0 MB, e o servidor com o modelo carregado usa cerca de 210 MB de memória.
- **Lotes pequenos:** com menos de 1.000 linhas a previsão usa uma thread, porque criar threads custava mais que prever.
- **GPU:** não foi usada nem medida. Respondam com os tempos em CPU, sem comparar com GPU.

## ★ 4. XGBoost: recomendação, implementação e comparação

**Pergunta:** "Vocês testaram XGBoost? Ele é melhor que a Random Forest?"

**Resposta sugerida:** Testamos, mas não adotamos. O XGBoost não está no código do NodeWatch: ele foi medido em scripts isolados, com os mesmos dados e atributos. Ele foi melhor: AP de teste de 0,509, contra 0,461 da floresta daquela versão, e treino mais curto. Mas esse teste já tinha sido consultado, e o resultado variou muito entre configurações. Numa avaliação posterior, com o HI-Large, a vantagem não se confirmou em todos os períodos. Antes de trocar, precisamos confirmar num período novo.

**Conceito essencial:** diferencie três coisas. **Recomendação:** a professora sugeriu experimentar. **Implementação:** não existe; `xgboost` não aparece no código nem nas dependências. **Comparação experimental:** existe, na auditoria de 02/11/2026 e na avaliação do HI-Large (`pesquisa/hi_large/`). Random Forest treina árvores independentes e tira a média; XGBoost é *boosting*, com árvores em sequência, cada uma corrigindo as anteriores. Não digam que XGBoost é sempre melhor: o HistGradientBoosting, que também é boosting, perdeu para a floresta na validação (0,445 × 0,499).

| Na comparação da auditoria | XGBoost | Random Forest | Leitura |
|---|---|---|---|
| AP de validação | 0,555* | 0,495; 0,525 com a mesma busca | *Otimista: a validação também definiu o número de árvores. Variou de 0,27 a 0,55 entre as 4 tentativas |
| AP de teste | 0,509 | 0,461; 0,478 com a mesma busca | Vantagem de cerca de 0,03 com a mesma busca |
| Treino | 6,6 s | 42,7 s; 85,4 s com a mesma busca | Mais rápido nesta medição, com 4 threads |

**Como avaliar de forma justa:** mesmos registros e atributos; mesmo orçamento de busca; escolha e parada antecipada só na validação; candidatos congelados e medidos uma vez em período novo, por exemplo uma replicação declarada como o HI-Medium.

## ★ 5. Regressão logística

**Pergunta:** "Por que um algoritmo chamado regressão está resolvendo um problema de classificação?"

**Resposta sugerida:** Apesar do nome, a regressão logística é um classificador supervisionado. Ela combina os atributos com pesos para modelar o logaritmo da chance e transforma o resultado em probabilidade entre zero e um. Com um limiar, isso vira classe. Nosso rótulo é uma categoria (lavagem ou não), então o objetivo é classificar, e nenhum regressor numérico existe no projeto. Ela foi candidata e referência linear, e perdeu: AP de validação de 0,19 contra 0,50, o que indica que combinações entre atributos pesam.

**Conceito essencial:** `log(p / (1 − p)) = b0 + b1·x1 + …`. O "regressão" vem dessa combinação linear; a saída usada é uma classe. Ela exige imputação, logaritmo e padronização, ajustados só no treino. Com `tol=1e-4`, ela parava antes do ótimo, em 17 iterações; com `tol=1e-6`, a AP de validação subiu para 0,19.

## 6. ML ou regras matemáticas

**Pergunta:** "Por que usar ML em vez de apenas regras ou fórmulas matemáticas?"

**Resposta sugerida:** Porque, nos nossos dados, as regras testadas não ordenam bem. A melhor regra explícita, formato ACH com primeira transação do par, encontra 78% dos casos, mas gera mais de 20 mil alertas em dois dias, com precisão de 3,6%. O modelo emite centenas de alertas, com precisão bem maior. Com os mesmos 20.575 alertas, a floresta da auditoria achou 82,5%: a vantagem decisiva está nos orçamentos pequenos, que é o caso real de uma equipe.

**Conceito essencial:** ML também é matemática; a diferença é que os parâmetros são aprendidos. ACH é uma transferência eletrônica em lote, e concentra 87% da lavagem do conjunto, o que pode ser efeito do simulador. Regras continuam úteis porque são conferíveis: por isso os motivos mostrados nos alertas são regras fixas, verificáveis.

## 7. Limitações e prioridade

**Pergunta:** "Quais são as limitações atuais, e qual melhoria tem maior prioridade?"

**Resposta sugerida:** As principais são: medido só em dados sintéticos, teste já reutilizado e nenhuma fonte ao vivo. 39% dos positivos do teste não pertencem a nenhum padrão conhecido, e neles o recall é de 2%. A prioridade é validade: congelar candidatos pela validação e medir uma vez em período novo. Sem isso, trocar de modelo seria escolher pelo teste.

**Conceito essencial:** validade vem antes de desempenho. Recall global esconde grupos: de 0,55 a 0,72 nos oito padrões descritos pelo simulador, 0,52 nas tentativas novas, 0,73 nas já iniciadas antes do teste e 0,02 nos positivos sem padrão.

## 8. Fraude, lavagem e o que o rótulo mede

**Pergunta:** "Qual é a diferença entre fraude e lavagem de dinheiro? O que o modelo detecta?"

**Resposta sugerida:** Fraude é enganar alguém para obter vantagem, e nenhum dado do projeto tem fraude confirmada. Lavagem é dar aparência legal a dinheiro de origem ilícita; nosso rótulo é lavagem gerada por um simulador. O modelo aprende a reproduzir esse rótulo sintético. Por isso falamos em "sinais para investigação de lavagem", nunca em "fraude detectada".

**Conceito essencial:** `Is Laundering = 1` não "significa fraude". Lavagem não representa todos os tipos de fraude.

## 9. Alerta, falso positivo e falso negativo

**Pergunta:** "O que significa um alerta? Qual é o impacto de falsos positivos e falsos negativos?"

**Resposta sugerida:** Alerta é um score de 701 ou mais, que equivale a passar do limiar do modelo: um pedido para olhar, não uma prova. Falso positivo é alertar algo normal, o que gasta tempo da equipe e incomoda quem é investigado. Falso negativo é deixar passar lavagem, que nem chega a ser investigada. No teste, foram 231 falsos positivos e 567 falsos negativos. O limiar equilibra os dois erros. Usamos o máximo F1 porque não recebemos custos de erro nem capacidade de investigação.

**Conceito essencial:** não existe limiar certo sem custos. Com uma equipe que investiga 1.000 casos por dia, o recall teria sido de 0,54 e 0,62 nos dois dias do teste. A escala 0–1000 é linear por partes, ancorada no limiar; ela ordena, não é probabilidade.

## 10. Treino, validação, teste e reuso

**Pergunta:** "Como separaram treino, validação e teste? O teste foi usado uma vez só?"

**Resposta sugerida:** Separamos pelo tempo: o passado treina, o período seguinte escolhe modelo e limiar, e o último mede. Treino de 1 a 6 de setembro, validação nos dias 7 e 8, teste nos dias 9 e 10. O teste não foi usado uma vez só: foi consultado três vezes. O treino nunca leu seus rótulos, mas diferenças pequenas não provam melhoria.

**Conceito essencial:** sorteio aleatório misturaria transações vizinhas no tempo. O treino mantém os positivos e 20% dos negativos, com peso 5; validação e teste mantêm a proporção original. A cauda a partir de 11/09, com 59% de lavagem, fica fora das métricas principais. Vazamento é usar algo indisponível na hora da previsão: as janelas só olham o passado, o arquivo de padrões nunca vira atributo e um teste confirma que acrescentar transações futuras não muda os atributos.

## 11. Onde entram os grafos (e o que saiu do projeto)

**Pergunta:** "Onde entram os grafos? Vocês não tinham DFS e Kosaraju?"

**Resposta sugerida:** Tínhamos, na fase de grafos do projeto: DFS para ciclos, Kosaraju para componentes fortemente conexos e centralidade de grau, numa linha de comando. Medimos se essa estrutura ajudava o modelo: com três atributos de grafo a mais (reciprocidade, profundidade de cadeia, fecha ciclo), a AP de teste foi de 0,4657 para 0,4691 e a precisão caiu 2,5 pontos, sem ganho por tipologia. Então o modelo ficou com o grafo de 1 salto, que já tinha: contrapartes distintas de cada conta e se o par é novo, entre os atributos mais importantes. O grafo segue no painel, para a investigação: a rede da conta em foco é explorada salto a salto, com as cadeias de repasse em ordem no tempo.

**Conceito essencial:** decidimos com um experimento, não por gosto, e o registro está em `docs/decisoes/0001-grafos-e-ml.md`. Na reorganização de 17/11, o código que não alimentava nem o modelo nem o painel saiu do repositório (continua no histórico do Git): a CLI de grafos, a interface antiga e o módulo de telemetria de rede, uma base didática da disciplina que nunca teve vínculo com as transações.

## 12. Avaliação de qualidade e de desempenho

**Pergunta:** "Como vocês avaliaram a qualidade das previsões e o desempenho do sistema?"

**Resposta sugerida:** São medidas separadas. Qualidade é acertar: medimos em períodos separados pelo tempo, contra baselines, com Average Precision. Desempenho é custo: o painel mede, em cada análise, o tempo de cada etapa, a vazão, a latência por bloco e a memória. Os 319 testes automatizados são uma terceira coisa: verificam se o código cumpre o que promete, sem medir qualidade.

**Conceito essencial:** não misturem as três coisas. O tempo do modelo isolado não é o tempo do sistema.

## 13. Acurácia em dados desbalanceados

**Pergunta:** "Por que a acurácia não basta em dados desbalanceados?"

**Resposta sugerida:** Porque o acerto fica dominado pela classe comum. Só 0,11% das transações do teste são positivas: quem responde sempre "não é lavagem" acerta 99,89% e não encontra nada. Por isso usamos Average Precision, que dá peso à classe rara, e olhamos precisão e recall no limiar.

**Conceito essencial:** a métrica precisa refletir o que importa.

## 14. Precisão, recall, F1 e Average Precision

**Pergunta:** "O que significam precisão, recall, F1 e Average Precision?"

**Resposta sugerida:** Precisão é, dos alertas emitidos, quantos estavam certos: no teste, 389 de 620, ou 63%. Recall é, dos casos reais, quantos foram achados: 389 de 956, ou 41%. F1 é a média harmônica dos dois: 0,49. Esses três dependem do limiar. A Average Precision resume a qualidade da ordenação sem escolher um limiar: foi 0,464, enquanto o acaso ficaria em 0,0011.

**Conceito essencial:** sempre compare com a referência. AP de 0,46 parece baixa, mas a linha de base é a prevalência, 0,0011. Um score de 800 não quer dizer 80% de chance.

## 15. Treino, inferência e histórico incremental

**Pergunta:** "Qual é a diferença entre treinar, inferir e atualizar o histórico? O que o histórico incremental melhora?"

**Resposta sugerida:** Treinar muda o modelo e só acontece pela linha de comando. Inferir aplica o modelo pronto a dados novos. Atualizar o histórico muda só contagens e somas das contas daquela análise. O cálculo incremental mantém um estado por conta e fecha um minuto de cada vez: pontuar uma transação deixou de exigir reindexar todo o histórico. Ele confere com o cálculo em lote e com a força bruta: no dia 10/09, nenhum dos 328 alertas mudou de lado.

**Conceito essencial:** não é aprendizado on-line, porque o modelo não muda. Como cada análise começa sem passado, as primeiras 72 h do arquivo ficam com atributos subestimados, e a tela avisa.

## 16. Qualquer dataset ou formatos compatíveis

**Pergunta:** "O sistema funciona com qualquer dataset?"

**Resposta sugerida:** Não com qualquer um: com os que cumprem um contrato de colunas. São dois formatos de transações, o do IBM e o equivalente em português. Nome, período e contas podem ser outros, e não há limite de tamanho. Linhas ruins são recusadas com a coluna, um exemplo e como corrigir; nada é inventado. Compatibilidade de formato não garante desempenho, porque o modelo aprendeu com dados sintéticos.

**Conceito essencial:** aceitar o formato é diferente de ser válido para aquela população. Sem rótulos, não há precisão nem recall. Uma análise por vez.

## 17. Tempo real

**Pergunta:** "As análises acontecem em tempo real?"

**Resposta sugerida:** Não. O NodeWatch analisa arquivos: o analista envia, valida e clica em Analisar. Não há fonte ao vivo conectada. Um arquivo de 200 mil transações leva cerca de 45 segundos, e o painel mostra o progresso e as transações conforme são gravadas.

**Conceito essencial:** o horário tem resolução de minuto, e transações do mesmo minuto não se enxergam. Uma versão anterior tinha uma API de eventos em demonstração local; ela saiu na reorganização, porque nunca teve fonte ao vivo.

## 18. Interface, sessão e execução

**Pergunta:** "A interface dispara análises sozinha? O que é a sessão?"

**Resposta sugerida:** Não. Abrir a página só cria uma sessão, uma autorização temporária daquela aba, renovada por um pulso a cada 15 segundos. Validar confere o arquivo, sem gerar previsão. A análise só começa no clique em Analisar e roda no servidor local. Se a aba fechar, sem pulso por 150 segundos a sessão expira e a análise para no próximo ponto seguro, fica parcial e não é retomada sozinha. Sessão não é autenticação, e a linha de comando não passa por ela.

**Conceito essencial:** aba em segundo plano não é sessão encerrada. Pedido de outra origem é recusado com HTTP 403.

# 3 Roteiro de cinco minutos

**Duração estimada, a conferir em ensaio.** As falas têm cerca de 600 palavras, o que dá cerca de 125 por minuto. Adapte as palavras, mas mantenha as ressalvas.

**Como dividir.** Uma pessoa pode fazer tudo. Com duas: até 2:25 e depois disso. Com três: até 1:15, de 1:15 a 2:25, e o restante. Com cinco: juntem os dois primeiros blocos e façam um bloco por pessoa.

## 0:00–0:35: problema e objetivo

> Boa tarde. Somos o Grupo 4, e este é o NodeWatch.
>
> Quem investiga transações financeiras não consegue olhar tudo e precisa decidir por onde começar. O NodeWatch é um protótipo acadêmico que ajuda nessa decisão: ele aponta o que merece atenção primeiro.
>
> Uma ideia guia toda a nossa fala: um alerta do NodeWatch não prova lavagem. Ele é um pedido de atenção. A conclusão continua sendo de uma pessoa, com outras evidências.

## 0:35–1:15: dados e abordagem

> Usamos o IBM AML HI-Small: cinco milhões de transações sintéticas, geradas por um simulador, com cerca de cinco mil marcadas como lavagem de dinheiro.
>
> Juntamos duas ideias. Da teoria dos grafos, vem a visão das contas como vértices e das transações como arestas: quantas contas diferentes cada uma já pagou, se aquele par é novo, para onde o dinheiro seguiu. Do Machine Learning, vem um modelo que aprende, com exemplos, quais combinações desses sinais indicam lavagem.

## 1:15–2:25: funcionamento e caminho de uma análise

> Vamos acompanhar uma análise. Quando o painel abre, ele cria uma sessão, uma autorização temporária daquela aba. Nada é processado ainda.
>
> Escolhemos um arquivo de transações inventadas e validamos. O servidor confere o formato, linha a linha. Das quinze linhas, doze são válidas. Três foram recusadas, com o motivo, e nada foi preenchido.
>
> Só ao clicar em Analisar o trabalho começa. O sistema ordena as transações pelo tempo e calcula 49 atributos para cada uma, como "esse par de contas é novo?" ou "há quanto tempo a conta recebeu dinheiro?". Ele usa apenas o passado. O modelo já treinado dá a nota, que vira um score de 0 a 1000; a partir de 701, surge um alerta. O modelo não muda: aqui não há treino.
>
> Neste exemplo, um repasse com cara de suspeito ficou com 177 e não gerou alerta. E sem alerta não quer dizer seguro.

## 2:25–3:10: modelo e justificativa

> O modelo vem da biblioteca scikit-learn. O NumPy, que é uma biblioteca de cálculo, foi usado para escrever os atributos, não um modelo, e conferimos esse código contra força bruta.
>
> Testamos a regressão logística, que, apesar do nome, é um classificador e serve de referência linear, e dois métodos de árvores. A Random Forest teve o melhor resultado na validação e foi escolhida.
>
> O XGBoost foi medido à parte e não está no sistema: foi promissor, mas ainda falta confirmar. E testamos levar ciclos e outras medidas de grafo para dentro do modelo: não houve ganho, então o grafo ficou na investigação.

## 3:10–4:15: resultados e interpretação

> Agora, os resultados, medidos em dias posteriores ao treino.
>
> Usamos a Average Precision, que mede a qualidade da ordenação. Uma referência pelo formato de pagamento dá 0,006, e o modelo chega a 0,464. No limiar escolhido, 63% dos alertas estavam certos, e 41% da lavagem foi encontrada, com menos de três alarmes falsos a cada dez mil transações.
>
> Há ganho claro sobre referências simples, mas nesses dados sintéticos, e a maior parte dos casos ainda escapa: nos casos sem padrão conhecido, quase todos.

## 4:15–5:00: limitações, próximos passos e encerramento

> Temos limitações importantes. O modelo foi medido só em dados sintéticos, então não sabemos o desempenho em um banco real. O período de teste já foi consultado mais de uma vez, portanto esses números não são inéditos. E não há fonte de dados ao vivo: o que mostramos é uma análise de arquivo.
>
> Nossa prioridade é congelar os candidatos e medi-los uma única vez em um período novo.
>
> O NodeWatch ajuda a priorizar. Quem decide é a pessoa. Obrigado.

## Slides sugeridos

| Slide | Acompanha | Conteúdo | Imagem em `docs/img/` |
|---|---|---|---|
| 1. Problema e dados | 0:00–1:15 | "Alerta não é prova"; HI-Small sintético; grafos + ML | `alerta_investigacao.svg` |
| 2. Caminho de uma análise | 1:15–2:25 | Demonstração ou capturas de reserva | `fluxo_analise.svg`; `apresentacao_demo_analise.jpg`; `apresentacao_demo_resultados.jpg` |
| 3. Modelo | 2:25–3:10 | Random Forest escolhida; HGB e logística candidatas; XGBoost fora do código; grafo de 1 salto | `modelo_unificado.svg` |
| 4. Resultados | 3:10–4:15 | AP, precisão, recall e falsos alertas, sempre ao lado da referência | `divisao_temporal.svg`; tabela do resumo |
| 5. Limites e próximos passos | 4:15–5:00 | Sintético; teste reutilizado; sem fonte ao vivo; prioridade | Sem imagem: texto curto |

## Demonstração opcional, dentro do bloco 1:15–2:25

A ação usa só 15 linhas inventadas: validar e analisar levam menos de um segundo, com a página já aberta. Clique enquanto fala, sem pausar o roteiro, e cronometrem no ensaio.

**Antes da apresentação:**

1. Na máquina da apresentação, clique duas vezes em `iniciar.bat` (ou rode `./iniciar.sh`). Quando o painel abrir, confirme o ponto verde de **Sessão** no topo.
2. Faça uma vez a sequência abaixo, para conferir que tudo responde.

**Durante a fala:**

1. Na vista **Análise**, em *Escolher dataset*, selecione `transacoes_inventadas.csv`. O resumo mostra "12 válidas · 3 recusadas".
2. Clique em **Analisar**. O acompanhamento mostra as cinco etapas e termina em **Análise concluída**.
3. Clique em **Ver resultados** e, na vista **Transações**, mostre **TX-11**: score 177, faixa baixa, sem alerta.

**Não façam ao vivo:** treinar, analisar o HI-Small (leva minutos) ou usar o Sentinel AI com chave real sem ter testado antes.

**Se falhar:** se o servidor não responder em cerca de 10 segundos, vá para o slide 2 com as capturas abaixo e troque "selecionamos" por "nesta captura, selecionamos". O resto da fala continua igual.

![Captura de reserva 1: análise concluída, com as cinco etapas medidas (17/11/2026).](img/apresentacao_demo_analise.jpg)

![Captura de reserva 2: transações da análise, com TX-11 sem alerta (17/11/2026).](img/apresentacao_demo_resultados.jpg)

# 4 Lembretes para o ensaio

1. **Alerta não é fraude.** Saibam explicar score, limiar e alerta. Nunca digam "detectamos fraude" nem "63% de chance de ser lavagem": 63% é a precisão no conjunto de alertas do teste.
2. **NumPy não é modelo.** Saibam explicar o cálculo *point-in-time* e as duas comparações: correção e utilidade.
3. **XGBoost foi medido, não implementado.** Saibam dizer como compará-lo de forma justa. Nunca digam que a troca está decidida.
4. **Sintético e teste reutilizado.** Digam sempre "nos dados sintéticos" e "teste já consultado".
5. **Grafos foram testados no modelo e ficaram na investigação.** Saibam citar o experimento (AP 0,4657 → 0,4691, precisão −2,5 p.p.) e por que o código antigo saiu.

# 5 Apoio: evidências e pontos a confirmar

Esta seção não faz parte das falas. **Repositório de pesquisa** é o clone `AnaliseComplexidade_DeteccaoFraudes`; os demais caminhos são relativos ao NodeWatch.

## 5.1 O que foi conferido para este material, em 17/11/2026

| Conferência | Resultado |
|---|---|
| `python -m pytest -q` | 319 aprovados, 0 falhas |
| Exemplo inventado pelo painel, com o modelo real | 15 lidas, 12 válidas, 3 recusadas, 0 alertas; `tx-011` = TX-11, score 177, bruto 0,0231 |
| Modelo distribuído | `lavagem-20261102T083253Z`, 3,0 MB; scores idênticos aos do arquivo anterior (38,8 MB) em 100 mil linhas aleatórias e em análises de 5 mil e 200 mil transações |
| Análise de 200 mil transações sintéticas pelo painel | concluída, 5.982 alertas, cerca de 45 s |

**Não refeito:** treino, avaliação no teste e comparação com XGBoost. Esses números são evidência salva, com as datas indicadas nos arquivos.

## 5.2 Onde está cada resultado

| Assunto | Arquivo |
|---|---|
| Manual completo do sistema | `docs/COMO_FUNCIONA_O_NODEWATCH.md` |
| AP, precisão, recall, recall por grupo | `modelos/resultados/avaliacao_lavagem.json`; `docs/ml/RELATORIO_ML.md`, seção 1 |
| Candidatos na validação | `modelos/resultados/treino_lavagem.json` |
| Atributos em NumPy e testes contra força bruta | `src/ml/preparacao.py`; `src/ml/incremental.py`; `testes/ml/test_referencia_financeira.py`; `testes/ml/test_incremental.py` |
| Vazamento | `testes/ml/test_financeiro.py` |
| Score 0–1000 e faixas | `src/painel/score.py` |
| Grafos no modelo: experimento e decisão | `docs/decisoes/0001-grafos-e-ml.md`; `pesquisa/atributos_grafo/` |
| HI-Large (XGBoost e mais dados) | `pesquisa/hi_large/RELATORIO_HI_LARGE.md` |
| Auditoria: XGBoost, regras, métricas próprias | Repositório de pesquisa: `auditoria/ml_feedback_professora/` |
| Sessão e expiração | `src/painel/sessoes.py`; `docs/ui/PAINEL_ANALISTA.md` |
| Exemplo inventado | `dados/exemplos/transacoes_inventadas.csv` |

## 5.3 O que confirmar antes da apresentação

1. **O que a professora espera.** Os comentários chegaram por relato. Confirmem se ela espera um modelo escrito em NumPy, se a comparação com uma referência se referia a isso e se ela espera a comparação com GPU.
2. **Como chamar a auditoria.** Ela foi conduzida pelo grupo com apoio de IA, em scripts isolados. Digam "auditoria do grupo, em scripts isolados" e confirmem se a disciplina pede declaração de uso de IA.
3. **Integrantes.** A capa deste material lista cinco pessoas, e o README e o site listam quatro (sem Julia Emily Leonardo Barbosa). Confirmem a composição do grupo e corrijam o que estiver errado.
4. **Máquina da demonstração.** O modelo vem no repositório e é instalado sozinho no primeiro uso, mas o primeiro uso precisa de internet para as bibliotecas. Rodem o `iniciar.bat` antes, na máquina da apresentação, e testem no projetor.
5. **Análises antigas na tela.** A lista **Recentes** mostra as análises gravadas nessa máquina. Decidam se limpam `artefatos_ml/painel/analises/`, com o servidor parado, ou expliquem caso apareçam.
6. **Sentinel AI.** As respostas com chave real não foram testadas depois da revisão do prompt de 17/11. Não o usem ao vivo sem ensaiar.
7. **Duração.** O tempo é uma estimativa. Cronometrem com slides, trocas e demonstração.
