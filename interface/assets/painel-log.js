/* NodeWatch — log da execução na tela de análise.
   Três peças, todas com dados reais do servidor:
     MetricasExecucao     área fixa (sticky): durante a análise, quatro blocos ao vivo (pontuação, log, RAM);
                          depois do fim, uma linha de resumo e o atalho para a Operação (casa das métricas completas);
     ListaFluxo           transações já pontuadas, em lista virtualizada (o DOM só tem as linhas visíveis);
                          as que chegam enquanto a lista segue as mais recentes entram com um realce curto (CSS);
     ResumoPrecisaoRecall precisão e recall do dataset (parciais durante a análise, finais ao terminar).
   Valor ausente aparece como "indisponível", nunca 0. Sem temporizadores próprios: o manifesto chega pelo polling
   da página (1 s), RAM e CPU por useIntervalo (2 s, só durante a análise) e a rolagem usa requestAnimationFrame. */
(function () {
  'use strict';
  const { h, f, api, useCarga, useIntervalo, Aviso, Erro, Legenda, Selo, Icone, Dica, NOME_FAIXA, exibir } = window.NW;
  const ROTULO = exibir('rotulo'), BASE_TREINO = exibir('base_treino');   // ponto único (painel-base.js)

  /* Precisão e recall: com o rótulo do dataset escondido, a mesma conta (alerta × rótulo) com redação neutra.
     Compartilhado com as métricas do painel operacional (painel-secoes.js). */
  const TEXTO_METRICAS = Object.freeze(ROTULO ? {
    conferiveis: 'com rótulo', positivos: 'rotuladas como lavagem', nenhum_positivo: 'nenhuma transação rotulada como lavagem',
    calculado: 'só as que têm rótulo no dataset',
    sem_referencia: 'O dataset não tem coluna de rótulo de lavagem (por exemplo, "Is Laundering"): sem rótulo não há como medir acertos.',
    nenhuma_conferivel: 'Nenhuma das transações pontuadas tem rótulo.',
    precisao: null, recall: null, origem: null,             // null: usa o texto que vem da API
    vp: 'rotulados como lavagem', fp: 'não', conjunto: 'num conjunto com rótulo',
  } : {
    conferiveis: 'conferíveis', positivos: 'casos de referência', nenhum_positivo: 'nenhum caso de referência',
    calculado: 'só as que têm referência para conferência no arquivo',
    sem_referencia: 'Este arquivo não traz referência para conferir acertos: sem ela não há como medir precisão e recall.',
    nenhuma_conferivel: 'Nenhuma das transações pontuadas tem referência para conferência.',
    precisao: 'Entre as transações com alerta, a fração que está entre os casos de referência.',
    recall: 'Entre os casos de referência, a fração que recebeu alerta.',
    origem: 'calculado com a referência que veio no próprio arquivo, sobre as transações pontuadas nesta análise',
    vp: 'entre os casos de referência', fp: 'fora deles', conjunto: 'num conjunto com referência',
  });

  const INDISPONIVEL = 'indisponível';
  const SO_AO_VIVO = 'indisponível (medidas ao vivo só existem durante a análise)';
  const OPERACAO_LOG = 'fluxo de transações';       // nome da latência registrada pela rota /fluxo
  const ATUALIZA_MS = 2000;
  const ANUNCIO_MS = 10000;
  const JANELA = 200;                                // transações por consulta (limite do servidor)
  const MAX_PAGINAS = 20;                            // páginas guardadas em memória
  const SOBRA = 10;                                  // linhas desenhadas além das visíveis, acima e abaixo
  const ALTURA_MAX_PX = 8000000;                     // acima disso, a rolagem é proporcional (milhões de linhas)
  const NOME_STATUS = { em_andamento: 'em andamento', concluida: 'concluída', cancelada: 'cancelada', parcial: 'parcial', erro: 'com erro' };
  const TEXTO_ID = 'ID de exibição gerado pelo NodeWatch em ordem cronológica; não é o ID do arquivo';
  const TEXTO_SEM_TIPOLOGIA = 'sem tipologia registrada no dataset; não significa que não seja lavagem';
  const NOTA_IBM = 'Dados IBM AML são simulados; alerta não é confirmação de lavagem nem de fraude.';

  const vazio = f.vazio;
  /* tipologias só existem em análises gravadas por versões anteriores (arquivo de padrões) */
  const comTipologias = m => !!(m.tipologias && m.tipologias.disponivel);
  const hora = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleTimeString('pt-BR'); };
  const dia = s => { const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return r ? r[3] + '/' + r[2] + '/' + r[1] : INDISPONIVEL; };
  const pct100 = v => vazio(v) ? INDISPONIVEL : f.numero(v, 1) + '%';   // /operacao/desempenho manda 0–100
  const ms = v => vazio(v) ? INDISPONIVEL : f.numero(v, 1) + ' ms';

  /* ── Limiar e base do treino (texto compartilhado com o painel operacional) ── */
  function textoLimiar(m) {
    const mod = m.modelo, conv = m.conversao_score;
    if (!mod || !conv || !conv.ancoras || !conv.ancoras[1]) return 'Limiar de alerta do modelo: indisponível até o modelo ser carregado.';
    return 'Limiar de alerta do modelo ' + (mod.versao || INDISPONIVEL) + ': score ' + conv.ancoras[1].score + ' (original ' + f.numero(conv.limiar_bruto, 4) + ').';
  }
  const situacaoTreino = m => {
    const a = (m.dataset || {}).sha256, b = (m.modelo || {}).sha256_treino;
    return a && b && a === b ? 'confirmado' : 'nao_confirmado';
  };
  const treinoDoManifesto = m => { const mo = m.modelo || {}; return { fonte: mo.fonte, limites: mo.limites_treino, sha256: mo.sha256_treino }; };
  function AvisoBaseTreino({ situacao, treino }) {
    const t = treino || {}, lim = t.limites || {};
    const fonte = t.fonte || 'fonte indisponível nos metadados do modelo';
    if (situacao === 'confirmado') return h(Aviso, { tom: 'erro', silencioso: true, titulo: 'Base usada no treino do modelo: confirmado' },
      h('p', null, 'Esta base é o arquivo usado no treino do modelo (' + fonte + '; treino até ' + dia(lim.treino_ate) + ', validação até ' + dia(lim.validacao_ate) +
        '). Estas métricas não medem desempenho em dados novos.'),
      h(Legenda, null, 'Confirmado porque o SHA-256 deste arquivo é igual ao do arquivo de treino.'));
    return h(Aviso, { tom: 'atencao', titulo: 'Base usada no treino do modelo: não confirmado' },
      h('p', null, 'Não foi possível confirmar se esta base foi usada no treino. O modelo foi treinado com ' + fonte + ' (' + dia(lim.inicio) + ' a ' + dia(lim.treino_ate) +
        '); se este arquivo for o mesmo conjunto em outro empacotamento (CSV × ZIP), as métricas não são de dados novos.'),
      h(Legenda, null, 'A comparação é só pelo SHA-256 do arquivo. Datas parecidas não provam nada: outro dataset pode cobrir o mesmo período sem ser o mesmo dado.'));
  }

  /* ── Leituras de RAM e CPU: só nesta aba, só durante a análise (nada vai para o manifesto) ── */
  function useDesempenho(m) {
    const vivo = m.status === 'em_andamento';
    const [est, setEst] = React.useState({ id: m.id, dados: null, falhou: false });
    const ler = () => {
      const id = m.id;
      api('/operacao/desempenho')
        .then(d => setEst(e => (e.id === id ? { id, dados: d, falhou: false } : e)))
        .catch(() => setEst(e => (e.id === id ? Object.assign({}, e, { falhou: true }) : e)));
    };
    React.useEffect(() => { setEst({ id: m.id, dados: null, falhou: false }); }, [m.id]);
    React.useEffect(() => { if (vivo) ler(); }, [m.id, vivo]);
    useIntervalo(ler, ATUALIZA_MS, vivo);
    return { vivo, dados: est.id === m.id ? est.dados : null, falhou: est.id === m.id && est.falhou };
  }

  /* Um bloco de métrica: rótulo curto e valor; sem medida, "—" (o motivo fica na dica, sem repetir frases longas). */
  function Metrica({ nome, valor, sub, dica }) {
    const falta = vazio(valor);
    return h('div', { className: 'log-metrica', title: dica || undefined },
      h('dt', null, nome),
      h('dd', null, h('strong', { className: falta ? 'indisponivel' : undefined }, falta ? '—' : valor), sub ? h('span', { className: 'log-detalhe' }, sub) : null,
        dica ? h('span', { className: 'sr' }, ' (' + dica + ')') : null));
  }

  /* Em tela estreita a área aberta ocuparia o contêiner inteiro: começa recolhida (o resumo continua no título). */
  const telaEstreita = () => { try { return window.matchMedia('(max-width: 720px)').matches; } catch (e) { return false; } };

  function MetricasExecucao({ m, leitura, aoOperacao }) {
    const [aberto, setAberto] = React.useState(() => !telaEstreita());
    const pont = m.etapas.find(e => e.id === 'pontuacao');
    const ub = pont && pont.progresso ? pont.progresso.ultimo_bloco : null;
    const d = leitura.dados;
    const lat = d && (d.latencias || []).find(x => x.operacao === OPERACAO_LOG);
    const semLeitura = !leitura.vivo && !d;          // reaberta do histórico: esta aba não leu nada ao vivo
    const ram = d ? d.memoria : null;
    const mp = ram && ram.processo, mm = ram && ram.maquina;
    const motivo = semLeitura ? SO_AO_VIVO : INDISPONIVEL;
    const dicaPontuacao = ub ? 'Último bloco de pontuação no servidor: atributos ' + ms(ub.atributos_ms) + ' · inferência ' + ms(ub.inferencia_ms) + ' · gravação ' + ms(ub.gravacao_ms) + ' · medido às ' + hora(ub.medido_em)
      : 'Nenhum bloco de pontuação medido nesta análise.';
    const ramProcesso = mp && !vazio(mp.bytes) ? f.gb(mp.bytes) : null;
    /* Análise encerrada: os blocos ao vivo viram uma linha só; o detalhe (latências, CPU, pico, vazão) mora na Operação. */
    if (!leitura.vivo) {
      const dicaRam = ramProcesso ? 'Memória usada pelo processo NodeWatch (GB, 10⁹ bytes), na última leitura desta aba: ' + hora(d.medido_em) + ', antes do fim da análise.' : motivo;
      const ultima = ub && !vazio(ub.total_ms) ? ms(ub.total_ms) : null;
      return h('div', { className: 'log-metricas-fim' },
        h('p', null,
          h('span', { className: 'log-rot' }, 'Última pontuação '), h('strong', { title: dicaPontuacao, className: ultima ? undefined : 'indisponivel' }, ultima || '—'),
          h('span', { className: 'sr' }, ' (' + dicaPontuacao + ')'),
          h('span', { className: 'log-sep', 'aria-hidden': 'true' }, ' · '),
          h('span', { className: 'log-rot' }, 'RAM do processo '), h('strong', { title: dicaRam, className: ramProcesso ? undefined : 'indisponivel' }, ramProcesso || '—'),
          h('span', { className: 'sr' }, ' (' + dicaRam + ')')),
        aoOperacao ? h('button', { type: 'button', className: 'botao pequeno fantasma', onClick: aoOperacao, 'aria-controls': 'painel-operacional',
          title: 'A Operação mostra o processo agora e a análise ativa ou a última encerrada (pode não ser esta).' },
          h(Icone, { nome: 'operacao' }), 'Abrir Operação') : null);
    }
    let rodape;
    if (!d) rodape = leitura.falhou ? 'Leitura falhou · nova tentativa em 2 s.' : 'Lendo…';
    else if (leitura.falhou) rodape = 'Sem atualização desde ' + hora(d.medido_em) + ' · nova tentativa em 2 s.';
    else rodape = 'Ao vivo · ' + hora(d.medido_em) + ' · atualiza a cada 2 s.';
    return h('details', { className: 'log-metricas-area', open: aberto, onToggle: e => setAberto(e.currentTarget.open) },
      h('summary', null, 'Métricas de execução', aberto ? null : h('span', { className: 'log-detalhe', style: { textTransform: 'none', letterSpacing: 0 } },
        ' — última pontuação ' + (ub ? ms(ub.total_ms) : '—') + ' · RAM ' + (ramProcesso || '—'))),
      h('dl', { className: 'log-metricas' },
        h(Metrica, { nome: 'Última pontuação', valor: ub ? ms(ub.total_ms) : null, sub: ub ? f.plural(ub.transacoes, 'transação', 'transações') : null, dica: dicaPontuacao }),
        h(Metrica, { nome: 'Log de transações', valor: lat ? ms(lat.ultima_ms) : null, sub: lat ? 'mediana ' + ms(lat.mediana_ms) : null,
          dica: lat ? 'Latência da consulta do log ("' + OPERACAO_LOG + '", servidor): última; mediana ' + ms(lat.mediana_ms) + ' ' + (lat.amostras === 1 ? 'em 1 consulta' : 'das últimas ' + f.inteiro(lat.amostras) + ' consultas') + ' · medido às ' + hora(lat.medido_em)
            : 'Aparece depois da primeira consulta do log.' }),
        h(Metrica, { nome: 'RAM do processo', valor: ramProcesso, sub: mp && !vazio(mp.percentual_da_maquina) ? pct100(mp.percentual_da_maquina) + ' da máquina' : null,
          dica: ramProcesso ? 'Memória usada pelo processo NodeWatch, em GB (10⁹ bytes).' : motivo }),
        h(Metrica, { nome: 'RAM do sistema', valor: mm && !vazio(mm.em_uso_bytes) ? f.gb(mm.em_uso_bytes) : null, sub: mm && !vazio(mm.total_bytes) ? 'de ' + f.gb(mm.total_bytes) : null,
          dica: mm && !vazio(mm.em_uso_bytes) ? 'Memória em uso no computador: ' + (vazio(mm.percentual) ? INDISPONIVEL : pct100(mm.percentual)) + '.' : motivo })),
      h('p', { className: 'log-rodape' }, rodape));
  }

  /* ── Uma entrada do log (altura fixa, definida no CSS por largura de tela) ── */
  const textoRotulo = (l, comRotulo) => !comRotulo || l.rotulo === null || l.rotulo === undefined ? 'sem rótulo' : l.rotulo === 1 ? 'lavagem' : 'não lavagem';
  /* setsize: total final, ou -1 (desconhecido, válido em role=feed) enquanto a análise cresce; assim o React.memo
     não redesenha todas as entradas visíveis a cada atualização do manifesto. */
  /* nova: chegou no último bloco enquanto a lista seguia as mais recentes; o realce é uma animação CSS que roda
     uma vez quando a entrada aparece (a chave é o ID de exibição) e some com movimento reduzido. */
  const Entrada = React.memo(function Entrada({ l, topo, setsize, validas, comRotulo, comTipologias, nova }) {
    const idTitulo = 'log-tx-' + l.id_exibicao;
    const tipos = comTipologias ? (l.tipologias || []).filter(t => !/nao_identificado$/.test(t)) : [];
    return h('article', { className: 'log-entrada' + (l.alerta ? ' com-alerta' : '') + (nova ? ' nova' : ''), style: { top: topo + 'px' }, tabIndex: -1,
      'aria-posinset': l.id_exibicao, 'aria-setsize': setsize, 'aria-labelledby': idTitulo },
      h('div', { className: 'log-cab', id: idTitulo },
        h('span', { className: 'log-pos' }, h('span', { className: 'sr' }, 'Posição no fluxo: '), 'nº ' + f.inteiro(l.id_exibicao)),
        h('span', { className: 'mono log-id', title: TEXTO_ID }, h('span', { className: 'sr' }, 'ID de exibição (gerado pelo NodeWatch): '), f.idExibicao(l.id_exibicao, validas)),
        h('span', null, h('span', { className: 'sr' }, 'Data e hora: '), f.dataHora(l.data_hora))),
      h('div', null, h('span', { className: 'log-rot' }, 'Origem: '), 'Banco ' + l.banco_origem + ' · Conta ', h('span', { className: 'mono' }, l.conta_origem)),
      h('div', null, h('span', { className: 'log-rot' }, 'Destino: '), 'Banco ' + l.banco_destino + ' · Conta ', h('span', { className: 'mono' }, l.conta_destino)),
      h('div', null, h('span', { className: 'log-rot' }, 'Valor: '), h('span', { className: 'log-valor' }, f.valor(l.valor_pago)), ' ', h('span', { className: 'log-moeda' }, l.moeda_pagamento),
        ' · ', h('span', { className: 'log-rot' }, 'Formato: '), l.formato),
      h('div', { className: 'log-previsao' + (l.alerta ? ' alerta' : '') }, h('span', { className: 'log-rot' }, 'Previsão do modelo: '), 'score ', h('strong', null, l.score),
        ' (faixa ' + NOME_FAIXA[l.faixa] + ') · ', l.alerta ? h('strong', null, '⚠ Com alerta: possível lavagem, para investigação') : 'Sem alerta'),
      ROTULO ? h('div', { className: 'log-rotulo' }, h('span', { className: 'log-rot' }, 'Rótulo do dataset: '), textoRotulo(l, comRotulo)) : null,
      /* só em análises gravadas por versões anteriores, com arquivo de padrões; nas demais a linha não existe */
      comTipologias ? h('div', null, h('span', { className: 'log-rot' }, 'Tipologia registrada: '),
        tipos.length ? tipos.join(', ') + ' (registrada no dataset)'
          : h('span', { title: TEXTO_SEM_TIPOLOGIA }, 'Sem classificação', h('span', { className: 'sr' }, ' (' + TEXTO_SEM_TIPOLOGIA + ')'))) : null);
  });

  /* ── Lista virtualizada das transações pontuadas ──────────────────────────────────────────────────────────
     Altura de linha fixa (medida numa sonda com a altura do CSS), sobra de 10 linhas, espaçador com total × altura.
     Busca em janelas de até 200 IDs, com cache de 20 páginas e no máximo 1 requisição em voo. */
  const pagina = id => Math.floor((id - 1) / JANELA);
  function ListaFluxo({ m, topo }) {
    const total = m.contagens.pontuadas || 0;
    const validas = m.contagens.validas;
    const emAndamento = m.status === 'em_andamento';
    const ref = React.useRef(null), sonda = React.useRef(null), lista = React.useRef(null);
    const cache = React.useRef(new Map());
    const emVoo = React.useRef(false), montado = React.useRef(true), quadro = React.useRef(0);
    const posProgramada = React.useRef(null), topoAnterior = React.useRef(0);
    const ancora = React.useRef(null), fatorAnterior = React.useRef(1), focoPendente = React.useRef(null);
    const [geo, setGeo] = React.useState({ topo: 0, visivel: 0, linha: 0, inicio: 0 });
    const [versao, setVersao] = React.useState(0);
    const [seguir, setSeguir] = React.useState(emAndamento);
    const [erro, setErro] = React.useState(null);
    const [irPara, setIrPara] = React.useState('');
    /* Último lote de transações que chegou enquanto a lista seguia as mais recentes (IDs de..até); só ele recebe o
       realce de entrada. Ao abrir a lista, o que já estava pontuado não conta como novo. */
    const [lote, setLote] = React.useState(null);
    const totalAnterior = React.useRef(total);

    const medir = () => {
      const el = ref.current;
      if (!el || !sonda.current || !lista.current) return;
      const g = { topo: el.scrollTop, visivel: el.clientHeight, linha: sonda.current.offsetHeight || 1, inicio: lista.current.offsetTop };
      setGeo(a => (a.topo === g.topo && a.visivel === g.visivel && a.linha === g.linha && a.inicio === g.inicio ? a : g));
    };
    React.useLayoutEffect(() => {
      medir();
      const ro = new ResizeObserver(() => medir());
      ro.observe(ref.current);
      if (ref.current.firstChild) ro.observe(ref.current.firstChild);
      return () => { ro.disconnect(); montado.current = false; if (quadro.current) cancelAnimationFrame(quadro.current); };
    }, []);

    const H = geo.linha || 1;
    const real = total * H;
    const alturaLista = Math.min(real, ALTURA_MAX_PX);
    const fator = real > alturaLista && alturaLista > geo.visivel ? (real - geo.visivel) / (alturaLista - geo.visivel) : 1;
    const s = Math.max(0, geo.topo - geo.inicio);
    // Ancorado (sem "seguir ao vivo", com o fator recém-mudado): até o efeito de layout recolocar a rolagem, a
    // janela vem da âncora e não do scrollTop antigo; senão cada atualização desenharia outras linhas por um
    // instante e recriaria todas as entradas visíveis (perdendo o foco e pedindo páginas à toa).
    const ancorado = !seguir && ancora.current !== null && fator !== fatorAnterior.current;
    const inicioVirtual = ancorado ? ancora.current : s * fator;
    const primeiro = total ? Math.max(1, Math.floor(inicioVirtual / H) + 1 - SOBRA) : 0;
    const ultimo = total ? Math.min(total, Math.ceil((inicioVirtual + geo.visivel) / H) + SOBRA) : -1;

    /* "Seguir ao vivo": desliga quando o analista rola para cima; volta ao chegar no fim ou pelo botão. */
    const aoRolar = () => {
      if (quadro.current) return;
      quadro.current = requestAnimationFrame(() => {
        quadro.current = 0;
        const el = ref.current;
        if (!el) return;
        const programada = posProgramada.current !== null && Math.abs(el.scrollTop - posProgramada.current) < 2;
        if (!programada) {
          posProgramada.current = null;
          ancora.current = null;      // o analista rolou: a âncora passa a ser a nova posição
          const noFim = el.scrollTop + el.clientHeight >= el.scrollHeight - H;
          if (el.scrollTop < topoAnterior.current && !noFim) setSeguir(false);
          else if (noFim && emAndamento) setSeguir(true);
        }
        topoAnterior.current = el.scrollTop;
        medir();
      });
    };
    const rolarPara = y => { const el = ref.current; if (!el) return; el.scrollTop = y; posProgramada.current = el.scrollTop; topoAnterior.current = el.scrollTop; medir(); };
    React.useLayoutEffect(() => { if (seguir && ref.current) rolarPara(ref.current.scrollHeight); }, [seguir, total, H, geo.inicio]);
    React.useEffect(() => { if (!emAndamento) { setSeguir(false); setLote(null); } }, [emAndamento]);
    React.useEffect(() => {
      const antes = totalAnterior.current;
      totalAnterior.current = total;
      if (total > antes && seguir && emAndamento) setLote({ de: antes + 1, ate: total });
    }, [total]);

    /* Posição de leitura na rolagem proporcional (mais de 8 M px, como no HI-Small): sem "seguir ao vivo", cada
       bloco gravado muda o fator, e o mesmo scrollTop passaria a apontar para outra transação. A âncora guarda a
       posição virtual do topo e, quando o fator muda, recoloca a rolagem para a mesma transação. */
    React.useLayoutEffect(() => {
      if (seguir) { ancora.current = null; fatorAnterior.current = fator; return; }
      if (ancora.current === null) { ancora.current = inicioVirtual; fatorAnterior.current = fator; return; }
      if (fator !== fatorAnterior.current) { fatorAnterior.current = fator; rolarPara(geo.inicio + ancora.current / fator); }
    });
    /* Depois de "Ir para a posição", o foco vai para a entrada pedida assim que ela estiver carregada. */
    React.useEffect(() => {
      const alvo = focoPendente.current;
      if (!alvo || !ref.current) return;
      const el = ref.current.querySelector('article[aria-posinset="' + alvo + '"]');
      if (el) { focoPendente.current = null; el.focus({ preventScroll: true }); }
    });

    /* Busca a página que falta para a janela visível (uma por vez; respostas de outra análise são ignoradas). */
    const tocar = p => { const c = cache.current.get(p); if (c) { cache.current.delete(p); cache.current.set(p, c); } };
    React.useEffect(() => {
      if (!total || emVoo.current || ultimo < primeiro) return;
      for (let p = pagina(primeiro); p <= pagina(ultimo); p += 1) {
        const de = p * JANELA + 1, ate = Math.min((p + 1) * JANELA, total);
        const c = cache.current.get(p);
        if (c && (c.ate >= ate || c.totalNaBusca === total)) { tocar(p); continue; }
        emVoo.current = true;
        const pedidoTotal = total;
        api('/analises/' + encodeURIComponent(m.id) + '/fluxo?de=' + de + '&ate=' + ate).then(d => {
          if (!montado.current) return;
          const linhas = new Map(d.linhas.map(l => [l.id_exibicao, l]));
          cache.current.delete(p);
          cache.current.set(p, { linhas, ate: d.linhas.length ? d.linhas[d.linhas.length - 1].id_exibicao : de - 1, totalNaBusca: pedidoTotal });
          const visiveis = new Set([pagina(primeiro), pagina(ultimo)]);
          for (const k of cache.current.keys()) { if (cache.current.size <= MAX_PAGINAS) break; if (!visiveis.has(k)) cache.current.delete(k); }
          emVoo.current = false; setErro(null); setVersao(v => v + 1);
        }).catch(e => { if (!montado.current) return; emVoo.current = false; setErro(e); });
        return;
      }
    }, [primeiro, ultimo, total, versao, m.id]);

    const linha = id => { const c = cache.current.get(pagina(id)); return c ? c.linhas.get(id) : undefined; };
    const linhas = [];
    for (let id = primeiro; id >= 1 && id <= ultimo; id += 1) {
      const l = linha(id);
      const y = s + ((id - 1) * H - inicioVirtual);
      linhas.push(l ? h(Entrada, { key: id, l, topo: y, setsize: emAndamento ? -1 : total, validas, comRotulo: !!m.rotulo.disponivel, comTipologias: comTipologias(m),
        nova: !!lote && id >= lote.de && id <= lote.ate })
        : h('div', { key: id, className: 'log-entrada carregando', style: { top: y + 'px' }, 'aria-hidden': 'true' }, 'Carregando a transação nº ' + f.inteiro(id) + '…'));
    }
    const irParaPosicao = ev => {
      ev.preventDefault();
      const n = Math.round(Number(irPara));
      if (!total || !Number.isFinite(n)) return;
      const alvo = Math.min(Math.max(1, n), total);
      setSeguir(false);
      ancora.current = null;
      focoPendente.current = alvo;
      // a entrada pedida fica logo abaixo da área fixa de métricas (que tem a altura geo.inicio), não atrás dela
      rolarPara(geo.inicio + ((alvo - 1) * H - geo.inicio) / fator);
    };
    const vazioTexto = total ? null : emAndamento
      ? 'Nenhuma transação pontuada ainda: a lista começa quando a etapa de pontuação gravar o primeiro bloco.'
      : 'Nenhuma transação foi pontuada nesta análise.';
    return h('div', { className: 'log-rolagem' + (ROTULO ? '' : ' sem-rotulo') + (comTipologias(m) ? '' : ' sem-tipologias'), ref, tabIndex: 0, onScroll: aoRolar,
      'aria-label': 'Log da execução: métricas e transações pontuadas, rolável' },
      h('div', { className: 'log-fixo' }, topo,
        total ? h('div', { className: 'log-barra' },
          /* "Seguindo": a lista acompanha as mais recentes; o ponto pulsa uma vez a cada lote novo (chave = total) */
          seguir ? h('span', { className: 'seguindo' }, h('span', { key: 'lote-' + total, className: 'ponto-seguindo', 'aria-hidden': 'true' }),
            'Seguindo', h('span', { className: 'sr' }, ' as mais recentes'))
            : h('button', { type: 'button', className: 'botao pequeno', 'aria-label': 'Ir para as mais recentes',
              onClick: () => { ancora.current = null; if (emAndamento) setSeguir(true); else if (ref.current) rolarPara(ref.current.scrollHeight); } }, h(Icone, { nome: 'seta' }), 'Mais recentes'),
          h('form', { className: 'linha', onSubmit: irParaPosicao },
            h('label', { htmlFor: 'log-ir-' + m.id, className: 'log-ir-rotulo' }, h('span', { className: 'sr' }, 'Ir para a '), 'Posição'),
            h('input', { id: 'log-ir-' + m.id, type: 'number', min: 1, max: total, step: 1, value: irPara, onChange: e => setIrPara(e.target.value), className: 'log-ir' }),
            h('button', { type: 'submit', className: 'botao pequeno' }, 'Ir'))) : null,
        erro ? h('div', { className: 'log-erro' }, h(Erro, { erro }), h('button', { type: 'button', className: 'botao pequeno', onClick: () => { setErro(null); setVersao(v => v + 1); } }, 'Tentar de novo')) : null),
      h('div', { className: 'log-lista', ref: lista, style: { height: (total ? alturaLista : 0) + 'px' } },
        h('div', { className: 'log-sonda', ref: sonda, 'aria-hidden': 'true' }),
        total ? h('div', { role: 'feed', 'aria-label': 'Transações pontuadas, em ordem cronológica (' + f.inteiro(total) + ')' }, linhas) : null),
      vazioTexto ? h('p', { className: 'log-vazio' }, vazioTexto) : null);
  }

  /* ── Precisão e recall do dataset (fora da lista e da área fixa) ── */
  function ResumoPrecisaoRecall({ m }) {
    const pontuadas = m.contagens.pontuadas || 0, validas = m.contagens.validas;
    const final = m.status !== 'em_andamento' && !!(m.resultados && m.resultados.disponiveis);
    const carga = useCarga('/operacao/metricas?analise=' + encodeURIComponent(m.id), final ? 'final:' + m.status + ':' + pontuadas : 'parcial');
    const leg = (carga.dados && carga.dados.legendas) || {};
    const dd = final && carga.dados ? carga.dados.do_dataset : null;
    const parcial = !final || m.status !== 'concluida' || !!(dd && dd.parcial);
    const rotuloEscopo = parcial ? 'parcial: ' + f.inteiro(pontuadas) + ' de ' + f.inteiro(validas) + ' transações' : 'final: ' + f.inteiro(pontuadas) + ' de ' + f.inteiro(validas) + ' transações';
    const titulo = h('div', { className: 'linha' }, h('h4', { id: 'log-pr-t-' + m.id }, 'Precisão e recall neste dataset'), h(Selo, { tom: parcial ? 'atencao' : 'ok' }, rotuloEscopo));
    // a marcação "base usada no treino" só aparece quando EXIBIR.base_treino é true (o cálculo continua na API)
    const treino = BASE_TREINO ? h(AvisoBaseTreino, { situacao: dd && dd.base_no_treino ? dd.base_no_treino : situacaoTreino(m), treino: dd && dd.treino ? dd.treino : treinoDoManifesto(m) }) : null;
    const T = TEXTO_METRICAS;
    const caixa = (...filhos) => h('section', { className: 'bloco grade log-resumo', 'aria-labelledby': 'log-pr-t-' + m.id }, titulo, ...filhos);
    const naoDisponivel = motivo => caixa(h('p', null, h('strong', null, 'Não disponível para este dataset. '), motivo), treino);

    if (!m.rotulo || !m.rotulo.disponivel) return naoDisponivel(ROTULO ? ((dd && dd.motivo) || T.sem_referencia) : T.sem_referencia);
    if (m.status !== 'em_andamento' && !final) return naoDisponivel('Nenhuma transação foi pontuada nesta análise.');
    if (final && carga.erro) return caixa(h(Erro, { erro: carga.erro }), treino);
    if (final && !dd) return caixa(h('p', { className: 'suave' }, 'Carregando as contagens gravadas…'));
    if (final && !dd.disponivel) return naoDisponivel(dd.motivo);
    let b;
    if (final) b = { x: dd.transacoes_com_rotulo, y: vazio(dd.pontuadas) ? pontuadas : dd.pontuadas, vp: dd.verdadeiros_positivos, fp: dd.falsos_positivos, fn: dd.falsos_negativos, periodo: dd.periodo };
    else if (m.metricas_parciais) { const p = m.metricas_parciais; b = { x: p.com_rotulo, y: p.pontuadas, vp: p.vp, fp: p.fp, fn: p.fn, periodo: null }; }
    if (!b) return caixa(h('p', null, h('strong', null, INDISPONIVEL + ': '), pontuadas ? 'este manifesto não registra contagens parciais (gravado por versão anterior).' : 'a pontuação ainda não gravou nenhum bloco.'), treino);
    if (!b.x) return naoDisponivel(T.nenhuma_conferivel);
    const valorPrecisao = b.vp + b.fp > 0 ? b.vp / (b.vp + b.fp) : null;
    const valorRecall = b.vp + b.fn > 0 ? b.vp / (b.vp + b.fn) : null;
    const semBase = (qual) => (!final ? 'ainda sem base (' + qual + ' até agora)' : 'sem base (' + qual + ')');
    const cartao = (nome, valor, legenda, faltando) => h('div', { className: 'log-pr' },
      h('div', { className: 'log-pr-nome' }, nome),
      h('div', { className: 'log-pr-valor' }, vazio(valor) ? semBase(faltando) : f.pct(valor, 1)),
      h(Legenda, null, legenda || INDISPONIVEL));
    // o limiar já está nas notas do log, logo acima: não se repete aqui
    return caixa(
      h('p', null, 'Resultado calculado sobre ' + f.inteiro(b.x) + ' de ' + f.inteiro(b.y) + ' transações (' + T.calculado + ').'),
      h('div', { className: 'log-pr-grade' },
        cartao('Precisão', valorPrecisao, T.precisao || leg.precisao, 'nenhum alerta'),
        cartao('Recall', valorRecall, T.recall || leg.recall, T.nenhum_positivo)),
      h('dl', { className: 'pares' },
        h('dt', null, 'Base'), h('dd', null, f.inteiro(b.x) + ' ' + T.conferiveis + ' · ' + f.inteiro(b.vp + b.fn) + ' ' + T.positivos + ' · ' + f.inteiro(b.vp + b.fp) + ' com alerta'),
        h('dt', null, 'Período'), h('dd', null, b.periodo ? f.dataHora(b.periodo.inicio) + ' a ' + f.dataHora(b.periodo.fim) + ' (horário do dataset)' : final ? INDISPONIVEL : 'indisponível até o fim da análise'),
        h('dt', null, 'Fonte'), h('dd', null, final ? 'contagens gravadas no banco da análise (fonte oficial)' : 'contagens acumuladas pelo pipeline a cada bloco gravado')),
      treino);
  }

  /* ── Log da execução: cabeçalho, área fixa de métricas, lista e resumo ── */
  /* aoOperacao (opcional): abre a gaveta Operação; sem ele, o atalho "Detalhes em Operação" não aparece. */
  function LogAnalise({ m, estado, aoOperacao }) {
    const leitura = useDesempenho(m);
    const atual = m.etapas.find(e => e.status === 'em_andamento');
    const c = m.contagens;
    const [anuncio, setAnuncio] = React.useState('');
    const ultimoAnuncio = React.useRef({ t: 0, chave: '' });
    React.useEffect(() => {
      const chave = m.id + '|' + m.status + '|' + (atual ? atual.id : '');
      const agora = Date.now();
      if (chave === ultimoAnuncio.current.chave && agora - ultimoAnuncio.current.t < ANUNCIO_MS) return;
      ultimoAnuncio.current = { t: agora, chave };
      setAnuncio(m.status === 'em_andamento'
        ? 'Log da execução: ' + f.inteiro(c.pontuadas) + ' de ' + f.inteiro(c.validas) + ' transações pontuadas, ' + f.inteiro(c.alertas) + ' com alerta.'
        : 'Log da execução: análise ' + (NOME_STATUS[m.status] || m.status) + '; ' + f.inteiro(c.pontuadas) + ' transações pontuadas.');
    }, [m.id, m.status, atual && atual.id, c.pontuadas]);
    const idTitulo = 'log-t-' + m.id;
    const ibm = (m.dataset || {}).formato === 'hismall_v1';
    return h('section', { className: 'log-analise', 'aria-labelledby': idTitulo },
      h('h3', { id: idTitulo }, h(Icone, { nome: 'operacao' }), 'Log da execução'),
      h('p', { className: 'sr', role: 'status', 'aria-live': 'polite' }, anuncio),
      h('div', { className: 'log-notas' },
        h('span', { className: 'chip so-texto', title: textoLimiar(m) }, h('span', { className: 'sr' }, textoLimiar(m)), h('span', { 'aria-hidden': 'true' }, 'Limiar ', h('strong', null, (m.conversao_score && m.conversao_score.ancoras && m.conversao_score.ancoras[1] ? m.conversao_score.ancoras[1].score : '—')))),
        h(Dica, { texto: ibm ? NOTA_IBM : (estado && estado.aviso_faixas) || '' }),
        /* "Como ler" começa recolhido: repete o que a legenda da tabela já explica */
        h('details', null, h('summary', null, 'Como ler as entradas do log'),
          h(Legenda, null, 'nº = posição no fluxo (ordem cronológica, igual ao ID de exibição). ' + TEXTO_ID + '. ',
            '"Previsão do modelo" é o score e o alerta gravados' + (ROTULO ? '; "Rótulo do dataset" é o valor que veio no arquivo, não é previsão.' : '.'),
            comTipologias(m) ? ' O modelo não classifica tipologia: só aparece a tipologia registrada no arquivo de padrões. "Sem classificação" = ' + TEXTO_SEM_TIPOLOGIA + '.' : ''))),
      h(ListaFluxo, { key: m.id, m, topo: h(MetricasExecucao, { m, leitura, aoOperacao }) }),
      h(ResumoPrecisaoRecall, { m }));
  }

  Object.assign(window.NW, { LogAnalise, MetricasExecucao, ListaFluxo, ResumoPrecisaoRecall, AvisoBaseTreino, TEXTO_METRICAS });
})();
