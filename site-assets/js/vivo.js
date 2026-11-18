/* NodeWatch · "The Living Intelligence Network" — sistema de movimento do site.
   Camada separada do conteúdo e da lógica (site.js e artigo.js continuam iguais em comportamento):
     · Ambiente: rede neural em canvas (nós, conexões, pulsos de transação, reação ao cursor e ao scroll).
     · Abertura: título revelado letra a letra, luz percorrendo as letras e brilho que segue o mouse.
     · Scroll: revelações com personalidade por tipo, parallax em camadas, progresso de leitura e humor por bloco.
     · Superfícies: luz de borda por proximidade, inclinação 3D, borda viva e botões magnéticos.
     · Blocos: fluxos SVG (ciclo, fan-out, fan-in, ritmo), contadores que terminam nos números originais,
       barras progressivas, pipeline pulsando e pictogramas de observabilidade.
   Regras: nada de servidor nem CDN; um único laço requestAnimationFrame; leituras de layout antes das escritas;
   sem movimento quando o sistema pede "reduzir movimento"; nenhuma camada decorativa intercepta cliques. */
(function () {
  "use strict";

  var doc = document, html = doc.documentElement;
  if (!doc.querySelector || !window.requestAnimationFrame || window.__nwVivo) return;
  window.__nwVivo = true;

  /* ---------------------------------------------------------------- capacidades */

  function mq(q) { return window.matchMedia ? window.matchMedia(q) : null; }
  var mqReduz = mq("(prefers-reduced-motion: reduce)");
  var reduz = !!(mqReduz && mqReduz.matches);
  var mqFino = mq("(hover: hover) and (pointer: fine)");
  var fino = !!(mqFino && mqFino.matches);
  var nucleos = navigator.hardwareConcurrency || 4;
  var memoria = navigator.deviceMemory || 4;
  var economia = !!(navigator.connection && navigator.connection.saveData);
  var fraco = economia || nucleos <= 2 || memoria <= 2;
  var estreito = window.innerWidth < 768;
  var temVidro = window.CSS && CSS.supports && (CSS.supports("backdrop-filter", "blur(2px)") || CSS.supports("-webkit-backdrop-filter", "blur(2px)"));

  html.classList.add("nv-pronto");
  if (!reduz) html.classList.add("nv-anima");
  if (fino) html.classList.add("nv-fino");
  if (!reduz && !fraco && !estreito && nucleos >= 6 && temVidro) html.classList.add("nv-alto");

  var NS = "http://www.w3.org/2000/svg";
  var agora = function () { return window.performance && performance.now ? performance.now() : Date.now(); };

  /* Estado compartilhado: lido e escrito só dentro do laço de quadros. */
  var E = {
    mx: -9999, my: -9999, ponteiro: false, sujoPonteiro: false,
    sy: window.scrollY || 0, syAnt: window.scrollY || 0, vel: 0, sujoRolagem: true,
    vw: window.innerWidth, vh: window.innerHeight, docH: html.scrollHeight,
    secao: "inicio", cartaoAtivo: null
  };

  /* ---------------------------------------------------------------- utilitários */

  function $(s, raiz) { return (raiz || doc).querySelector(s); }
  function $$(s, raiz) { return Array.prototype.slice.call((raiz || doc).querySelectorAll(s)); }
  function el(tag, cls, pai) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (pai) pai.appendChild(e);
    return e;
  }
  function svg(tag, attrs, pai) {
    var e = doc.createElementNS(NS, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    if (pai) pai.appendChild(e);
    return e;
  }
  function decorativo(e) { e.setAttribute("aria-hidden", "true"); return e; }
  function limitar(v, a, b) { return v < a ? a : v > b ? b : v; }
  function naTela(e) {
    var r = e.getBoundingClientRect();
    return r.bottom > 0 && r.top < (window.innerHeight || E.vh);
  }
  function observar(cb, opcoes) {
    if (!("IntersectionObserver" in window)) return null;
    return new IntersectionObserver(cb, opcoes);
  }
  var fila = []; // tarefas do laço
  function noQuadro(fn) { fila.push(fn); }

  /* =================================================================
     1 · Ambiente vivo
     ================================================================= */

  var ambiente = decorativo(el("div", "nv-ambiente"));
  ambiente.innerHTML =
    '<div class="nv-aurora"><i class="nv-a1"></i><i class="nv-a2"></i><i class="nv-a3"></i><i class="nv-a4"></i></div>' +
    '<div class="nv-grade"><div class="nv-grade-plano"></div></div>' +
    '<canvas class="nv-rede"></canvas>' +
    '<div class="nv-feixes"><i></i><i></i><i></i></div>' +
    '<div class="nv-foco"></div>' +
    '<div class="nv-vinheta"></div>';
  doc.body.insertBefore(ambiente, doc.body.firstChild);
  var aurora = $(".nv-aurora", ambiente);
  var foco = $(".nv-foco", ambiente);

  /* Definições SVG compartilhadas (brilhos das partículas e gradientes). */
  var defsSvg = decorativo(svg("svg", { width: 0, height: 0, focusable: "false", style: "position:absolute;width:0;height:0;overflow:hidden" }));
  defsSvg.innerHTML =
    "<defs>" +
    brilho("nv-brilho-c", "56,225,255") + brilho("nv-brilho-r", "255,90,90") + brilho("nv-brilho-v", "167,150,255") + brilho("nv-brilho-a", "242,181,68") +
    '<linearGradient id="nv-grad-heroi" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="600" y2="520">' +
    '<stop offset="0" stop-color="#2a2a30"/><stop offset="0.55" stop-color="#3b3b45"/><stop offset="1" stop-color="rgb(56,225,255)" stop-opacity="0.55"/></linearGradient>' +
    '<linearGradient id="nv-grad-scan" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgb(56,225,255)" stop-opacity="0"/>' +
    '<stop offset="0.5" stop-color="rgb(56,225,255)" stop-opacity="0.55"/><stop offset="1" stop-color="rgb(56,225,255)" stop-opacity="0"/></linearGradient>' +
    "</defs>";
  doc.body.appendChild(defsSvg);
  function brilho(id, rgb) {
    return '<radialGradient id="' + id + '"><stop offset="0" stop-color="rgb(' + rgb + ')" stop-opacity="0.95"/>' +
      '<stop offset="0.35" stop-color="rgb(' + rgb + ')" stop-opacity="0.35"/><stop offset="1" stop-color="rgb(' + rgb + ')" stop-opacity="0"/></radialGradient>';
  }

  /* ---------- Rede neural em canvas ---------- */

  var HUMORES = {
    inicio:   { c: [56, 225, 255],  alerta: 0.2,  ritmo: 1,   vel: 1 },
    problema: { c: [255, 140, 140], alerta: 0.42, ritmo: 1.1, vel: 1 },
    modelo:   { c: [160, 145, 255], alerta: 0.12, ritmo: 1.6, vel: 1.1 },
    metricas: { c: [86, 205, 255],  alerta: 0.1,  ritmo: 0.8, vel: 0.7 },
    producao: { c: [56, 225, 255],  alerta: 0.14, ritmo: 2.3, vel: 1.7 },
    painel:   { c: [96, 215, 255],  alerta: 0.36, ritmo: 1.2, vel: 1 },
    escopo:   { c: [115, 232, 200], alerta: 0.04, ritmo: 0.6, vel: 0.55 }
  };

  function criarRede(canvas) {
    var ctx = canvas.getContext && canvas.getContext("2d");
    if (!ctx) return null;
    var W = 0, H = 0, dpr = 1, M = 70;
    var nos = [], pulsos = [], ondas = [];
    var t0 = agora(), espera = 300;
    var qualidade = fraco ? 0.55 : estreito ? 0.62 : 1;
    var L = estreito ? 118 : 150;
    var humor = { c: HUMORES.inicio.c.slice(), alerta: 0.2, ritmo: 1, vel: 1 };
    var cam = { x: 0, y: 0 };
    var sprites = {};
    var medidas = { n: 0, soma: 0, feito: false };
    var parado = false;

    function sprite(rgb) {
      var k = rgb.join(",");
      if (sprites[k]) return sprites[k];
      var c = doc.createElement("canvas"), s = 64;
      c.width = c.height = s;
      var g = c.getContext("2d"), gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, "rgba(" + k + ",0.9)");
      gr.addColorStop(0.25, "rgba(" + k + ",0.35)");
      gr.addColorStop(1, "rgba(" + k + ",0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
      return (sprites[k] = c);
    }
    var VERMELHO = [255, 84, 84];

    function dimensionar(forcar) {
      var w = window.innerWidth, h = Math.max(window.innerHeight, html.clientHeight);
      // No celular, a barra de endereço muda a altura o tempo todo: só refaz em mudança real.
      if (!forcar && w === W && Math.abs(h - H) < 140) return;
      dpr = Math.min(window.devicePixelRatio || 1, qualidade < 1 ? 1.25 : 1.75);
      W = w; H = h;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      popular();
      if (parado) desenhar(agora(), 16);
    }

    function popular() {
      var area = W * H;
      var n = Math.round(limitar(area / (estreito ? 8200 : 11500), 30, 132) * qualidade);
      var ox = W < 960 ? W * 0.5 : W * 0.3, oy = H * 0.4, dmax = Math.sqrt(W * W + H * H);
      while (nos.length > n) nos.pop();
      while (nos.length < n) {
        var z = 0.22 + Math.pow(Math.random(), 1.5) * 0.78;
        var x = Math.random() * W, y = Math.random() * (H + 2 * M) - M;
        var d = Math.sqrt((x - ox) * (x - ox) + (y - oy) * (y - oy));
        nos.push({
          x: x, y: y, z: z,
          a: Math.random() * 6.283, w: (Math.random() - 0.5) * 0.0008, v: 0.009 + Math.random() * 0.017, f: Math.random() * 6.283,
          b: 0, nasce: 120 + d / dmax * 1500 + Math.random() * 300, sx: 0, sy: 0, ok: false
        });
      }
    }

    function mascara(x) {
      // A rede vive sobretudo nas margens: atrás da coluna de texto ela fica bem mais discreta.
      if (W < 900) return 0.5;
      var meia = Math.min(W, 1164) / 2 - 10, d = Math.abs(x - W / 2) - meia;
      if (d <= -140) return 0.3;
      if (d >= 40) return 1;
      return 0.3 + (d + 140) / 180 * 0.7;
    }

    function vizinho(i) {
      var a = nos[i], melhores = [];
      for (var j = 0; j < nos.length; j++) {
        if (j === i) continue;
        var b = nos[j];
        if (!b.ok || Math.abs(a.z - b.z) > 0.38) continue;
        var dx = b.sx - a.sx, dy = b.sy - a.sy;
        if (dx * dx + dy * dy < L * L) melhores.push(j);
      }
      return melhores.length ? melhores[(Math.random() * melhores.length) | 0] : -1;
    }

    function lancarPulso(origem, saltos) {
      if (pulsos.length > 26) return;
      var i = origem;
      if (i === undefined || i < 0) {
        for (var tent = 0; tent < 6; tent++) {
          var c = (Math.random() * nos.length) | 0;
          if (nos[c].ok && nos[c].sx > 0 && nos[c].sx < W && nos[c].sy > 0 && nos[c].sy < H) { i = c; break; }
        }
      }
      if (i === undefined || i < 0) return;
      var j = vizinho(i);
      if (j < 0) return;
      pulsos.push({ a: i, b: j, t: 0, dur: 650 + Math.random() * 700, al: Math.random() < humor.alerta, s: saltos || 0 });
    }

    var proximoPulso = 600;

    function choque(x, y, vermelho) {
      ondas.push({ x: x, y: y, r: 4, max: estreito ? 220 : 320, al: !!vermelho });
      if (ondas.length > 6) ondas.shift();
    }

    function desenhar(t, dt) {
      var intro = reduz ? 0.75 : limitar((t - t0 - espera) / 1700, 0, 1);
      intro = 1 - Math.pow(1 - intro, 3);
      var alvo = HUMORES[E.secao] || HUMORES.inicio;
      var k = 1 - Math.pow(0.975, dt / 16.7);
      for (var c = 0; c < 3; c++) humor.c[c] += (alvo.c[c] - humor.c[c]) * k;
      humor.alerta += (alvo.alerta - humor.alerta) * k;
      humor.ritmo += (alvo.ritmo - humor.ritmo) * k;
      humor.vel += (alvo.vel - humor.vel) * k;
      var R = humor.c[0] | 0, G = humor.c[1] | 0, B = humor.c[2] | 0;
      var rgb = R + "," + G + "," + B;

      // Câmera: o mouse desloca as camadas conforme a profundidade (parallax 3D); no toque, um "sensor" passeia sozinho.
      var mx = E.mx, my = E.my, ativo = E.ponteiro;
      if (!fino && !reduz) {
        mx = W * (0.5 + 0.4 * Math.sin(t * 0.00011));
        my = H * (0.5 + 0.34 * Math.sin(t * 0.00017 + 1.3));
        ativo = true;
      }
      var cx = fino && E.ponteiro ? (E.mx - W / 2) * -0.04 : 0, cy = fino && E.ponteiro ? (E.my - H / 2) * -0.04 : 0;
      cam.x += (cx - cam.x) * 0.06;
      cam.y += (cy - cam.y) * 0.06;
      var turbo = 1 + Math.min(2.5, Math.abs(E.vel) * 0.025);

      var i, j, n, m;
      var raioMouse = fino ? 175 : 150, forcaMouse = fino ? 1 : 0.55;
      var Hm = H + 2 * M;
      for (i = 0; i < nos.length; i++) {
        n = nos[i];
        if (!reduz) {
          n.a += n.w * dt + Math.sin(t * 0.00021 + n.f) * 0.0006 * dt;
          var sp = n.v * (0.35 + n.z) * humor.vel * turbo;
          n.x += Math.cos(n.a) * sp * dt;
          n.y += Math.sin(n.a) * sp * dt;
          if (n.x < -M) n.x += W + 2 * M; else if (n.x > W + M) n.x -= W + 2 * M;
        }
        var py = n.y - E.sy * n.z * 0.22 + cam.y * n.z + M;
        py = ((py % Hm) + Hm) % Hm - M;
        n.sx = n.x + cam.x * n.z;
        n.sy = py;
        n.ok = (t - t0) > n.nasce || reduz;
        n.b *= Math.pow(0.94, dt / 16.7);
        if (ativo && !reduz) {
          var dx = n.sx - mx, dy = n.sy - my, d2 = dx * dx + dy * dy;
          if (d2 < raioMouse * raioMouse) {
            var d = Math.sqrt(d2) || 1, q = 1 - d / raioMouse;
            n.x += dx / d * q * 0.9 * forcaMouse * (dt / 16.7);
            n.y += dy / d * q * 0.9 * forcaMouse * (dt / 16.7);
            if (q * 0.65 * forcaMouse > n.b) n.b = q * 0.65 * forcaMouse;
          }
        }
      }

      // Ondas de choque dos cliques empurram e acendem os nós.
      for (m = ondas.length - 1; m >= 0; m--) {
        var o = ondas[m];
        o.r += dt * 0.55;
        var vida = 1 - o.r / o.max;
        if (vida <= 0) { ondas.splice(m, 1); continue; }
        for (i = 0; i < nos.length; i++) {
          n = nos[i];
          var ox = n.sx - o.x, oy = n.sy - o.y, od = Math.sqrt(ox * ox + oy * oy) || 1;
          if (Math.abs(od - o.r) < 26) {
            n.x += ox / od * 2.2 * vida;
            n.y += oy / od * 2.2 * vida;
            if (vida > n.b) n.b = vida;
          }
        }
      }

      ctx.clearRect(0, 0, W, H);

      // Conexões: aparecem e somem conforme os nós se aproximam; camadas de profundidade parecidas se ligam.
      var L2 = L * L;
      for (i = 0; i < nos.length; i++) {
        n = nos[i];
        if (!n.ok) continue;
        var fi = reduz ? 1 : limitar((t - t0 - n.nasce) / 700, 0, 1);
        for (j = i + 1; j < nos.length; j++) {
          m = nos[j];
          if (!m.ok) continue;
          var ddx = m.sx - n.sx;
          if (ddx > L || ddx < -L) continue;
          var ddy = m.sy - n.sy;
          if (ddy > L || ddy < -L) continue;
          var dd = ddx * ddx + ddy * ddy;
          if (dd > L2 || Math.abs(n.z - m.z) > 0.38) continue;
          var kk = 1 - Math.sqrt(dd) / L;
          var midx = (n.sx + m.sx) / 2, midy = (n.sy + m.sy) / 2;
          var al = kk * kk * 0.5 * Math.min(n.z, m.z) * mascara(midx) * intro * fi * Math.min(1, limitar((t - t0 - m.nasce) / 700, 0, 1) + (reduz ? 1 : 0));
          if (ativo) {
            var mdx = midx - mx, mdy = midy - my, md = mdx * mdx + mdy * mdy;
            if (md < 40000) al += (1 - Math.sqrt(md) / 200) * 0.32 * kk * intro;
          }
          al += (n.b + m.b) * 0.18 * kk;
          if (al < 0.012) continue;
          ctx.strokeStyle = "rgba(" + rgb + "," + (al > 0.85 ? 0.85 : al).toFixed(3) + ")";
          ctx.lineWidth = 0.45 + Math.min(n.z, m.z) * 0.65;
          ctx.beginPath();
          ctx.moveTo(n.sx, n.sy);
          ctx.lineTo(m.sx, m.sy);
          ctx.stroke();
        }
      }

      // Linhas do "sensor" (cursor) até os nós mais próximos.
      if (ativo && intro > 0.2 && !reduz) {
        var lig = 0;
        for (i = 0; i < nos.length && lig < 6; i++) {
          n = nos[i];
          if (!n.ok) continue;
          var cdx = n.sx - mx, cdy = n.sy - my, cd = Math.sqrt(cdx * cdx + cdy * cdy);
          if (cd < 140) {
            lig++;
            ctx.strokeStyle = "rgba(" + rgb + "," + ((1 - cd / 140) * (fino ? 0.38 : 0.2) * intro).toFixed(3) + ")";
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(mx, my);
            ctx.lineTo(n.sx, n.sy);
            ctx.stroke();
          }
        }
      }

      // Nós e brilhos.
      ctx.globalCompositeOperation = "lighter";
      var spr = sprite(alvo.c), sprV = sprite(VERMELHO);
      for (i = 0; i < nos.length; i++) {
        n = nos[i];
        if (!n.ok || n.sy < -20 || n.sy > H + 20) continue;
        var fa = reduz ? 1 : limitar((t - t0 - n.nasce) / 600, 0, 1);
        var mk = mascara(n.sx);
        var a1 = ((0.25 + n.z * 0.55) * mk * intro + n.b * 0.8) * fa;
        var rr = 0.55 + n.z * 1.45 + n.b * 1.6;
        ctx.globalAlpha = a1 > 1 ? 1 : a1;
        ctx.fillStyle = "rgb(" + (200 + R * 0.2 | 0) + "," + (200 + G * 0.2 | 0) + "," + (200 + B * 0.2 | 0) + ")";
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, rr, 0, 6.283);
        ctx.fill();
        if (n.z > 0.72 || n.b > 0.08) {
          var s = 10 + n.z * 20 + n.b * 34;
          ctx.globalAlpha = Math.min(1, (0.22 * n.z * mk * intro + n.b * 0.75) * fa);
          ctx.drawImage(n.br ? sprV : spr, n.sx - s / 2, n.sy - s / 2, s, s);
        }
        if (n.br && n.b < 0.05) n.br = false;
      }

      // Pulsos: transações percorrendo as conexões; os vermelhos são os suspeitos.
      if (!reduz && intro > 0.35) {
        proximoPulso -= dt * humor.ritmo * turbo;
        if (proximoPulso <= 0) {
          lancarPulso();
          proximoPulso = 230 + Math.random() * 380;
        }
      }
      for (m = pulsos.length - 1; m >= 0; m--) {
        var p = pulsos[m];
        p.t += dt;
        var pa = nos[p.a], pb = nos[p.b];
        if (!pa || !pb) { pulsos.splice(m, 1); continue; }
        var kt = limitar(p.t / p.dur, 0, 1), e = kt < 0.5 ? 2 * kt * kt : 1 - Math.pow(-2 * kt + 2, 2) / 2;
        var x = pa.sx + (pb.sx - pa.sx) * e, y = pa.sy + (pb.sy - pa.sy) * e;
        var dxp = pb.sx - pa.sx, dyp = pb.sy - pa.sy, lp = Math.sqrt(dxp * dxp + dyp * dyp) || 1;
        if (lp > L * 1.6) { pulsos.splice(m, 1); continue; } // a conexão "quebrou" com a rolagem
        var ux = dxp / lp, uy = dyp / lp, cauda = 26;
        var cor = p.al ? "255,96,96" : rgb;
        var gr = ctx.createLinearGradient(x - ux * cauda, y - uy * cauda, x, y);
        gr.addColorStop(0, "rgba(" + cor + ",0)");
        gr.addColorStop(1, "rgba(" + cor + ",0.9)");
        ctx.globalAlpha = 1;
        ctx.strokeStyle = gr;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x - ux * cauda, y - uy * cauda);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.globalAlpha = 0.95;
        ctx.drawImage(p.al ? sprV : spr, x - 13, y - 13, 26, 26);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, 6.283);
        ctx.fill();
        if (kt >= 1) {
          pulsos.splice(m, 1);
          pb.b = 1;
          if (p.al) { pb.br = true; ondas.push({ x: pb.sx, y: pb.sy, r: 2, max: 46, al: true, fraca: true }); }
          if (p.s < 3 && Math.random() < 0.6) lancarPulso(p.b, p.s + 1);
        }
      }

      // Anéis das ondas.
      for (m = 0; m < ondas.length; m++) {
        var on = ondas[m], v = 1 - on.r / on.max;
        ctx.globalAlpha = v * (on.fraca ? 0.6 : 0.45);
        ctx.strokeStyle = on.al ? "rgb(255,100,100)" : "rgb(" + rgb + ")";
        ctx.lineWidth = on.fraca ? 1 : 1.4;
        ctx.beginPath();
        ctx.arc(on.x, on.y, on.r, 0, 6.283);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      // Ajuste automático de qualidade: se o aparelho não sustenta o ritmo, a rede fica mais leve.
      if (!medidas.feito && t - t0 > 2600 && dt < 120) {
        medidas.n++;
        medidas.soma += dt;
        if (medidas.n >= 120) {
          medidas.feito = true;
          if (medidas.soma / medidas.n > 24) {
            qualidade *= 0.6;
            html.classList.remove("nv-alto");
            dimensionar(true);
          }
        }
      }
    }

    dimensionar(true);

    return {
      dimensionar: dimensionar,
      desenhar: desenhar,
      choque: choque,
      parar: function () { parado = true; },
      estatico: function () { parado = true; desenhar(agora() + 5000, 16); }
    };
  }

  var rede = criarRede($(".nv-rede", ambiente));
  if (rede && reduz) rede.estatico();
  if (rede && !reduz) noQuadro(function (t, dt) { rede.desenhar(t, dt); });

  /* Luz do cursor, aurora e grade acompanham o scroll em velocidades diferentes. */
  noQuadro(function () {
    if (E.sujoPonteiro && fino && E.ponteiro) {
      foco.style.transform = "translate3d(" + E.mx + "px," + E.my + "px,0)";
    }
    if (E.sujoRolagem && aurora) {
      aurora.style.transform = "translate3d(0," + (Math.sin(E.sy / 1500) * 70 - E.sy * 0.015 % 60).toFixed(1) + "px,0)";
    }
  });

  /* =================================================================
     2 · Abertura: título, textura do topo e coreografia
     ================================================================= */

  var h1 = doc.getElementById("titulo-inicio");
  var letras = [];
  var marcaTitulo = null;
  (function dividirTitulo() {
    if (!h1) return;
    var tn = h1.firstChild;
    if (!tn || tn.nodeType !== 3) return;
    var m = tn.nodeValue.match(/^(\s*)(\S+)(\s*)$/);
    if (!m) return;
    var palavra = m[2], corte = palavra.indexOf("Watch");
    var frag = doc.createDocumentFragment();
    if (m[1]) frag.appendChild(doc.createTextNode(m[1]));
    marcaTitulo = decorativo(el("span", "nv-marca-titulo"));
    for (var i = 0; i < palavra.length; i++) {
      var s = el("span", "nv-letra" + (corte > 0 && i >= corte ? " nv-watch" : ""), marcaTitulo);
      s.textContent = palavra.charAt(i);
      s.style.setProperty("--nv-i", i);
      letras.push(s);
    }
    frag.appendChild(marcaTitulo);
    var leitor = el("span", "sr");
    leitor.textContent = palavra; // leitores de tela continuam lendo "NodeWatch"
    frag.appendChild(leitor);
    frag.appendChild(doc.createTextNode(m[3] || " "));
    h1.replaceChild(frag, tn);
    h1.classList.add("nv-dividido");

    var t = agora();
    // Só coreografa letra a letra se o script chegou antes da entrada do título; senão, usa a entrada simples.
    if (html.classList.contains("nv-intro") && !reduz && t < 520) {
      h1.classList.add("nv-letras-animam");
      marcaTitulo.style.setProperty("--nv-base", Math.round(560 - t) + "ms");
      marcaTitulo.classList.add("nv-entrando");
      setTimeout(function () { marcaTitulo.classList.remove("nv-entrando"); }, 560 - t + letras.length * 55 + 1400);
    }
    medirLetras();
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(medirLetras);
  })();

  function medirLetras() {
    if (!marcaTitulo) return;
    var w = marcaTitulo.offsetWidth, base = marcaTitulo.offsetLeft;
    var mesmoPai = letras.length && letras[0].offsetParent === marcaTitulo.offsetParent;
    var acc = 0;
    letras.forEach(function (l) {
      var off = mesmoPai ? l.offsetLeft - base : acc;
      acc += l.offsetWidth;
      l.style.setProperty("--nv-off", off + "px");
      l.style.setProperty("--nv-w", w + "px");
    });
  }

  var heroi = $("#inicio");
  var heroiVisivel = true;
  var textura = $(".heroi-textura");

  (function animarTextura() {
    if (!textura) return;
    var linhas = $("g:first-child path", textura);
    if (linhas) linhas.setAttribute("pathLength", "1");
    $$(".heroi-ciclo path", textura).forEach(function (p) { p.setAttribute("pathLength", "1"); });
    if (reduz) return;
    var trilhas = [
      ["M60 80 L190 40 L300 120 L420 60 L540 140", "8s", "c", "0s"],
      ["M120 300 L210 430 L350 470 L470 400 L560 380", "9.5s", "c", "-3s"],
      ["M190 40 L230 210 L300 120", "5.5s", "v", "-1s"],
      ["M420 60 L470 260 L560 380", "6.5s", "c", "-2.2s"],
      ["M330 330 L470 400 L470 260 Z", "3.6s", "r", "0s"],
      ["M330 330 L470 400 L470 260 Z", "3.6s", "r", "-1.8s"]
    ];
    var g = svg("g", { "class": "nv-particula" });
    trilhas.forEach(function (t) { g.appendChild(particula(t[0], t[1], t[2], t[3], 5.5)); });
    textura.appendChild(g);
  })();

  /* Partícula SVG que percorre um caminho (SMIL: leve e pausável por SVG). */
  function particula(d, dur, cor, inicio, raio, keyPoints, keyTimes, opValores, opTempos) {
    var g = svg("g", {});
    svg("circle", { r: raio || 6, fill: "url(#nv-brilho-" + cor + ")" }, g);
    svg("circle", { r: (raio || 6) * 0.3, fill: "#fff" }, g);
    var am = svg("animateMotion", { dur: dur, repeatCount: "indefinite", path: d, begin: inicio || "0s" }, g);
    if (keyPoints) {
      am.setAttribute("calcMode", "linear");
      am.setAttribute("keyPoints", keyPoints);
      am.setAttribute("keyTimes", keyTimes);
    }
    if (opValores) svg("animate", { attributeName: "opacity", values: opValores, keyTimes: opTempos, dur: dur, begin: inicio || "0s", repeatCount: "indefinite" }, g);
    return g;
  }

  /* Halo que acende num nó no instante fr (0–1) do ciclo. */
  function halo(cx, cy, r0, fr, dur, cor, pai, antes) {
    var c = svg("circle", { cx: cx, cy: cy, r: r0, "class": "nv-halo", stroke: cor, opacity: 0 });
    var kt, op, rr;
    if (fr <= 0.001) { kt = "0;0.16;0.985;1"; op = "0.9;0;0;0.9"; rr = [r0, r0 + 9, r0, r0].join(";"); }
    else {
      var a = Math.min(fr, 0.97), b = Math.min(a + 0.012, 0.98), c2 = Math.min(a + 0.17, 0.995);
      kt = ["0", a.toFixed(3), b.toFixed(3), c2.toFixed(3), "1"].join(";");
      op = "0;0;0.9;0;0";
      rr = [r0, r0, r0, r0 + 9, r0 + 9].join(";");
    }
    svg("animate", { attributeName: "opacity", values: op, keyTimes: kt, dur: dur, repeatCount: "indefinite" }, c);
    svg("animate", { attributeName: "r", values: rr, keyTimes: kt, dur: dur, repeatCount: "indefinite" }, c);
    if (antes) pai.insertBefore(c, antes); else pai.appendChild(c);
    return c;
  }

  /* =================================================================
     3 · Cabeçalho, progresso e trilho
     ================================================================= */

  var cabecalho = $(".cabecalho");
  var progresso = cabecalho ? decorativo(el("div", "nv-progresso", cabecalho)) : null;
  var menu = $("#menu-principal");
  var pilula = null, linksMenu = menu ? $$('a[href^="#"]', menu) : [];
  if (menu) {
    pilula = decorativo(el("span", "nv-pilula", menu));
    var moverPilula = function (semTransicao) {
      if (window.innerWidth < 1024) { menu.classList.remove("nv-com-pilula"); return; }
      var a = $("a[aria-current]", menu);
      if (!a) { menu.classList.remove("nv-com-pilula"); return; }
      var rn = menu.getBoundingClientRect(), ra = a.getBoundingClientRect();
      if (semTransicao) pilula.style.transition = "none";
      pilula.style.width = ra.width + "px";
      pilula.style.height = ra.height + "px";
      pilula.style.transform = "translate(" + (ra.left - rn.left).toFixed(1) + "px," + (ra.top - rn.top).toFixed(1) + "px)";
      if (semTransicao) { void pilula.offsetWidth; pilula.style.transition = ""; }
      menu.classList.add("nv-com-pilula");
    };
    var primeira = true;
    if ("MutationObserver" in window) {
      new MutationObserver(function () { moverPilula(primeira); primeira = false; })
        .observe(menu, { attributes: true, subtree: true, attributeFilter: ["aria-current"] });
    }
    window.addEventListener("resize", function () { moverPilula(true); });
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { moverPilula(true); });
    moverPilula(true);
  }

  var secoes = $$("main > section[id]");
  var trilho = null, itensTrilho = [], trilhoCheio = null;
  if (secoes.length) {
    trilho = decorativo(el("div", "nv-trilho"));
    var ol = el("ol", "", trilho);
    trilhoCheio = el("i", "nv-trilho-cheio", ol);
    secoes.forEach(function (s, i) {
      var li = el("li", "", ol);
      var rot = el("span", "", li);
      var curto = linksMenu[i] && $(".menu-curto", linksMenu[i]);
      rot.textContent = String(i).padStart(2, "0") + " · " + (curto ? curto.textContent : s.id);
      itensTrilho.push(li);
    });
    doc.body.appendChild(trilho);
  }

  function marcarSecao(id) {
    E.secao = id;
    html.setAttribute("data-nv-secao", id);
    var idx = -1;
    secoes.forEach(function (s, i) { if (s.id === id) idx = i; });
    itensTrilho.forEach(function (li, i) {
      li.classList.toggle("atual", i === idx);
      li.classList.toggle("passou", i < idx);
    });
  }
  marcarSecao("inicio");

  noQuadro(function () {
    if (!E.sujoRolagem) return;
    var max = Math.max(1, E.docH - E.vh);
    var p = limitar(E.sy / max, 0, 1);
    if (progresso) progresso.style.transform = "scaleX(" + p.toFixed(4) + ")";
    if (trilhoCheio) trilhoCheio.style.transform = "scaleY(" + p.toFixed(4) + ")";
    if (cabecalho) cabecalho.classList.toggle("nv-rolado", E.sy > 12);
  });

  /* =================================================================
     4 · Seções: humor, entrada, profundidade e pausa fora da tela
     ================================================================= */

  var secoesVisiveis = [];
  secoes.forEach(function (s, i) {
    if (!s.classList.contains("bloco")) return;
    var num = decorativo(el("span", "nv-numero-secao"));
    num.textContent = String(i).padStart(2, "0");
    num.setAttribute("data-n", num.textContent);
    s.insertBefore(num, s.firstChild);
    var circ = decorativo(el("span", "nv-circuito"));
    el("i", "", circ);
    el("b", "", circ);
    s.insertBefore(circ, s.firstChild);
    s._nv = { num: num, circ: circ };
  });

  var obsHumor = observar(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) marcarSecao(e.target.id); });
  }, { rootMargin: "-45% 0px -50% 0px" });
  var obsEntrada = observar(function (es) {
    es.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("nv-entrou"); obsEntrada.unobserve(e.target); }
    });
  }, { rootMargin: "0px 0px -18% 0px" });
  var obsFora = observar(function (es) {
    es.forEach(function (e) {
      var s = e.target, dentro = e.isIntersecting;
      s.classList.toggle("nv-fora", !dentro);
      $$("svg", s).forEach(function (sv) {
        if (!sv.pauseAnimations) return;
        try { if (dentro) sv.unpauseAnimations(); else sv.pauseAnimations(); } catch (x) { /* SVG sem SMIL */ }
      });
      var i = secoesVisiveis.indexOf(s);
      if (dentro && i < 0) secoesVisiveis.push(s);
      if (!dentro && i >= 0) secoesVisiveis.splice(i, 1);
      if (s === heroi) heroiVisivel = dentro;
      E.sujoRolagem = true;
    });
  }, { rootMargin: "160px 0px" });
  secoes.forEach(function (s) {
    if (obsHumor) obsHumor.observe(s);
    if (obsEntrada) obsEntrada.observe(s); else s.classList.add("nv-entrou");
    if (obsFora) obsFora.observe(s); else secoesVisiveis.push(s);
  });

  // Parallax dos números gigantes e circuito lateral que se desenha com a leitura.
  noQuadro(function () {
    if (!E.sujoRolagem) return;
    var lidas = [];
    secoesVisiveis.forEach(function (s) { if (s._nv) lidas.push([s, s.getBoundingClientRect()]); });
    lidas.forEach(function (par) {
      var s = par[0], r = par[1];
      var p = limitar((E.vh - r.top) / (E.vh + r.height), 0, 1);
      var p2 = limitar((E.vh * 0.55 - r.top) / Math.max(1, r.height - E.vh * 0.2), 0, 1);
      s._nv.num.style.setProperty("--nv-p", ((p - 0.5) * 2).toFixed(3));
      s._nv.num.style.setProperty("--nv-p2", p2.toFixed(3));
      s._nv.circ.style.setProperty("--nv-p2", p2.toFixed(3));
    });
    if (textura && heroiVisivel && !reduz) {
      textura.style.transform = "translate3d(" + (E.ponteiro && fino ? ((E.mx / E.vw) - 0.5) * -18 : 0).toFixed(1) + "px," +
        (E.sy * 0.28 + (E.ponteiro && fino ? ((E.my / E.vh) - 0.5) * -12 : 0)).toFixed(1) + "px,0)";
    }
  });

  /* =================================================================
     5 · Revelações no scroll
     ================================================================= */

  var REVELAR = [
    [".bloco .bloco-num", "sobe"],
    [".secao .conteudo > h2", "titulo"],
    [".bloco .ideia", "ideia"],
    [".contraste-lado:not(.contraste-alerta)", "esq"],
    [".contraste-lado.contraste-alerta", "dir"],
    [".padroes .padrao", "escala", true],
    [".sub-bloco", "titulo"],
    [".tabela-rolagem", "sobe"],
    [".bloco .nota-ref", "sobe"],
    [".fluxo-criacao li", "sobe", true],
    [".pilares .pilar", "pilar", true],
    [".tipologias-texto", "esq"],
    [".tipologias-grafico", "dir"],
    [".rf-ficha", "escala"],
    [".contexto-teste", "sobe"],
    [".cartoes-metricas .metrica", "escala", true],
    [".comparativo-ap", "esq"],
    [".comparativo-fila", "dir"],
    [".texto-bloco", "sobe"],
    ["#conversao-score", "escala"],
    [".fluxograma li", "sobe", true],
    [".aviso-simulacao", "mascara"],
    ["#pipeline-interativo", "sobe"],
    [".eficiencia .efic", "escala", true],
    [".cartoes-3 .obs", "sobe", true],
    ["#painel-demo", "profundo"],
    [".cartoes-4 .limite", "sobe", true],
    [".ficha-botoes", "sobe"],
    [".equipe .pessoa", "escala", true],
    [".rodape .conteudo > *", "sobe", true]
  ];
  var GATILHOS = [".contraste", ".fluxo-criacao", ".tipologias", ".barras-recall", ".barras-ap", ".rf-ficha", ".ficha", ".equipe", ".fluxograma", ".aviso-simulacao"];

  var obsRevelar = observar(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      ver(e.target);
      obsRevelar.unobserve(e.target);
    });
  }, { rootMargin: "0px 0px -9% 0px", threshold: 0.06 });

  function ver(alvo) {
    if (alvo.classList.contains("nv-visto")) return;
    alvo.classList.add("nv-visto");
    var i = parseFloat(alvo.style.getPropertyValue("--nv-i")) || 0;
    setTimeout(function () { alvo.classList.add("nv-feito"); }, 1700 + i * 75);
  }

  function preparar(alvo, tipo, i) {
    if (alvo.hasAttribute("data-nv") && tipo) return;
    if (tipo) alvo.setAttribute("data-nv", tipo);
    if (i !== undefined) alvo.style.setProperty("--nv-i", i);
    if (reduz || !obsRevelar || naTela(alvo)) { alvo.classList.add("nv-visto", "nv-feito"); return; }
    obsRevelar.observe(alvo);
  }

  var largo = window.innerWidth >= 860;
  REVELAR.forEach(function (r) {
    var porPai = window.Map ? new Map() : null;
    $$(r[0]).forEach(function (alvo) {
      var i;
      if (r[2]) {
        var pai = alvo.parentNode, n = porPai ? (porPai.get(pai) || 0) : 0;
        if (porPai) porPai.set(pai, n + 1);
        i = n;
      }
      var tipo = r[1];
      if (tipo === "pilar") tipo = largo ? (i % 2 ? "dir" : "esq") : "sobe";
      preparar(alvo, tipo, i);
    });
  });
  GATILHOS.forEach(function (s) {
    $$(s).forEach(function (alvo) {
      alvo.setAttribute("data-nv-gatilho", "");
      preparar(alvo, null);
    });
  });
  $$(".barras-recall, .barras-ap").forEach(function (ul) {
    ul.setAttribute("data-nv-barras", "");
    $$("li", ul).forEach(function (li, i) { li.style.setProperty("--nv-i", i); });
  });
  $$(".rf-ficha, .ficha, .equipe").forEach(function (g) { g.setAttribute("data-nv-grade", ""); });
  $$(".fatos > div, .ficha > div").forEach(function (d) {
    d.style.setProperty("--nv-i", Array.prototype.indexOf.call(d.parentNode.children, d));
  });
  $$(".tabela-rolagem tr").forEach(function (tr, i) { tr.style.setProperty("--nv-i", i); });

  /* ---------- Contadores: terminam exatamente no texto original ---------- */

  function primeiroTexto(e) {
    for (var n = e.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && /\d/.test(n.nodeValue)) return n;
    return null;
  }
  function contar(alvo, atraso) {
    var tn = primeiroTexto(alvo);
    if (!tn) return false;
    var orig = tn.nodeValue;
    var m = orig.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/);
    if (!m) return false;
    var s = m[0], grupo = s.indexOf(".") >= 0, casas = s.indexOf(",") >= 0 ? s.split(",")[1].length : 0;
    var alvoN = parseFloat(s.replace(/\./g, "").replace(",", "."));
    var antes = orig.slice(0, m.index), depois = orig.slice(m.index + s.length);
    var fmt;
    try {
      var nf = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas, useGrouping: grupo });
      fmt = function (v) { return nf.format(v); };
    } catch (x) { fmt = function (v) { return v.toFixed(casas).replace(".", ","); }; }
    var dur = 1500 + Math.min(700, String(Math.round(alvoN)).length * 110);
    tn.nodeValue = antes + fmt(0) + depois;
    setTimeout(function () {
      var t0 = agora();
      (function passo() {
        var k = limitar((agora() - t0) / dur, 0, 1);
        var e = k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
        tn.nodeValue = k >= 1 ? orig : antes + fmt(alvoN * e) + depois;
        if (k < 1) requestAnimationFrame(passo);
        else alvo.dispatchEvent(new CustomEvent("nv-contou"));
      })();
    }, atraso || 0);
    return true;
  }

  var CONTAR = ".metrica-numero, .efic-num, .fila-num, .br-num, .ap-num, .fatos dd";
  var obsContar = observar(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      obsContar.unobserve(e.target);
      var c = e.target.closest(".cartao, li, .fatos > div, .fila-lado");
      var i = c ? parseFloat(c.style.getPropertyValue("--nv-i")) || 0 : 0;
      if (!contar(e.target, 250 + i * 75)) e.target.dispatchEvent(new CustomEvent("nv-contou"));
    });
  }, { threshold: 0.6 });
  if (!reduz && obsContar) $$(CONTAR).forEach(function (n) { obsContar.observe(n); });

  /* Acurácia descartada: o número sobe até 99,89% e só então é riscado. */
  $$(".metrica-descartada").forEach(function (card) {
    var n = $(".metrica-numero", card);
    if (reduz || !n || !obsContar) { card.classList.add("nv-riscada"); return; }
    n.addEventListener("nv-contou", function () { setTimeout(function () { card.classList.add("nv-riscada"); }, 200); });
  });

  /* ---------- Rótulos de bloco: decodificação estilo terminal ---------- */

  var SIMBOLOS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+<>/=";
  function embaralhar(alvo) {
    var texto = alvo.textContent;
    var sobre = decorativo(el("span", "nv-embaralho"));
    alvo.appendChild(sobre);
    alvo.classList.add("nv-embaralhando");
    var n = texto.length, dur = 950, t0 = agora(), limites = [];
    for (var i = 0; i < n; i++) limites.push((i / n) * dur * 0.65 + Math.random() * dur * 0.35);
    var ult = 0;
    (function passo() {
      var t = agora() - t0;
      if (t - ult > 38 || t >= dur) {
        ult = t;
        var out = "";
        for (var j = 0; j < n; j++) {
          var ch = texto.charAt(j);
          out += (t >= limites[j] || ch === " " || ch === "·") ? ch : SIMBOLOS.charAt((Math.random() * SIMBOLOS.length) | 0);
        }
        sobre.textContent = out;
      }
      if (t < dur) requestAnimationFrame(passo);
      else { alvo.classList.remove("nv-embaralhando"); sobre.remove(); }
    })();
  }
  var obsEmbaralhar = observar(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      obsEmbaralhar.unobserve(e.target);
      setTimeout(function () { embaralhar(e.target); }, 120);
    });
  }, { threshold: 0.9 });
  if (!reduz && obsEmbaralhar) $$(".bloco .bloco-num, .contexto-teste").forEach(function (b) { obsEmbaralhar.observe(b); });

  /* =================================================================
     6 · Superfícies: luz, borda viva, inclinação 3D e magnetismo
     ================================================================= */

  var COM_LUZ = ".cartao, .fluxograma li, .fluxo-criacao li, .indice a, .padrao";
  var superficies = [];
  $$(COM_LUZ).forEach(function (s) {
    decorativo(el("span", "nv-luz", s));
    s._nvProx = 0;
    superficies.push(s);
    if (s.matches(".cartao, .fluxograma li, .fluxo-criacao li")) s.setAttribute("data-nv-incl", "");
  });
  $$(".metrica-destaque, .efic-salto, .fx-nucleo, .contraste-alerta, .video-card, .cartoes-4 .limite:nth-child(4)").forEach(function (s) {
    decorativo(el("span", "nv-orbita", s));
  });

  var visiveis = [];
  var obsSuperficie = observar(function (es) {
    es.forEach(function (e) {
      var i = visiveis.indexOf(e.target);
      if (e.isIntersecting && i < 0) visiveis.push(e.target);
      if (!e.isIntersecting && i >= 0) visiveis.splice(i, 1);
    });
  }, { rootMargin: "60px" });
  var MAGNETICOS = ".botao, .menu-botao, .indice a";
  var magneticos = $$(MAGNETICOS);
  if (fino && obsSuperficie) {
    superficies.forEach(function (s) { obsSuperficie.observe(s); });
    magneticos.forEach(function (s) { obsSuperficie.observe(s); });
  }

  if (fino && !reduz) {
    doc.addEventListener("pointerover", function (e) {
      var c = e.target.closest && e.target.closest("[data-nv-incl]");
      if (c !== E.cartaoAtivo) {
        if (E.cartaoAtivo) soltar(E.cartaoAtivo);
        E.cartaoAtivo = c;
        if (c) c.classList.add("nv-inclinando");
      }
    }, { passive: true });
  }
  function soltar(c) {
    c.classList.remove("nv-inclinando");
    c.style.transform = "";
    c.style.removeProperty("--nx");
    c.style.removeProperty("--ny");
  }

  noQuadro(function () {
    if (!fino || !E.sujoPonteiro) return;
    var mx = E.mx, my = E.my, ler = [];
    // Fase de leitura…
    for (var i = 0; i < visiveis.length; i++) ler.push([visiveis[i], visiveis[i].getBoundingClientRect()]);
    // …e só depois as escritas.
    for (i = 0; i < ler.length; i++) {
      var s = ler[i][0], r = ler[i][1];
      var dx = Math.max(r.left - mx, 0, mx - r.right), dy = Math.max(r.top - my, 0, my - r.bottom);
      var d = Math.sqrt(dx * dx + dy * dy);
      var dentro = d === 0 && E.ponteiro;

      if (s._nvProx !== undefined) {
        var prox = E.ponteiro ? limitar(1 - d / 150, 0, 1) : 0;
        if (prox > 0 || s._nvProx > 0) {
          s.style.setProperty("--px", (mx - r.left).toFixed(0) + "px");
          s.style.setProperty("--py", (my - r.top).toFixed(0) + "px");
          s.style.setProperty("--prox", prox.toFixed(3));
          s.style.setProperty("--dentro", dentro ? "1" : "0");
          s._nvProx = prox;
        }
      }
      if (!reduz && s === E.cartaoAtivo && dentro) {
        var nx = (mx - r.left) / r.width - 0.5, ny = (my - r.top) / r.height - 0.5;
        var max = limitar(900 / Math.max(r.width, r.height), 1.2, 5);
        s.style.transform = "perspective(1000px) rotateX(" + (-ny * max).toFixed(2) + "deg) rotateY(" + (nx * max).toFixed(2) + "deg) translateZ(0)";
        s.style.setProperty("--nx", nx.toFixed(3));
        s.style.setProperty("--ny", ny.toFixed(3));
      }
      if (!reduz && s.matches(MAGNETICOS)) {
        var perto = E.ponteiro && mx > r.left - 22 && mx < r.right + 22 && my > r.top - 22 && my < r.bottom + 22;
        if (perto) {
          var tx = limitar((mx - (r.left + r.width / 2)) * 0.22, -8, 8), ty = limitar((my - (r.top + r.height / 2)) * 0.3, -5, 5);
          s.style.translate = tx.toFixed(1) + "px " + ty.toFixed(1) + "px";
          s._nvMag = true;
        } else if (s._nvMag) {
          s.style.translate = "";
          s._nvMag = false;
        }
      }
    }
    if (E.cartaoAtivo && !E.ponteiro) { soltar(E.cartaoAtivo); E.cartaoAtivo = null; }
  });

  /* Título: brilho que segue o mouse e leve perspectiva. */
  noQuadro(function () {
    if (!fino || reduz || !E.sujoPonteiro || !heroiVisivel || !letras.length) return;
    var rs = letras.map(function (l) { return l.getBoundingClientRect(); });
    var rh = h1.getBoundingClientRect();
    letras.forEach(function (l, i) {
      var r = rs[i], cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var d = Math.sqrt((cx - E.mx) * (cx - E.mx) + (cy - E.my) * (cy - E.my));
      var lum = E.ponteiro ? Math.pow(limitar(1 - d / 280, 0, 1), 1.4) : 0;
      if (Math.abs((l._lum || 0) - lum) > 0.015) { l.style.setProperty("--nv-lum", lum.toFixed(3)); l._lum = lum; }
    });
    if (E.ponteiro) {
      var nx = limitar((E.mx - (rh.left + rh.width / 2)) / E.vw, -0.5, 0.5), ny = limitar((E.my - (rh.top + rh.height / 2)) / E.vh, -0.5, 0.5);
      h1.style.transform = "perspective(900px) rotateX(" + (-ny * 5).toFixed(2) + "deg) rotateY(" + (nx * 6).toFixed(2) + "deg)";
    } else h1.style.transform = "";
  });

  /* Demonstração do painel: reflexo que acompanha o cursor sobre a moldura. */
  var demo = $("#painel-demo");
  if (demo && fino && !reduz) {
    demo.addEventListener("pointermove", function (e) {
      var r = demo.getBoundingClientRect();
      demo.style.setProperty("--px", (e.clientX - r.left) + "px");
      demo.style.setProperty("--py", (e.clientY - r.top) + "px");
      demo.style.setProperty("--dentro", "1");
    }, { passive: true });
    demo.addEventListener("pointerleave", function () { demo.style.setProperty("--dentro", "0"); });
  }

  /* =================================================================
     7 · Ondas de energia nas interações
     ================================================================= */

  var camadaOndas = decorativo(el("div", "nv-ondas", doc.body));
  var INTERATIVOS = "a, button, [role='button'], [role='tab'], summary, select, input[type='range'], input[type='checkbox'], .g-no, tr[tabindex]";
  function emitir(x, y, alvo) {
    if (reduz) return;
    var vermelha = !!(alvo && alvo.closest && alvo.closest(".botao-primario, .primario, .alerta, .g-no.alerta, .atalho"));
    var o = el("i", "nv-onda" + (vermelha ? " vermelha" : ""), camadaOndas);
    o.style.left = x + "px";
    o.style.top = y + "px";
    o.addEventListener("animationend", function () { o.remove(); });
    for (var k = 0; k < 7; k++) {
      var f = el("i", "nv-faisca" + (vermelha ? " vermelha" : ""), camadaOndas);
      var ang = (k / 7) * 6.283 + Math.random() * 0.6, dist = 26 + Math.random() * 30;
      f.style.left = x + "px";
      f.style.top = y + "px";
      f.style.setProperty("--fx", (Math.cos(ang) * dist).toFixed(1) + "px");
      f.style.setProperty("--fy", (Math.sin(ang) * dist).toFixed(1) + "px");
      f.addEventListener("animationend", function () { this.remove(); });
    }
    if (rede) rede.choque(x, y, vermelha);
  }
  doc.addEventListener("pointerdown", function (e) {
    var alvo = e.target.closest && e.target.closest(INTERATIVOS);
    if (alvo) emitir(e.clientX, e.clientY, alvo);
    else if (!fino && rede) rede.choque(e.clientX, e.clientY, false);
  }, { passive: true });
  doc.addEventListener("click", function (e) {
    if (e.detail !== 0) return; // ativação pelo teclado: a onda nasce no centro do elemento
    var alvo = e.target.closest && e.target.closest(INTERATIVOS);
    if (!alvo) return;
    var r = alvo.getBoundingClientRect();
    emitir(r.left + r.width / 2, r.top + r.height / 2, alvo);
  });

  /* =================================================================
     8 · Animações próprias de cada bloco
     ================================================================= */

  /* Bloco 1 · tabela isolada: uma varredura confere linha por linha (e tudo parece "ok"). */
  var svgTabela = $("#t-tab");
  if (svgTabela && svgTabela.parentNode) {
    svg("rect", { "class": "nv-scan-tabela", x: 10, y: 6, width: 300, height: 8, rx: 4 }, svgTabela.parentNode);
  }

  /* Bloco 1 · padrões: o dinheiro percorre as conexões, cada padrão com cor e ritmo próprios. */
  (function padroes() {
    if (reduz) return;
    function svgDe(id) { var t = doc.getElementById(id); return t ? t.closest("svg") : null; }

    // Ciclo: A → B → C → A, circulando sem parar; cada nó acende quando o dinheiro chega.
    var sc = svgDe("t-ciclo");
    if (sc) {
      var nosC = $(".d-no", sc), T = "3.6s";
      var g = svg("g", { "class": "nv-particula" });
      g.appendChild(particula("M32 82 L71 18 L110 82 Z", T, "r", "0s", 5));
      g.appendChild(particula("M32 82 L71 18 L110 82 Z", T, "r", "-0.12s", 3.2));
      sc.insertBefore(g, nosC);
      halo(32, 82, 10, 0, T, "#ff6b6b", sc, nosC);
      halo(71, 18, 10, 0.329, T, "#ff6b6b", sc, nosC);
      halo(110, 82, 10, 0.658, T, "#ff6b6b", sc, nosC);
    }

    // Fan-out: a conta central dispara para quatro destinos ao mesmo tempo.
    var so = svgDe("t-fanout");
    if (so) {
      var claroO = $(".d-no-claro", so), T2 = "2.8s";
      var go = svg("g", { "class": "nv-particula" });
      [12, 37, 61, 86].forEach(function (y) {
        go.appendChild(particula("M30 49 L110 " + y, T2, "c", "0s", 4.6, "0;1;1", "0;0.5;1", "0;1;1;0;0", "0;0.05;0.45;0.5;1"));
        halo(110, y, 7, 0.5, T2, "#38e1ff", so);
      });
      so.insertBefore(go, claroO);
      halo(30, 49, 11, 0, T2, "#38e1ff", so);
    }

    // Fan-in: quatro origens convergem, em sequência, para uma conta.
    var si = svgDe("t-fanin");
    if (si) {
      var noI = $(".d-no", si), T3 = "3.2s";
      var gi = svg("g", { "class": "nv-particula" });
      [12, 37, 61, 86].forEach(function (y, k) {
        var s0 = 0.06 * k, s1 = s0 + 0.4;
        gi.appendChild(particula("M30 " + y + " L110 49", T3, "v", "0s", 4.6, "0;0;1;1", "0;" + s0.toFixed(2) + ";" + s1.toFixed(2) + ";1",
          "0;0;1;1;0;0", "0;" + s0.toFixed(2) + ";" + (s0 + 0.03).toFixed(2) + ";" + (s1 - 0.02).toFixed(2) + ";" + s1.toFixed(2) + ";1"));
        halo(30, y, 7, Math.max(0.002, s0), T3, "#a796ff", si);
      });
      si.insertBefore(gi, noI);
      halo(110, 49, 11, 0.6, T3, "#a796ff", si);
    }

    // Ritmo: um cursor de tempo percorre o eixo; os repasses surgem em rajada dentro da janela de 72 h.
    var sr = svgDe("t-ritmo");
    if (sr) {
      var T4 = "5s", janela = $(".d-janela", sr);
      if (janela) {
        var brilhoJ = svg("rect", { x: 44, y: 20, width: 84, height: 52, rx: 6, fill: "rgba(242,181,68,0.16)", stroke: "rgba(242,181,68,0.8)", "stroke-width": 1, opacity: 0 });
        svg("animate", { attributeName: "opacity", values: "0;0;1;1;0;0", keyTimes: "0;0.14;0.17;0.46;0.52;1", dur: T4, repeatCount: "indefinite" }, brilhoJ);
        janela.parentNode.insertBefore(brilhoJ, janela.nextSibling);
      }
      $$(".d-tique line", sr).forEach(function (ln) {
        var x = parseFloat(ln.getAttribute("x1")), y = ln.getAttribute("y1");
        var f = limitar((x - 8) / 124 * 0.5, 0.01, 0.6);
        svg("animate", { attributeName: "y1", values: "58;58;" + y + ";" + y + ";58;58", keyTimes: "0;" + f.toFixed(3) + ";" + (f + 0.03).toFixed(3) + ";0.92;0.98;1", dur: T4, repeatCount: "indefinite", calcMode: "spline", keySplines: "0 0 1 1;0.2 0.8 0.2 1;0 0 1 1;0.6 0 1 1;0 0 1 1" }, ln);
      });
      var cabeca = svg("g", {});
      svg("line", { x1: 0, y1: 14, x2: 0, y2: 64, stroke: "#f2b544", "stroke-width": 1.2, "stroke-linecap": "round", opacity: 0.9 }, cabeca);
      svg("circle", { cx: 0, cy: 58, r: 5, fill: "url(#nv-brilho-a)" }, cabeca);
      svg("animateTransform", { attributeName: "transform", type: "translate", values: "8 0;132 0;132 0", keyTimes: "0;0.5;1", dur: T4, repeatCount: "indefinite" }, cabeca);
      svg("animate", { attributeName: "opacity", values: "0;1;1;0;0", keyTimes: "0;0.03;0.48;0.53;1", dur: T4, repeatCount: "indefinite" }, cabeca);
      sr.appendChild(cabeca);
    }
  })();

  /* Bloco 2 · matriz decorativa dos 49 atributos no pilar de engenharia de atributos. */
  var pilares = $$(".pilares .pilar");
  var pilarAtributos = pilares.filter(function (p) { return /49/.test(($("h3", p) || {}).textContent || ""); })[0];
  if (pilarAtributos) {
    var mat = decorativo(el("span", "nv-matriz", pilarAtributos));
    for (var lin = 0; lin < 7; lin++) for (var col = 0; col < 7; col++) {
      var cel = el("i", "", mat);
      cel.style.setProperty("--d", lin + col);
    }
  }

  /* Bloco 3 · medidores fiéis ao número de cada métrica (o valor vem do próprio texto do cartão). */
  $$(".cartoes-metricas .metrica").forEach(function (card) {
    var n = $(".metrica-numero", card);
    if (!n) return;
    var txt = n.textContent.trim(), pct = txt.indexOf("%") >= 0;
    var v = parseFloat(txt.replace(/[^\d,]/g, "").replace(",", "."));
    if (isNaN(v)) return;
    if (pct) v /= 100;
    var med = decorativo(el("span", "nv-medidor", card));
    el("i", "", med).style.setProperty("--v", limitar(v, 0, 1));
  });

  /* Bloco 4 · pictogramas abstratos nos cartões de observabilidade. */
  $$(".cartoes-3 .obs").forEach(function (card, i) {
    var p = decorativo(el("span", "nv-picto"));
    if (i === 0) {
      p.className = "nv-picto nv-picto-log";
      var faixa = el("span", "", p);
      for (var k = 0; k < 10; k++) el("i", "", faixa);
    } else if (i === 1) {
      p.className = "nv-picto nv-picto-linhas";
      for (var c = 0; c < 12; c++) el("i", "", p).style.setProperty("--d", c);
    } else {
      p.className = "nv-picto nv-picto-pulso";
      var sv = svg("svg", { viewBox: "0 0 200 30", preserveAspectRatio: "none", focusable: "false" }, p);
      svg("path", { d: "M0 16 H52 L60 16 L66 4 L74 27 L80 16 H122 L128 10 L134 22 L140 16 H200", pathLength: "1", "vector-effect": "non-scaling-stroke" }, sv);
    }
    card.insertBefore(p, card.firstChild);
  });

  /* Bloco 4 · tamanho do barramento do pipeline. */
  var fluxograma = $(".fluxograma");
  function medirFluxo() {
    if (!fluxograma) return;
    fluxograma.style.setProperty("--nv-larg", fluxograma.offsetWidth + "px");
    fluxograma.style.setProperty("--nv-alt", fluxograma.offsetHeight + "px");
  }
  medirFluxo();

  /* =================================================================
     9 · Laço único, eventos globais e manutenção
     ================================================================= */

  window.addEventListener("pointermove", function (e) {
    if (e.pointerType === "touch") return;
    E.mx = e.clientX;
    E.my = e.clientY;
    E.ponteiro = true;
    E.sujoPonteiro = true;
    if (foco && fino) foco.classList.add("ativo");
  }, { passive: true });
  doc.addEventListener("pointerleave", saiu);
  doc.addEventListener("mouseout", function (e) { if (!e.relatedTarget) saiu(); });
  window.addEventListener("blur", saiu);
  function saiu() {
    E.ponteiro = false;
    E.sujoPonteiro = true;
    if (foco) foco.classList.remove("ativo");
  }

  window.addEventListener("scroll", function () {
    E.sy = window.scrollY || html.scrollTop || 0;
    E.sujoRolagem = true;
    // Rolar também move o mouse em relação à página: os efeitos de proximidade precisam ser recalculados.
    if (E.ponteiro) E.sujoPonteiro = true;
  }, { passive: true });

  var temporizador = 0;
  window.addEventListener("resize", function () {
    clearTimeout(temporizador);
    temporizador = setTimeout(function () {
      E.vw = window.innerWidth;
      E.vh = window.innerHeight;
      E.docH = html.scrollHeight;
      E.sujoRolagem = true;
      if (rede) rede.dimensionar(false);
      if (rede && reduz) rede.estatico();
      medirLetras();
      medirFluxo();
    }, 140);
  });
  // A altura da página muda quando o React monta as demonstrações: o progresso precisa saber.
  if ("ResizeObserver" in window) {
    new ResizeObserver(function () { E.docH = html.scrollHeight; E.sujoRolagem = true; medirFluxo(); }).observe(doc.body);
  }

  if (mqReduz && mqReduz.addEventListener) {
    mqReduz.addEventListener("change", function (e) {
      if (!e.matches) return;
      reduz = true;
      html.classList.remove("nv-anima", "nv-intro");
      $$("[data-nv]").forEach(function (n) { n.classList.add("nv-visto", "nv-feito"); });
      if (rede) rede.estatico();
    });
  }

  var tAnt = agora();
  function laco(t) {
    var dt = t - tAnt;
    if (dt > 100 || dt < 0) dt = 16.7; // volta de aba em segundo plano
    tAnt = t;
    E.vel = E.vel * 0.85 + (E.sy - E.syAnt) * 0.15;
    E.syAnt = E.sy;
    for (var i = 0; i < fila.length; i++) {
      try { fila[i](t, dt); } catch (x) { /* um efeito com erro não derruba os outros */ if (window.console) console.error(x); fila.splice(i--, 1); }
    }
    E.sujoPonteiro = false;
    E.sujoRolagem = false;
    requestAnimationFrame(laco);
  }
  requestAnimationFrame(function (t) { tAnt = t; laco(t); });
})();
