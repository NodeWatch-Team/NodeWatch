# Painel do analista

Página inicial do NodeWatch (`http://127.0.0.1:5000/`), feita para o uso diário de um analista de prevenção à lavagem de dinheiro: enviar ou escolher um dataset de transações, iniciar a análise, acompanhar o processamento e decidir quais transações e contas merecem investigação.

```bash
python src/sentinel_ai.py
```

Na raiz do projeto, com o ambiente virtual ativo. O terminal mostra o endereço do painel na linha `>> Painel do analista: http://127.0.0.1:5000/`; abra-o no navegador. Não precisa de chave de API.

| endereço | o que é |
|---|---|
| `http://127.0.0.1:5000/` | **Painel do analista**: dataset, análise, filtros, contas, grafo e tabela. |
| `http://127.0.0.1:5000/health` | situação do servidor e do Sentinel AI |

A interface antiga (`/legado`: grafos de demonstração, seção de ML antiga, eventos e chat) foi removida em 17/11/2026; ela continua no histórico do Git. Endereços antigos com `/legado`, `#ml` ou `#grafos` não levam mais a lugar nenhum.

O painel não funciona aberto como arquivo (`interface/painel.html` com dois cliques): nesse caso a página explica como abri-lo pelo servidor.

## Identidade visual e design system

Design system "Carbon" (`interface/assets/painel.css`): preto carbono (`#090909`), superfícies grafite em quatro níveis (`#101010` → `#202020`), bordas `#1f1f1f`–`#383838` e o vermelho NodeWatch (`#F04444`, com `#FF6666` para luz e estados interativos) como assinatura. O vermelho marca o que está ativo — item de navegação, ação principal, seleção, progresso, conexões do grafo — e nunca ocupa grandes áreas. A profundidade vem de camadas, reflexo de 1 px no topo dos cartões, sombras longas e luz ambiente vermelha muito difusa no fundo. Um motivo de rede (vértices e conexões em posições fixas, alguns pulsando) fica atrás do conteúdo, em estados vazios, no carregamento e na execução; é decoração pura, sem cliques e escondido de leitores de tela.

| cor | token | uso |
|---|---|---|
| vermelho NodeWatch | `--marca`, `--acao` | ativo, ação principal, seleção, progresso, conexões |
| vermelho com ⚠ | `--alerta` | alerta, faixa alta, caminho com alerta (sempre com "⚠", texto ou fundo tingido) |
| âmbar | `--atencao` | atenção: resultado parcial, linhas recusadas, faixa intermediária |
| verde | `--ok` | sucesso, etapa concluída, faixa baixa |
| ciano | `--info` | aviso informativo |
| amarelo | `--foco` | contorno do foco do teclado |

No grafo, a conta em foco tem contorno duplo branco com halo vermelho e a sequência selecionada é um traço branco animado; o vermelho cheio fica para alerta.

Todos os valores (cores, faixas do score, espaçamento em escala de 4 px, tipografia, raios, alturas de controle, elevação e tempos de transição) são variáveis CSS em `:root`. Tipografia: Inter quando instalada, senão a fonte do sistema; números com algarismos tabulares; identificadores em monoespaçada. Nenhum recurso externo e nenhuma biblioteca nova: os efeitos são CSS e SVG gerado pelo React já vendorizado.

**Textos.** Títulos e rótulos curtos ("Registros no recorte", "Última pontuação", "RAM do processo"); as explicações técnicas ficam em dicas (ícone ⓘ ou ao passar o ponteiro, e no nome acessível), em blocos recolhíveis ou na vista **Detalhes**. Medida ausente aparece como "—", com o motivo na dica.

**Movimento.** Entrada da vista em sequência curta, barras que crescem, marcador do score que desliza, abertura suave de detalhes, diálogos e gavetas, indicador de atividade na execução. Tudo para com `prefers-reduced-motion`; em `forced-colors` os contornos voltam ao padrão do sistema.

A logo é a oficial, `interface/NodeWatchlogo_transparente.png`. Os arquivos servidos são derivados dela só por recorte das margens e redução proporcional: `assets/nodewatch-logo.png` (navegação lateral) e `assets/nodewatch-simbolo.png` (navegação recolhida, topo em tela estreita, carregamento e ícone da aba). Capturas de antes e depois em `docs/ui/capturas/` (tema Carbon em `docs/ui/capturas/carbon/`).

## Sessão da interface

Enviar, validar e analisar exigem a sessão da página (`src/ml/sessoes.py`). A página abre a sessão, guarda-a em `sessionStorage` e manda um pulso a cada 15 s e ao voltar a ficar visível.

- **Janela de expiração: 150 s sem pulso.** Minimizar ou trocar de aba não encerra a sessão: o navegador espaça os pulsos para até 1 por minuto, dentro da janela.
- Sessão expirada ou encerrada: a análise para no próximo ponto seguro (fim do bloco), guarda o que pontuou e fica **parcial**. A validação em curso também para.
- **Nada é retomado sozinho.** Reabrir a página ou reiniciar o servidor só mostra o que ficou gravado.
- Outra aba ativa pode cancelar a análise ou assumi-la com **Manter a análise nesta aba**.
- Consultas (`GET`) não exigem sessão e não iniciam nada.

## Acesso local

`src/seguranca_local.py` vale para todo o servidor. Não há mais `Access-Control-Allow-Origin: *`.

- O cabeçalho `Host` precisa ser local (`127.0.0.1`, `localhost`, `::1` ou o `SENTINEL_HOST` configurado).
- Em `/api`, pedido com `Origin` diferente da do próprio servidor recebe 403 antes de qualquer rota, inclusive a pré-verificação `OPTIONS`.
- Escrita com `Sec-Fetch-Site` `cross-site` ou `same-site` é recusada.
- Pedidos sem `Origin` (curl, scripts locais) continuam aceitos, mas precisam da sessão para processar.
- `NODEWATCH_ORIGENS` libera origens extras de propósito; vem **desligada**. `*` é ignorado.

**Exceção: liberar uma origem extra.** Não é um modo normal de acesso: o painel é aberto em `http://127.0.0.1:5000/` e não precisa de configuração. Se uma página de outra origem precisar mesmo chamar a API (por exemplo, um arquivo aberto do disco, que chega como origem `null`), libere-a **temporariamente**:

```powershell
$env:NODEWATCH_ORIGENS = "null"; python src/sentinel_ai.py
```

```bash
NODEWATCH_ORIGENS=null python src/sentinel_ai.py
```

O terminal confirma com `Origens extras liberadas (NODEWATCH_ORIGENS): null` e mostra um aviso de risco. **Risco:** a origem `null` não é exclusiva dos arquivos do seu computador. Páginas em `iframe` com `sandbox`, de qualquer site aberto no mesmo navegador, também usam `null` e passam a poder chamar a API enquanto a variável estiver ligada.

**Para desligar:** feche o servidor (Ctrl+C) e inicie de novo sem a variável. No PowerShell, a variável continua valendo na mesma janela até ser removida: `Remove-Item Env:NODEWATCH_ORIGENS`. No bash, o formato `NODEWATCH_ORIGENS=null python ...` vale só para aquele comando. Origens externas continuam recusadas mesmo com `null` ligada.

## Fluxo de uso

A navegação lateral separa o painel em vistas; o endereço guarda a vista (`#analise=…&conta=…&vista=…`). No desktop ela pode ser recolhida para só ícones (**Recolher menu**, no rodapé; a escolha fica guardada no navegador). Abaixo de 1024 px vira gaveta, aberta pelo botão ☰. O topo mostra a vista atual, o dataset da análise aberta com o status e a sessão (ponto verde; o detalhe fica na dica). Com uma análise em andamento, um chip mostra a etapa real e o percentual, com uma linha de progresso na borda inferior do topo; o clique leva à vista Análise. A legenda geral fica na vista Detalhes (seção **Legenda**); não há item próprio no menu.

| vista | o que mostra |
|---|---|
| **Análise** | nova análise (envio ou escolha de dataset, validação, **Analisar**), execução ao vivo (faixa com as etapas reais do pipeline) e análises recentes |
| **Visão geral** | leitura do recorte (frases curtas com os números reais), três indicadores (Recorte, Alertas, Score), score e faixas, 5 contas prioritárias (acesso rápido à Investigação), formato de pagamento e tipologias |
| **Investigação** | área de trabalho na altura da tela: contas prioritárias, grafo da conta em foco e o inspetor (leitura, seleção e ordem no tempo) |
| **Transações** | tabela de registros, com linhas expansíveis e detalhes da transação |
| **Detalhes** | lugar único da informação técnica e da legenda: score e metodologia, faixas, conversão, finalidade e limites, definição dos indicadores (com a regra completa das contas prioritárias) e, em análises antigas com tipologias, a descrição delas; depois a **Legenda** (cores e ícones, estados, tabela, sessão e símbolos do grafo). Um índice fixo, agrupado pelas duas seções, abre cada bloco |

**Cada informação tem um lugar principal.** As outras vistas mostram só o necessário para contextualizar e um atalho (por exemplo, "Como ler" leva a Detalhes, "Abrir Operação" leva ao painel operacional). Hierarquia em três níveis: o essencial fica visível; o contexto vem em frases curtas; o técnico fica em dicas, blocos recolhíveis ou em Detalhes.

Visão geral, Investigação e Transações só ficam disponíveis com resultados gravados; o item **Transações** mostra quantos alertas a análise tem (um ponto vermelho com o menu recolhido). Em **Sistema** fica **Operação** (o painel operacional).

1. **Dataset e análise.** Envie um `.csv` (ou `.zip` com um CSV) ou escolha um dataset já disponível. Sem dataset escolhido, o bloco de escolha resume a própria lista: quantos datasets há, quantos foram enviados e quantos estão no servidor, e quantos em cada situação. O servidor valida o arquivo e mostra formato, linhas, contas, período, colunas reconhecidas, moedas e formatos de pagamento. Cada problema traz coluna, linha de exemplo e o que corrigir.
2. **Analisar.** Só o clique em **Analisar**, com um dataset válido, inicia o processamento. Abrir a página, enviar ou validar não analisa nada.
3. **Execução.** Uma coluna só, em duas partes: o **acompanhamento da análise** e, abaixo, o **log da execução** na largura toda. As etapas aparecem uma vez, no acompanhamento (não há lista lateral de etapas nem caixa "Etapas executadas"). Com a análise em andamento, a execução vem antes da nova análise, que fica recolhida em "Outro dataset (a análise continua)". **Cancelar análise** para no fim do bloco atual e mantém o que já foi pontuado. Uma falha de rede passageira durante o acompanhamento não fecha a análise aberta: a leitura seguinte tenta de novo.

   **Acompanhamento da análise** (`AcompanhamentoAnalise` em `painel-secoes.js`; uma fonte de estado: o manifesto, lido a cada 1 s):
   - *Em andamento:* título "Análise em andamento", a etapa atual ("Etapa 3 de 5 · Pontuando transações · 42% da etapa"), o percentual geral (etapas concluídas mais a fração medida da atual, cada etapa pesa igual), uma barra de progresso global, **Cancelar análise** e, abaixo, a linha do tempo das cinco etapas e os números operacionais: **Decorrido** (desde o início gravado no servidor), **Restante** (estimativa da etapa atual, quando há base medida), **Processadas** (com o percentual do total), **Total** (transações válidas) e **Alertas**. O aviso de sessão ("Mantenha esta aba aberta") fecha o cartão.
   - *Linha do tempo das etapas* (`TrilhaEtapas`): as cinco etapas numa linha, cada uma com marca de estado, número e nome, situação e tempo de execução (o gravado no fechamento; na etapa em andamento, o tempo desde o início dela) e, quando houver, o volume medido ("305.397 de 5.078.345 transações") e o detalhe gravado no fechamento (até duas linhas; o texto inteiro na dica). Concluída: marca ✓ e texto verdes. Em andamento: fundo e contorno vermelhos, marca com ponto pulsante, e o fio até a próxima etapa enche com a fração medida. Pendente: discreta. Pulada, erro e cancelada têm marca e cor próprias. Até 720 px, a linha do tempo vira lista vertical (marca e fio à esquerda, textos ao lado) e os números ficam dois a dois.
   - *Depois do fim:* o cartão de conclusão (concluída, cancelada, parcial ou erro) com o sinal do estado, a causa e a ação (erro), a mesma linha do tempo com o tempo de cada etapa, os números (processadas, alertas, duração) e **Ver resultados**.

   Na troca de ordem entre a execução e a nova análise (início e fim da análise), o React recria a seção da nova análise em vez de mover a da execução: mover um nó no DOM zera a rolagem dele sem evento de rolagem, e o log ficava com o topo zerado e a janela virtual no fim da lista.
4. **Recorte.** Um único conjunto de filtros vale para os indicadores, as contas, o grafo e a tabela. A barra do recorte mostra os filtros aplicados como chips; **Editar filtros** abre o formulário completo (que também abre sozinho quando o servidor recusa um valor, com a mensagem junto do campo).
5. **Visão geral, contas e grafo.** Indicadores do recorte, até 10 contas de maior risco e o grafo da conta em foco.
6. **Tabela e detalhes.** Página a página, com seletor de colunas. Por padrão, oito colunas; as demais aparecem ao expandir a linha (›). O ID de exibição abre os detalhes da transação: medidor do score, faixa e alerta em destaque, origem → destino, motivos verificáveis, tipologias e, recolhidos, os dados técnicos do score.
7. **Análises recentes.** Abrem os resultados gravados, sem reprocessar.

A **Legenda** (cores e ícones, estados da análise e do dataset, convenções da tabela, sessão da interface e símbolos do grafo) é a segunda seção da vista **Detalhes**, em blocos recolhíveis, com o mesmo índice fixo da seção Score e metodologia. O que a seção Score e metodologia já explica (score, score original, limiar, alerta e recomendações das faixas) não se repete na Legenda. **Assistente de dúvidas** é um botão fixo no canto inferior direito, visível em qualquer ponto da rolagem; o painel abre acima dele (detalhes em Assistente de dúvidas, abaixo).

## Datasets

Formatos aceitos (definidos em `src/ml/formatos.py`; só transações financeiras):

- `hismall_v1`: cabeçalho original do IBM AML (`Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,Amount Paid,Payment Currency,Payment Format`), com `Is Laundering` opcional.
- `transacao_hismall_v1`: os mesmos campos em português (`id_transacao,timestamp,banco_origem,…`), com `rotulo` opcional. Colunas extras são guardadas e podem ser exibidas na tabela.

O formulário de envio tem um único campo, **Transações** (`.csv` ou `.zip` com um CSV). Não há campo de tipologia nem arquivo de padrões.

**Envio seguro** (`src/painel/datasets.py`):

- sem limite de tamanho imposto pela aplicação, nem na tela, nem na API, nem para o CSV descompactado de um ZIP. A rota `POST /api/painel/datasets` lê o formulário sem o `MAX_CONTENT_LENGTH` do app (que continua valendo para os pedidos JSON, lidos inteiros na memória); o Werkzeug grava a parte do arquivo num temporário em disco e o servidor a copia em blocos de 1 MB. A validação e a leitura da análise seguem em blocos de 200 mil linhas. O teto prático é o espaço em disco (o envio ocupa o dobro do arquivo enquanto é copiado) e, na análise, a memória (ver Processamento);
- o nome enviado vira só um rótulo sanitizado; no disco o arquivo se chama `dados.csv` ou `dados.zip`, em pasta com identificador gerado pelo servidor;
- tudo fica em `artefatos_ml/painel/datasets/`, pasta ignorada pelo git;
- nenhuma rota aceita caminho. Os datasets "do servidor" são descobertos em pastas fixas (`dados/`, `docs/exemplos/`, `artefatos_ml/exemplos/` e o arquivo de `ml_config.local.toml`) e identificados por um código.

**Estados do dataset:** válido; válido com linhas recusadas (elas ficam fora da análise e são listadas); inválido (formato, codificação, colunas obrigatórias ou nenhuma linha válida). Formato de pagamento vazio ou desconhecido é aceito e aparece como "Não informado".

Retenção: ficam guardados os 10 datasets enviados mais recentes.

## Processamento

Etapas reais, medidas no servidor (`src/painel/pipeline.py`):

| etapa | o que faz | progresso |
|---|---|---|
| Leitura e validação | lê o arquivo em blocos de 200 mil linhas e valida cada linha | bytes lidos / total |
| Ordenação cronológica | ordena por data e hora (empate: ordem da linha) e atribui os IDs de exibição | — |
| Atributos, inferência e gravação | em blocos de 20 mil transações: estado incremental por conta, modelo salvo, gravação no SQLite | transações pontuadas / total |
| Índices e contagens gerais | cria os índices dos campos filtráveis | passos |
| Gravação do manifesto | escrita atômica do manifesto final | — |

A estimativa de tempo só aparece depois de 3 s de etapa com algum progresso: restante = o que falta ÷ vazão observada. Fora disso, o campo não existe.

São cinco etapas: não há etapa de tipologias. Manifestos gravados por versões anteriores, que tinham a etapa "Tipologias registradas no dataset", continuam abrindo como foram gravados.

**Memória na análise.** A ordenação cronológica precisa de todas as linhas válidas juntas, então a análise mantém o dataset inteiro num DataFrame durante a ordenação e a pontuação. Sem o antigo limite de envio, um arquivo maior que a memória disponível termina com erro de memória, com causa e ação na tela ("divida o dataset por período"), sem derrubar o servidor nem perder o que já foi pontuado.

Nada é treinado nem reajustado. A pontuação reusa `EstadoFinanceiro` e `pontuar_lavagem`, os mesmos do processamento de eventos. Uma análise por vez.

**Estados da análise:** em andamento; concluída; cancelada (a pedido; vale o que foi pontuado até ali); parcial (interrompida sem pedido, por exemplo servidor reiniciado; vale o que foi processado); erro (com causa e ação sugerida).

### Log da execução (`interface/assets/painel-log.js`)

Consultável durante e depois da análise, enquanto ela estiver aberta. Nenhum valor é fixo nem simulado; o que falta aparece como "—" (nunca 0), com o motivo na dica do bloco.

Um painel na largura toda da seção Execução, em três faixas:

1. **Cabeçalho:** título, **status do acompanhamento** ("Ao vivo · seguindo as mais recentes", "Ao vivo · leitura livre a partir do nº N" quando o analista rolou para cima, "Ao vivo · aguardando o primeiro bloco" ou, depois do fim, "Análise concluída · N transações"), o limiar, a nota do formato, **Como ler as entradas do log** (abre como um quadro sobre a lista, sem empurrar o cabeçalho) e a navegação: **Mais recentes** (quando a lista não está seguindo) e **Posição** + **Ir**.
2. **Faixa de métricas:** as quatro medidas numa linha, separadas por fios (duas a duas em painel estreito), com a hora da leitura no fim. Fica fora da área rolável: não cobre a lista e não precisa recolher em tela estreita.
3. **Lista** das transações pontuadas, rolável.

**Métricas** (rótulo curto e valor; o detalhe técnico, com composição, escopo e horário, fica na dica de cada medida):

| bloco | origem | quando |
|---|---|---|
| Última pontuação | `ultimo_bloco` no progresso da etapa de pontuação (manifesto): total em ms e transações do bloco; atributos, inferência, gravação e `medido_em` na dica | a cada bloco; fica no manifesto depois do fim |
| Log de transações | latência da rota `fluxo de transações` em `GET /operacao/desempenho` (última; mediana embaixo) | depois da primeira consulta |
| RAM do processo | `GET /operacao/desempenho`, em GB, com o percentual da máquina | a cada 2 s, só com a análise em andamento e o log montado |
| RAM do sistema | idem, memória em uso de total | idem |

CPU e o pico de RAM do processo não aparecem no log; continuam no painel operacional (vista **Operação**), que é secundário. RAM **não vai para o manifesto**. O fim da faixa diz em uma linha se a leitura está ao vivo ou falhou (com o horário da última). Depois do fim, a faixa vira uma linha (última pontuação e RAM do processo) com o atalho **Abrir Operação**.

**Lista virtualizada.** `GET /analises/<id>/fluxo?de=&ate=` em janelas de até 200 IDs, cache de 20 páginas, no máximo 1 requisição em voo e respostas de outra análise ignoradas. Altura de linha fixa pela largura do **painel do log** (`--log-linha` no CSS, medida numa sonda; `.log-analise` é um contêiner de consulta, `container: log / inline-size`, então o menu lateral aberto ou recolhido também conta), sobra de 10 linhas acima e abaixo; com 6.000 transações, o DOM teve no máximo 25 entradas. Acima de 8 milhões de pixels de altura, a rolagem fica proporcional (milhões de linhas). "Seguir ao vivo" vem ligado durante a análise, desliga quando o analista rola para cima e volta pelo botão **Ir para as mais recentes** ou ao chegar no fim; **Ir para a posição** leva a um número do fluxo. Sem animação de rolagem. Na rolagem proporcional, sem "seguir ao vivo", a posição de leitura fica ancorada na mesma transação enquanto a lista cresce; **Ir para a posição** deixa a transação pedida no topo da lista e leva o foco até ela. `role="feed"` com `aria-posinset` e `aria-setsize` (-1, "desconhecido", enquanto a análise cresce; o total depois do fim); um único resumo `.sr` polite, no máximo a cada 10 s ou na mudança de etapa ou de status (a lista e os números não têm `aria-live`).

**Rolagem do log e da página.** A lista tem rolagem própria (até 76% da altura da janela, no máximo 980 px), encadeada com a da página: no início ou no fim da lista, a roda do mouse, o touchpad e o toque continuam movendo a página (`overscroll-behavior-y: auto` em `.log-rolagem`; antes era `contain`, que prendia a rolagem no log). Com zoom ou densidade de pixels fracionária, a rolagem por programa ("Seguindo", "Mais recentes") para até ~2 px antes do fim que a roda alcança; um tratador de `wheel` só do contêiner do log passa o giro para a página quando o log está a 2 px ou menos do limite na direção do giro. Na rolagem proporcional, a janela virtual encosta exatamente no fim da lista quando a rolagem chega ao fim, e `.log-lista` tem `overflow: clip`: nenhuma entrada passa do fim da lista nem aumenta a área rolável. No meio da lista, a roda rola o log.

Cada entrada, do principal ao secundário: posição no fluxo (igual ao ID de exibição), ID de exibição (`f.idExibicao(id, contagens.validas)`, "gerado pelo NodeWatch em ordem cronológica; não é o ID do arquivo") e data e hora; a previsão do modelo, com score e faixa ("Com alerta: possível lavagem, para investigação" ou "Sem alerta"); origem e destino (banco e conta); valor e moeda separados, sem conversão, e formato de pagamento; **rótulo do dataset** em bloco próprio, tracejado e com o prefixo escrito ("lavagem", "não lavagem" ou "sem rótulo"). A linha "Tipologia registrada" só existe em análises gravadas por versões anteriores, com arquivo de padrões (as tipologias casadas, com "(registrada no dataset)", ou "Sem classificação"); nas análises atuais ela não aparece e cada entrada tem uma linha a menos (`.log-rolagem.sem-tipologias`). O cabeçalho mostra o limiar ("score 701 (original …)") e, para o formato IBM AML, a nota de dados simulados. Entradas com alerta têm fundo avermelhado e uma faixa vermelha à esquerda.

**Grade da entrada e altura.** A partir de 760 px de painel, cada entrada é uma grade de duas colunas: cabeçalho e previsão na largura toda; origem | destino; valor e formato | rótulo. A primeira coluna tem largura fixa (28rem), então o destino começa no mesmo ponto em todas as entradas. Abaixo de 760 px, uma coluna. A altura fixa foi medida no pior caso (alerta, valor de 16 dígitos com moeda longa, banco de 7 dígitos): 7,2rem no painel largo (6,05rem sem a linha de tipologia, ≈ 85 a 97 px, contra ≈ 143 px quando o log ocupava metade da largura), 9,6rem até 760 px, 10,8rem até 600 px, 12,2rem até 420 px e 14,4rem até 340 px, menos as linhas opcionais ausentes.

**Largura do ID (decisão L4).** O log usa `contagens.validas`, fixo desde a leitura, para a largura não mudar durante a análise. A tabela continua usando `pontuadas`; as duas só diferem num resultado parcial que cruza uma potência de 10 (por exemplo, 999.999 pontuadas de 1.200.000 válidas: TX-0999999 no log, TX-999999 na tabela).

**Precisão e recall** (resumo separado, abaixo do painel do log). Só sobre as transações com rótulo, sempre com "calculado sobre X de Y transações". Durante a análise, vêm de `metricas_parciais` (VP, FP, FN e transações com rótulo, somados pelo pipeline bloco a bloco, logo depois de cada gravação), com o rótulo "parcial: N de M transações"; sem denominador, "ainda sem base (nenhum alerta até agora)" ou "(nenhuma transação rotulada como lavagem até agora)". Depois do fim, vêm de `GET /operacao/metricas?analise=<id>` (contagem no SQLite, fonte oficial); continuam "parcial" se a análise não foi concluída. Sem rótulo: "Não disponível para este dataset". F1, Average Precision e as métricas históricas não aparecem aqui.

**Base usada no treino do modelo** (só exibição, `base_no_treino`; hoje escondida da tela pelo ponto único `EXIBIR`, ver abaixo): "confirmado" quando o SHA-256 do arquivo analisado é igual ao do arquivo de treino (`manifesto.modelo.sha256_treino`, copiado dos metadados do modelo junto com `limites_treino`), com o aviso de que as métricas não medem dados novos; nos outros casos, "não confirmado". A sobreposição de datas não conta como prova: o LI-Small cobre o mesmo mês sem ser o mesmo dado, e o HI-Small enviado como CSV tem hash diferente do ZIP de treino.

**Leituras durante a pontuação.** `/fluxo` não usa `conexao()` (não confere índices nem finaliza o banco): lê pela chave primária só o prefixo `1..pontuadas`, já gravado, e devolve 200 com lista vazia quando não há banco. `/visao`, `/transacoes` e `/grafo` continuam com 409 até o fim. Para o banco sempre terminar em `journal_mode=delete`, a saída do WAL tenta de novo quando uma leitura curta do log está aberta naquele instante; sem isso, uma consulta do log no momento exato da finalização fazia a análise terminar em erro ("database is locked").

## Persistência

- **Manifesto:** `artefatos_ml/painel/analises/<id>/manifesto.json`, com id, dataset, hash SHA-256, datas, status, etapas (a de pontuação com `ultimo_bloco`), duração, versão do modelo (com `sha256_treino` e `limites_treino` quando os metadados os têm), limiar, conversão do score, contagens, `metricas_parciais` (datasets com rótulo), avisos e erros. RAM e CPU não são gravadas. A escrita é atômica (arquivo temporário na mesma pasta e `os.replace`, com novas tentativas no Windows).
- **Resultados por transação:** `resultados.sqlite`, um arquivo por análise.

**Por que SQLite e não JSON.** A tabela, os indicadores, as contas e o grafo filtram, ordenam e paginam no servidor. Um JSON teria de ser lido e percorrido inteiro a cada filtro. Medido com 2.076.752 transações (HI-Small, 01–03/09/2022): arquivo de 636 MB, visão geral em 0,4–1,7 s, página da tabela em 0,1–0,3 s, grafo em 0,1–0,2 s. O SQLite é da biblioteca padrão, grava em blocos durante a pontuação (o parcial fica consultável) e tem índices nos campos filtráveis.

**Retenção:** ficam as 20 análises mais recentes; as mais antigas são apagadas quando uma nova começa (`MAX_ANALISES` em `pipeline.py`).

## Score de 0 a 1000

O modelo devolve `predict_proba` de uma floresta aleatória treinada com subamostragem de negativos: um número de 0 a 1 que **não é probabilidade calibrada**. Na avaliação oficial, transações com valor entre 0,1 e 0,2 foram lavagem em 65% dos casos, e o limiar de alerta é cerca de 0,091. Multiplicar por 1000 colocaria todo alerta na faixa baixa.

A conversão (`src/painel/score.py`) é linear por partes, ancorada no limiar:

| score bruto | score do painel |
|---|---|
| 0 | 0 |
| logo abaixo do limiar | 700 |
| limiar | 701 |
| 1 | 1000 |

O score de 0 a 1000 é um índice, não probabilidade de lavagem nem de fraude. A tela mostra o limiar original (0,0910 no modelo atual) e o trecho do score original de cada faixa: baixa de 0 a 0,0391, intermediária de 0,0391 a 0,0910, alta de 0,0910 a 1.

Consequências testadas: a conversão é monótona; score ≥ 701 equivale exatamente a alerta; scores de modelos com limiares diferentes não são comparáveis entre si (o limiar fica no manifesto). O score bruto aparece nos detalhes.

| faixa | intervalo | recomendação |
|---|---|---|
| Baixa | 0–300 | sugestão de aprovação automática |
| Intermediária | 301–700 | área cinzenta para análise manual |
| Alta | 701–1000 | sugestão de recusa ou bloqueio |

As faixas são recomendações de uma análise offline. O NodeWatch não bloqueia nem paga nada e não tem integração bancária. Score alto é sinal para investigação, não prova.

**Onde a explicação aparece.** A visão geral mostra só o resumo (mínimo, mediano e máximo do recorte e a distribuição pelas três faixas) e um botão **Como ler o score**, que leva à vista **Detalhes**. Lá, em **Interpretação do score**, ficam a explicação completa em blocos recolhíveis (o que o score representa; limiar e faixas, com a escala, o score original de cada faixa e as recomendações; como o score original vira o índice de 0 a 1000; finalidade e limites de uso) e os 13 pontos numerados. Os detalhes de cada transação mostram o score, a faixa, o alerta e o medidor 0–1000, com o atalho **Interpretação do score**. A organização mudou só na tela: conversão, limiar, faixas e alertas continuam vindo de `src/painel/score.py`.

## Tipologias

O painel não recebe mais arquivo de padrões e a análise não tem etapa de tipologias: análises novas não têm tipologias, e a tela não mostra blocos, colunas, linhas do log nem avisos sobre elas.

Análises gravadas por versões anteriores, que receberam o arquivo de padrões, continuam exibindo as tipologias que gravaram (bloco na Visão geral, coluna da tabela, cartão nos detalhes da transação, linha no log, disposição sugerida e contagem no grafo, descrições em Detalhes). Nelas, as tipologias vieram do arquivo de padrões do dataset (rótulo do simulador), nunca do modelo: cada linha do arquivo foi casada com a transação pela chave minuto, conta de origem, conta de destino, valor pago em centavos, moeda e formato; uma transação em mais de uma tentativa conta em cada tipologia, e `padrao_nao_identificado` reúne as transações sem tipologia registrada.

## Filtros, tabela e contas

Filtros: De, Até, Moeda, Alerta (Todos, Com alerta, Sem alerta), Valor mínimo (começa em 1), Banco de origem, Banco de destino, Conta de origem, Conta de destino, Score mínimo e Score máximo (inteiros de 0 a 1000). Não há filtro de valor máximo, motivo, busca nem "amostra de conjunto maior".

**Valor mínimo.** A tela começa com valor mínimo 1, na moeda de cada transação e sem conversão entre moedas. A visão geral mostra quantas transações ficam fora por isso, por moeda. No exemplo de 2.076.752 transações, o padrão deixa 60.401 fora (45.541 em Bitcoin), nenhuma com alerta. Apagar o campo inclui essas transações; valores entre 0 e 1 não são aceitos no campo.

- **Posição:** lugar da linha na lista atual; muda com filtros e ordenação.
- **ID de exibição:** ordem cronológica no dataset inteiro, com empate pela ordem da linha; não muda. O identificador original e a linha do arquivo ficam nos detalhes.
- **Contas de maior risco:** 1º, quantidade de transações com alerta em que a conta participa no recorte; 2º, maior score entre elas; 3º, ordem alfabética. Não existe score por conta.

## Grafo

Área de trabalho da vista **Investigação** (`interface/assets/painel-grafo.js`), dimensionada para caber na tela sem rolar a página: três colunas no desktop — **Contas prioritárias** (lista rolável), o **palco** do grafo e o **inspetor** — com a altura medida em JavaScript do topo do palco até o fim da janela (`useAlturaUtil`, entre 440 e 1400 px; 360 px no celular). Abaixo de 1280 px o inspetor desce para baixo do grafo; abaixo de 1180 px as contas viram uma faixa horizontal acima dele. A legenda completa e a lista de arestas (alternativa em texto) ficam abaixo da área.

- **Tecnologia.** SVG próprio, sem biblioteca. Com os limites do servidor (30 vértices, 60 arestas), o desenho leva menos de 1 ms e cada conta e aresta continua acessível por teclado e leitor de tela; Cytoscape.js ou Sigma.js (canvas/WebGL) só compensariam com milhares de elementos e trariam dependência nova sem ganho visível. O desenho é feito em pixels de tela: o zoom muda as posições, mas texto e setas mantêm o tamanho legível.
- **Enquadramento automático.** O tamanho real do palco é acompanhado com `ResizeObserver`; a câmera calcula os limites do desenho e a escala que faz tudo caber, com folga para rótulos e laços, e centraliza (`enquadrar`). Reenquadra ao trocar de conta, disposição, filtro de relações ou tamanho da janela, até o analista mexer no zoom; **Ajustar à tela** volta ao automático. Controles: ajustar, aproximar, afastar, centralizar (na seleção ou no foco) e tela cheia; Ctrl/⌘ + roda e pinça ampliam no ponteiro; arrastar move; teclado: + e −, 0 para ajustar, setas para mover, Esc limpa a seleção. Toda mudança de câmera é animada (requestAnimationFrame) e imediata com movimento reduzido.
- **Disposições.** Automática por padrão: circular quando a tipologia registrada pede (`CYCLE`, só em análises antigas com tipologias), camadas da esquerda para a direita para até 10 contas, radial acima disso. Também é possível escolher: **radial** (foco no centro, quem enviou à esquerda, quem recebeu à direita, um anel por salto; anéis lotados se desdobram em dois raios), **camadas** (colunas por salto; colunas com mais de 8 contas se dividem), **circular** e **forças** (Fruchterman-Reingold determinístico, sem aleatoriedade). Mudar a disposição só reposiciona as contas; a tipologia nunca é deduzida pela aparência.
- **Grafos grandes.** Acima de 24 contas, as folhas (uma única ligação, à mesma conta e no mesmo papel) viram **grupos expansíveis**; as 8 mais relevantes de cada conjunto continuam visíveis. Contas com alerta só se agrupam entre si. Os rótulos se adaptam ao espaço: completos quando cabem, abreviados ("banco-…final") ou só nas contas essenciais (foco, seleção, ponteiro e as três com mais alertas); valores nas arestas só com até 16 arestas e espaço. O filtro **Relações** (todas, só com alerta, só quem enviou, só quem recebeu) muda só o desenho. Nada é somado entre moedas.
- **Interação.** Selecionar uma conta destaca as conexões dela e o **caminho até o foco** (menor número de saltos), apaga o resto sem esconder e abre no inspetor: conta completa, banco, transações com alerta, maior score nas conexões desenhadas, papel, caminho e as ações **Colocar em foco**, **Transações como origem** e **Transações como destino**. Selecionar uma aresta mostra valor, moeda, horários, ordem no tempo, tipologias e as transações dela.
- **Leitura do recorte.** O inspetor abre com frases curtas montadas só com os números da API: posição da conta na lista de contas prioritárias e quantas transações com alerta ela tem, quantas transações relacionadas têm alerta ("sinal para investigação, não confirmação"), quem enviou e recebeu no desenho, conexões com alerta, sequências com horários compatíveis e quando o desenho é parcial. Os valores por moeda ficam recolhidos ali.
- **Movimento com significado.** Ao abrir, as contas saem da conta em foco; ao trocar de foco, as contas que continuam deslizam e as novas acendem; ao expandir um grupo, as contas saem dele. Um pulso percorre as arestas com alerta no sentido do dinheiro quando elas são até 12 (com mais, e sempre que há seleção, só nas destacadas); a conta em foco tem um halo que respira. Em tela cheia, a lista de contas sai e o inspetor fica ao lado do grafo, rolando por dentro. Tudo para com `prefers-reduced-motion`.
- **Ordem no tempo.** Cada aresta mostra valor, moeda e horário (ou intervalo, se agrupada). Uma relação indireta só é marcada como sequência quando há transação em minuto posterior à chegada do dinheiro na conta intermediária (ou anterior à saída, no caminho até o foco). Mesmo minuto ou fora de ordem aparece tracejado, como "relação do recorte sem ordem temporal confirmada". As sequências confirmadas ficam no inspetor e podem ser destacadas (os grupos que as escondem se abrem). Horário compatível não prova que é o mesmo dinheiro.
- O grafo usa os filtros de período, moeda, alerta, valor, bancos e score. Os filtros de conta escolhem a conta em foco. Limites: 30 vértices, 60 arestas e 300 contas expandidas por salto; o palco informa "exibindo X de Y transações relacionadas".

## Painel operacional

Abre como gaveta à direita pelo item **Operação** da navegação; Esc ou o fundo escurecido fecham. É o lugar principal de logs, métricas de execução, latência, RAM e estado do processo: o log da execução, na vista Análise, mantém os quatro blocos ao vivo só enquanto a análise roda; depois do fim, vira uma linha com **Abrir Operação** (a Operação mostra o processo agora e a análise ativa ou a última encerrada).

- **Resumo no topo:** estado do processo ("Analisando", com a etapa e o dataset, ou "Disponível"), sessão e quatro indicadores — RAM do processo, RAM do sistema, CPU do processo e última latência. A leitura (`/operacao/desempenho`) é feita a cada 3 s só com a gaveta aberta; o ponto pulsa apenas quando chega uma leitura nova, e as mini barras de RAM e CPU mostram as últimas leituras reais desta sessão (até 24; nada é inventado).

- **Desempenho:** RAM e CPU do processo do NodeWatch e da máquina (lidas do sistema operacional pela biblioteca padrão), latência de cada consulta em ms, e, da análise ativa ou da última, duração, pico de memória e duas vazões com a fórmula: a da análise inteira (pontuadas ÷ duração total) e a só da pontuação (pontuadas ÷ tempo de atributos, inferência e gravação). No exemplo de 2.076.752 transações: 88,6 s no total, cerca de 23,4 mil por segundo; 47,2 s de pontuação, cerca de 44 mil por segundo.
- **Logs do sistema** e **Logs de ML:** em `artefatos_ml/painel/logs/`. Não guardam contas, linhas do dataset, chaves nem caminhos.
- **Métricas de ML:** precisão, recall, F1 e Average Precision da avaliação histórica (`artefatos_ml/resultados/avaliacao_lavagem.json`), com origem, data e conjunto. Ficam separadas das contagens da análise atual. Métricas do dataset aberto só aparecem quando ele tem rótulo.

## Assistente de dúvidas (tecnologia Sentinel AI)

Para o usuário, o assistente se chama **Assistente de dúvidas** (botão fixo no canto inferior direito; o nome não muda). Por dentro, ele usa o **Sentinel AI**: o prompt de sistema, os modos de linguagem (simples ou técnica) e os provedores (Gemini por padrão; Anthropic com `SENTINEL_PROVIDER=anthropic`) estão em `src/sentinel_ia.py`.

**Dois modos, um só assistente** (`POST /api/painel/assistente`):

| Modo | Quando | O que sai do computador |
|---|---|---|
| **Local** (padrão) | sem autorização na tela, sem `GEMINI_API_KEY`, ou se o provedor falhar | nada: responde com o glossário, a ajuda e os números gravados (`src/painel/assistente.py`) |
| **Sentinel AI** | o usuário marca "Permitir que o Sentinel AI use o contexto desta análise" (vale só para a aba) e há chave | a pergunta, o histórico da conversa e o contexto verificado descrito abaixo |

**Contexto verificado** (`src/painel/contexto_sentinel.py`), montado no servidor a partir do que a tela já mostra: manifesto da análise; indicadores do recorte com os filtros atuais; contas de maior risco; até 10 transações com alerta de maior score (contas, valores, datas, scores, motivos); a transação aberta nos detalhes, quando o usuário clica em **Perguntar ao Assistente de dúvidas sobre esta transação**; dados do modelo (versão, limiar, critérios e as **importâncias globais** da floresta); métricas do teste oficial; e uma lista de limites. Não envia o arquivo do dataset, as demais transações, a chave nem caminhos da máquina. Enviar dados a um serviço externo exige a sessão ativa da aba.

**Fatos × inferências × hipóteses.** O bloco `PROMPT_PAINEL` obriga a resposta a separar **Fatos** (só o que está no contexto), **Inferências**, **Hipóteses** e **Limitações**. O modelo é uma floresta aleatória e não grava explicação por transação: perguntas como "por que esta transação foi classificada como suspeita?" são respondidas com o score, o limiar e os motivos verificáveis (fatos sobre a transação, não a explicação do modelo); as importâncias globais aparecem como informação sobre o modelo, nunca como "o que pesou nesta transação"; e o que não dá para saber é dito explicitamente.

Respostas do Sentinel AI aparecem com um traço ciano, o motor usado, a base enviada e o aviso de que foram geradas por IA.

**Contexto da tela (3.0).** Abaixo do título, uma barra separa o que **vai com a pergunta** (filtros do recorte, tamanho do recorte e a transação em contexto) do que é **só da tela** (vista atual e conta em foco: o servidor não recebe essas duas, e a barra diz isso). As **perguntas sugeridas** mudam por vista e foram conferidas no modo local (nenhuma cai em "não tenho base"). O bloco recolhível **Na tela agora** traz até três frases montadas pela própria página com os dados já carregados ("Calculado pela tela… não é resposta do assistente"); nunca entra no histórico enviado. Ao abrir outra análise, a conversa anterior é apagada. Enquanto a pergunta está no servidor, três pontos animados indicam a consulta.

**Posição do botão.** O botão **Assistente de dúvidas** é fixo no canto inferior direito (16 px das bordas; 10 px e rótulo curto "Dúvidas" até 720 px de largura). Ele fica fora do topo e do `<main>`: não depende da rolagem, não é cortado por `overflow`, e o `<main>` tem folga embaixo para o botão não cobrir o fim do conteúdo. O painel abre acima do botão; o topo do painel rola por dentro e as sugestões ficam numa linha com rolagem lateral, para o campo de pergunta ficar sempre visível (verificado em 1440×900, 1366×768, 1024×768, 768×1024, 390×844 e 320×640). Numa versão intermediária o botão foi para o topo; o pedido de 13/11/2026 o devolveu ao canto.

**Estado da conexão.** Abaixo do título, um selo mostra o estado real: *Modo local (Sentinel AI desligado)*, *Sentinel AI: conexão não verificada*, *Sentinel AI conectado* ou *Sentinel AI indisponível: motivo*. **Testar conexão** faz uma chamada mínima ao provedor (`POST /assistente/verificar`).

**Falhas.** Se o provedor falhar, o erro é classificado (chave inválida, limite, tempo esgotado, sem conexão, serviço indisponível etc., ver `docs/SENTINEL_AI.md`) e **não** aparece como "pergunta fora da base". Se o modo local tem resposta, ela vem com o aviso do motivo; senão, a resposta diz que o Sentinel AI não respondeu. A pergunta fica guardada e a mensagem ganha **Tentar de novo**. O detalhe técnico fica nos logs do sistema (evento `assistente_sentinel_falhou`, chave mascarada, sem a pergunta e sem dados de contas).

## API

Todas as rotas em `/api/painel` (`src/api_painel.py`):

| rota | uso |
|---|---|
| `GET /estado` | modelo, limites, legendas, análise em andamento |
| `GET /datasets`, `POST /datasets`, `GET /datasets/<id>`, `POST /datasets/<id>/validar` | catálogo, envio e validação |
| `GET /analises`, `POST /analises`, `GET /analises/<id>`, `POST /analises/<id>/cancelar` | histórico, início, manifesto e cancelamento |
| `GET /analises/<id>/fluxo?de=&ate=` | log da execução: transações gravadas de `de` a `ate` (até 200), também durante a análise |
| `GET /analises/<id>/visao` | indicadores e contas do recorte |
| `GET /analises/<id>/transacoes`, `GET /analises/<id>/transacoes/<n>` | página da tabela e detalhes |
| `GET /analises/<id>/grafo` | grafo da conta em foco |
| `GET /operacao/desempenho`, `/operacao/logs`, `/operacao/metricas` | painel operacional |
| `POST /assistente` | Assistente de dúvidas: modo local ou Sentinel AI com o contexto da análise (com autorização) |
| `POST /assistente/verificar` | testa a conexão com o provedor agora; devolve o estado (`conectado`, `falhou` com a categoria, `nao_configurado`) |

## Revisão de aceitação (11/11/2026)

Tudo abaixo foi executado nesta revisão, no Chrome (versão instalada nesta máquina), com arquivos pequenos. Os datasets grandes não foram reprocessados.

| verificação | como | resultado |
|---|---|---|
| Larguras 320, 390, 768, 1280 e 1440 px | Chrome sem janela; estados vazio, erro, resultados e alertas | sem rolagem horizontal da página, sem estouro, sem texto cortado e sem sobreposição no topo (depois das correções abaixo) |
| Carregamento | rede desacelerada (800 ms por pedido) | "Abrindo o painel e a sessão desta página…", anunciado como status |
| Aba em segundo plano | Chrome **com janela**, servidor real (150 s), janela minimizada por 400 s | `visibilityState=hidden`; o Chrome espaçou os pulsos para 1 por minuto; a sessão continuou ativa o tempo todo |
| Aba fechada | mesmo teste, uma segunda aba fechada | sessão dela expirou entre 140 e 150 s depois |
| Página fechada no meio da análise | Chrome com janela + servidor de teste com o código real, sessão de 20 s e modelo desacelerado, em pasta temporária | a análise parou 20 s depois, ficou parcial (233 de 394) e não recomeçou ao reabrir a página |
| Teclado | Tab, Enter, Espaço, setas e Esc reais | envio pelo seletor de arquivos, validação, análise, filtros, tabela, detalhes, contas, grafo, painel lateral e dataset do servidor, todos sem mouse |
| Leitura pelo sistema | UI Automation do Windows (a interface que o Narrador consome), Chrome com janela | 1.260 elementos; nenhum botão, campo, seletor, aba ou imagem sem nome; arestas lidas com origem, destino, valor, moeda, horário e alerta |
| Origem e CORS | curl contra o servidor real | origem externa: 403 em GET, POST e na pré-verificação; `Host` externo: 403; nenhuma resposta com `Access-Control-Allow-Origin` |
| `index.html` (interface antiga) como arquivo | Chrome sem janela, `file://` | sem a variável, a seção de ML diz "servidor indisponível"; com `NODEWATCH_ORIGENS=null` (exceção temporária), carrega e abre sessão; origem externa continua 403 |

Leitor de tela: o Narrador existe nesta máquina, mas não foi ligado. Ele fala em voz alta e assume o teclado da área de trabalho, e a fala não pôde ser ouvida nesta revisão. A leitura por tecnologia assistiva **não está confirmada**; o que foi confirmado é o que o sistema entrega a ela (UI Automation e árvore de acessibilidade do Chrome).

Correções feitas na revisão:

- **Rolagem horizontal em telas estreitas.** Em 320 e 390 px, a página ficava com 634 px de largura. As grades de uma coluna cresciam até a largura da opção mais longa do seletor de dataset (72 caracteres) e as de várias colunas tinham mínimo fixo (`minmax(320px, 1fr)`).
- **Carregamento.** A página ficava em branco enquanto abria a sessão.
- **Rótulos da escala do score.** Em 320 px, ficavam cortados.
- **Botão do assistente.** Em tela estreita, cobria o texto ao lado de **Analisar**; agora fica compacto ("Dúvidas") e a página ganha folga no fim.
- **Painel aberto como arquivo.** Dizia "servidor indisponível" mesmo com o servidor ligado; agora explica como abrir.

## Estabilização (11/11/2026)

Uso normal conferido do começo ao fim, com arquivos pequenos e sem reprocessar datasets grandes:

| fluxo | resultado |
|---|---|
| `python src/sentinel_ai.py` | o terminal mostra `>> Painel do analista (use este): http://127.0.0.1:5000/` e a interface antiga em seguida, identificada como antiga |
| `/` | painel do analista, sem erros no console |
| `/legado`, `/#ml`, `/#ml/eventos`, `/#grafos` | interface antiga, com a faixa de aviso e o link para `/`; o link leva ao painel |
| Envio de `com_linhas_ruins.csv` (399 linhas) pela tela | validação com 394 válidas e 5 recusadas listadas; análise concluída; valor mínimo 1 deixou 5 fora do recorte; filtros, tabela, detalhes, grafo e painel lateral funcionando |
| Dataset do servidor `docs/exemplos/transacoes_inventadas.csv` | validação (12 válidas, 3 recusadas) e análise concluída; grafo de `MERCADO1` mostra a ida e volta `MERCADO1 → NOVA0001 → MERCADO1` como sequência |
| Alertas | conferidos na análise já gravada (571 alertas): linhas com faixa e "⚠ Sim", detalhe com score 706 e limiar 0,0910, grafo com arestas vermelhas. Os dois arquivos pequenos não geram alertas (score máximo 177) |
| Carregamento, erro, cancelamento e fim de sessão | texto de carregamento anunciado; arquivo com colunas erradas recusado com a correção indicada; cancelamento deixa resultado parcial; página fechada no meio da análise deixa resultado parcial; nada recomeçou sozinho |
| Segurança | origem externa e `null` recebem 403 (leitura, escrita e pré-verificação); `Host` externo, 403; nenhuma resposta com `Access-Control-Allow-Origin` |

Cancelamento e fim de sessão foram testados num servidor de teste com o código real, pasta temporária, sessão de 20 s e modelo desacelerado, para a análise durar o suficiente. O prazo real de 150 s foi conferido antes, numa aba fechada sem análise rodando.

Correção feita: sequências que voltam à conta em foco eram marcadas como sequência na aresta, mas não apareciam na lista (o resumo dizia "horários compatíveis" e a lista ficava vazia).

## Log da execução: verificação (15/11/2026)

Feita no navegador do aplicativo (Chromium), num servidor de teste com o código real, pasta temporária, modelo de teste desacelerado e um dataset sintético de 6.000 transações em formato IBM AML, com rótulo, arquivo de padrões e valores longos de propósito (bancos de 7 dígitos, contas de 9 caracteres, "Australian Dollar", "Reinvestment", duas tipologias na mesma transação). O painel do navegador estava oculto, o que pausa `requestAnimationFrame`; para medir a rolagem, a página usou um substituto do rAF só durante a medição.

| verificação | resultado |
|---|---|
| Larguras 320, 390, 481, 720, 721, 768, 980, 981, 1240, 1241, 1280 e 1440 px | duas colunas iguais a partir de 981 px, uma até 980 px; sem rolagem horizontal; as 6.000 entradas percorridas em cada largura, nenhuma com texto passando da altura da linha (folga mínima de 13 px) |
| DOM da lista | no máximo 25 entradas para 6.000 transações; no meio da lista, posições 2.990–3.013 |
| Em andamento | segue ao vivo; RAM, CPU e latências atualizando a cada 2 s; precisão e recall com "parcial: N de 6.000"; Cancelar e aviso de sessão visíveis; anúncio para leitor de tela no máximo a cada 10 s |
| Fim | polling parado com "última leitura durante a análise"; precisão e recall finais iguais aos da contagem no SQLite; pico de RAM da pontuação |
| Reaberta do histórico | RAM, CPU e latência do log como "indisponível (medidas ao vivo só existem durante a análise)"; último bloco e pico continuam |

Não verificados nesta rodada: NVDA (fala), `forced-colors` e `prefers-reduced-motion` no navegador (as regras estão no CSS), e o HI-Small completo com o log aberto e fechado (comparação de `vazao_transacoes_por_s`).

## Evolução 3.0 — inteligência visual (16/11/2026)

- **Investigação:** o grafo virou uma área de trabalho na altura da tela, com enquadramento automático, quatro disposições, grupos expansíveis, rótulos adaptativos, caminho até o foco, tela cheia e o inspetor com a leitura do recorte (ver **Grafo**). Antes, numa conta com 30 vértices, o SVG tinha 910 px de altura e começava a 510 px do topo, e a página precisava de 1.911 px; agora, em 1440×900, o palco termina antes do fim da janela, e o mesmo vale em 1024×768 e no celular, sem rolagem horizontal. Capturas em `docs/ui/capturas/vivo/`.
- **Informação sem cópias:** o ranking de contas tem um nome só (**Contas prioritárias**: 5 na Visão geral como acesso rápido, 10 na Investigação); score mínimo/mediano/máximo, alertas e registros aparecem uma vez na Visão geral; a regra completa das contas, a interpretação do score e as descrições das tipologias ficam só em Detalhes; símbolos e cores ficam só na Legenda, a segunda seção de Detalhes; RAM, CPU e latência ficam em Operação; nome e status do dataset ficam no topo.
- **Estados reais do pipeline:** a execução mostra uma faixa com as etapas do manifesto (leitura, ordenação, pontuação — "Carregando o modelo" até o primeiro bloco, depois "Pontuando transações" —, índices e manifesto), um tique a cada bloco gravado (`ultimo_bloco.medido_em`), contadores que sobem até o valor real e um cartão de conclusão (concluída, parcial, cancelada ou erro, com causa e o que fazer). Nenhuma etapa fictícia: atributos, inferência e gravação acontecem dentro de cada bloco e aparecem só como tempos do último bloco.
- **Acabamento:** indicador ativo do menu, topo com vidro discreto e linha de luz, cartões com hierarquia tipográfica, tabelas com separadores finos e marcador vermelho nas linhas com alerta, luz ambiente vermelha muito lenta no fundo. Tudo para com `prefers-reduced-motion`.
- **Sem dependências novas** e sem mudança no modelo, nas features, no pipeline, no score, no limiar, nos dados, no backend ou na API.

## Testes

```bash
python -m pytest testes/painel -q
```

177 testes em `testes/painel/`: score e faixas, envio e validação, pipeline (progresso, cancelamento, parcial, erro, manifesto, reabertura), resultados (filtros sincronizados, denominadores, IDs, tipologias, top 10, grafo), API (legendas, métricas, logs, assistente), sessão e acesso local, ordem temporal, valor mínimo, vazões as regressões de interface (`test_interface_revisao.py`) e as rotas, mensagens de início e origens (`test_rotas_e_inicio.py`). A suíte inteira (`python -m pytest testes -q`) tem 385 testes.

### O que a tela mostra: ponto único `EXIBIR`

`interface/assets/painel-base.js` tem a constante `EXIBIR` (exportada em `window.NW`, com `NW.exibir(chave)`). Com `false`, o item some só da interface (texto, rótulo, coluna, cartão, legenda, aviso, controle, anúncio para leitor de tela e `title`); coleta, leitura do arquivo, SQLite, manifesto, rotas e campos da API, cálculos e logs continuam iguais. Para voltar a mostrar, troque para `true`.

| Chave | Hoje | O que esconde |
|---|---|---|
| `rotulo` | `false` | Rótulo do dataset no resumo, na visão geral, na coluna da tabela, nos detalhes, na Legenda (em Detalhes), na entrada do log e na evidência de não calibração. Precisão e recall continuam visíveis, com redação neutra ("conferíveis", "casos de referência"): `TEXTO_METRICAS` em `painel-log.js`. |
| `coluna_rotulo` | `false` | A coluna de rótulo (Is Laundering) em "Colunas reconhecidas" e no contador. Ela não é atributo do modelo. |
| `base_treino` | `false` | A marcação "Base usada no treino do modelo" no log e nas métricas do painel operacional. As métricas de um dataset de treino (o HI-Small inteiro) aparecem sem essa ressalva. |
| `fuso` | `false` | A nota de fuso ao lado do período do dataset. Datas, filtros e ordenação não mudam (minuto em UTC ingênuo). |

Testes: `testes/painel/test_exibicao.py` (estático e, com Node instalado, executando os scripts ligado e desligado).

## Limitações

- **Histórico das contas.** O modelo usa o que cada conta fez antes; o painel só conhece o que está no próprio dataset. Nas primeiras 72 horas do período ele tende a gerar menos alertas (a tela avisa).
- **Memória.** O dataset validado fica em memória durante a análise. Medido: pico de 2,2 GB no processo com 2,08 milhões de linhas.
- **Uma análise por vez**, sem pausa e retomada: uma análise interrompida (cancelada ou com a sessão expirada) recomeça do zero.
- **Acessibilidade:** conferida por teclas reais, contraste calculado, árvore de acessibilidade do Chrome e UI Automation do Windows. A fala de um leitor de tela (NVDA, Narrador) não foi ouvida.
- **Aba em segundo plano por muito tempo:** testada por 400 s. Se o navegador congelar a aba (economia de energia ou de memória), os pulsos param e a sessão expira; a análise fica parcial, como numa aba fechada.
- **PDFs desatualizados:** `docs/COMO_FUNCIONA_O_NODEWATCH.pdf` e `docs/APRESENTACAO_NODEWATCH.pdf` não foram regerados e ainda mostram os endereços antigos (`/#ml…`), que continuam funcionando pelo redirecionamento.
- **Sem tempo real e sem retomada:** o painel analisa arquivos; não processa transações ao vivo nem continua uma análise interrompida.
- **Grafo em tela estreita:** em 320 e 390 px, o grafo rola dentro da própria moldura (largura mínima de 660 px).
- **Tema:** só o escuro; a logo tem "Node" em branco e não serve a fundo claro.
- **Fuso horário.** O dataset não documenta o fuso; as datas são exibidas como estão no arquivo.
- **Só transações financeiras.** Arquivos em outros formatos são recusados, com a lista das colunas que faltam.
