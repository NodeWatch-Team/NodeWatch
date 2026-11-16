/* NodeWatch — painel do analista: utilidades, sessão da interface, acesso à API e peças pequenas.
   React sem JSX (h = React.createElement); nenhum dado é fixado aqui: tudo vem de /api/painel. */
(function () {
  'use strict';
  const h = React.createElement;
  const API = '/api/painel';

  /* ── Formatação (pt-BR) ───────────────────────────────────────────── */
  const nf = (min, max) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });
  const vazio = v => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));
  const inteiro = v => vazio(v) ? '—' : nf(0, 0).format(v);
  const numero = (v, d) => vazio(v) ? '—' : nf(d === undefined ? 1 : d, d === undefined ? 1 : d).format(v);
  const pct = (v, d) => vazio(v) ? '—' : nf(d === undefined ? 1 : d, d === undefined ? 1 : d).format(v * 100) + '%';
  // Valores monetários: 2 casas; abaixo de 1 unidade, até 6 casas (por exemplo, Bitcoin)
  const valor = v => vazio(v) ? '—' : (Math.abs(v) > 0 && Math.abs(v) < 1 ? nf(2, 6) : nf(2, 2)).format(v);
  // "2022-09-10T05:31" → "10/09/2022 05:31" (horário do dataset, sem conversão de fuso)
  const dataHora = iso => {
    if (!iso) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
    return m ? m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5] : iso;
  };
  const diaHora = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso || ''); return m ? m[3] + '/' + m[2] + ' ' + m[4] + ':' + m[5] : '—'; };
  // Instante do servidor (UTC, com Z) → data e hora locais do navegador
  const instante = iso => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
  };
  const bytes = b => vazio(b) ? '—' : b >= 1e9 ? nf(2, 2).format(b / 1e9) + ' GB' : b >= 1e6 ? nf(1, 1).format(b / 1e6) + ' MB'
    : b >= 1e3 ? nf(0, 0).format(b / 1e3) + ' kB' : b + ' bytes';
  // Memória sempre em GB (10^9 bytes), 2 casas: a unidade não muda entre leituras (0,98 GB → 1,02 GB)
  const gb = b => vazio(b) ? '—' : nf(2, 2).format(b / 1e9) + ' GB';
  const duracao = s => {
    if (vazio(s)) return '—';
    if (s < 60) return nf(0, 1).format(s) + ' s';
    const m = Math.floor(s / 60), r = Math.round(s - m * 60);
    return m < 60 ? m + ' min ' + r + ' s' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  };
  const plural = (n, um, varios) => inteiro(n) + ' ' + (n === 1 ? um : varios);
  const idExibicao = (n, total) => 'TX-' + String(n).padStart(Math.max(6, String(total || 0).length), '0');
  const NOME_FAIXA = { baixa: 'baixa', intermediaria: 'intermediária', alta: 'alta' };

  /* ── O que a tela mostra: ponto único de controle ─────────────────
     false = o item some só da interface (texto, rótulo, coluna, cartão, legenda, aviso, controle, anúncio
     para leitor de tela e title). Coleta, leitura do arquivo, SQLite, manifesto, rotas e campos da API,
     cálculos, logs e testes de backend continuam iguais. Para voltar a mostrar, troque para true. */
  const EXIBIR = Object.freeze({
    rotulo: false,          // rótulo do dataset (Is Laundering / rotulo): resumo, visão, tabela, detalhes, log, legenda
    coluna_rotulo: false,   // a coluna de rótulo em "Colunas reconhecidas" (e no contador)
    base_treino: false,     // marcação "Base usada no treino do modelo" (o cálculo continua na API)
    fuso: false,            // nota de fuso ao lado do período do dataset
  });
  const exibir = chave => EXIBIR[chave] === true;

  /* ── Ícones (SVG embutido; sempre acompanhados de texto) ──────────── */
  const TRACOS = {
    menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
    dataset: ['M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z', 'M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6', 'M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6'],
    enviar: ['M12 16V4', 'M8 8l4-4 4 4', 'M5 20h14'],
    analisar: ['M8 5v14l11-7z'],
    filtro: ['M4 5h16l-6 8v5l-4 2v-7z'],
    visao: ['M5 20V11', 'M12 20V4', 'M19 20v-6', 'M3 20h18'],
    contas: ['M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6', 'M17 11.5a2.5 2.5 0 1 0 0-5', 'M16.5 14.3c2.7.4 4.5 2.6 4.5 5.7'],
    grafo: ['M6 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M18 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M18 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M8.2 10.9l7.6-3.8', 'M8.2 13.1l7.6 3.8'],
    tabela: ['M4 5h16v14H4z', 'M4 10h16', 'M4 14.5h16', 'M10 5v14'],
    alerta: ['M12 4L2.5 20h19z', 'M12 10v5', 'M12 17.6v.4'],
    ok: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M8 12.5l3 3 5-6'],
    info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M12 11v6', 'M12 7.4v.4'],
    legenda: ['M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z', 'M5 17a3 3 0 0 1 3-3h11'],
    assistente: ['M5 5h14v11H10l-5 4z', 'M9 9.5h6', 'M9 12.5h4'],
    relogio: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M12 7v5l3 2'],
    fechar: ['M6 6l12 12', 'M18 6L6 18'],
    historico: ['M4 12a8 8 0 1 0 2.6-5.9', 'M4 4v4h4', 'M12 8v4l3 2'],
    sessao: ['M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z', 'M9 12l2 2 4-4'],
    operacao: ['M3 12h4l2-6 4 12 2-6h6'],
    colunas: ['M4 5h16v14H4z', 'M9 5v14', 'M15 5v14'],
    sequencia: ['M5 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M19 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M7 18h6a3 3 0 0 0 3-3V8'],
    score: ['M4 18a8 8 0 1 1 16 0', 'M12 18l4-6'],
    limpar: ['M5 7h14', 'M9 7V4h6v3', 'M7 7l1 13h8l1-13'],
    detalhes: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 13h6', 'M9 17h4'],
    chevron: ['M9 6l6 6-6 6'],
    mais: ['M12 5v14', 'M5 12h14'],
    menos: ['M5 12h14'],
    ajustar: ['M4 9V5h4', 'M20 9V5h-4', 'M4 15v4h4', 'M20 15v4h-4'],
    seta: ['M5 12h14', 'M13 6l6 6-6 6'],
    painel: ['M4 4h7v7H4z', 'M13 4h7v4h-7z', 'M13 10h7v10h-7z', 'M4 13h7v7H4z'],
    editar: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
    recolher: ['M4 4h16v16H4z', 'M9 4v16', 'M15 10l-2 2 2 2'],
    desfazer: ['M4 9h11a5 5 0 0 1 0 10H8', 'M8 5L4 9l4 4'],
    recentes: ['M12 20V10', 'M18 20V4', 'M6 20v-4'],
  };
  const Icone = ({ nome }) => h('svg', { className: 'ico', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    (TRACOS[nome] || TRACOS.info).map((d, i) => h('path', { key: i, d })));

  /* ── Motivo de rede (identidade visual) ───────────────────────────
     Decoração pura: vértices e conexões em posições fixas (nada é sorteado nem vem dos dados), com alguns nós
     "ativos" que pulsam e conexões com fluxo. Sem cliques e escondido de leitores de tela. */
  const REDE = {
    grande: { caixa: '0 0 1440 900',
      nos: [[120, 90], [300, 160], [210, 320], [460, 80], [620, 220], [520, 380], [780, 120], [900, 300], [1060, 160], [1220, 260], [1340, 110], [980, 470], [700, 520], [380, 560], [140, 520], [1180, 520]],
      arestas: [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [2, 5], [4, 6], [6, 7], [7, 8], [8, 9], [9, 10], [7, 11], [11, 12], [12, 5], [5, 13], [13, 14], [2, 14], [9, 15], [11, 15], [6, 8]],
      ativos: [4, 8, 12], fluxo: [[3, 4], [7, 8], [11, 12]], raio: 3 },
    mini: { caixa: '0 0 120 90',
      nos: [[20, 22], [58, 44], [100, 18], [96, 70], [24, 72], [62, 8]],
      arestas: [[0, 1], [1, 2], [1, 3], [0, 4], [4, 1], [2, 3], [5, 1]],
      ativos: [1], fluxo: [[0, 1], [1, 3]], raio: 4.5 },
  };
  const Rede = ({ mini, className }) => {
    const r = REDE[mini ? 'mini' : 'grande'];
    const ehFluxo = (a, b) => r.fluxo.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    return h('svg', { className: (mini ? 'rede-mini' : 'rede') + (className ? ' ' + className : ''), viewBox: r.caixa, 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: mini ? undefined : 'xMidYMid slice' },
      r.arestas.map(([a, b], i) => h('line', { key: 'a' + i, className: ehFluxo(a, b) ? 'fluxo' : undefined, x1: r.nos[a][0], y1: r.nos[a][1], x2: r.nos[b][0], y2: r.nos[b][1] })),
      r.nos.map(([x, y], i) => h('circle', { key: 'n' + i, className: r.ativos.includes(i) ? 'ativo' : undefined, cx: x, cy: y, r: r.ativos.includes(i) ? r.raio * 1.4 : r.raio })));
  };

  /* ── Sessão da interface ──────────────────────────────────────────
     A página abre uma sessão e a renova com pulsos. Enviar, validar e analisar só funcionam com sessão ativa;
     sem pulso pelo prazo do servidor, a sessão expira e a análise dela para num ponto seguro (não é retomada
     sozinha). A sessão fica em sessionStorage: recarregar a aba mantém a mesma sessão; outra aba tem a sua. */
  const sessao = {
    id: '', estado: 'abrindo', politica: null, expira: null, ouvintes: new Set(), abrindo: null,
    avisar() { this.ouvintes.forEach(f => f()); },
    async abrir() {
      if (this.abrindo) return this.abrindo;
      this.abrindo = (async () => {
        try {
          const r = await fetch(API + '/sessao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rotulo: 'painel do analista' }) });
          const d = await r.json();
          this.id = d.sessao.id; this.politica = d.politica; this.expira = d.sessao.expira_em_utc; this.estado = 'ativa';
          try { sessionStorage.setItem('nw.painel.sessao', this.id); } catch (e) { /* sem armazenamento de sessão */ }
        } catch (e) { this.estado = 'sem_servidor'; }
        this.abrindo = null; this.avisar();
      })();
      return this.abrindo;
    },
    async pulso() {
      if (!this.id) return this.abrir();
      try {
        const r = await fetch(API + '/sessao/pulso', { method: 'POST', headers: { 'X-NodeWatch-Sessao': this.id } });
        if (r.status === 410) { this.id = ''; this.estado = 'expirada'; this.avisar(); return this.abrir(); }
        const d = await r.json();
        this.estado = 'ativa'; this.expira = d.sessao && d.sessao.expira_em_utc;
      } catch (e) { this.estado = 'sem_servidor'; }
      this.avisar();
      return undefined;
    },
    async iniciar() {
      try { this.id = sessionStorage.getItem('nw.painel.sessao') || ''; } catch (e) { this.id = ''; }
      await (this.id ? this.pulso() : this.abrir());
      const ms = Math.max(5, (this.politica && this.politica.pulso_s) || 15) * 1000;
      setInterval(() => this.pulso(), ms);
      // aba em segundo plano: o navegador espaça os temporizadores; ao voltar, renova na hora
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.pulso(); });
      window.addEventListener('online', () => this.pulso());
    },
  };
  function useSessao() {
    const [, atualizar] = React.useState(0);
    React.useEffect(() => { const f = () => atualizar(n => n + 1); sessao.ouvintes.add(f); return () => { sessao.ouvintes.delete(f); }; }, []);
    return sessao;
  }

  /* ── API ─────────────────────────────────────────────────────────── */
  async function api(caminho, opcoes, repetindo) {
    let r;
    const o = Object.assign({}, opcoes || {});
    if (sessao.id) o.headers = Object.assign({}, o.headers || {}, { 'X-NodeWatch-Sessao': sessao.id });
    try { r = await fetch(API + caminho, o); }
    catch (e) {
      throw { erro: 'Servidor do NodeWatch indisponível.', acao: 'Confira se o servidor está em execução (python src/sentinel_ai.py) e recarregue a página.', rede: true };
    }
    let corpo = null;
    try { corpo = await r.json(); } catch (e) { /* resposta sem JSON */ }
    if (r.status === 403 && corpo && corpo.sessao_inativa && !repetindo) {
      await sessao.pulso();            // a sessão expirou: a página abre outra e repete a ação pedida pelo analista
      return api(caminho, opcoes, true);
    }
    if (!r.ok) throw (corpo && corpo.erro) ? corpo : { erro: 'Erro ' + r.status + ' do servidor.', acao: 'Tente de novo.' };
    return corpo;
  }
  const FILTROS_VAZIOS = { de: '', ate: '', moeda: '', alerta: 'todos', valor_min: '', banco_origem: '', banco_destino: '',
    conta_origem: '', conta_destino: '', score_min: '', score_max: '' };
  const consulta = (filtros, extra) => {
    const p = new URLSearchParams();
    Object.entries(filtros || {}).forEach(([k, v]) => { if (!vazio(v) && !(k === 'alerta' && v === 'todos')) p.set(k, String(v).trim()); });
    Object.entries(extra || {}).forEach(([k, v]) => { if (!vazio(v)) p.set(k, String(v)); });
    const s = p.toString();
    return s ? '?' + s : '';
  };

  /* Carrega um recurso e ignora respostas antigas (troca rápida de filtros). */
  function useCarga(caminho, versao) {
    const [estado, setEstado] = React.useState({ dados: null, erro: null, carregando: false });
    React.useEffect(() => {
      if (!caminho) { setEstado({ dados: null, erro: null, carregando: false }); return undefined; }
      let vivo = true;
      setEstado(e => ({ dados: e.dados, erro: null, carregando: true }));
      api(caminho).then(d => { if (vivo) setEstado({ dados: d, erro: null, carregando: false }); })
        .catch(e => { if (vivo) setEstado({ dados: null, erro: e, carregando: false }); });
      return () => { vivo = false; };
    }, [caminho, versao]);
    return estado;
  }
  /* Repete uma função enquanto `ativo` for verdadeiro. */
  function useIntervalo(fn, ms, ativo) {
    const ref = React.useRef(fn);
    ref.current = fn;
    React.useEffect(() => {
      if (!ativo) return undefined;
      const id = setInterval(() => ref.current(), ms);
      return () => clearInterval(id);
    }, [ms, ativo]);
  }

  /* ── Peças ───────────────────────────────────────────────────────── */
  const ICONE_TOM = { erro: 'alerta', atencao: 'alerta', ok: 'ok' };
  const Aviso = ({ tom, titulo, children, vivo, silencioso }) =>
    h('div', { className: 'aviso ' + (tom || ''), role: silencioso ? undefined : tom === 'erro' ? 'alert' : (vivo ? 'status' : undefined) },
      titulo ? h('div', { className: 'titulo' }, h(Icone, { nome: ICONE_TOM[tom] || 'info' }), titulo) : null, children);

  /* Erro de filtro: quem anuncia é a mensagem junto do campo (um alerta só); os blocos das seções ficam silenciosos. */
  const Erro = ({ erro }) => !erro ? null : h(Aviso, { tom: 'erro', titulo: erro.erro || 'Erro', silencioso: !!erro.campo },
    erro.mensagem ? h('p', null, erro.mensagem) : null,
    erro.acao ? h('p', null, h('strong', null, 'O que fazer: '), erro.acao) : null);

  const Carregando = ({ texto }) => h('p', { className: 'suave', role: 'status' }, texto || 'Carregando…');
  /* Esqueleto: forma do conteúdo enquanto ele carrega (o texto para leitor de tela vem junto). */
  const Esqueleto = ({ linhas, altura, texto }) => h('div', { className: 'grade', role: 'status', 'aria-label': texto || 'Carregando…', style: { gap: 10 } },
    Array.from({ length: linhas || 3 }, (_, i) => h('span', { key: i, className: 'esqueleto', 'aria-hidden': 'true', style: { height: altura || 14, width: (100 - (i % 3) * 14) + '%' } })));
  const Vazio = ({ children, compacto }) => h('div', { className: 'vazio' + (compacto ? ' compacto' : '') }, compacto ? null : h(Rede, { mini: true }), children);
  /* Ícone de informação com dica: o texto aparece ao passar o ponteiro ou focar, e é o nome acessível do ícone. */
  const Dica = ({ texto, lado }) => texto ? h('span', { className: 'dica-ico' + (lado ? ' dica-' + lado : ''), tabIndex: 0, role: 'img', 'aria-label': texto, 'data-dica': texto },
    h(Icone, { nome: 'info' })) : null;
  const Legenda = ({ children }) => h('p', { className: 'legenda' }, children);
  const Selo = ({ tom, children, vivo, forma, dica }) => h('span', { className: 'selo ' + (tom || '') + (vivo ? ' vivo' : '') + (forma ? ' forma' : ''), title: dica }, children);

  const Secao = ({ id, titulo, pergunta, children, extra, icone }) =>
    h('section', { className: 'secao', 'aria-labelledby': id + '-t', id },
      h('header', null,
        h('span', { className: 'emblema' }, h(Icone, { nome: icone || 'info' })),
        h('div', { className: 'titulos' }, h('h2', { id: id + '-t' }, titulo), pergunta ? h('p', { className: 'pergunta' }, pergunta) : null),
        extra ? h('div', { className: 'extra' }, extra) : null),
      h('div', { className: 'corpo' }, children));

  const Pares = ({ itens }) => h('dl', { className: 'pares' },
    itens.filter(Boolean).map(([k, v], i) => h(React.Fragment, { key: i }, h('dt', null, k), h('dd', null, vazio(v) ? '—' : v))));

  /* Diálogo nativo: foco preso, Esc fecha, foco volta a quem abriu. */
  const Dialogo = ({ aberto, titulo, aoFechar, children, id }) => {
    const ref = React.useRef(null);
    React.useEffect(() => {
      const d = ref.current;
      if (!d) return;
      if (aberto && !d.open) d.showModal();
      if (!aberto && d.open) d.close();
    }, [aberto]);
    return h('dialog', { ref, id, 'aria-labelledby': id + '-t', onClose: aoFechar, onCancel: aoFechar },
      aberto ? h(React.Fragment, null,
        h('header', null, h('h2', { id: id + '-t' }, titulo),
          h('button', { className: 'botao fantasma', type: 'button', onClick: aoFechar }, h(Icone, { nome: 'fechar' }), 'Fechar')),
        h('div', { className: 'corpo' }, children)) : null);
  };

  const Barra = ({ fracao, alerta, rotulo }) => h('div', { className: 'barra' + (alerta ? ' alerta' : ''), role: 'img', 'aria-label': rotulo },
    h('i', { style: { width: Math.max(0, Math.min(100, (fracao || 0) * 100)) + '%' } }));

  /* Barra de progresso com valor medido (nunca animação sem dado por trás). */
  const BarraProgresso = ({ feito, total, rotulo, texto }) => h('div', { className: 'progresso', role: 'progressbar', 'aria-label': rotulo,
    'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': feito, 'aria-valuetext': texto },
    h('i', { style: { width: (total ? Math.max(0, Math.min(100, 100 * feito / total)) : 0) + '%' } }));

  const SITUACAO_ALERTA = l => l.alerta ? 'Sim (faixa ' + NOME_FAIXA[l.faixa] + ')' : 'Não (faixa ' + NOME_FAIXA[l.faixa] + ')';
  /* Tom visual de cada faixa: verde (baixa), âmbar (intermediária) e vermelho (alta = alerta). Sempre com o nome escrito. */
  const TOM_FAIXA = { baixa: 'ok', intermediaria: 'atencao', alta: 'alerta' };

  /* Medidor do score (0–1000): régua com as três faixas (0–300, 301–700, 701–1000) e um marcador no valor.
     Os cortes são os da API (score.py); o medidor só desenha, não recalcula faixa nem alerta. */
  const MedidorScore = ({ score, faixa, nomeFaixa, alerta }) => h('div', { className: 'medidor ' + (faixa || '') },
    h('div', { className: 'cabeca' },
      h('span', { className: 'valor-score' }, inteiro(score), h('small', null, 'de 1000')),
      h('div', { className: 'linha', style: { paddingBottom: 4 } },
        h(Selo, { tom: TOM_FAIXA[faixa] }, (alerta ? '⚠ ' : '') + 'Faixa ' + (nomeFaixa || NOME_FAIXA[faixa] || '—')),
        h(Selo, { tom: alerta ? 'alerta' : 'neutro' }, alerta ? 'Com alerta' : 'Sem alerta'))),
    h('div', { className: 'regua', role: 'img', 'aria-label': 'Score ' + score + ' na escala de 0 a 1000; faixa ' + (nomeFaixa || NOME_FAIXA[faixa]) + (alerta ? ', com alerta' : ', sem alerta') },
      h('i', { className: 'baixa' }), h('i', { className: 'intermediaria' }), h('i', { className: 'alta' }),
      vazio(score) ? null : h('span', { className: 'marcador', style: { left: Math.max(0, Math.min(100, score / 10)) + '%' } })),
    h('div', { className: 'marcas-regua', 'aria-hidden': 'true' }, h('span', null, '0'), h('span', null, '300'), h('span', null, '700'), h('span', null, '1000')));

  window.NW = { h, api, consulta, useCarga, useIntervalo, useSessao, sessao, FILTROS_VAZIOS, NOME_FAIXA, SITUACAO_ALERTA, TOM_FAIXA, EXIBIR, exibir,
    f: { inteiro, numero, pct, valor, dataHora, diaHora, instante, bytes, gb, duracao, idExibicao, vazio, plural },
    Icone, Rede, Dica, Aviso, Erro, Carregando, Esqueleto, Vazio, Legenda, Selo, Secao, Pares, Dialogo, Barra, BarraProgresso, MedidorScore };
})();
