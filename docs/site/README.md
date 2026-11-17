# Site de apresentação (artigo técnico)

O site da amostra tecnológica é um **artigo técnico** que aprofunda o vídeo pitch. Ele é publicado **somente pelo GitHub Pages**, a partir da raiz do repositório:

```
index.html          página única do artigo (raiz do repositório)
.nojekyll           impede o Jekyll do Pages de filtrar arquivos e pastas
site-assets/
├── css/site.css    estilos (tema escuro do NodeWatch)
├── js/site.js      menu, ampliação das capturas, link ativo, entrada suave
├── js/artigo.js    seção de Machine Learning em React 18 (abas e simulador de score)
├── vendor/         react-18.3.1 e react-dom-18.3.1 (UMD, cópia de interface/assets/vendor) + licença
└── img/            logo, ícones, og-image e capturas tela-*.jpg
```

## Regras para não quebrar no GitHub Pages

- Todos os caminhos no `index.html` começam com `./site-assets/…`. Nunca use `/…` (aponta para a raiz do domínio `github.io`, não do repositório) nem `../…`.
- Nomes de arquivos e pastas do site em **minúsculas**: o servidor do Pages diferencia maiúsculas de minúsculas.
- Nada depende do Flask, de `/api` ou de CDN: React vem de `site-assets/vendor/`, sem Babel (os componentes usam `React.createElement`).
- Se o React não carregar, a seção de ML mostra a versão estática que está dentro de `#ml-interativo`.

## Publicar

1. No GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, pasta `/ (root)`.
2. O endereço fica `https://<usuario>.github.io/<repositorio>/`.

Para conferir antes do push, sirva a raiz do repositório:

```bash
python -m http.server 8000
```

e abra `http://127.0.0.1:8000/`.

## Estrutura do artigo

1. **Resumo**: problema (regras estáticas × *smurfing*/*layering*/falsos positivos), solução e KPIs.
2. **Pipeline**: ingestão e validação → grafo → atributos e inferência → triagem visual, com as capturas do painel.
3. **Machine Learning** (React): modelo de lavagem, rigor causal e simulador do score 0–1000.
4. **Referência rápida**: algoritmos de grafo, Random Forest, métricas, stack e bases.
5. **Ficha acadêmica**.

## Fonte dos números

| Número | Fonte |
|---|---|
| 5.078.345 transações, 5.177 positivas, 8 tipologias, recall por tipologia | `docs/ml/RELATORIO_ML.md`, seção 1 |
| AP 0,464; precisão 0,627; recall 0,407 (teste) | `docs/ml/RELATORIO_ML.md`, seção 1.3 |
| 49 e 21 atributos | `docs/COMO_FUNCIONA_O_NODEWATCH.md` |
| Faixas 0–300 / 301–700 / 701–1000 e conversão ancorada no limiar 0,0910 | `src/painel/score.py` |

## Imagens

`python scripts/site/preparar_imagens.py` (na raiz, precisa de Pillow) regenera `site-assets/img/` a partir de `docs/ui/capturas/` e `docs/marca/nodewatch-logo-transparente.png`, sem alterar os originais. As capturas são de uma análise do HI-Small de 01/09/2022 a 03/09/2022, dias que estão no treino do modelo; o artigo avisa que elas ilustram a interface e não medem desempenho.
