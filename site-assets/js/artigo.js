/* NodeWatch · artigo técnico
   Seção "Como o Machine Learning funciona": abas e simulador de score em React 18.
   React e ReactDOM vêm de ./site-assets/vendor (UMD, sem build e sem CDN).
   Se o React não carregar, a versão estática dentro de #ml-interativo continua visível. */
(function () {
  "use strict";

  var alvo = document.getElementById("ml-interativo");
  if (!alvo || !window.React || !window.ReactDOM || !window.ReactDOM.createRoot) return;

  var React = window.React;
  var h = React.createElement;
  var useState = React.useState;
  var useRef = React.useRef;

  /* ---------- Dados (fonte: docs/ml/RELATORIO_ML.md e src/painel/score.py) ---------- */

  var LIMIAR = 0.0910; // limiar do modelo de lavagem (máximo F1 na validação)

  var FAIXAS = [
    { id: "basal", nome: "Fluxo basal", de: 0, ate: 300,
      leitura: "Comportamento compatível com o histórico. Sem prioridade de investigação." },
    { id: "observacao", nome: "Zona de observação", de: 301, ate: 700,
      leitura: "Abaixo do limiar, mas perto dele. Vale revisar se outras evidências apontarem para a conta." },
    { id: "alerta", nome: "Alerta prioritário", de: 701, ate: 1000,
      leitura: "Passou do limiar do modelo: a transação sobe para o topo da fila do analista." }
  ];

  var TIPOLOGIAS = [
    ["FAN-OUT", 72], ["FAN-IN", 68], ["SCATTER-GATHER", 67], ["GATHER-SCATTER", 67],
    ["STACK", 67], ["CYCLE", 60], ["RANDOM", 56], ["BIPARTITE", 55]
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

  function num(x, casas) {
    return x.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  }

  /* ---------- Peças reutilizáveis ---------- */

  function Fatos(props) {
    return h("dl", { className: "fatos" }, props.itens.map(function (f) {
      return h("div", { key: f[0] }, h("dt", null, f[0]), h("dd", null, f[1]));
    }));
  }

  function Grupos(props) {
    return h("div", { className: "grupos" }, props.itens.map(function (g) {
      return h("article", { className: "grupo", key: g.titulo },
        h("h4", null, g.titulo),
        h("p", null, g.texto),
        g.exemplo ? h("p", { className: "grupo-exemplo" }, h("code", null, g.exemplo)) : null);
    }));
  }

  /* ---------- Abas ---------- */

  function AbaLavagem() {
    return h("div", null,
      h("p", { className: "aba-lead" },
        "Pontua cada transação financeira. Treinado com ", h("strong", null, "Random Forest"),
        " na base IBM AML HI-Small, com divisão temporal entre treino, validação e teste."),
      h(Fatos, { itens: [
        ["Transações", "5.078.345"], ["Positivas", "5.177 (0,10%)"],
        ["Tipologias", "8"], ["Atributos", "49"]
      ] }),
      h("h3", { className: "aba-sub" }, "O que os 49 atributos medem"),
      h(Grupos, { itens: [
        { titulo: "Velocidade de repasse", texto: "Quanto tempo o dinheiro fica parado: a conta recebeu e já está enviando?", exemplo: "min_desde_rec_origem" },
        { titulo: "Novidade do par", texto: "É a primeira vez que essas duas contas se relacionam? Quantas vezes já houve?", exemplo: "par_novo · n_par_previas" },
        { titulo: "Desvio de valor", texto: "O valor foge do histórico da conta? Medido como z-score do log do valor em USD.", exemplo: "z_valor_origem" },
        { titulo: "Janelas deslizantes", texto: "Contagens, somas e razão saída/entrada nas últimas 24 h de cada conta.", exemplo: "razao_saida_entrada_24h" }
      ] }),
      h("h3", { className: "aba-sub" }, "Recall por tipologia no teste"),
      h("ul", { className: "barras", "aria-label": "Recall por tipologia" }, TIPOLOGIAS.map(function (t) {
        return h("li", { key: t[0] },
          h("span", { className: "barra-nome mono" }, t[0]),
          h("span", { className: "barra-trilho", "aria-hidden": "true" },
            h("span", { className: "barra-valor", style: { width: t[1] + "%" } })),
          h("span", { className: "barra-num mono" }, t[1] + "%"));
      })),
      h("p", { className: "aba-nota" },
        "Limite conhecido: positivos sem tipologia conhecida (39% do teste) têm recall de apenas 2%."));
  }

  function AbaRede() {
    return h("div", null,
      h("p", { className: "aba-lead" },
        "Segundo ", h("strong", null, "Random Forest"),
        ", isolado do primeiro. Prevê o estado da próxima medição de cada caminho de rede, para distinguir instabilidade de infraestrutura de comportamento financeiro anômalo."),
      h(Fatos, { itens: [
        ["Medições", "333.954"], ["Caminhos", "135"], ["Atributos", "21"], ["Macro-F1", "0,75"]
      ] }),
      h("div", { className: "classes-rede" },
        h("span", { className: "classe classe-ok" }, "OK"),
        h("span", { className: "classe classe-risco" }, "RISCO"),
        h("span", { className: "classe classe-falha" }, "FALHA")),
      h(Grupos, { itens: [
        { titulo: "Perda de pacotes", texto: "Percentual perdido na medição e perdas consecutivas.", exemplo: "perda_pct · perdas_consecutivas" },
        { titulo: "RTT", texto: "Tempo de ida e volta comparado ao p95/p99 de referência do caminho.", exemplo: "razao_rtt_p95" },
        { titulo: "Jitter", texto: "Variação do atraso em relação ao p95 do caminho.", exemplo: "razao_jitter_p95" },
        { titulo: "Janelas de 3, 6 e 12", texto: "Média de perda e máximos de RTT e jitter nas últimas medições.", exemplo: "perda_media_w12" }
      ] }),
      h("p", { className: "aba-nota" },
        "Referência: repetir o estado atual dá macro-F1 de 0,71. Hoje os dois modelos não se combinam, porque as bases não têm vínculo verificável entre si."));
  }

  function AbaCausal() {
    var EVENTOS = 9;
    var _t = useState(5), t = _t[0], setT = _t[1];
    var pontos = [];
    for (var i = 0; i < EVENTOS; i++) {
      var classe = i < t ? "ev ev-passado" : i === t ? "ev ev-agora" : "ev ev-futuro";
      pontos.push(h("li", { key: i, className: classe },
        h("span", { className: "ev-ponto", "aria-hidden": "true" }),
        h("span", { className: "ev-rotulo mono" }, i === t ? "t" : i < t ? "t−" + (t - i) : "t+" + (i - t))));
    }
    return h("div", null,
      h("p", { className: "aba-lead" },
        "Para pontuar uma transação no instante ", h("span", { className: "mono" }, "t"),
        ", o sistema usa ", h("strong", null, "estritamente"), " dados ocorridos em ",
        h("span", { className: "mono" }, "< t"), ". Nenhuma informação do futuro vaza para o atributo."),
      h("div", { className: "linha-tempo" },
        h("ol", { className: "eventos", "aria-hidden": "true" }, pontos),
        h("label", { className: "controle" },
          h("span", null, "Mova o instante ", h("span", { className: "mono" }, "t")),
          h("input", { type: "range", min: 1, max: EVENTOS - 2, value: t,
            onChange: function (e) { setT(Number(e.target.value)); },
            "aria-valuetext": t + " transações anteriores visíveis" })),
        h("p", { className: "linha-legenda" },
          h("span", { className: "leg leg-passado" }, t + " eventos usados"),
          h("span", { className: "leg leg-agora" }, "transação pontuada"),
          h("span", { className: "leg leg-futuro" }, (EVENTOS - t - 1) + " eventos invisíveis"))),
      h(Grupos, { itens: [
        { titulo: "Divisão por tempo", texto: "Treino, validação e teste são períodos consecutivos, nunca embaralhados." },
        { titulo: "Teste congelado", texto: "Modelo e limiar foram escolhidos na validação e fixados antes de olhar o teste." },
        { titulo: "Lote = incremental", texto: "O cálculo em lote foi conferido contra o cálculo evento a evento: os mesmos alertas." }
      ] }));
  }

  function AbaScore() {
    var _s = useState(520), score = _s[0], setScore = _s[1];
    var f = faixaDe(score);
    var bruto = brutoDe(score);
    function atalho(v) { return h("button", { type: "button", className: "atalho", onClick: function () { setScore(v); } }, v); }

    return h("div", null,
      h("p", { className: "aba-lead" },
        "O modelo devolve um valor de 0 a 1, que não é probabilidade calibrada. O painel converte esse valor em um ",
        h("strong", null, "índice de 0 a 1000 ancorado no limiar"), ": score ≥ 701 equivale exatamente a passar do limiar do modelo."),
      h("div", { className: "simulador faixa-" + f.id },
        h("div", { className: "sim-topo" },
          h("div", null,
            h("p", { className: "sim-score mono", "aria-live": "polite" }, score, h("small", null, " / 1000")),
            h("p", { className: "sim-faixa" }, f.nome)),
          h("dl", { className: "sim-dados" },
            h("div", null, h("dt", null, "Score bruto do modelo"), h("dd", { className: "mono" }, "≈ " + num(bruto, 4))),
            h("div", null, h("dt", null, "Limiar do modelo"), h("dd", { className: "mono" }, num(LIMIAR, 4))))),
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
      })),
      h("p", { className: "aba-aviso" },
        h("strong", null, "Alerta não é prova de fraude."),
        " O score é uma ordem de prioridade estatística para a investigação humana. O NodeWatch não bloqueia, não aprova e não paga nada."));
  }

  var ABAS = [
    { id: "lavagem", rotulo: "Modelo 1 · Lavagem", curto: "49 atributos", Comp: AbaLavagem },
    { id: "rede", rotulo: "Modelo 2 · Rede", curto: "21 atributos", Comp: AbaRede },
    { id: "causal", rotulo: "Rigor causal", curto: "zero vazamento", Comp: AbaCausal },
    { id: "score", rotulo: "Score 0–1000", curto: "simulador", Comp: AbaScore }
  ];

  function MLInterativo() {
    var _a = useState(0), ativa = _a[0], setAtiva = _a[1];
    var botoes = useRef([]);

    function teclado(e) {
      var n = ABAS.length, prox = null;
      if (e.key === "ArrowRight") prox = (ativa + 1) % n;
      else if (e.key === "ArrowLeft") prox = (ativa - 1 + n) % n;
      else if (e.key === "Home") prox = 0;
      else if (e.key === "End") prox = n - 1;
      if (prox === null) return;
      e.preventDefault();
      setAtiva(prox);
      if (botoes.current[prox]) botoes.current[prox].focus();
    }

    var Atual = ABAS[ativa].Comp;
    return h("div", { className: "abas" },
      h("div", { className: "abas-lista", role: "tablist", "aria-label": "Tópicos de Machine Learning", onKeyDown: teclado },
        ABAS.map(function (a, i) {
          var sel = i === ativa;
          return h("button", {
            key: a.id, type: "button", role: "tab", id: "aba-" + a.id,
            "aria-selected": sel ? "true" : "false", "aria-controls": "painel-" + a.id,
            tabIndex: sel ? 0 : -1, className: "aba" + (sel ? " ativa" : ""),
            ref: function (el) { botoes.current[i] = el; },
            onClick: function () { setAtiva(i); }
          }, h("span", { className: "aba-rotulo" }, a.rotulo), h("span", { className: "aba-curto" }, a.curto));
        })),
      h("div", { className: "aba-painel", role: "tabpanel", id: "painel-" + ABAS[ativa].id,
        "aria-labelledby": "aba-" + ABAS[ativa].id, tabIndex: 0, key: ABAS[ativa].id },
        h(Atual)));
  }

  window.ReactDOM.createRoot(alvo).render(h(MLInterativo));
})();
