/* NodeWatch — seções do painel do analista. Cada bloco responde a uma pergunta do analista (mostrada no cabeçalho).
   Vistas: Análise (dataset, execução e recentes) · Visão geral · Investigação · Transações · Detalhes (interpretação do score). */
(function () {
  'use strict';
  const { h, f, api, consulta, useCarga, useIntervalo, Icone, Rede, Dica, Aviso, Erro, Carregando, Esqueleto, Vazio, Legenda, Selo, Secao, Pares, Dialogo, Barra, BarraProgresso,
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

  /* ── Andamento da análise (só estados reais do manifesto) ─────────────
     Rótulo curto de cada etapa do pipeline. A pontuação começa carregando o modelo (etapa aberta, ainda sem
     progresso) e depois pontua em blocos; atributos, inferência e gravação NÃO são etapas separadas. */
  const ETAPA_CURTA = { leitura: 'Lendo e validando', ordenacao: 'Ordenando por data e hora',
    pontuacao: 'Pontuando transações', indices: 'Gravando índices e contagens', manifesto: 'Concluindo' };
  const rotuloEtapa = e => e.id === 'pontuacao' && e.status === 'em_andamento' && !e.progresso ? 'Carregando o modelo' : (ETAPA_CURTA[e.id] || e.nome);
  /* Percentual derivado (não medido): etapas concluídas ou puladas + fração medida da etapa atual, sobre o total. */
  function andamentoAnalise(m) {
    const n = m.etapas.length;
    const idx = m.etapas.findIndex(e => e.status === 'em_andamento');
    const atual = idx >= 0 ? m.etapas[idx] : null;
    const feitas = m.etapas.filter(e => e.status === 'concluida' || e.status === 'pulada').length;
    const fracao = atual && atual.progresso && !f.vazio(atual.progresso.fracao) ? atual.progresso.fracao : 0;
    const geral = n ? Math.min(1, (feitas + fracao) / n) : 0;
    const rotulo = atual ? rotuloEtapa(atual) : feitas === 0 ? 'Preparando a análise' : feitas === n ? 'Concluindo' : 'Preparando a próxima etapa';
    const medida = !!(atual && atual.progresso && !f.vazio(atual.progresso.fracao));
    /* texto curto e honesto: a fração MEDIDA da etapa atual, quando existe; senão, "etapa i de n" */
    const curto = medida ? f.pct(fracao, 0) + ' da etapa' : atual ? 'etapa ' + (idx + 1) + ' de ' + n : '';
    return { n, idx, atual, feitas, geral, rotulo, fracao, medida, curto };
  }
  const movimentoReduzido = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  /* Contagem que sobe suavemente do último valor real ao novo valor real (requestAnimationFrame).
     Nunca passa do valor recebido; sem animação no primeiro desenho e com movimento reduzido. */
  function useContagem(alvo) {
    const [mostrado, setMostrado] = React.useState(alvo);
    const ref = React.useRef(alvo);
    React.useEffect(() => {
      const de = ref.current;
      if (typeof alvo !== 'number' || typeof de !== 'number' || de === alvo || movimentoReduzido()) { ref.current = alvo; setMostrado(alvo); return undefined; }
      const t0 = performance.now(), dur = 650;
      let quadro = 0;
      const passo = t => {
        const k = Math.min(1, (t - t0) / dur), v = k >= 1 ? alvo : Math.round(de + (alvo - de) * (1 - Math.pow(1 - k, 3)));
        ref.current = v; setMostrado(v);
        if (k < 1) quadro = requestAnimationFrame(passo);
      };
      quadro = requestAnimationFrame(passo);
      return () => cancelAnimationFrame(quadro);
    }, [alvo]);
    return mostrado;
  }
  /* Número com contagem animada; o leitor de tela recebe só o valor real. */
  function Contador({ valor, formato }) {
    const fmt = formato || f.inteiro, mostrado = useContagem(valor);
    return h(React.Fragment, null, h('span', { className: 'contador-vivo', 'aria-hidden': 'true' }, fmt(mostrado)), h('span', { className: 'sr' }, fmt(valor)));
  }
  /* Trilha horizontal do pipeline: uma marca por etapa real, na ordem do manifesto.
     Concluída ✓ · em andamento (pulso e luz no fio até a próxima) · pendente · pulada · erro · cancelada.
     O "tique" de bloco é refeito a cada bloco gravado (chave = medido_em do último bloco). */
  function TrilhaEtapas({ m }) {
    return h('ol', { className: 'trilha-etapas', 'aria-label': 'Etapas da análise' }, m.etapas.map((e, i) => {
      const ub = e.id === 'pontuacao' && e.status === 'em_andamento' && e.progresso ? e.progresso.ultimo_bloco : null;
      return h('li', { key: e.id, className: 'passo ' + e.status, 'aria-current': e.status === 'em_andamento' ? 'step' : undefined },
        h('span', { className: 'no', 'aria-hidden': 'true' }, MARCA_ETAPA[e.status] === '▶' ? '' : (MARCA_ETAPA[e.status] || (i + 1)),
          ub && ub.medido_em ? h('i', { key: ub.medido_em, className: 'tique' }) : null),
        i < m.etapas.length - 1 ? h('span', { className: 'fio', 'aria-hidden': 'true' }, e.status === 'em_andamento' ? h('i', { className: 'luz' }) : null) : null,
        h('span', { className: 'rotulo-passo' }, rotuloEtapa(e)),
        h('span', { className: 'sr' }, ': ' + (e.status === 'pulada' ? 'pulada' : NOME_ETAPA[e.status] || e.status).toLowerCase()),
        e.status === 'pulada' ? h('span', { className: 'estado-passo', 'aria-hidden': 'true' }, 'pulada') : null);
    }));
  }

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
      ROTULO ? h(Pares, { itens: [
        ['Rótulo do dataset', v.rotulo.disponivel ? 'coluna "' + v.rotulo.coluna + '": ' + f.inteiro(v.rotulo.positivos) + ' transações rotuladas como lavagem' : 'não há (' + v.rotulo.motivo + ')'],
      ] }) : null,
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
            : f.inteiro(p.feito) + ' de ' + f.inteiro(p.total) + ' ' + e.unidade;   // alertas e estimativa: uma vez só, no cabeçalho da execução
        }
        return h('li', { key: e.id, className: 'etapa ' + e.status, 'aria-current': e.status === 'em_andamento' ? 'step' : undefined },
          h('span', { className: 'marca', 'aria-hidden': 'true' }, MARCA_ETAPA[e.status] || (i + 1)),
          h('div', null,
            h('div', { className: 'linha', style: { justifyContent: 'space-between' } }, h('span', { className: 'nome' }, (i + 1) + '. ' + e.nome),
              h('span', { className: 'situacao' }, NOME_ETAPA[e.status] + (e.duracao_s !== null && e.duracao_s !== undefined ? ' · ' + f.duracao(e.duracao_s) : ''))),
            e.status === 'em_andamento' && p && p.total ? h(BarraProgresso, { feito: p.feito, total: p.total, rotulo: e.nome, texto: volume + ' (' + f.pct(p.fracao, 0) + ')' }) : null,
            volume ? h('div', { className: 'situacao' }, volume + (e.status === 'em_andamento' && p.fracao !== null ? ' · ' + f.pct(p.fracao, 0) : '')) : null,
            e.detalhe ? h('div', { className: 'situacao' }, e.detalhe) : null));
      })),
      /* Cancelar logo abaixo das etapas, antes do aviso de sessão: fica visível sem rolar */
      m.status === 'em_andamento' ? h('div', { className: 'linha' },
        h('button', { type: 'button', className: 'botao perigo', onClick: aoCancelar, disabled: m.cancelamento_solicitado }, h(Icone, { nome: 'fechar' }), m.cancelamento_solicitado ? 'Cancelamento pedido…' : 'Cancelar análise'),
        h(Dica, { texto: m.cancelamento_solicitado ? 'A análise para no fim do bloco atual; o que já foi pontuado fica gravado.' : 'O cancelamento é seguro: para no fim do bloco atual e mantém o que já foi pontuado.' })) : null,
      m.status === 'em_andamento' && ss.exigida ? h(Aviso, { tom: ss.desta_sessao ? '' : 'atencao', titulo: ss.desta_sessao ? 'Mantenha esta aba aberta' : 'Outra aba é a responsável por esta análise', vivo: true },
        h('p', null, ss.desta_sessao ? 'Pode minimizar ou trocar de aba. Sem sinal por ' + f.inteiro(ss.janela_s) + ' s, a análise para num ponto seguro e fica parcial.'
          : (ss.responsavel_ativa ? 'A sessão que iniciou a análise continua ativa em outra aba.' : 'A sessão que iniciou a análise não dá sinal: a análise vai parar no próximo ponto seguro.') + ' Para que esta aba passe a mantê-la, use o botão abaixo.'),
        ss.desta_sessao ? null : h('div', null, h('button', { type: 'button', className: 'botao pequeno', onClick: aoAssumir }, h(Icone, { nome: 'sessao' }), 'Manter a análise nesta aba'))) : null);
  }

  /* Título da caixa "Etapas executadas" (depois do fim): quantas etapas e em que situação (a duração fica no cartão de conclusão). */
  function ResumoEtapas({ m }) {
    const n = s => m.etapas.filter(e => e.status === s).length;
    const partes = [f.plural(n('concluida'), 'concluída', 'concluídas')];
    if (n('pulada')) partes.push(f.plural(n('pulada'), 'pulada (não se aplica)', 'puladas (não se aplicam)'));
    const outras = m.etapas.length - n('concluida') - n('pulada');
    if (outras) partes.push(f.plural(outras, 'não concluída', 'não concluídas'));
    return h(React.Fragment, null, 'Etapas executadas (' + m.etapas.length + ')',
      h('span', { className: 'suave', style: { fontWeight: 400 } }, ' — ' + partes.join(', ')));
  }

  /* Cabeçalho da execução em andamento: etapa atual (rótulo curto), trilha do pipeline, progresso por etapas,
     tempo decorrido, UMA estimativa de tempo restante e as contagens ao vivo. Tudo vem do manifesto (lido a cada 1 s);
     o tempo decorrido é medido desde o início gravado no servidor; os números sobem até o valor recebido, nunca além. */
  function CabecaExecucao({ m }) {
    const c = m.contagens, a = andamentoAnalise(m), atual = a.atual;
    const p = atual && atual.progresso;
    const inicio = Date.parse(m.iniciada_em);
    const decorrido = Number.isNaN(inicio) ? null : Math.max(0, (Date.now() - inicio) / 1000);
    const eta = p && !f.vazio(p.estimativa_restante_s) ? p.estimativa_restante_s : null;
    const vazao = eta !== null && !f.vazio(p.vazao_por_s) ? (atual.unidade === 'bytes' ? f.bytes(p.vazao_por_s) : f.inteiro(p.vazao_por_s) + ' ' + atual.unidade) + '/s' : null;
    const pont = m.etapas.find(e => e.id === 'pontuacao');
    const ub = pont && pont.status === 'em_andamento' && pont.progresso ? pont.progresso.ultimo_bloco : null;
    return h('div', { className: 'execucao-cabeca em_andamento vivo' },
      h('div', { className: 'linha entre' },
        h('div', null, h('span', { className: 'eyebrow' }, atual ? 'Etapa ' + (a.idx + 1) + ' de ' + a.n : 'Preparando'), h('h3', null, a.rotulo)),
        h('span', { className: 'percentual', title: 'Etapas concluídas mais a fração medida da etapa atual (cada etapa pesa igual)', 'aria-hidden': 'true' }, f.pct(a.geral, 0), h('small', null, ' das etapas'))),
      h(BarraProgresso, { feito: Math.round(a.geral * 1000), total: 1000, rotulo: 'Progresso da análise por etapas', texto: f.pct(a.geral, 0) + ' (' + a.feitas + ' de ' + a.n + ' etapas concluídas)' }),
      h(TrilhaEtapas, { m }),
      h('dl', { className: 'estatisticas' },
        h(Estat, { nome: 'Decorrido', valor: f.duracao(decorrido) }),
        h('div', { className: 'estatistica', title: vazao ? 'Estimativa pela vazão observada nesta etapa: ' + vazao + '.' : 'A estimativa aparece depois de alguns segundos de etapa com progresso medido.' },
          h('dt', null, 'Restante'), h('dd', null, eta === null ? '—' : '≈ ' + f.duracao(eta), h('small', null, vazao ? 'estimativa · ' + vazao : 'estimativa da etapa atual'))),
        h(Estat, { nome: 'Pontuadas', sub: c.validas ? 'de ' + f.inteiro(c.validas) + ' válidas' : null,
          valor: h(React.Fragment, null, h(Contador, { valor: c.pontuadas }),
            ub && ub.medido_em ? h('span', { key: ub.medido_em, className: 'tique-bloco', 'aria-hidden': 'true' }, '+' + f.inteiro(ub.transacoes)) : null) }),
        h(Estat, { nome: 'Alertas até agora', valor: h(Contador, { valor: c.alertas }), sub: 'sinal para investigação' })));
  }

  /* Sinal do fim da análise: check desenhado (concluída) ou ícone de atenção/erro. Decorativo: o título diz o estado. */
  const SinalFim = ({ status }) => status === 'concluida'
    ? h('svg', { className: 'sinal-fim ok', viewBox: '0 0 48 48', 'aria-hidden': 'true', focusable: 'false' },
      h('circle', { className: 'anel', cx: 24, cy: 24, r: 21, pathLength: 1 }), h('path', { className: 'check', d: 'M15 24.5l6.2 6.2L33.5 18', pathLength: 1 }))
    : h('span', { className: 'sinal-fim ' + (status === 'erro' ? 'alerta' : 'atencao'), 'aria-hidden': 'true' }, h(Icone, { nome: status === 'cancelada' ? 'fechar' : 'alerta' }));
  const TITULO_FIM = { concluida: 'Análise concluída', parcial: 'Análise parcial', cancelada: 'Análise cancelada', erro: 'A análise parou com erro' };

  /* Cartão de conclusão (depois do fim): estado, números principais, causa em linguagem simples e o atalho para os resultados.
     O nome do dataset e o status já estão no topo; aqui não se repetem. */
  function SituacaoAnalise({ m, aoVerResultados }) {
    if (!m || m.status === 'em_andamento') return null;
    const c = m.contagens, erros = m.erros || [];
    return h('div', { className: 'execucao-cabeca fim ' + m.status, role: m.status === 'erro' ? 'alert' : 'status' },
      h('div', { className: 'fim-topo' },
        h(SinalFim, { status: m.status }),
        h('div', { className: 'fim-titulos' }, h('h3', null, TITULO_FIM[m.status] || ('Análise ' + (NOME_STATUS[m.status] || m.status).toLowerCase())),
          m.descricao_status ? h('p', { className: 'legenda' }, m.descricao_status) : null),
        m.resultados.disponiveis && aoVerResultados ? h('button', { type: 'button', className: 'botao primario', onClick: aoVerResultados }, 'Ver resultados', h(Icone, { nome: 'seta' })) : null),
      m.motivo ? h('p', { className: 'legenda fim-motivo' }, m.motivo) : null,
      erros.length ? h('div', { className: 'fim-erros' }, erros.map((e, i) => h('div', { key: i, className: 'fim-erro' },
        e.etapa ? h('p', { className: 'fraco' }, 'Etapa: ' + (ETAPA_CURTA[e.etapa] || e.etapa)) : null,
        h('p', null, h('strong', null, 'O que aconteceu: '), e.causa),
        e.acao ? h('p', null, h('strong', null, 'O que fazer: '), e.acao) : null))) : null,
      m.status === 'concluida' ? null : h(TrilhaEtapas, { m }),
      m.resultados.disponiveis ? h('dl', { className: 'estatisticas' },
        h(Estat, { nome: 'Pontuadas', valor: f.inteiro(c.pontuadas), sub: m.resultados.parciais ? 'de ' + f.inteiro(c.validas) + ' válidas (parcial)' : null }),
        h(Estat, { nome: 'Alertas', valor: f.inteiro(c.alertas), sub: c.pontuadas ? f.pct(c.alertas / c.pontuadas, 2) + ' · sinal para investigação' : null }),
        h(Estat, { nome: 'Duração', valor: f.duracao(m.duracao_s) }))
        : h('p', { className: 'legenda' }, 'Não há resultados para consultar.'),
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

  function SecaoDataset({ estado, datasets, dataset, datasetId, aoEscolher, aoRecarregar, manifesto, aoAnalisar, aoCancelar, aoAssumir, analises, aoAbrir, analiseId, erroAnalise, aoVerResultados, aoOperacao }) {
    const [enviando, setEnviando] = React.useState(false);
    const [erro, setErro] = React.useState(null);
    const refArq = React.useRef(null);
    const lim = estado.limites;
    /* Sem limite de tamanho: o servidor grava o envio em disco, em blocos, e valida em blocos de linhas. */
    const enviar = async ev => {
      ev.preventDefault();
      const arq = refArq.current.files[0];
      if (!arq) { setErro({ erro: 'Escolha um arquivo.', acao: 'Selecione um .csv ou .zip no campo Transações.' }); refArq.current.focus(); return; }
      const fd = new FormData();
      fd.append('arquivo', arq);
      setEnviando(true); setErro(null);
      try {
        const reg = await api('/datasets', { method: 'POST', body: fd });
        refArq.current.value = '';
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
          h('h3', { id: 'enviar-t' }, h(Icone, { nome: 'enviar' }), 'Enviar arquivo'),
          h('div', null, h('label', { htmlFor: 'arq' }, 'Transações'),
            h('input', { id: 'arq', type: 'file', accept: '.csv,.zip', ref: refArq, 'aria-describedby': 'arq-a' }),
            h('p', { className: 'ajuda', id: 'arq-a' }, 'CSV UTF-8 ou ZIP · fica só neste servidor')),
          h('div', { className: 'linha' }, h('button', { type: 'submit', className: 'botao', disabled: enviando }, h(Icone, { nome: 'enviar' }), enviando ? 'Enviando o arquivo…' : 'Enviar e validar'),
            enviando ? h('span', { role: 'status', className: 'suave' }, 'Enviando…') : null)),
        h('div', { className: 'bloco grade' },
          h('h3', null, h(Icone, { nome: 'dataset' }), 'Escolher dataset'),
          h('div', null, h('div', { className: 'rotulo-com-dica' }, h('label', { htmlFor: 'ds' }, 'Dataset'),
            h(Dica, { texto: 'Datasets enviados (os ' + lim.datasets_enviados_guardados + ' mais recentes ficam guardados) e arquivos já presentes no servidor. O dataset escolhido define o conjunto analisado.' })),
            h('select', { id: 'ds', value: datasetId || '', onChange: e => aoEscolher(e.target.value), 'aria-describedby': 'ds-a' },
              h('option', { value: '' }, datasets.length ? 'Selecione…' : 'Nenhum dataset disponível'),
              datasets.map(d => h('option', { key: d.id, value: d.id }, d.nome + ' — ' + (d.origem === 'enviado' ? 'enviado' : 'do servidor') + ' — ' + (NOME_DATASET[d.status] || d.status)))),
            h('p', { className: 'sr', id: 'ds-a' }, 'Datasets enviados e arquivos já presentes no servidor.')),
          dataset ? null : h(VazioDatasets, { datasets }),
          dataset && (dataset.status === 'nao_validado' || dataset.status === 'erro' || (dataset.origem === 'servidor' && dataset.status === 'invalido')) ?
            h('div', null, h('button', { type: 'button', className: 'botao', onClick: validar }, h(Icone, { nome: 'ok' }), 'Validar este dataset')) : null)),
      h(Erro, { erro }),
      erro && erro.problemas ? h(TabelaProblemas, { problemas: erro.problemas }) : null,
      h(ResumoDataset, { d: dataset }),
      h('div', { className: 'faixa-analisar' + (liberado ? '' : ' inativa') },
        h('button', { type: 'button', className: 'botao primario', disabled: !podeAnalisar || !estado.modelo.disponivel, onClick: () => aoAnalisar(datasetId), 'aria-describedby': 'analisar-a' }, h(Icone, { nome: 'analisar' }), 'Analisar'),
        h('p', { className: 'ajuda', id: 'analisar-a', style: { margin: 0 } },
          ocupado || estado.analise_em_andamento ? 'Há uma análise em andamento.'
            : !dataset ? 'Escolha um dataset para começar.'
              : podeAnalisar ? f.inteiro(dataset.validacao.linhas.validas) + ' linhas válidas · modelo salvo, sem treino · mantenha esta página aberta'
                : 'Disponível com um dataset válido.')),
      h(Erro, { erro: erroAnalise }));
    const terminada = !!manifesto && manifesto.status !== 'em_andamento';
    /* O nome do dataset e o status já estão no topo (fixo) e no cartão de conclusão: aqui só "Execução" e o início. */
    // chave estável: quando a análise termina e o bloco muda de lugar, o React o move em vez de recriá-lo
    // (o log mantém a rolagem e a última leitura de RAM e CPU)
    const processamento = manifesto ? h(Secao, { key: 'processamento', id: 'execucao', icone: 'operacao', titulo: 'Execução',
      pergunta: 'Iniciada em ' + f.instante(manifesto.iniciada_em) },
      terminada ? h(SituacaoAnalise, { m: manifesto, aoVerResultados }) : h(CabecaExecucao, { m: manifesto }),
      /* Durante a análise: etapas (esquerda) e log da execução (direita), lado a lado; empilham até 980 px.
         Depois do fim: as etapas viram a caixa recolhida "Etapas executadas" e o log ocupa a largura toda. */
      h('div', { className: 'execucao' + (terminada ? ' terminada' : '') },
        terminada ? h('details', { className: 'execucao-etapas' }, h('summary', null, h(ResumoEtapas, { m: manifesto })),
          h(Progresso, { m: manifesto, aoCancelar, aoAssumir }))
          : h('div', { className: 'execucao-etapas' }, h(Progresso, { m: manifesto, aoCancelar, aoAssumir })),
        /* log da execução: h(LogAnalise, { m: manifesto, estado }) mais o atalho para a gaveta Operação */
        h(LogAnalise, { m: manifesto, estado, aoOperacao }))) : null;
    const novaAnalise = h(Secao, { key: 'nova', id: 'dataset', icone: 'dataset', titulo: 'Nova análise' },
      estado.modelo.disponivel ? null : h(Aviso, { tom: 'erro', titulo: 'Modelo não encontrado no servidor' }, (estado.modelo.motivo || '') + ' Sem o modelo, a análise não pode ser iniciada.'),
      /* Com a análise em andamento, o envio e a escolha de dataset ficam recolhidos. */
      ocupado ? h('details', { key: 'escolha-recolhida', className: 'bloco recolhido' }, h('summary', null, 'Outro dataset (a análise continua)'), escolha) : escolha);
    const recentes = h(Secao, { key: 'recentes', id: 'recentes', icone: 'historico', titulo: 'Recentes',
      extra: h(React.Fragment, null, h(Selo, { tom: 'neutro' }, f.inteiro(analises.analises.length)),
        h(Dica, { texto: 'Abrir uma análise carrega os resultados gravados, sem reprocessar. ' + (analises.retencao.leitura || ''), lado: 'esquerda' })) },
      analises.analises.length ? h('div', { className: 'rolagem' }, h('table', { className: 'recentes' },
        h('caption', { className: 'sr' }, analises.retencao.leitura),
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
    { id: 'de', rotulo: 'De', tipo: 'datetime-local', ajuda: 'Início, inclusive, no horário do dataset.' },
    { id: 'ate', rotulo: 'Até', tipo: 'datetime-local', ajuda: 'Fim, inclusive, no horário do dataset.' },
    { id: 'moeda', rotulo: 'Moeda', tipo: 'moeda', ajuda: 'Moeda de pagamento da transação.' },
    { id: 'alerta', rotulo: 'Alerta', tipo: 'alerta', ajuda: 'Com alerta = score 701 ou mais.' },
    { id: 'valor_min', rotulo: 'Valor mínimo', tipo: 'number', min: 1, step: 'any', ajuda: 'Valor pago, na moeda de cada transação, sem conversão. Começa em 1; apague para incluir valores menores.' },
    { id: 'banco_origem', rotulo: 'Banco de origem', tipo: 'text', modo: 'numeric', ajuda: 'Código numérico do banco que enviou (exato).' },
    { id: 'banco_destino', rotulo: 'Banco de destino', tipo: 'text', modo: 'numeric', ajuda: 'Código numérico do banco que recebeu (exato).' },
    { id: 'conta_origem', rotulo: 'Conta de origem', tipo: 'text', ajuda: 'Conta que enviou: número ou banco-conta (exato). Também define o foco do grafo.' },
    { id: 'conta_destino', rotulo: 'Conta de destino', tipo: 'text', ajuda: 'Conta que recebeu: número ou banco-conta (exato). Também define o foco do grafo.' },
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
      return h('div', { key: c.id }, h('div', { className: 'rotulo-com-dica' }, h('label', { htmlFor: 'f-' + c.id }, c.rotulo), h(Dica, { texto: c.ajuda })), controle,
        h('p', { className: 'sr', id: 'f-' + c.id + '-a' }, c.ajuda),
        invalido ? h('p', { className: 'erro-campo', id: 'f-' + c.id + '-e', role: 'alert' }, erro.mensagem) : null);
    };
    const valorChip = (k, v) => k === 'alerta' ? (v === 'sim' ? 'Com alerta' : 'Sem alerta') : (k === 'de' || k === 'ate') ? f.dataHora(v) : v;
    return h('section', { className: 'recorte', id: 'filtros', 'aria-labelledby': 'filtros-t' },
      h('div', { className: 'cabeca' },
        h(Icone, { nome: 'filtro' }),
        h('h2', { id: 'filtros-t' }, 'Recorte'),
        h('ul', { className: 'chips', role: 'status', 'aria-label': 'Filtros aplicados' }, ativos.length
          ? ativos.map(([k, v]) => h('li', { key: k, className: 'chip so-texto' }, ROTULO_FILTRO[k] + ' ', h('strong', null, valorChip(k, v))))
          : h('li', { className: 'chip so-texto vazio-chip' }, 'Dataset inteiro')),
        pendente ? h('span', { role: 'status', className: 'selo atencao' }, 'Não aplicado') : null,
        h('div', { className: 'linha' },
          h('button', { type: 'button', className: 'botao pequeno', 'aria-expanded': visivel, 'aria-controls': 'filtros-form', onClick: () => setAberto(!aberto) },
            h(Icone, { nome: 'filtro' }), visivel ? 'Fechar' : 'Filtros'),
          h('button', { type: 'button', className: 'botao pequeno icone fantasma dica-esquerda', onClick: aoLimpar, 'aria-label': 'Voltar aos filtros iniciais', 'data-dica': 'Voltar aos filtros iniciais' }, h(Icone, { nome: 'desfazer' })))),
      visivel ? h('form', { id: 'filtros-form', className: 'grade', noValidate: true, onSubmit: e => { e.preventDefault(); aoAplicar(); } },  // a mensagem de erro vem do servidor, junto do campo
        h('p', { className: 'ajuda', style: { margin: 0 } }, 'Valem para indicadores, contas, grafo e tabela.'),
        h('div', { className: 'grade campos' }, CAMPOS_FILTRO.map(campo)),
        h('div', { className: 'linha' },
          h('button', { type: 'submit', className: 'botao primario' }, h(Icone, { nome: 'filtro' }), 'Aplicar filtros'),
          h('button', { type: 'button', className: 'botao fantasma', onClick: () => setRascunho(aplicados), disabled: !pendente }, 'Descartar'))) : null);
  }

  /* ═══ 3. Visão geral do recorte ══════════════════════════════════════ */
  /* Faixas do score no recorte: distribuição real (contagens da API). O resumo numérico (mediano, mínimo e máximo)
     fica só no indicador "Score"; a interpretação completa fica em Detalhes (botão "Como ler"). */
  function ResumoScore({ v, aoVista }) {
    const total = v.faixas.reduce((s, x) => s + (x.n || 0), 0);
    return h('div', { className: 'bloco' },
      h('div', { className: 'cabeca-bloco' },
        h('h3', null, h(Icone, { nome: 'score' }), 'Score e faixas'),
        h('button', { type: 'button', className: 'botao pequeno fantasma dica-esquerda', onClick: () => aoVista('detalhes'),
          'aria-label': 'Como ler o score (abre Detalhes)',
          'data-dica': 'Índice de prioridade de 0 a 1000, não é probabilidade. 701 ou mais = alerta.' },
          h(Icone, { nome: 'info' }), 'Como ler')),
      h('div', { className: 'distribuicao' },
        total ? h('div', { className: 'pilha', role: 'img', 'aria-label': 'Distribuição do recorte por faixa: ' + v.faixas.map(x => x.nome + ' ' + f.pct(x.proporcao, 1)).join(', ') },
          v.faixas.filter(x => x.n).map(x => h('i', { key: x.id, className: x.id, style: { flexGrow: x.n, flexBasis: 0 } }))) : null,
        h('ul', { className: 'faixas-lista' }, v.faixas.map(x => h('li', { key: x.id, className: x.id, title: 'Recomendação: ' + x.recomendacao },
          h('span', { className: 'ponto-faixa ' + x.id, 'aria-hidden': 'true' }),
          h('span', null, h('span', { className: 'rotulo-faixa' }, (x.id === 'alta' ? '⚠ ' : '') + x.nome), h('span', { className: 'intervalo' }, x.de + '–' + x.ate)),
          h('span', { className: 'n' }, f.inteiro(x.n)), h('span', { className: 'p' }, f.pct(x.proporcao, 2)))))));
  }

  /* Leitura do recorte (Visão geral): 2 a 4 frases curtas montadas só com os números da /visao já carregada
     (mesmo estilo da leitura do inspetor da Investigação). Nada é inferido além das contagens recebidas. */
  const frase = (...partes) => h(React.Fragment, null, ...partes);
  function LeituraVisao({ v, manifesto }) {
    const n = v.registros.recorte, a = v.alertas.n, itens = [];
    const parcial = manifesto.resultados && manifesto.resultados.parciais;
    if (parcial) itens.push({ tom: 'atencao', texto: frase('Resultado parcial: cobre ', h('strong', null, f.inteiro(manifesto.contagens.pontuadas)),
      ' de ' + f.inteiro(manifesto.contagens.validas) + ' transações válidas (análise interrompida).') });
    if (!n) itens.push({ tom: '', texto: 'Nenhuma transação no recorte. Ajuste os filtros para ver os indicadores.' });
    else {
      itens.push(a ? { tom: 'alerta', texto: frase(h('strong', null, f.inteiro(a)), (a === 1 ? ' alerta' : ' alertas') + ' em ', h('strong', null, f.inteiro(n)),
        (n === 1 ? ' transação' : ' transações') + ' do recorte (' + f.pct(v.alertas.proporcao, 2) + ') — sinal para investigação, não confirmação.') }
        : { tom: 'ok', texto: 'Nenhuma das ' + f.inteiro(n) + ' transações do recorte tem alerta.' });
      if (v.score && !parcial) itens.push({ tom: '', texto: frase('Maior score do recorte: ', h('strong', null, v.score.max), ' de 1000.') });
      const cr = v.contas_risco, topo = cr && cr.contas.length ? cr.contas[0] : null;
      if (topo) {
        const empate = cr.contas.length > 1 && cr.contas[1].alertas === topo.alertas;
        itens.push({ tom: 'alerta', texto: frase(empate ? 'Primeira das contas prioritárias: ' : 'Conta com mais transações com alerta: ', h('strong', { className: 'mono' }, topo.conta),
          ' — participa de ' + f.plural(topo.alertas, 'transação com alerta', 'transações com alerta') + '.') });
      }
    }
    return h('section', { className: 'leitura leitura-visao', 'aria-labelledby': 'leitura-visao-t' },
      h('h3', { id: 'leitura-visao-t' }, h('span', { className: 'leitura-sinal', 'aria-hidden': 'true' }), 'Leitura do recorte'),
      h('ul', null, itens.slice(0, 4).map((it, i) => h('li', { key: i, className: it.tom, style: { '--i': i } }, it.texto))),
      h('p', { className: 'leitura-nota' }, 'Os números correspondem ao recorte atual.'));
  }

  /* Visão geral: casa da situação do recorte, dos indicadores principais, do resumo de alertas e do acesso rápido
     às contas prioritárias. O título visível é o do topo ("Visão geral"); aqui fica só o título para leitores de tela. */
  function SecaoVisao({ carga, manifesto, aoVista, aoFocar, aoFiltrarTabela }) {
    const v = carga.dados;
    let corpo;
    if (carga.erro) corpo = h(Erro, { erro: carga.erro });
    else if (!v) corpo = h(React.Fragment, null,
      h('div', { className: 'leitura leitura-visao carregando' }, h(Esqueleto, { linhas: 3, texto: 'Calculando os indicadores do recorte…' })),
      h('div', { className: 'kpis' }, [0, 1, 2].map(i => h('div', { key: i, className: 'kpi' }, h(Esqueleto, { linhas: 3, altura: i === 1 ? 18 : 12, texto: 'Calculando os indicadores do recorte…' })))),
      h('div', { className: 'grade principal-lateral' }, h('div', { className: 'bloco' }, h(Esqueleto, { linhas: 5 })), h('div', { className: 'bloco' }, h(Esqueleto, { linhas: 5 }))));
    else {
      const n = v.registros.recorte, a = v.alertas.n;
      const cr = v.contas_risco;
      corpo = h(React.Fragment, null,
        /* a leitura some enquanto o recorte recarrega: frases antigas nunca ficam ao lado de números novos */
        carga.carregando ? h('div', { className: 'leitura leitura-visao carregando' }, h(Esqueleto, { linhas: 3, texto: 'Atualizando os indicadores do recorte…' }))
          : h(LeituraVisao, { v, manifesto }),
        h('div', { className: 'kpis kpis-visao', 'aria-busy': carga.carregando },
          h('div', { className: 'kpi', title: v.registros.legenda + (v.periodo ? ' ' + v.periodo.legenda : '') },
            h('div', { className: 'nome' }, h(Icone, { nome: 'tabela' }), 'Recorte'),
            h('div', { className: 'valor' }, h(Contador, { valor: n }), h('small', null, n === 1 ? 'transação' : 'transações')),
            h('div', { className: 'detalhe' }, 'de ' + f.inteiro(v.registros.dataset) + ' no dataset'),
            h('div', { className: 'detalhe periodo' }, h(Icone, { nome: 'relogio' }), v.periodo ? f.dataHora(v.periodo.inicio) + ' até ' + f.dataHora(v.periodo.fim) : 'Sem transações')),
          h('div', { className: 'kpi' + (a ? ' alerta' : ''), title: v.alertas.legenda },
            h('div', { className: 'nome' }, h(Icone, { nome: 'alerta' }), 'Alertas'),
            h('div', { className: 'valor' }, h(Contador, { valor: a })),
            h('div', { className: 'detalhe' }, n ? f.pct(v.alertas.proporcao, 2) + ' do recorte · sinal para investigação' : '—'),
            n ? h(Barra, { fracao: Math.max(v.alertas.proporcao, a ? 0.01 : 0), alerta: true, rotulo: f.pct(v.alertas.proporcao, 2) + ' do recorte com alerta' }) : null,
            a ? h('button', { type: 'button', className: 'botao pequeno fantasma kpi-acao', onClick: () => aoFiltrarTabela({ alerta: 'sim' }),
              'aria-label': 'Ver alertas: abrir Transações só com as transações com alerta' }, 'Ver alertas', h(Icone, { nome: 'seta' })) : null),
          h('div', { className: 'kpi', title: v.score ? v.score.legenda : '' },
            h('div', { className: 'nome' }, h(Icone, { nome: 'score' }), 'Score'),
            h('div', { className: 'valor' }, v.score ? f.numero(v.score.mediana, Number.isInteger(v.score.mediana) ? 0 : 1) : '—', v.score ? h('small', null, 'mediano') : null),
            h('div', { className: 'detalhe' }, v.score ? 'mínimo–máximo: ' + v.score.min + '–' + v.score.max + ' (de 0 a 1000)' : '—'))),
        v.valor_minimo && v.valor_minimo.fora ? h(Aviso, { tom: 'atencao', titulo: 'Valor mínimo ' + f.numero(v.valor_minimo.aplicado, 0) + ' deixa ' + f.plural(v.valor_minimo.fora, 'transação', 'transações') + ' fora do recorte' },
          h('details', null, h('summary', null, (v.valor_minimo.alertas_fora ? f.plural(v.valor_minimo.alertas_fora, 'com alerta', 'com alerta') : 'Nenhuma com alerta') + ' · detalhes'),
            h('p', { className: 'legenda' }, 'Por moeda: ' + v.valor_minimo.por_moeda.map(m => m.moeda + ' ' + f.inteiro(m.n)).join(', ') + '. ' + v.valor_minimo.legenda))) : null,
        h('div', { className: 'grade principal-lateral' },
          h(ResumoScore, { v, aoVista }),
          h('div', { className: 'bloco contas-rapidas' },
            h('div', { className: 'cabeca-bloco' }, h('h3', null, h(Icone, { nome: 'contas' }), 'Contas prioritárias'),
              cr && cr.contas.length ? h('button', { type: 'button', className: 'botao pequeno fantasma', onClick: () => aoVista('investigacao') }, 'Investigar', h(Icone, { nome: 'seta' })) : null),
            cr && cr.contas.length ? h('ol', { className: 'contas' }, cr.contas.slice(0, 5).map((c, i) =>
              h('li', { key: c.conta, style: { '--i': i } }, h('button', { type: 'button', className: 'botao conta', onClick: () => aoFocar(c.conta),
                'aria-label': 'Investigar a conta ' + c.conta + ': participa de ' + f.plural(c.alertas, 'transação com alerta', 'transações com alerta') + '; maior score entre elas ' + c.maior_score },
                h('span', { className: 'pos' }, i + 1), h('span', { className: 'id' }, c.conta),
                h('span', { className: 'score-max', title: 'Maior score entre as transações da conta no recorte' }, c.maior_score, h('small', null, 'maior score')),
                h('span', { className: 'dados risco' }, '⚠ participa de ' + f.plural(c.alertas, 'transação com alerta', 'transações com alerta')))))) :
              h(Vazio, { compacto: true }, 'Nenhuma conta tem transação com alerta no recorte.'))),
        h('div', { className: 'grade' + (v.tipologias.disponivel ? ' duas' : '') },
          h('div', { className: 'bloco' }, h('div', { className: 'cabeca-bloco' }, h('h3', null, h(Icone, { nome: 'visao' }), 'Formato de pagamento'),
            h(Dica, { texto: v.formatos.legenda + '. Vazio ou desconhecido aparece como "Não informado".', lado: 'esquerda' })),
            v.formatos.itens.length ? h('ul', { className: 'barras', 'aria-label': v.formatos.legenda }, v.formatos.itens.map(x => h('li', { key: x.formato },
              h('span', { className: 'nome-barra', title: x.formato }, x.nao_informado ? h('em', null, x.formato) : x.formato),
              h(Barra, { fracao: x.proporcao, rotulo: f.pct(x.proporcao, 1) + ' das transações do recorte' }),
              h('span', { className: 'valor-barra' }, h('strong', null, f.inteiro(x.n)), ' · ' + f.pct(x.proporcao, 1)))))
              : h(Vazio, { compacto: true }, 'Nenhuma transação no recorte.')),
          /* tipologias só existem em análises gravadas por versões anteriores (arquivo de padrões); nas demais, o bloco não aparece */
          v.tipologias.disponivel ? h('div', { className: 'bloco' }, h('div', { className: 'cabeca-bloco' }, h('h3', null, h(Icone, { nome: 'sequencia' }), 'Tipologias'),
            h(Dica, { texto: 'Origem: ' + v.tipologias.origem + '. ' + v.tipologias.legenda, lado: 'esquerda' })),
            h('div', { className: 'rolagem' }, h('table', null,
              h('caption', { className: 'sr' }, 'Tipologias registradas no dataset: transações do recorte em cada uma e quantas têm alerta.'),
              h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Tipologia'), h('th', { scope: 'col', className: 'num' }, 'Transações'), h('th', { scope: 'col', className: 'num' }, 'Com alerta'))),
              h('tbody', null, v.tipologias.itens.map(x => h('tr', { key: x.tipologia, title: x.descricao },
                h('td', { className: 'mono' }, x.tipologia), h('td', { className: 'num' }, f.inteiro(x.n)), h('td', { className: 'num' }, x.alertas ? h('strong', null, f.inteiro(x.alertas)) : '0'))))))) : null),
        ROTULO ? h('div', { className: 'bloco' }, h('h3', null, h(Icone, { nome: 'info' }), 'Rótulo do dataset — separado da previsão'),
          v.rotulo.disponivel ? h(React.Fragment, null,
            h(Pares, { itens: [['Rotuladas como lavagem no recorte', f.inteiro(v.rotulo.rotuladas_lavagem)], ['Dessas, com alerta do modelo', f.inteiro(v.rotulo.rotuladas_com_alerta)]] }),
            h(Legenda, null, v.rotulo.legenda)) : h(Vazio, null, v.rotulo.motivo)) : null);
    }
    return h('section', { id: 'visao', className: 'visao-geral', 'aria-labelledby': 'visao-t' },
      h('h2', { id: 'visao-t', className: 'sr' }, 'Visão geral do recorte'), corpo);
  }

  /* ═══ 4. Contas prioritárias e grafo ═══════════════════════════════ */
  /* Investigação: área de trabalho na altura da tela — contas prioritárias (trilho), grafo e leitura/seleção.
     O título visível é o do topo ("Investigação"); aqui fica só o título para leitores de tela. */
  function SecaoInvestigacao({ visao, focoPedido, aoFocar, cargaGrafo, analiseId, filtros, total, profundidade, aoProfundidade, aoFiltrarTabela }) {
    const cr = visao.dados ? visao.dados.contas_risco : null;
    const focoAtual = cargaGrafo.dados && cargaGrafo.dados.foco;
    const trilho = h('aside', { className: 'trilho', 'aria-labelledby': 'trilho-t' },
      h('div', { className: 'trilho-cabeca' },
        h('h3', { id: 'trilho-t' }, h(Icone, { nome: 'contas' }), 'Contas prioritárias'),
        cr ? h(Dica, { texto: 'Até ' + cr.limite + ' contas, pela quantidade de transações com alerta e pelo maior score entre elas. Não existe score por conta: são contagens de transações. Regra completa em Detalhes.', lado: 'esquerda' }) : null),
      !cr ? h(Esqueleto, { linhas: 6, altura: 30 }) : cr.contas.length ? h('ol', { className: 'contas' }, cr.contas.map((c, i) =>
        h('li', { key: c.conta, style: { '--i': i } }, h('button', { type: 'button', className: 'botao conta', 'aria-pressed': focoAtual === c.conta, onClick: () => aoFocar(c.conta),
          title: f.plural(c.transacoes_no_recorte, 'transação no recorte', 'transações no recorte') + '; com alerta: ' + f.inteiro(c.alertas_como_origem) + ' como origem e ' + f.inteiro(c.alertas_como_destino) + ' como destino.' },
          h('span', { className: 'pos' }, i + 1),
          h('span', { className: 'id' }, c.conta),
          h('span', { className: 'score-max', title: 'Maior score entre as transações da conta no recorte' }, c.maior_score, h('small', null, 'maior score')),
          h('span', { className: 'dados risco' }, '⚠ ' + f.plural(c.alertas, 'alerta', 'alertas'),
            h('span', { className: 'lados' }, f.inteiro(c.alertas_como_origem) + ' como origem · ' + f.inteiro(c.alertas_como_destino) + ' como destino')))))) :
        h(Vazio, { compacto: true }, 'Nenhuma conta tem transação com alerta no recorte.'));
    return h('section', { id: 'investigacao', className: 'secao-investigacao', 'aria-labelledby': 'investigacao-t' },
      h('h2', { id: 'investigacao-t', className: 'sr' }, 'Investigação: contas e conexões'),
      h(BlocoGrafo, { carga: cargaGrafo, analiseId, filtros, total, profundidade, aoProfundidade, aoFocar, aoFiltrarTabela, trilho, ranking: visao.carregando ? null : cr }));
  }

  /* ═══ 5. Tabela de registros ═════════════════════════════════════════ */
  /* Colunas padrão enxutas; as demais aparecem ao expandir a linha (e podem ser ligadas em "Colunas"). */
  const COLUNAS = [
    { id: 'posicao', nome: 'Posição', num: true, dica: 'Lugar na lista atual, a partir de 1' },
    { id: 'id_exibicao', nome: 'ID de exibição', padrao: true, dica: 'Ordem cronológica no dataset inteiro; não muda com filtros' },
    { id: 'data_hora', nome: 'Data e hora', padrao: true, dica: 'Horário do dataset, dia/mês/ano' },
    { id: 'banco_origem', nome: 'Banco de origem' }, { id: 'conta_origem', nome: 'Conta de origem', padrao: true },
    { id: 'banco_destino', nome: 'Banco de destino' }, { id: 'conta_destino', nome: 'Conta de destino', padrao: true },
    { id: 'valor_pago', nome: 'Valor pago', padrao: true, num: true, dica: 'Na moeda de pagamento, sem conversão' }, { id: 'moeda_pagamento', nome: 'Moeda', padrao: true },
    { id: 'formato', nome: 'Formato de pagamento' },
    { id: 'score', nome: 'Score', padrao: true, num: true, dica: 'Índice de prioridade de 0 a 1000; não é probabilidade' }, { id: 'alerta', nome: 'Alerta', padrao: true, dica: 'Score 701 ou mais: sinal para investigação' },
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
      case 'alerta': return l.alerta ? h('span', { className: 'alerta-celula', title: 'Com alerta (faixa ' + NOME_FAIXA[l.faixa] + ')' }, '⚠ Sim', h('span', { className: 'sr' }, ' (faixa ' + NOME_FAIXA[l.faixa] + ')'))
        : h('span', { className: 'sem-alerta-celula', title: 'Sem alerta (faixa ' + NOME_FAIXA[l.faixa] + ')' }, 'Não', h('span', { className: 'sr' }, ' (faixa ' + NOME_FAIXA[l.faixa] + ')'));
      case 'rotulo': return l.rotulo === null ? 'sem rótulo' : l.rotulo === 1 ? 'lavagem' : 'não lavagem';
      case 'tipologias': return l.tipologias.length ? l.tipologias.join(', ') : '—';
      case 'linha_arquivo': return f.inteiro(l.linha_arquivo);
      default: if (c.extra) return f.vazio(l.extras[c.extra]) ? '—' : l.extras[c.extra];
        return f.vazio(l[c.id]) ? '—' : l[c.id];
    }
  };

  function SecaoTabela({ carga, manifesto, tabela, setTabela, aoDetalhe, selecionada }) {
    const extras = (manifesto.dataset.colunas_nao_reconhecidas || []).map(c => ({ id: 'x:' + c, nome: c + ' (coluna original)', extra: c }));
    const temTipologias = !!(manifesto.tipologias && manifesto.tipologias.disponivel);
    const todas = COLUNAS.filter(c => c.id !== 'tipologias' || temTipologias).concat(extras);
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
    return h(Secao, { id: 'tabela', icone: 'tabela', titulo: 'Registros de transação' },
      h('div', { className: 'barra-tabela' },
        h('p', { role: 'status', className: 'contagem' }, d ? h(React.Fragment, null, h('strong', null, f.inteiro(d.total)), ' registros · página ' + d.pagina + '/' + f.inteiro(d.paginas)) : 'Carregando…'),
        h('div', { className: 'controles' },
          h('label', { htmlFor: 't-ord' }, h(Icone, { nome: 'recentes' }), h('span', { className: 'sr' }, 'Ordenar por')),
          h('select', { id: 't-ord', value: tabela.ordenar + ':' + tabela.direcao,
            onChange: e => { const [o, dr] = e.target.value.split(':'); setTabela(Object.assign({}, tabela, { ordenar: o, direcao: dr, pagina: 1 })); } },
            h('option', { value: 'id_exibicao:asc' }, 'Mais antigas'), h('option', { value: 'id_exibicao:desc' }, 'Mais recentes'),
            h('option', { value: 'score:desc' }, 'Maior score'), h('option', { value: 'score:asc' }, 'Menor score'),
            h('option', { value: 'valor_pago:desc' }, 'Maior valor pago')),
          h('label', { htmlFor: 't-tam' }, 'Linhas'),
          h('select', { id: 't-tam', value: tabela.tamanho, onChange: e => setTabela(Object.assign({}, tabela, { tamanho: +e.target.value, pagina: 1 })) },
            [25, 50, 100, 200].map(n => h('option', { key: n, value: n }, n))),
          h('details', { className: 'seletor-colunas' }, h('summary', null, h(Icone, { nome: 'colunas' }), 'Colunas (' + cols.length + ' de ' + todas.length + ' visíveis)'),
            h('fieldset', null, h('legend', { className: 'ajuda', style: { marginBottom: 8 } }, 'As desmarcadas aparecem ao expandir a linha.'),
              h('div', { className: 'grade campos', style: { gap: 8 } }, todas.map(c => h('label', { key: c.id, title: c.dica },
                h('input', { type: 'checkbox', checked: visiveis.includes(c.id), onChange: () => alternar(c.id) }), c.nome))))))),
      carga.erro ? h(Erro, { erro: carga.erro }) : !d ? h(Esqueleto, { linhas: 8, altura: 22, texto: 'Carregando os registros…' }) : !d.linhas.length ? h(Vazio, null, 'Nenhuma transação passa pelos filtros atuais.') :
        h('div', { className: 'rolagem', 'aria-busy': carga.carregando }, h('table', { className: 'tabela-registros' },
          h('caption', { className: 'sr' }, 'Selecione o ID de exibição para ver os detalhes da transação, ou expanda a linha para ver as demais colunas.'),
          h('thead', null, h('tr', null, h('th', { scope: 'col', className: 'expandir' }, h('span', { className: 'sr' }, 'Expandir')), cols.map(c => h('th', { key: c.id, scope: 'col', className: c.num ? 'num' : '', title: c.dica }, c.nome)))),
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
                  h('button', { type: 'button', className: 'botao pequeno', onClick: () => aoDetalhe(l.id_exibicao) }, h(Icone, { nome: 'detalhes' }), 'Ver detalhes'))))];
          })))),
      d && d.paginas > 1 ? h('nav', { className: 'paginacao', 'aria-label': 'Páginas da tabela' },
        h('button', { type: 'button', className: 'botao pequeno', disabled: d.pagina <= 1, onClick: () => setTabela(Object.assign({}, tabela, { pagina: 1 })) }, 'Primeira'),
        h('button', { type: 'button', className: 'botao pequeno', disabled: d.pagina <= 1, onClick: () => setTabela(Object.assign({}, tabela, { pagina: d.pagina - 1 })) }, 'Anterior'),
        h('span', { className: 'fraco tab-num' }, d.pagina + ' / ' + f.inteiro(d.paginas)),
        h('button', { type: 'button', className: 'botao pequeno', disabled: d.pagina >= d.paginas, onClick: () => setTabela(Object.assign({}, tabela, { pagina: d.pagina + 1 })) }, 'Próxima'),
        h('button', { type: 'button', className: 'botao pequeno', disabled: d.pagina >= d.paginas, onClick: () => setTabela(Object.assign({}, tabela, { pagina: d.paginas })) }, 'Última')) : null,
      /* Só o que é próprio da tabela; cores, alerta, moedas e datas ficam na Legenda geral. */
      h('details', { className: 'como-ler-tabela' }, h('summary', null, 'Como ler a tabela'),
        h(Legenda, null, h('strong', null, 'Posição'), ': lugar na lista atual; muda com filtros e ordenação. ',
          h('strong', null, 'ID de exibição'), ': ordem cronológica no dataset inteiro (empates pela ordem da linha); nunca muda. ',
          'Cores, alerta e moedas: botão Legenda.')));
  }

  /* ═══ 6. Detalhes da transação (diálogo) ═════════════════════════════ */
  function DialogoDetalhes({ analiseId, id, total, aoFechar, aoFiltrarTabela, aoFocar, aoPerguntar, aoInterpretar }) {
    const carga = useCarga(id ? '/analises/' + analiseId + '/transacoes/' + id : null);
    const d = carga.dados;
    let corpo = h(Esqueleto, { linhas: 6, altura: 18, texto: 'Carregando a transação…' });
    let titulo = 'Detalhes da transação' + (id ? ' ' + f.idExibicao(id, total) : '');
    if (carga.erro) corpo = h(Erro, { erro: carga.erro });
    else if (d) {
      const t = d.transacao, mod = d.modelo || {};
      const fx = d.faixas.find(x => x.id === t.faixa);
      const cartao = (titulo, conteudo, extra) => h('div', { className: 'bloco' + (extra ? ' ' + extra : '') }, h('h3', null, titulo), conteudo);
      const conta = (papel, no, banco, numero) => cartao(papel, h(React.Fragment, null,
        h('p', { className: 'mono', style: { fontSize: 'var(--t-l)', fontWeight: 600, marginBottom: 8 } }, no),
        h(Pares, { itens: [['Banco', banco], ['Conta', h('span', { className: 'mono' }, numero)]] }),
        h('div', { className: 'linha', style: { marginTop: 10 } },
          h('button', { type: 'button', className: 'botao pequeno', onClick: () => { aoFocar(no); aoFechar(); } }, h(Icone, { nome: 'grafo' }), 'Ver no grafo'),
          h('button', { type: 'button', className: 'botao pequeno', onClick: () => { aoFiltrarTabela(papel === 'Origem' ? { conta_origem: no, conta_destino: '' } : { conta_origem: '', conta_destino: no }); aoFechar(); } }, h(Icone, { nome: 'filtro' }), 'Filtrar tabela'))));
      corpo = h(React.Fragment, null,
        /* Score em destaque: valor, faixa e alerta aparecem uma vez só aqui (medidor) e no selo do título.
           A interpretação completa fica em Detalhes (botão "Como ler"). */
        h('div', { className: 'score-destaque' },
          h('div', { className: 'bloco' + (t.alerta ? ' alerta' : '') },
            h('div', { className: 'cabeca-bloco' }, h('h3', null, h(Icone, { nome: 'score' }), 'Previsão do modelo'),
              aoInterpretar ? h('button', { type: 'button', className: 'botao pequeno fantasma dica-esquerda', onClick: aoInterpretar, 'aria-label': 'Como ler o score: abrir em Detalhes',
                'data-dica': 'Índice de prioridade de 0 a 1000, não é probabilidade.' }, h(Icone, { nome: 'info' }), 'Como ler') : null),
            h(MedidorScore, { score: t.score, faixa: t.faixa, nomeFaixa: fx.nome + ' (' + fx.de + '–' + fx.ate + ')', alerta: t.alerta }),
            h('p', { className: 'legenda', style: { marginTop: 10 } }, h('strong', null, 'Recomendação da faixa: '), fx.recomendacao + '.',
              t.alerta ? ' O alerta é um sinal para investigação, não uma confirmação.' : null)),
          cartao('Transação', h(Pares, { itens: [['Data e hora', f.dataHora(t.data_hora)], ['Valor pago', h('strong', null, f.valor(t.valor_pago) + ' ' + t.moeda_pagamento)],
            ['Valor recebido', f.valor(t.valor_recebido) + ' ' + t.moeda_recebimento], ['Formato de pagamento', t.formato]] }))),
        h('div', { className: 'fluxo-contas' },
          conta('Origem', t.no_origem, t.banco_origem, t.conta_origem),
          h('div', { className: 'seta-fluxo' + (t.alerta ? ' alerta' : ''), 'aria-hidden': 'true' }, h(Icone, { nome: 'seta' })),
          conta('Destino', t.no_destino, t.banco_destino, t.conta_destino)),
        h('div', { className: 'cartoes' },
          cartao('Motivos verificáveis', t.motivos.length ? h(React.Fragment, null, h('ul', { className: 'grade', style: { gap: 6 } }, t.motivos.map((m, i) => h('li', { key: i }, '• ' + m))),
            h(Legenda, null, 'Fatos conferíveis nos dados, calculados com regras fixas sobre o treino. Não explicam a decisão do modelo.')) :
            h(Legenda, null, t.alerta ? 'Não há motivo verificável para esta transação.' : 'Não há motivo verificável: os motivos só são calculados para transações com alerta.')),
          d.tipologias_disponiveis ? cartao('Tipologias registradas', h(React.Fragment, null,
            h('p', { className: 'mono' }, t.tipologias.length ? t.tipologias.join(', ') : 'padrao_nao_identificado'),
            h(Legenda, null, t.tipologias.length ? 'Registrada no arquivo de padrões do dataset (tentativa nº ' + t.tentativas.join(', ') + '). Não é previsão do modelo.' : 'Esta transação não aparece no arquivo de padrões do dataset.'))) : null,
          ROTULO ? cartao('Rótulo do dataset', d.rotulo_disponivel ? h(React.Fragment, null, h('p', null, h('strong', null, t.rotulo === 1 ? 'Lavagem (rótulo 1)' : 'Não lavagem (rótulo 0)')),
            h(Legenda, null, 'Valor que já veio no arquivo. Não é previsão e não entra no cálculo do score.')) : h(Legenda, null, 'Este dataset não tem rótulo de lavagem.')) : null),
        h('details', { className: 'acordeao' }, h('summary', null, 'Dados técnicos'),
          h('div', { className: 'conteudo' },
            /* score, faixa e alerta já estão no medidor e no título: aqui só o que é técnico */
            h(Pares, { itens: [['Score original do modelo', f.numero(t.score_bruto, 4) + ' (0 a 1, não calibrado)'],
              ['Limiar do modelo', f.numero(mod.limiar_alerta, 4) + ' na escala de 0 a 1'], ['Versão do modelo', mod.versao],
              ['Histórico da conta', t.historico_incompleto ? 'incompleto: menos de 72 h observadas antes desta transação' : 'ao menos 72 h observadas'],
              ['ID de exibição', f.idExibicao(t.id_exibicao, total)], ['ID original do arquivo', t.id_original || 'o arquivo não tem coluna de identificador'],
              ['Linha no arquivo', f.inteiro(t.linha_arquivo) + ' (o cabeçalho é a linha 1)']].concat(
              Object.entries(t.extras || {}).map(([k, v]) => [k + ' (coluna original)', v])) }))),
        aoPerguntar ? h('div', { className: 'linha' },
          h('button', { type: 'button', className: 'botao', onClick: () => aoPerguntar(t.id_exibicao) }, h(Icone, { nome: 'assistente' }), 'Perguntar ao assistente')) : null);
      titulo = h(React.Fragment, null, 'Transação ' + f.idExibicao(t.id_exibicao, total), t.alerta ? h(Selo, { tom: 'alerta' }, '⚠ Com alerta') : h(Selo, { tom: TOM_FAIXA[t.faixa] }, 'Faixa ' + NOME_FAIXA[t.faixa]));
    }
    return h(Dialogo, { id: 'dlg-detalhes', aberto: !!id, titulo, aoFechar }, corpo);
  }

  /* ═══ 7. Detalhes: score e metodologia ══════════════════════════════ */
  /* Casa da informação técnica completa: como ler o score (13 pontos numerados), faixas, conversão, finalidade e
     limites, definição de cada indicador (com a regra completa das contas prioritárias) e as tipologias.
     Cada assunto aparece uma vez, num bloco recolhível; um índice fixo no alto leva a cada bloco e o abre.
     Os números (limiar, score de alerta, faixas e conversão) vêm da API — do manifesto aberto ou, sem análise,
     do modelo carregado. Nada é recalculado aqui. */
  const BLOCOS_DETALHES = [
    { id: 'det-ler', nome: 'Como ler o score', sub: 'pontos 1 a 5', score: true },
    { id: 'det-faixas', nome: 'Faixas e recomendações', sub: 'pontos 6 a 10', score: true },
    { id: 'det-conversao', nome: 'Conversão para 0–1000', sub: 'técnico', score: true },
    { id: 'det-limites', nome: 'Finalidade e limites', sub: 'pontos 11 a 13', score: true },
    { id: 'det-indicadores', nome: 'O que cada indicador mede', sub: 'indicadores e contas' },
    { id: 'det-tipologias', nome: 'Tipologias', sub: 'registradas, não previstas' },
  ];

  /* Bloco recolhível controlado: o índice abre o bloco ao pular para ele; abrir à mão também atualiza o índice. */
  const BlocoDetalhe = ({ b, abertos, aoAlternar, children }) =>
    h('details', { id: b.id, className: 'acordeao bloco-det', open: abertos.has(b.id), onToggle: e => aoAlternar(b.id, e.currentTarget.open) },
      h('summary', null, b.nome, h('span', { className: 'sub' }, b.sub)),
      h('div', { className: 'conteudo' }, children));

  function InterpretacaoScore({ estado, manifesto, abertos, aoAlternar }) {
    const conv = (manifesto && manifesto.conversao_score) || {}, leg = estado.score || {};
    const limiar = limiarDe(manifesto, estado);
    const alerta = estado.score_alerta || leg.score_alerta || 701;
    const faixas = estado.faixas || [];
    if (!limiar) return h(Aviso, { tom: 'atencao', titulo: 'Limiar indisponível' }, 'O modelo não está carregado: a interpretação completa aparece quando o limiar do modelo estiver disponível.');
    const inicioInter = limiar * 301 / 701;
    const orig = v => f.numero(v, 4);
    const faixaOriginal = id => id === 'baixa' ? '0 a ' + orig(inicioInter) : id === 'intermediaria' ? orig(inicioInter) + ' a ' + orig(limiar) : orig(limiar) + ' a 1';
    const ev = leg.evidencia_de_nao_calibracao;
    const bloco = (id, ...conteudo) => h(BlocoDetalhe, { b: BLOCOS_DETALHES.find(x => x.id === id), abertos, aoAlternar }, ...conteudo);
    return h(React.Fragment, null,
      /* essencial, sempre à vista: as duas escalas, o limiar (única vez em que o valor aparece em texto) e o alerta */
      h('dl', { className: 'estatisticas' },
        h(Estat, { nome: 'Score original', valor: '0 a 1', sub: 'não calibrado' }),
        h(Estat, { nome: 'Índice exibido', valor: '0 a 1000', sub: 'prioridade, não probabilidade' }),
        h(Estat, { nome: 'Limiar original do modelo', valor: orig(limiar), sub: 'vira o score ' + alerta }),
        h(Estat, { nome: 'Alerta', valor: alerta + ' ou mais', sub: 'faixa alta · sinal para investigação' })),
      h('div', { className: 'acordeoes' },
        bloco('det-ler',
          h('ol', { className: 'pontos' },
            h('li', null, 'O modelo devolve um ', h('strong', null, 'score original entre 0 e 1'), '.'),
            h('li', null, 'Esse score ', h('strong', null, 'não representa uma probabilidade calibrada'), '.'),
            h('li', null, 'O painel converte o valor para um ', h('strong', null, 'índice de 0 a 1000'), '.'),
            h('li', null, 'A conversão serve para ', h('strong', null, 'ordenar e separar os registros em faixas'), '.'),
            h('li', null, 'O índice ', h('strong', null, 'não representa probabilidade de lavagem ou fraude'), '.'))),
        bloco('det-faixas',
          h('ol', { className: 'pontos', start: 6, style: { counterReset: 'ponto 5' } },
            h('li', null, 'O modelo informa um ', h('strong', null, 'limiar original'), ' na escala de 0 a 1 (valor no alto desta página).'),
            h('li', null, 'O limiar marca o início da faixa alta: ', h('strong', null, 'alerta e faixa alta são a mesma coisa'), '.')),
          h('div', { className: 'escala', role: 'img', 'aria-label': 'Escala do score: de 0 a 300, faixa baixa, score original de 0 a ' + orig(inicioInter) + '; de 301 a 700, faixa intermediária, score original de ' + orig(inicioInter) + ' a ' + orig(limiar) +
            '; de 701 a 1000, faixa alta com alerta, score original de ' + orig(limiar) + ' a 1.' },
            h('div', { className: 'faixas' }, h('div', { className: 'f-baixa' }, 'Baixa · 0–300'), h('div', { className: 'f-intermediaria' }, 'Intermediária · 301–700'), h('div', { className: 'f-alta' }, '⚠ Alta · 701–1000')),
            h('div', { className: 'marcas' },
              h('div', null, h('span', null, 'original 0'), h('span', null, orig(inicioInter))),
              h('div', null, h('span', null, ''), h('strong', null, orig(limiar) + ' (limiar)')),
              h('div', null, h('span', null, ''), h('span', null, 'original 1')))),
          /* as três faixas aparecem uma vez, nesta tabela; cada linha é um dos pontos 8 a 10 */
          h('div', { className: 'rolagem' }, h('table', { className: 'tabela-faixas' },
            h('caption', { className: 'sr' }, 'Pontos 8 a 10: cada faixa do índice, o trecho do score original e a recomendação.'),
            h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Faixa'), h('th', { scope: 'col' }, 'Índice'), h('th', { scope: 'col' }, 'Score original'), h('th', { scope: 'col' }, 'Recomendação'))),
            h('tbody', null, faixas.map((x, i) => h('tr', { key: x.id, className: x.id === 'alta' ? 'com-alerta' : '' },
              h('td', null, h('span', { className: 'linha', style: { gap: 8, flexWrap: 'nowrap' } }, h('span', { className: 'ponto-num', 'aria-hidden': 'true' }, 8 + i),
                h('span', { className: 'ponto-faixa ' + x.id, 'aria-hidden': 'true' }), h('strong', null, (x.id === 'alta' ? '⚠ ' : '') + x.nome))),
              h('td', { className: 'tab-num' }, x.de + '–' + x.ate), h('td', { className: 'mono' }, faixaOriginal(x.id)), h('td', { style: { whiteSpace: 'normal' } }, x.recomendacao))))))),
        bloco('det-conversao',
          h(Legenda, null, h('strong', null, 'Conversão: '), leg.conversao || conv.tipo || ''),
          conv.ancoras ? h('dl', { className: 'estatisticas' }, conv.ancoras.map((a, i) => h(Estat, { key: i, nome: 'Âncora ' + (i + 1), valor: 'original ' + orig(a.bruto) + ' → ' + a.score }))) : null,
          /* a evidência compara o score com o rótulo do dataset: só aparece quando o rótulo é exibido */
          ROTULO ? (ev ? h(React.Fragment, null, h('h4', null, 'Por que o score original não é uma probabilidade'),
            h(Legenda, null, ev.leitura + ' Origem: ' + ev.origem + '.'),
            h('div', { className: 'rolagem' }, h('table', null,
              h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Score original'), h('th', { scope: 'col', className: 'num' }, 'Transações'), h('th', { scope: 'col', className: 'num' }, 'Score médio'), h('th', { scope: 'col', className: 'num' }, 'Rotuladas como lavagem'))),
              h('tbody', null, ev.caixas.map((c, i) => h('tr', { key: i }, h('td', null, f.numero(c.de, 1) + ' a ' + f.numero(c.ate, 1)), h('td', { className: 'num' }, f.inteiro(c.transacoes)),
                h('td', { className: 'num' }, f.numero(c.score_medio, 3)), h('td', { className: 'num' }, f.pct(c.fracao_rotulada_lavagem, 1)))))))) :
            h(Legenda, null, 'A avaliação histórica com a comparação entre score e rótulo não está disponível neste servidor.')) : null),
        bloco('det-limites',
          h('ol', { className: 'pontos', start: 11, style: { counterReset: 'ponto 10' } },
            h('li', null, 'As faixas são ', h('strong', null, 'recomendações para análise offline'), '.'),
            h('li', null, 'O NodeWatch ', h('strong', null, 'não bloqueia, não aprova e não realiza pagamentos'), ': não há integração bancária.'),
            h('li', null, 'O score é um ', h('strong', null, 'sinal para investigação, não uma prova de fraude'), ' nem de lavagem.')))));
  }

  function SecaoDetalhes({ estado, manifesto, visao }) {
    const v = visao && visao.dados;
    const temScore = !!limiarDe(manifesto, estado);
    const blocos = BLOCOS_DETALHES.filter(b => temScore || !b.score);
    const [abertos, setAbertos] = React.useState(() => new Set(['det-ler']));
    const alternar = (id, aberto) => setAbertos(s => { if (s.has(id) === aberto) return s; const n = new Set(s); if (aberto) n.add(id); else n.delete(id); return n; });
    const todosAbertos = blocos.every(b => abertos.has(b.id));
    /* Índice: abre o bloco, leva até ele (sem rolagem suave quando o sistema pede menos movimento) e põe o foco no título. */
    const ir = id => {
      alternar(id, true);
      const el = document.getElementById(id);
      if (!el) return;
      el.open = true;
      let reduzir = false;
      try { reduzir = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* sem matchMedia: rolagem direta */ }
      el.scrollIntoView({ block: 'start', behavior: reduzir ? 'auto' : 'smooth' });
      const s = el.querySelector('summary'); if (s) s.focus({ preventScroll: true });
    };
    const cr = v && v.contas_risco;
    const regra = (cr && cr.regra) || estado.regra_contas;
    const limite = (cr && cr.limite) || (estado.limites || {}).contas_risco;
    const bloco = (id, ...conteudo) => h(BlocoDetalhe, { b: BLOCOS_DETALHES.find(x => x.id === id), abertos, aoAlternar: alternar }, ...conteudo);
    return h(Secao, { id: 'detalhes', icone: 'detalhes', titulo: 'Score e metodologia' },
      h('nav', { className: 'indice-det', 'aria-label': 'Blocos desta página' },
        h('ul', { className: 'chips' }, blocos.map(b => h('li', { key: b.id },
          h('button', { type: 'button', className: 'chip chip-ir' + (abertos.has(b.id) ? ' aberto' : ''), 'aria-controls': b.id, onClick: () => ir(b.id),
            'aria-label': b.nome + (abertos.has(b.id) ? ' (aberto)' : '') }, h('span', { className: 'marca-aberto', 'aria-hidden': 'true' }), b.nome)))),
        h('button', { type: 'button', className: 'botao pequeno fantasma', onClick: () => setAbertos(todosAbertos ? new Set() : new Set(blocos.map(b => b.id))) },
          todosAbertos ? 'Recolher tudo' : 'Abrir tudo')),
      h(InterpretacaoScore, { estado, manifesto, abertos, aoAlternar: alternar }),
      h('div', { className: 'acordeoes' },
        bloco('det-indicadores',
          h(Pares, { itens: [
            v ? ['Recorte', v.registros.legenda + (v.periodo ? ' ' + v.periodo.legenda : '')] : null,
            v ? ['Alertas', v.alertas.legenda] : null,
            v && v.score ? ['Score', v.score.legenda] : null,
            v ? ['Formato de pagamento', v.formatos.legenda + '. Vazio ou desconhecido aparece como "Não informado".'] : null,
            /* única cópia da regra completa; a Visão geral e a Investigação mostram só um resumo e apontam para cá */
            regra ? ['Contas prioritárias', regra + (limite ? ' A lista mostra até ' + limite + ' contas.' : '')] : null] }),
          v ? null : h(Legenda, null, 'As definições dos indicadores do recorte aparecem com uma análise aberta.')),
        bloco('det-tipologias',
          h(Legenda, null, 'Tipologias de lavagem registradas no dataset, não previstas pelo modelo.' +
            (v && !v.tipologias.disponivel ? ' Este dataset não tem arquivo de padrões.' : '')),
          (estado.tipologias || []).length ? h(Pares, { itens: estado.tipologias.map(x => [h('span', { className: 'mono' }, x.tipologia), x.descricao]) }) : null)));
  }

  /* ═══ Operação (gaveta à direita) ════════════════════════════════════
     Casa do estado do processo, das medidas de execução (RAM, CPU, latência, vazão, durações) e dos logs.
     As leituras vêm de /operacao/desempenho a cada 3 s, só com a gaveta aberta. As barras curtas usam só as
     leituras recebidas por esta página (no máximo 24): nada é estimado nem preenchido. */
  const LEITURAS_MAX = 24;
  const horaCurta = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('pt-BR'); };
  // a latência mais recente entre as operações medidas (cada uma traz o horário da última consulta)
  const ultimaLatencia = d => ((d && d.latencias) || []).reduce((a, l) => (!a || String(l.medido_em) > String(a.medido_em) ? l : a), null);
  function useLeiturasOperacao(aberto) {
    const [est, setEst] = React.useState({ d: null, erro: null, hist: [] });
    const ler = () => api('/operacao/desempenho').then(x => setEst(e => {
      if (e.d && e.d.medido_em === x.medido_em) return { d: x, erro: null, hist: e.hist };
      const lat = ultimaLatencia(x), mp = x.memoria.processo, mm = x.memoria.maquina;
      const ponto = { ramProc: mp.bytes, ramSis: mm.percentual, cpu: x.cpu.processo_pct, lat: lat ? lat.ultima_ms : null, latEm: lat ? lat.medido_em : null };
      return { d: x, erro: null, hist: e.hist.concat([ponto]).slice(-LEITURAS_MAX) };
    })).catch(erro => setEst(e => ({ d: e.d, erro, hist: e.hist })));
    React.useEffect(() => { if (aberto) ler(); }, [aberto]);
    useIntervalo(ler, 3000, aberto);
    return est;
  }

  /* Barras das últimas leituras desta página. Percentuais em escala fixa de 0 a 100; bytes e milissegundos em
     relação à maior leitura mostrada. Só aparecem com 2 leituras ou mais; o valor atual está escrito ao lado. */
  function MiniBarras({ valores, teto }) {
    const v = valores.filter(x => !f.vazio(x));
    if (v.length < 2) return null;
    const max = teto || Math.max.apply(null, v) || 1;
    return h('span', { className: 'op-barras', 'aria-hidden': 'true' },
      v.map((x, i) => h('i', { key: i, className: i === v.length - 1 ? 'atual' : undefined, style: { height: Math.max(8, Math.min(100, 100 * x / max)) + '%' } })));
  }
  /* Indicador do topo: o ponto pulsa uma vez quando chega uma leitura nova (chave = horário da leitura). */
  function Indicador({ nome, valor, sub, dica, pulso, parado, barras }) {
    const falta = f.vazio(valor);
    return h('div', { className: 'op-indicador', title: dica || undefined },
      h('dt', null, pulso ? h('span', { key: pulso, className: 'op-pulso' + (parado ? ' parado' : ''), 'aria-hidden': 'true' }) : null, nome),
      h('dd', null, h('strong', { className: falta ? 'indisponivel' : undefined }, falta ? '—' : valor),
        sub ? h('span', { className: 'op-sub' }, sub) : null,
        dica ? h('span', { className: 'sr' }, ' (' + dica + ')') : null),
      barras || null);
  }
  const SESSAO_TEXTO = { ativa: ['ok', 'Sessão ativa'], abrindo: ['neutro', 'Abrindo a sessão'], expirada: ['atencao', 'Sessão expirada · reabrindo'], sem_servidor: ['alerta', 'Servidor sem resposta'] };
  function ResumoOperacao({ leitura }) {
    const sessao = window.NW.useSessao();
    const { d, erro, hist } = leitura;
    const a = d ? d.analise : null;
    const rodando = !!a && a.status === 'em_andamento';
    const parado = !!erro;
    const mp = d ? d.memoria.processo : null, mm = d ? d.memoria.maquina : null, cpu = d ? d.cpu : null;
    const lat = ultimaLatencia(d);
    // latência: uma barra por consulta medida (leituras sem consulta nova não repetem a barra)
    const estado = !d ? (erro ? 'Sem resposta' : 'Lendo…') : rodando ? 'Analisando' : 'Disponível';
    const detalhe = !d ? (erro ? 'não foi possível ler o servidor' : '')
      : rodando ? (a.etapa_atual || 'preparando a próxima etapa') + ' · ' + a.dataset
        : a ? 'última: ' + a.dataset + ' (' + (NOME_STATUS[a.status] || a.status).toLowerCase() + ')' : 'nenhuma análise feita ainda';
    const s = SESSAO_TEXTO[sessao.estado] || ['neutro', sessao.estado];
    const tom = !d || parado ? 'falha' : rodando ? 'rodando' : 'pronto';
    const pulso = d && !parado ? d.medido_em : null;
    const semDado = !d ? (erro ? 'Sem resposta do servidor.' : 'Aguardando a primeira leitura.') : null;
    return h('div', { className: 'op-resumo' },
      h('div', { className: 'op-estado ' + tom },
        h('span', { key: pulso || 'parado', className: 'op-pulso' + (pulso ? '' : ' parado'), 'aria-hidden': 'true' }),
        h('div', { className: 'op-estado-texto', role: 'status' }, h('strong', null, estado), detalhe ? h('span', { className: 'op-sub' }, detalhe) : null),
        h('div', { className: 'op-estado-meta' }, h(Selo, { tom: s[0] }, s[1]),
          d ? h('span', { className: 'op-hora', title: 'As medidas são lidas a cada 3 s enquanto esta gaveta está aberta.' },
            (parado ? 'sem atualização desde ' : 'leitura às ') + horaCurta(d.medido_em)) : null)),
      h('dl', { className: 'op-indicadores' },
        h(Indicador, { nome: 'RAM do processo', pulso, parado, valor: mp && !f.vazio(mp.bytes) ? f.gb(mp.bytes) : null,
          sub: mp && !f.vazio(mp.percentual_da_maquina) ? f.numero(mp.percentual_da_maquina, 1) + '% da máquina' : null,
          dica: mp && !f.vazio(mp.bytes) ? 'Memória usada pelo processo NodeWatch, em GB (10⁹ bytes).' : semDado || 'Leitura de memória do processo indisponível neste sistema.',
          barras: h(MiniBarras, { valores: hist.map(p => p.ramProc) }) }),
        h(Indicador, { nome: 'RAM do sistema', pulso, parado, valor: mm && !f.vazio(mm.em_uso_bytes) ? f.gb(mm.em_uso_bytes) : null,
          sub: mm && !f.vazio(mm.total_bytes) ? 'de ' + f.gb(mm.total_bytes) + (f.vazio(mm.percentual) ? '' : ' · ' + f.numero(mm.percentual, 0) + '%') : null,
          dica: mm && !f.vazio(mm.em_uso_bytes) ? 'Memória em uso no computador inteiro, em GB (10⁹ bytes).' : semDado || 'Leitura de memória da máquina indisponível neste sistema.',
          barras: h(MiniBarras, { valores: hist.map(p => p.ramSis), teto: 100 }) }),
        h(Indicador, { nome: 'CPU do processo', pulso, parado, valor: cpu && !f.vazio(cpu.processo_pct) ? f.numero(cpu.processo_pct, 1) + '%' : null,
          sub: cpu && !f.vazio(cpu.maquina_pct) ? 'sistema ' + f.numero(cpu.maquina_pct, 1) + '%' : null,
          dica: cpu ? 'CPU: ' + cpu.leitura + ' (' + cpu.nucleos_logicos + ' núcleos lógicos).' : semDado,
          barras: h(MiniBarras, { valores: hist.map(p => p.cpu), teto: 100 }) }),
        h(Indicador, { nome: 'Última latência', pulso: lat && !parado ? lat.medido_em : null, valor: lat ? f.numero(lat.ultima_ms, 0) + ' ms' : null, sub: lat ? lat.operacao : null,
          dica: lat ? 'Consulta mais recente medida no servidor: ' + lat.operacao + ', às ' + horaCurta(lat.medido_em) + '. Tempo de processamento no servidor; não inclui a rede nem o navegador. Cada operação tem sua série na aba Desempenho.' : semDado || 'Nenhuma consulta medida ainda.' })));
  }

  /* Aba Desempenho: vazão e durações da análise, tabela de latências e detalhes técnicos (recolhidos). */
  function Desempenho({ leitura }) {
    const { d, erro } = leitura;
    if (!d) return erro ? h(Erro, { erro }) : h(Carregando, null);
    const mp = d.memoria.processo, a = d.analise;
    return h('div', { className: 'grade op-desempenho' },
      h('h4', null, 'Análise'),
      a ? h(React.Fragment, null, h(Pares, { itens: [
        ['Qual', a.qual + ' — ' + a.dataset + ' (' + NOME_STATUS[a.status] + ')'],
        ['Duração total', f.vazio(a.duracao_total_s) ? (a.etapa_atual ? 'em andamento: ' + a.etapa_atual : '—') : f.duracao(a.duracao_total_s)],
        ['Vazão da análise inteira', f.vazio(a.vazao_total_por_s) ? 'ainda não medida' : f.inteiro(a.vazao_total_por_s) + ' transações por segundo'],
        ['Vazão só da pontuação', f.vazio(a.vazao_pontuacao_por_s) ? 'ainda não medida' : f.inteiro(a.vazao_pontuacao_por_s) + ' transações por segundo'],
        ['Transações pontuadas', f.inteiro(a.transacoes_pontuadas)],
      ] }),
        h('details', { className: 'op-tecnico' }, h('summary', null, 'Tempos, pico de memória e fórmulas'),
          h(Pares, { itens: [
            ['Pico de memória na pontuação', f.vazio(a.pico_memoria_bytes) ? 'ainda não medido' : f.gb(a.pico_memoria_bytes)],
            ['Tempo por atividade', ['tempo_atributos_s', 'tempo_inferencia_s', 'tempo_gravacao_s'].every(k => f.vazio(a.tempos[k])) ? 'medido ao fim da pontuação'
              : ['atributos ' + f.duracao(a.tempos.tempo_atributos_s), 'inferência ' + f.duracao(a.tempos.tempo_inferencia_s), 'gravação ' + f.duracao(a.tempos.tempo_gravacao_s)].join(' · ')],
            ['Cálculo da vazão', f.vazio(a.vazao_total_por_s) ? '—' : f.inteiro(a.transacoes_pontuadas) + ' ÷ ' + f.duracao(a.duracao_total_s) + ' (análise inteira)' +
              (f.vazio(a.vazao_pontuacao_por_s) ? '' : ' · ' + f.inteiro(a.transacoes_pontuadas) + ' ÷ ' + f.duracao(a.tempo_pontuacao_s) + ' (pontuação)')],
          ] }),
          h(Legenda, null, 'Vazão da análise inteira: ' + a.vazao_total_formula + '. Vazão só da pontuação: ' + a.vazao_pontuacao_formula + '. Pico de memória: ' + a.pico_escopo + '.')))
        : h(Legenda, null, 'Nenhuma análise foi feita ainda.'),
      h('h4', null, 'Latência (ms) ', h(Dica, { texto: 'Latência = tempo de processamento de cada consulta no servidor, em milissegundos (não inclui a rede nem o navegador).' })),
      d.latencias.length ? h('div', { className: 'rolagem' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Operação medida'), h('th', { scope: 'col', className: 'num' }, 'Última (ms)'), h('th', { scope: 'col', className: 'num' }, 'Mediana (ms)'), h('th', { scope: 'col', className: 'num' }, 'Amostras'))),
        h('tbody', null, d.latencias.map(l => h('tr', { key: l.operacao }, h('td', null, l.operacao), h('td', { className: 'num' }, f.numero(l.ultima_ms, 0)), h('td', { className: 'num' }, f.numero(l.mediana_ms, 0)), h('td', { className: 'num' }, l.amostras)))))) :
        h(Legenda, null, 'Nenhuma consulta medida ainda.'),
      h('details', { className: 'op-tecnico' }, h('summary', null, 'Detalhes do processo'),
        h(Pares, { itens: [
          ['Pico de RAM do processo', f.vazio(mp.pico_bytes) ? '—' : f.gb(mp.pico_bytes) + ' (desde que o servidor iniciou)'],
          ['CPU do sistema', f.vazio(d.cpu.maquina_pct) ? '—' : f.numero(d.cpu.maquina_pct, 1) + '%'],
          ['Leitura de CPU', d.cpu.nucleos_logicos + ' núcleos lógicos · janela de ' + f.numero(d.cpu.janela_s, 1) + ' s'],
          ['Lido em', f.instante(d.medido_em) + ' (atualiza a cada 3 s)'],
        ] }),
        h(Legenda, null, 'CPU: ' + d.cpu.leitura + '.')));
  }

  /* Logs do sistema e de ML: filtro por nível, linhas com hora, nível e mensagem; o contexto técnico fica recolhido. */
  const NIVEL_LOG = { info: 'Info', aviso: 'Aviso', erro: 'Erro' };
  const FILTROS_NIVEL = [['todos', 'Todos'], ['aviso', 'Avisos'], ['erro', 'Erros']];
  function ListaLogs({ tipo, aberto }) {
    const [d, setD] = React.useState(null);
    const [erro, setErro] = React.useState(null);
    const [nivel, setNivel] = React.useState('todos');
    const ler = () => api('/operacao/logs?tipo=' + tipo + '&limite=150').then(x => { setD(x); setErro(null); }).catch(setErro);
    React.useEffect(() => { if (aberto) ler(); }, [aberto, tipo]);
    useIntervalo(ler, 5000, aberto);
    if (!d) return erro ? h(Erro, { erro }) : h(Carregando, null);
    const conta = n => n === 'todos' ? d.entradas.length : d.entradas.filter(e => e.nivel === n).length;
    const lista = nivel === 'todos' ? d.entradas : d.entradas.filter(e => e.nivel === nivel);
    const sobre = (tipo === 'sistema' ? 'Envios, validações, início, fim, cancelamento e erros de análise.'
      : 'Modelo e versão carregados, limiar, transações pontuadas, tempo de inferência e avisos de atributos ou de esquema.') + ' Mostra os 150 registros mais recentes. ' + d.privacidade;
    const repetidos = {};
    return h('div', { className: 'grade op-logs' },
      h('div', { className: 'op-logs-topo' },
        h('div', { className: 'chips', role: 'group', 'aria-label': 'Filtrar por nível' }, FILTROS_NIVEL.map(([id, nome]) =>
          h('button', { key: id, type: 'button', className: 'chip op-filtro nivel-' + id, 'aria-pressed': nivel === id, onClick: () => setNivel(id) },
            nome, h('span', { className: 'op-conta' }, f.inteiro(conta(id)))))),
        h(Dica, { texto: sobre, lado: 'esquerda' })),
      erro ? h('p', { className: 'ajuda', role: 'status' }, 'A última atualização falhou; a lista abaixo é a anterior.') : null,
      lista.length ? h('ul', { className: 'log op-log' }, lista.map(e => {
        const base = e.quando + '|' + e.evento;
        repetidos[base] = (repetidos[base] || 0) + 1;
        const ctx = ['evento=' + e.evento].concat(Object.entries(e.contexto || {}).map(([k, v]) => k + '=' + (typeof v === 'object' && v !== null ? JSON.stringify(v) : v)));
        return h('li', { key: base + '|' + repetidos[base], className: 'op-log-item' + (e.nivel === 'erro' ? ' erro-log' : e.nivel === 'aviso' ? ' aviso-log' : '') },
          h('time', { className: 'quando', dateTime: e.quando, title: f.instante(e.quando) }, horaCurta(e.quando)),
          h('span', { className: 'op-nivel ' + e.nivel }, NIVEL_LOG[e.nivel] || e.nivel),
          h('span', { className: 'op-msg' }, e.mensagem),
          h('details', { className: 'op-ctx' }, h('summary', null, 'Contexto'), h('div', { className: 'ctx' }, ctx.join(' · '))));
      })) : h(Vazio, { compacto: true }, d.entradas.length ? 'Nenhum registro com este nível.' : 'Nenhum registro ainda.'));
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
        hi.conjuntos.map(c => h('div', { key: c.id, className: 'bloco' }, h('h4', { style: { marginTop: 0 } }, 'Conjunto de avaliação: ' + c.nome),
          h(Legenda, null, 'Período: ' + c.periodo + ' · ' + f.inteiro(c.transacoes) + ' transações, ' + f.inteiro(c.rotuladas_lavagem) + ' ' + T.positivos + '.'), tabela(c))),
        h('details', { className: 'op-tecnico' }, h('summary', null, 'Origem destas métricas'),
          h(Pares, { itens: [['Modelo', hi.versao_modelo], ['Dados', hi.dados], ['Origem', h('span', { className: 'mono' }, hi.origem)], ['Arquivo gravado em', f.instante(hi.arquivo_gravado_em)]] })),
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

  const ABAS_OPERACAO = [['desempenho', 'Desempenho'], ['sistema', 'Logs do sistema'], ['ml', 'Logs de ML'], ['metricas', 'Métricas de ML']];
  function PainelLateral({ aberto, aoFechar, analiseId }) {
    const [aba, setAba] = React.useState('desempenho');
    const ref = React.useRef(null);
    const leitura = useLeiturasOperacao(aberto);
    React.useEffect(() => { if (aberto && ref.current) ref.current.focus(); }, [aberto]);
    const ABAS = ABAS_OPERACAO;
    // setas trocam de aba; Home e End vão à primeira e à última (Esc fecha a gaveta, tratado no <aside>)
    const tecla = e => {
      const i = ABAS.findIndex(a => a[0] === aba);
      const j = e.key === 'ArrowRight' ? (i + 1) % ABAS.length : e.key === 'ArrowLeft' ? (i + ABAS.length - 1) % ABAS.length
        : e.key === 'Home' ? 0 : e.key === 'End' ? ABAS.length - 1 : -1;
      if (j < 0) return;
      e.preventDefault();
      setAba(ABAS[j][0]);
      const b = document.getElementById('aba-' + ABAS[j][0]); if (b) b.focus();
    };
    return h(React.Fragment, null, h('div', { className: 'lateral-fundo', hidden: !aberto, onClick: aoFechar, 'aria-hidden': 'true' }),
      h('aside', { id: 'painel-operacional', className: 'lateral operacao', hidden: !aberto, 'aria-labelledby': 'lateral-t', onKeyDown: e => { if (e.key === 'Escape') aoFechar(); } },
      h('header', null, h('h2', { id: 'lateral-t', tabIndex: -1, ref }, h(Icone, { nome: 'operacao' }), 'Operação'), h('button', { type: 'button', className: 'botao fantasma', onClick: aoFechar }, h(Icone, { nome: 'fechar' }), 'Fechar')),
      h('div', { className: 'conteudo' },
        h(ResumoOperacao, { leitura }),
        h('div', { role: 'tablist', className: 'abas', 'aria-label': 'Desempenho, logs e métricas', onKeyDown: tecla },
          ABAS.map(([id, nome]) => h('button', { key: id, id: 'aba-' + id, role: 'tab', type: 'button', 'aria-selected': aba === id, 'aria-controls': 'painel-aba', tabIndex: aba === id ? 0 : -1, onClick: () => setAba(id) }, nome))),
        h('div', { role: 'tabpanel', id: 'painel-aba', 'aria-labelledby': 'aba-' + aba, tabIndex: 0 },
          aba === 'desempenho' ? h(Desempenho, { leitura }) : aba === 'metricas' ? h(MetricasML, { analiseId, aberto }) : h(ListaLogs, { key: aba, tipo: aba, aberto })))));
  }

  /* ═══ Legenda geral ══════════════════════════════════════════════════ */
  /* Casa dos símbolos, cores, classificações e convenções visuais (inclusive as do grafo). O que é explicação longa
     fica em Detalhes (faixas com recomendações, limiar, conversão e descrições das tipologias); aqui só a convenção. */
  const COR_FAIXA = { baixa: 'Verde.', intermediaria: 'Âmbar.', alta: 'Vermelho, com "⚠": toda transação desta faixa tem alerta.' };
  function DialogoLegenda({ aberto, aoFechar, estado, aoDetalhes }) {
    const grupo = (titulo, itens, nota) => h('div', { className: 'bloco' }, h('h3', null, titulo), h(Pares, { itens }), nota || null);
    /* atalho para Detalhes quando quem abre a legenda oferece a navegação; senão, fica a indicação em texto */
    const irDetalhes = texto => h('p', { className: 'legenda nota-detalhes' }, texto + ' ',
      aoDetalhes ? h('button', { type: 'button', className: 'botao texto', onClick: () => { aoFechar(); aoDetalhes(); } }, 'Abrir Detalhes') : h('strong', null, 'em Detalhes.'));
    return h(Dialogo, { id: 'dlg-legenda', aberto, titulo: 'Legenda geral', aoFechar },
      h(Legenda, null, 'Nenhuma informação depende só da cor.'),
      h('div', { className: 'cartoes' },
        grupo('Score e faixas', estado.faixas.map(x => [x.nome + ' (' + x.de + '–' + x.ate + ')', COR_FAIXA[x.id] || '']).concat([
          ['Score', 'Índice de prioridade de 0 a 1000. Não é probabilidade.'],
          ['Score original', 'Valor de 0 a 1 devolvido pelo modelo; não calibrado.'],
          ['Alerta', 'Score ' + estado.score_alerta + ' ou mais. Sinal para investigação, não confirmação de lavagem.']]),
          irDetalhes('Recomendações, limiar e conversão:')),
        grupo('Cores e ícones', [
          ['⚠ e vermelho', 'Alerta (transação, conta ou caminho): sempre com "⚠", texto ou fundo tingido, nunca só a cor. Na tabela, faixa vermelha no início da linha e "⚠ Sim".'],
          ['Vermelho NodeWatch', 'Item ativo, ação principal, seleção, progresso e etapa em andamento (▶). Sem "⚠", não indica alerta.'],
          ['Âmbar', 'Atenção: resultado parcial, linhas recusadas ou aviso.'],
          ['Verde e ✓', 'Etapa ou análise concluída; dataset válido.'],
          ['Ciano', 'Aviso informativo.'],
          ['Contorno amarelo', 'Elemento com o foco do teclado.'],
          ['Movimento', 'Só onde há estado real: etapa em andamento, bloco gravado, caminho com alerta e conta em foco. Para quando o sistema pede menos movimento.']]),
        grupo('Estados da análise', Object.entries(estado.status_analise).map(([k, v]) => [NOME_STATUS[k], v.replace(/^[^:]+:\s*/, '')])),
        grupo('Estados do dataset', [['Válido', 'Todas as linhas passaram na validação.'], ['Válido, com linhas recusadas', 'Há linhas com problema; elas ficam fora da análise e são listadas.'],
          ['Inválido', 'O arquivo não pode ser analisado; a tabela de problemas diz o que corrigir.']]),
        grupo('Tabela', [['Posição e ID de exibição', 'Explicados em "Como ler a tabela", na vista Transações.'],
          ROTULO ? ['Rótulo do dataset', 'Marcação de lavagem que já veio no arquivo; separada da previsão.'] : null, ['Não informado', 'Formato de pagamento vazio ou desconhecido no arquivo.'],
          ['Valores e moedas', 'Na moeda de pagamento, sem conversão. Moedas diferentes nunca são somadas.'],
          ['Datas', 'No horário do dataset, formato dia/mês/ano.'],
          ['Recorte', 'Conjunto de transações que passa pelos filtros aplicados.']]),
        grupo('Sessão da interface', [['Sessão ativa', estado.sessao.leitura], ['Sem retomada', 'Reabrir a página mostra o que ficou gravado. Nenhuma análise recomeça sozinha.']]),
        grupo('Grafo', [
          ['Conta em foco', 'Anel branco com halo vermelho que pulsa.'],
          ['Conta ligada a alerta', 'Vermelha, com "!".'],
          ['Grupo de contas', 'Círculo tracejado com "+N": contas com uma única ligação, à mesma conta. Selecione para expandir.'],
          ['Seta', 'Vai da conta de origem para a de destino do dinheiro.'],
          ['Caminho com alerta', 'Linha vermelha; um pulso percorre a linha no sentido do dinheiro.'],
          ['Traço tracejado', 'Sem ordem temporal confirmada: não é uma etapa seguinte do dinheiro.'],
          ['Traço branco animado', 'Sequência selecionada: horários compatíveis, o que não prova que é o mesmo dinheiro.'],
          ['Caminho até o foco', 'Linha branca, ao selecionar uma conta.'],
          ['Aresta agrupada', 'Traço grosso: transações de mesma origem, destino e moeda.'],
          ['"banco-…final"', 'Rótulo abreviado quando há muitas contas; o completo fica na dica e na seleção.']]),
        h('div', { className: 'bloco' }, h('h3', null, 'Tipologias'),
          h(Legenda, null, 'Padrões de lavagem registrados no arquivo do dataset; o modelo não os prevê.'),
          irDetalhes('Descrição de cada tipologia:'))));
  }

  /* ═══ Assistente de dúvidas ══════════════════════════════════════════ */
  /* Texto da resposta com **negrito**, listas "- ", subtítulos (linha só em negrito ou "# ") e quebras de linha,
     sem HTML (nada é interpretado como código). */
  function TextoRico({ texto }) {
    const linhas = String(texto || '').split(/\r?\n/);
    const inline = (s, k) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => /^\*\*[^*]+\*\*$/.test(p) ? h('strong', { key: k + '-' + i }, p.slice(2, -2)) : p);
    const blocos = [];
    let lista = null;
    linhas.forEach((l, i) => {
      const m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l);
      if (m) { if (!lista) { lista = []; blocos.push(h('ul', { key: 'u' + i, className: 'msg-lista' }, lista)); } lista.push(h('li', { key: i }, inline(m[1], i))); return; }
      lista = null;
      const sub = /^\s*(?:#+\s*(.+?)|\*\*([^*]+)\*\*:?)\s*$/.exec(l);
      if (sub) { blocos.push(h('p', { key: i, className: 'msg-subtitulo' }, h('strong', null, sub[1] || sub[2]))); return; }
      if (l.trim()) blocos.push(h('p', { key: i }, inline(l, i)));
    });
    return h('div', { className: 'msg-texto' }, blocos);
  }

  const lerSessao = (chave, padrao) => { try { const v = sessionStorage.getItem(chave); return v === null ? padrao : v; } catch (e) { return padrao; } };
  const gravarSessao = (chave, valor) => { try { sessionStorage.setItem(chave, valor); } catch (e) { /* sem armazenamento: vale só nesta tela */ } };

  /* "Assistente de dúvidas" na tela; por dentro, o Sentinel AI (src/sentinel_ia.py), quando autorizado, com o
     contexto verificado da análise. Sem autorização ou sem chave, responde no modo local, sem serviço externo.
     A barra de contexto separa o que vai com a pergunta (análise, filtros aplicados, transação) do que é só da
     tela (vista e conta em foco); "Na tela agora" são frases calculadas pela página com os dados já carregados,
     nunca entram na conversa nem no histórico enviado. */
  function Assistente({ analiseId, filtros, estado, transacaoId, aoLimparTransacao, pedido, total, vista, manifesto, visao, grafo }) {
    const [aberto, setAberto] = React.useState(false);
    const [msgs, setMsgs] = React.useState([]);
    const [texto, setTexto] = React.useState('');
    const [ocupado, setOcupado] = React.useState(false);
    const [verTela, setVerTela] = React.useState(true);
    const [trocou, setTrocou] = React.useState(false);
    const sent = (estado.assistente && estado.assistente.sentinel) || { disponivel: false, envia: [] };
    const [usarSentinel, setUsarSentinel] = React.useState(() => lerSessao('nw-sentinel-autorizado', '0') === '1');
    const [modoLinguagem, setModoLinguagem] = React.useState(() => lerSessao('nw-sentinel-linguagem', 'leiga'));
    const refEntrada = React.useRef(null), refFim = React.useRef(null), refAnalise = React.useRef(analiseId);
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
    React.useEffect(() => { if (refFim.current) refFim.current.scrollIntoView({ block: 'nearest' }); }, [msgs, ocupado]);
    // outra análise aberta: a conversa anterior falava de outros dados e sairia no histórico; começa do zero
    React.useEffect(() => {
      if (refAnalise.current === analiseId) return;
      refAnalise.current = analiseId;
      setTrocou(msgs.length > 0); setMsgs([]);
      setTexto('');
    }, [analiseId]);
    const autorizar = v => { setUsarSentinel(v); gravarSessao('nw-sentinel-autorizado', v ? '1' : '0'); };
    const linguagem = v => { setModoLinguagem(v); gravarSessao('nw-sentinel-linguagem', v); };
    const perguntar = async p => {
      p = (p || '').trim();
      if (!p || ocupado) return;
      const daAnalise = analiseId;
      setTexto(''); setOcupado(true); setTrocou(false);
      const historico = ativo ? msgs.filter(m => m.texto).slice(-10).map(m => ({ role: m.de === 'voce' ? 'user' : 'assistant', content: m.texto })) : [];
      setMsgs(m => m.concat([{ de: 'voce', texto: p }]));
      try {
        const r = await api('/assistente', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          pergunta: p, analise_id: analiseId || '', filtros, transacao_id: transacaoId || null,
          usar_sentinel: usarSentinel, modo_linguagem: modoLinguagem, historico }) });
        if (r.conexao) setConexao(r.conexao);
        // resposta sobre uma análise que já foi fechada: não entra na conversa nova
        if (refAnalise.current === daAnalise) setMsgs(m => m.concat([{ de: 'assistente', texto: r.resposta, titulo: r.titulo, base: r.base, modo: r.modo, motor: r.motor, aviso: r.aviso,
          falha: r.sentinel_falha || null, pergunta: r.pergunta_preservada || p, tipo: r.tipo }]));
      } catch (e) { if (refAnalise.current === daAnalise) setMsgs(m => m.concat([{ de: 'assistente', texto: (e.erro || 'Erro') + ' ' + (e.acao || ''), base: [], modo: 'erro',
        falha: { tentar_de_novo: true }, pergunta: p }])); }
      setOcupado(false);
    };
    const SUGESTOES = sugestoesDe(vista, manifesto, transacaoId);
    const idTx = transacaoId ? f.idExibicao(transacaoId, total) : '';
    const tela = naTelaAgora(vista, manifesto, visao, grafo);
    return h('div', { className: 'assistente' },
      aberto ? h('section', { className: 'painel', id: 'assistente-painel', 'aria-labelledby': 'assistente-t', 'aria-busy': ocupado },
        h('div', { className: 'assistente-topo' },
          h('div', { className: 'assistente-cabeca' },
            h('span', { className: 'assistente-emblema' + (ocupado ? ' ocupado' : ''), 'aria-hidden': 'true' }, h(Icone, { nome: 'assistente' })),
            h('div', { className: 'assistente-titulos' },
              h('h2', { id: 'assistente-t', style: { fontSize: '1rem' } }, 'Assistente de dúvidas'),
              h('p', { className: 'legenda', role: 'status' }, ativo
                ? 'Tecnologia Sentinel AI, com o contexto desta análise (' + sent.provedor + ', ' + sent.modelo + '). Não conclui se houve fraude ou lavagem.'
                : 'Tecnologia Sentinel AI, em modo local, sem serviço externo. Não conclui se houve fraude ou lavagem.')),
            h('button', { type: 'button', className: 'botao pequeno fantasma', onClick: () => setAberto(false) }, 'Recolher')),
          h(ContextoAssistente, { analiseId, filtros, vista, visao, grafo, idTx, aoLimparTransacao }),
          tela.length ? h('section', { className: 'na-tela', 'aria-labelledby': 'na-tela-t' },
            h('div', { className: 'na-tela-cabeca' },
              h('h3', { id: 'na-tela-t' }, h('span', { className: 'na-tela-sinal', 'aria-hidden': 'true' }), 'Na tela agora'),
              h('button', { type: 'button', className: 'botao texto', 'aria-expanded': verTela, 'aria-controls': 'na-tela-lista', onClick: () => setVerTela(!verTela) }, verTela ? 'Ocultar' : 'Mostrar')),
            verTela ? h(React.Fragment, null,
              h('ul', { id: 'na-tela-lista' }, tela.map((it, i) => h('li', { key: vista + i, className: it.tom || '', style: { '--i': i } }, it.texto))),
              h('p', { className: 'na-tela-nota' }, 'Calculado pela tela com os dados já carregados; não é resposta do assistente.')) : null) : null,
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
                h('option', { value: 'leiga' }, 'Simples'), h('option', { value: 'tecnica' }, 'Técnica'))))),
        h('div', { className: 'mensagens', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversa com o assistente' },
          msgs.length ? msgs.map((m, i) => h('div', { key: i, className: 'msg ' + (m.de === 'voce' ? 'pergunta' : (m.modo === 'sentinel' ? 'sentinel' : m.modo === 'erro' ? 'falhou' : 'resposta')) },
            h('span', { className: 'sr' }, m.de === 'voce' ? 'Você: ' : 'Assistente: '), m.titulo ? h('strong', { className: 'msg-titulo' }, m.titulo + '. ') : null,
            m.de === 'voce' ? m.texto : h(TextoRico, { texto: m.texto }),
            m.de === 'assistente' && m.aviso ? h('div', { className: 'base aviso-msg' }, '⚠ ' + m.aviso) : null,
            m.de === 'assistente' ? h('div', { className: 'base' }, (m.motor ? 'Motor: ' + m.motor + '. ' : '') + 'Base: ' + (m.base && m.base.length ? m.base.join('; ')
              : m.falha || m.modo === 'erro' ? 'nenhuma (o Sentinel AI não respondeu; não é pergunta fora da base)' : 'nenhuma (pergunta fora da base)')) : null,
            m.de === 'assistente' && m.falha && m.falha.tentar_de_novo && m.pergunta ? h('button', { type: 'button', className: 'botao pequeno', style: { marginTop: 6 },
              onClick: () => perguntar(m.pergunta), disabled: ocupado }, 'Tentar de novo') : null)) :
            h('div', { className: 'assistente-vazio' },
              trocou ? h('p', { className: 'legenda', role: 'status' }, 'Outra análise foi aberta: a conversa anterior foi apagada.') : null,
              h(Legenda, null, transacaoId ? 'Pergunte sobre a transação ' + idTx + ': por que ela tem esse score, o que significam os motivos, o que dá para concluir.'
                : 'Pergunte sobre termos da tela, como usar o painel ou o que a análise aberta encontrou.')),
          ocupado ? h('div', { className: 'msg digitando', role: 'status' },
            h('span', { className: 'pontos', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
            h('span', null, ativo ? 'O Sentinel AI está analisando o contexto…' : 'Consultando…')) : null,
          h('div', { ref: refFim })),
        h('div', { className: 'linha assistente-sugestoes', role: 'group', 'aria-label': 'Perguntas sugeridas' },
          SUGESTOES.map(s => h('button', { key: s, type: 'button', className: 'botao pequeno sugestao', onClick: () => perguntar(s), disabled: ocupado }, s))),
        h('form', { className: 'linha assistente-form', onSubmit: e => { e.preventDefault(); perguntar(texto); } },
          h('label', { htmlFor: 'assistente-p', className: 'sr' }, 'Sua pergunta'),
          h('input', { id: 'assistente-p', type: 'text', ref: refEntrada, value: texto, maxLength: 300, onChange: e => setTexto(e.target.value), placeholder: 'Escreva a pergunta', style: { flex: 1, width: 'auto' } }),
          h('button', { type: 'submit', className: 'botao primario', disabled: ocupado || !texto.trim() }, 'Perguntar'))) : null,
      h('button', { type: 'button', className: 'botao abrir' + (ocupado ? ' ocupado' : ''), 'aria-expanded': aberto, 'aria-controls': 'assistente-painel', onClick: () => setAberto(!aberto) }, h(Icone, { nome: 'assistente' }), aberto ? h(React.Fragment, null, h('span', { className: 'rotulo-longo' }, 'Recolher assistente'), h('span', { className: 'rotulo-curto' }, 'Recolher')) : h(React.Fragment, null, h('span', { className: 'rotulo-longo' }, 'Assistente de dúvidas'), h('span', { className: 'rotulo-curto' }, 'Dúvidas'))));
  }

  /* ── Contexto do assistente (só leitura de dados já carregados; nada é pedido de novo ao servidor) ── */
  const VISTA_ASSISTENTE = { analise: 'Análise', visao: 'Visão geral', investigacao: 'Investigação', transacoes: 'Transações', detalhes: 'Detalhes' };
  const cargaPronta = c => !!(c && c.dados && !c.carregando && !c.erro);
  const filtrosAtivosDe = filtros => Object.entries(filtros || {}).filter(([k, v]) => !f.vazio(v) && !(k === 'alerta' && v === 'todos'));
  const valorFiltro = (k, v) => k === 'alerta' ? (v === 'sim' ? 'com alerta' : 'sem alerta') : (k === 'de' || k === 'ate') ? f.dataHora(v) : String(v);
  // conta em foco válida: só na Investigação, com o grafo carregado (sem_foco e ambiguo não têm conta)
  const focoDoGrafo = (vista, grafo) => vista === 'investigacao' && cargaPronta(grafo) && grafo.dados.foco && !grafo.dados.sem_foco && !grafo.dados.ambiguo ? grafo.dados : null;

  /* Barra de contexto: "Vai com a pergunta" (o que o pedido leva de fato) e "Só na tela" (o servidor não recebe). */
  function ContextoAssistente({ analiseId, filtros, vista, visao, grafo, idTx, aoLimparTransacao }) {
    const ativos = filtrosAtivosDe(filtros);
    const v = cargaPronta(visao) ? visao.dados : null;
    const g = focoDoGrafo(vista, grafo);
    const listaFiltros = ativos.map(([k, val]) => (ROTULO_FILTRO[k] || k) + ': ' + valorFiltro(k, val)).join('; ');
    const enviados = analiseId ? [
      h('span', { key: 'f', className: 'ctx-chip enviado', title: ativos.length ? 'Filtros aplicados: ' + listaFiltros : 'Nenhum filtro aplicado' },
        ativos.length ? h(React.Fragment, null, h('strong', null, f.inteiro(ativos.length)), ativos.length === 1 ? ' filtro' : ' filtros') : 'Dataset inteiro'),
      v ? h('span', { key: 'r', className: 'ctx-chip enviado', title: 'Transações pontuadas que passam pelos filtros aplicados' },
        'Recorte: ', h('strong', { key: v.registros.recorte, className: 'ctx-valor' }, f.inteiro(v.registros.recorte)), v.registros.recorte === 1 ? ' transação' : ' transações') : null,
      idTx ? h('span', { key: 't', className: 'ctx-chip enviado tx' }, 'Transação ', h('strong', { className: 'mono' }, idTx),
        h('button', { type: 'button', className: 'botao texto', onClick: aoLimparTransacao, 'aria-label': 'Tirar a transação ' + idTx + ' do contexto' }, 'remover')) : null]
      : [h('span', { key: 'p', className: 'ctx-chip enviado vazio-ctx' }, 'Só a pergunta (nenhuma análise aberta)')];
    return h('div', { className: 'assistente-contexto', role: 'group', 'aria-label': 'Contexto do assistente' },
      h('div', { className: 'ctx-linha' },
        h('span', { className: 'ctx-rotulo enviado' }, 'Vai com a pergunta'), enviados),
      h('div', { className: 'ctx-linha' },
        h('span', { className: 'ctx-rotulo tela' }, 'Só na tela'),
        h('span', { className: 'ctx-chip tela' }, 'Vista: ', h('strong', null, VISTA_ASSISTENTE[vista] || '—')),
        g ? h('span', { className: 'ctx-chip tela', title: g.escolha && g.escolha !== 'conta selecionada'
          ? 'Escolhida pelo ' + g.escolha + '; o assistente recebe a conta só como esse filtro.'
          : 'O assistente não sabe qual conta está em foco.' }, 'Conta em foco: ', h('strong', { className: 'mono' }, g.foco)) : null));
  }

  /* Perguntas sugeridas por vista. Todas foram conferidas no modo local (src/painel/assistente.py) e têm resposta
     com base verificável; com uma transação em contexto, as perguntas são sobre ela. */
  const SUGESTOES_VISTA = {
    analise: ['Como enviar um dataset?', 'Como reabrir uma análise?', 'O que é uma análise parcial?', 'O que é o score?'],
    visao: ['Resuma o recorte', 'Quantos alertas há no recorte?', 'Qual o score mediano do recorte?', 'O que significam as faixas?', 'Quais formatos de pagamento aparecem?', 'Qual é o período do recorte?'],
    investigacao: ['Quais contas concentram mais alertas?', 'O que é um vértice?', 'O que significa a seta?', 'Como ver grafo de uma conta?'],
    transacoes: ['O que é o ID de exibição?', 'O que é a posição na tabela?', 'Como mostrar mais colunas?', 'Como os filtros funcionam?'],
    detalhes: ['O que significam as faixas?', 'O que é o limiar?', 'O que significa histórico incompleto?', 'O que são motivos verificáveis?'],
  };
  const SUGESTOES_TRANSACAO = ['Por que esta transação foi classificada assim?', 'Quais características influenciaram essa classificação?', 'O que significa o score desta transação?'];
  function sugestoesDe(vista, manifesto, transacaoId) {
    if (transacaoId) return SUGESTOES_TRANSACAO;
    const daVista = SUGESTOES_VISTA[vista] || SUGESTOES_VISTA.analise;
    if (vista !== 'analise' || !manifesto) return daVista;
    return (manifesto.status === 'em_andamento' ? ['Qual a situação da análise?', 'Como cancelar a análise?']
      : ['Qual a situação da análise?', 'Qual é o modelo e o limiar?']).concat(daVista);
  }

  /* "Na tela agora": até 3 frases determinísticas por vista, só com campos já carregados (manifesto, /visao, /grafo).
     Some enquanto a vista recarrega ou com erro. Contas: contagens de transações (não há score por conta); moedas e
     contagens de contas nunca são somadas; tipologias são registradas no dataset. */
  const fraseRecorte = v => v.registros.recorte
    ? frase(h('strong', null, f.inteiro(v.registros.recorte)), ' de ' + f.inteiro(v.registros.dataset) + ' transações pontuadas estão no recorte; ',
      h('strong', null, f.inteiro(v.alertas.n)), ' com alerta (score 701 ou mais, ' + f.pct(v.alertas.proporcao, 1) + ').')
    : 'Nenhuma transação no recorte com os filtros aplicados.';
  const fraseHistorico = m => {
    const n = m && m.contagens && m.contagens.historico_incompleto;
    return n ? { tom: 'atencao', texto: frase(h('strong', null, f.inteiro(n)), (n === 1 ? ' transação pontuada' : ' transações pontuadas') + ' com menos de 72 h de histórico (dataset inteiro); isso tende a baixar o score.') } : null;
  };
  function naTelaAgora(vista, manifesto, visao, grafo) {
    const v = cargaPronta(visao) ? visao.dados : null;
    const itens = [];
    if (manifesto && manifesto.resultados && manifesto.resultados.parciais) itens.push({ tom: 'atencao', texto: 'Resultado parcial: a análise foi interrompida e os números cobrem só as transações pontuadas.' });
    if (vista === 'analise') {
      if (!manifesto || !manifesto.contagens) return [];
      const c = manifesto.contagens;
      if (manifesto.status === 'em_andamento' && manifesto.etapas) {
        const a = andamentoAnalise(manifesto);
        itens.push({ tom: 'acao', texto: frase('Em andamento: ', h('strong', null, a.rotulo), ' (' + f.pct(a.geral, 0) + ' das etapas).') });
      }
      if (c.pontuadas) itens.push({ tom: c.alertas ? 'alerta' : 'ok', texto: frase(h('strong', null, f.inteiro(c.pontuadas)), ' transações pontuadas; ',
        h('strong', null, f.inteiro(c.alertas || 0)), ' com alerta, sinal para investigação, não confirmação.') });
      itens.push(fraseHistorico(manifesto));
    } else if (vista === 'detalhes') {
      const mod = manifesto && manifesto.modelo;
      if (mod && !f.vazio(mod.limiar_alerta)) itens.push({ tom: '', texto: frase('Modelo ', h('strong', null, mod.versao), ': alerta a partir do score 701 (limiar ' + f.numero(mod.limiar_alerta, 4) + ' no score bruto).') });
      if (v) itens.push({ tom: v.alertas.n ? 'alerta' : 'ok', texto: fraseRecorte(v) });
      itens.push(fraseHistorico(manifesto));
    } else {
      if (!v || (vista === 'investigacao' && (!grafo || grafo.carregando || grafo.erro))) return [];
      const g = focoDoGrafo(vista, grafo);
      if (vista === 'investigacao' && g) {
        const lista = (v.contas_risco && v.contas_risco.contas) || [];
        const pos = lista.findIndex(c => c.conta === g.foco), c = lista[pos], no = g.nos.find(n => n.tipo === 'foco');
        if (c) itens.push({ tom: 'alerta', texto: frase('A conta ', h('strong', { className: 'mono' }, g.foco), ' participa de ', h('strong', null, f.plural(c.alertas, 'transação com alerta', 'transações com alerta')),
          ' no recorte (' + f.inteiro(c.alertas_como_origem) + ' como origem, ' + f.inteiro(c.alertas_como_destino) + ' como destino); maior score entre elas: ' + c.maior_score + '. É a ' + (pos + 1) + 'ª das contas prioritárias.') });
        else if (no) itens.push({ tom: no.alertas_relacionados ? 'alerta' : 'ok', texto: no.alertas_relacionados
          ? frase('A conta ', h('strong', { className: 'mono' }, g.foco), ' está ligada a ', h('strong', null, f.plural(no.alertas_relacionados, 'transação com alerta', 'transações com alerta')), ' no grafo (sem os filtros de conta).')
          : frase('Nenhuma transação da conta ', h('strong', { className: 'mono' }, g.foco), ' tem alerta no grafo (sem os filtros de conta).') });
        const t = g.totais;
        itens.push({ tom: t.alertas_relacionadas ? 'alerta' : '', texto: frase(h('strong', null, f.inteiro(t.relacionadas)), ' transações relacionadas até ' + f.plural(g.limites.profundidade, 'salto', 'saltos') + '; ',
          h('strong', null, f.inteiro(t.alertas_relacionadas)), ' com alerta' + (g.limites.fronteira_truncada ? ' (totais parciais: limite de exploração atingido).' : '.')) });
      } else {
        itens.push({ tom: v.alertas.n ? 'alerta' : 'ok', texto: fraseRecorte(v) });
        if (vista === 'investigacao' && grafo.dados && grafo.dados.sem_foco) itens.push({ tom: '', texto: 'Nenhuma conta em foco: escolha uma em Contas prioritárias para ver o grafo.' });
      }
      if (vista === 'visao') {
        const vm = v.valor_minimo;
        if (vm && !f.vazio(vm.aplicado) && vm.fora) itens.push({ tom: 'atencao', texto: frase('Valor mínimo ' + f.valor(vm.aplicado) + ': ', h('strong', null, f.inteiro(vm.fora)),
          ' transações ficam fora (' + f.inteiro(vm.alertas_fora || 0) + ' com alerta), comparadas na moeda de cada uma' + (vm.por_moeda && vm.por_moeda.length ? '; mais afetada: ' + vm.por_moeda[0].moeda : '') + '.') });
        const tip = v.tipologias && v.tipologias.disponivel ? v.tipologias.itens.filter(t => t.tipologia !== 'padrao_nao_identificado' && t.alertas > 0).sort((a, b) => b.alertas - a.alertas)[0] : null;
        if (tip) itens.push({ tom: '', texto: frase(h('strong', null, tip.tipologia), ': ' + f.inteiro(tip.n) + ' no recorte, ' + f.inteiro(tip.alertas) + ' com alerta (registrada no dataset, não prevista).') });
      } else if (vista === 'transacoes') {
        if (v.periodo) itens.push({ tom: '', texto: 'Período do recorte: ' + f.dataHora(v.periodo.inicio) + ' a ' + f.dataHora(v.periodo.fim) + ' (horário do dataset).' });
        const fmt = v.formatos && v.formatos.itens[0];
        if (fmt) itens.push({ tom: '', texto: frase('Formato mais frequente: ', h('strong', null, fmt.formato), ' (' + f.pct(fmt.proporcao, 1) + ' do recorte).') });
      }
    }
    return itens.filter(Boolean).slice(0, 3);
  }

  Object.assign(window.NW, { SecaoDataset, SecaoFiltros, SecaoVisao, SecaoInvestigacao, SecaoTabela, SecaoDetalhes, DialogoDetalhes, PainelLateral, DialogoLegenda, Assistente, NOME_STATUS, TOM_STATUS, andamentoAnalise });
})();
