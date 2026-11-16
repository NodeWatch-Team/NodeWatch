/* NodeWatch — painel do analista: estado da página, navegação por vistas e fluxo principal.
   Abrir a página só consulta o servidor e abre a sessão da interface; nenhuma análise começa sem o clique em Analisar.
   Estrutura: navegação lateral (vistas) + topo com o contexto da análise aberta + uma vista por vez no <main>.
   Os dados de todas as vistas de resultado são carregados juntos (mesmo recorte), então trocar de vista é imediato. */
(function () {
  'use strict';
  const { h, f, api, consulta, useCarga, useIntervalo, useSessao, sessao, FILTROS_VAZIOS, Icone, Rede, Erro, Carregando, Vazio, Selo,
    SecaoDataset, SecaoFiltros, SecaoVisao, SecaoInvestigacao, SecaoTabela, SecaoDetalhes, DialogoDetalhes, PainelLateral, DialogoLegenda, Assistente,
    NOME_STATUS, TOM_STATUS } = window.NW;

  const TABELA_PADRAO = { pagina: 1, tamanho: 50, ordenar: 'id_exibicao', direcao: 'asc' };
  /* Filtros iniciais: o valor mínimo começa em 1 unidade da moeda de cada transação (sem conversão entre moedas).
     A visão geral informa quantas transações ficam fora por causa dele; apagar o campo inclui as de valor menor. */
  const filtrosIniciais = est => Object.assign({}, FILTROS_VAZIOS, { valor_min: String((est && est.valor_minimo_padrao) || 1) });
  /* O endereço guarda a análise aberta, a conta em foco e a vista (#analise=…&conta=…&vista=…), para recarregar ou compartilhar a tela. */
  const analiseDoEndereco = () => { const m = /analise=([\w-]+)/.exec(location.hash); return m ? m[1] : ''; };
  const contaDoEndereco = () => { const m = /conta=([^&]+)/.exec(location.hash); try { return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; } };
  const vistaDoEndereco = () => { const m = /vista=(\w+)/.exec(location.hash); return m ? m[1] : ''; };
  const irPara = id => { const el = document.getElementById(id); if (el) { el.scrollIntoView({ block: 'start' }); const t = document.getElementById(id + '-t'); if (t) { t.tabIndex = -1; t.focus({ preventScroll: true }); } } };

  /* Vistas da navegação. As de resultado só ficam disponíveis com resultados gravados. */
  const VISTAS = [
    { id: 'analise', nome: 'Análise', icone: 'analisar', grupo: 'Fluxo', dica: 'Dataset, execução e análises recentes' },
    { id: 'visao', nome: 'Visão geral', icone: 'painel', grupo: 'Resultados', resultados: true, dica: 'Indicadores do recorte, faixas do score e prioridades' },
    { id: 'investigacao', nome: 'Investigação', icone: 'grafo', grupo: 'Resultados', resultados: true, dica: 'Contas de maior risco e grafo de transações' },
    { id: 'transacoes', nome: 'Transações', icone: 'tabela', grupo: 'Resultados', resultados: true, dica: 'Registros de transação, com detalhes por linha' },
    { id: 'detalhes', nome: 'Detalhes', icone: 'detalhes', grupo: 'Resultados', dica: 'Interpretação do score e definições dos indicadores' },
  ];
  const NOME_VISTA = Object.fromEntries(VISTAS.map(v => [v.id, v.nome]));

  /* Situação da sessão da interface: ponto + rótulo curto (nunca só a cor); a explicação fica na dica. */
  function SeloSessao() {
    const s = useSessao();
    const janela = s.politica ? Math.round(s.politica.ttl_s) : null;
    const dica = janela ? 'Enviar, validar e analisar exigem a sessão desta página. Sem sinal da aba por ' + janela + ' s, ela expira e a análise para num ponto seguro.' : '';
    const [tom, texto, longo] = s.estado === 'ativa' ? ['ok', 'Sessão', 'Sessão ativa']
      : s.estado === 'sem_servidor' ? ['alerta', 'Offline', '⚠ Sem conexão com o servidor']
        : ['atencao', 'Sessão', s.estado === 'expirada' ? 'Sessão expirada: abrindo outra…' : 'Abrindo a sessão…'];
    return h('span', { role: 'status', className: 'estado ' + tom + ' dica-abaixo dica-esquerda', 'data-dica': longo + (dica ? '. ' + dica : ''), tabIndex: 0 },
      h('span', { className: 'rotulo-estado', 'aria-hidden': 'true' }, texto), h('span', { className: 'sr' }, longo));
  }

  /* Navegação lateral: vistas agrupadas, contadores reais (alertas da análise aberta) e atalhos do sistema.
     Recolhível (só ícones, com o nome na dica e no nome acessível); a escolha fica guardada neste navegador. */
  function Navegacao({ vista, aoVista, temResultados, emAndamento, manifesto, aberta, aoFechar, lateral, aoLateral, aoLegenda, estado, recolhida, aoRecolher }) {
    const grupos = [];
    VISTAS.forEach(v => { let g = grupos.find(x => x.nome === v.grupo); if (!g) { g = { nome: v.grupo, itens: [] }; grupos.push(g); } g.itens.push(v); });
    const alertas = manifesto && manifesto.resultados && manifesto.resultados.disponiveis ? manifesto.contagens.alertas : null;
    const item = v => {
      const indisponivel = v.resultados && !temResultados;
      const atual = vista === v.id;
      return h('li', { key: v.id }, h('button', { type: 'button', className: 'nav-item', 'aria-current': atual ? 'page' : undefined,
        'aria-disabled': indisponivel ? 'true' : undefined, 'data-dica-nav': v.nome,
        title: indisponivel ? (emAndamento ? 'Disponível quando a análise terminar' : 'Abra ou conclua uma análise para ver os resultados') : undefined,
        'aria-describedby': 'nav-dica-' + v.id,
        onClick: () => { if (!indisponivel) { aoVista(v.id); aoFechar(); } } },
        h(Icone, { nome: v.icone }), h('span', { className: 'rotulo-nav' }, v.nome), h('span', { className: 'sr', id: 'nav-dica-' + v.id }, indisponivel ? (emAndamento ? 'Disponível quando a análise terminar.' : 'Disponível com uma análise concluída.') : v.dica + '.'),
        v.id === 'analise' && emAndamento ? h('span', { className: 'pulso', 'aria-label': 'análise em andamento', role: 'img' }) : null,
        v.id === 'transacoes' && !f.vazio(alertas) ? h('span', { className: 'contador' + (alertas ? ' alerta' : ''), 'aria-label': f.plural(alertas, 'alerta', 'alertas') }, f.inteiro(alertas)) : null));
    };
    return h(React.Fragment, null,
      h('div', { className: 'nav-fundo' + (aberta ? ' aberta' : ''), onClick: aoFechar, 'aria-hidden': 'true' }),
      h('nav', { id: 'navegacao', className: 'navegacao' + (aberta ? ' aberta' : ''), 'aria-label': 'Navegação do painel', onKeyDown: e => { if (e.key === 'Escape') aoFechar(); } },
        h('div', { className: 'marca' },
          h('img', { className: 'logo', src: 'assets/nodewatch-logo.png', alt: 'NodeWatch', width: 146, height: 40 }),
          h('img', { className: 'logo-simbolo', src: 'assets/nodewatch-simbolo.png', alt: recolhida ? 'NodeWatch' : '', width: 34, height: 34 })),
        grupos.map(g => h('div', { key: g.nome, className: 'nav-grupo' }, h('span', { className: 'eyebrow', 'aria-hidden': 'true' }, g.nome), h('ul', { 'aria-label': g.nome }, g.itens.map(item)))),
        h('div', { className: 'nav-grupo' }, h('span', { className: 'eyebrow', 'aria-hidden': 'true' }, 'Sistema'),
          h('ul', { 'aria-label': 'Sistema' },
            h('li', null, h('button', { type: 'button', id: 'nav-operacao', className: 'nav-item', 'aria-expanded': lateral, 'aria-controls': 'painel-operacional', 'data-dica-nav': 'Operação',
              onClick: () => { aoLateral(!lateral); aoFechar(); } },
              h(Icone, { nome: 'operacao' }), h('span', { className: 'rotulo-nav' }, 'Operação'))),
            h('li', null, h('button', { type: 'button', className: 'nav-item', 'aria-haspopup': 'dialog', 'data-dica-nav': 'Legenda', onClick: () => { aoLegenda(); aoFechar(); } },
              h(Icone, { nome: 'legenda' }), h('span', { className: 'rotulo-nav' }, 'Legenda'))))),
        h('div', { className: 'rodape' },
          h('button', { type: 'button', className: 'nav-item nav-alternar', 'aria-pressed': !!recolhida, 'data-dica-nav': 'Expandir menu', onClick: aoRecolher },
            h(Icone, { nome: 'recolher' }), h('span', { className: 'rotulo-nav' }, recolhida ? 'Expandir menu' : 'Recolher menu')),
          estado && estado.modelo && estado.modelo.disponivel ? h('div', { className: 'modelo mono', title: 'Modelo salvo usado na pontuação: ' + estado.modelo.versao },
            h('span', null, estado.modelo.versao)) : null)));
  }

  function App() {
    const [versaoEstado, setVersaoEstado] = React.useState(0);
    const estado = useCarga('/estado', versaoEstado);
    const [datasets, setDatasets] = React.useState([]);
    const [datasetId, setDatasetId] = React.useState('');
    const [dataset, setDataset] = React.useState(null);
    const [analises, setAnalises] = React.useState({ analises: [], retencao: { leitura: '' } });
    const [analiseId, setAnaliseId] = React.useState(analiseDoEndereco);
    const [manifesto, setManifesto] = React.useState(null);
    const [erroAnalise, setErroAnalise] = React.useState(null);
    const [rascunho, setRascunho] = React.useState(() => filtrosIniciais(null));
    const [aplicados, setAplicados] = React.useState(() => filtrosIniciais(null));
    const [tabela, setTabela] = React.useState(TABELA_PADRAO);
    const [focoPedido, setFocoPedido] = React.useState(contaDoEndereco);
    const [profundidade, setProfundidade] = React.useState(2);
    const [detalheId, setDetalheId] = React.useState(null);
    // transação levada ao Assistente de dúvidas (botão nos detalhes) e pedido para abri-lo
    const [txAssistente, setTxAssistente] = React.useState(null);
    const [pedidoAssistente, setPedidoAssistente] = React.useState(0);
    const [lateral, setLateral] = React.useState(false);
    const [legenda, setLegenda] = React.useState(false);
    const [navAberta, setNavAberta] = React.useState(false);
    // menu lateral recolhido (só ícones): preferência deste navegador
    const [navRecolhida, setNavRecolhida] = React.useState(() => { try { return localStorage.getItem('nw.nav') === 'recolhida'; } catch (e) { return false; } });
    const recolher = () => setNavRecolhida(r => { try { localStorage.setItem('nw.nav', r ? 'aberta' : 'recolhida'); } catch (e) { /* sem armazenamento local */ } return !r; });
    // vista pedida pelo analista (ou pelo endereço); vazia = a padrão (visão geral com resultados, análise sem)
    const [vistaPedida, setVistaPedida] = React.useState(vistaDoEndereco);
    const iniciais = filtrosIniciais(estado.dados);

    const carregarDatasets = () => api('/datasets').then(d => setDatasets(d.datasets)).catch(() => {});
    const carregarAnalises = () => api('/analises').then(setAnalises).catch(() => {});
    React.useEffect(() => { carregarDatasets(); carregarAnalises(); }, []);

    /* Dataset escolhido: acompanha a validação enquanto ela roda no servidor. */
    const lerDataset = () => { if (!datasetId) return; api('/datasets/' + datasetId).then(setDataset).catch(() => setDataset(null)); };
    React.useEffect(() => { setDataset(null); lerDataset(); }, [datasetId]);
    const validando = !!dataset && dataset.status === 'validando';
    useIntervalo(lerDataset, 700, validando);
    React.useEffect(() => { if (dataset && !validando) carregarDatasets(); }, [validando, dataset && dataset.status]);

    /* Análise aberta: acompanha o manifesto enquanto estiver em andamento (consulta: não inicia nem retoma nada).
       Uma falha de rede passageira durante o acompanhamento não fecha a análise: a próxima leitura tenta de novo. */
    const lerManifesto = () => {
      if (!analiseId) return;
      api('/analises/' + analiseId).then(m => { setManifesto(m); setErroAnalise(null); })
        .catch(e => { if (e && e.rede && manifesto && manifesto.id === analiseId) { setErroAnalise(e); return; } setManifesto(null); setErroAnalise(e); setAnaliseId(''); });
    };
    React.useEffect(() => { setManifesto(null); lerManifesto(); }, [analiseId]);
    const emAndamento = !!manifesto && manifesto.status === 'em_andamento';
    useIntervalo(lerManifesto, 1000, emAndamento);
    React.useEffect(() => { if (manifesto && !emAndamento) { carregarAnalises(); setVersaoEstado(v => v + 1); } }, [emAndamento, manifesto && manifesto.id]);
    /* Ao abrir a página com uma análise já em andamento no servidor, mostra o progresso dela (não inicia nada). */
    React.useEffect(() => { if (!analiseId && estado.dados && estado.dados.analise_em_andamento) setAnaliseId(estado.dados.analise_em_andamento); }, [estado.dados]);

    const temResultados = !!manifesto && !emAndamento && manifesto.resultados.disponiveis;
    const definicao = VISTAS.find(v => v.id === vistaPedida);
    const vista = definicao && (!definicao.resultados || temResultados) ? vistaPedida : (temResultados && !vistaPedida ? 'visao' : (definicao && definicao.id === 'detalhes' ? 'detalhes' : 'analise'));
    React.useEffect(() => { if (analiseId) history.replaceState(null, '', '#analise=' + analiseId + (focoPedido ? '&conta=' + encodeURIComponent(focoPedido) : '') + (vistaPedida ? '&vista=' + vistaPedida : '')); }, [analiseId, focoPedido, vistaPedida]);
    /* Trocar de vista leva o topo da página para o início e o foco para o título da vista (leitores de tela). */
    const mudarVista = v => { setVistaPedida(v); window.scrollTo(0, 0); };

    const reiniciarRecorte = () => { setRascunho(iniciais); setAplicados(iniciais); setTabela(TABELA_PADRAO); setFocoPedido(''); setDetalheId(null); setTxAssistente(null); };
    const analisar = async did => {
      setErroAnalise(null);
      try { const m = await api('/analises', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset_id: did }) });
        reiniciarRecorte(); setManifesto(m); setAnaliseId(m.id); setVistaPedida('analise'); setVersaoEstado(v => v + 1); }
      catch (e) { setErroAnalise(e); }
    };
    const cancelar = () => api('/analises/' + analiseId + '/cancelar', { method: 'POST' }).then(setManifesto).catch(setErroAnalise);
    const assumir = () => api('/analises/' + analiseId + '/assumir', { method: 'POST' }).then(setManifesto).catch(setErroAnalise);
    const abrir = id => { reiniciarRecorte(); setErroAnalise(null); setVistaPedida(''); setAnaliseId(id); };

    const base = temResultados ? '/analises/' + manifesto.id : null;
    const visao = useCarga(base ? base + '/visao' + consulta(aplicados) : null);
    const pagina = useCarga(base ? base + '/transacoes' + consulta(aplicados, tabela) : null);
    const grafo = useCarga(base ? base + '/grafo' + consulta(aplicados, { conta: focoPedido, profundidade }) : null);
    const erroFiltro = [visao.erro, pagina.erro, grafo.erro].find(e => e && e.campo) || null;

    const aplicar = () => {
      if (rascunho.conta_origem !== aplicados.conta_origem || rascunho.conta_destino !== aplicados.conta_destino) setFocoPedido('');
      setAplicados(rascunho); setTabela(Object.assign({}, tabela, { pagina: 1 }));
    };
    const limpar = () => { setRascunho(iniciais); setAplicados(iniciais); setTabela(Object.assign({}, tabela, { pagina: 1 })); setFocoPedido(''); };
    const filtrarTabela = parcial => {
      const novo = Object.assign({}, aplicados, parcial);
      setRascunho(novo); setAplicados(novo); setFocoPedido(''); setTabela(Object.assign({}, tabela, { pagina: 1 }));
      setVistaPedida('transacoes');
      setTimeout(() => irPara('tabela'), 60);
    };
    const focar = conta => { setFocoPedido(conta); setVistaPedida('investigacao'); setTimeout(() => irPara('investigacao'), 60); };

    if (estado.erro && !estado.dados) return h('main', { id: 'conteudo' }, h(Erro, { erro: estado.erro }));
    if (!estado.dados) return h('main', { id: 'conteudo' }, h(Carregando, { texto: 'Abrindo o painel…' }));
    const est = estado.dados;
    const total = manifesto ? manifesto.contagens.pontuadas : 0;
    const recorte = h(SecaoFiltros, { key: 'filtros', rascunho, setRascunho, aplicados, aoAplicar: aplicar, aoLimpar: limpar, moedas: manifesto && manifesto.contagens.moedas || [], erro: erroFiltro });

    let conteudo;
    const abrindoResultados = analiseId && !manifesto && !erroAnalise && definicao && definicao.resultados;
    if (abrindoResultados) {
      conteudo = h(Carregando, { texto: 'Abrindo a análise…' });
    } else if (vista === 'analise') {
      conteudo = h(SecaoDataset, { estado: est, datasets, dataset, datasetId, aoEscolher: (id, forcar) => { if (forcar && id === datasetId) lerDataset(); else setDatasetId(id); }, aoRecarregar: carregarDatasets,
        manifesto, aoAnalisar: analisar, aoCancelar: cancelar, aoAssumir: assumir, analises, aoAbrir: abrir, analiseId: manifesto ? manifesto.id : '', erroAnalise,
        temResultados, aoVerResultados: () => mudarVista('visao') });
    } else if (vista === 'detalhes') {
      conteudo = h(SecaoDetalhes, { estado: est, manifesto, visao: temResultados ? visao : null });
    } else if (vista === 'visao') {
      conteudo = h(React.Fragment, null, recorte, h(SecaoVisao, { carga: visao, manifesto, estado: est, aoVista: mudarVista, aoFocar: focar, aoFiltrarTabela: filtrarTabela }));
    } else if (vista === 'investigacao') {
      conteudo = h(React.Fragment, null, recorte, h(SecaoInvestigacao, { visao, focoPedido, aoFocar: focar, cargaGrafo: grafo, analiseId: manifesto.id, filtros: aplicados, total, profundidade, aoProfundidade: setProfundidade, aoFiltrarTabela: filtrarTabela }));
    } else {
      conteudo = h(React.Fragment, null, recorte, h(SecaoTabela, { carga: pagina, manifesto, tabela, setTabela, aoDetalhe: setDetalheId, selecionada: detalheId }));
    }

    return h(React.Fragment, null,
      /* motivo de rede atrás de tudo: identidade visual, sem dados e sem cliques */
      h('div', { className: 'rede-fundo', 'aria-hidden': 'true' }, h(Rede)),
      h('div', { className: 'app' + (navRecolhida ? ' recolhida' : '') },
      h(Navegacao, { vista, aoVista: mudarVista, temResultados, emAndamento, manifesto, aberta: navAberta, estado: est, recolhida: navRecolhida, aoRecolher: recolher,
        aoFechar: () => setNavAberta(false), lateral, aoLateral: setLateral, aoLegenda: () => setLegenda(true) }),
      h('div', { className: 'coluna' },
        h('header', { className: 'topo' },
          h('button', { type: 'button', className: 'botao hamburguer', 'aria-expanded': navAberta, 'aria-controls': 'navegacao',
            'aria-label': navAberta ? 'Fechar o menu de navegação' : 'Abrir o menu de navegação', onClick: () => setNavAberta(!navAberta) }, h(Icone, { nome: 'menu' })),
          h('div', { className: 'marca' }, h('img', { className: 'logo-simbolo', src: 'assets/nodewatch-simbolo.png', alt: '', width: 28, height: 28 })),
          h('h1', null, h('span', { className: 'nome-vista' }, NOME_VISTA[vista]), h('span', { className: 'eyebrow' }, 'Painel do analista')),
          h('div', { className: 'estado-analise', role: 'status' }, manifesto ? h(React.Fragment, null,
            h(Icone, { nome: 'dataset' }), h('span', { className: 'sr' }, 'Análise aberta: '), h('span', { className: 'nome-ds', title: manifesto.dataset.nome }, manifesto.dataset.nome),
            h('span', { className: 'estado ' + (TOM_STATUS[manifesto.status] || 'acao') }, NOME_STATUS[manifesto.status])) : h('span', { className: 'fraco' }, 'Nenhuma análise aberta')),
          h('div', { className: 'acoes' }, h(SeloSessao),
            h('button', { type: 'button', className: 'botao icone fantasma dica-abaixo dica-esquerda', onClick: () => setLegenda(true), 'aria-haspopup': 'dialog', 'data-dica': 'Legenda geral' },
              h(Icone, { nome: 'legenda' }), h('span', { className: 'rotulo-botao sr' }, 'Legenda')))),
        h(PainelLateral, { aberto: lateral, aoFechar: () => { setLateral(false); const b = document.getElementById('nav-operacao'); if (b && b.offsetParent) b.focus(); }, analiseId: manifesto ? manifesto.id : '' }),
        h('main', { id: 'conteudo' },
          h('div', { key: vista, className: 'vista', 'data-vista': vista }, conteudo),
          temResultados ? h(DialogoDetalhes, { analiseId: manifesto.id, id: detalheId, total, aoFechar: () => setDetalheId(null), aoFiltrarTabela: filtrarTabela, aoFocar: focar,
            aoInterpretar: () => { setDetalheId(null); mudarVista('detalhes'); },
            aoPerguntar: id => { setDetalheId(null); setTxAssistente(id); setPedidoAssistente(n => n + 1); } }) : null))),
      h(DialogoLegenda, { aberto: legenda, aoFechar: () => setLegenda(false), estado: est }),
      /* botão fixo no canto inferior direito, fora do <main> e do topo: não depende da rolagem nem é cortado */
      h(Assistente, { analiseId: manifesto ? manifesto.id : '', filtros: aplicados, estado: est, total,
        transacaoId: manifesto ? txAssistente : null, aoLimparTransacao: () => setTxAssistente(null), pedido: pedidoAssistente }));
  }

  /* "Ir para o conteúdo": leva o foco ao conteúdo sem trocar o endereço (que guarda a análise aberta). */
  const pular = document.querySelector('.pular');
  if (pular) pular.addEventListener('click', ev => { ev.preventDefault(); const m = document.getElementById('conteudo'); if (m) { m.tabIndex = -1; m.focus(); m.scrollIntoView(); } });

  /* Aberto direto do disco (file://), o painel não alcança a API: em vez de "servidor indisponível", diz como abrir. */
  function AbertoComoArquivo() {
    return h('main', { id: 'conteudo' }, h('section', { className: 'secao' }, h('div', { className: 'corpo' },
      h(window.NW.Aviso, { tom: 'atencao', titulo: 'O painel não abre como arquivo do computador' },
        h('p', null, 'Ele precisa do servidor local do NodeWatch. Na pasta do projeto, rode ', h('code', { className: 'mono' }, 'python src/sentinel_ai.py'),
          ' e abra ', h('strong', { className: 'mono' }, 'http://127.0.0.1:5000/'), ' no navegador.')))));
  }

  /* A sessão é aberta (ou renovada, se a aba só foi recarregada) antes de a página aparecer. */
  if (location.protocol === 'file:') ReactDOM.createRoot(document.getElementById('raiz')).render(h(AbertoComoArquivo));
  else sessao.iniciar().then(() => ReactDOM.createRoot(document.getElementById('raiz')).render(h(App)));
})();
