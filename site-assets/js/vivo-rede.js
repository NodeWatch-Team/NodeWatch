/* NodeWatch · rede neural do ambiente (camada viva).
   Roda num Web Worker com OffscreenCanvas sempre que o navegador permite: o desenho sai da thread principal
   e a rolagem, os toques e os menus não disputam tempo com a animação. Sem suporte, o mesmo código roda na página
   (vivo.js carrega este arquivo e usa self.NWRede).

   Mensagens (página → worker):
     { tipo: "iniciar", canvas, op: { fraco, estreito, fino, reduz, leve, w, h, dpr } }
     { tipo: "tamanho", w, h, dpr }                 { tipo: "estado", sy, mx, my, ponteiro }
     { tipo: "secao", id }                          { tipo: "choque", x, y, vermelho }
     { tipo: "pausa", pausado }
   Mensagens (worker → página):  { tipo: "lento" } quando o aparelho não sustenta o ritmo. */
(function (escopo) {
  "use strict";

  var HUMORES = {
    inicio:   { c: [56, 225, 255],  alerta: 0.2,  ritmo: 1,   vel: 1 },
    problema: { c: [255, 140, 140], alerta: 0.42, ritmo: 1.1, vel: 1 },
    modelo:   { c: [160, 145, 255], alerta: 0.12, ritmo: 1.6, vel: 1.1 },
    metricas: { c: [86, 205, 255],  alerta: 0.1,  ritmo: 0.8, vel: 0.7 },
    producao: { c: [56, 225, 255],  alerta: 0.14, ritmo: 2.3, vel: 1.7 },
    painel:   { c: [96, 215, 255],  alerta: 0.36, ritmo: 1.2, vel: 1 },
    escopo:   { c: [115, 232, 200], alerta: 0.04, ritmo: 0.6, vel: 0.55 }
  };
  var FAIXAS = 8; // conexões agrupadas por intensidade: um stroke() por faixa em vez de um por linha

  function limitar(v, a, b) { return v < a ? a : v > b ? b : v; }
  function agora() { return (escopo.performance && performance.now) ? performance.now() : Date.now(); }

  function criarRede(canvas, op, E, avisar) {
    var ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return null;
    var W = 0, H = 0, dpr = 1, M = 70;
    var nos = [], pulsos = [], ondas = [];
    var t0 = agora(), espera = 300;
    var qualidade = op.fraco ? 0.5 : op.leve ? 0.6 : 1;
    var L = op.estreito ? 112 : 150;
    var humor = { c: HUMORES.inicio.c.slice(), alerta: 0.2, ritmo: 1, vel: 1 };
    var cam = { x: 0, y: 0 };
    var sprites = {};
    var medidas = { n: 0, soma: 0, feito: false };
    var parado = false, syAnt = E.sy, vel = 0;
    var caminhos = [];
    for (var f = 0; f < FAIXAS; f++) caminhos.push([]);

    function novaTela(w, h) {
      if (typeof OffscreenCanvas !== "undefined" && typeof document === "undefined") return new OffscreenCanvas(w, h);
      var c = document.createElement("canvas"); c.width = w; c.height = h; return c;
    }
    function sprite(rgb) {
      var k = rgb.join(",");
      if (sprites[k]) return sprites[k];
      var s = 64, c = novaTela(s, s), g = c.getContext("2d"), gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, "rgba(" + k + ",0.9)");
      gr.addColorStop(0.25, "rgba(" + k + ",0.35)");
      gr.addColorStop(1, "rgba(" + k + ",0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
      return (sprites[k] = c);
    }
    var VERMELHO = [255, 84, 84];

    function dimensionar(w, h, d) {
      dpr = Math.min(d || 1, op.leve || qualidade < 1 ? 1 : 1.5);
      W = w; H = h;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      popular();
      if (parado) desenhar(agora() + 5000, 16);
    }

    function popular() {
      var n = Math.round(limitar(W * H / (op.estreito ? 8600 : 11500), 26, 128) * qualidade);
      var ox = W < 960 ? W * 0.5 : W * 0.3, oy = H * 0.4, dmax = Math.sqrt(W * W + H * H);
      while (nos.length > n) nos.pop();
      while (nos.length < n) {
        var z = 0.22 + Math.pow(Math.random(), 1.5) * 0.78;
        var x = Math.random() * W, y = Math.random() * (H + 2 * M) - M;
        var dd = Math.sqrt((x - ox) * (x - ox) + (y - oy) * (y - oy));
        nos.push({ x: x, y: y, z: z, a: Math.random() * 6.283, w: (Math.random() - 0.5) * 0.0008, v: 0.009 + Math.random() * 0.017,
          f: Math.random() * 6.283, b: 0, br: false, nasce: 120 + dd / dmax * 1500 + Math.random() * 300, sx: 0, sy: 0, ok: false, mk: 1 });
      }
    }

    function mascara(x) {
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
      if (pulsos.length > (op.leve ? 12 : 24)) return;
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
      ondas.push({ x: x, y: y, r: 4, max: op.estreito ? 220 : 320, al: !!vermelho });
      if (ondas.length > 6) ondas.shift();
    }

    function desenhar(t, dt) {
      var reduz = op.reduz;
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

      vel = vel * 0.85 + (E.sy - syAnt) * 0.15;
      syAnt = E.sy;

      var mx = E.mx, my = E.my, ativo = E.ponteiro;
      if (!op.fino && !reduz) {
        mx = W * (0.5 + 0.4 * Math.sin(t * 0.00011));
        my = H * (0.5 + 0.34 * Math.sin(t * 0.00017 + 1.3));
        ativo = true;
      }
      var cx = op.fino && E.ponteiro ? (E.mx - W / 2) * -0.04 : 0, cy = op.fino && E.ponteiro ? (E.my - H / 2) * -0.04 : 0;
      cam.x += (cx - cam.x) * 0.06;
      cam.y += (cy - cam.y) * 0.06;
      var turbo = 1 + Math.min(2.5, Math.abs(vel) * 0.025);

      var i, j, n, m;
      var raioMouse = op.fino ? 175 : 150, forcaMouse = op.fino ? 1 : 0.55, rm2 = raioMouse * raioMouse;
      var Hm = H + 2 * M, passo = dt / 16.7, decai = Math.pow(0.94, passo);
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
        n.fa = reduz ? 1 : limitar((t - t0 - n.nasce) / 650, 0, 1);
        n.mk = mascara(n.sx);
        n.b *= decai;
        if (ativo && !reduz) {
          var dx = n.sx - mx, dy = n.sy - my, d2 = dx * dx + dy * dy;
          if (d2 < rm2) {
            var d = Math.sqrt(d2) || 1, q = 1 - d / raioMouse;
            n.x += dx / d * q * 0.9 * forcaMouse * passo;
            n.y += dy / d * q * 0.9 * forcaMouse * passo;
            if (q * 0.65 * forcaMouse > n.b) n.b = q * 0.65 * forcaMouse;
          }
        }
      }

      for (m = ondas.length - 1; m >= 0; m--) {
        var o = ondas[m];
        o.r += dt * 0.55;
        var vida = 1 - o.r / o.max;
        if (vida <= 0) { ondas.splice(m, 1); continue; }
        for (i = 0; i < nos.length; i++) {
          n = nos[i];
          var ox = n.sx - o.x, oy = n.sy - o.y;
          if (ox > o.r + 26 || ox < -o.r - 26 || oy > o.r + 26 || oy < -o.r - 26) continue;
          var od = Math.sqrt(ox * ox + oy * oy) || 1;
          if (Math.abs(od - o.r) < 26) {
            n.x += ox / od * 2.2 * vida;
            n.y += oy / od * 2.2 * vida;
            if (vida > n.b) n.b = vida;
          }
        }
      }

      ctx.clearRect(0, 0, W, H);

      // Conexões, agrupadas em faixas de intensidade (um único caminho e um único stroke por faixa).
      var L2 = L * L;
      for (f = 0; f < FAIXAS; f++) caminhos[f].length = 0;
      for (i = 0; i < nos.length; i++) {
        n = nos[i];
        if (!n.ok) continue;
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
          var midx = (n.sx + m.sx) * 0.5, midy = (n.sy + m.sy) * 0.5;
          var al = kk * kk * 0.5 * (n.z < m.z ? n.z : m.z) * mascara(midx) * intro * n.fa * m.fa;
          if (ativo) {
            var mdx = midx - mx, mdy = midy - my, md = mdx * mdx + mdy * mdy;
            if (md < 40000) al += (1 - Math.sqrt(md) / 200) * 0.32 * kk * intro;
          }
          al += (n.b + m.b) * 0.18 * kk;
          if (al < 0.012) continue;
          var fx = (al > 0.84 ? 0.84 : al) / 0.85 * FAIXAS | 0;
          caminhos[fx].push(n.sx, n.sy, m.sx, m.sy);
        }
      }
      ctx.lineWidth = op.leve ? 0.7 : 0.8;
      for (f = 0; f < FAIXAS; f++) {
        var cm = caminhos[f];
        if (!cm.length) continue;
        ctx.strokeStyle = "rgba(" + rgb + "," + ((f + 0.6) / FAIXAS * 0.85).toFixed(3) + ")";
        ctx.beginPath();
        for (var q2 = 0; q2 < cm.length; q2 += 4) { ctx.moveTo(cm[q2], cm[q2 + 1]); ctx.lineTo(cm[q2 + 2], cm[q2 + 3]); }
        ctx.stroke();
      }

      // Linhas do "sensor" (cursor) até os nós mais próximos.
      if (ativo && intro > 0.2 && !reduz) {
        var lig = 0;
        ctx.lineWidth = 0.7;
        for (i = 0; i < nos.length && lig < 6; i++) {
          n = nos[i];
          if (!n.ok) continue;
          var cdx = n.sx - mx, cdy = n.sy - my;
          if (cdx > 140 || cdx < -140 || cdy > 140 || cdy < -140) continue;
          var cd = Math.sqrt(cdx * cdx + cdy * cdy);
          if (cd < 140) {
            lig++;
            ctx.strokeStyle = "rgba(" + rgb + "," + ((1 - cd / 140) * (op.fino ? 0.38 : 0.2) * intro).toFixed(3) + ")";
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
      ctx.fillStyle = "rgb(" + (200 + R * 0.2 | 0) + "," + (200 + G * 0.2 | 0) + "," + (200 + B * 0.2 | 0) + ")";
      for (i = 0; i < nos.length; i++) {
        n = nos[i];
        if (!n.ok || n.sy < -20 || n.sy > H + 20) continue;
        var a1 = ((0.25 + n.z * 0.55) * n.mk * intro + n.b * 0.8) * n.fa;
        var rr = 0.55 + n.z * 1.45 + n.b * 1.6;
        ctx.globalAlpha = a1 > 1 ? 1 : a1;
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, rr, 0, 6.283);
        ctx.fill();
        if (n.z > 0.72 || n.b > 0.08) {
          var s = 10 + n.z * 20 + n.b * 34;
          ctx.globalAlpha = Math.min(1, (0.22 * n.z * n.mk * intro + n.b * 0.75) * n.fa);
          ctx.drawImage(n.br ? sprV : spr, n.sx - s / 2, n.sy - s / 2, s, s);
        }
        if (n.br && n.b < 0.05) n.br = false;
      }

      // Pulsos: transações percorrendo as conexões; os vermelhos são os suspeitos.
      if (!reduz && intro > 0.35) {
        proximoPulso -= dt * humor.ritmo * turbo;
        if (proximoPulso <= 0) { lancarPulso(); proximoPulso = 230 + Math.random() * 380; }
      }
      ctx.lineWidth = 1.6;
      for (m = pulsos.length - 1; m >= 0; m--) {
        var p = pulsos[m];
        p.t += dt;
        var pa = nos[p.a], pb = nos[p.b];
        if (!pa || !pb) { pulsos.splice(m, 1); continue; }
        var kt = limitar(p.t / p.dur, 0, 1), e = kt < 0.5 ? 2 * kt * kt : 1 - Math.pow(-2 * kt + 2, 2) / 2;
        var dxp = pb.sx - pa.sx, dyp = pb.sy - pa.sy, lp = Math.sqrt(dxp * dxp + dyp * dyp) || 1;
        if (lp > L * 1.6) { pulsos.splice(m, 1); continue; }
        var x = pa.sx + dxp * e, y = pa.sy + dyp * e, ux = dxp / lp, uy = dyp / lp;
        var cor = p.al ? "255,96,96" : rgb;
        // Cauda em dois segmentos (mais clara perto do pulso): sem gradiente novo a cada quadro.
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = "rgb(" + cor + ")";
        ctx.beginPath(); ctx.moveTo(x - ux * 26, y - uy * 26); ctx.lineTo(x - ux * 12, y - uy * 12); ctx.stroke();
        ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.moveTo(x - ux * 12, y - uy * 12); ctx.lineTo(x, y); ctx.stroke();
        ctx.globalAlpha = 0.95;
        ctx.drawImage(p.al ? sprV : spr, x - 13, y - 13, 26, 26);
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(x, y, 1.5, 0, 6.283); ctx.fill();
        if (kt >= 1) {
          pulsos.splice(m, 1);
          pb.b = 1;
          if (p.al) { pb.br = true; ondas.push({ x: pb.sx, y: pb.sy, r: 2, max: 46, al: true, fraca: true }); }
          if (p.s < 3 && Math.random() < 0.6) lancarPulso(p.b, p.s + 1);
        }
      }

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

      // Ajuste automático: se o aparelho não sustenta o ritmo, a rede fica mais leve (e a página é avisada).
      if (!medidas.feito && t - t0 > 2600 && dt < 120) {
        medidas.n++;
        medidas.soma += dt;
        if (medidas.n >= 90) {
          medidas.feito = true;
          if (medidas.soma / medidas.n > (op.leve ? 40 : 24)) {
            qualidade *= 0.6;
            popular();
            if (avisar) avisar({ tipo: "lento" });
          }
        }
      }
    }

    dimensionar(op.w, op.h, op.dpr);

    return {
      dimensionar: dimensionar,
      desenhar: desenhar,
      choque: choque,
      estatico: function () { parado = true; desenhar(agora() + 5000, 16); }
    };
  }

  /* Laço próprio: no modo leve desenha a ~30 quadros/s (o movimento do ambiente é lento, e a diferença não se vê). */
  function laco(rede, op, estado) {
    var raf = escopo.requestAnimationFrame ? escopo.requestAnimationFrame.bind(escopo) : function (f) { return setTimeout(function () { f(agora()); }, 16); };
    var ant = agora(), acum = 0, alvo = op.leve ? 31 : 0;
    function q(t) {
      if (estado.pausado) { estado.esperando = true; return; }
      var dt = t - ant;
      ant = t;
      if (dt > 100 || dt < 0) dt = 16.7;
      acum += dt;
      if (acum >= alvo) { rede.desenhar(t, Math.min(acum, 100)); acum = 0; }
      raf(q);
    }
    estado.retomar = function () { if (estado.esperando) { estado.esperando = false; ant = agora(); raf(q); } };
    raf(q);
  }

  if (typeof document === "undefined" && typeof postMessage === "function") {
    // Dentro do Web Worker.
    var E = { sy: 0, mx: -9999, my: -9999, ponteiro: false, secao: "inicio" };
    var rede = null, op = null, estado = { pausado: false };
    escopo.onmessage = function (msg) {
      var d = msg.data;
      if (d.tipo === "iniciar") {
        op = d.op;
        rede = criarRede(d.canvas, op, E, function (m) { escopo.postMessage(m); });
        if (!rede) return;
        if (op.reduz) rede.estatico(); else laco(rede, op, estado);
      } else if (!rede) {
        return;
      } else if (d.tipo === "estado") {
        E.sy = d.sy; E.mx = d.mx; E.my = d.my; E.ponteiro = d.ponteiro;
      } else if (d.tipo === "secao") {
        E.secao = d.id;
      } else if (d.tipo === "tamanho") {
        rede.dimensionar(d.w, d.h, d.dpr);
        if (op.reduz) rede.estatico();
      } else if (d.tipo === "choque") {
        rede.choque(d.x, d.y, d.vermelho);
      } else if (d.tipo === "pausa") {
        estado.pausado = d.pausado;
        if (!d.pausado && estado.retomar) estado.retomar();
      }
    };
  } else {
    escopo.NWRede = { criar: criarRede, laco: laco };
  }
})(typeof self !== "undefined" ? self : this);
