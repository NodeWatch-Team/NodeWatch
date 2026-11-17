/* NodeWatch · artigo técnico
   Componentes interativos em React 18 (sem build, sem JSX):
     · Bloco 3: conversão predict_proba → índice 0–1000 (mesma fórmula de src/painel/score.py).
     · Bloco 4: etapas do pipeline em abas.
     · Bloco 5: demonstração do painel em 4 abas, com o visual do Design System Carbon (interface/assets/painel.css):
       execução ao vivo, visão geral e tabela, investigação em grafo e Sentinel AI.
   React e ReactDOM vêm de ./site-assets/vendor (UMD). Nenhuma chamada de rede: tudo roda no navegador.
   Se o React não carregar, a versão estática de cada alvo continua visível. */
(function () {
  "use strict";

  if (!window.React || !window.ReactDOM || !window.ReactDOM.createRoot) return;

  var React = window.React;
  var h = React.createElement;
  var useState = React.useState;
  var useRef = React.useRef;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;

  var semMovimento = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function montar(id, Comp) {
    var alvo = document.getElementById(id);
    if (alvo) window.ReactDOM.createRoot(alvo).render(h(Comp));
  }

  function num(x, casas) {
    return Number(x).toLocaleString("pt-BR", { minimumFractionDigits: casas || 0, maximumFractionDigits: casas || 0 });
  }

  /* Gerador pseudoaleatório determinístico (mulberry32): a demonstração é igual a cada visita. */
  function gerador(semente) {
    var s = semente >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- Score: a mesma conversão de src/painel/score.py ---------- */

  var LIMIAR = 0.0909838927; // limiar do modelo (F1 máximo na validação); exibido como 0,0910

  function converter(p) {
    if (p >= LIMIAR) return Math.min(1000, 701 + Math.floor((p - LIMIAR) / (1 - LIMIAR) * 299));
    return Math.min(700, Math.floor(p / LIMIAR * 701));
  }
  /* Valor da floresta no meio do intervalo que produz o score s (inverso da conversão). */
  function brutoDe(s) {
    var p = s >= 701 ? LIMIAR + (s - 701 + 0.5) / 299 * (1 - LIMIAR) : (s + 0.5) / 701 * LIMIAR;
    return Math.min(1, Math.max(0, p));
  }

  var FAIXAS = [
    { id: "baixa", nome: "Baixa", de: 0, ate: 300,
      leitura: "Compatível com o histórico. Sem prioridade de investigação." },
    { id: "intermediaria", nome: "Intermediária", de: 301, ate: 700,
      leitura: "Abaixo do limiar, mas perto dele. Vale revisar se outras evidências apontarem para a conta." },
    { id: "alta", nome: "Alta (alerta)", de: 701, ate: 1000,
      leitura: "Passou do limiar do modelo: a transação sobe para o topo da fila do analista." }
  ];

  function faixaDe(score) {
    for (var i = 0; i < FAIXAS.length; i++) if (score <= FAIXAS[i].ate) return FAIXAS[i];
    return FAIXAS[FAIXAS.length - 1];
  }

  /* Abas acessíveis (setas, Home e End). */
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

  /* ═══════════ Bloco 3 · Conversão predict_proba → 0–1000 ═══════════ */

  var EXEMPLOS = [[0.02, "0,02"], [0.05, "0,05"], [0.091, "0,0910"], [0.1214, "0,1214"], [0.71, "0,71"], [1, "1,00"]];

  function Conversao() {
    var _s = useState(904), score = _s[0], setScore = _s[1];
    var _p = useState(0.71), bruto = _p[0], setBruto = _p[1];
    var f = faixaDe(score);

    function porScore(s) { setScore(s); setBruto(brutoDe(s)); }
    function porBruto(p) { setBruto(p); setScore(converter(p)); }

    // Régua dupla: em cima, predict_proba linear (0–1); embaixo, o índice 0–1000. As faixas ligam as duas.
    var W = 640, X0 = 20, X1 = 620, L = X1 - X0;
    function xp(p) { return X0 + p * L; }
    function xs(s) { return X0 + s / 1000 * L; }
    var pIni = 301 / 701 * LIMIAR;

    return h("div", { className: "conversao" },
      h("div", { className: "conv-topo faixa-" + f.id },
        h("div", { className: "conv-par" },
          h("p", { className: "conv-rotulo" }, "predict_proba do Random Forest"),
          h("p", { className: "conv-valor mono", "aria-live": "polite" }, num(bruto, 4)),
          h("p", { className: "conv-nota" }, "≈ " + Math.round(bruto * 100) + "% dos votos das 100 árvores")),
        h("span", { className: "conv-seta", "aria-hidden": "true" }, "→"),
        h("div", { className: "conv-par" },
          h("p", { className: "conv-rotulo" }, "Índice no painel"),
          h("p", { className: "conv-valor conv-score mono" }, score, h("small", null, " / 1000")),
          h("p", { className: "conv-faixa" }, f.nome))),

      h("svg", { className: "conv-regua", viewBox: "0 0 " + W + " 160", role: "img",
        "aria-label": "Régua de conversão: o trecho de 0 a 0,091 do predict_proba ocupa os índices de 0 a 700; o trecho de 0,091 a 1 ocupa de 701 a 1000. Valor atual " + num(bruto, 4) + " corresponde ao score " + score + "." },
        h("polygon", { className: "cr-faixa cr-baixa", points: [xp(0), 36, xp(pIni), 36, xs(301), 114, xs(0), 114].join(" ") }),
        h("polygon", { className: "cr-faixa cr-intermediaria", points: [xp(pIni), 36, xp(LIMIAR), 36, xs(701), 114, xs(301), 114].join(" ") }),
        h("polygon", { className: "cr-faixa cr-alta", points: [xp(LIMIAR), 36, xp(1), 36, xs(1000), 114, xs(701), 114].join(" ") }),
        h("line", { className: "cr-eixo", x1: X0, y1: 36, x2: X1, y2: 36 }),
        h("line", { className: "cr-eixo", x1: X0, y1: 114, x2: X1, y2: 114 }),
        h("text", { className: "cr-titulo", x: X0, y: 10 }, "predict_proba (0,0 – 1,0)"),
        h("text", { className: "cr-titulo", x: X0, y: 158 }, "índice do painel (0 – 1000)"),
        [0, 0.25, 0.5, 0.75, 1].map(function (v) {
          return h("text", { key: "p" + v, className: "cr-marca", x: xp(v), y: 28, textAnchor: v === 0 ? "start" : v === 1 ? "end" : "middle" }, num(v, 2));
        }),
        h("text", { className: "cr-marca cr-limiar", x: xp(LIMIAR) + 4, y: 50 }, "limiar 0,0910"),
        [0, 300, 700, 1000].map(function (v) {
          return h("text", { key: "s" + v, className: "cr-marca", x: xs(v), y: 130, textAnchor: v === 0 ? "start" : v === 1000 ? "end" : "middle" }, v);
        }),
        h("line", { className: "cr-ligacao", x1: xp(bruto), y1: 36, x2: xs(score), y2: 114 }),
        h("circle", { className: "cr-ponto", cx: xp(bruto), cy: 36, r: 6 }),
        h("circle", { className: "cr-ponto", cx: xs(score), cy: 114, r: 6 })),

      h("label", { className: "controle" },
        h("span", null, "Arraste pela escala do painel (o valor da floresta é recalculado)"),
        h("input", { type: "range", min: 0, max: 1000, step: 1, value: score,
          onChange: function (e) { porScore(Number(e.target.value)); },
          "aria-valuetext": "score " + score + ", predict_proba " + num(bruto, 4) + ", faixa " + f.nome })),
      h("div", { className: "atalhos" }, h("span", null, "Valores da floresta:"),
        EXEMPLOS.map(function (ex) {
          var p = ex[0];
          return h("button", { key: ex[1], type: "button", className: "atalho" + (Math.abs(p - bruto) < 1e-9 ? " ativo" : ""),
            "aria-pressed": Math.abs(p - bruto) < 1e-9 ? "true" : "false",
            onClick: function () { porBruto(p); } }, ex[1] + " → " + converter(p));
        })),
      h("p", { className: "sim-leitura" }, f.leitura),
      h("div", { className: "faixas-lista" }, FAIXAS.map(function (x) {
        return h("article", { key: x.id, className: "faixa-item faixa-" + x.id + (x.id === f.id ? " ativa" : "") },
          h("p", { className: "mono" }, x.de + "–" + x.ate),
          h("h4", null, x.nome),
          h("p", null, x.leitura));
      })));
  }

  /* ═══════════ Bloco 4 · Pipeline ═══════════ */

  var ETAPAS = [
    { id: "ingestao", rotulo: "Ingestão e validação", curto: ".csv · .zip",
      faz: "Lê o .csv ou .zip em blocos de 200 mil linhas e confere o contrato de colunas: formato IBM AML ou colunas em português. Não pede rótulo nem arquivo de tipologias.",
      itens: ["Linhas inválidas ficam fora e são contadas, com a coluna, um exemplo e como corrigir.", "Nada é corrigido nem preenchido.", "O modelo só é carregado se o SHA-256 conferir com o manifesto."],
      mede: "bytes lidos" },
    { id: "ordem", rotulo: "Ordenação cronológica", curto: "sem olhar o futuro",
      faz: "Ordena por minuto e, no empate, pela ordem da linha. É o que transforma o arquivo numa simulação de tempo real: as transações passam a chegar na ordem em que aconteceram.",
      itens: ["A janela de cada transação é [t − w, t): o próprio minuto fica de fora.", "Duas transações no mesmo minuto não enxergam uma à outra.", "Cada transação recebe um ID de exibição (TX-n)."],
      mede: "concluída de uma vez" },
    { id: "pontuacao", rotulo: "Features + inferência", curto: "49 atributos · RF",
      faz: "Em blocos de cerca de 20 mil transações: calcula os 49 atributos com o estado incremental de cada conta (NumPy), aplica o Random Forest e converte o predict_proba em score de 0 a 1000.",
      itens: ["Score ≥ 701 vira alerta, com motivos verificáveis (par novo, repasse em menos de 60 min…).", "O estado das contas avança; o modelo não muda e não é retreinado.", "Nenhuma tipologia é lida ou exigida.", "Cancelar para no próximo bloco; o que já foi pontuado fica gravado."],
      mede: "transações pontuadas" },
    { id: "sqlite", rotulo: "Persistência local", curto: "SQLite",
      faz: "Grava as transações pontuadas e cria os índices dos campos filtráveis e as contagens gerais num banco SQLite local da análise.",
      itens: ["Filtrar, ordenar e paginar consultam o que foi gravado, sem nova inferência.", "Tudo fica em artefatos_ml/painel/analises/<id>/, na própria máquina."],
      mede: "passos" },
    { id: "manifesto", rotulo: "Manifesto e telemetria", curto: "painel liberado",
      faz: "Grava o manifesto da execução (status, tempos por etapa, vazão, CPU e RAM, versão do modelo, limiar, avisos) e libera os resultados no painel.",
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

  /* ═══════════ Bloco 5 · Demonstração do painel ═══════════ */

  /* Motivos verificáveis: os mesmos textos de src/ml/preparacao.py (fatos conferíveis, não explicação do modelo). */
  var MOTIVOS = [
    "primeira transação entre origem e destino",
    "origem recebeu fundos há menos de 60 min",
    "envios da origem em 24 h acima do p99 do treino",
    "origem com mais destinos distintos que o p99 do treino",
    "destino com mais origens distintas que o p99 do treino",
    "valor atípico para a origem (|z| > 3)",
    "formato com taxa de lavagem no treino >= 5x a média",
    "moedas de pagamento e recebimento diferentes"
  ];
  var FORMATOS = ["ACH", "ACH", "ACH", "Cheque", "Credit Card", "Wire", "Cash", "Reinvestment", "Bitcoin"];
  var MOEDAS = ["US Dollar", "US Dollar", "US Dollar", "Euro", "Yuan", "Rupee", "Bitcoin"];

  function contaDe(r) { return "8" + Math.floor(r() * 0xFFFFFFF).toString(16).toUpperCase().padStart(8, "0"); }

  function sortearBruto(r) {
    var u = r();
    if (u < 0.8) return r() * 0.038;
    if (u < 0.92) return 0.04 + r() * 0.05;
    return LIMIAR + 0.002 + r() * 0.82;
  }

  function gerarTransacao(r, i, minuto) {
    var p = sortearBruto(r);
    var s = converter(p);
    var motivos = [];
    if (s >= 701) {
      var n = 1 + Math.floor(r() * 3), usados = {};
      while (motivos.length < n) { var m = MOTIVOS[Math.floor(r() * MOTIVOS.length)]; if (!usados[m]) { usados[m] = 1; motivos.push(m); } }
    } else if (s > 300 && r() < 0.5) motivos.push(MOTIVOS[Math.floor(r() * 2)]);
    var dia = 9 + Math.floor(minuto / 1440), mm = minuto % 1440;
    return {
      id: "TX-" + i, bruto: p, score: s, alerta: s >= 701, motivos: motivos,
      origem: contaDe(r), destino: contaDe(r),
      valor: Math.round(Math.exp(3 + r() * 8)) + r(),
      formato: FORMATOS[Math.floor(r() * FORMATOS.length)],
      moeda: MOEDAS[Math.floor(r() * MOEDAS.length)],
      quando: String(dia).padStart(2, "0") + "/09 " + String(Math.floor(mm / 60)).padStart(2, "0") + ":" + String(mm % 60).padStart(2, "0"),
      incompleto: r() < 0.12
    };
  }

  function ScoreCelula(props) {
    var f = faixaDe(props.score);
    return h("span", { className: "score-celula " + f.id },
      h("span", { className: "mini", "aria-hidden": "true" }, h("i", { style: { width: Math.max(4, props.score / 10) + "%" } })),
      props.score);
  }

  function Selo(props) {
    return h("span", { className: "selo " + (props.tom || "") + (props.vivo ? " vivo" : "") }, props.children);
  }

  function Moldura(props) {
    return h("div", { className: "app-moldura" },
      h("div", { className: "app-barra" },
        h("img", { src: "./site-assets/img/apple-touch-icon.png", alt: "", width: 20, height: 20 }),
        h("span", { className: "app-caminho" }, "NodeWatch", h("span", { "aria-hidden": "true" }, " / "), h("strong", null, props.vista)),
        h("span", { className: "app-selos" }, props.selos)),
      h("div", { className: "app-corpo" }, props.children));
  }

  var METRICAS_TESTE = [
    ["Average Precision", "0,464", "validação 0,499"],
    ["Precisão", "62,7%", "389 / 620 alertas"],
    ["Recall", "40,7%", "389 / 956 positivos"],
    ["F1-score", "0,49", "limiar 0,0910"]
  ];

  /* ----- Aba 1 · Execução ao vivo ----- */

  var FASES = [
    { nome: "Ingestão e validação", ate: 8 },
    { nome: "Ordenação cronológica", ate: 12 },
    { nome: "Features + inferência", ate: 92 },
    { nome: "Persistência SQLite", ate: 97 },
    { nome: "Manifesto e telemetria", ate: 100 }
  ];
  var TOTAL_DEMO = 482650; // linhas do maior arquivo testado na interface

  function faseDe(pct) {
    for (var i = 0; i < FASES.length; i++) if (pct < FASES[i].ate) return i;
    return FASES.length;
  }

  function Execucao() {
    var raiz = useRef(null);
    var gen = useRef(gerador(20261117));
    var _e = useState({ pct: 0, linhas: [], lat: 8.8, vazao: 0, alertas: 0, n: 0 }), est = _e[0], setEst = _e[1];
    var _r = useState(false), rodando = _r[0], setRodando = _r[1];
    var _g = useState(false), gaveta = _g[0], setGaveta = _g[1];
    var iniciou = useRef(false);

    // Começa sozinha quando aparece na tela (só com movimento permitido).
    useEffect(function () {
      if (semMovimento || !("IntersectionObserver" in window) || !raiz.current) return;
      var obs = new IntersectionObserver(function (es) {
        if (es[0].isIntersecting && !iniciou.current) { iniciou.current = true; setRodando(true); }
      }, { threshold: 0.35 });
      obs.observe(raiz.current);
      return function () { obs.disconnect(); };
    }, []);

    useEffect(function () {
      if (!rodando) return;
      var t = setInterval(function () {
        setEst(function (a) {
          if (a.pct >= 100) return a;
          var r = gen.current;
          var pct = Math.min(100, a.pct + (faseDe(a.pct) === 2 ? 1 : 2));
          var linhas = a.linhas, alertas = a.alertas, n = a.n;
          var lat = a.lat, vazao = a.vazao;
          if (faseDe(a.pct) === 2) {
            n = a.n + 1;
            var minuto = 480 + n * 7 + Math.floor(r() * 5);
            var tx = gerarTransacao(r, 1000 + n * 37, minuto);
            tx.novo = true;
            linhas = [tx].concat(a.linhas.map(function (x) { return Object.assign({}, x, { novo: false }); })).slice(0, 7);
            if (tx.alerta) alertas += 1;
            lat = 7.9 + r() * 2.1;
            vazao = 9200 + Math.round(r() * 999);
          }
          return { pct: pct, linhas: linhas, lat: lat, vazao: vazao, alertas: alertas, n: n };
        });
      }, 420);
      return function () { clearInterval(t); };
    }, [rodando]);

    useEffect(function () { if (est.pct >= 100) setRodando(false); }, [est.pct]);

    function reiniciar() {
      gen.current = gerador(20261117);
      setEst({ pct: 0, linhas: [], lat: 8.8, vazao: 0, alertas: 0, n: 0 });
      setRodando(true);
    }

    var fase = faseDe(est.pct);
    var concluida = est.pct >= 100;
    var pontuadas = Math.round(Math.max(0, Math.min(1, (est.pct - 12) / 80)) * TOTAL_DEMO);

    return h("div", { ref: raiz, className: "demo-grade-exec" + (gaveta ? " com-gaveta" : "") },
      h(Moldura, { vista: "Análise", selos: [
        h(Selo, { key: "s", tom: concluida ? "ok" : rodando ? "acao" : "neutro", vivo: rodando && !concluida },
          concluida ? "Concluída" : rodando ? "Em andamento" : "Pausada"),
        h("button", { key: "m", type: "button", className: "botao-app" + (gaveta ? " ativo" : ""), "aria-expanded": gaveta ? "true" : "false",
          onClick: function () { setGaveta(!gaveta); } }, "Métricas do modelo")
      ] },
        h("div", { className: "execucao-cabeca " + (concluida ? "concluida" : "em_andamento") },
          h("div", { className: "acomp-topo" },
            h("div", { className: "acomp-titulos" },
              h("h3", null, "hi_small_demo.csv"),
              h("p", { className: "acomp-atual" },
                rodando && !concluida ? h("span", { className: "ponto-vivo", "aria-hidden": "true" }) : null,
                concluida ? "Análise concluída · resultados liberados no painel" : h(React.Fragment, null, "Etapa " + Math.min(5, fase + 1) + " de 5 · ", h("strong", null, FASES[Math.min(4, fase)].nome)))),
            h("p", { className: "percentual" }, num(est.pct), h("small", null, "%"))),
          h("div", { className: "progresso", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": est.pct, "aria-label": "Progresso da análise" },
            h("i", { style: { width: est.pct + "%" } })),
          h("ol", { className: "linha-etapas" }, FASES.map(function (f, i) {
            var cls = i < fase ? "feita" : i === fase ? "atual" : "pendente";
            return h("li", { key: f.nome, className: cls }, h("span", { className: "le-ponto", "aria-hidden": "true" }), f.nome);
          })),
          h("dl", { className: "estatisticas" },
            h("div", { className: "estatistica" }, h("dt", null, "Pontuadas"), h("dd", null, num(pontuadas), h("small", null, "de " + num(TOTAL_DEMO)))),
            h("div", { className: "estatistica" }, h("dt", null, "Latência"), h("dd", null, est.n ? num(est.lat, 1) + " ms" : "–", h("small", null, "por linha"))),
            h("div", { className: "estatistica" }, h("dt", null, "Vazão"), h("dd", null, est.n ? num(est.vazao) : "–", h("small", null, "eventos/s"))),
            h("div", { className: "estatistica" }, h("dt", null, "Alertas no log"), h("dd", null, num(est.alertas), h("small", null, "score ≥ 701")))),
          h("div", { className: "linha" },
            h("button", { type: "button", className: "botao-app primario", onClick: function () { if (concluida) reiniciar(); else setRodando(!rodando); } },
              concluida ? "↺ Simular de novo" : rodando ? "❚❚ Pausar" : "▶ Simular execução"),
            h("span", { className: "legenda-demo" }, "Simulação ilustrativa no navegador: as linhas são geradas aqui, não pelo modelo."))),

        h("section", { className: "bloco log-bloco", "aria-label": "Log da execução" },
          h("div", { className: "cabeca-bloco" }, h("h3", null, "Log da execução · linha a linha"), h(Selo, { tom: "neutro" }, "últimas 7")),
          est.linhas.length === 0
            ? h("p", { className: "vazio compacto" }, "As transações aparecem aqui conforme são pontuadas e gravadas.")
            : h("ol", { className: "log-lista", "aria-live": "off" }, est.linhas.map(function (t) {
                return h("li", { key: t.id, className: "log-linha" + (t.alerta ? " com-alerta" : "") + (t.novo && !semMovimento ? " nova" : "") },
                  h("span", { className: "log-hora mono" }, t.quando),
                  h("span", { className: "log-id mono" }, t.id),
                  h("span", { className: "log-contas mono" }, t.origem + " → " + t.destino),
                  h(ScoreCelula, { score: t.score }),
                  t.alerta ? h("span", { className: "alerta-celula" }, "⚠ alerta") : h("span", { className: "sem-alerta-celula" }, "sem alerta"),
                  t.alerta ? h("span", { className: "log-motivos" }, t.motivos.join("; ")) : null);
              })))),

      gaveta ? h("aside", { className: "gaveta", "aria-label": "Métricas oficiais do Random Forest" },
        h("div", { className: "cabeca-bloco" }, h("h3", null, "Métricas oficiais do modelo"),
          h("button", { type: "button", className: "botao-app", onClick: function () { setGaveta(false); }, "aria-label": "Fechar métricas" }, "✕")),
        h("p", { className: "legenda" }, "Teste congelado: 862.792 transações, 956 de lavagem."),
        h("div", { className: "gaveta-kpis" }, METRICAS_TESTE.map(function (m) {
          return h("div", { key: m[0], className: "kpi" }, h("p", { className: "nome" }, m[0]), h("p", { className: "valor" }, m[1]), h("p", { className: "detalhe" }, m[2]));
        })),
        h("table", { className: "matriz" },
          h("caption", null, "Matriz de confusão no limiar 0,0910"),
          h("thead", null, h("tr", null, h("th", null, ""), h("th", { scope: "col" }, "Alerta"), h("th", { scope: "col" }, "Sem alerta"))),
          h("tbody", null,
            h("tr", null, h("th", { scope: "row" }, "Lavagem"), h("td", { className: "m-vp" }, "389"), h("td", { className: "m-fn" }, "567")),
            h("tr", null, h("th", { scope: "row" }, "Legítima"), h("td", { className: "m-fp" }, "231"), h("td", null, "861.605"))))) : null);
  }

  /* ----- Aba 2 · Visão geral e tabela ----- */

  function amostraVisao() {
    var r = gerador(4242), lista = [];
    for (var i = 1; i <= 24; i++) lista.push(gerarTransacao(r, i, 480 + i * 23 + Math.floor(r() * 20)));
    // TX-11 é o exemplo do Bloco 3 (predict_proba 0,71 → 904), também usado no Sentinel AI.
    var t = lista[10];
    t.bruto = 0.71; t.score = converter(0.71); t.alerta = true;
    t.motivos = [MOTIVOS[0], MOTIVOS[1]]; t.incompleto = false;
    return lista;
  }

  function Visao() {
    var dados = useMemo(amostraVisao, []);
    var _f = useState("todas"), faixa = _f[0], setFaixa = _f[1];
    var _a = useState(false), soAlertas = _a[0], setSoAlertas = _a[1];
    var _b = useState(""), busca = _b[0], setBusca = _b[1];
    var _m = useState(0), minimo = _m[0], setMinimo = _m[1];
    var _x = useState(null), aberta = _x[0], setAberta = _x[1];

    var filtradas = dados.filter(function (t) {
      if (faixa !== "todas" && faixaDe(t.score).id !== faixa) return false;
      if (soAlertas && !t.alerta) return false;
      if (t.score < minimo) return false;
      var q = busca.trim().toUpperCase();
      if (q && t.origem.indexOf(q) < 0 && t.destino.indexOf(q) < 0 && t.id.toUpperCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return b.score - a.score; });

    var scores = filtradas.map(function (t) { return t.score; }).sort(function (a, b) { return a - b; });
    var mediana = scores.length ? (scores.length % 2 ? scores[(scores.length - 1) / 2] : Math.round((scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2)) : null;
    var cont = { baixa: 0, intermediaria: 0, alta: 0 };
    filtradas.forEach(function (t) { cont[faixaDe(t.score).id] += 1; });
    var total = filtradas.length;
    var alertas = cont.alta;

    function limpar() { setFaixa("todas"); setSoAlertas(false); setBusca(""); setMinimo(0); }

    return h(Moldura, { vista: "Visão geral · Transações", selos: [h(Selo, { key: "a", tom: "ok" }, "Análise concluída"), h(Selo, { key: "b", tom: "neutro" }, "amostra ilustrativa · 24 transações")] },
      h("div", { className: "recorte", role: "group", "aria-label": "Filtros do recorte" },
        h("div", { className: "cabeca" },
          h("h4", null, "Recorte"),
          h("label", { className: "campo" }, h("span", null, "Faixa"),
            h("select", { value: faixa, onChange: function (e) { setFaixa(e.target.value); } },
              h("option", { value: "todas" }, "Todas"), h("option", { value: "baixa" }, "Baixa (0–300)"),
              h("option", { value: "intermediaria" }, "Intermediária (301–700)"), h("option", { value: "alta" }, "Alta (701–1000)"))),
          h("label", { className: "campo" }, h("span", null, "Score mínimo: " + minimo),
            h("input", { type: "range", min: 0, max: 1000, step: 50, value: minimo, onChange: function (e) { setMinimo(Number(e.target.value)); } })),
          h("label", { className: "campo" }, h("span", null, "Conta ou TX"),
            h("input", { type: "search", value: busca, placeholder: "ex.: TX-11", onChange: function (e) { setBusca(e.target.value); } })),
          h("label", { className: "alternar" }, h("input", { type: "checkbox", checked: soAlertas, onChange: function (e) { setSoAlertas(e.target.checked); } }), "Só alertas"),
          h("button", { type: "button", className: "botao-app", onClick: limpar }, "Limpar"))),

      h("div", { className: "kpis" },
        h("div", { className: "kpi" }, h("p", { className: "nome" }, "Transações"), h("p", { className: "valor" }, total), h("p", { className: "detalhe" }, "no recorte")),
        h("div", { className: "kpi alerta" }, h("p", { className: "nome" }, "⚠ Alertas"), h("p", { className: "valor" }, alertas), h("p", { className: "detalhe" }, "score ≥ 701")),
        h("div", { className: "kpi" }, h("p", { className: "nome" }, "Score mediano"), h("p", { className: "valor" }, mediana === null ? "–" : mediana), h("p", { className: "detalhe" }, "de 0 a 1000")),
        h("div", { className: "kpi" }, h("p", { className: "nome" }, "Score máximo"), h("p", { className: "valor" }, scores.length ? scores[scores.length - 1] : "–"), h("p", { className: "detalhe" }, "topo da fila"))),

      h("section", { className: "bloco", "aria-label": "Distribuição nas três faixas" },
        h("h3", null, "Distribuição nas 3 faixas"),
        h("div", { className: "distribuicao" },
          h("div", { className: "pilha", "aria-hidden": "true" },
            ["baixa", "intermediaria", "alta"].map(function (id) { return cont[id] ? h("i", { key: id + total, className: id, style: { width: (cont[id] / total * 100) + "%" } }) : null; })),
          h("ul", { className: "faixas-dist" }, FAIXAS.map(function (fx) {
            return h("li", { key: fx.id, className: fx.id },
              h("span", { className: "ponto-faixa " + fx.id }),
              h("span", { className: "rotulo-faixa" }, fx.nome.replace(" (alerta)", ""), h("span", { className: "intervalo" }, fx.de + "–" + fx.ate)),
              h("span", { className: "n" }, cont[fx.id]),
              h("span", { className: "p" }, total ? num(cont[fx.id] / total * 100, 1) + "%" : "–"));
          })))),

      h("div", { className: "rolagem" },
        h("table", { className: "tabela-registros" },
          h("caption", null, "Clique numa linha para ver as justificativas verificáveis. Ordenado por score."),
          h("thead", null, h("tr", null,
            h("th", { scope: "col" }, "TX"), h("th", { scope: "col" }, "Data/hora"), h("th", { scope: "col" }, "Origem → destino"),
            h("th", { scope: "col", className: "num" }, "Valor"), h("th", { scope: "col" }, "Formato"),
            h("th", { scope: "col", className: "num" }, "Score"), h("th", { scope: "col" }, "Alerta"))),
          h("tbody", null, total === 0
            ? h("tr", null, h("td", { colSpan: 7 }, h("p", { className: "vazio compacto" }, "Nenhuma transação no recorte. Ajuste ou limpe os filtros.")))
            : filtradas.map(function (t) {
                var exp = aberta === t.id;
                var linhas = [h("tr", { key: t.id, className: (t.alerta ? "com-alerta" : "") + (exp ? " expandida" : ""), tabIndex: 0,
                  "aria-expanded": exp ? "true" : "false",
                  onClick: function () { setAberta(exp ? null : t.id); },
                  onKeyDown: function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAberta(exp ? null : t.id); } } },
                  h("td", { className: "mono" }, h("span", { className: "seta-linha", "aria-hidden": "true" }, exp ? "▾" : "▸"), t.id),
                  h("td", null, t.quando),
                  h("td", { className: "mono" }, t.origem + " → " + t.destino),
                  h("td", { className: "num" }, num(t.valor, 2)),
                  h("td", null, t.formato),
                  h("td", { className: "num" }, h(ScoreCelula, { score: t.score })),
                  h("td", null, t.alerta ? h("span", { className: "alerta-celula" }, "Alerta") : h("span", { className: "sem-alerta-celula" }, "—")))];
                if (exp) linhas.push(h("tr", { key: t.id + "-x", className: "linha-extra" }, h("td", { colSpan: 7 },
                  h("dl", { className: "pares" },
                    h("div", null, h("dt", null, "predict_proba"), h("dd", { className: "mono" }, num(t.bruto, 4))),
                    h("div", null, h("dt", null, "Faixa"), h("dd", null, faixaDe(t.score).nome)),
                    h("div", null, h("dt", null, "Moeda"), h("dd", null, t.moeda)),
                    h("div", null, h("dt", null, "Histórico"), h("dd", null, t.incompleto ? h("span", { className: "selo atencao" }, "incompleto: < 72 h observadas") : "completo (72 h)"))),
                  h("p", { className: "motivos-titulo" }, "Justificativas verificáveis"),
                  t.motivos.length
                    ? h("ul", { className: "chips" }, t.motivos.map(function (m) { return h("li", { key: m, className: "chip" }, m); }))
                    : h("p", { className: "legenda" }, "Nenhum motivo verificável registrado para esta transação."),
                  h("p", { className: "legenda" }, "Motivos são fatos conferidos com regras fixas, não a explicação interna do Random Forest."))));
                return linhas;
              })))));
  }

  /* ----- Aba 3 · Investigação em grafo (pós-inferência) ----- */

  var NOS = [
    { id: "F", conta: "8004A1C20", papel: "Conta em foco", alerta: true, camada: 0, n: 9, max: 918 },
    { id: "A1", conta: "800B7E311", papel: "Recebeu da conta em foco", alerta: true, camada: 1, n: 2, max: 904 },
    { id: "A2", conta: "8012FD0A4", papel: "Recebeu da conta em foco", alerta: true, camada: 1, n: 2, max: 812 },
    { id: "A3", conta: "801C33E9B", papel: "Recebeu da conta em foco", alerta: false, camada: 1, n: 3, max: 412 },
    { id: "B1", conta: "8021A6F57", papel: "Reúne repasses e devolve à conta em foco", alerta: true, camada: 2, n: 3, max: 918 },
    { id: "C1", conta: "8030E1B62", papel: "Enviou para A3", alerta: false, camada: 0, n: 1, max: 155 },
    { id: "C2", conta: "8039D4C08", papel: "Recebeu de A3", alerta: false, camada: 2, n: 1, max: 88 },
    { id: "L1", conta: "8041AA713", papel: "Enviou para a conta em foco", alerta: false, camada: -1, n: 1, max: 64, folha: true },
    { id: "L2", conta: "8047C05E2", papel: "Enviou para a conta em foco", alerta: false, camada: -1, n: 1, max: 131, folha: true },
    { id: "L3", conta: "804E9B1F0", papel: "Enviou para a conta em foco", alerta: false, camada: -1, n: 1, max: 97, folha: true },
    { id: "L4", conta: "8053F27C6", papel: "Enviou para a conta em foco", alerta: false, camada: -1, n: 1, max: 342, folha: true }
  ];
  /* ordem: direta (liga à conta em foco), sequencia (horários compatíveis), simultanea (mesmo minuto), sem-ordem. */
  var ARESTAS = [
    { de: "L1", para: "F", valor: "4.120", hora: "08:12", ordem: "direta" },
    { de: "L2", para: "F", valor: "3.980", hora: "08:40", ordem: "direta" },
    { de: "L3", para: "F", valor: "4.050", hora: "09:05", ordem: "direta" },
    { de: "L4", para: "F", valor: "4.300", hora: "09:31", ordem: "direta" },
    { de: "F", para: "A1", valor: "9.800", hora: "10:02", ordem: "direta", alerta: true, seq: true },
    { de: "F", para: "A2", valor: "6.400", hora: "10:04", ordem: "direta", alerta: true, seq: true },
    { de: "F", para: "A3", valor: "1.150", hora: "10:04", ordem: "direta" },
    { de: "A1", para: "B1", valor: "9.700", hora: "10:09", ordem: "sequencia", alerta: true, seq: true },
    { de: "A2", para: "B1", valor: "6.300", hora: "10:11", ordem: "sequencia", alerta: true, seq: true },
    { de: "B1", para: "F", valor: "15.600", hora: "10:15", ordem: "sequencia", alerta: true, seq: true },
    { de: "C1", para: "A3", valor: "880", hora: "10:04", ordem: "simultanea" },
    { de: "A3", para: "C2", valor: "640", hora: "07:50", ordem: "sem-ordem" }
  ];
  var ORDEM_TXT = { direta: "direta (liga à conta em foco)", sequencia: "sequência com horários compatíveis", simultanea: "simultânea (mesmo minuto)", "sem-ordem": "sem ordem confirmada" };

  var GW = 720, GH = 430, CX = 360, CY = 215;

  function vistaGrafo(agrupar) {
    if (!agrupar) return { nos: NOS, arestas: ARESTAS };
    var nos = NOS.filter(function (n) { return !n.folha; }).concat([
      { id: "G", conta: "4 contas agrupadas", papel: "Folhas: cada uma enviou uma vez para a conta em foco", alerta: false, camada: -1, n: 4, max: 342, grupo: 4 }]);
    var arestas = ARESTAS.filter(function (a) { return a.de.charAt(0) !== "L"; }).concat([
      { de: "G", para: "F", valor: "16.450", hora: "08:12–09:31", ordem: "direta", agrupada: true }]);
    return { nos: nos, arestas: arestas };
  }

  function saltos(nos, arestas) {
    var viz = {}, dist = { F: 0 }, fila = ["F"];
    nos.forEach(function (n) { viz[n.id] = []; });
    arestas.forEach(function (a) { viz[a.de].push(a.para); viz[a.para].push(a.de); });
    while (fila.length) {
      var u = fila.shift();
      viz[u].forEach(function (v) { if (dist[v] === undefined) { dist[v] = dist[u] + 1; fila.push(v); } });
    }
    return { dist: dist, viz: viz };
  }

  function disporRadial(nos, arestas) {
    var s = saltos(nos, arestas), pos = { F: { x: CX, y: CY } };
    var ordem = { A1: 1, B1: 2, A2: 3, A3: 4, G: 5, L1: 5, L2: 6, L3: 7, L4: 8 };
    var anel1 = nos.filter(function (n) { return s.dist[n.id] === 1; }).sort(function (a, b) { return (ordem[a.id] || 9) - (ordem[b.id] || 9); });
    anel1.forEach(function (n, i) {
      var ang = -Math.PI / 2 + (i + 0.5) / anel1.length * Math.PI * 2;
      pos[n.id] = { x: CX + Math.cos(ang) * 150, y: CY + Math.sin(ang) * 135, ang: ang };
    });
    var porPai = {};
    nos.filter(function (n) { return s.dist[n.id] === 2; }).forEach(function (n) {
      var pai = s.viz[n.id].filter(function (v) { return s.dist[v] === 1; })[0];
      (porPai[pai] = porPai[pai] || []).push(n.id);
    });
    Object.keys(porPai).forEach(function (pai) {
      var filhos = porPai[pai], base = pos[pai].ang;
      filhos.forEach(function (id, i) {
        var ang = base + (i - (filhos.length - 1) / 2) * 0.42;
        pos[id] = { x: CX + Math.cos(ang) * 255, y: CY + Math.sin(ang) * 190 };
      });
    });
    return pos;
  }

  function disporCamadas(nos) {
    var pos = {}, porCamada = {};
    nos.forEach(function (n) { (porCamada[n.camada] = porCamada[n.camada] || []).push(n); });
    Object.keys(porCamada).forEach(function (c) {
      var lista = porCamada[c];
      var x = 110 + (Number(c) + 1) * 170;
      var temFoco = lista.some(function (n) { return n.id === "F"; });
      if (temFoco) {
        // a conta em foco fica no centro; as outras da mesma camada, abaixo dela
        var k = 0;
        lista.forEach(function (n) { pos[n.id] = { x: x, y: n.id === "F" ? CY : CY + (++k) * 110 }; });
      } else {
        lista.forEach(function (n, i) { pos[n.id] = { x: x, y: CY + (i - (lista.length - 1) / 2) * 82 }; });
      }
    });
    return pos;
  }

  function disporCircular(nos) {
    var pos = {}, outros = nos.filter(function (n) { return n.id !== "F"; });
    pos.F = { x: CX, y: CY };
    outros.forEach(function (n, i) {
      var ang = -Math.PI / 2 + i / outros.length * Math.PI * 2;
      pos[n.id] = { x: CX + Math.cos(ang) * 175, y: CY + Math.sin(ang) * 165 };
    });
    return pos;
  }

  /* Forças: molas nas arestas, repulsão entre nós e a conta em foco presa ao centro. Determinístico. */
  function disporForcas(nos, arestas) {
    var p = disporCircular(nos), ids = nos.map(function (n) { return n.id; });
    ids.forEach(function (id, i) { p[id] = { x: p[id].x + (i % 3) * 7, y: p[id].y - (i % 2) * 9 }; });
    for (var it = 0; it < 320; it++) {
      var d = {};
      ids.forEach(function (id) { d[id] = { x: 0, y: 0 }; });
      for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) {
        var a = p[ids[i]], b = p[ids[j]], dx = a.x - b.x, dy = a.y - b.y, q = dx * dx + dy * dy + 0.01, f = 5200 / q;
        var l = Math.sqrt(q);
        d[ids[i]].x += dx / l * f; d[ids[i]].y += dy / l * f; d[ids[j]].x -= dx / l * f; d[ids[j]].y -= dy / l * f;
      }
      arestas.forEach(function (e) {
        var a = p[e.de], b = p[e.para], dx = b.x - a.x, dy = b.y - a.y, l = Math.sqrt(dx * dx + dy * dy) + 0.01, f = (l - 105) * 0.06;
        d[e.de].x += dx / l * f; d[e.de].y += dy / l * f; d[e.para].x -= dx / l * f; d[e.para].y -= dy / l * f;
      });
      ids.forEach(function (id) {
        if (id === "F") return;
        p[id] = { x: Math.max(40, Math.min(GW - 40, p[id].x + Math.max(-12, Math.min(12, d[id].x + (CX - p[id].x) * 0.004)))),
                  y: Math.max(36, Math.min(GH - 36, p[id].y + Math.max(-12, Math.min(12, d[id].y + (CY - p[id].y) * 0.004)))) };
      });
    }
    return p;
  }

  var DISPOSICOES = [
    { id: "radial", nome: "Radial", fn: disporRadial, desc: "conta em foco no centro e anéis por número de saltos" },
    { id: "camadas", nome: "Camadas", fn: disporCamadas, desc: "da esquerda para a direita, na direção do dinheiro" },
    { id: "circular", nome: "Circular", fn: disporCircular, desc: "todas as contas num círculo, foco no centro" },
    { id: "forcas", nome: "Forças", fn: disporForcas, desc: "molas e repulsão: grupos ligados ficam juntos" }
  ];

  function Grafo() {
    var _d = useState("radial"), disp = _d[0], setDisp = _d[1];
    var _g = useState(true), agrupar = _g[0], setAgrupar = _g[1];
    var _o = useState(false), ordem = _o[0], setOrdem = _o[1];
    var _v = useState(true), valores = _v[0], setValores = _v[1];
    var _s = useState("F"), sel = _s[0], setSel = _s[1];
    var _z = useState(1), zoom = _z[0], setZoom = _z[1];

    var vista = useMemo(function () { return vistaGrafo(agrupar); }, [agrupar]);
    var alvo = useMemo(function () {
      var d = DISPOSICOES.filter(function (x) { return x.id === disp; })[0];
      return d.fn(vista.nos, vista.arestas);
    }, [disp, vista]);

    // Transição suave entre disposições (sem animação com movimento reduzido).
    var _p = useState(alvo), pos = _p[0], setPos = _p[1];
    var posRef = useRef(alvo);
    useEffect(function () {
      if (semMovimento) { posRef.current = alvo; setPos(alvo); return; }
      var de = posRef.current, ini = null, raf;
      function passo(t) {
        if (ini === null) ini = t;
        var k = Math.min(1, (t - ini) / 480), e = 1 - Math.pow(1 - k, 3), nova = {};
        Object.keys(alvo).forEach(function (id) {
          var a = de[id] || de.F || alvo[id], b = alvo[id];
          nova[id] = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
        });
        posRef.current = nova;
        setPos(nova);
        if (k < 1) raf = requestAnimationFrame(passo);
      }
      raf = requestAnimationFrame(passo);
      // Garantia: sem quadros de animação (aba em segundo plano), o grafo chega ao destino mesmo assim.
      var fim = setTimeout(function () { cancelAnimationFrame(raf); posRef.current = alvo; setPos(alvo); }, 650);
      return function () { cancelAnimationFrame(raf); clearTimeout(fim); };
    }, [alvo]);

    var porId = {};
    vista.nos.forEach(function (n) { porId[n.id] = n; });
    var noSel = porId[sel] || porId.F;
    var vw = GW / zoom, vh = GH / zoom, vb = [CX - vw / 2, CY - vh / 2, vw, vh].join(" ");
    var arestasSel = vista.arestas.filter(function (a) { return a.de === noSel.id || a.para === noSel.id; });

    function raio(n) { return n.id === "F" ? 17 : n.grupo ? 15 : 11; }

    return h(Moldura, { vista: "Contas · Grafo da conta em foco", selos: [h(Selo, { key: "a", tom: "acao" }, "pós-inferência"), h(Selo, { key: "b", tom: "neutro" }, "não altera o score")] },
      h("div", { className: "grafo-barra" },
        h("label", { className: "campo" }, h("span", null, "Disposição"),
          h("select", { value: disp, onChange: function (e) { setDisp(e.target.value); } },
            DISPOSICOES.map(function (d) { return h("option", { key: d.id, value: d.id }, d.nome); }))),
        h("label", { className: "alternar", title: "Reúne contas com uma única ligação à mesma conta e no mesmo papel" },
          h("input", { type: "checkbox", checked: agrupar, onChange: function (e) { setAgrupar(e.target.checked); if (e.target.checked && String(sel).charAt(0) === "L") setSel("F"); if (!e.target.checked && sel === "G") setSel("F"); } }), "Agrupar folhas"),
        h("label", { className: "alternar" }, h("input", { type: "checkbox", checked: ordem, onChange: function (e) { setOrdem(e.target.checked); } }), "Ordem no tempo"),
        h("label", { className: "alternar" }, h("input", { type: "checkbox", checked: valores, onChange: function (e) { setValores(e.target.checked); } }), "Valores"),
        h("span", { className: "legenda-demo" }, DISPOSICOES.filter(function (x) { return x.id === disp; })[0].desc)),
      h("div", { className: "grafo-palco" },
        h("div", { className: "grafo-moldura demo-grafo" },
          h("svg", { viewBox: vb, role: "img", "aria-label": "Grafo da conta em foco 8004A1C20 com " + vista.nos.length + " contas e " + vista.arestas.length + " ligações. Disposição " + disp + "." },
            h("defs", null,
              h("marker", { id: "gs-cinza", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto" }, h("path", { d: "M0,0 L10,5 L0,10 z", fill: "#6b6b6b" })),
              h("marker", { id: "gs-alerta", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto" }, h("path", { d: "M0,0 L10,5 L0,10 z", fill: "#ff5a5a" })),
              h("marker", { id: "gs-branca", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto" }, h("path", { d: "M0,0 L10,5 L0,10 z", fill: "#ffffff" }))),
            vista.arestas.map(function (a) {
              var p1 = pos[a.de], p2 = pos[a.para];
              if (!p1 || !p2) return null;
              var n1 = porId[a.de], n2 = porId[a.para];
              var dx = p2.x - p1.x, dy = p2.y - p1.y, l = Math.sqrt(dx * dx + dy * dy) || 1;
              var x1 = p1.x + dx / l * raio(n1), y1 = p1.y + dy / l * raio(n1), x2 = p2.x - dx / l * (raio(n2) + 3), y2 = p2.y - dy / l * (raio(n2) + 3);
              var naSeq = ordem && a.seq, apagada = ordem && !a.seq;
              var cls = "g-aresta" + (a.alerta ? " alerta" : "") + (a.agrupada ? " agrupada" : "") + (a.ordem === "sem-ordem" ? " sem-ordem" : "") + (naSeq ? " na-sequencia" : "") + (apagada ? " apagada" : "");
              var mk = naSeq ? "url(#gs-branca)" : a.alerta ? "url(#gs-alerta)" : "url(#gs-cinza)";
              var d = "M" + x1.toFixed(1) + " " + y1.toFixed(1) + " L" + x2.toFixed(1) + " " + y2.toFixed(1);
              var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
              return h("g", { key: a.de + a.para, className: cls },
                h("path", { className: "traco", d: d, markerEnd: mk }),
                valores ? h("text", { x: mx, y: my - 5, textAnchor: "middle" }, a.valor + " ", h("tspan", { className: "hora" }, a.hora)) : null);
            }),
            vista.nos.map(function (n) {
              var p = pos[n.id];
              if (!p) return null;
              var cls = "g-no" + (n.id === "F" ? " foco" : "") + (n.alerta ? " alerta" : "") + (n.grupo ? " grupo" : "") + (sel === n.id ? " selecionado" : "") +
                (ordem && !(n.id === "F" || n.id === "A1" || n.id === "A2" || n.id === "B1") ? " apagado" : "");
              var r = raio(n);
              return h("g", { key: n.id, className: cls, transform: "translate(" + p.x.toFixed(1) + " " + p.y.toFixed(1) + ")",
                tabIndex: 0, role: "button", "aria-label": "Conta " + n.conta + (n.alerta ? ", com alerta" : "") + ". " + n.papel,
                onClick: function () { setSel(n.id); },
                onKeyDown: function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(n.id); } } },
                n.id === "F" ? h("circle", { className: "halo", r: r + 9 }) : null,
                n.grupo ? h("circle", { className: "pilha", r: r, cx: 4, cy: -4 }) : null,
                h("circle", { className: "corpo", r: r }),
                n.id === "F" ? h("circle", { className: "anel", r: r + 4 }) : null,
                n.grupo ? h("text", { className: "contagem", textAnchor: "middle", dy: 4 }, "+" + n.grupo) : h("circle", { className: "nucleo", r: n.id === "F" ? 4 : 3 }),
                sel === n.id ? h("circle", { className: "selecao-anel", r: r + 6 }) : null,
                h("text", { className: "g-rotulo", textAnchor: "middle", y: r + 14 }, n.grupo ? "4 folhas" : n.conta.slice(0, 5) + "…"));
            })),
          h("div", { className: "grafo-controles" },
            h("button", { type: "button", "aria-label": "Aproximar", onClick: function () { setZoom(Math.min(2, zoom + 0.2)); } }, "+"),
            h("button", { type: "button", "aria-label": "Afastar", onClick: function () { setZoom(Math.max(0.6, zoom - 0.2)); } }, "−"),
            h("button", { type: "button", "aria-label": "Enquadrar", onClick: function () { setZoom(1); } }, "⤢")),
          h("span", { className: "grafo-zoom mono" }, Math.round(zoom * 100) + "%")),
        h("aside", { className: "grafo-detalhe" },
          h("p", { className: "eyebrow" }, noSel.id === "F" ? "Conta em foco" : noSel.grupo ? "Grupo de folhas" : "Conta selecionada"),
          h("p", { className: "gd-conta mono" }, noSel.conta),
          noSel.alerta ? h("span", { className: "selo alerta" }, "⚠ ligada a alerta") : h("span", { className: "selo neutro" }, "sem alerta"),
          h("dl", { className: "pares" },
            h("dt", null, "Papel"), h("dd", null, noSel.papel),
            h("dt", null, "Transações"), h("dd", null, noSel.n),
            h("dt", null, "Score máximo"), h("dd", null, h(ScoreCelula, { score: noSel.max }))),
          h("p", { className: "motivos-titulo" }, "Ligações"),
          h("ul", { className: "gd-ligacoes" }, arestasSel.map(function (a) {
            var outro = a.de === noSel.id ? porId[a.para] : porId[a.de];
            return h("li", { key: a.de + a.para },
              h("span", { className: "mono" }, (a.de === noSel.id ? "→ " : "← ") + (outro.grupo ? "4 folhas" : outro.conta)),
              h("small", null, a.valor + " · " + a.hora + " · " + ORDEM_TXT[a.ordem]));
          })),
          ordem ? h("p", { className: "aviso-mini" }, "Sequência destacada: 8004A1C20 → 800B7E311 / 8012FD0A4 → 8021A6F57 → 8004A1C20, com horários compatíveis (10:02 → 10:15). Um ciclo em 13 minutos.") : null)),
      h("ul", { className: "grafo-legenda" },
        h("li", null, h("i", { className: "lg-no foco" }), "conta em foco"),
        h("li", null, h("i", { className: "lg-no alerta" }), "ligada a alerta"),
        h("li", null, h("i", { className: "lg-no lg-grupo" }), "folhas agrupadas"),
        h("li", null, h("i", { className: "lg-aresta seq" }), "sequência no tempo"),
        h("li", null, h("i", { className: "lg-aresta sem" }), "sem ordem confirmada")));
  }

  /* ----- Aba 4 · Sentinel AI ----- */

  var RESPOSTAS = [
    { chaves: ["tx-11", "904", "por que", "porque", "motivo"], pergunta: "Por que a TX-11 tem score 904?", partes: [
      ["fato", "A TX-11 tem predict_proba 0,7100 e score 904, na faixa alta: está acima do limiar de alerta (701)."],
      ["fato", "Motivos verificáveis registrados: primeira transação entre origem e destino; origem recebeu fundos há menos de 60 min."],
      ["limitacao", "Os motivos são fatos conferidos com regras fixas, não a explicação interna do Random Forest."]] },
    { chaves: ["intermedi", "301", "700"], pergunta: "O que é a faixa intermediária?", partes: [
      ["fato", "Scores de 301 a 700: abaixo do limiar de alerta, de cerca de 43% a 100% dele."],
      ["inferencia", "Vale revisar se outras evidências, como a rede da conta no grafo, apontarem na mesma direção."]] },
    { chaves: ["probab", "calibr", "chance", "porcent"], pergunta: "O score é uma probabilidade?", partes: [
      ["fato", "Não. Ele vem do predict_proba, a proporção dos votos das árvores, num modelo treinado com negativos subamostrados e peso 5."],
      ["limitacao", "Serve para ordenar a fila. Não leia 904 como 90% de chance de lavagem."]] },
    { chaves: ["histór", "histor", "incomplet", "72"], pergunta: "O que é histórico incompleto?", partes: [
      ["fato", "A conta tem menos de 72 h observadas antes da transação: as janelas de 72 h ainda não estão cheias."],
      ["inferencia", "O score dessas transações tende a ser menos informativo; confira o contexto antes de decidir."]] },
    { chaves: ["tipolog", "padr", "fan", "ciclo", "cycle"], pergunta: "As tipologias entram no modelo?", partes: [
      ["fato", "Não. O modelo recebe só os 49 atributos calculados com o passado. As tipologias do simulador serviram apenas para avaliar o recall por esquema."],
      ["limitacao", "Por isso o painel não pede arquivo de tipologias nem as mostra como resposta."]] }
  ];
  var TAG = { fato: "Fato", inferencia: "Inferência", limitacao: "Limitação" };

  function responder(texto) {
    var t = texto.toLowerCase();
    for (var i = 0; i < RESPOSTAS.length; i++) {
      for (var j = 0; j < RESPOSTAS[i].chaves.length; j++) if (t.indexOf(RESPOSTAS[i].chaves[j]) >= 0) return RESPOSTAS[i].partes;
    }
    return [["limitacao", "Não encontrei isso no glossário local. No painel, o modo local responde com glossário, ajuda de uso e números lidos dos resultados gravados; perguntas abertas vão ao Sentinel AI só com autorização da sessão."]];
  }

  function Sentinel() {
    var _a = useState(false), autorizado = _a[0], setAutorizado = _a[1];
    var _m = useState([]), msgs = _m[0], setMsgs = _m[1];
    var _t = useState(""), texto = _t[0], setTexto = _t[1];
    var lista = useRef(null);

    useEffect(function () { if (lista.current) lista.current.scrollTop = lista.current.scrollHeight; }, [msgs]);

    function perguntar(q) {
      q = (q || "").trim();
      if (!q) return;
      setMsgs(function (m) { return m.concat([{ quem: "eu", texto: q }, { quem: "ia", partes: responder(q) }]); });
      setTexto("");
    }

    var estado = autorizado
      ? h(Selo, { tom: "neutro" }, "Sentinel AI autorizado · conexão não verificada")
      : h(Selo, { tom: "ok" }, "Modo local · determinístico");

    return h("div", { className: "sentinel-grade" },
      h("div", { className: "assistente-painel", role: "region", "aria-label": "Assistente de dúvidas (demonstração)" },
        h("div", { className: "as-cabeca" },
          h("div", null, h("p", { className: "as-titulo" }, "Assistente de dúvidas"), h("p", { className: "as-sub" }, "Sentinel AI · contexto verificado da análise")),
          estado),
        h("label", { className: "as-autorizar" },
          h("input", { type: "checkbox", checked: autorizado, onChange: function (e) { setAutorizado(e.target.checked); } }),
          h("span", null, h("strong", null, "Autorizar o Sentinel AI nesta sessão"), " (envia a pergunta e o contexto verificado a um modelo de linguagem externo)")),
        autorizado ? h("p", { className: "aviso-mini" }, "Nesta página estática nenhuma chamada externa é feita: as respostas abaixo continuam locais. No painel, só depois desta autorização a pergunta iria para o modelo configurado (Gemini ou Anthropic).") : null,
        h("div", { className: "as-mensagens", ref: lista, "aria-live": "polite" },
          msgs.length === 0 ? h("p", { className: "legenda" }, "Escolha uma pergunta ou escreva a sua. Sem autorização, tudo é respondido localmente, sem internet e sempre com a mesma resposta.") : null,
          msgs.map(function (m, i) {
            if (m.quem === "eu") return h("p", { key: i, className: "sm-pergunta" }, m.texto);
            return h("div", { key: i, className: "sm-resposta" }, m.partes.map(function (p, k) {
              return h("p", { key: k }, h("span", { className: "sm-tag sm-" + p[0] }, TAG[p[0]]), " " + p[1]);
            }));
          })),
        h("div", { className: "chips as-sugestoes" }, RESPOSTAS.map(function (r) {
          return h("button", { key: r.pergunta, type: "button", className: "chip", onClick: function () { perguntar(r.pergunta); } }, r.pergunta);
        })),
        h("form", { className: "as-form", onSubmit: function (e) { e.preventDefault(); perguntar(texto); } },
          h("label", { className: "sr", htmlFor: "as-entrada" }, "Pergunta ao assistente"),
          h("input", { id: "as-entrada", type: "text", value: texto, placeholder: "Pergunte sobre score, faixas, motivos…", autoComplete: "off", onChange: function (e) { setTexto(e.target.value); } }),
          h("button", { type: "submit", className: "botao-app primario" }, "Enviar"))),
      h("ul", { className: "lista-curta sentinel-pontos" },
        h("li", null, h("strong", null, "Modo local (padrão):"), " responde sem internet e de forma determinística, com glossário, ajuda de uso e números lidos dos resultados gravados."),
        h("li", null, h("strong", null, "Via API, só com autorização:"), " a aba precisa autorizar explicitamente o Sentinel AI na sessão; sem isso, nada sai da máquina."),
        h("li", null, h("strong", null, "Contexto verificado:"), " manifesto, recorte, transação em foco e métricas oficiais; cada resposta separa fatos, inferências e limitações."),
        h("li", null, h("strong", null, "Não detecta nada:"), " explica os resultados e não altera nenhum score nem alerta.")));
  }

  /* ----- Abas do painel ----- */

  var CAPTURAS = {
    execucao: ["./site-assets/img/tela-analise.jpg", "Captura real: vista Análise com as cinco etapas concluídas"],
    visao: ["./site-assets/img/tela-visao.jpg", "Captura real: visão geral com indicadores e faixas de score"],
    grafo: ["./site-assets/img/tela-grafo.jpg", "Captura real: grafo da conta em foco com contas em alerta"]
  };

  function BotaoCaptura(props) {
    var c = CAPTURAS[props.id];
    if (!c) return null;
    return h("button", { type: "button", className: "link-captura", onClick: function () {
      var img = new Image(); img.src = c[0]; img.alt = c[1];
      if (window.nwAbrirImagem) window.nwAbrirImagem(img, c[1]);
    } }, "Ver captura real do painel ↗");
  }

  var ABAS_DEMO = [
    { id: "execucao", rotulo: "Execução ao vivo", curto: "latência · log · métricas", conteudo: function () {
      return h("div", null, h(Execucao), h(BotaoCaptura, { id: "execucao" }));
    } },
    { id: "visao", rotulo: "Visão geral & tabela", curto: "KPIs · 3 faixas · filtros", conteudo: function () {
      return h("div", null, h(Visao), h(BotaoCaptura, { id: "visao" }));
    } },
    { id: "grafo", rotulo: "Investigação em grafo", curto: "pós-inferência", conteudo: function () {
      return h("div", null, h(Grafo), h(BotaoCaptura, { id: "grafo" }));
    } },
    { id: "sentinel", rotulo: "Sentinel AI", curto: "local ou API autorizada", conteudo: function () {
      return h(Sentinel);
    } }
  ];

  function PainelDemo() {
    return h(Abas, { prefixo: "demo", rotulo: "Telas do painel do analista", numerar: true, classe: "abas-painel demo", itens: ABAS_DEMO });
  }

  montar("conversao-score", Conversao);
  montar("pipeline-interativo", Pipeline);
  montar("painel-demo", PainelDemo);
})();
