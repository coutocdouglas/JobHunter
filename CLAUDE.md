# JobHunter — guia para o Claude Code

App de Windows (Electron) que busca vagas remotas de visualização arquitetônica (ArchViz) / artista 3D, dá uma nota de aderência ao perfil do usuário, mantém um funil de candidaturas e prepara e-mails como **rascunho no Gmail** com currículo, portfólio e cover letter anexos. Também tem uma lista de **estúdios** para candidatura espontânea, separada das vagas.

Idioma: a interface, as mensagens, os commits e as respostas ao usuário são em **português do Brasil**.

## Regras do projeto (não quebrar)

- **Nenhum dado pessoal no repositório.** O repositório é público. Nome, contato, empregador, textos do currículo: tudo vem do currículo que o usuário carrega e das Configurações, e fica só no computador dele (`app.getPath('userData')`). Testes usam pessoas fictícias. Antes de cada commit, procure dados pessoais no diff.
- **O app nunca envia e-mail.** O OAuth do Gmail pede só `gmail.compose` e `gmail.readonly` (rascunhos e leitura). Não adicionar `gmail.send`.
- **E-mails só afirmam o que está no perfil.** `src/core/templates.js` monta as frases a partir do perfil; dado ausente = frase omitida. Não inventar experiência, ferramentas ou números.
- **LinkedIn não é raspado** (viola os termos e arrisca a conta). Vagas do LinkedIn entram só pelos e-mails de alerta, lidos via Gmail.
- **Texto vindo da internet nunca entra no DOM como HTML.** No renderer, use a função `h()` (textContent). Sem `innerHTML` com dados de vagas.
- **Fontes com limite:** cada fonte é consultada no máximo a cada 6 h (`MIN_INTERVAL_MS`); uma fonte que falha não derruba as outras.
- Segredos (token do Gmail, client secret) ficam criptografados com `safeStorage`; nunca em texto puro nem no repositório.

## Comandos

```bash
npm install
npm test        # node --test (testes do núcleo e da interface com jsdom), Node 22
npm start       # abre o app
npm run dist    # instalador Windows em dist/ (rode no Windows ou no GitHub Actions)
```

Instalador: `.github/workflows/build.yml`. Push na `main` roda os testes. Disparo manual (`gh workflow run build.yml --ref main`) ou tag `v*` gera o instalador no Windows e publica na Release `v<versão do package.json>` como `JobHunter-Setup.exe`. Link fixo: `https://github.com/coutocdouglas/JobHunter/releases/latest/download/JobHunter-Setup.exe`. Para uma versão nova, suba o `version` do `package.json` antes de disparar; se a versão já existir, o `.exe` é substituído.

## Arquitetura

```
src/core/        lógica pura, testável em Node (sem Electron)
  text.js        normalização, URL canônica (remove rastreadores), ids, datas
  detect.js      remoto/presencial, restrição de região, ferramentas do perfil (setMyProfile)
  score.js       nota de aderência 1–5 por regras, com motivos e avisos; termos brasileiros
  sources.js     coletores: We Work Remotely (RSS), Remotive, Remote OK, Greenhouse, Lever,
                 Ashby, Workable, Gupy (experimental), Adzuna; runAll() com isolamento de falhas
  rss.js         parser RSS mínimo
  store.js       SQLite via sql.js (arquivo em userData); vagas, funil, settings, rescore()
  library.js     biblioteca de documentos (cópias em userData/documentos), padrão por idioma
  studios.js     estúdios para candidatura espontânea, funil próprio, boards() para monitorar
  templates.js   e-mail de candidatura e de abordagem a partir do perfil (PT/EN)
  cvparse.js     lê o PDF do currículo (pdfjs-dist) e extrai o perfil; KNOWN_TOOLS
  gmail.js       OAuth PKCE com redirecionamento local, rascunho MIME com anexos, alertas do LinkedIn
src/main/        processo principal do Electron
  main.js        IPC, seeds, migrações, segredos, integração de tudo
  config.js      config.json validado (sanitize aceita só chaves conhecidas)
  preload.js     ponte window.jh (contextIsolation, sandbox)
src/renderer/    interface (HTML/CSS/JS puro): abas Vagas, Estúdios, Documentos, Configurações
seed/            vagas iniciais (*.json) e seed/estudios/ (estúdios); cada arquivo entra uma vez
tests/           node:test; fixtures sintéticas; renderer.test.js usa jsdom
```

Fluxo do perfil: carregar um currículo PDF em Documentos → `extractPdfText` + `profileFromText` → `mergeProfile` (não sobrescreve o que o usuário preencheu) → `config.profile` → `setMyProfile` (nota) + `store.rescore()`.

Dados no computador do usuário (`userData`): `jobhunter.sqlite`, `config.json`, `secrets.bin` (criptografado), `documentos/`.

## Fatos verificados (12/11/2026)

- Busca da Gupy: `https://portal.gupy.io/api/job-search/jobs?jobName=<termo>&limit=50&offset=0` (o endereço antigo `portal.api.gupy.io/api/job` dá 404). Busca só no título. Para ArchViz quase não há vagas lá.
- Páginas de carreiras confirmadas: Workable `utopia`, `boldr`, `soluis`, `visualhouse`; Greenhouse `squintopera`; Ashby `higharc`.
- No Brasil, vagas remotas de ArchViz quase não aparecem em portais (LinkedIn, Gupy). O app compensa com termos brasileiros (perspectivista, maquetista eletrônico, renderizador, visualizador/artista/generalista 3D, arquiteto 3D), Adzuna BR e a lista de estúdios.
- `pdfjs-dist` funciona dentro do app empacotado (asar) via `import()` dinâmico; testado num build Linux equivalente.

## Pendências conhecidas

- Primeira execução real no Windows ainda não foi relatada pelo usuário.
- Endpoints de We Work Remotely, Remotive, Remote OK, Lever e Adzuna foram testados só com respostas sintéticas.
- O parser de alertas do LinkedIn foi testado com e-mail sintético.
- O instalador não é assinado (aviso do SmartScreen).
- `actions/checkout@v4` e `setup-node@v4` geram aviso de Node 20 descontinuado; atualizar quando houver versão nova.
