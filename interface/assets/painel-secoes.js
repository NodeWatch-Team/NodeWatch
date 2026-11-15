/* NodeWatch — seções do painel do analista. Cada bloco responde a uma pergunta do analista (mostrada no cabeçalho).
   Vistas: Análise (dataset, execução e recentes) · Visão geral · Investigação · Transações · Detalhes (interpretação do score). */
(function () {
  'use strict';
  const { h, f, api, consulta, useCarga, useIntervalo, Icone, Aviso, Erro, Carregando, Esqueleto, Vazio, Legenda, Selo, Secao, Pares, Dialogo, Barra, BarraProgresso,
    MedidorScore, NOME_FAIXA, TOM_FAIXA, SITUACAO_ALERTA, BlocoGrafo, LogAnalise, AvisoBaseTreino, TEXTO_METRICAS, exibir } = window.NW;
  const ROTULO = exibir('rotulo');                   // ponto único (painel-base.js): rótulo do dataset na tela

  const NOME_STATUS = { em_andamento: 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada', parcial: 'Parcial', erro: 'Erro' };
  const TOM_STATUS = { concluida: 'ok', cancelada: 'atencao', parcial: 'atencao', erro: 'alerta', em_andamento: 'acao' };
  const NOME_ETAPA = { pendente: 'Pendente', em_andamento: 'Em andamento', concluida: 'Concluída', pulada: 'Pulada (não se aplica)',
    erro: 'Erro', cancelada: 'Cancelada', interrompida: 'Interrompida' };
  const MARCA_ETAPA = { concluida: '✓', em_andamento: '▶', erro: '!', cancelada: '×', interrompida: '×', pulada: '–' };
  const NOME_DATASET = { validando: 'Validando…', valido: 'Válido', valido_com_recusas: 'Válido, com linhas recusadas', invalido: 'Inválido',
    erro: 'Erro na validação', nao_validado: 'Ainda não validado' };

  /* Estatística em linha (dt/dd dentro de <dl class="estatisticas">). */
  const Estat = ({ nome, valor, sub }) => h('div', { className: 'estatistica' }, h('dt', null, nome), h('dd', null, valor, sub ? h('small', null, sub) : null));
  /* Limiar original (0–1) usado na conversão: o do manifesto aberto ou, sem análise, o do modelo carregado. */
  const limiarDe = (manifesto, estado) => ((manifesto && manifesto.conversao_score) || {}).limiar_bruto || ((estado && estado.score) || {}).limiar_original;

  /* ═══ 1. Análise: dataset, execução e análises recentes ══════════════ */
  function TabelaProblemas({ problemas }) {
    if (!problemas || !problemas.length) return null;
    return h('div', { className: 'rolagem' }, h('table', null,
      h('caption', null, 'Problemas encontrados: coluna, linha de exemplo e o que corrigir. O cabeçalho é a linha 1 do arquivo.'),
      h('thead', null, h('tr', null, ['Coluna', 'Linha de exemplo', 'Valor encontrado', 'Problema', 'Como corrigir', 'Linhas afetadas'].map(c => h('th', { key: c, scope: 'col' }, c)))),
      h('tbody', null, problemas.map((p, i) => h('tr', { key: i },
        h('td', { className: 'mono' }, p.coluna || '—'), h('td', { className: 'num' }, f.vazio(p.linha_exemplo) ? '—' : f.inteiro(p.linha_exemplo)),
        h('td', { className: 'mono' }, f.vazio(p.valor_exemplo) ? '—' : (p.valor_exemplo === '' ? '(vazio)' : p.valor_exemplo)),
        h('td', { style: { whiteSpace: 'normal' } }, p.problema), h('td', { style: { whiteSpace: 'normal' } }, p.como_corrigir),
        h('td', { className: 'num' }, f.vazio(p.linhas_afetadas) ? '—' : f.inteiro(p.linhas_afetadas)))))));
  }

  function ResumoDataset({ d }) {
    if (!d) return null;
    const v = d.validacao;
    const cabecalho = h('div', { className: 'cabeca-bloco' }, h('div', { className: 'linha' }, h(Icone, { nome: 'dataset' }), h('h3', { style: { margin: 0 } }, d.nome),
      h(Selo, { tom: d.status === 'valido' ? 'ok' : d.status === 'invalido' || d.status === 'erro' ? 'alerta' : d.status === 'valido_com_recusas' ? 'atencao' : '', forma: true }, NOME_DATASET[d.status] || d.status)),
      h('span', { className: 'suave', style: { fontSize: 'var(--t-s)' } }, f.bytes(d.bytes) + ' · ' + (d.origem === 'enviado' ? 'enviado em ' + f.instante(d.enviado_em) : 'disponível no servidor (' + d.procedencia + ')')));
    if (d.status === 'validando') {
      const p = d.progresso || {};
      return h('div', { className: 'bloco' }, cabecalho,
        h('p', { role: 'status', style: { marginTop: 8 } }, 'Validando no servidor: ' + (p.bytes_total ? f.bytes(p.bytes_lidos) + ' de ' + f.bytes(p.bytes_total) + ' lidos, ' + f.inteiro(p.linhas_lidas) + ' linhas conferidas.' : 'abrindo o arquivo…')),
        p.bytes_total ? h(BarraProgresso, { feito: p.bytes_lidos, total: p.bytes_total, rotulo: 'Validação do arquivo',
          texto: f.bytes(p.bytes_lidos) + ' de ' + f.bytes(p.bytes_total) + ' lidos' }) : null);
    }
    if (d.status === 'nao_validado') return h('div', { className: 'bloco' }, cabecalho, h(Legenda, null, 'Este dataset ainda não foi validado. Clique em Validar para conferir o arquivo antes de analisar.'));
    if (d.status === 'invalido' || d.status === 'erro') return h('div', { className: 'bloco' }, cabecalho,
      h(Aviso, { tom: 'erro', titulo: 'Este dataset não pode ser analisado' }, 'Corrija o arquivo conforme a tabela abaixo e envie de novo.'),
      h('div', { style: { marginTop: 8 } }, h(TabelaProblemas, { problemas: (d.erro || {}).problemas })));
    const cat = lista => lista.map(x => x.valor + ' (' + f.inteiro(x.n) + ')').join(', ');
    // a coluna de rótulo (Is Laundering) não é atributo do modelo: some da lista e do contador quando escondida
    const colunas = v.colunas.filter(c => exibir('coluna_rotulo') || !(v.rotulo.disponivel && c.original === v.rotulo.coluna));
    return h('div', { className: 'bloco grade' }, cabecalho,
      h('dl', { className: 'estatisticas' },
        h(Estat, { nome: 'Formato', valor: v.formato_nome }),
        h(Estat, { nome: 'Linhas válidas', valor: f.inteiro(v.linhas.validas), sub: f.inteiro(v.linhas.lidas) + ' lidas · ' + f.inteiro(v.linhas.recusadas) + ' recusadas' }),
        h(Estat, { nome: 'Contas distintas', valor: f.inteiro(v.contas_distintas) }),
        h(Estat, { nome: 'Período', valor: v.periodo ? f.dataHora(v.periodo.inicio) : '—', sub: v.periodo ? 'até ' + f.dataHora(v.periodo.fim) + (exibir('fuso') ? ' — ' + v.periodo.fuso : '') : null })),
      h(Pares, { itens: [
        ROTULO ? ['Rótulo do dataset', v.rotulo.disponivel ? 'coluna "' + v.rotulo.coluna + '": ' + f.inteiro(v.rotulo.positivos) + ' transações rotuladas como lavagem' : 'não há (' + v.rotulo.motivo + ')'] : null,
        ['Tipologias registradas', v.tipologias.disponivel ? f.inteiro(v.tipologias.tentativas) + ' tentativas e ' + f.inteiro(v.tipologias.transacoes_listadas) + ' transações no arquivo de padrões "' + (d.padroes || {}).nome + '"' : 'não há (' + v.tipologias.motivo + ')'],
      ] }),
      /* detalhes técnicos começam recolhidos: colunas, moedas, formatos e hash */
      h('details', null, h('summary', null, 'Detalhes técnicos: colunas reconhecidas (' + colunas.length + ')' + (v.colunas_nao_reconhecidas.length ? ' e ' + v.colunas_nao_reconhecidas.length + ' fora do contrato' : '') + ', moedas, formatos e hash'),
        h(Pares, { itens: [
          ['Moedas de pagamento', cat(v.moedas_pagamento)],
          ['Formatos de pagamento', cat(v.formatos_pagamento)],
          ['Hash do arquivo (SHA-256)', h('span', { className: 'mono' }, v.sha256.slice(0, 16) + '…')],
        ] }),
        h('h4', null, 'Colunas reconhecidas'),
        h('ul', { className: 'chips', style: { marginTop: 6 } }, colunas.map(c => h('li', { key: c.original, className: 'chip so-texto' }, h('span', { className: 'mono' }, c.original), ' → ' + c.papel))),
        v.colunas_nao_reconhecidas.length ? h(Legenda, null, 'Colunas fora do contrato (guardadas e exibíveis na tabela, mas não usadas pelo modelo): ' + v.colunas_nao_reconhecidas.join(', ') + '.') : null),
      v.avisos.map((a, i) => h(Aviso, { key: i, tom: 'atencao' }, a)),
      v.linhas.recusadas ? h(Aviso, { tom: 'atencao', titulo: f.inteiro(v.linhas.recusadas) + ' linha(s) recusada(s) ficam fora da análise' },
        'Serão analisadas as ' + f.inteiro(v.linhas.validas) + ' linhas válidas. Nada é corrigido nem preenchido automaticamente.') : null,
      h(TabelaProblemas, { problemas: v.problemas }));
  }

  function Progresso({ m, aoCancelar, aoAssumir }) {
    const atual = m.etapas.find(e => e.status === 'em_andamento');
    const ss = m.sessao || {};
    return h('div', { className: 'grade' },
      h('p', { className: 'sr', role: 'status', 'aria-live': 'polite' }, m.status === 'em_andamento' ? (atual ? 'Etapa atual: ' + atual.nome : 'Preparando a análise') : 'Análise ' + NOME_STATUS[m.status]),
      h('ol', { className: 'etapas', 'aria-label': 'Etapas da análise' }, m.etapas.map((e, i) => {
        const p = e.progresso;
        let volume = null;
        if (p && p.total) {
          volume = e.unidade === 'bytes' ? f.bytes(p.feito) + ' de ' + f.bytes(p.total) + ' lidos' + (p.linhas_lidas ? ' · ' + f.inteiro(p.linhas_lidas) + ' linhas' : '')
            : f.inteiro(p.feito) + ' de ' + f.inteiro(p.total) + ' ' + e.unidade + (p.alertas_ate_agora !== undefined ? ' · ' + f.inteiro(p.alertas_ate_agora) + ' alertas até agora' : '');
        }
        return h('li', { key: e.id, className: 'etapa ' + e.status, 'aria-current': e.status === 'em_andamento' ? 'step' : undefined },
          h('span', { className: 'marca', 'aria-hidden': 'true' }, MARCA_ETAPA[e.status] || (i + 1)),
          h('div', null,
            h('div', { className: 'linha', style: { justifyContent: 'space-between' } }, h('span', { className: 'nome' }, (i + 1) + '. ' + e.nome),
              h('span', { className: 'situacao' }, NOME_ETAPA[e.status] + (e.duracao_s !== null && e.duracao_s !== undefined ? ' · ' + f.duracao(e.duracao_s) : ''))),
            e.status === 'em_andamento' && p && p.total ? h(BarraProgresso, { feito: p.feito, total: p.total, rotulo: e.nome, texto: volume + ' (' + f.pct(p.fracao, 0) + ')' }) : null,
            volume ? h('div', { className: 'situacao' }, volume + (e.status === 'em_andamento' && p.fracao !== null ? ' · ' + f.pct(p.fracao, 0) : '')) : null,
            e.status === 'em_andamento' && p && p.estimativa_restante_s !== undefined ? h('div', { className: 'situacao' },
              'Tempo restante (estimativa): cerca de ' + f.duracao(p.estimativa_restante_s) + ' — calculada pela vazão observada nesta etapa: ' +
              (e.unidade === 'bytes' ? f.bytes(p.vazao_por_s) : f.inteiro(p.vazao_por_s) + ' ' + e.unidade) + ' por segundo em ' + f.duracao(p.decorrido_s) + '.') : null,
            e.detalhe ? h('div', { className: 'situacao' }, e.detalhe) : null));
      })),
      /* Cancelar logo abaixo das etapas, antes do aviso de sessão: fica visível sem rolar */
      m.status === 'em_andamento' ? h('div', { className: 'linha' },
        h('button', { type: 'button', className: 'botao perigo', onClick: aoCancelar, disabled: m.cancelamento_solicitado }, h(Icone, { nome: 'fechar' }), m.cancelamento_solicitado ? 'Cancelamento pedido…' : 'Cancelar análise'),
        h(Legenda, null, m.cancelamento_solicitado ? 'A análise para no fim do bloco atual; o que já foi pontuado fica gravado.' : 'O cancelamento é seguro: para no fim do bloco atual e mantém o que já foi pontuado.')) : null,
      m.status === 'em_andamento' && ss.exigida ? h(Aviso, { tom: ss.desta_sessao ? '' : 'atencao', titulo: ss.desta_sessao ? 'Esta aba mantém a análise em andamento' : 'Outra aba é a responsável por esta análise', vivo: true },
        h('p', null, ss.desta_sessao ? 'Mantenha esta página aberta (pode minimizar ou trocar de aba). Sem sinal dela por ' + f.inteiro(ss.janela_s) + ' s, a análise para num ponto seguro e fica parcial; não é retomada sozinha.'
          : (ss.responsavel_ativa ? 'A sessão que iniciou a análise continua ativa em outra aba.' : 'A sessão que iniciou a análise não dá sinal: a análise vai parar no próximo ponto seguro.') + ' Para que esta aba passe a mantê-la, use o botão abaixo.'),
        ss.desta_sessao ? null : h('div', null, h('button', { type: 'button', className: 'botao pequeno', onClick: aoAssumir }, h(Icone, { nome: 'sessao' }), 'Manter a análise nesta aba'))) : null);
  }

  /* Título da caixa "Etapas executadas" (depois do fim): quantas etapas, em que situação e a duração total. */
  function ResumoEtapas({ m }) {
    const n = s => m.etapas.filter(e => e.status === s).length;
    const partes = [f.plural(n('concluida'), 'concluída', 'concluídas')];
    if (n('pulada')) partes.push(f.plural(n('pulada'), 'pulada (não se aplica)', 'puladas (não se aplicam)'));
    const outras = m.etapas.length - n('concluida') - n('pulada');
    if (outras) partes.push(f.plural(outras, 'não concluída', 'não concluídas'));
    return h(React.Fragment, null, 'Etapas executadas (' + m.etapas.length + ')',
      h('span', { className: 'suave', style: { fontWeight: 400 } }, ' — ' + partes.join(', ') + (f.vazio(m.duracao_s) ? '' : ' · duração ' + f.duracao(m.duracao_s))));
  }

  /* Cabeçalho da execução em andamento: etapa atual, progresso por etapas, tempo decorrido, estimativa e contagens.
     Tudo vem do manifesto (atualizado a cada 1 s); o tempo decorrido é medido desde o início gravado no servidor. */
  function CabecaExecucao({ m }) {
    const c = m.contagens, n = m.etapas.length;
    const idx = m.etapas.findIndex(e => e.status === 'em_andamento');
    const atual = idx >= 0 ? m.etapas[idx] : null;
    const feitas = m.etapas.filter(e => e.status === 'concluida' || e.status === 'pulada').length;
    const fracao = atual && atual.progresso && !f.vazio(atual.progresso.fracao) ? atual.progresso.fracao : 0;
    const geral = n ? Math.min(1, (feitas + fracao) / n) : 0;
    const inicio = Date.parse(m.iniciada_em);
    const decorrido = Number.isNaN(inicio) ? null : Math.max(0, (Date.now() - inicio) / 1000);
    const eta = atual && atual.progresso && !f.vazio(atual.progresso.estimativa_restante_s) ? atual.progresso.estimativa_restante_s : null;
    return h('div', { className: 'execucao-cabeca em_andamento' },
      h('div', { className: 'linha entre' },
        h('div', null, h('span', { className: 'eyebrow' }, atual ? 'Etapa ' + (idx + 1) + ' de ' + n : 'Preparando'), h('h3', null, atual ? atual.nome : 'Preparando a análise…')),
        h('span', { className: 'tab-num', style: { font: '650 1.5rem/1 var(--titulo)' }, 'aria-hidden': 'true' }, f.pct(geral, 0))),
      h(BarraProgresso, { feito: Math.round(geral * 1000), total: 1000, rotulo: 'Progresso da análise por etapas', texto: f.pct(geral, 0) + ' (' + feitas + ' de ' + n + ' etapas concluídas)' }),
      h('dl', { className: 'estatisticas' },
        h(Estat, { nome: 'Tempo decorrido', valor: f.duracao(decorrido), sub: 'desde ' + f.instante(m.iniciada_em) }),
        h(Estat, { nome: 'Estimativa', valor: eta === null ? 'sem estimativa' : 'cerca de ' + f.duracao(eta), sub: 'restante na etapa atual' }),
        h(Estat, { nome: 'Pontuadas', valor: f.inteiro(c.pontuadas), sub: 'de ' + f.inteiro(c.validas) + ' válidas' }),
        h(Estat, { nome: 'Alertas até agora', valor: f.inteiro(c.alertas) })));
  }

  /* Resultado da execução (depois do fim): situação, contagens, causa de erro e o atalho para os resultados. */
  function SituacaoAnalise({ m, aoVerResultados }) {
    if (!m || m.status === 'em_andamento') return null;
    const c = m.contagens;
    return h('div', { className: 'execucao-cabeca ' + m.status, role: m.status === 'erro' ? 'alert' : 'status' },
      h('div', { className: 'linha entre' },
        h('div', null, h('span', { className: 'eyebrow' }, 'Análise ' + NOME_STATUS[m.status].toLowerCase()), h('h3', null, m.dataset.nome)),
        m.resultados.disponiveis && aoVerResultados ? h('button', { type: 'button', className: 'botao primario', onClick: aoVerResultados }, 'Ver resultados', h(Icone, { nome: 'seta' })) : null),
      h('p', { className: 'legenda' }, m.descricao_status),
      m.motivo ? h('p', { className: 'legenda' }, m.motivo) : null,
      (m.erros || []).map((e, i) => h('p', { key: i }, h('strong', null, 'Causa: '), e.causa + ' ', h('strong', null, 'O que fazer: '), e.acao)),
      m.resultados.disponiveis ? h('dl', { className: 'estatisticas' },
        h(Estat, { nome: 'Pontuadas', valor: f.inteiro(c.pontuadas), sub: m.resultados.parciais ? 'de ' + f.inteiro(c.validas) + ' válidas (resultado parcial)' : 'transações' }),
        h(Estat, { nome: 'Com alerta', valor: f.inteiro(c.alertas), sub: c.pontuadas ? f.pct(c.alertas / c.pontuadas, 2) + ' das pontuadas' : null }),
        h(Estat, { nome: 'Duração', valor: f.duracao(m.duracao_s) }),
        h(Estat, { nome: 'Modelo', valor: h('span', { className: 'mono', style: { fontSize: 'var(--t-s)' } }, m.modelo ? m.modelo.versao : '—') }))
        : h('p', null, 'Não há resultados para consultar.'),
      (m.avisos || []).length ? h('details', null, h('summary', null, 'Avisos da análise (' + m.avisos.length + ')'), h('ul', { className: 'legenda' }, m.avisos.map((a, i) => h('li', { key: i }, '• ' + a)))) : null);
  }

  /* Estado vazio do seletor: resume a lista que já está no seletor (quantos, de onde, em que situação). Nada além dela. */
  const TOM_DATASET = { valido: 'ok', valido_com_recusas: 'ok', invalido: 'alerta', erro: 'alerta', validando: '', nao_validado: '' };
  function VazioDatasets({ datasets }) {
    const enviados = datasets.filter(d => d.origem === 'enviado').length;
    const porStatus = [];
    datasets.forEach(d => { const g = porStatus.find(x => x.status === d.status); if (g) g.n += 1; else porStatus.push({ status: d.status, n: 1 }); });
    return h('div', { className: 'ds-vazio' },
      /* ilustração decorativa (uma rede genérica, sem dados): escondida de leitores de tela e sem cliques */
      h('svg', { className: 'ds-vazio-arte', viewBox: '0 0 120 90', 'aria-hidden': 'true', focusable: 'false' },
        [[20, 22, 58, 44], [58, 44, 100, 18], [58, 44, 96, 70], [20, 22, 24, 72], [24, 72, 58, 44], [100, 18, 96, 70]].map((l, i) =>
          h('line', { key: 'l' + i, x1: l[0], y1: l[1], x2: l[2], y2: l[3] })),
        [[20, 22, 4], [100, 18, 4], [24, 72, 4], [96, 70, 4]].map((c, i) => h('circle', { key: 'c' + i, cx: c[0], cy: c[1], r: c[2] })),
        h('circle', { className: 'centro', cx: 58, cy: 44, r: 7 })),
      datasets.length ? h('div', { className: 'ds-vazio-texto' },
        h('p', { className: 'ds-vazio-titulo' }, f.plural(datasets.length, 'dataset disponível na lista', 'datasets disponíveis na lista')),
        h('p', { className: 'suave' }, f.plural(enviados, 'enviado', 'enviados') + ' · ' + f.inteiro(datasets.length - enviados) + ' do servidor'),
        h('ul', { className: 'ds-vazio-status', 'aria-label': 'Datasets por situação' },
          porStatus.map(x => h('li', { key: x.status }, h(Selo, { tom: TOM_DATASET[x.status] }, (NOME_DATASET[x.status] || x.status) + ': ' + f.inteiro(x.n))))),
        h('p', { className: 'ajuda' }, 'Escolha um na lista para ver o formato reconhecido, o período e a validação antes de analisar.'))
        : h('div', { className: 'ds-vazio-texto' },
          h('p', { className: 'ds-vazio-titulo' }, 'Ainda não há datasets na lista.'),
          h('p', { className: 'ajuda' }, 'Envie um arquivo no bloco Enviar um arquivo; depois do envio, ele aparece aqui.')));
  }

  function SecaoDataset({ estado, datasets, dataset, datasetId, aoEscolher, aoRecarregar, manifesto, aoAnalisar, aoCancelar, aoAssumir, analises, aoAbrir, analiseId, erroAnalise, aoVerResultados }) {
    const [enviando, setEnviando] = React.useState(false);
    const [erro, setErro] = React.useState(null);
    const refArq = React.useRef(null), refPad = React.useRef(null);
    const lim = estado.limites;
    const enviar = async ev => {
      ev.preventDefault();
      const arq = refArq.current.files[0];
      if (!arq) { setErro({ erro: 'Escolha um arquivo.', acao: 'Selecione um .csv ou .zip no campo Arquivo de transações.' }); refArq.current.focus(); return; }
      /* Confere o tamanho antes de enviar: acima do limite o servidor recusa logo no início e fecha a conexão, e o
         navegador, ainda enviando, só enxerga a conexão cortada ("servidor indisponível"). Aqui nada é enviado. */
      const pad = refPad.current.files[0];
      if (arq.size > lim.envio_bytes) {
        setErro({ erro: 'Arquivo grande demais para enviar pela tela.', mensagem: arq.name + ' tem ' + f.bytes(arq.size) + '; o limite do envio é ' + f.bytes(lim.envio_bytes) + '. Nada foi enviado.',
          acao: 'Compacte o CSV em um ZIP (o limite vale para o arquivo enviado) ou divida o arquivo por período e envie uma parte por vez.' });
        refArq.current.focus(); return;
      }
      if (pad && pad.size > lim.padroes_bytes) {
        setErro({ erro: 'Arquivo de padrões grande demais.', mensagem: pad.name + ' tem ' + f.bytes(pad.size) + '; o limite é ' + f.bytes(lim.padroes_bytes) + '. Nada foi enviado.',
          acao: 'Envie o arquivo de transações sem o de padrões, ou um arquivo de padrões só do período enviado.' });
        refPad.current.focus(); return;
      }
      const fd = new FormData();
      fd.append('arquivo', arq);
      if (pad) fd.append('padroes', pad);
      setEnviando(true); setErro(null);
      try {
        const reg = await api('/datasets', { method: 'POST', body: fd });
        refArq.current.value = ''; refPad.current.value = '';
        await aoRecarregar();
        aoEscolher(reg.id);
      } catch (e) { setErro(e); }
      setEnviando(false);
    };
    const validar = async () => { setErro(null); try { await api('/datasets/' + datasetId + '/validar', { method: 'POST' }); aoEscolher(datasetId, true); } catch (e) { setErro(e); } };
    const ocupado = manifesto && manifesto.status === 'em_andamento';
    const podeAnalisar = dataset && (dataset.status === 'valido' || dataset.status === 'valido_com_recusas') && !ocupado && !estado.analise_em_andamento;
    const liberado = podeAnalisar && estado.modelo.disponivel;
    const escolha = h(React.Fragment, { key: 'escolha' },
      h('div', { className: 'entrada' },
        h('form', { className: 'bloco grade', onSubmit: enviar, 'aria-labelledby': 'enviar-t' },
          h('h3', { id: 'enviar-t' }, h(Icone, { nome: 'enviar' }), 'Enviar um arquivo'),
          h('div', null, h('label', { htmlFor: 'arq' }, 'Arquivo de transações'),
            h('input', { id: 'arq', type: 'file', accept: '.csv,.zip', ref: refArq, 'aria-describedby': 'arq-a' }),
            h('p', { className: 'ajuda', id: 'arq-a' }, 'CSV em UTF-8 (ou ZIP com um CSV), até ' + f.bytes(lim.envio_bytes) + '. O arquivo fica só neste servidor.')),
          h('div', null, h('label', { htmlFor: 'pad' }, 'Arquivo de padrões (opcional)'),
            h('input', { id: 'pad', type: 'file', accept: '.txt', ref: refPad, 'aria-describedby': 'pad-a' }),
            h('p', { className: 'ajuda', id: 'pad-a' }, 'Arquivo .txt com as tipologias registradas do dataset (por exemplo, HI-Small_Patterns.txt). Sem ele, o dataset não tem tipologias.')),
          h('div', { className: 'linha' }, h('button', { type: 'submit', className: 'botao', disabled: enviando }, h(Icone, { nome: 'enviar' }), enviando ? 'Enviando o arquivo…' : 'Enviar e validar'),
            enviando ? h('span', { role: 'status', className: 'suave' }, 'Enviando; a validação começa quando o envio terminar.') : null)),
        h('div', { className: 'bloco grade' },
          h('h3', null, h(Icone, { nome: 'dataset' }), 'Ou escolher um dataset disponível'),
          h('div', null, h('label', { htmlFor: 'ds' }, 'Dataset'),
            h('select', { id: 'ds', value: datasetId || '', onChange: e => aoEscolher(e.target.value), 'aria-describedby': 'ds-a' },
              h('option', { value: '' }, datasets.length ? 'Selecione…' : 'Nenhum dataset disponível'),
              datasets.map(d => h('option', { key: d.id, value: d.id }, d.nome + ' — ' + (d.origem === 'enviado' ? 'enviado' : 'do servidor') + ' — ' + (NOME_DATASET[d.status] || d.status)))),
            h('p', { className: 'ajuda', id: 'ds-a' }, 'Datasets enviados (os ' + lim.datasets_enviados_guardados + ' mais recentes ficam guardados) e arquivos já presentes no servidor. O dataset escolhido define o conjunto analisado.')),
          dataset ? null : h(VazioDatasets, { datasets }),
          dataset && (dataset.status === 'nao_validado' || dataset.status === 'erro' || (dataset.origem === 'servidor' && dataset.status === 'invalido')) ?
            h('div', null, h('button', { type: 'button', className: 'botao', onClick: validar }, h(Icone, { nome: 'ok' }), 'Validar este dataset')) : null)),
      h(Erro, { erro }),
      erro && erro.problemas ? h(TabelaProblemas, { problemas: erro.problemas }) : null,
      h(ResumoDataset, { d: dataset }),
      h('div', { className: 'faixa-analisar' + (liberado ? '' : ' inativa') },
        h('button', { type: 'button', className: 'botao primario', disabled: !podeAnalisar || !estado.modelo.disponivel, onClick: () => aoAnalisar(datasetId), 'aria-describedby': 'analisar-a' }, h(Icone, { nome: 'analisar' }), 'Analisar'),
        h('p', { className: 'ajuda', id: 'analisar-a', style: { margin: 0 } },
          ocupado || estado.analise_em_andamento ? 'Há uma análise em andamento: espere terminar ou cancele-a.'
            : !dataset ? 'Envie ou escolha um dataset. Nada é analisado antes de você clicar em Analisar.'
              : podeAnalisar ? 'Pontua as ' + f.inteiro(dataset.validacao.linhas.validas) + ' linhas válidas com o modelo salvo. Nada é treinado. A análise roda enquanto esta página estiver aberta.'
                : 'O botão é liberado quando o dataset escolhido estiver válido.')),
      h(Erro, { erro: erroAnalise }));
    const terminada = !!manifesto && manifesto.status !== 'em_andamento';
    /* O nome do dataset e o status já estão no topo (fixo) e no título da situação: aqui só "Execução". */
    // chave estável: quando a análise termina e o bloco muda de lugar, o React o move em vez de recriá-lo
    // (o log mantém a rolagem e a última leitura de RAM e CPU)
    const processamento = manifesto ? h(Secao, { key: 'processamento', id: 'execucao', icone: 'operacao', titulo: 'Execução da análise',
      pergunta: manifesto.dataset.nome + ' · iniciada em ' + f.instante(manifesto.iniciada_em),
      extra: h(Selo, { tom: TOM_STATUS[manifesto.status], forma: true }, NOME_STATUS[manifesto.status]) },
      terminada ? h(SituacaoAnalise, { m: manifesto, aoVerResultados }) : h(CabecaExecucao, { m: manifesto }),
      /* Durante a análise: etapas (esquerda) e log da execução (direita), lado a lado; empilham até 980 px.
         Depois do fim: as etapas viram a caixa recolhida "Etapas executadas" e o log ocupa a largura toda. */
      h('div', { className: 'execucao' + (terminada ? ' terminada' : '') },
        terminada ? h('details', { className: 'execucao-etapas' }, h('summary', null, h(ResumoEtapas, { m: manifesto })),
          h(Progresso, { m: manifesto, aoCancelar, aoAssumir }))
          : h('div', { className: 'execucao-etapas' }, h(Progresso, { m: manifesto, aoCancelar, aoAssumir })),
        h(LogAnalise, { m: manifesto, estado }))) : null;
    const novaAnalise = h(Secao, { key: 'nova', id: 'dataset', icone: 'dataset', titulo: manifesto ? 'Nova análise' : 'Dataset e análise',
      pergunta: 'O que estou analisando? Envie ou escolha um dataset e inicie a pontuação com o modelo salvo.' },
      estado.modelo.disponivel ? null : h(Aviso, { tom: 'erro', titulo: 'Modelo não encontrado no servidor' }, (estado.modelo.motivo || '') + ' Sem o modelo, a análise não pode ser iniciada.'),
      /* Com a análise em andamento, o envio e a escolha de dataset ficam recolhidos. */
      ocupado ? h('details', { key: 'escolha-recolhida', className: 'bloco recolhido' }, h('summary', null, 'Enviar ou escolher outro dataset (a análise em andamento continua)'), escolha) : escolha);
    const recentes = h(Secao, { key: 'recentes', id: 'recentes', icone: 'historico', titulo: 'Análises recentes',
      pergunta: 'Abrir uma análise carrega os resultados gravados, sem reprocessar.', extra: h(Selo, { tom: 'neutro' }, f.inteiro(analises.analises.length)) },
      analises.analises.length ? h('div', { className: 'rolagem' }, h('table', { className: 'recentes' },
        h('caption', null, analises.retencao.leitura),
        h('thead', null, h('tr', null, ['Dataset', 'Data', 'Status', 'Registros', 'Alertas', ''].map((c, i) => h('th', { key: i, scope: 'col', className: i === 3 || i === 4 ? 'num' : '' }, c)))),
        h('tbody', null, analises.analises.map(a => h('tr', { key: a.id, className: a.id === analiseId ? 'selecionada' : '' },
          h('td', null, a.dataset.nome), h('td', null, f.instante(a.criada_em)),
          h('td', null, h(Selo, { tom: TOM_STATUS[a.status], forma: true }, NOME_STATUS[a.status] + (a.resultados.parciais && a.status !== 'parcial' ? ' (parcial)' : ''))),
          h('td', { className: 'num' }, f.inteiro(a.registros)), h('td', { className: 'num' }, f.inteiro(a.alertas)),
          h('td', null, a.id === analiseId ? h('span', { className: 'aberta' }, 'aberta') :
            h('button', { type: 'button', className: 'botao pequeno', onClick: () => aoAbrir(a.id), 'aria-label': 'Abrir a análise de ' + a.dataset.nome + ' de ' + f.instante(a.criada_em) }, 'Abrir'))))))) :
        h(Vazio, { compacto: true }, 'Nenhuma análise foi feita ainda.'));
    /* Ordem: com a análise em andamento, a execução e o Cancelar vêm primeiro; senão, a nova análise e depois a execução aberta. */
    return h(React.Fragment, null, ocupado ? processamento : novaAnalise, ocupado ? novaAnalise : processamento, recentes);
  }

  /* ═══ 2. Recorte (filtros) ═══════════════════════════════════════════ */
  const CAMPOS_FILTRO = [
    { id: 'de', rotulo: 'De', tipo: 'datetime-local', ajuda: 'Data e hora iniciais (inclusive), no horário do dataset.' },
    { id: 'ate', rotulo: 'Até', tipo: 'datetime-local', ajuda: 'Data e hora finais (inclusive), no horário do dataset.' },
    { id: 'moeda', rotulo: 'Moeda', tipo: 'moeda', ajuda: 'Moeda de pagamento da transação.' },
    { id: 'alerta', rotulo: 'Alerta', tipo: 'alerta', ajuda: 'Com alerta = score 701 ou mais.' },
    { id: 'valor_min', rotulo: 'Valor mínimo', tipo: 'number', min: 1, step: 'any', ajuda: 'Valor pago mínimo, na moeda de cada transação (sem conversão entre moedas). Começa em 1; o menor valor aceito é 1. Apague o campo para incluir valores abaixo de 1.' },
    { id: 'banco_origem', rotulo: 'Banco de origem', tipo: 'text', modo: 'numeric', ajuda: 'Código numérico do banco que enviou (exato).' },
    { id: 'banco_destino', rotulo: 'Banco de destino', tipo: 'text', modo: 'numeric', ajuda: 'Código numérico do banco que recebeu (exato).' },
    { id: 'conta_origem', rotulo: 'Conta de origem', tipo: 'text', ajuda: 'Conta que enviou: número da conta ou banco-conta (exato). Também escolhe a conta do grafo.' },
    { id: 'conta_destino', rotulo: 'Conta de destino', tipo: 'text', ajuda: 'Conta que recebeu: número da conta ou banco-conta (exato). Também escolhe a conta do grafo.' },
    { id: 'score_min', rotulo: 'Score mínimo', tipo: 'number', min: 0, max: 1000, step: 1, ajuda: 'Inteiro de 0 a 1000 (inclusive).' },
    { id: 'score_max', rotulo: 'Score máximo', tipo: 'number', min: 0, max: 1000, step: 1, ajuda: 'Inteiro de 0 a 1000 (inclusive).' },
  ];
  const ROTULO_FILTRO = Object.fromEntries(CAMPOS_FILTRO.map(c => [c.id, c.rotulo]));

  /* Barra do recorte: os filtros aplicados ficam sempre à vista (chips); o formulário completo abre sob demanda. */
  function SecaoFiltros({ rascunho, setRascunho, aplicados, aoAplicar, aoLimpar, moedas, erro }) {
    const [aberto, setAberto] = React.useState(false);
    const mudar = (k, v) => setRascunho(Object.assign({}, rascunho, { [k]: v }));
    const pendente = JSON.stringify(rascunho) !== JSON.stringify(aplicados);
    const ativos = Object.entries(aplicados).filter(([k, v]) => !f.vazio(v) && !(k === 'alerta' && v === 'todos'));
    const visivel = aberto || !!erro;
    const campo = c => {
      const invalido = erro && erro.campo === c.id;
      const comum = { id: 'f-' + c.id, value: rascunho[c.id], onChange: e => mudar(c.id, e.target.value), 'aria-describedby': 'f-' + c.id + '-a' + (invalido ? ' f-' + c.id + '-e' : ''), 'aria-invalid': invalido ? 'true' : undefined };
      let controle;
      if (c.tipo === 'moeda') controle = h('select', comum, h('option', { value: '' }, 'Todas'), moedas.map(m => h('option', { key: m, value: m }, m)));
      else if (c.tipo === 'alerta') controle = h('select', comum, h('option', { value: 'todos' }, 'Todos'), h('option', { value: 'sim' }, 'Com alerta'), h('option', { value: 'nao' }, 'Sem alerta'));
      else controle = h('input', Object.assign({ type: c.tipo, min: c.min, max: c.max, step: c.step, inputMode: c.modo, autoComplete: 'off' }, comum));
      return h('div', { key: c.id }, h('label', { htmlFor: 'f-' + c.id }, c.rotulo), controle,
        h('p', { className: 'ajuda', id: 'f-' + c.id + '-a' }, c.ajuda),
        invalido ? h('p', { className: 'erro-campo', id: 'f-' + c.id + '-e', role: 'alert' }, erro.mensagem) : null);
    };
    const valorChip = (k, v) => k === 'alerta' ? (v === 'sim' ? 'Com alerta' : 'Sem alerta') : (k === 'de' || k === 'ate') ? f.dataHora(v) : v;
    return h('section', { className: 'recorte', id: 'filtros', 'aria-labelledby': 'filtros-t' },
      h('div', { className: 'cabeca' },
        h(Icone, { nome: 'filtro' }),
        h('h2', { id: 'filtros-t' }, 'Recorte'),
        h('ul', { className: 'chips', role: 'status', 'aria-label': 'Filtros aplicados' }, ativos.length
          ? ativos.map(([k, v]) => h('li', { key: k, className: 'chip so-texto' }, ROTULO_FILTRO[k] + ': ', h('strong', null, valorChip(k, v))))
          : h('li', { className: 'chip so-texto' }, 'nenhum filtro (dataset inteiro)')),
        pendente ? h('span', { role: 'status', className: 'selo atencao' }, 'Há alterações não aplicadas') : null,
        h('div', { className: 'linha' },
          h('button', { type: 'button', className: 'botao pequeno', 'aria-expanded': visivel, 'aria-controls': 'filtros-form', onClick: () => setAberto(!aberto) },
            h(Icone, { nome: 'editar' }), visivel ? 'Fechar filtros' : 'Editar filtros'),
          h('button', { type: 'button', className: 'botao pequeno fantasma', onClick: aoLimpar }, h(Icone, { nome: 'limpar' }), 'Voltar aos filtros iniciais'))),
      visivel ? h('form', { id: 'filtros-form', className: 'grade', noValidate: true, onSubmit: e => { e.preventDefault(); aoAplicar(); } },  // a mensagem de erro vem do servidor, junto do campo
        h('p', { className: 'legenda' }, 'Os filtros valem ao mesmo tempo para os indicadores, as contas, o grafo e a tabela.'),
        h('div', { className: 'grade campos' }, CAMPOS_FILTRO.map(campo)),
        h('div', { className: 'linha' },
          h('button', { type: 'submit', className: 'botao primario' }, h(Icone, { nome: 'filtro' }), 'Aplicar filtros'),
          h('button', { type: 'button', className: 'botao', onClick: () => setRascunho(aplicados), disabled: !pendente }, 'Descartar alterações'))) : null);
  }

  /* ═══ 3. Visão geral do recorte ══════════════════════════════════════ */
  /* Resumo do score na visão geral: distribuição real das faixas no recorte (contagens da API) e o atalho
     para a interpretação completa, que fica na vista Detalhes. */
  function ResumoScore({ v, aoVista }) {
    const total = v.faixas.reduce((s, x) => s + (x.n || 0), 0);
    return h('div', { className: 'bloco' },
      h('div', { className: 'cabeca-bloco' },
        h('h3', null, h(Icone, { nome: 'score' }), 'Score e faixas de risco'),
        h('button', { type: 'button', className: 'botao pequeno fantasma dica-esquerda', onClick: () => aoVista('detalhes'),
          'aria-label': 'Como ler o score: abrir a interpretação completa em Detalhes',
          'data-dica': 'Índice de prioridade de 0 a 1000, não é probabilidade. Score 701 ou mais = alerta. Veja a interpretação completa em Detalhes.' },
          h(Icone, { nome: 'info' }), 'Como ler o score')),
      v.score ? h('div', { className: 'score-resumo', style: { marginBottom: 14 } },
        h('div', { className: 'item' }, h('span', null, 'Mínimo'), h('strong', null, v.score.min)),
        h('div', { className: 'item maior' }, h('span', null, 'Mediano'), h('strong', null, f.numero(v.score.mediana, Number.isInteger(v.score.mediana) ? 0 : 1))),
        h('div', { className: 'item' }, h('span', null, 'Máximo'), h('strong', { style: { color: v.score.max >= 701 ? 'var(--alerta-forte)' : undefined } }, v.score.max))) : null,
      h('div', { className: 'distribuicao' },
        total ? h('div', { className: 'pilha', role: 'img', 'aria-label': 'Distribuição do recorte por faixa: ' + v.faixas.map(x => x.nome + ' ' + f.pct(x.proporcao, 1)).join(', ') },
          v.faixas.filter(x => x.n).map(x => h('i', { key: x.id, className: x.id, style: { flexGrow: x.n, flexBasis: 0 } }))) : null,
        h('ul', { className: 'faixas-lista' }, v.faixas.map(x => h('li', { key: x.id, className: x.id, title: 'Recomendação: ' + x.recomendacao },
          h('span', { className: 'ponto-faixa ' + x.id, 'aria-hidden': 'true' }),
          h('span', null, h('span', { className: 'rotulo-faixa' }, (x.id === 'alta' ? '⚠ ' : '') + x.nome), h('span', { className: 'intervalo' }, x.de + '–' + x.ate)),
          h('span', { className: 'n' }, f.inteiro(x.n)), h('span', { className: 'p' }, f.pct(x.proporcao, 2)))))));
  }

  function SecaoVisao({ carga, manifesto, estado, aoVista, aoFocar }) {
    const v = carga.dados;
    let corpo;
    if (carga.erro) corpo = h(Erro, { erro: carga.erro });
    else if (!v) corpo = h(React.Fragment, null,
      h('div', { className: 'kpis' }, [0, 1, 2, 3].map(i => h('div', { key: i, className: 'kpi' }, h(Esqueleto, { linhas: 3, altura: i === 1 ? 18 : 12, texto: 'Calculando os indicadores do recorte…' })))),
      h('div', { className: 'grade principal-lateral' }, h('div', { className: 'bloco' }, h(Esqueleto, { linhas: 5 })), h('div', { className: 'bloco' }, h(Esqueleto, { linhas: 5 }))));
    else {
      const n = v.registros.recorte;
      const cr = v.contas_risco;
      corpo = h(React.Fragment, null,
        manifesto.resultados.parciais ? h(Aviso, { tom: 'atencao', titulo: 'Resultado parcial' },
          'Os números abaixo cobrem só as ' + f.inteiro(manifesto.contagens.pontuadas) + ' transações pontuadas antes da interrupção, de ' + f.inteiro(manifesto.contagens.validas) + ' válidas.') : null,
        h('div', { className: 'kpis', 'aria-busy': carga.carregando },
          h('div', { className: 'kpi', title: v.registros.legenda }, h('div', { className: 'nome' }, h(Icone, { nome: 'tabela' }), 'Registros de transação'),
            h('div', { className: 'valor' }, f.inteiro(n)), h('div', { className: 'detalhe' }, 'no recorte, de ' + f.inteiro(v.registros.dataset) + ' no dataset')),
          h('div', { className: 'kpi alerta', title: v.alertas.legenda }, h('div', { className: 'nome' }, h(Icone, { nome: 'alerta' }), 'Alertas de lavagem'),
            h('div', { className: 'valor' }, '⚠ ' + f.inteiro(v.alertas.n)), h('div', { className: 'detalhe' }, n ? f.pct(v.alertas.proporcao, 2) + ' das ' + f.inteiro(n) + ' transações do recorte' : '—'),
            n ? h(Barra, { fracao: Math.max(v.alertas.proporcao, v.alertas.n ? 0.01 : 0), alerta: true, rotulo: f.pct(v.alertas.proporcao, 2) + ' do recorte com alerta' }) : null),
          h('div', { className: 'kpi', title: v.periodo ? v.periodo.legenda : '' }, h('div', { className: 'nome' }, h(Icone, { nome: 'relogio' }), 'Período coberto'),
            v.periodo ? h(React.Fragment, null, h('div', { className: 'valor menor' }, f.dataHora(v.periodo.inicio)), h('div', { className: 'detalhe' }, 'até ' + f.dataHora(v.periodo.fim)))
              : h('div', { className: 'valor menor' }, 'Sem transações no recorte. Ajuste os filtros.')),
          h('div', { className: 'kpi', title: v.score ? v.score.legenda : '' }, h('div', { className: 'nome' }, h(Icone, { nome: 'score' }), 'Score (0 a 1000)'),
            h('div', { className: 'valor' }, v.score ? f.numero(v.score.mediana, Number.isInteger(v.score.mediana) ? 0 : 1) : '—', v.score ? h('small', null, 'mediano') : null),
            h('div', { className: 'detalhe' }, v.score ? 'mín. ' + v.score.min + ' · máx. ' + v.score.max : '—'))),
        v.valor_minimo && v.valor_minimo.fora ? h(Aviso, { tom: 'atencao', titulo: 'O valor mínimo de ' + f.numero(v.valor_minimo.aplicado, 0) + ' deixa ' + f.plural(v.valor_minimo.fora, 'transação', 'transações') + ' fora do recorte' },
          h('details', null, h('summary', null, (v.valor_minimo.alertas_fora ? f.plural(v.valor_minimo.alertas_fora, 'delas tem alerta', 'delas têm alerta') : 'Nenhuma delas tem alerta') + ' · por moeda e como incluí-las'),
            h('p', { className: 'legenda' }, 'Por moeda: ' + v.valor_minimo.por_moeda.map(m => m.moeda + ' ' + f.inteiro(m.n)).join(', ') + '. ' + v.valor_minimo.legenda))) : null,
        h('div', { className: 'grade principal-lateral' },
          h(ResumoScore, { v, aoVista }),
          h('div', { className: 'bloco' }, h('h3', null, h(Icone, { nome: 'visao' }), 'Formato de pagamento'),
            v.formatos.itens.length ? h(React.Fragment, null,
              h('ul', { className: 'barras', 'aria-label': v.formatos.legenda }, v.formatos.itens.map(x => h('li', { key: x.formato },
                h('span', { className: 'nome-barra', title: x.formato }, x.nao_informado ? h('em', null, x.formato) : x.formato),
                h(Barra, { fracao: x.proporcao, rotulo: f.pct(x.proporcao, 1) + ' das transações do recorte' }),
                h('span', { className: 'valor-barra' }, h('strong', null, f.inteiro(x.n)), ' · ' + f.pct(x.proporcao, 1))))),
              h(Legenda, null, v.formatos.legenda + '. Formato vazio ou desconhecido aparece como "Não informado".')) : h(Vazio, { compacto: true }, 'Nenhuma transação no recorte.'))),
        h('div', { className: 'grade duas' },
          h('div', { className: 'bloco' },
            h('div', { className: 'cabeca-bloco' }, h('h3', null, h(Icone, { nome: 'contas' }), 'Contas prioritárias'),
              cr && cr.contas.length ? h('button', { type: 'button', className: 'botao pequeno fantasma', onClick: () => aoVista('investigacao') }, 'Investigar', h(Icone, { nome: 'seta' })) : null),
            cr && cr.contas.length ? h('ol', { className: 'contas' }, cr.contas.slice(0, 5).map((c, i) =>
              h('li', { key: c.conta }, h('button', { type: 'button', className: 'botao conta', onClick: () => aoFocar(c.conta), 'aria-label': 'Abrir o grafo da conta ' + c.conta + ': ' + f.plural(c.alertas, 'transação com alerta', 'transações com alerta') + ', maior score ' + c.maior_score },
                h('span', { className: 'pos' }, i + 1), h('span', { className: 'id' }, c.conta),
                h('span', { className: 'score-max' }, c.maior_score, h('small', null, 'maior score')),
                h('span', { className: 'dados risco' }, '⚠ ' + f.plural(c.alertas, 'transação com alerta', 'transações com alerta')))))) :
              h(Vazio, { compacto: true }, 'Nenhuma conta tem transação com alerta no recorte.')),
          h('div', { className: 'bloco' }, h('h3', null, h(Icone, { nome: 'sequencia' }), 'Tipologias de lavagem — registradas no dataset'),
            v.tipologias.disponivel ? h(React.Fragment, null, h('div', { className: 'rolagem' }, h('table', null,
              h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Tipologia'), h('th', { scope: 'col', className: 'num' }, 'Transações'), h('th', { scope: 'col', className: 'num' }, 'Com alerta'))),
              h('tbody', null, v.tipologias.itens.map(x => h('tr', { key: x.tipologia, title: x.descricao },
                h('td', { className: 'mono' }, x.tipologia), h('td', { className: 'num' }, f.inteiro(x.n)), h('td', { className: 'num' }, x.alertas ? h('strong', null, f.inteiro(x.alertas)) : '0')))))),
              h(Legenda, null, h('strong', null, 'Origem: '), v.tipologias.origem + '. ' + v.tipologias.legenda)) : h(Vazio, { compacto: true }, v.tipologias.motivo))),
        ROTULO ? h('div', { className: 'bloco' }, h('h3', null, h(Icone, { nome: 'info' }), 'Rótulo do dataset — separado da previsão'),
          v.rotulo.disponivel ? h(React.Fragment, null,
            h(Pares, { itens: [['Rotuladas como lavagem no recorte', f.inteiro(v.rotulo.rotuladas_lavagem)], ['Dessas, com alerta do modelo', f.inteiro(v.rotulo.rotuladas_com_alerta)]] }),
            h(Legenda, null, v.rotulo.legenda)) : h(Vazio, null, v.rotulo.motivo)) : null);
    }
    return h(Secao, { id: 'visao', icone: 'painel', titulo: 'Visão geral do recorte', pergunta: 'Quantas transações e alertas existem no recorte, em que período e com que scores?' }, corpo);
  }

  /* ═══ 4. Contas de maior risco e grafo ═══════════════════════════════ */
  function SecaoInvestigacao({ visao, focoPedido, aoFocar, cargaGrafo, analiseId, filtros, total, profundidade, aoProfundidade, aoFiltrarTabela }) {
    const cr = visao.dados ? visao.dados.contas_risco : null;
    const focoAtual = cargaGrafo.dados && cargaGrafo.dados.foco;
    return h(Secao, { id: 'investigacao', icone: 'grafo', titulo: 'Contas de maior risco e grafo de transações', pergunta: 'Quais contas devo investigar primeiro, e para onde o dinheiro foi?' },
      h('div', { className: 'grade', style: { gridTemplateColumns: 'minmax(260px, 320px) minmax(0, 1fr)', alignItems: 'start' }, id: 'grade-investigacao' },
        h('div', { className: 'bloco' }, h('h3', null, h(Icone, { nome: 'contas' }), 'Contas de maior risco' + (cr ? ' (até ' + cr.limite + ')' : '')),
          !cr ? h(Esqueleto, { linhas: 6, altura: 30 }) : cr.contas.length ? h('ol', { className: 'contas' }, cr.contas.map((c, i) =>
            h('li', { key: c.conta }, h('button', { type: 'button', className: 'botao conta', 'aria-pressed': focoAtual === c.conta, onClick: () => aoFocar(c.conta) },
              h('span', { className: 'pos' }, i + 1),
              h('span', { className: 'id' }, c.conta),
              h('span', { className: 'score-max' }, c.maior_score, h('small', null, 'maior score')),
              h('span', { className: 'dados risco' }, '⚠ ' + f.plural(c.alertas, 'transação com alerta', 'transações com alerta') + ' (' + f.inteiro(c.alertas_como_origem) + ' como origem, ' + f.inteiro(c.alertas_como_destino) + ' como destino)'),
              h('span', { className: 'dados' }, f.plural(c.transacoes_no_recorte, 'transação no recorte', 'transações no recorte')))))) :
            h(Vazio, { compacto: true }, 'Nenhuma conta tem transação com alerta no recorte.'),
          cr ? h('details', { style: { marginTop: 10 } }, h('summary', null, 'Como a lista é ordenada'),
            h(Legenda, null, h('strong', null, 'Regra: '), cr.regra),
            h(Legenda, null, 'Selecionar uma conta abre o grafo dela, uma de cada vez. Banco e conta aparecem juntos (banco-conta), como na tabela.')) : null),
        h('div', { className: 'bloco', style: { minWidth: 0 } }, h('h3', null, h(Icone, { nome: 'grafo' }), 'Grafo de transações financeiras'),
          h(BlocoGrafo, { carga: cargaGrafo, analiseId, filtros, total, profundidade, aoProfundidade, aoFocar, aoFiltrarTabela }))));
  }

  /* ═══ 5. Tabela de registros ═════════════════════════════════════════ */
  /* Colunas padrão enxutas; as demais aparecem ao expandir a linha (e podem ser ligadas em "Colunas"). */
  const COLUNAS = [
    { id: 'posicao', nome: 'Posição', num: true, dica: 'lugar na lista atual, a partir de 1' },
    { id: 'id_exibicao', nome: 'ID de exibição', padrao: true, dica: 'ordem cronológica no dataset inteiro' },
    { id: 'data_hora', nome: 'Data e hora', padrao: true },
    { id: 'banco_origem', nome: 'Banco de origem' }, { id: 'conta_origem', nome: 'Conta de origem', padrao: true },
    { id: 'banco_destino', nome: 'Banco de destino' }, { id: 'conta_destino', nome: 'Conta de destino', padrao: true },
    { id: 'valor_pago', nome: 'Valor pago', padrao: true, num: true }, { id: 'moeda_pagamento', nome: 'Moeda', padrao: true },
    { id: 'formato', nome: 'Formato de pagamento' },
    { id: 'score', nome: 'Score', padrao: true, num: true }, { id: 'alerta', nome: 'Alerta', padrao: true },
    { id: 'valor_recebido', nome: 'Valor recebido', num: true }, { id: 'moeda_recebimento', nome: 'Moeda recebida' },
    { id: 'rotulo', nome: 'Rótulo do dataset' }, { id: 'tipologias', nome: 'Tipologias registradas' },
    { id: 'linha_arquivo', nome: 'Linha no arquivo', num: true }, { id: 'id_original', nome: 'ID original do arquivo' },
  ].filter(c => c.id !== 'rotulo' || ROTULO);   // coluna escondida também quando estava salva nas preferências
  const celula = (c, l, total) => {
    switch (c.id) {
      case 'posicao': return f.inteiro(l.posicao);
      case 'id_exibicao': return f.idExibicao(l.id_exibicao, total);
      case 'data_hora': return f.dataHora(l.data_hora);
      case 'valor_pago': case 'valor_recebido': return f.valor(l[c.id]);
      case 'score': return h('span', { className: 'score-celula ' + l.faixa }, h('span', { className: 'mini', 'aria-hidden': 'true' }, h('i', { style: { width: Math.max(2, l.score / 10) + '%' } })), l.score);
      case 'alerta': return l.alerta ? h(Selo, { tom: 'alerta' }, '⚠ Sim', h('span', { className: 'sr' }, ' (faixa ' + NOME_FAIXA[l.faixa] + ')'))
        : h('span', { className: 'suave' }, 'Não', h('span', { className: 'fraco' }, ' · ' + NOME_FAIXA[l.faixa]));
      case 'rotulo': return l.rotulo === null ? 'sem rótulo' : l.rotulo === 1 ? 'lavagem' : 'não lavagem';
      case 'tipologias': return l.tipologias.length ? l.tipologias.join(', ') : '—';
      case 'linha_arquivo': return f.inteiro(l.linha_arquivo);
      default: if (c.extra) return f.vazio(l.extras[c.extra]) ? '—' : l.extras[c.extra];
        return f.vazio(l[c.id]) ? '—' : l[c.id];
    }
  };

  function SecaoTabela({ carga, manifesto, tabela, setTabela, aoDetalhe, selecionada }) {
    const extras = (manifesto.dataset.colunas_nao_reconhecidas || []).map(c => ({ id: 'x:' + c, nome: c + ' (coluna original)', extra: c }));
    const todas = COLUNAS.concat(extras);
    const [visiveis, setVisiveis] = React.useState(() => {
      try { const g = JSON.parse(localStorage.getItem('nw.colunas') || 'null'); if (Array.isArray(g) && g.length) return g; } catch (e) { /* preferência ausente */ }
      return COLUNAS.filter(c => c.padrao).map(c => c.id);
    });
    const [expandidas, setExpandidas] = React.useState(() => new Set());
    React.useEffect(() => { setExpandidas(new Set()); }, [carga.dados]);
    const alternar = id => {
      const novo = visiveis.includes(id) ? visiveis.filter(x => x !== id) : visiveis.concat(id);
      setVisiveis(novo);
      try { localStorage.setItem('nw.colunas', JSON.stringify(novo)); } catch (e) { /* sem armazenamento local */ }
    };
    const expandir = id => setExpandidas(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const cols = todas.filter(c => visiveis.includes(c.id));
    const ocultas = todas.filter(c => !visiveis.includes(c.id));
    const total = manifesto.contagens.pontuadas;
    const d = carga.dados;
    return h(Secao, { id: 'tabela', icone: 'tabela', titulo: 'Registros de transação', pergunta: 'Quais transações devo investigar primeiro, e por quê?' },
      h('div', { className: 'barra-tabela' },
        h('p', { role: 'status' }, d ? h(React.Fragment, null, h('strong', null, f.inteiro(d.total)), ' registros no recorte · página ' + d.pagina + ' de ' + f.inteiro(d.paginas)) : 'Carregando…'),
        h('div', { className: 'controles' },
          h('label', { htmlFor: 't-ord' }, 'Ordenar por'),
          h('select', { id: 't-ord', value: tabela.ordenar + ':' + tabela.direcao,
            onChange: e => { const [o, dr] = e.target.value.split(':'); setTabela(Object.assign({}, tabela, { ordenar: o, direcao: dr, pagina: 1 })); } },
            h('option', { value: 'id_exibicao:asc' }, 'Data e hora (mais antigas primeiro)'), h('option', { value: 'id_exibicao:desc' }, 'Data e hora (mais recentes primeiro)'),
            h('option', { value: 'score:desc' }, 'Score (maior primeiro)'), h('option', { value: 'score:asc' }, 'Score (menor primeiro)'),
            h('option', { value: 'valor_pago:desc' }, 'Valor pago (maior primeiro, sem converter moeda)')),
          h('label', { htmlFor: 't-tam' }, 'Linhas'),
          h('select', { id: 't-tam', value: tabela.tamanho, onChange: e => setTabela(Object.assign({}, tabela, { tamanho: +e.target.value, pagina: 1 })) },
            [25, 50, 100, 200].map(n => h('option', { key: n, value: n }, n))))),
      h('details', null, h('summary', null, 'Colunas (' + cols.length + ' de ' + todas.length + ' visíveis)'),
        h('fieldset', { style: { border: 0, padding: 0, margin: 0 } }, h('legend', { className: 'legenda' }, 'Marque as colunas a exibir. A lista inclui todas as colunas originais do dataset; as desmarcadas aparecem ao expandir a linha.'),
          h('div', { className: 'grade campos', style: { marginTop: 8, gap: 6 } }, todas.map(c => h('label', { key: c.id, style: { fontWeight: 400, margin: 0 } },
            h('input', { type: 'checkbox', checked: visiveis.includes(c.id), onChange: () => alternar(c.id) }), ' ' + c.nome + (c.dica ? ' — ' + c.dica : '')))))),
      carga.erro ? h(Erro, { erro: carga.erro }) : !d ? h(Esqueleto, { linhas: 8, altura: 22, texto: 'Carregando os registros…' }) : !d.linhas.length ? h(Vazio, null, 'Nenhuma transação passa pelos filtros atuais.') :
        h('div', { className: 'rolagem', 'aria-busy': carga.carregando }, h('table', { className: 'tabela-registros' },
          h('caption', null, 'Selecione o ID de exibição para ver os detalhes da transação, ou expanda a linha para ver as demais colunas.'),
          h('thead', null, h('tr', null, h('th', { scope: 'col', className: 'expandir' }, h('span', { className: 'sr' }, 'Expandir')), cols.map(c => h('th', { key: c.id, scope: 'col', className: c.num ? 'num' : '' }, c.nome)))),
          h('tbody', null, d.linhas.map(l => {
            const aberta = expandidas.has(l.id_exibicao), idTx = f.idExibicao(l.id_exibicao, total);
            const linha = h('tr', { key: l.id_exibicao, className: (l.alerta ? 'com-alerta ' : '') + (selecionada === l.id_exibicao ? 'selecionada ' : '') + (aberta ? 'expandida' : '') },
              h('td', { className: 'expandir' }, h('button', { type: 'button', className: 'botao pequeno icone fantasma alternar', 'aria-expanded': aberta, 'aria-controls': 'tx-extra-' + l.id_exibicao,
                'aria-label': (aberta ? 'Recolher' : 'Expandir') + ' a transação ' + idTx, onClick: () => expandir(l.id_exibicao) }, h(Icone, { nome: 'chevron' }))),
              cols.map(c => h('td', { key: c.id, className: (c.num ? 'num ' : '') + (['conta_origem', 'conta_destino', 'id_exibicao'].includes(c.id) ? 'mono' : '') },
                c.id === 'id_exibicao' ? h('button', { type: 'button', className: 'botao texto mono', onClick: () => aoDetalhe(l.id_exibicao),
                  'aria-label': 'Detalhes da transação ' + idTx + (l.alerta ? ', com alerta' : '') }, idTx) : celula(c, l, total))));
            if (!aberta) return linha;
            return [linha, h('tr', { key: l.id_exibicao + '-x', id: 'tx-extra-' + l.id_exibicao, className: 'linha-extra' },
              h('td', { colSpan: cols.length + 1 },
                h('dl', { className: 'pares' }, ocultas.map(c => h('div', { key: c.id }, h('dt', null, c.nome), h('dd', null, c.id === 'id_exibicao' ? idTx : celula(c, l, total))))),
                h('div', { className: 'linha', style: { marginTop: 10 } },
                  h('button', { type: 'button', className: 'botao pequeno', onClick: () => aoDetalhe(l.id_exibicao) }, h(Icone, { nome: 'detalhes' }), 'Ver detalhes completos'))))];
          })))),
      d && d.paginas > 1 ? h('nav', { className: 'paginacao', 'aria-label': 'Páginas da tabela' },
        h('button', { type: 'button', className: 'botao pequeno', disabled: d.pagina <= 1, onClick: () => setTabela(Object.assign({}, tabela, { pagina: 1 })) }, 'Primeira'),
        h('button', { type: 'button', className: 'botao pequeno', disabled: d.pagina <= 1, onClick: () => setTabela(Object.assign({}, tabela, { pagina: d.pagina - 1 })) }, 'Anterior'),
        h('span', { className: 'suave tab-num' }, 'Página ' + d.pagina + ' de ' + f.inteiro(d.paginas)),
        h('button', { type: 'button', className: 'botao pequeno', disabled: d.pagina >= d.paginas, onClick: () => setTabela(Object.assign({}, tabela, { pagina: d.pagina + 1 })) }, 'Próxima'),
        h('button', { type: 'button', className: 'botao pequeno', disabled: d.pagina >= d.paginas, onClick: () => setTabela(Object.assign({}, tabela, { pagina: d.paginas })) }, 'Última')) : null,
      h('details', null, h('summary', null, 'Como ler a tabela'),
        h(Legenda, null, h('strong', null, 'Legenda: '), 'faixa vermelha no início da linha e "⚠ Sim" = transação com alerta (score 701 ou mais). ',
          h('strong', null, 'Posição'), ' = lugar na lista atual. ', h('strong', null, 'ID de exibição'), ' = ordem cronológica no dataset inteiro (empates pela ordem da linha); não muda com filtros. ',
          'Valores na moeda de pagamento, sem conversão. Datas no horário do dataset, formato dia/mês/ano.')));
  }

  /* ═══ 6. Detalhes da transação (diálogo) ═════════════════════════════ */
  function DialogoDetalhes({ analiseId, id, total, aoFechar, aoFiltrarTabela, aoFocar, aoPerguntar, aoInterpretar }) {
    const carga = useCarga(id ? '/analises/' + analiseId + '/transacoes/' + id : null);
    const d = carga.dados;
    let corpo = h(Esqueleto, { linhas: 6, altura: 18, texto: 'Carregando a transação…' });
    let titulo = 'Detalhes da transação' + (id ? ' ' + f.idExibicao(id, total) : '');
    if (carga.erro) corpo = h(Erro, { erro: carga.erro });
    else if (d) {
      const t = d.transacao, mod = d.modelo || {}, conv = d.conversao_score || {};
      const fx = d.faixas.find(x => x.id === t.faixa);
      const cartao = (titulo, conteudo, extra) => h('div', { className: 'bloco' + (extra ? ' ' + extra : '') }, h('h3', null, titulo), conteudo);
      const conta = (papel, no, banco, numero) => cartao(papel, h(React.Fragment, null,
        h('p', { className: 'mono', style: { fontSize: 'var(--t-l)', fontWeight: 600, marginBottom: 8 } }, no),
        h(Pares, { itens: [['Banco', banco], ['Conta', h('span', { className: 'mono' }, numero)], ['Identificador (banco-conta)', h('span', { className: 'mono' }, no)]] }),
        h('div', { className: 'linha', style: { marginTop: 10 } },
          h('button', { type: 'button', className: 'botao pequeno', onClick: () => { aoFocar(no); aoFechar(); } }, h(Icone, { nome: 'grafo' }), 'Ver no grafo'),
          h('button', { type: 'button', className: 'botao pequeno', onClick: () => { aoFiltrarTabela(papel === 'Origem' ? { conta_origem: no, conta_destino: '' } : { conta_origem: '', conta_destino: no }); aoFechar(); } }, h(Icone, { nome: 'filtro' }), 'Filtrar tabela por esta conta'))));
      corpo = h(React.Fragment, null,
        /* Score em destaque: valor, faixa, classificação e o nível de risco na régua 0–1000 */
        h('div', { className: 'score-destaque' },
          h('div', { className: 'bloco' + (t.alerta ? ' alerta' : '') },
            h('div', { className: 'cabeca-bloco' }, h('h3', null, h(Icone, { nome: 'score' }), 'Previsão de lavagem (modelo)'),
              aoInterpretar ? h('button', { type: 'button', className: 'botao pequeno fantasma', onClick: aoInterpretar, 'aria-label': 'Interpretação do score: abrir em Detalhes' }, h(Icone, { nome: 'info' }), 'Interpretação do score') : null),
            h(MedidorScore, { score: t.score, faixa: t.faixa, nomeFaixa: fx.nome + ' (' + fx.de + '–' + fx.ate + ')', alerta: t.alerta }),
            h('p', { className: 'legenda', style: { marginTop: 10 } }, h('strong', null, 'Recomendação da faixa: '), fx.recomendacao + '.')),
          cartao('Transação observada', h(Pares, { itens: [['Data e hora', f.dataHora(t.data_hora) + ' (horário do dataset)'], ['Valor pago', h('strong', null, f.valor(t.valor_pago) + ' ' + t.moeda_pagamento)],
            ['Valor recebido', f.valor(t.valor_recebido) + ' ' + t.moeda_recebimento], ['Formato de pagamento', t.formato]] }))),
        h('div', { className: 'fluxo-contas' },
          conta('Origem', t.no_origem, t.banco_origem, t.conta_origem),
          h('div', { className: 'seta-fluxo' + (t.alerta ? ' alerta' : ''), 'aria-hidden': 'true' }, h(Icone, { nome: 'seta' })),
          conta('Destino', t.no_destino, t.banco_destino, t.conta_destino)),
        h('div', { className: 'cartoes' },
          cartao('Motivos verificáveis', t.motivos.length ? h(React.Fragment, null, h('ul', { className: 'grade', style: { gap: 6 } }, t.motivos.map((m, i) => h('li', { key: i }, '• ' + m))),
            h(Legenda, null, 'Fatos conferíveis nos dados, calculados com regras fixas sobre o treino. Não explicam a decisão do modelo.')) :
            h(Legenda, null, t.alerta ? 'Não há motivo verificável para esta transação.' : 'Não há motivo verificável: os motivos só são calculados para transações com alerta.')),
          cartao('Tipologias registradas', d.tipologias_disponiveis ? h(React.Fragment, null,
            h('p', { className: 'mono' }, t.tipologias.length ? t.tipologias.join(', ') : 'padrao_nao_identificado'),
            h(Legenda, null, t.tipologias.length ? 'Registrada no arquivo de padrões do dataset (tentativa nº ' + t.tentativas.join(', ') + '). Não é previsão do modelo.' : 'Esta transação não aparece no arquivo de padrões do dataset.')) :
            h(Legenda, null, d.motivo_sem_tipologias || 'Este dataset não tem tipologias registradas.')),
          ROTULO ? cartao('Rótulo do dataset', d.rotulo_disponivel ? h(React.Fragment, null, h('p', null, h('strong', null, t.rotulo === 1 ? 'Lavagem (rótulo 1)' : 'Não lavagem (rótulo 0)')),
            h(Legenda, null, 'Valor que já veio no arquivo. Não é previsão e não entra no cálculo do score.')) : h(Legenda, null, 'Este dataset não tem rótulo de lavagem.')) : null),
        h('details', { className: 'acordeao' }, h('summary', null, 'Dados técnicos do score e da transação'),
          h('div', { className: 'conteudo' },
            h(Pares, { itens: [['Score', t.score + ' de 1000'], ['Faixa', fx.nome + ' (' + fx.de + '–' + fx.ate + ')'], ['Alerta', t.alerta ? '⚠ Sim' : 'Não'],
              ['Limiar de alerta', 'score 701 = score original ' + f.numero(mod.limiar_alerta, 4) + ' (limiar do modelo, escala de 0 a 1)'],
              ['Score original do modelo', f.numero(t.score_bruto, 4) + ' (0 a 1, não calibrado)'], ['Versão do modelo', mod.versao],
              ['Histórico da conta', t.historico_incompleto ? 'incompleto: menos de 72 h observadas antes desta transação' : 'ao menos 72 h observadas'],
              ['ID de exibição', f.idExibicao(t.id_exibicao, total)], ['ID original do arquivo', t.id_original || 'o arquivo não tem coluna de identificador'],
              ['Linha no arquivo', f.inteiro(t.linha_arquivo) + ' (o cabeçalho é a linha 1)']].concat(
              Object.entries(t.extras || {}).map(([k, v]) => [k + ' (coluna original)', v])) }),
            h(Legenda, null, conv.leitura + ' ' + d.aviso_faixas))),
        aoPerguntar ? h('div', { className: 'linha' },
          h('button', { type: 'button', className: 'botao', onClick: () => aoPerguntar(t.id_exibicao) }, h(Icone, { nome: 'assistente' }), 'Perguntar ao Assistente de dúvidas sobre esta transação')) : null);
      titulo = h(React.Fragment, null, 'Transação ' + f.idExibicao(t.id_exibicao, total), t.alerta ? h(Selo, { tom: 'alerta' }, '⚠ Com alerta') : h(Selo, { tom: TOM_FAIXA[t.faixa] }, 'Faixa ' + NOME_FAIXA[t.faixa]));
    }
    return h(Dialogo, { id: 'dlg-detalhes', aberto: !!id, titulo, aoFechar }, corpo);
  }

  /* ═══ 7. Detalhes: interpretação do score e definições ═══════════════ */
  /* Explicação completa do score, em blocos recolhíveis. Os números (limiar, score de alerta, faixas e a
     conversão) vêm da API — do manifesto aberto ou, sem análise, do modelo carregado. Nada é recalculado aqui. */
  function InterpretacaoScore({ estado, manifesto }) {
    const conv = (manifesto && manifesto.conversao_score) || {}, leg = estado.score || {};
    const limiar = limiarDe(manifesto, estado);
    const alerta = estado.score_alerta || leg.score_alerta || 701;
    const faixas = estado.faixas || [];
    if (!limiar) return h(Aviso, { tom: 'atencao', titulo: 'Limiar indisponível' }, 'O modelo não está carregado: a interpretação completa aparece quando o limiar do modelo estiver disponível.');
    const inicioInter = limiar * 301 / 701;
    const orig = v => f.numero(v, 4);
    const faixaOriginal = id => id === 'baixa' ? '0 a ' + orig(inicioInter) : id === 'intermediaria' ? orig(inicioInter) + ' a ' + orig(limiar) : orig(limiar) + ' a 1';
    const ev = leg.evidencia_de_nao_calibracao;
    return h('section', { className: 'grade', 'aria-labelledby': 'interpretacao-t' },
      h('div', { className: 'cabeca-bloco', style: { marginBottom: 0 } },
        h('h3', { id: 'interpretacao-t', className: 'titulo-bloco', style: { fontSize: 'var(--t-l)', margin: 0 } }, h(Icone, { nome: 'score' }), 'Interpretação do score'),
        h('span', { className: 'selo neutro' }, 'Como ler o score')),
      h('dl', { className: 'estatisticas' },
        h(Estat, { nome: 'Score original do modelo', valor: '0 a 1', sub: 'não calibrado' }),
        h(Estat, { nome: 'Índice exibido', valor: '0 a 1000', sub: 'ordena e separa em faixas' }),
        h(Estat, { nome: 'Limiar original', valor: orig(limiar), sub: 'equivale ao score ' + alerta }),
        h(Estat, { nome: 'Alerta', valor: alerta + ' ou mais', sub: 'faixa alta' })),
      h('div', { className: 'acordeoes' },
        h('details', { className: 'acordeao', open: true }, h('summary', null, 'O que o score representa', h('span', { className: 'sub' }, 'pontos 1 a 5')),
          h('div', { className: 'conteudo' },
            h('ol', { className: 'pontos' },
              h('li', null, 'O modelo devolve um ', h('strong', null, 'score original entre 0 e 1'), '.'),
              h('li', null, 'Esse score ', h('strong', null, 'não representa uma probabilidade calibrada'), '.'),
              h('li', null, 'O painel converte o valor para um ', h('strong', null, 'índice de 0 a 1000'), '.'),
              h('li', null, 'A conversão serve para ', h('strong', null, 'ordenar e separar os registros em faixas'), '.'),
              h('li', null, 'O índice ', h('strong', null, 'não representa probabilidade de lavagem ou fraude'), '.')),
            leg.natureza ? h(Legenda, null, leg.natureza) : null)),
        h('details', { className: 'acordeao', open: true }, h('summary', null, 'Limiar e faixas', h('span', { className: 'sub' }, 'pontos 6 a 10')),
          h('div', { className: 'conteudo' },
            h('ol', { className: 'pontos', start: 6, style: { counterReset: 'ponto 5' } },
              h('li', null, 'O limiar original informado pelo modelo é ', h('strong', { className: 'mono' }, orig(limiar)), '.'),
              h('li', null, 'O score ', h('strong', null, String(alerta)), ' corresponde ao limiar de alerta: tudo a partir dele é alerta e faixa alta.'),
              faixas.map(x => h('li', { key: x.id }, 'Faixa ', h('strong', null, x.nome.toLowerCase()), ': ' + x.de + '–' + x.ate + '.'))),
            h('div', { className: 'escala', role: 'img', 'aria-label': 'Escala do score: de 0 a 300, faixa baixa, score original de 0 a ' + orig(inicioInter) + '; de 301 a 700, faixa intermediária, score original de ' + orig(inicioInter) + ' a ' + orig(limiar) +
              '; de 701 a 1000, faixa alta com alerta, score original de ' + orig(limiar) + ' a 1. O limiar original do modelo, ' + orig(limiar) + ', corresponde ao score 701.' },
              h('div', { className: 'faixas' }, h('div', { className: 'f-baixa' }, 'Baixa · 0–300'), h('div', { className: 'f-intermediaria' }, 'Intermediária · 301–700'), h('div', { className: 'f-alta' }, '⚠ Alta · 701–1000')),
              h('div', { className: 'marcas' },
                h('div', null, h('span', null, 'original 0'), h('span', null, orig(inicioInter))),
                h('div', null, h('span', null, ''), h('strong', null, orig(limiar) + ' (limiar)')),
                h('div', null, h('span', null, ''), h('span', null, 'original 1')))),
            h('div', { className: 'rolagem' }, h('table', null,
              h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Faixa'), h('th', { scope: 'col' }, 'Índice'), h('th', { scope: 'col' }, 'Score original'), h('th', { scope: 'col' }, 'Recomendação'))),
              h('tbody', null, faixas.map(x => h('tr', { key: x.id, className: x.id === 'alta' ? 'com-alerta' : '' },
                h('td', null, h('span', { className: 'linha', style: { gap: 8 } }, h('span', { className: 'ponto-faixa ' + x.id, 'aria-hidden': 'true' }), h('strong', null, (x.id === 'alta' ? '⚠ ' : '') + x.nome))),
                h('td', { className: 'tab-num' }, x.de + '–' + x.ate), h('td', { className: 'mono' }, faixaOriginal(x.id)), h('td', { style: { whiteSpace: 'normal' } }, x.recomendacao)))))),
            h(Legenda, null, h('strong', null, 'Limiar original do modelo: '), orig(limiar) + ' (cerca de ' + f.numero(limiar, 3) + '), na escala de 0 a 1. Ele vira o score ' + alerta + ': tudo a partir dele é alerta e faixa alta. A faixa intermediária é o trecho logo abaixo do limiar (score original de ' +
              orig(inicioInter) + ' a ' + orig(limiar) + '); a faixa baixa é o que fica abaixo de ' + orig(inicioInter) + '.'))),
        h('details', { className: 'acordeao' }, h('summary', null, 'Como o score original vira o índice de 0 a 1000', h('span', { className: 'sub' }, 'conversão')),
          h('div', { className: 'conteudo' },
            h(Legenda, null, h('strong', null, 'Conversão: '), leg.conversao || conv.tipo || ''),
            conv.ancoras ? h('dl', { className: 'estatisticas' }, conv.ancoras.map((a, i) => h(Estat, { key: i, nome: 'Âncora ' + (i + 1), valor: 'original ' + orig(a.bruto) + ' → ' + a.score }))) : null,
            /* a evidência compara o score com o rótulo do dataset: só aparece quando o rótulo é exibido */
            ROTULO ? (ev ? h(React.Fragment, null, h('h4', null, 'Por que o score original não é uma probabilidade'),
              h(Legenda, null, ev.leitura + ' Origem: ' + ev.origem + '.'),
              h('div', { className: 'rolagem' }, h('table', null,
                h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Score original'), h('th', { scope: 'col', className: 'num' }, 'Transações'), h('th', { scope: 'col', className: 'num' }, 'Score médio'), h('th', { scope: 'col', className: 'num' }, 'Rotuladas como lavagem'))),
                h('tbody', null, ev.caixas.map((c, i) => h('tr', { key: i }, h('td', null, f.numero(c.de, 1) + ' a ' + f.numero(c.ate, 1)), h('td', { className: 'num' }, f.inteiro(c.transacoes)),
                  h('td', { className: 'num' }, f.numero(c.score_medio, 3)), h('td', { className: 'num' }, f.pct(c.fracao_rotulada_lavagem, 1)))))))) :
              h(Legenda, null, 'A avaliação histórica com a comparação entre score e rótulo não está disponível neste servidor.')) : null)),
        h('details', { className: 'acordeao', open: true }, h('summary', null, 'Finalidade e limites de uso', h('span', { className: 'sub' }, 'pontos 11 a 13')),
          h('div', { className: 'conteudo' },
            h('ol', { className: 'pontos', start: 11, style: { counterReset: 'ponto 10' } },
              h('li', null, 'As faixas são ', h('strong', null, 'recomendações para análise offline'), '.'),
              h('li', null, 'O NodeWatch ', h('strong', null, 'não bloqueia, não aprova e não realiza pagamentos'), ': não há integração bancária.'),
              h('li', null, 'O score é um ', h('strong', null, 'sinal para investigação, não uma prova de fraude'), ' nem de lavagem.')),
            estado.aviso_faixas ? h(Aviso, { tom: 'atencao' }, estado.aviso_faixas) : null))));
  }

  function SecaoDetalhes({ estado, manifesto, visao }) {
    const v = visao && visao.dados;
    return h(Secao, { id: 'detalhes', icone: 'detalhes', titulo: 'Detalhes', pergunta: 'Como interpretar o score e o que cada indicador mede?' },
      h(InterpretacaoScore, { estado, manifesto }),
      v ? h('details', { className: 'acordeao' }, h('summary', null, 'O que cada indicador mede', h('span', { className: 'sub' }, 'visão geral do recorte')),
        h('div', { className: 'conteudo' }, h(Pares, { itens: [['Registros de transação', v.registros.legenda], ['Alertas de lavagem', v.alertas.legenda],
          ['Período coberto', v.periodo ? v.periodo.legenda : null], ['Score (0 a 1000)', v.score ? v.score.legenda : null],
          ['Formato de pagamento', v.formatos.legenda], ['Contas de maior risco', v.contas_risco ? v.contas_risco.regra : null]] }))) : null,
      v && v.tipologias.disponivel ? h('details', { className: 'acordeao' }, h('summary', null, 'Tipologias registradas no dataset', h('span', { className: 'sub' }, 'descrições')),
        h('div', { className: 'conteudo' }, h(Pares, { itens: v.tipologias.itens.map(x => [h('span', { className: 'mono' }, x.tipologia), x.descricao]) }))) : null);
  }

  /* ═══ Painel lateral operacional ═════════════════════════════════════ */
  function Desempenho({ aberto }) {
    const [d, setD] = React.useState(null);
    const [erro, setErro] = React.useState(null);
    const ler = () => api('/operacao/desempenho').then(x => { setD(x); setErro(null); }).catch(setErro);
    React.useEffect(() => { if (aberto) ler(); }, [aberto]);
    useIntervalo(ler, 3000, aberto);
    if (erro) return h(Erro, { erro });
    if (!d) return h(Carregando, null);
    const mp = d.memoria.processo, mm = d.memoria.maquina, a = d.analise;
    const ind = v => f.vazio(v) ? 'indisponível neste sistema' : v;
    return h('div', { className: 'grade' },
      h('h3', null, h(Icone, { nome: 'operacao' }), ' Desempenho'),
      h(Pares, { itens: [
        ['RAM — processo do NodeWatch', f.vazio(mp.bytes) ? ind(null) : f.gb(mp.bytes) + ' (' + f.numero(mp.percentual_da_maquina, 1) + '% da memória da máquina) · pico desde o início do servidor ' + f.gb(mp.pico_bytes)],
        ['RAM — máquina', f.vazio(mm.em_uso_bytes) ? ind(null) : f.gb(mm.em_uso_bytes) + ' em uso de ' + f.gb(mm.total_bytes) + ' (' + f.numero(mm.percentual, 1) + '%)'],
        ['CPU — processo do NodeWatch', f.vazio(d.cpu.processo_pct) ? ind(null) : f.numero(d.cpu.processo_pct, 1) + '%'],
        ['CPU — máquina', f.vazio(d.cpu.maquina_pct) ? ind(null) : f.numero(d.cpu.maquina_pct, 1) + '%'],
      ] }),
      h(Legenda, null, 'CPU: ' + d.cpu.leitura + ' (' + d.cpu.nucleos_logicos + ' núcleos; janela de ' + f.numero(d.cpu.janela_s, 1) + ' s). Lido em ' + f.instante(d.medido_em) + '; atualiza a cada 3 s.'),
      h('h4', null, 'Latência das consultas'),
      d.latencias.length ? h('div', { className: 'rolagem' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Operação medida'), h('th', { scope: 'col', className: 'num' }, 'Última (ms)'), h('th', { scope: 'col', className: 'num' }, 'Mediana (ms)'), h('th', { scope: 'col', className: 'num' }, 'Amostras'))),
        h('tbody', null, d.latencias.map(l => h('tr', { key: l.operacao }, h('td', null, l.operacao), h('td', { className: 'num' }, f.numero(l.ultima_ms, 0)), h('td', { className: 'num' }, f.numero(l.mediana_ms, 0)), h('td', { className: 'num' }, l.amostras)))))) :
        h(Legenda, null, 'Nenhuma consulta medida ainda.'),
      h(Legenda, null, 'Latência = tempo de processamento de cada consulta no servidor, em milissegundos (não inclui a rede nem o navegador).'),
      h('h4', null, 'Análise'),
      a ? h(React.Fragment, null, h(Pares, { itens: [
        ['Qual', a.qual + ' — ' + a.dataset + ' (' + NOME_STATUS[a.status] + ')'],
        ['Duração total', f.vazio(a.duracao_total_s) ? (a.etapa_atual ? 'em andamento: ' + a.etapa_atual : '—') : f.duracao(a.duracao_total_s)],
        ['Vazão da análise inteira', f.vazio(a.vazao_total_por_s) ? 'ainda não medida' : f.inteiro(a.vazao_total_por_s) + ' transações por segundo (' + f.inteiro(a.transacoes_pontuadas) + ' ÷ ' + f.duracao(a.duracao_total_s) + ')'],
        ['Vazão só da pontuação', f.vazio(a.vazao_pontuacao_por_s) ? 'ainda não medida' : f.inteiro(a.vazao_pontuacao_por_s) + ' transações por segundo (' + f.inteiro(a.transacoes_pontuadas) + ' ÷ ' + f.duracao(a.tempo_pontuacao_s) + ')'],
        ['Pico de memória na pontuação', f.vazio(a.pico_memoria_bytes) ? 'ainda não medido' : f.gb(a.pico_memoria_bytes)],
        ['Tempo por atividade', ['atributos ' + f.duracao(a.tempos.tempo_atributos_s), 'inferência ' + f.duracao(a.tempos.tempo_inferencia_s), 'gravação ' + f.duracao(a.tempos.tempo_gravacao_s)].join(' · ')],
        ['Transações pontuadas', f.inteiro(a.transacoes_pontuadas)],
      ] }), h(Legenda, null, 'Vazão da análise inteira: ' + a.vazao_total_formula + '. Vazão só da pontuação: ' + a.vazao_pontuacao_formula + '. Pico de memória: ' + a.pico_escopo + '.')) : h(Legenda, null, 'Nenhuma análise foi feita ainda.'));
  }

  function ListaLogs({ tipo, aberto }) {
    const [d, setD] = React.useState(null);
    const ler = () => api('/operacao/logs?tipo=' + tipo + '&limite=150').then(setD).catch(() => {});
    React.useEffect(() => { if (aberto) ler(); }, [aberto, tipo]);
    useIntervalo(ler, 5000, aberto);
    if (!d) return h(Carregando, null);
    const NIVEL = { info: 'Informação', aviso: 'Aviso', erro: 'Erro' };
    return h('div', { className: 'grade' },
      h(Legenda, null, tipo === 'sistema' ? 'Envios, validações, início, fim, cancelamento e erros de análise.' : 'Modelo e versão carregados, limiar, transações pontuadas, tempo de inferência e avisos de atributos ou de esquema.', ' ' + d.privacidade),
      d.entradas.length ? h('ul', { className: 'log' }, d.entradas.map((e, i) => h('li', { key: i, className: e.nivel === 'erro' ? 'erro-log' : e.nivel === 'aviso' ? 'aviso-log' : '' },
        h('div', { className: 'quando' }, f.instante(e.quando) + ' · ' + (NIVEL[e.nivel] || e.nivel) + ' · ' + e.evento),
        h('div', null, e.mensagem),
        Object.keys(e.contexto || {}).length ? h('div', { className: 'ctx' }, Object.entries(e.contexto).map(([k, v]) => k + '=' + (typeof v === 'object' && v !== null ? JSON.stringify(v) : v)).join(' · ')) : null))) :
        h(Vazio, null, 'Nenhum registro ainda.'));
  }

  function MetricasML({ analiseId, aberto }) {
    const carga = useCarga(aberto ? '/operacao/metricas' + (analiseId ? '?analise=' + analiseId : '') : null);
    if (carga.erro) return h(Erro, { erro: carga.erro });
    if (!carga.dados) return h(Carregando, null);
    const { historicas: hi, do_dataset: dd, legendas } = carga.dados;
    const T = TEXTO_METRICAS;   // redação neutra quando o rótulo do dataset está escondido (EXIBIR.rotulo)
    const linhaMetricas = x => [['Precisão', x.precisao, T.precisao || legendas.precisao], ['Recall', x.recall, T.recall || legendas.recall], ['F1', x.f1, legendas.f1], ['Average Precision', x.average_precision, legendas.average_precision]];
    const motivoDataset = ROTULO || !/rótulo/i.test(dd.motivo || '') ? dd.motivo : T.sem_referencia;
    const tabela = x => h('div', { className: 'rolagem' }, h('table', null,
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Métrica'), h('th', { scope: 'col', className: 'num' }, 'Valor'), h('th', { scope: 'col' }, 'O que mede'))),
      h('tbody', null, linhaMetricas(x).map(([n, v, l]) => h('tr', { key: n }, h('td', null, n), h('td', { className: 'num' }, f.vazio(v) ? 'indisponível' : f.pct(v, 1)), h('td', { style: { whiteSpace: 'normal' } }, l))))));
    return h('div', { className: 'grade' },
      h('h4', null, 'Métricas históricas do modelo (avaliação anterior)'),
      hi.disponivel ? h(React.Fragment, null,
        h(Pares, { itens: [['Modelo', hi.versao_modelo], ['Dados', hi.dados], ['Origem', h('span', { className: 'mono' }, hi.origem)], ['Arquivo gravado em', f.instante(hi.arquivo_gravado_em)]] }),
        hi.conjuntos.map(c => h('div', { key: c.id, className: 'bloco' }, h('h4', { style: { marginTop: 0 } }, 'Conjunto de avaliação: ' + c.nome),
          h(Legenda, null, 'Período: ' + c.periodo + ' · ' + f.inteiro(c.transacoes) + ' transações, ' + f.inteiro(c.rotuladas_lavagem) + ' ' + T.positivos + '.'), tabela(c))),
        h(Aviso, { tom: 'atencao' }, hi.ressalva)) : h(Vazio, null, hi.motivo),
      h('h4', null, 'Neste dataset (análise aberta)'),
      dd.disponivel ? h(React.Fragment, null,
        h(Pares, { itens: [['Dataset', dd.dataset], ['Transações ' + T.conferiveis, f.inteiro(dd.transacoes_com_rotulo)], [T.positivos.charAt(0).toUpperCase() + T.positivos.slice(1), f.inteiro(dd.rotuladas_lavagem)],
          ['Alertas', f.inteiro(dd.alertas) + ' (' + f.inteiro(dd.verdadeiros_positivos) + ' ' + T.vp + ', ' + f.inteiro(dd.falsos_positivos) + ' ' + T.fp + ')'],
          exibir('base_treino') ? ['Base usada no treino do modelo', dd.base_no_treino === 'confirmado' ? 'confirmado (mesmo arquivo do treino)' : 'não confirmado'] : null] }),
        tabela(dd), h(Legenda, null, (T.origem || dd.origem) + '. ' + dd.leitura + (dd.parcial ? ' Resultado parcial.' : '')),
        exibir('base_treino') ? h(AvisoBaseTreino, { situacao: dd.base_no_treino, treino: dd.treino }) : null) : h(Vazio, null, motivoDataset),
      h(Legenda, null, 'As métricas históricas e as contagens da análise atual são coisas diferentes: as primeiras descrevem o modelo ' + T.conjunto + '; as segundas contam alertas no dataset analisado.'));
  }

  function PainelLateral({ aberto, aoFechar, analiseId }) {
    const [aba, setAba] = React.useState('sistema');
    const ref = React.useRef(null);
    React.useEffect(() => { if (aberto && ref.current) ref.current.focus(); }, [aberto]);
    const ABAS = [['sistema', 'Logs do sistema'], ['ml', 'Logs de ML'], ['metricas', 'Métricas de ML']];
    const tecla = e => {
      if (e.key === 'Escape') { aoFechar(); return; }
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = ABAS.findIndex(a => a[0] === aba), j = (i + (e.key === 'ArrowRight' ? 1 : ABAS.length - 1)) % ABAS.length;
      setAba(ABAS[j][0]);
      const b = document.getElementById('aba-' + ABAS[j][0]); if (b) b.focus();
    };
    return h(React.Fragment, null, h('div', { className: 'lateral-fundo', hidden: !aberto, onClick: aoFechar, 'aria-hidden': 'true' }),
      h('aside', { id: 'painel-operacional', className: 'lateral', hidden: !aberto, 'aria-labelledby': 'lateral-t', onKeyDown: e => { if (e.key === 'Escape') aoFechar(); } },
      h('header', null, h('h2', { id: 'lateral-t', tabIndex: -1, ref }, h(Icone, { nome: 'operacao' }), 'Painel operacional'), h('button', { type: 'button', className: 'botao fantasma', onClick: aoFechar }, h(Icone, { nome: 'fechar' }), 'Fechar')),
      h('div', { className: 'conteudo' },
        h('p', { className: 'legenda' }, 'O sistema e o modelo estão saudáveis?'),
        h(Desempenho, { aberto }),
        h('div', { role: 'tablist', className: 'abas', 'aria-label': 'Logs e métricas', onKeyDown: tecla },
          ABAS.map(([id, nome]) => h('button', { key: id, id: 'aba-' + id, role: 'tab', type: 'button', 'aria-selected': aba === id, 'aria-controls': 'painel-aba', tabIndex: aba === id ? 0 : -1, onClick: () => setAba(id) }, nome))),
        h('div', { role: 'tabpanel', id: 'painel-aba', 'aria-labelledby': 'aba-' + aba, tabIndex: 0 },
          aba === 'metricas' ? h(MetricasML, { analiseId, aberto }) : h(ListaLogs, { tipo: aba, aberto })))));
  }

  /* ═══ Legenda geral ══════════════════════════════════════════════════ */
  function DialogoLegenda({ aberto, aoFechar, estado }) {
    const grupo = (titulo, itens) => h('div', { className: 'bloco' }, h('h3', null, titulo), h(Pares, { itens }));
    return h(Dialogo, { id: 'dlg-legenda', aberto, titulo: 'Legenda geral', aoFechar },
      h(Legenda, null, 'Os mesmos termos valem em todas as áreas da tela. Nenhuma informação depende só de cor: há sempre um texto ou ícone junto.'),
      h('div', { className: 'cartoes' },
        grupo('Score e faixas', estado.faixas.map(x => [x.nome + ' (' + x.de + '–' + x.ate + ')', x.recomendacao]).concat([
          ['Score', 'Índice inteiro de 0 a 1000 que ordena as transações por prioridade. Não é probabilidade de lavagem nem de fraude.'],
          ['Score original', 'Valor de 0 a 1 que o modelo devolve. Não é calibrado. O limiar original (' + f.numero((estado.score || {}).limiar_original, 4) + ') corresponde ao score 701.'],
          ['Alerta', 'Score ' + estado.score_alerta + ' ou mais. Sinal para investigação, não prova de lavagem.'],
          ['Aviso', estado.aviso_faixas]])),
        grupo('Cores e ícones', [
          ['⚠ e vermelho', 'Transação, conta ou caminho com alerta. Na tabela, faixa vermelha no início da linha e o texto "⚠ Sim".'],
          ['Amarelo', 'Atenção: resultado parcial, linhas recusadas ou aviso.'],
          ['Verde e ✓', 'Etapa ou análise concluída; dataset válido.'],
          ['Azul (ciano)', 'Ação disponível, item selecionado, conta em foco, progresso ou etapa em andamento (▶).'],
          ['Contorno amarelo', 'Elemento com o foco do teclado.'],
          ['Vermelho da logo', 'É a cor da marca NodeWatch, usada só na logo (no "Watch"). Alerta é sempre o vermelho-coral acompanhado de ⚠ e texto.']]),
        grupo('Estados da análise', Object.entries(estado.status_analise).map(([k, v]) => [NOME_STATUS[k], v.replace(/^[^:]+:\s*/, '')])),
        grupo('Estados do dataset', [['Válido', 'Todas as linhas passaram na validação.'], ['Válido, com linhas recusadas', 'Há linhas com problema; elas ficam fora da análise e são listadas.'],
          ['Inválido', 'O arquivo não pode ser analisado; a tabela de problemas diz o que corrigir.']]),
        grupo('Tabela', [['Posição', 'Lugar da linha na lista atual (muda com filtros e ordenação).'], ['ID de exibição', 'Ordem cronológica no dataset inteiro; empates pela ordem da linha. Nunca muda.'],
          ROTULO ? ['Rótulo do dataset', 'Marcação de lavagem que já veio no arquivo; separada da previsão.'] : null, ['Não informado', 'Formato de pagamento vazio ou desconhecido no arquivo.'],
          ['Recorte', 'Conjunto de transações que passa pelos filtros aplicados.']]),
        grupo('Sessão da interface', [['Sessão ativa', estado.sessao.leitura], ['Sem retomada', 'Reabrir a página mostra o que ficou gravado. Nenhuma análise recomeça sozinha.']]),
        grupo('Grafo', [['Vértice', 'Uma conta (banco-conta). A conta em foco tem contorno duplo.'], ['Seta', 'Vai da conta de origem para a conta de destino do dinheiro.'],
          ['Traço tracejado', 'Relação do recorte sem ordem temporal confirmada: não é uma etapa seguinte do dinheiro.'], ['Sequência', 'Relações cujos horários são compatíveis, uma depois da outra. Não prova que é o mesmo dinheiro.'],
          ['Aresta agrupada', 'Traço grosso: várias transações de mesma origem, destino e moeda, com quantidade e total.'], ['Valor na aresta', 'Valor pago e moeda; moedas diferentes nunca são somadas.'],
          ['Disposição', 'Segue a tipologia registrada no dataset; sem tipologia, usa padrao_nao_identificado.']]),
        grupo('Tipologias (registradas no dataset, não previstas)', estado.tipologias.map(t => [h('span', { className: 'mono' }, t.tipologia), t.descricao]))));
  }

  /* ═══ Assistente de dúvidas ══════════════════════════════════════════ */
  /* Texto da resposta com **negrito**, listas "- " e quebras de linha, sem HTML (nada é interpretado como código). */
  function TextoRico({ texto }) {
    const linhas = String(texto || '').split(/\r?\n/);
    const inline = (s, k) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => /^\*\*[^*]+\*\*$/.test(p) ? h('strong', { key: k + '-' + i }, p.slice(2, -2)) : p);
    const blocos = [];
    let lista = null;
    linhas.forEach((l, i) => {
      const m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l);
      if (m) { if (!lista) { lista = []; blocos.push(h('ul', { key: 'u' + i, className: 'msg-lista' }, lista)); } lista.push(h('li', { key: i }, inline(m[1], i))); return; }
      lista = null;
      if (l.trim()) blocos.push(h('p', { key: i }, inline(l.replace(/^#+\s*/, ''), i)));
    });
    return h('div', { className: 'msg-texto' }, blocos);
  }

  const lerSessao = (chave, padrao) => { try { const v = sessionStorage.getItem(chave); return v === null ? padrao : v; } catch (e) { return padrao; } };
  const gravarSessao = (chave, valor) => { try { sessionStorage.setItem(chave, valor); } catch (e) { /* sem armazenamento: vale só nesta tela */ } };

  /* "Assistente de dúvidas" na tela; por dentro, o Sentinel AI (src/sentinel_ia.py), quando autorizado, com o
     contexto verificado da análise. Sem autorização ou sem chave, responde no modo local, sem serviço externo. */
  function Assistente({ analiseId, filtros, estado, transacaoId, aoLimparTransacao, pedido, total }) {
    const [aberto, setAberto] = React.useState(false);
    const [msgs, setMsgs] = React.useState([]);
    const [texto, setTexto] = React.useState('');
    const [ocupado, setOcupado] = React.useState(false);
    const sent = (estado.assistente && estado.assistente.sentinel) || { disponivel: false, envia: [] };
    const [usarSentinel, setUsarSentinel] = React.useState(() => lerSessao('nw-sentinel-autorizado', '0') === '1');
    const [modoLinguagem, setModoLinguagem] = React.useState(() => lerSessao('nw-sentinel-linguagem', 'leiga'));
    const refEntrada = React.useRef(null), refFim = React.useRef(null);
    const ativo = usarSentinel && sent.disponivel;
    // estado REAL da conexão (vem do servidor; só fica "conectado" depois de uma chamada que deu certo)
    const [conexao, setConexao] = React.useState(sent.conexao || null);
    const [testando, setTestando] = React.useState(false);
    const testarConexao = async () => {
      setTestando(true);
      try { setConexao(await api('/assistente/verificar', { method: 'POST' })); }
      catch (e) { setConexao({ estado: 'falhou', categoria: 'conexao', mensagem: e.erro || 'O servidor do NodeWatch não respondeu' }); }
      setTestando(false);
    };
    const cx = !sent.disponivel ? { tom: 'neutro', texto: 'Modo local (Sentinel AI desligado)' }
      : !conexao || conexao.estado === 'nao_verificado' ? { tom: 'neutro', texto: 'Sentinel AI: conexão não verificada' }
        : conexao.estado === 'conectado' ? { tom: 'ok', texto: 'Sentinel AI conectado' }
          : { tom: 'alerta', texto: 'Sentinel AI indisponível' + (conexao.mensagem ? ': ' + conexao.mensagem : '') };
    React.useEffect(() => { if (pedido) setAberto(true); }, [pedido]);
    React.useEffect(() => { if (aberto && refEntrada.current) refEntrada.current.focus(); }, [aberto, pedido]);
    React.useEffect(() => { if (refFim.current) refFim.current.scrollIntoView({ block: 'nearest' }); }, [msgs]);
    const autorizar = v => { setUsarSentinel(v); gravarSessao('nw-sentinel-autorizado', v ? '1' : '0'); };
    const linguagem = v => { setModoLinguagem(v); gravarSessao('nw-sentinel-linguagem', v); };
    const perguntar = async p => {
      p = (p || '').trim();
      if (!p || ocupado) return;
      setTexto(''); setOcupado(true);
      const historico = ativo ? msgs.filter(m => m.texto).slice(-10).map(m => ({ role: m.de === 'voce' ? 'user' : 'assistant', content: m.texto })) : [];
      setMsgs(m => m.concat([{ de: 'voce', texto: p }]));
      try {
        const r = await api('/assistente', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          pergunta: p, analise_id: analiseId || '', filtros, transacao_id: transacaoId || null,
          usar_sentinel: usarSentinel, modo_linguagem: modoLinguagem, historico }) });
        if (r.conexao) setConexao(r.conexao);
        setMsgs(m => m.concat([{ de: 'assistente', texto: r.resposta, titulo: r.titulo, base: r.base, modo: r.modo, motor: r.motor, aviso: r.aviso,
          falha: r.sentinel_falha || null, pergunta: r.pergunta_preservada || p, tipo: r.tipo }]));
      } catch (e) { setMsgs(m => m.concat([{ de: 'assistente', texto: (e.erro || 'Erro') + ' ' + (e.acao || ''), base: [], modo: 'erro',
        falha: { tentar_de_novo: true }, pergunta: p }])); }
      setOcupado(false);
    };
    const SUGESTOES = transacaoId ? ['Por que esta transação foi classificada assim?', 'Quais características influenciaram essa classificação?', 'O que significa o score desta transação?']
      : analiseId ? ['O que a Machine Learning identificou nesta análise?', 'Quais são os principais riscos encontrados?', 'Como interpretar os resultados apresentados?', 'Quantos alertas há no recorte?']
        : ['O que é o score?', 'Como faço uma análise?', 'O que é FAN-OUT?'];
    const idTx = transacaoId ? f.idExibicao(transacaoId, total) : '';
    return h('div', { className: 'assistente' },
      aberto ? h('section', { className: 'painel', id: 'assistente-painel', 'aria-labelledby': 'assistente-t' },
        h('div', { className: 'assistente-topo' },
          h('div', { className: 'linha', style: { justifyContent: 'space-between' } }, h('h2', { id: 'assistente-t', style: { fontSize: '1rem' } }, 'Assistente de dúvidas'),
            h('button', { type: 'button', className: 'botao pequeno', onClick: () => setAberto(false) }, 'Recolher')),
          h('p', { className: 'legenda', role: 'status' }, ativo
            ? 'Tecnologia Sentinel AI, usando o contexto desta análise (' + sent.provedor + ', ' + sent.modelo + '). Não conclui se houve fraude ou lavagem.'
            : 'Tecnologia Sentinel AI, em modo local: responde com o glossário, a ajuda e os resultados gravados, sem serviço externo. Não conclui se houve fraude ou lavagem.'),
          h('div', { className: 'linha assistente-conexao' },
            h('span', { className: 'selo ' + cx.tom, role: 'status' }, cx.texto),
            sent.disponivel ? h('button', { type: 'button', className: 'botao texto', onClick: testarConexao, disabled: testando },
              testando ? 'Testando…' : 'Testar conexão') : null),
          h('details', { className: 'assistente-config' },
            h('summary', null, ativo ? 'Contexto da análise: autorizado' : 'Usar o contexto da análise com o Sentinel AI'),
            h('label', { className: 'linha', style: { fontWeight: 400, alignItems: 'flex-start', gap: 8 } },
              h('input', { type: 'checkbox', checked: usarSentinel, disabled: !sent.disponivel, onChange: e => autorizar(e.target.checked), style: { marginTop: 3 } }),
              h('span', null, 'Permitir que o Sentinel AI use o contexto desta análise para responder. Os dados vão para um serviço externo de IA (' + (sent.provedor || 'provedor') + ').')),
            sent.disponivel ? h(React.Fragment, null,
              h('p', { className: 'ajuda' }, 'Vai junto com cada pergunta: ' + (sent.envia || []).join('; ') + '.'),
              h('p', { className: 'ajuda' }, 'Não vai: ' + (sent.nao_envia || '') + '. A autorização vale só para esta aba.'))
              : h('p', { className: 'ajuda' }, 'Indisponível neste servidor. ' + (sent.como_ativar || '')),
            h('div', { className: 'linha', style: { marginTop: 6 } },
              h('label', { htmlFor: 'assistente-linguagem', style: { margin: 0, fontWeight: 600 } }, 'Linguagem'),
              h('select', { id: 'assistente-linguagem', value: modoLinguagem, onChange: e => linguagem(e.target.value), style: { width: 'auto' } },
                h('option', { value: 'leiga' }, 'Simples'), h('option', { value: 'tecnica' }, 'Técnica')))),
          transacaoId ? h('div', { className: 'linha assistente-foco' },
            h('span', { className: 'selo atencao' }, 'Transação ' + idTx + ' em contexto'),
            h('button', { type: 'button', className: 'botao texto', onClick: aoLimparTransacao, 'aria-label': 'Tirar a transação ' + idTx + ' do contexto' }, 'remover')) : null),
        h('div', { className: 'mensagens', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversa com o assistente' },
          msgs.length ? msgs.map((m, i) => h('div', { key: i, className: 'msg ' + (m.de === 'voce' ? 'pergunta' : (m.modo === 'sentinel' ? 'sentinel' : '')) },
            h('span', { className: 'sr' }, m.de === 'voce' ? 'Você: ' : 'Assistente: '), m.titulo ? h('strong', null, m.titulo + '. ') : null,
            m.de === 'voce' ? m.texto : h(TextoRico, { texto: m.texto }),
            m.de === 'assistente' && m.aviso ? h('div', { className: 'base aviso-msg' }, '⚠ ' + m.aviso) : null,
            m.de === 'assistente' ? h('div', { className: 'base' }, (m.motor ? 'Motor: ' + m.motor + '. ' : '') + 'Base: ' + (m.base && m.base.length ? m.base.join('; ')
              : m.falha || m.modo === 'erro' ? 'nenhuma (o Sentinel AI não respondeu; não é pergunta fora da base)' : 'nenhuma (pergunta fora da base)')) : null,
            m.de === 'assistente' && m.falha && m.falha.tentar_de_novo && m.pergunta ? h('button', { type: 'button', className: 'botao pequeno', style: { marginTop: 6 },
              onClick: () => perguntar(m.pergunta), disabled: ocupado }, 'Tentar de novo') : null)) :
            h(Legenda, null, transacaoId ? 'Pergunte sobre a transação ' + idTx + ': por que ela tem esse score, o que significam os motivos, o que dá para concluir.'
              : 'Pergunte sobre termos da tela, como usar o painel ou o que a análise aberta encontrou.'),
          ocupado ? h('p', { className: 'suave', role: 'status' }, ativo ? 'O Sentinel AI está analisando o contexto…' : 'Consultando…') : null,
          h('div', { ref: refFim })),
        h('div', { className: 'linha' }, SUGESTOES.map(s => h('button', { key: s, type: 'button', className: 'botao pequeno', onClick: () => perguntar(s), disabled: ocupado }, s))),
        h('form', { className: 'linha', onSubmit: e => { e.preventDefault(); perguntar(texto); } },
          h('label', { htmlFor: 'assistente-p', className: 'sr' }, 'Sua pergunta'),
          h('input', { id: 'assistente-p', type: 'text', ref: refEntrada, value: texto, maxLength: 300, onChange: e => setTexto(e.target.value), placeholder: 'Escreva a pergunta', style: { flex: 1, width: 'auto' } }),
          h('button', { type: 'submit', className: 'botao primario', disabled: ocupado || !texto.trim() }, 'Perguntar'))) : null,
      h('button', { type: 'button', className: 'botao abrir', 'aria-expanded': aberto, 'aria-controls': 'assistente-painel', onClick: () => setAberto(!aberto) }, h(Icone, { nome: 'assistente' }), aberto ? h(React.Fragment, null, h('span', { className: 'rotulo-longo' }, 'Recolher assistente'), h('span', { className: 'rotulo-curto' }, 'Recolher')) : h(React.Fragment, null, h('span', { className: 'rotulo-longo' }, 'Assistente de dúvidas'), h('span', { className: 'rotulo-curto' }, 'Dúvidas'))));
  }

  Object.assign(window.NW, { SecaoDataset, SecaoFiltros, SecaoVisao, SecaoInvestigacao, SecaoTabela, SecaoDetalhes, DialogoDetalhes, PainelLateral, DialogoLegenda, Assistente, NOME_STATUS, TOM_STATUS });
})();
