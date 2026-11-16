/* NodeWatch — área de investigação: grafo de transações da conta em foco (SVG próprio, sem biblioteca).
   O servidor decide o que entra (limites de 30 contas e 60 arestas, totais, tipologia e ordem temporal); aqui só se calculam
   a disposição, o enquadramento e o desenho. Nada do que é desenhado é inventado: agrupar, filtrar e mudar a disposição
   mudam só a apresentação das contas e arestas que vieram da API.
   Por que SVG e não Cytoscape/Sigma: com até 30 vértices e 60 arestas o SVG desenha tudo em menos de 1 ms, mantém cada
   conta e aresta acessível por teclado e leitor de tela e não traz dependência nova; canvas/WebGL só compensariam com
   milhares de elementos. */
(function () {
  'use strict';
  const { h, f, api, consulta, Icone, Dica, Aviso, Legenda, Pares, Selo, Vazio, Erro, Carregando, Esqueleto } = window.NW;
  const RAIO = 17;          // raio de referência de uma conta (px de tela no zoom 100%)
  const ESPACO = 66;        // distância mínima entre contas vizinhas no mesmo arco ou coluna (coordenadas do desenho)
  const MAX_ROTULOS = 16;   // acima disso, os valores nas arestas ficam ocultos por legibilidade
  const ZOOM_MIN = 0.25, ZOOM_MAX = 3;
  const MANTER_VISIVEIS = 8;  // ao agrupar, folhas mais relevantes de cada conjunto que continuam visíveis

  const PAPEL = { foco: 'conta em foco', recebeu: 'recebeu (direta ou indiretamente) da conta em foco',
    enviou: 'enviou (direta ou indiretamente) para a conta em foco', grupo: 'grupo de contas' };
  const PAPEL_CURTO = { foco: 'Conta em foco', recebeu: 'Recebeu', enviou: 'Enviou', grupo: 'Grupo' };

  const DISPOSICOES = [
    { id: 'auto', nome: 'Automática' },
    { id: 'radial', nome: 'Radial' },
    { id: 'camadas', nome: 'Camadas' },
    { id: 'circular', nome: 'Circular' },
    { id: 'forcas', nome: 'Forças' },
  ];
  const DESCRICAO_DISPOSICAO = {
    radial: 'radial: a conta em foco no centro, quem enviou à esquerda, quem recebeu à direita, um anel por salto',
    camadas: 'camadas da esquerda para a direita (quem envia → quem recebe); colunas longas se dividem',
    circular: 'circular: todas as contas num anel, a conta em foco no topo',
    forcas: 'forças: contas ligadas se aproximam e as demais se afastam (cálculo determinístico)',
  };
  const RELACOES = [
    { id: 'tudo', nome: 'Todas' },
    { id: 'alertas', nome: 'Só com alerta' },
    { id: 'entradas', nome: 'Só quem enviou' },
    { id: 'saidas', nome: 'Só quem recebeu' },
  ];

  /* ── utilidades ─────────────────────────────────────────────────────────────────────────────── */
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduzirMovimento = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const suave = t => 1 - Math.pow(1 - t, 3);
  /* Animação por quadros (requestAnimationFrame): devolve a função que cancela. */
  function animar(ms, passo) {
    let id = 0, inicio = 0, vivo = true;
    const quadro = agora => {
      if (!vivo) return;
      if (!inicio) inicio = agora;
      const p = Math.min(1, (agora - inicio) / ms);
      passo(suave(p));
      if (p < 1) id = requestAnimationFrame(quadro);
    };
    id = requestAnimationFrame(quadro);
    return () => { vivo = false; cancelAnimationFrame(id); };
  }
  /* Rótulo curto de uma conta: banco e o fim do número ("213952-…B6F0"); o completo fica na dica e na seleção. */
  const rotuloCurto = id => {
    if (id.length <= 12) return id;
    const i = id.indexOf('-');
    return i > 0 && i < id.length - 5 ? id.slice(0, i + 1) + '…' + id.slice(-4) : id.slice(0, 5) + '…' + id.slice(-4);
  };

  const chaveAresta = a => a.origem + '\u0001' + a.destino + '\u0001' + a.moeda;
  const semOrdem = a => a.ordem === 'sem_ordem' || a.ordem === 'simultanea';
  const rotuloAresta = a => a.grupo ? (a.alerta ? '⚠ ' : '') + f.plural(a.arestas, 'aresta', 'arestas') + ' · ' + f.plural(a.n, 'transação', 'transações')
    : (a.alerta ? '⚠ ' : '') + (a.n > 1 ? f.inteiro(a.n) + ' transações: ' : '') + f.valor(a.total) + ' ' + a.moeda;
  const horarioAresta = a => a.n > 1 && a.primeiro !== a.ultimo ? f.diaHora(a.primeiro) + ' a ' + f.diaHora(a.ultimo) : f.diaHora(a.primeiro);
  const descricaoAresta = a => a.grupo
    ? 'Conexões agrupadas entre ' + a.origem + ' e ' + a.destino + ': ' + f.plural(a.arestas, 'aresta', 'arestas') + ', ' + f.plural(a.n, 'transação', 'transações') +
      (a.alerta ? ', ' + f.inteiro(a.alertas) + ' com alerta' : ', sem alerta') + '. Selecione para expandir o grupo.'
    : 'De ' + a.origem + ' (origem) para ' + a.destino + ' (destino): ' +
      (a.n > 1 ? f.inteiro(a.n) + ' transações agrupadas, total ' : '1 transação de ') + f.valor(a.total) + ' ' + a.moeda +
      ', ' + (a.n > 1 && a.primeiro !== a.ultimo ? 'de ' + f.dataHora(a.primeiro) + ' a ' + f.dataHora(a.ultimo) : 'em ' + f.dataHora(a.primeiro)) +
      (a.alerta ? ', ' + f.inteiro(a.alertas) + ' com alerta' : ', sem alerta') + '. ' + a.ordem_texto + '.';

  const ativar = fn => ({ onClick: fn, onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fn(); } } });

  /* ── filtro visual e agrupamento (só apresentação) ──────────────────────────────────────────── */
  /* Relações mostradas: todas, só arestas com alerta, só o lado de entrada ou só o de saída. A conta em foco fica sempre. */
  function filtrarRelacoes(g, relacao) {
    if (relacao === 'tudo') return { nos: g.nos, arestas: g.arestas };
    let arestas = g.arestas, nos = g.nos;
    if (relacao === 'alertas') arestas = g.arestas.filter(a => a.alerta);
    else {
      const lado = relacao === 'entradas' ? 'enviou' : 'recebeu';
      const ok = new Set(g.nos.filter(n => n.tipo === 'foco' || n.tipo === lado).map(n => n.id));
      arestas = g.arestas.filter(a => ok.has(a.origem) && ok.has(a.destino));
      nos = g.nos.filter(n => ok.has(n.id));
    }
    const usados = new Set([g.foco]);
    arestas.forEach(a => { usados.add(a.origem); usados.add(a.destino); });
    return { nos: nos.filter(n => usados.has(n.id)), arestas };
  }

  /* Folhas (uma única vizinha no desenho) que compartilham a mesma vizinha e o mesmo papel viram um grupo expansível.
     Contas com alerta só se agrupam entre si, e só a partir de 6; as demais a partir de 3. A conta em foco nunca entra. */
  function agrupar(base, ativo, abertos) {
    if (!ativo) return { nos: base.nos, arestas: base.arestas, grupos: {}, membroDe: {} };
    const viz = {}, laco = new Set();
    base.arestas.forEach(a => {
      if (a.origem === a.destino) { laco.add(a.origem); return; }
      (viz[a.origem] = viz[a.origem] || new Set()).add(a.destino);
      (viz[a.destino] = viz[a.destino] || new Set()).add(a.origem);
    });
    const baldes = {};
    base.nos.forEach(n => {
      if (n.tipo === 'foco' || laco.has(n.id) || !viz[n.id] || viz[n.id].size !== 1) return;
      const pai = viz[n.id].values().next().value;
      const chave = pai + '\u0001' + n.tipo + '\u0001' + (n.alerta ? 'a' : 'n');
      (baldes[chave] = baldes[chave] || { pai, papel: n.tipo, alerta: !!n.alerta, nivel: n.nivel, membros: [] }).membros.push(n);
    });
    /* as 8 folhas mais relevantes de cada conjunto continuam visíveis; só o restante vira grupo */
    const peso = {};
    base.arestas.forEach(a => { peso[a.origem] = (peso[a.origem] || 0) + a.n; peso[a.destino] = (peso[a.destino] || 0) + a.n; });
    const grupos = {}, membroDe = {};
    Object.keys(baldes).sort().forEach(chave => {
      const b = baldes[chave];
      const ordem = b.membros.slice().sort((x, y) => ((y.alertas_relacionados || 0) - (x.alertas_relacionados || 0)) || ((peso[y.id] || 0) - (peso[x.id] || 0)) || x.id.localeCompare(y.id));
      b.membros = ordem.slice(MANTER_VISIVEIS);
      if (b.membros.length < (b.alerta ? 4 : 3)) return;
      const id = 'grupo\u0001' + chave;
      if (abertos.has(id)) return;
      grupos[id] = { id, tipo: 'grupo', papel: b.papel, pai: b.pai, nivel: b.nivel, alerta: b.alerta, membros: b.membros,
        alertas_relacionados: Math.max(0, ...b.membros.map(m => m.alertas_relacionados || 0)), /* só para ordenar: contagens de contas nunca são somadas */ rotulo: f.plural(b.membros.length, 'conta', 'contas') };
      b.membros.forEach(m => { membroDe[m.id] = id; });
    });
    if (!Object.keys(grupos).length) return { nos: base.nos, arestas: base.arestas, grupos, membroDe };
    const nos = base.nos.filter(n => !membroDe[n.id]).concat(Object.values(grupos));
    const juntas = {}, arestas = [];
    base.arestas.forEach(a => {
      const o = membroDe[a.origem] || a.origem, d = membroDe[a.destino] || a.destino;
      if (o === a.origem && d === a.destino) { arestas.push(a); return; }
      const k = o + '\u0001' + d;
      const j = juntas[k] = juntas[k] || { grupo: true, origem: o, destino: d, moeda: 'grupo', arestas: 0, n: 0, alertas: 0, alerta: false, maior_score: 0,
        primeiro: a.primeiro, ultimo: a.ultimo, ordens: new Set(), membros: [] };
      j.arestas += 1; j.n += a.n; j.alertas += a.alertas || 0; j.alerta = j.alerta || !!a.alerta; j.maior_score = Math.max(j.maior_score, a.maior_score || 0);
      if (a.primeiro < j.primeiro) j.primeiro = a.primeiro;
      if (a.ultimo > j.ultimo) j.ultimo = a.ultimo;
      j.ordens.add(a.ordem); j.membros.push(chaveAresta(a));
    });
    Object.values(juntas).forEach(j => {
      j.agrupada = true;
      j.ordem = j.ordens.size === 1 ? j.ordens.values().next().value : 'mista';
      j.ordem_texto = j.ordem === 'mista' ? 'ordens no tempo diferentes entre as arestas do grupo' : base.arestas.find(a => chaveAresta(a) === j.membros[0]).ordem_texto;
      arestas.push(j);
    });
    return { nos, arestas, grupos, membroDe };
  }

  /* ── disposições (coordenadas do desenho; a câmera enquadra depois) ─────────────────────────── */
  function ordenarImportancia(lista) {
    return lista.slice().sort((a, b) => (b.alerta - a.alerta) || ((b.alertas_relacionados || 0) - (a.alertas_relacionados || 0)) || a.id.localeCompare(b.id));
  }
  function vizinhanca(arestas) {
    const viz = {};
    arestas.forEach(a => {
      if (a.origem === a.destino) return;
      (viz[a.origem] = viz[a.origem] || []).push(a.destino);
      (viz[a.destino] = viz[a.destino] || []).push(a.origem);
    });
    return viz;
  }

  /* Radial: foco no centro; quem enviou num leque à esquerda, quem recebeu à direita; um anel por salto.
     Anéis lotados se desdobram em dois raios alternados, para manter a distância mínima sem esticar o desenho. */
  function dispRadial(nos, arestas) {
    const pos = {}, foco = nos.find(n => n.tipo === 'foco');
    if (!foco) return dispCamadas(nos);
    pos[foco.id] = { x: 0, y: 0 };
    const viz = vizinhanca(arestas);
    const esq = nos.filter(n => n.nivel < 0), dir = nos.filter(n => n.nivel > 0);
    const outros = nos.filter(n => n.nivel === 0 && n.id !== foco.id);
    const ambos = esq.length && dir.length;
    const vao = ambos ? Math.PI * 0.84 : Math.PI * 1.6;
    const passoMax = 0.6;
    const lados = [{ lista: dir, centro: 0 }, { lista: esq, centro: Math.PI }];
    const angulo = { [foco.id]: null };
    let raioAnterior = 0;
    const profundidade = Math.max(1, ...nos.map(n => Math.abs(n.nivel)));
    for (let na = 1; na <= profundidade; na++) {
      const planos = lados.map(l => ({ centro: l.centro, lista: l.lista.filter(n => Math.abs(n.nivel) === na) })).filter(p => p.lista.length);
      if (!planos.length) continue;
      let raio = raioAnterior ? raioAnterior + 150 : 170, duplo = false;
      planos.forEach(p => {
        const k = p.lista.length;
        p.passo = k > 1 ? Math.min(vao / (k - 1), passoMax) : 0;
        if (k > 1) {
          let precisa = ESPACO / p.passo;
          if (precisa > 360) { p.duplo = true; precisa = Math.max(ESPACO * 0.62 / p.passo, 0); duplo = true; }
          raio = Math.max(raio, precisa);
        }
      });
      planos.forEach(p => {
        let ordem;
        if (na === 1) {
          // mais importantes perto do eixo horizontal, alternando para cima e para baixo
          const imp = ordenarImportancia(p.lista), k = imp.length, slots = [];
          for (let i = 0; i < k; i++) slots.push(i);
          slots.sort((a, b) => Math.abs(a - (k - 1) / 2) - Math.abs(b - (k - 1) / 2) || a - b);
          ordem = new Array(k);
          imp.forEach((n, i) => { ordem[slots[i]] = n; });
        } else {
          // saltos seguintes: perto das contas a que se ligam (média dos ângulos já posicionados)
          const pref = n => {
            const a = (viz[n.id] || []).map(v => angulo[v]).filter(v => v !== undefined && v !== null);
            if (!a.length) return p.centro;
            return Math.atan2(a.reduce((s, x) => s + Math.sin(x), 0), a.reduce((s, x) => s + Math.cos(x), 0));
          };
          const rel = n => { let d = pref(n) - p.centro; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
          ordem = p.lista.slice().sort((a, b) => rel(a) - rel(b) || a.id.localeCompare(b.id));
        }
        const k = ordem.length, inicio = p.centro - (p.passo * (k - 1)) / 2;
        ordem.forEach((n, i) => {
          const ang = inicio + p.passo * i;
          const r = raio + (p.duplo && i % 2 ? 64 : 0);
          angulo[n.id] = ang;
          pos[n.id] = { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
        });
      });
      raioAnterior = raio + (duplo ? 64 : 0);
    }
    outros.forEach((n, i) => { pos[n.id] = { x: (i - (outros.length - 1) / 2) * ESPACO, y: -(raioAnterior || 170) - 80 }; });
    return pos;
  }

  /* Camadas: uma coluna por salto (quem envia à esquerda, quem recebe à direita); colunas com mais de 8 contas se
     dividem em subcolunas desencontradas, para o desenho não ficar mais alto que a tela. */
  function dispCamadas(nos) {
    const porNivel = new Map();
    nos.forEach(n => { if (!porNivel.has(n.nivel)) porNivel.set(n.nivel, []); porNivel.get(n.nivel).push(n); });
    const niveis = Array.from(porNivel.keys()).sort((a, b) => a - b);
    const MAX_COLUNA = 8, SUB = 96, VAO = 230;
    const pos = {};
    let x = 0, xFoco = null;
    niveis.forEach((nv, i) => {
      const lista = ordenarImportancia(porNivel.get(nv));
      const subs = Math.ceil(lista.length / MAX_COLUNA), linhas = Math.ceil(lista.length / subs);
      if (i > 0) x += VAO;
      lista.forEach((n, j) => {
        const s = j % subs, linha = Math.floor(j / subs);
        const naSub = Math.ceil((lista.length - s) / subs);
        pos[n.id] = { x: x + s * SUB, y: (linha - (naSub - 1) / 2) * ESPACO + (subs > 1 && s % 2 ? ESPACO / 2 : 0) };
      });
      if (nv === 0) xFoco = x + ((subs - 1) * SUB) / 2;
      x += (subs - 1) * SUB;
      void linhas;
    });
    const dx = xFoco === null ? x / 2 : xFoco;
    Object.keys(pos).forEach(id => { pos[id].x -= dx; });
    return pos;
  }

  /* Circular: todas as contas num anel; a conta em foco no topo e as demais por salto. */
  function dispCircular(nos) {
    const ordem = nos.slice().sort((a, b) => (a.tipo === 'foco' ? -1 : b.tipo === 'foco' ? 1 : (a.nivel - b.nivel) || a.id.localeCompare(b.id)));
    const r = Math.max(160, (ordem.length * ESPACO) / (2 * Math.PI));
    const pos = {};
    ordem.forEach((n, i) => {
      const ang = -Math.PI / 2 + (2 * Math.PI * i) / ordem.length;
      pos[n.id] = { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
    });
    return pos;
  }

  /* Forças (Fruchterman-Reingold), partindo da radial e com a conta em foco fixa no centro.
     Sem aleatoriedade: o mesmo grafo produz sempre o mesmo desenho. */
  function dispForcas(nos, arestas) {
    const ini = dispRadial(nos, arestas);
    const ids = nos.map(n => n.id), idx = {};
    ids.forEach((id, i) => { idx[id] = i; });
    const P = ids.map(id => ({ x: ini[id].x, y: ini[id].y }));
    const foco = nos.findIndex(n => n.tipo === 'foco');
    const pares = [], vistos = new Set();
    arestas.forEach(a => {
      if (a.origem === a.destino || idx[a.origem] === undefined || idx[a.destino] === undefined) return;
      const k = a.origem < a.destino ? a.origem + '|' + a.destino : a.destino + '|' + a.origem;
      if (!vistos.has(k)) { vistos.add(k); pares.push([idx[a.origem], idx[a.destino]]); }
    });
    const K = ESPACO * 1.7, n = P.length, VOLTAS = 320;
    for (let it = 0; it < VOLTAS; it++) {
      const temp = 36 * (1 - it / VOLTAS) + 0.6;
      const D = P.map(() => ({ x: 0, y: 0 }));
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        let dx = P[i].x - P[j].x, dy = P[i].y - P[j].y;
        if (!dx && !dy) { dx = (i - j) * 0.1; dy = 0.1; }
        const d = Math.max(Math.hypot(dx, dy), 1), fo = (K * K) / d;
        D[i].x += (dx / d) * fo; D[i].y += (dy / d) * fo; D[j].x -= (dx / d) * fo; D[j].y -= (dy / d) * fo;
      }
      pares.forEach(([a, b]) => {
        const dx = P[a].x - P[b].x, dy = P[a].y - P[b].y, d = Math.max(Math.hypot(dx, dy), 1), fo = (d * d) / K;
        D[a].x -= (dx / d) * fo; D[a].y -= (dy / d) * fo; D[b].x += (dx / d) * fo; D[b].y += (dy / d) * fo;
      });
      for (let i = 0; i < n; i++) {
        D[i].x -= P[i].x * 0.04; D[i].y -= P[i].y * 0.04;
        const len = Math.hypot(D[i].x, D[i].y) || 1, m = Math.min(len, temp);
        P[i].x += (D[i].x / len) * m; P[i].y += (D[i].y / len) * m;
      }
      if (foco >= 0) { P[foco].x = 0; P[foco].y = 0; }
    }
    const pos = {};
    ids.forEach((id, i) => { pos[id] = P[i]; });
    return pos;
  }

  /* Disposição automática: a tipologia registrada (só em análises de versões anteriores) manda quando pede anel (ciclo); grafos pequenos ficam em camadas
     (a direção do dinheiro lida da esquerda para a direita); os maiores, em radial, que cabe melhor numa tela. */
  function escolherDisposicao(g, nos) {
    if (g.tipologias.disposicao.id === 'circular') return 'circular';
    return nos.length <= 10 ? 'camadas' : 'radial';
  }
  function posicionar(nos, arestas, modo) {
    if (modo === 'circular') return dispCircular(nos);
    if (modo === 'camadas') return dispCamadas(nos);
    if (modo === 'forcas') return dispForcas(nos, arestas);
    return dispRadial(nos, arestas);
  }

  /* Enquadramento: escala e deslocamento que fazem o desenho inteiro caber na área, com folga para rótulos e laços. */
  function enquadrar(pos, W, H) {
    const ps = Object.values(pos);
    if (!ps.length || !W || !H) return { k: 1, x: W / 2 || 0, y: H / 2 || 0 };
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    ps.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
    const mx = 74, mt = 62, mb = 56;
    const k = limitar(Math.min((W - 2 * mx) / Math.max(x1 - x0, 1), (H - mt - mb) / Math.max(y1 - y0, 1)), ZOOM_MIN, 1.5);
    return { k, x: W / 2 - k * (x0 + x1) / 2, y: mt + (H - mt - mb) / 2 - k * (y0 + y1) / 2 };
  }

  /* Curva de cada aresta (em pixels de tela): paralelas (moedas diferentes) e sentidos opostos não se sobrepõem. */
  function tracar(arestas, pos, raioDe) {
    const usados = {}, pares = new Set(arestas.map(b => b.origem + '\u0001' + b.destino));
    return arestas.map(a => {
      const chave = a.origem + '\u0001' + a.destino;
      const j = usados[chave] = (usados[chave] || 0) + 1;
      const temOposta = pares.has(a.destino + '\u0001' + a.origem);
      const o = pos[a.origem], d = pos[a.destino];
      if (!o || !d) return null;
      const ro = raioDe(a.origem), rd = raioDe(a.destino);
      if (a.origem === a.destino) {
        const k = 30 + 14 * (j - 1);
        return { a, d: 'M ' + (o.x - 8) + ' ' + (o.y - ro + 2) + ' C ' + (o.x - k) + ' ' + (o.y - 40 - k) + ', ' + (o.x + k) + ' ' + (o.y - 40 - k) + ', ' + (o.x + 8) + ' ' + (o.y - ro + 2),
          mx: o.x, my: o.y - 36 - k * 0.72 };
      }
      const dx = d.x - o.x, dy = d.y - o.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      const curva = (temOposta || j > 1) ? 22 + 20 * (j - 1) : 0;
      const sx = o.x + ux * ro, sy = o.y + uy * ro, ex = d.x - ux * (rd + 3), ey = d.y - uy * (rd + 3);
      const cx = (sx + ex) / 2 - uy * curva, cy = (sy + ey) / 2 + ux * curva;
      return { a, d: 'M ' + sx + ' ' + sy + ' Q ' + cx + ' ' + cy + ' ' + ex + ' ' + ey, mx: (sx + 2 * cx + ex) / 4, my: (sy + 2 * cy + ey) / 4 };
    }).filter(Boolean);
  }

  /* Caminho mais curto (em saltos, sem considerar o sentido) entre duas contas do desenho: chaves das arestas. */
  function caminho(arestas, de, para) {
    if (!de || !para || de === para) return null;
    const viz = {};
    arestas.forEach(a => {
      if (a.origem === a.destino) return;
      const k = a.grupo ? 'g' + a.origem + '\u0001' + a.destino : chaveAresta(a);
      (viz[a.origem] = viz[a.origem] || []).push([a.destino, k]);
      (viz[a.destino] = viz[a.destino] || []).push([a.origem, k]);
    });
    const anterior = { [de]: null }, fila = [de];
    while (fila.length) {
      const atual = fila.shift();
      if (atual === para) break;
      (viz[atual] || []).forEach(([v, k]) => { if (!(v in anterior)) { anterior[v] = [atual, k]; fila.push(v); } });
    }
    if (!(para in anterior)) return null;
    const contas = [para], arestasK = [];
    let p = para;
    while (anterior[p]) { arestasK.push(anterior[p][1]); p = anterior[p][0]; contas.push(p); }
    return { contas: contas.reverse(), arestas: new Set(arestasK) };
  }
  const chaveVista = a => a.grupo ? 'g' + a.origem + '\u0001' + a.destino : chaveAresta(a);

  /* ── ganchos ────────────────────────────────────────────────────────────────────────────────── */
  /* Tamanho real (px) de um elemento, acompanhado com ResizeObserver. */
  function useMedida(ref) {
    const [m, setM] = React.useState({ w: 0, h: 0 });
    React.useEffect(() => {
      const el = ref.current;
      if (!el) return undefined;
      const medir = () => { const r = el.getBoundingClientRect(); setM(a => (Math.abs(a.w - r.width) < 1 && Math.abs(a.h - r.height) < 1 ? a : { w: r.width, h: r.height })); };
      medir();
      if (!window.ResizeObserver) { window.addEventListener('resize', medir); return () => window.removeEventListener('resize', medir); }
      const ro = new ResizeObserver(medir);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    return m;
  }

  /* Altura útil do palco do grafo: do topo dele até o fim da janela (sem rolar a página), dentro de limites legíveis.
     Mede o próprio palco, que fica ao lado da lista de contas no desktop e abaixo dela em telas menores. */
  function useAlturaUtil(ref) {
    const [alt, setAlt] = React.useState(560);
    React.useEffect(() => {
      const medir = () => {
        const el = ref.current;
        if (!el) return;
        const estreita = window.innerWidth < 900, janela = window.innerHeight;
        const topo = el.getBoundingClientRect().top + window.scrollY;
        const v = limitar(Math.round(janela - topo - 18), estreita ? 360 : 440, estreita ? Math.max(360, Math.round(janela * 0.8)) : 1400);
        setAlt(a => (a === v ? a : v));
      };
      medir();
      window.addEventListener('resize', medir);
      const ro = window.ResizeObserver ? new ResizeObserver(medir) : null;
      const principal = document.getElementById('conteudo');
      if (ro && principal) ro.observe(principal);
      return () => { window.removeEventListener('resize', medir); if (ro) ro.disconnect(); };
    }, []);
    return alt;
  }

  /* Posições exibidas: passam suavemente das anteriores para as novas. Contas novas nascem da conta em foco (ou do
     grupo de onde saíram, ao expandir), e um grupo nasce do centro das contas que reuniu. */
  function usePosicoes(alvo, foco, grupos, membroDe) {
    const [atual, setAtual] = React.useState(() => {
      const c = alvo[foco] || { x: 0, y: 0 }, p = {};
      Object.keys(alvo).forEach(id => { p[id] = { x: c.x, y: c.y }; });
      return p;
    });
    const ref = React.useRef(atual), ant = React.useRef({ grupos: {}, membroDe: {} });
    React.useEffect(() => {
      const velho = ref.current, de = {};
      const centro = alvo[foco] || { x: 0, y: 0 };
      Object.keys(alvo).forEach(id => {
        if (velho[id]) { de[id] = velho[id]; return; }
        const g = ant.current.membroDe[id];                       // saiu de um grupo que estava fechado
        if (g && velho[g]) { de[id] = velho[g]; return; }
        const gr = grupos[id];                                      // grupo novo: do centro das contas que reuniu
        if (gr) {
          const ps = gr.membros.map(m => velho[m.id]).filter(Boolean);
          if (ps.length) { de[id] = { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length }; return; }
        }
        de[id] = velho[foco] || centro;
      });
      ant.current = { grupos, membroDe };
      if (reduzirMovimento()) { ref.current = alvo; setAtual(alvo); return undefined; }
      return animar(560, t => {
        const p = {};
        Object.keys(alvo).forEach(id => { const a = de[id], b = alvo[id]; p[id] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; });
        ref.current = p;
        setAtual(p);
      });
    }, [alvo]);
    return atual;
  }

  /* ── componentes ────────────────────────────────────────────────────────────────────────────── */
  /* Transações de uma aresta: carregadas só quando a aresta é selecionada. */
  function TransacoesDaAresta({ analiseId, filtros, aresta, total }) {
    const [estado, setEstado] = React.useState({ dados: null, erro: null });
    React.useEffect(() => {
      let vivo = true;
      setEstado({ dados: null, erro: null });
      const fl = Object.assign({}, filtros, { conta_origem: aresta.origem, conta_destino: aresta.destino, moeda: aresta.moeda });
      api('/analises/' + analiseId + '/transacoes' + consulta(fl, { tamanho: 50 }))
        .then(d => { if (vivo) setEstado({ dados: d, erro: null }); }).catch(e => { if (vivo) setEstado({ dados: null, erro: e }); });
      return () => { vivo = false; };
    }, [analiseId, chaveAresta(aresta), JSON.stringify(filtros)]);
    if (estado.erro) return h(Erro, { erro: estado.erro });
    if (!estado.dados) return h(Carregando, { texto: 'Carregando as transações da aresta…' });
    const d = estado.dados;
    return h('div', { className: 'rolagem' }, h('table', { className: 'compacta' },
      h('caption', null, 'Valores individuais desta aresta, em ordem de horário' + (d.total > d.linhas.length ? ' (primeiras ' + d.linhas.length + ' de ' + f.inteiro(d.total) + ')' : ' (' + f.inteiro(d.total) + ')')),
      h('thead', null, h('tr', null, ['ID', 'Data e hora', 'Valor', 'Score', 'Alerta'].map(c => h('th', { key: c, scope: 'col' }, c)))),
      h('tbody', null, d.linhas.map(l => h('tr', { key: l.id_exibicao, className: l.alerta ? 'com-alerta' : '' },
        h('td', { className: 'mono' }, f.idExibicao(l.id_exibicao, total)), h('td', null, f.dataHora(l.data_hora)),
        h('td', { className: 'num' }, f.valor(l.valor_pago) + ' ' + l.moeda_pagamento),
        h('td', { className: 'num', title: 'Faixa ' + window.NW.NOME_FAIXA[l.faixa] }, l.score), h('td', null, l.alerta ? h('strong', null, '⚠ Sim') : 'Não'))))));
  }

  function LegendaGrafo({ g, modo }) {
    const lim = g.limites, tip = g.tipologias;
    const item = (desenho, texto) => h('li', null, h('svg', { viewBox: '0 0 48 24', 'aria-hidden': 'true' }, desenho), h('span', null, texto));
    const seta = (classe, marca, extra) => h('g', { className: 'g-aresta ' + classe }, h('path', { className: 'traco', d: 'M 3 12 L 38 12' }, extra || null), h('path', { className: marca, d: 'M 45 12 L 36 7 L 36 17 Z' }));
    return h('details', { className: 'bloco legenda-grafo-caixa' },
      h('summary', null, h(Icone, { nome: 'legenda' }), 'Legenda do grafo'),
      h('ul', { className: 'legenda-grafo' },
        item(h('g', { className: 'g-no foco' }, h('circle', { className: 'anel', cx: 24, cy: 12, r: 11 }), h('circle', { className: 'corpo', cx: 24, cy: 12, r: 7 })),
          h(React.Fragment, null, h('strong', null, 'Conta em foco'), ': contorno duplo branco, halo vermelho e a palavra "foco".')),
        item(h('g', { className: 'g-no' }, h('circle', { className: 'corpo', cx: 24, cy: 12, r: 8 })),
          h(React.Fragment, null, h('strong', null, 'Conta'), ' (vértice): o rótulo é o mesmo "banco-conta" da tabela; com muitas contas, aparece abreviado ("banco-…final"). O completo fica na dica e na seleção.')),
        item(h('g', { className: 'g-no alerta' }, h('circle', { className: 'corpo', cx: 24, cy: 12, r: 8 }), h('text', { className: 'marca-alerta', x: 24, y: 16 }, '!')),
          h(React.Fragment, null, h('strong', null, 'Conta ligada a alerta'), ': vermelha, com "!" e a palavra "alerta" quando há espaço.')),
        item(h('g', { className: 'g-no grupo' }, h('circle', { className: 'pilha', cx: 27, cy: 12, r: 8 }), h('circle', { className: 'corpo', cx: 22, cy: 12, r: 8 })),
          h(React.Fragment, null, h('strong', null, 'Grupo de contas'), ': em grafos grandes, contas com uma única ligação, à mesma conta e no mesmo papel; as ' + MANTER_VISIVEIS + ' mais relevantes de cada conjunto continuam visíveis. Selecione para expandir; nada é somado entre moedas.')),
        item(seta('', 'm-seta'),
          h(React.Fragment, null, h('strong', null, 'Seta'), ': aponta da conta de ', h('strong', null, 'origem'), ' para a conta de ', h('strong', null, 'destino'), ' do dinheiro.')),
        item(seta('alerta', 'm-seta-alerta'),
          h(React.Fragment, null, h('strong', null, 'Caminho com alerta'), ': vermelho, com "⚠" no rótulo; alguma transação da aresta tem alerta. O pulso que corre na linha segue o sentido do dinheiro (em todas quando são até 12; com mais, só nas destacadas).')),
        item(h('g', { className: 'g-aresta agrupada' }, h('path', { className: 'traco', d: 'M 3 12 L 45 12' })),
          h(React.Fragment, null, h('strong', null, 'Aresta agrupada'), ': traço grosso; reúne transações de mesma origem, destino e moeda e mostra a quantidade e o total.')),
        item(seta('sem-ordem', 'm-seta'),
          h(React.Fragment, null, h('strong', null, 'Traço tracejado'), ': relação do recorte sem ordem temporal confirmada. Não é uma etapa seguinte do dinheiro.')),
        item(seta('na-sequencia', 'm-seta-seq'),
          h(React.Fragment, null, h('strong', null, 'Traço branco animado'), ': sequência selecionada, com horários compatíveis.')),
        item(seta('caminho', 'm-seta-seq'),
          h(React.Fragment, null, h('strong', null, 'Caminho até o foco'), ': ao selecionar uma conta, o menor caminho (em saltos) até a conta em foco fica em branco.'))),
      h(Legenda, null, h('strong', null, 'Valor, moeda e horário: '), 'cada aresta mostra o valor pago, a moeda de pagamento e o horário (ou o intervalo, se agrupada). Moedas diferentes ficam em arestas separadas e nunca são somadas. Selecione a aresta para ver cada transação.'),
      h(Legenda, null, h('strong', null, 'Ordem no tempo: '), g.ordem_temporal.regra),
      h(Legenda, null, h('strong', null, 'Limites ativos: '), 'até ' + lim.profundidade + ' salto(s) a partir da conta em foco, ' + lim.max_nos + ' vértices e ' + lim.max_arestas +
        ' arestas desenhadas (prioridade: mais perto do foco, depois com alerta, depois mais transações). ' +
        (lim.fronteira_truncada ? 'Havia mais de ' + lim.fronteira_por_salto + ' contas em um salto: só as primeiras foram expandidas, e os totais do salto seguinte são parciais.' : '')),
      /* a sugestão pela tipologia só existe em análises gravadas por versões anteriores, com tipologias registradas */
      tip.disponivel ? h(Legenda, null, h('strong', null, 'Disposição: '), (DESCRICAO_DISPOSICAO[modo] || tip.disposicao.nome) + '. Sugerida pela tipologia: ' + tip.disposicao.nome + ' (', h('span', { className: 'mono' }, tip.predominante),
        ', ' + tip.origem + '). A tipologia nunca é deduzida pela aparência do grafo; mudar a disposição só reposiciona as contas.')
        : h(Legenda, null, h('strong', null, 'Disposição: '), (DESCRICAO_DISPOSICAO[modo] || tip.disposicao.nome) + '. Mudar a disposição só reposiciona as contas.'),
      h(Legenda, null, g.nota_filtros));
  }

  /* Sequências com horários compatíveis: cada passo com origem → destino, valor, moeda e horário. */
  function Sequencias({ ordem, selecionada, aoSelecionar, total }) {
    const c = ordem.contagem, indiretas = c.sequencia + c.simultanea + c.sem_ordem;
    return h('details', { className: 'inspetor-secao', open: ordem.sequencias.length > 0 },
      h('summary', null, h(Icone, { nome: 'sequencia' }), 'Ordem no tempo',
        h('span', { className: 'selo-mini ' + (indiretas && c.sequencia < indiretas ? 'atencao' : c.sequencia ? 'ok' : '') },
          !indiretas ? 'só diretas' : c.sequencia === indiretas ? 'horários compatíveis' : c.sequencia ? 'em parte' : 'sem ordem')),
      h('p', { className: 'legenda' }, ordem.resumo),
      h('p', { className: 'legenda fraco' }, f.plural(c.direta, 'direta', 'diretas') + ' · ' + f.plural(c.sequencia, 'em sequência', 'em sequência') + ' · ' +
        f.plural(c.sem_ordem + c.simultanea, 'sem ordem confirmada', 'sem ordem confirmada') + (c.simultanea ? ' (' + c.simultanea + ' no mesmo minuto)' : '')),
      ordem.sequencias.length ? h(React.Fragment, null,
        h('ol', { className: 'sequencias' }, ordem.sequencias.map((s, i) => h('li', { key: i },
          h('button', { type: 'button', className: 'botao sequencia', 'aria-pressed': selecionada === i, onClick: () => aoSelecionar(selecionada === i ? null : i) },
            h('strong', null, (s.alerta ? '⚠ ' : '') + 'Sequência ' + (i + 1) + ' — ' + f.plural(s.passos.length, 'passo', 'passos') + (s.sentido === 'volta_ao_foco' ? ', volta à conta em foco' : '') + (s.alerta ? ' (tem alerta)' : '')),
            s.passos.map((p, j) => h('span', { key: j, className: 'passo' },
              h('span', { className: 'mono' }, p.origem + ' → ' + p.destino), ' · ' + f.valor(p.valor) + ' ' + p.moeda + ' · ',
              h('span', { className: 'hora' }, f.dataHora(p.data_hora) + ' · ' + f.idExibicao(p.id_exibicao, total) + (p.alerta ? ' · ⚠ alerta' : '')))))))),
        ordem.sequencias_total > ordem.sequencias.length ? h(Legenda, null, 'Mostrando ' + ordem.sequencias.length + ' de ' + ordem.sequencias_total + ' sequências.') : null,
        h(Legenda, null, 'Horário compatível não prova que é o mesmo dinheiro: é só a ordem em que as transações aconteceram.')) : null);
  }

  /* Leitura do recorte: frases curtas montadas só com os números que vieram da API (nada é inferido além deles). */
  /* Frases da leitura. A posição na lista de contas prioritárias vem da /visao, que aplica os filtros de conta; o resto
     vem do /grafo, que não os aplica (eles só escolhem o foco). Com filtro de conta ativo, a frase do ranking sai.
     As contagens "no desenho" usam o que está desenhado agora (filtro de relações e grupos incluídos). */
  function leituraDoGrafo(g, ranking, vista, contaFiltrada) {
    const t = g.totais, itens = [];
    const desenhadas = (vista || g).nos.reduce((acc, n) => { (n.tipo === 'grupo' ? n.membros : [n]).forEach(m => { acc[m.tipo] = (acc[m.tipo] || 0) + 1; }); return acc; }, {});
    const enviaram = desenhadas.enviou || 0, receberam = desenhadas.recebeu || 0;
    const pos = ranking && !contaFiltrada ? ranking.contas.findIndex(c => c.conta === g.foco) : -1;
    if (pos >= 0) {
      const c = ranking.contas[pos];
      itens.push({ tom: 'alerta', texto: h(React.Fragment, null, h('strong', null, (pos + 1) + 'ª'), ' das contas prioritárias: participa de ', h('strong', null, f.plural(c.alertas, 'transação com alerta', 'transações com alerta')),
        ' no recorte; maior score entre elas: ', h('strong', null, c.maior_score), '.') });
    }
    itens.push({ tom: t.alertas_relacionadas ? 'alerta' : 'ok', texto: t.alertas_relacionadas
      ? h(React.Fragment, null, h('strong', null, f.inteiro(t.alertas_relacionadas)), ' de ' + f.inteiro(t.relacionadas) + ' transações relacionadas têm alerta: sinal para investigação, não confirmação.')
      : 'Nenhuma das ' + f.inteiro(t.relacionadas) + ' transações relacionadas tem alerta.' });
    const saltos = g.limites.profundidade > 1 ? ' (até ' + g.limites.profundidade + ' saltos)' : '';
    if (enviaram && receberam) itens.push({ tom: '', texto: h(React.Fragment, null, 'No desenho, ', h('strong', null, f.plural(enviaram, 'conta enviou', 'contas enviaram')), ' e ', h('strong', null, f.plural(receberam, 'recebeu', 'receberam')), saltos + '.') });
    else if (enviaram || receberam) itens.push({ tom: '', texto: h(React.Fragment, null, 'No desenho, ', h('strong', null, enviaram ? f.plural(enviaram, 'conta enviou', 'contas enviaram') : f.plural(receberam, 'conta recebeu', 'contas receberam')),
      saltos + '; nenhuma ' + (enviaram ? 'recebeu' : 'enviou') + '.') });
    const comAlerta = g.arestas.filter(a => a.alerta);
    if (comAlerta.length) {
      const maior = Math.max(...comAlerta.map(a => a.maior_score || 0));
      itens.push({ tom: 'alerta', texto: h(React.Fragment, null, h('strong', null, f.inteiro(comAlerta.length)), ' das ' + f.inteiro(g.arestas.length) + ' conexões desenhadas têm alerta · maior score nelas: ', h('strong', null, maior), '.') });
    }
    const c = g.ordem_temporal.contagem, nSeq = g.ordem_temporal.sequencias_total || 0;
    if (nSeq) itens.push({ tom: 'ok', texto: h(React.Fragment, null, h('strong', null, f.plural(nSeq, 'sequência', 'sequências')), ' com horários compatíveis (ver Ordem no tempo).') });
    else if (c.sequencia) itens.push({ tom: 'ok', texto: h(React.Fragment, null, h('strong', null, f.plural(c.sequencia, 'conexão', 'conexões')), ' com horários compatíveis, sem formar sequência completa até o foco.') });
    const cortes = [];
    /* o limite só é citado quando foi ele que cortou (desenho no teto); senão o corte veio do outro limite */
    if (t.contas_relacionadas > t.vertices) cortes.push(f.inteiro(t.vertices) + ' de ' + f.inteiro(t.contas_relacionadas) + ' contas' + (t.vertices >= g.limites.max_nos ? ' (limite de ' + g.limites.max_nos + ')' : ''));
    if (t.arestas_relacionadas > t.arestas) cortes.push(f.inteiro(t.arestas) + ' de ' + f.inteiro(t.arestas_relacionadas) + ' arestas' + (t.arestas >= g.limites.max_arestas ? ' (limite de ' + g.limites.max_arestas + ')' : ''));
    if (cortes.length) itens.push({ tom: 'atencao', texto: 'Desenho parcial: ' + cortes.join(' e ') + '.' });
    return itens;
  }

  function Leitura({ g, ranking, vista, contaFiltrada, carregando }) {
    const t = g.totais;
    /* enquanto o grafo ou o recorte recarregam, não mistura frases de recortes diferentes */
    if (carregando) return h('section', { className: 'leitura', 'aria-labelledby': 'leitura-t', 'aria-busy': 'true' },
      h('h3', { id: 'leitura-t' }, h('span', { className: 'leitura-sinal', 'aria-hidden': 'true' }), 'Leitura do recorte'), h(Esqueleto, { linhas: 4, texto: 'Atualizando a leitura do recorte…' }));
    const itens = leituraDoGrafo(g, ranking, vista, contaFiltrada);
    return h('section', { className: 'leitura', 'aria-labelledby': 'leitura-t', 'aria-live': 'polite' },
      h('h3', { id: 'leitura-t' }, h('span', { key: g.foco, className: 'leitura-sinal', 'aria-hidden': 'true' }), 'Leitura do recorte'),
      h('ul', null, itens.map((it, i) => h('li', { key: i, className: it.tom, style: { '--i': i } }, it.texto))),
      t.por_moeda.length ? h('details', { className: 'leitura-mais' },
        h('summary', null, 'Valor relacionado por moeda'),
        h('ul', { className: 'moedas' }, t.por_moeda.map(m => h('li', { key: m.moeda }, h('span', null, m.moeda), h('strong', null, f.valor(m.total)), h('small', null, f.plural(m.n, 'transação', 'transações'))))),
        h(Legenda, null, 'Soma de todas as transações relacionadas do recorte, não só das desenhadas. Moedas nunca são somadas entre si.')) : null);
  }

  /* Painel de seleção: conta, grupo ou aresta escolhida no grafo, com as ações de aprofundamento. */
  function Selecao({ g, vista, noSel, arSel, rota, analiseId, filtros, total, aoFocar, aoFiltrarTabela, aoExpandir, aoLimpar, maiorScoreDe }) {
    if (!noSel && !arSel) return h('div', { className: 'selecao-vazia' }, h(Icone, { nome: 'grafo' }),
      h('p', null, 'Selecione uma conta ou uma conexão para ver os detalhes.'), h('p', { className: 'fraco' }, 'Teclado: Tab e Enter · + e − para zoom · 0 para ajustar.'));
    const fechar = h('button', { type: 'button', className: 'botao icone fantasma pequeno', onClick: aoLimpar, 'aria-label': 'Limpar a seleção', title: 'Limpar a seleção' }, h(Icone, { nome: 'fechar' }));
    if (noSel && noSel.tipo === 'grupo') {
      return h('div', { className: 'selecao' },
        h('div', { className: 'selecao-cabeca' }, h('span', { className: 'eyebrow' }, 'Grupo de contas'), fechar),
        h('p', { className: 'selecao-titulo' }, f.plural(noSel.membros.length, 'conta', 'contas') + ' que ' + (noSel.papel === 'enviou' ? 'enviaram' : 'receberam') + ' só por ', h('span', { className: 'mono' }, rotuloCurto(noSel.pai))),
        noSel.alerta ? h(Selo, { tom: 'alerta' }, '⚠ todas ligadas a alerta') : null,
        h('ul', { className: 'membros', title: 'Ao lado de cada conta: transações com alerta entre as relações exploradas a partir do foco' }, noSel.membros.map(m => h('li', { key: m.id }, h('span', { className: 'mono' }, m.id), m.alerta ? h('span', { className: 'alerta-txt' }, '⚠ ' + f.inteiro(m.alertas_relacionados)) : null))),
        h('div', { className: 'linha' }, h('button', { type: 'button', className: 'botao pequeno primario', onClick: () => aoExpandir(noSel.id) }, h(Icone, { nome: 'mais' }), 'Expandir o grupo')));
    }
    if (noSel) {
      const ms = maiorScoreDe(noSel.id);
      return h('div', { className: 'selecao' },
        h('div', { className: 'selecao-cabeca' }, h('span', { className: 'eyebrow' }, PAPEL_CURTO[noSel.tipo] || 'Conta'), fechar),
        h('p', { className: 'selecao-titulo mono' }, noSel.id),
        h('dl', { className: 'mini-pares' },
          h('div', null, h('dt', null, 'Banco'), h('dd', null, noSel.banco)),
          h('div', null, h('dt', null, 'Conta'), h('dd', { className: 'mono' }, noSel.conta)),
          h('div', { title: noSel.tipo === 'foco' ? 'Transações relacionadas com alerta (sem os filtros de conta)' : 'Transações com alerta entre as relações exploradas a partir do foco; não é o total da conta no recorte' }, h('dt', null, noSel.tipo === 'foco' ? 'Com alerta' : 'Com alerta no grafo'), h('dd', null, noSel.alerta ? h('strong', { className: 'alerta-txt' }, '⚠ ' + f.inteiro(noSel.alertas_relacionados)) : 'nenhuma')),
          ms !== null ? h('div', { title: 'Maior score entre as transações das conexões desenhadas desta conta' }, h('dt', null, 'Maior score'), h('dd', null, ms)) : null),
        h('p', { className: 'legenda' }, 'Papel: ' + PAPEL[noSel.tipo] + '.'),
        rota && noSel.tipo !== 'foco' ? h('p', { className: 'rota' }, h('span', { className: 'eyebrow' }, 'Caminho até o foco · ' + f.plural(rota.contas.length - 1, 'salto', 'saltos')),
          h('span', { className: 'mono' }, rota.contas.map(rotuloCurto).join(' — '))) : null,
        h('div', { className: 'acoes-selecao' },
          noSel.tipo !== 'foco' ? h('button', { type: 'button', className: 'botao pequeno primario', onClick: () => aoFocar(noSel.id) }, h(Icone, { nome: 'grafo' }), 'Colocar em foco') : null,
          h('button', { type: 'button', className: 'botao pequeno', onClick: () => aoFiltrarTabela({ conta_origem: noSel.id, conta_destino: '' }) }, 'Transações como origem'),
          h('button', { type: 'button', className: 'botao pequeno', onClick: () => aoFiltrarTabela({ conta_origem: '', conta_destino: noSel.id }) }, 'Transações como destino')));
    }
    const a = arSel, tip = g.tipologias;
    if (a.grupo) return h('div', { className: 'selecao' },
      h('div', { className: 'selecao-cabeca' }, h('span', { className: 'eyebrow' }, 'Conexões agrupadas'), fechar),
      h('p', { className: 'selecao-titulo' }, f.plural(a.arestas, 'aresta', 'arestas') + ' · ' + f.plural(a.n, 'transação', 'transações')),
      a.alerta ? h(Selo, { tom: 'alerta' }, '⚠ ' + f.inteiro(a.alertas) + ' com alerta') : null,
      h(Legenda, null, 'Moedas diferentes não são somadas: expanda o grupo para ver cada aresta.'),
      h('div', { className: 'linha' }, h('button', { type: 'button', className: 'botao pequeno primario', onClick: () => aoExpandir(vista.grupos[a.origem] ? a.origem : a.destino) }, h(Icone, { nome: 'mais' }), 'Expandir o grupo')));
    return h('div', { className: 'selecao' },
      h('div', { className: 'selecao-cabeca' }, h('span', { className: 'eyebrow' }, 'Conexão'), fechar),
      h('p', { className: 'selecao-titulo mono' }, rotuloCurto(a.origem) + ' → ' + rotuloCurto(a.destino)),
      h(Pares, { itens: [['Origem', h('span', { className: 'mono' }, a.origem)], ['Destino', h('span', { className: 'mono' }, a.destino)],
        ['Valor total', f.valor(a.total) + ' ' + a.moeda + ' · ' + f.plural(a.n, 'transação', 'transações') + (a.agrupada ? ' (agrupadas)' : '')],
        ['Com alerta', a.alerta ? h(Selo, { tom: 'alerta' }, '⚠ ' + f.inteiro(a.alertas)) : 'nenhuma'], ['Maior score', a.maior_score],
        ['Primeira e última', f.dataHora(a.primeiro) + ' — ' + f.dataHora(a.ultimo)],
        ['Ordem no tempo', h(Selo, { tom: semOrdem(a) ? 'atencao' : a.ordem === 'sequencia' ? 'ok' : '' }, a.ordem_texto)],
        a.passo && a.ordem === 'sequencia' ? ['Transação que confirma a sequência', f.idExibicao(a.passo.id_exibicao, total) + ' em ' + f.dataHora(a.passo.data_hora) + ', ' + f.valor(a.passo.valor) + ' ' + a.moeda] : null,
        tip.disponivel ? ['Tipologias registradas', a.tipologias.length ? a.tipologias.join(', ') : 'padrao_nao_identificado'] : null] }),
      h('div', { className: 'acoes-selecao' },
        h('button', { type: 'button', className: 'botao pequeno', onClick: () => aoFiltrarTabela({ conta_origem: a.origem, conta_destino: a.destino, moeda: a.moeda }) }, 'Ver estas transações na tabela')),
      h(TransacoesDaAresta, { analiseId, filtros, aresta: a, total }));
  }

  /* Ícones dos controles do grafo (desenhados aqui para não depender de novos nomes em painel-base.js). */
  const ICONE_CONTROLE = {
    centro: ['M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
    telaCheia: ['M14 4h6v6', 'M20 4l-7 7', 'M10 20H4v-6', 'M4 20l7-7'],
    sairTelaCheia: ['M20 10h-6V4', 'M14 10l7-7', 'M4 14h6v6', 'M10 14l-7 7'],
  };
  const IconeControle = ({ nome }) => h('svg', { className: 'ico', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, ICONE_CONTROLE[nome].map((d, i) => h('path', { key: i, d })));

  function Grafo({ g, analiseId, filtros, total, profundidade, aoProfundidade, aoFocar, aoFiltrarTabela, trilho, ranking, carregando }) {
    const [sel, setSel] = React.useState(null);        // {tipo: 'no' | 'aresta', id}
    const [seq, setSeq] = React.useState(null);        // índice da sequência destacada
    const [mostrarValores, setMostrarValores] = React.useState(true);
    const [modoPedido, setModoPedido] = React.useState('auto');
    const [relacao, setRelacao] = React.useState('tudo');
    const [agruparPedido, setAgruparPedido] = React.useState(null);   // null = automático (agrupa acima de 18 contas)
    const [abertos, setAbertos] = React.useState(() => new Set());
    const [sobre, setSobre] = React.useState(null);    // conta sob o ponteiro (rótulo completo)
    const [dica, setDica] = React.useState(null);
    const [cam, setCam] = React.useState({ k: 1, x: 0, y: 0 });
    const [telaCheia, setTelaCheia] = React.useState(false);
    const [novos, setNovos] = React.useState(() => new Set());
    const refArea = React.useRef(null), refPalco = React.useRef(null), refMoldura = React.useRef(null);
    const camRef = React.useRef(cam), auto = React.useRef(true), paraCam = React.useRef(null), arrasto = React.useRef(null), toques = React.useRef(new Map());
    const idsAnteriores = React.useRef(null);
    const altura = useAlturaUtil(refPalco);
    const medida = useMedida(refMoldura);

    /* troca de grafo: limpa a seleção, volta ao enquadramento automático e marca as contas que acabaram de aparecer */
    React.useEffect(() => {
      setSel(null); setSeq(null); setDica(null); setAbertos(a => (a.size ? new Set() : a)); auto.current = true;
      const ids = new Set(g.nos.map(n => n.id));
      setNovos(idsAnteriores.current ? new Set([...ids].filter(id => !idsAnteriores.current.has(id))) : new Set());
      idsAnteriores.current = ids;
    }, [g]);

    const base = React.useMemo(() => filtrarRelacoes(g, relacao), [g, relacao]);
    const agrupavel = g.nos.length > 12;
    const agrupando = agruparPedido === null ? g.nos.length > 24 : agruparPedido;   // automático: só em grafos grandes
    const vista = React.useMemo(() => agrupar(base, agrupando, abertos), [base, agrupando, abertos]);
    const modo = modoPedido === 'auto' ? escolherDisposicao(g, vista.nos) : modoPedido;
    const alvo = React.useMemo(() => posicionar(vista.nos, vista.arestas, modo), [vista, modo]);
    const pos = usePosicoes(alvo, g.foco, vista.grupos, vista.membroDe);

    /* câmera: animada entre enquadramentos; zoom e arraste manuais desligam o reenquadramento automático */
    const moverCamera = (alvoCam, animado) => {
      if (paraCam.current) paraCam.current();
      if (!animado || reduzirMovimento()) { camRef.current = alvoCam; setCam(alvoCam); return; }
      const de = camRef.current;
      paraCam.current = animar(460, t => {
        const c = { k: de.k + (alvoCam.k - de.k) * t, x: de.x + (alvoCam.x - de.x) * t, y: de.y + (alvoCam.y - de.y) * t };
        camRef.current = c; setCam(c);
      });
    };
    const ajustar = (animado = true) => { auto.current = true; moverCamera(enquadrar(alvo, medida.w, medida.h), animado); };
    const primeiraVez = React.useRef(true);
    React.useEffect(() => {
      if (!medida.w || !medida.h || !auto.current) return;
      ajustar(!primeiraVez.current);
      primeiraVez.current = false;
    }, [alvo, medida.w, medida.h]);
    React.useEffect(() => () => { if (paraCam.current) paraCam.current(); }, []);

    const ampliar = (fator, px, py) => {
      auto.current = false;
      const c = camRef.current, k = limitar(c.k * fator, ZOOM_MIN, ZOOM_MAX);
      const cx = px === undefined ? medida.w / 2 : px, cy = py === undefined ? medida.h / 2 : py;
      moverCamera({ k, x: cx - (cx - c.x) * (k / c.k), y: cy - (cy - c.y) * (k / c.k) }, px === undefined);
    };
    const centralizar = () => {
      const id = sel && sel.tipo === 'no' ? sel.id : g.foco, p = alvo[id];
      if (!p) return;
      auto.current = false;
      const k = Math.max(camRef.current.k, 0.9);
      moverCamera({ k, x: medida.w / 2 - k * p.x, y: medida.h / 2 - k * p.y }, true);
    };
    /* Tela cheia: a área passa a ocupar a janela por CSS na hora (funciona em qualquer navegador, inclusive embutido);
       a tela cheia nativa é pedida junto, quando o navegador permite. Esc ou o mesmo botão saem. */
    const alternarTelaCheia = () => {
      const el = refArea.current;
      if (!el) return;
      if (telaCheia || document.fullscreenElement) {
        setTelaCheia(false);
        if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
        return;
      }
      setTelaCheia(true);
      try { if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); } catch (e) { /* sem tela cheia nativa: fica a do CSS */ }
    };
    React.useEffect(() => {
      /* saiu da tela cheia nativa (Esc do navegador): sai também da do CSS */
      const mudou = () => { if (!document.fullscreenElement) setTelaCheia(false); };
      document.addEventListener('fullscreenchange', mudou);
      return () => document.removeEventListener('fullscreenchange', mudou);
    }, []);
    React.useEffect(() => {
      if (!telaCheia) return undefined;
      const esc = e => { if (e.key === 'Escape' && !document.fullscreenElement) setTelaCheia(false); };
      document.addEventListener('keydown', esc);
      document.body.classList.add('grafo-tela-cheia');
      return () => { document.removeEventListener('keydown', esc); document.body.classList.remove('grafo-tela-cheia'); };
    }, [telaCheia]);
    React.useEffect(() => { auto.current = true; }, [telaCheia]);

    /* roda: Ctrl/⌘ + roda (ou gesto de pinça do trackpad) aproxima no ponteiro; em tela cheia, a roda sozinha também */
    React.useEffect(() => {
      const el = refMoldura.current;
      if (!el) return undefined;
      const roda = e => {
        if (!e.ctrlKey && !e.metaKey && !document.fullscreenElement) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        ampliar(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - r.left, e.clientY - r.top);
      };
      el.addEventListener('wheel', roda, { passive: false });
      return () => el.removeEventListener('wheel', roda);
    });

    /* arrastar o fundo move a câmera; dois dedos aproximam; contas e arestas continuam clicáveis */
    const inicio = e => {
      if (e.pointerType === 'touch') toques.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (toques.current.size === 2) { arrasto.current = null; return; }
      if (e.button !== 0 || (e.target.closest && e.target.closest('.g-no, .g-aresta'))) return;
      if (paraCam.current) { paraCam.current(); paraCam.current = null; }
      arrasto.current = { x: e.clientX, y: e.clientY, c: camRef.current };
      e.currentTarget.setPointerCapture(e.pointerId);
      if (refMoldura.current) refMoldura.current.classList.add('arrastando');
    };
    const mover = e => {
      if (toques.current.has(e.pointerId)) {
        const antes = Array.from(toques.current.values());
        toques.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (toques.current.size === 2) {
          const agora = Array.from(toques.current.values());
          const d0 = Math.hypot(antes[0].x - antes[1].x, antes[0].y - antes[1].y), d1 = Math.hypot(agora[0].x - agora[1].x, agora[0].y - agora[1].y);
          const r = refMoldura.current.getBoundingClientRect();
          if (d0 > 0) ampliar(d1 / d0, (agora[0].x + agora[1].x) / 2 - r.left, (agora[0].y + agora[1].y) / 2 - r.top);
          return;
        }
      }
      const a = arrasto.current;
      if (!a) return;
      auto.current = false;
      const c = { k: a.c.k, x: a.c.x + (e.clientX - a.x), y: a.c.y + (e.clientY - a.y) };
      camRef.current = c; setCam(c);
    };
    const fim = e => { toques.current.delete(e.pointerId); arrasto.current = null; if (refMoldura.current) refMoldura.current.classList.remove('arrastando'); };
    const teclas = e => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
      const k = e.key;
      if (k === '+' || k === '=') { e.preventDefault(); ampliar(1.25); }
      else if (k === '-' || k === '_') { e.preventDefault(); ampliar(1 / 1.25); }
      else if (k === '0') { e.preventDefault(); ajustar(); }
      else if (e.target === refMoldura.current && k.indexOf('Arrow') === 0) {
        e.preventDefault(); auto.current = false;
        const c = camRef.current, d = 60;
        moverCamera({ k: c.k, x: c.x + (k === 'ArrowLeft' ? d : k === 'ArrowRight' ? -d : 0), y: c.y + (k === 'ArrowUp' ? d : k === 'ArrowDown' ? -d : 0) }, true);
      } else if (k === 'Escape' && sel) { setSel(null); setSeq(null); }
    };

    const mostrarDica = (e, titulo, linhas) => {
      if (arrasto.current || !refMoldura.current) return;
      const r = refMoldura.current.getBoundingClientRect();
      setDica({ x: limitar(e.clientX - r.left, 150, r.width - 150), y: Math.max(70, e.clientY - r.top), titulo, linhas });
    };

    /* seleção, sequência e destaques */
    const noSel = sel && sel.tipo === 'no' ? vista.nos.find(n => n.id === sel.id) : null;
    const arSel = sel && sel.tipo === 'aresta' ? vista.arestas.find(a => chaveVista(a) === sel.id) : null;
    const seqAtual = seq !== null ? g.ordem_temporal.sequencias[seq] : null;
    const naSeqOriginal = new Set(seqAtual ? seqAtual.passos.map(chaveAresta) : []);
    const naSeq = a => a.grupo ? a.membros.some(k => naSeqOriginal.has(k)) : naSeqOriginal.has(chaveAresta(a));
    const rota = noSel && noSel.tipo !== 'foco' ? caminho(vista.arestas, noSel.id, g.foco) : null;
    const destacados = new Set();
    if (noSel) { destacados.add(noSel.id); vista.arestas.forEach(a => { if (a.origem === noSel.id || a.destino === noSel.id) { destacados.add(a.origem); destacados.add(a.destino); } }); if (rota) rota.contas.forEach(c => destacados.add(c)); }
    if (arSel) { destacados.add(arSel.origem); destacados.add(arSel.destino); }
    if (seqAtual) vista.arestas.forEach(a => { if (naSeq(a)) { destacados.add(a.origem); destacados.add(a.destino); } });
    const haDestaque = !!noSel || !!arSel || !!(seqAtual && vista.arestas.some(naSeq));
    const arestaDestacada = a => !haDestaque || (seqAtual ? naSeq(a) : arSel ? chaveVista(a) === sel.id : (a.origem === sel.id || a.destino === sel.id || !!(rota && rota.arestas.has(chaveVista(a)))));
    const selecionar = s => { setSeq(null); setSel(s); };
    const expandir = id => { setAbertos(a => { const n = new Set(a); n.add(id); return n; }); setSel(null); };
    /* ao destacar uma sequência ou escolher uma aresta pela lista, os grupos que escondem as contas dela se abrem */
    const abrirGruposDe = contas => {
      const membroDe = relacao === 'tudo' ? vista.membroDe : agrupar(g, agrupando, abertos).membroDe;   // a lista de arestas volta para "todas"
      const ids = contas.map(c => membroDe[c]).filter(Boolean);
      if (ids.length) setAbertos(a => { const n = new Set(a); ids.forEach(i => n.add(i)); return n; });
    };
    const escolherSequencia = i => {
      setSel(null); setSeq(i);
      if (i !== null) abrirGruposDe([].concat(...g.ordem_temporal.sequencias[i].passos.map(p => [p.origem, p.destino])));
    };
    const maiorScoreDe = id => {
      const s = g.arestas.filter(a => a.origem === id || a.destino === id).map(a => a.maior_score).filter(v => v !== undefined && v !== null);
      return s.length ? Math.max(...s) : null;
    };

    /* tela: posições do desenho → pixels; o tamanho dos nós acompanha o zoom só em parte, e o texto fica legível */
    const k = cam.k;
    const raioBase = limitar(RAIO * Math.sqrt(k), 9, 22);
    const raioDe = id => (vista.grupos[id] ? raioBase * 1.18 : id === g.foco ? raioBase * 1.12 : raioBase);
    const tela = {};
    Object.keys(pos).forEach(id => { if (vista.nos.some(n => n.id === id)) tela[id] = { x: pos[id].x * k + cam.x, y: pos[id].y * k + cam.y }; });
    const tracos = tracar(vista.arestas, tela, raioDe);
    /* o pulso (sentido do dinheiro) corre em todas as arestas com alerta só quando são poucas; com muitas, só nas destacadas */
    const poucasComAlerta = vista.arestas.filter(x => x.alerta).length <= 12;
    const muitas = g.arestas.length > MAX_ROTULOS;
    const espacoTela = ESPACO * k;
    const detalhe = vista.nos.length <= 12 || espacoTela >= 80 ? 'completo' : espacoTela >= 52 ? 'curto' : 'minimo';
    const comValores = mostrarValores && !muitas && espacoTela >= 70;
    const principais = new Set(ordenarImportancia(vista.nos.filter(n => n.alerta && n.tipo !== 'grupo')).slice(0, 3).map(n => n.id));
    const t = g.totais;
    const filtrado = vista.nos.length !== g.nos.length || relacao !== 'tudo';

    const cabeca = h('div', { className: 'palco-cabeca' },
      h('div', { className: 'foco-atual' },
        h('span', { className: 'eyebrow' }, 'Conta em foco'),
        h('span', { className: 'foco-id mono', title: g.foco + (g.escolha ? ' (' + g.escolha + ')' : '') }, g.foco),
        carregando ? h('span', { className: 'atualizando', role: 'status' }, h('span', { className: 'giro', 'aria-hidden': 'true' }), 'Atualizando…') : null),
      /* seletores com texto autoexplicativo (sem rótulo visível ao lado), para caber numa linha */
      h('div', { className: 'controles' },
        h('select', { className: 'controle', value: profundidade, onChange: e => aoProfundidade(+e.target.value), 'aria-label': 'Saltos a partir da conta em foco', title: 'Saltos a partir da conta em foco' },
          Array.from({ length: g.limites.profundidade_max }, (_, i) => h('option', { key: i + 1, value: i + 1 }, f.plural(i + 1, 'salto', 'saltos')))),
        h('select', { className: 'controle', value: modoPedido, onChange: e => { setModoPedido(e.target.value); auto.current = true; }, 'aria-label': 'Disposição do grafo', title: 'Disposição: ' + DESCRICAO_DISPOSICAO[modo] },
          DISPOSICOES.map(d => h('option', { key: d.id, value: d.id }, d.id === 'auto' ? 'Auto · ' + (DISPOSICOES.find(x => x.id === escolherDisposicao(g, vista.nos)) || {}).nome : d.nome))),
        h('select', { className: 'controle', value: relacao, onChange: e => { setRelacao(e.target.value); setSel(null); setSeq(null); auto.current = true; }, 'aria-label': 'Relações mostradas no grafo', title: 'Relações mostradas no grafo (filtro só do desenho)' },
          RELACOES.map(r => h('option', { key: r.id, value: r.id }, r.id === 'tudo' ? 'Todas as relações' : r.nome))),
        agrupavel ? h('label', { className: 'alternar', title: 'Reúne contas com uma única ligação à mesma conta e no mesmo papel' },
          h('input', { type: 'checkbox', checked: agrupando, onChange: e => { setAgruparPedido(e.target.checked); setAbertos(new Set()); setSel(null); setSeq(null); auto.current = true; } }), 'Agrupar') : null,
        h('label', { className: 'alternar', title: muitas ? 'Há ' + g.arestas.length + ' arestas: valores e horários ficam ocultos por legibilidade. Passe o ponteiro ou selecione uma aresta.' : 'Valores e horários nas arestas (aparecem quando há espaço)' },
          h('input', { type: 'checkbox', checked: mostrarValores && !muitas, disabled: muitas, onChange: e => setMostrarValores(e.target.checked) }), 'Valores')));

    const resumo = h('p', { className: 'palco-resumo', title: 'Desenhados: as contas e arestas mais perto do foco, com alerta e com mais transações, até os limites. Relacionadas: enviadas ou recebidas pela conta em foco e pelas contas ligadas a ela, até o limite de saltos. Analisadas no recorte (filtros sem os de conta): ' + f.inteiro(t.transacoes_recorte) + '.' },
      h('span', null, h('strong', null, f.inteiro(t.vertices)), ' de ' + f.inteiro(t.contas_relacionadas) + ' contas'),
      h('span', null, h('strong', null, f.inteiro(t.arestas)), ' de ' + f.inteiro(t.arestas_relacionadas) + ' arestas'),
      h('span', null, 'exibindo ', h('strong', null, f.inteiro(t.exibidas)), ' de ' + f.inteiro(t.relacionadas) + ' transações'),
      t.alertas_relacionadas ? h('span', { className: 'alerta-txt' }, '⚠ ' + f.inteiro(t.alertas_relacionadas) + ' com alerta') : null,
      filtrado ? h('span', { className: 'filtro-visual' }, 'no desenho: ' + f.plural(vista.nos.length, 'item', 'itens') + (relacao !== 'tudo' ? ' · ' + RELACOES.find(r => r.id === relacao).nome.toLowerCase() : '')) : null);

    const svg = h('svg', { width: medida.w || 1, height: medida.h || 1, role: 'group',
      onPointerDown: inicio, onPointerMove: mover, onPointerUp: fim, onPointerCancel: fim, onPointerLeave: e => { setDica(null); fim(e); },
      'aria-label': 'Grafo de transações da conta ' + g.foco + ': ' + t.vertices + ' contas e ' + t.arestas + ' arestas. As setas vão da origem para o destino. ' + g.ordem_temporal.resumo },
      h('defs', null,
        [['seta', 'm-seta'], ['seta-alerta', 'm-seta-alerta'], ['seta-seq', 'm-seta-seq']].map(([id, classe]) =>
          h('marker', { key: id, id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' }, h('path', { className: classe, d: 'M 0 0 L 10 5 L 0 10 z' }))),
        h('radialGradient', { id: 'grafo-luz' }, h('stop', { offset: '0%', stopColor: 'rgba(240,68,68,0.20)' }), h('stop', { offset: '100%', stopColor: 'rgba(240,68,68,0)' }))),
      tela[g.foco] ? h('circle', { className: 'luz-foco', cx: tela[g.foco].x, cy: tela[g.foco].y, r: Math.max(120, 260 * k), fill: 'url(#grafo-luz)' }) : null,
      h('g', { className: 'camada-arestas' }, tracos.map(tr => {
        const a = tr.a, kk = chaveVista(a), selecionada = arSel && kk === sel.id, emSeq = naSeq(a), naRota = !!(rota && rota.arestas.has(kk));
        const destacada = arestaDestacada(a);
        const pulso = (a.alerta && !haDestaque && poucasComAlerta) || ((selecionada || emSeq || naRota) && destacada);
        return h('g', Object.assign({ key: kk, className: 'g-aresta' + (a.alerta ? ' alerta' : '') + (a.agrupada ? ' agrupada' : '') + (semOrdem(a) ? ' sem-ordem' : '') + (emSeq ? ' na-sequencia' : '') +
            (a.grupo ? ' de-grupo' : '') + (naRota && !emSeq ? ' caminho' : '') + (selecionada ? ' selecionada' : '') + (destacada ? '' : ' apagada') + (novos.has(a.origem) || novos.has(a.destino) ? ' nova' : ''),
          tabIndex: 0, role: 'button', 'aria-pressed': !!selecionada, 'aria-label': descricaoAresta(a),
          onMouseMove: e => mostrarDica(e, a.origem + ' → ' + a.destino, a.grupo
            ? [{ texto: f.plural(a.arestas, 'aresta', 'arestas') + ' · ' + f.plural(a.n, 'transação', 'transações') }, { texto: a.alerta ? '⚠ ' + f.inteiro(a.alertas) + ' com alerta' : 'sem alerta', alerta: a.alerta }]
            : [{ texto: (a.n > 1 ? f.inteiro(a.n) + ' transações · total ' : '') + f.valor(a.total) + ' ' + a.moeda },
              { texto: horarioAresta(a) + ' · ' + a.ordem_texto }, { texto: a.alerta ? '⚠ ' + f.inteiro(a.alertas) + ' com alerta · maior score ' + a.maior_score : 'sem alerta · maior score ' + a.maior_score, alerta: a.alerta }]),
          onMouseLeave: () => setDica(null) }, ativar(() => (a.grupo ? selecionar(selecionada ? null : { tipo: 'aresta', id: kk }) : selecionar(selecionada ? null : { tipo: 'aresta', id: kk })))),
          h('path', { className: 'alvo', d: tr.d }),
          h('path', { className: 'traco', d: tr.d, markerEnd: 'url(#' + (emSeq || naRota || selecionada ? 'seta-seq' : a.alerta ? 'seta-alerta' : 'seta') + ')' }),
          pulso ? h('path', { className: 'pulso', d: tr.d, 'aria-hidden': 'true' }) : null,
          (comValores || selecionada || emSeq) ? h('text', { x: tr.mx, y: tr.my - 9, textAnchor: 'middle' },
            h('tspan', { x: tr.mx }, rotuloAresta(a)), a.grupo ? null : h('tspan', { className: 'hora', x: tr.mx, dy: 12 }, horarioAresta(a) + (semOrdem(a) ? ' · sem ordem confirmada' : ''))) : null);
      })),
      h('g', { className: 'camada-nos' }, vista.nos.map(n => {
        const p = tela[n.id];
        if (!p) return null;
        const r = raioDe(n.id), selecionado = noSel && n.id === sel.id, grupo = n.tipo === 'grupo', foco = n.tipo === 'foco';
        const mostrarRotulo = detalhe !== 'minimo' || foco || selecionado || sobre === n.id || (haDestaque && destacados.has(n.id)) || principais.has(n.id) || grupo;
        const rotulo = grupo ? n.rotulo : (detalhe === 'completo' || foco || selecionado || sobre === n.id ? n.rotulo : rotuloCurto(n.id));
        const segunda = detalhe === 'completo' || foco || selecionado;
        return h('g', Object.assign({ key: n.id, className: 'g-no' + (foco ? ' foco' : '') + (grupo ? ' grupo' : '') + (n.alerta ? ' alerta' : '') + (selecionado ? ' selecionado' : '') +
            (haDestaque && !destacados.has(n.id) ? ' apagado' : '') + (novos.has(n.id) ? ' nova' : ''),
          transform: 'translate(' + p.x + ' ' + p.y + ')', tabIndex: 0, role: 'button', 'aria-pressed': !!selecionado,
          'aria-label': grupo ? 'Grupo de ' + f.plural(n.membros.length, 'conta', 'contas') + ' que ' + (n.papel === 'enviou' ? 'enviaram' : 'receberam') + ' só por ' + n.pai + (n.alerta ? ', todas ligadas a alerta' : '') + '. Enter seleciona; o painel de seleção expande o grupo.'
            : 'Conta ' + n.id + ', ' + PAPEL[n.tipo] + (n.alerta ? ', ligada a ' + n.alertas_relacionados + ' transações com alerta' : ', sem alerta'),
          onMouseEnter: () => setSobre(n.id),
          onMouseMove: e => mostrarDica(e, grupo ? n.rotulo + ' · ' + (n.papel === 'enviou' ? 'enviaram' : 'receberam') : n.id, grupo
            ? [{ texto: 'só ligadas a ' + n.pai }, { texto: n.alerta ? '⚠ todas ligadas a alerta' : 'sem alerta', alerta: n.alerta }, { texto: 'Selecione para expandir' }]
            : [{ texto: 'Banco ' + n.banco + ' · conta ' + n.conta }, { texto: PAPEL[n.tipo] },
              { texto: n.alerta ? '⚠ ' + f.plural(n.alertas_relacionados, 'transação relacionada com alerta', 'transações relacionadas com alerta') : 'sem alerta', alerta: n.alerta }]),
          onMouseLeave: () => { setDica(null); setSobre(s => (s === n.id ? null : s)); } },
          ativar(() => selecionar(selecionado ? null : { tipo: 'no', id: n.id }))),
          foco ? h('circle', { className: 'halo', r: r + 10 }) : null,
          foco ? h('circle', { className: 'anel', r: r + 5 }) : null,
          selecionado ? h('circle', { className: 'selecao-anel', r: r + 7 }) : null,
          grupo ? h('circle', { className: 'pilha', r, cx: 5, cy: -3 }) : null,
          h('circle', { className: 'corpo', r }),
          grupo ? h('text', { className: 'contagem', y: 4 }, '+' + n.membros.length)
            : n.alerta ? h('text', { className: 'marca-alerta', y: 5, style: { fontSize: Math.round(r * 0.85) + 'px' } }, '!') : h('circle', { className: 'nucleo', r: foco ? 5 : 3.2 }),
          mostrarRotulo ? h('text', { y: r + 14 + (foco ? 3 : 0) }, rotulo) : null,
          mostrarRotulo && segunda && (foco || n.alerta) ? h('text', { y: r + 26 + (foco ? 3 : 0) },
            foco ? h('tspan', { className: 'marca-foco' }, 'foco') : null, foco && n.alerta ? ' · ' : null,
            n.alerta && !grupo ? h('tspan', { className: 'marca-alerta' }, 'alerta') : null) : null);
      })));

    const legendaRapida = h('ul', { className: 'legenda-rapida sobreposta', 'aria-label': 'Legenda rápida do grafo' },
      h('li', null, h('svg', { viewBox: '0 0 28 16', 'aria-hidden': 'true' }, h('g', { className: 'g-no foco' }, h('circle', { className: 'anel', cx: 14, cy: 8, r: 7 }), h('circle', { className: 'corpo', cx: 14, cy: 8, r: 4.5 }))), 'Foco'),
      h('li', null, h('svg', { viewBox: '0 0 28 16', 'aria-hidden': 'true' }, h('g', { className: 'g-no alerta' }, h('circle', { className: 'corpo', cx: 14, cy: 8, r: 5.5 }))), 'Ligada a alerta'),
      h('li', null, h('svg', { viewBox: '0 0 28 16', 'aria-hidden': 'true' }, h('g', { className: 'g-aresta alerta' }, h('path', { className: 'traco', d: 'M 2 8 L 26 8' }))), 'Caminho com alerta'),
      h('li', null, h('svg', { viewBox: '0 0 28 16', 'aria-hidden': 'true' }, h('g', { className: 'g-aresta sem-ordem' }, h('path', { className: 'traco', d: 'M 2 8 L 26 8' }))), 'Sem ordem confirmada'),
      Object.keys(vista.grupos).length ? h('li', null, h('svg', { viewBox: '0 0 28 16', 'aria-hidden': 'true' }, h('g', { className: 'g-no grupo' }, h('circle', { className: 'pilha', cx: 16, cy: 8, r: 5 }), h('circle', { className: 'corpo', cx: 12, cy: 8, r: 5 }))), 'Grupo') : null);

    const palco = h('div', { className: 'palco', ref: refPalco },
      cabeca, resumo,
      h('div', { className: 'grafo-moldura' + (carregando ? ' atualizando' : ''), ref: refMoldura, tabIndex: 0, onKeyDown: teclas, role: 'region',
        'aria-label': 'Área do grafo. Atalhos: + e − para zoom, 0 para ajustar à tela, setas para mover, Esc limpa a seleção.' },
        svg,
        h('div', { className: 'grafo-controles', role: 'group', 'aria-label': 'Navegação do grafo' },
          h('button', { type: 'button', className: 'botao', onClick: () => ajustar(), 'aria-label': 'Ajustar à tela', 'data-dica': 'Ajustar à tela (0)' }, h(Icone, { nome: 'ajustar' })),
          h('button', { type: 'button', className: 'botao', onClick: () => ampliar(1.25), 'aria-label': 'Aproximar', 'data-dica': 'Aproximar (+)' }, h(Icone, { nome: 'mais' })),
          h('button', { type: 'button', className: 'botao', onClick: () => ampliar(1 / 1.25), 'aria-label': 'Afastar', 'data-dica': 'Afastar (−)' }, h(Icone, { nome: 'menos' })),
          h('button', { type: 'button', className: 'botao', onClick: centralizar, 'aria-label': noSel ? 'Centralizar na conta selecionada' : 'Centralizar na conta em foco', 'data-dica': noSel ? 'Centralizar na seleção' : 'Centralizar no foco' }, h(IconeControle, { nome: 'centro' })),
          h('button', { type: 'button', className: 'botao', onClick: alternarTelaCheia, 'aria-pressed': telaCheia, 'aria-label': telaCheia ? 'Sair da tela cheia' : 'Tela cheia', 'data-dica': telaCheia ? 'Sair da tela cheia' : 'Tela cheia' },
            h(IconeControle, { nome: telaCheia ? 'sairTelaCheia' : 'telaCheia' }))),
        legendaRapida,
        h('span', { className: 'grafo-zoom', 'aria-hidden': 'true' }, f.numero(k * 100, 0) + '%' + (auto.current ? ' · ajustado' : '')),
        h('span', { className: 'grafo-atalhos fraco', 'aria-hidden': 'true' }, 'Ctrl + roda: zoom · arraste: mover'),
        dica ? h('div', { className: 'grafo-dica', style: { left: dica.x, top: dica.y }, 'aria-hidden': 'true' }, h('strong', null, dica.titulo), dica.linhas.map((l, i) => h('div', { key: i, className: l.alerta ? 'alerta-txt' : '' }, l.texto))) : null));

    /* depois de ações que tiram o próprio botão da tela, o foco do teclado volta para a área do grafo */
    const focarMoldura = () => { if (refMoldura.current) refMoldura.current.focus({ preventScroll: true }); };
    const contaFiltrada = !!(filtros && (filtros.conta_origem || filtros.conta_destino));
    /* inspetor e extras ficam fora do caminho de cada quadro (zoom, arraste, animação): só mudam com dados e seleção */
    const inspetor = React.useMemo(() => h('aside', { className: 'inspetor', 'aria-label': 'Leitura e seleção do grafo' },
      h(Leitura, { g, ranking, vista, contaFiltrada, carregando }),
      h('section', { className: 'inspetor-secao selecao-caixa', 'aria-live': 'polite', 'aria-label': 'Seleção no grafo' },
        h(Selecao, { g, vista, noSel, arSel, rota, analiseId, filtros: Object.assign({}, filtros, { conta_origem: '', conta_destino: '' }), total,
          aoFocar: conta => { aoFocar(conta); focarMoldura(); }, aoFiltrarTabela,
          aoExpandir: id => { expandir(id); focarMoldura(); }, aoLimpar: () => { setSel(null); setSeq(null); focarMoldura(); }, maiorScoreDe })),
      h(Sequencias, { ordem: g.ordem_temporal, selecionada: seq, aoSelecionar: escolherSequencia, total })),
    [g, ranking, vista, sel, seq, carregando, analiseId, filtros, total, contaFiltrada, aoFocar, aoFiltrarTabela]);

    const extras = React.useMemo(() => h('div', { className: 'grade investigacao-extras' },
        h(LegendaGrafo, { g, modo }),
        h('details', { className: 'bloco' }, h('summary', null, h(Icone, { nome: 'tabela' }), 'Lista das ' + g.arestas.length + ' arestas desenhadas (alternativa em texto ao grafo)'),
          h('div', { className: 'rolagem' }, h('table', null,
            h('thead', null, h('tr', null, ['Origem', 'Destino', 'Transações', 'Valor total', 'Moeda', 'Horário', 'Ordem no tempo', 'Com alerta', 'Ação'].map((c, i) => h('th', { key: i, scope: 'col' }, c)))),
            h('tbody', null, g.arestas.map(a => h('tr', { key: chaveAresta(a), className: a.alerta ? 'com-alerta' : '' },
              h('td', { className: 'mono' }, a.origem), h('td', { className: 'mono' }, a.destino), h('td', { className: 'num' }, f.inteiro(a.n)),
              h('td', { className: 'num' }, f.valor(a.total)), h('td', null, a.moeda), h('td', null, horarioAresta(a)), h('td', { style: { whiteSpace: 'normal' } }, a.ordem_texto),
              h('td', null, a.alerta ? h('strong', null, '⚠ Sim (' + a.alertas + ')') : 'Não'),
              h('td', null, h('button', { type: 'button', className: 'botao pequeno', onClick: () => { abrirGruposDe([a.origem, a.destino]); setRelacao('tudo'); selecionar({ tipo: 'aresta', id: chaveAresta(a) }); if (refArea.current) refArea.current.scrollIntoView({ block: 'start', behavior: reduzirMovimento() ? 'auto' : 'smooth' }); },
                'aria-label': 'Selecionar a aresta de ' + a.origem + ' para ' + a.destino + ' em ' + a.moeda }, 'Selecionar')))))))),
        g.tipologias.disponivel && Object.keys(g.tipologias.contagem).length ? h(Legenda, null, h('strong', null, 'Tipologias registradas entre as transações relacionadas: '),
          Object.entries(g.tipologias.contagem).map(([kt, v]) => kt + ' (' + f.inteiro(v) + ')').join(', ') + '.') : null),
    [g, modo, vista, relacao, agrupando, abertos]);

    return h(React.Fragment, null,
      h('div', { className: 'area-investigacao' + (telaCheia ? ' tela-cheia' : ''), ref: refArea, style: { '--altura-area': altura + 'px' } },
        trilho, palco, inspetor),
      extras);
  }


  /* Área de investigação: lista de contas (trilho) + grafo + leitura e seleção, na altura útil da tela.
     Estados sem grafo (sem foco, ambíguo, vazio, erro, carregando) ocupam o lugar do grafo, mantendo o trilho. */
  function BlocoGrafo(props) {
    const { carga, trilho } = props;
    const refArea = React.useRef(null), refPalco = React.useRef(null);
    const altura = useAlturaUtil(refPalco);
    const g = carga.dados;
    const pronto = g && !g.sem_foco && !g.vazio && !g.ambiguo && !carga.erro;
    if (pronto) return h(Grafo, Object.assign({ g, carregando: carga.carregando }, props));
    let estado;
    if (carga.erro) estado = h(Erro, { erro: carga.erro });
    else if (!g || (carga.carregando && (g.sem_foco || g.vazio || g.ambiguo))) {
      /* enquanto a consulta não volta, não mostra o estado anterior como se fosse o atual */
      estado = carga.carregando || !g ? h('div', { className: 'palco-carregando', role: 'status' }, h(window.NW.Rede, { mini: true }), h('p', null, 'Montando o grafo…'), h('span', { className: 'sr' }, 'Montando o grafo…'))
        : h(Vazio, null, 'Nenhuma conta em foco.');
    } else if (g.ambiguo) estado = h(Vazio, null, h('p', null, g.motivo),
      h('div', { className: 'linha', style: { marginTop: 8, justifyContent: 'center' } }, g.candidatas.map(c => h('button', { key: c, type: 'button', className: 'botao pequeno mono', onClick: () => props.aoFocar(c) }, c))));
    else if (g.sem_foco) estado = h(Vazio, null, g.motivo);
    else estado = h(Vazio, null, h('p', null, h('strong', null, 'Conta em foco: '), h('span', { className: 'mono' }, g.foco)), h('p', null, g.motivo));
    return h('div', { className: 'area-investigacao sem-grafo', ref: refArea, style: { '--altura-area': altura + 'px' } },
      trilho, h('div', { className: 'palco palco-estado', ref: refPalco }, estado));
  }

  window.NW.BlocoGrafo = BlocoGrafo;
  window.NW.grafo = { posicionar, dispRadial, dispCamadas, dispCircular, dispForcas, enquadrar, agrupar, filtrarRelacoes, caminho, tracar, rotuloAresta, rotuloCurto, chaveAresta, leituraDoGrafo };
})();
