/* NodeWatch · artigo técnico. Menu dos blocos, ampliação das capturas, link ativo e entrada suave.
   Os componentes interativos ficam em artigo.js (React). Sem rastreamento. */
(function () {
  "use strict";

  /* ---------- Menu compacto no celular ---------- */
  var botaoMenu = document.querySelector(".menu-botao");
  var menu = document.getElementById("menu-principal");

  function fecharMenu() {
    menu.classList.remove("aberto");
    botaoMenu.setAttribute("aria-expanded", "false");
  }

  if (botaoMenu && menu) {
    botaoMenu.addEventListener("click", function () {
      var aberto = menu.classList.toggle("aberto");
      botaoMenu.setAttribute("aria-expanded", aberto ? "true" : "false");
    });
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) fecharMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menu.classList.contains("aberto")) {
        fecharMenu();
        botaoMenu.focus();
      }
    });
    document.addEventListener("click", function (e) {
      if (menu.classList.contains("aberto") && !e.target.closest(".cabecalho")) fecharMenu();
    });
  }

  /* ---------- Vídeo pitch: o player do YouTube só carrega no clique ---------- */
  var capa = document.querySelector(".video-capa");
  if (capa) {
    var aquecido = false;
    var aquecer = function () {
      // Abre a conexão com o YouTube quando o leitor demonstra intenção: o player começa mais rápido.
      if (aquecido) return;
      aquecido = true;
      ["https://www.youtube-nocookie.com", "https://www.google.com"].forEach(function (h) {
        var l = document.createElement("link"); l.rel = "preconnect"; l.href = h; document.head.appendChild(l);
      });
    };
    capa.addEventListener("pointerenter", aquecer, { passive: true });
    capa.addEventListener("touchstart", aquecer, { passive: true });
    capa.addEventListener("focus", aquecer);
    capa.addEventListener("click", function (e) {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return; // abrir em nova aba continua funcionando
      e.preventDefault();
      var f = document.createElement("iframe");
      f.src = capa.getAttribute("data-embed") + "&autoplay=1";
      f.title = capa.getAttribute("data-titulo");
      f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      f.referrerPolicy = "strict-origin-when-cross-origin";
      f.setAttribute("allowfullscreen", "");
      capa.parentNode.replaceChild(f, capa);
      f.focus();
    });
  }

  /* ---------- Capturas: aviso de pendência e ampliação ---------- */
  var lightbox = document.querySelector(".lightbox");
  var lbImg = lightbox && lightbox.querySelector(".lightbox-img");
  var lbLegenda = lightbox && lightbox.querySelector(".lightbox-legenda");
  var lbFechar = lightbox && lightbox.querySelector(".lightbox-fechar");
  var origemFoco = null;

  function marcarFaltando(figura, botao) {
    figura.classList.add("faltando");
    botao.setAttribute("aria-disabled", "true");
    botao.setAttribute("tabindex", "-1");
    botao.setAttribute("aria-label", "Captura " + figura.dataset.id + " pendente");
  }

  function abrir(img, legenda) {
    if (!lightbox || typeof lightbox.showModal !== "function") {
      window.open(img.currentSrc || img.src, "_blank", "noopener");
      return;
    }
    origemFoco = document.activeElement;
    lbImg.src = img.currentSrc || img.src;
    lbImg.alt = img.alt;
    if (typeof legenda === "string") lbLegenda.textContent = legenda;
    else lbLegenda.innerHTML = legenda ? legenda.innerHTML : "";
    lightbox.showModal();
    lbFechar.focus();
  }

  // Usada pelas capturas desenhadas em React (artigo.js).
  window.nwAbrirImagem = abrir;

  if (lightbox) {
    lbFechar.addEventListener("click", function () { lightbox.close(); });
    // Clique fora da imagem (no fundo escurecido) também fecha.
    lightbox.addEventListener("click", function (e) {
      if (e.target === lightbox) lightbox.close();
    });
    lightbox.addEventListener("close", function () {
      lbImg.removeAttribute("src");
      if (origemFoco) origemFoco.focus();
    });
  }

  document.querySelectorAll(".tela").forEach(function (figura) {
    var botao = figura.querySelector(".tela-abrir");
    var img = figura.querySelector("img");
    var legenda = figura.querySelector("figcaption");

    img.addEventListener("error", function () { marcarFaltando(figura, botao); });
    if (img.complete && img.naturalWidth === 0 && img.getAttribute("src")) marcarFaltando(figura, botao);

    botao.addEventListener("click", function () {
      if (figura.classList.contains("faltando")) return;
      abrir(img, legenda);
    });
  });

  /* ---------- Cabeçalho: link da seção visível ---------- */
  var links = Array.prototype.slice.call(document.querySelectorAll('.menu a[href^="#"]'));
  if (links.length && "IntersectionObserver" in window) {
    var porId = {};
    links.forEach(function (a) { porId[a.getAttribute("href").slice(1)] = a; });
    var marcar = function (id) {
      links.forEach(function (a) { a.removeAttribute("aria-current"); });
      if (porId[id]) porId[id].setAttribute("aria-current", "location");
    };
    // Faixa no meio da tela: a seção que a cruza é a seção atual.
    var observador = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) { if (e.isIntersecting) marcar(e.target.id); });
    }, { rootMargin: "-45% 0px -50% 0px" });
    document.querySelectorAll("main > section[id]").forEach(function (s) { observador.observe(s); });
  }

  /* ---------- Entrada suave dos blocos ---------- */
  // Só com movimento permitido. Sem JS, ou com movimento reduzido, tudo aparece de imediato.
  var semMovimento = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Com a camada de movimento (vivo.js, sinalizada por html.nv-intro), as revelações ficam a cargo dela.
  var comCamadaViva = document.documentElement.classList.contains("nv-intro");
  if (!semMovimento && !comCamadaViva && "IntersectionObserver" in window) {
    var blocos = document.querySelectorAll(
      ".bloco h2, .contraste-lado, .evolucao-lado, .pilar, .cartao, .fluxo-criacao, .rf-ficha"
    );
    var revelador = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("visivel");
          revelador.unobserve(e.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    var alturaTela = window.innerHeight || document.documentElement.clientHeight;
    blocos.forEach(function (b) {
      // O que já está na tela ao carregar não é escondido.
      if (b.getBoundingClientRect().top < alturaTela) return;
      b.classList.add("revelar");
      revelador.observe(b);
    });
  }
})();
