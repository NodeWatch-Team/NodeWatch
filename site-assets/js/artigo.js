/* NodeWatch · roteiro técnico
   Componentes interativos em React 18: simulador do score (bloco 3), pipeline (bloco 4) e abas do painel (bloco 5).
   React e ReactDOM vêm de ./site-assets/vendor (UMD, sem build e sem CDN).
   Se o React não carregar, a versão estática de cada alvo continua visível.
   Fontes dos números: src/painel/score.py, src/painel/pipeline.py, interface/assets/painel-grafo.js. */
(function () {
  "use strict";

  if (!window.React || !window.ReactDOM || !window.ReactDOM.createRoot) return;

  var React = window.React;
  var h = React.createElement;
  var useState = React.useState;
  var useRef = React.useRef;

  function montar(id, Comp) {
    var alvo = document.getElementById(id);
    if (alvo) window.ReactDOM.createRoot(alvo).render(h(Comp));
  }

  function num(x, casas) {
    return x.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  }

  /* Abas acessíveis (setas, Home e End), usadas no pipeline e no painel. */
  function Abas(props) {
    var _a = useState(0), ativa = _a[0], setAtiva = _a[1];
    var botoes = useRef([]);
    var itens = props.itens;

    function teclado(e) {
      var n = itens.length, prox = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") prox = (ativa + 1) % n;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") prox = (ativa - 1 + n) % n;
      else if (e.key === "Home") prox = 0;
      else if (e.key === "End") prox = n - 1;
      if (prox === null) return;
      e.preventDefault();
      setAtiva(prox);
      if (botoes.current[prox]) botoes.current[prox].focus();
    }

    var atual = itens[ativa];
    return h("div", { className: "abas " + (props.classe || "") },
      h("div", { className: "abas-lista", role: "tablist", "aria-label": props.rotulo, onKeyDown: teclado },
        itens.map(function (a, i) {
          var sel = i === ativa;
          return h("button", {
            key: a.id, type: "button", role: "tab", id: props.prefixo + "-aba-" + a.id,
            "aria-selected": sel ? "true" : "false", "aria-controls": props.prefixo + "-painel",
            tabIndex: sel ? 0 : -1, className: "aba" + (sel ? " ativa" : ""),
            ref: function (el) { botoes.current[i] = el; },
            onClick: function () { setAtiva(i); }
          },
            props.numerar ? h("span", { className: "aba-num" }, i + 1) : null,
            h("span", { className: "aba-textos" },
              h("span", { className: "aba-rotulo" }, a.rotulo),
              a.curto ? h("span", { className: "aba-curto" }, a.curto) : null));
        })),
      h("div", { className: "aba-painel", role: "tabpanel", id: props.prefixo + "-painel",
        "aria-labelledby": props.prefixo + "-aba-" + atual.id, tabIndex: 0, key: atual.id },
        atual.conteudo()));
  }

  /* ---------- Bloco 3 · Simulador do score ---------- */

  var LIMIAR = 0.0910; // limiar do modelo (máximo F1 na validação)

  var FAIXAS = [
    { id: "basal", nome: "Baixa", de: 0, ate: 300,
      leitura: "Compatível com o histórico. Sem prioridade de investigação." },
    { id: "observacao", nome: "Intermediária", de: 301, ate: 700,
      leitura: "Abaixo do limiar, mas perto dele. Vale revisar se outras evidências apontarem para a conta." },
    { id: "alerta", nome: "Alta (alerta)", de: 701, ate: 1000,
      leitura: "Passou do limiar do modelo: a transação sobe para o topo da fila do analista." }
  ];

  function faixaDe(score) {
    for (var i = 0; i < FAIXAS.length; i++) if (score <= FAIXAS[i].ate) return FAIXAS[i];
    return FAIXAS[FAIXAS.length - 1];
  }

  /* Inverso da conversão de src/painel/score.py (linear por partes, ancorada no limiar). */
  function brutoDe(score) {
    if (score >= 701) return LIMIAR + ((score - 701) / 299) * (1 - LIMIAR);
    return (score / 701) * LIMIAR;
  }

  function Simulador() {
    var _s = useState(520), score = _s[0], setScore = _s[1];
    var f = faixaDe(score);
    function atalho(v) { return h("button", { type: "button", className: "atalho", onClick: function () { setScore(v); } }, v); }

    return h("div", null,
      h("div", { className: "simulador faixa-" + f.id },
        h("div", { className: "sim-topo" },
          h("div", null,
            h("p", { className: "sim-score mono", "aria-live": "polite" }, score, h("small", null, " / 1000")),
            h("p", { className: "sim-faixa" }, f.nome)),
          h("dl", { className: "sim-dados" },
            h("div", null, h("dt", null, "Valor do modelo"), h("dd", { className: "mono" }, "≈ " + num(brutoDe(score), 4))),
            h("div", null, h("dt", null, "Limiar"), h("dd", { className: "mono" }, num(LIMIAR, 4))))),
        h("div", { className: "regua", "aria-hidden": "true" },
          h("span", { className: "regua-faixa r-basal" }),
          h("span", { className: "regua-faixa r-observacao" }),
          h("span", { className: "regua-faixa r-alerta" }),
          h("span", { className: "regua-marcador", style: { left: (score / 10) + "%" } })),
        h("div", { className: "regua-rotulos mono", "aria-hidden": "true" },
          h("span", null, "0"), h("span", null, "300"), h("span", null, "700"), h("span", null, "1000")),
        h("label", { className: "controle" },
          h("span", null, "Arraste para simular um score"),
          h("input", { type: "range", min: 0, max: 1000, step: 1, value: score,
            onChange: function (e) { setScore(Number(e.target.value)); },
            "aria-valuetext": score + ", " + f.nome })),
        h("div", { className: "atalhos" }, h("span", null, "Exemplos:"), atalho(150), atalho(520), atalho(700), atalho(701), atalho(880)),
        h("p", { className: "sim-leitura" }, f.leitura)),
      h("div", { className: "faixas-lista" }, FAIXAS.map(function (x) {
        return h("article", { key: x.id, className: "faixa-item faixa-" + x.id + (x.id === f.id ? " ativa" : "") },
          h("p", { className: "mono" }, x.de + "–" + x.ate),
          h("h4", null, x.nome),
          h("p", null, x.leitura));
      })));
  }

  /* ---------- Bloco 4 · Pipeline ---------- */

  var ETAPAS = [
    { id: "ingestao", rotulo: "Ingestão e validação", curto: "CSV ou ZIP",
      faz: "Lê o .csv ou .zip em blocos de 200 mil linhas e confere o contrato de colunas: formato IBM AML ou colunas em português. Não pede rótulo nem arquivo de tipologias.",
      itens: ["Linhas inválidas ficam fora e são contadas, com a coluna, um exemplo e como corrigir.", "Nada é corrigido nem preenchido.", "O modelo só é carregado se o SHA-256 conferir com o manifesto."],
      mede: "bytes lidos" },
    { id: "ordem", rotulo: "Ordenação cronológica", curto: "sem olhar o futuro",
      faz: "Ordena por minuto e, no empate, pela ordem da linha. Cada transação recebe um ID de exibição (TX-n).",
      itens: ["A janela de cada transação é [t − w, t): o próprio minuto fica de fora.", "Duas transações no mesmo minuto não enxergam uma à outra."],
      mede: "concluída de uma vez" },
    { id: "pontuacao", rotulo: "Atributos e pontuação", curto: "Random Forest",
      faz: "Em blocos de cerca de 20 mil transações: calcula os 49 atributos com o estado de cada conta, aplica o Random Forest e converte o valor em score de 0 a 1000.",
      itens: ["Score ≥ 701 vira alerta, com motivos verificáveis (par novo, repasse em menos de 60 min…).", "O estado das contas avança; o modelo não muda.", "Cancelar para no próximo bloco; o que já foi pontuado fica gravado."],
      mede: "transações pontuadas" },
    { id: "indices", rotulo: "Índices no SQLite", curto: "consulta local",
      faz: "Cria os índices dos campos filtráveis e as contagens gerais no banco SQLite da análise.",
      itens: ["Filtrar, ordenar e paginar consultam o que foi gravado, sem nova inferência.", "Tudo fica em artefatos_ml/painel/analises/<id>/."],
      mede: "passos" },
    { id: "manifesto", rotulo: "Manifesto e liberação", curto: "painel pronto",
      faz: "Grava o manifesto da execução (status, tempos por etapa, versão do modelo, limiar, avisos) e libera os resultados no painel.",
      itens: ["Os resultados continuam disponíveis depois de reiniciar o servidor.", "O painel guarda as 20 análises mais recentes."],
      mede: "concluída de uma vez" }
  ];

  function Pipeline() {
    return h(Abas, { prefixo: "pipe", rotulo: "Etapas da análise", numerar: true, classe: "abas-pipeline",
      itens: ETAPAS.map(function (e, i) {
        return { id: e.id, rotulo: e.rotulo, curto: e.curto, conteudo: function () {
          return h("div", { className: "etapa-detalhe" },
            h("p", { className: "etapa-passo mono" }, "Etapa " + (i + 1) + " de 5 · progresso medido em " + e.mede),
            h("p", { className: "aba-lead" }, e.faz),
            h("ul", { className: "lista-curta" }, e.itens.map(function (t) { return h("li", { key: t }, t); })));
        } };
      }) });
  }

  /* ---------- Bloco 5 · Abas do painel ---------- */

  function Captura(props) {
    return h("figure", { className: "tela" },
      h("button", { className: "tela-abrir", type: "button", "aria-label": "Ampliar imagem: " + props.alt,
        onClick: function (e) {
          var img = e.currentTarget.querySelector("img");
          if (window.nwAbrirImagem) window.nwAbrirImagem(img, props.legenda);
        } },
        h("img", { src: props.src, width: props.w || 1100, height: props.hgt || 687, loading: "lazy", alt: props.alt })),
      props.legenda ? h("figcaption", null, props.legenda) : null);
  }

  function Pontos(props) {
    return h("ul", { className: "lista-curta" }, props.itens.map(function (t) {
      return h("li", { key: t[0] }, h("strong", null, t[0]), " " + t[1]);
    }));
  }

  var ABAS_PAINEL = [
    { id: "execucao", rotulo: "Execução e logs", curto: "Análise · Operação", conteudo: function () {
      return h("div", { className: "painel-grade" },
        h(Captura, { src: "./site-assets/img/tela-analise.jpg", alt: "Vista Análise com as cinco etapas concluídas", legenda: "Análise de 200 mil transações sintéticas: as 5 etapas com tempo e progresso." }),
        h(Pontos, { itens: [
          ["Progresso das 5 etapas:", "com o que foi lido ou pontuado e a estimativa de tempo restante."],
          ["Log da execução:", "as transações aparecem conforme são gravadas, com score e motivos."],
          ["Operação:", "latência por consulta (ms), vazão (transações/s), CPU, RAM e logs do sistema e de ML."],
          ["Métricas oficiais:", "precisão, recall e F1 do teste; com rótulo no arquivo, também as daquele arquivo."]
        ] }));
    } },
    { id: "visao", rotulo: "Visão geral e tabela", curto: "KPIs · filtros", conteudo: function () {
      return h("div", { className: "painel-grade" },
        h("div", { className: "capturas-duplas" },
          h(Captura, { src: "./site-assets/img/tela-visao.jpg", alt: "Visão geral com indicadores e faixas de score", legenda: "Visão geral: alertas, faixas e contas prioritárias." }),
          h(Captura, { src: "./site-assets/img/tela-transacoes.jpg", alt: "Tabela de transações com filtros e score", legenda: "Transações: tabela paginada no servidor." })),
        h(Pontos, { itens: [
          ["Indicadores do recorte:", "transações, alertas e score mediano e máximo."],
          ["3 faixas:", "baixa (0–300), intermediária (301–700) e alta (701–1000)."],
          ["Filtros combinados:", "período, moeda, valor, bancos, conta, score e alerta, iguais para tabela, contas e grafo."],
          ["Cada transação:", "score, motivos verificáveis e aviso de histórico incompleto (menos de 72 h observadas)."]
        ] }));
    } },
    { id: "grafo", rotulo: "Investigação em grafo", curto: "pós-inferência", conteudo: function () {
      return h("div", { className: "painel-grade" },
        h(Captura, { src: "./site-assets/img/tela-grafo.jpg", w: 982, hgt: 614, alt: "Grafo da conta em foco com contas em alerta e uma sequência de repasse destacada", legenda: "Conta em foco, contas em alerta em vermelho e uma sequência de repasse destacada." }),
        h(Pontos, { itens: [
          ["Grafo SVG interativo:", "layouts Radial, Camadas, Circular e Forças, com zoom e arrasto."],
          ["Busca salto a salto:", "quem recebeu e quem enviou, até 3 saltos, no máximo 30 contas e 60 arestas."],
          ["Folhas agrupadas:", "contas ligadas só a uma vizinha viram um grupo expansível."],
          ["Ordem no tempo:", "cada aresta é direta, sequência com horários compatíveis, simultânea ou sem ordem confirmada."]
        ] }));
    } },
    { id: "sentinel", rotulo: "Sentinel AI", curto: "assistente", conteudo: function () {
      return h("div", { className: "painel-grade" },
        h("div", { className: "sentinel-mock", "aria-hidden": "true" },
          h("p", { className: "sm-pergunta" }, "Por que a TX-11 tem score 177?"),
          h("p", { className: "sm-resposta" },
            h("span", { className: "sm-tag" }, "Fato"), " Score 177, faixa baixa: abaixo do limiar (701).",
            h("br"), h("span", { className: "sm-tag sm-tag-2" }, "Limitação"), " Os motivos são fatos conferíveis, não a explicação do modelo.")),
        h(Pontos, { itens: [
          ["Modo local (padrão):", "responde sem internet, com glossário, ajuda de uso e números lidos dos resultados gravados."],
          ["Com chave e autorização:", "usa um modelo de linguagem externo (Gemini ou Anthropic) só depois de a aba autorizar."],
          ["Contexto verificado:", "manifesto, recorte, transação em foco e métricas oficiais; separa fatos, inferências e limitações."],
          ["Não detecta nada:", "explica os resultados e não altera nenhum cálculo."]
        ] }));
    } }
  ];

  function PainelAbas() {
    return h(Abas, { prefixo: "painel", rotulo: "Vistas do painel do analista", numerar: true, classe: "abas-painel", itens: ABAS_PAINEL });
  }

  montar("simulador-score", Simulador);
  montar("pipeline-interativo", Pipeline);
  montar("painel-abas", PainelAbas);
})();
