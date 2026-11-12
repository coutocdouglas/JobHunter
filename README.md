# JobHunter

Programa para Windows que ajuda a achar vagas remotas de ArchViz/artista 3D, mostra tudo num painel, e prepara a candidatura de cada vaga que você escolher como **rascunho no seu Gmail**.

Tudo roda no seu computador. Currículos, banco de vagas e credenciais ficam na sua máquina, nunca neste repositório.

## O que ele faz

1. **Busca vagas** em fontes que permitem automação: We Work Remotely, Remotive, Remote OK, páginas de carreira de estúdios (Greenhouse, Lever, Ashby, Workable) e, opcionalmente, Adzuna (ajuda no Brasil). Cada fonte é consultada no máximo a cada 6 horas.
2. **Dá uma nota de aderência de 1 a 5** com regras simples (cargo de ArchViz, 3ds Max/Corona/Photoshop, remoto, restrição de região, senioridade). Mostra os motivos e os avisos de cada nota.
3. **Mostra o funil**: nova, aplicar, talvez, rascunho, enviada, respondeu, entrevista, descartada.
4. **Prepara a candidatura**: gera o e-mail em português ou inglês com modelos que só afirmam o que está no seu currículo, e cria o **rascunho** no Gmail com o currículo certo e o portfólio anexos. **O app não envia e-mail**: ele só pede permissão de rascunho e leitura, nunca a de envio. Você revisa e clica em enviar no Gmail.
5. **LinkedIn sem raspagem**: o LinkedIn não oferece API de vagas e raspar o site viola os termos. O caminho é criar alertas de vagas no LinkedIn (chegam por e-mail) e usar **Importar alertas do LinkedIn**.

Na primeira execução o banco já vem com 15 vagas da varredura manual de 12/11/2026 (`seed/`). Várias delas têm status "não verificada": abra o link antes de candidatar.

## Instalar

Baixe o `.exe` mais recente em **Releases**. O instalador não é assinado digitalmente, então o Windows SmartScreen pode avisar: clique em "Mais informações" e "Executar assim mesmo".

## Primeiros passos

1. Em **Configurações**, confira seus dados e escolha os PDFs do currículo (PT e EN) e do portfólio.
2. **Gmail** (necessário só para criar rascunhos e importar alertas):
   - No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto e ative a **Gmail API**.
   - Em *Tela de consentimento OAuth*, tipo **Externo**, e publique o app em **Produção** (uso pessoal, sem verificação). Em modo "Teste", o login expira em 7 dias.
   - Em *Credenciais*, crie um **ID do cliente OAuth** do tipo **App para computador**.
   - Cole o Client ID e o Client Secret nas Configurações e clique em **Conectar ao Gmail**.
   - O token fica criptografado pelo Windows (`safeStorage`).
3. **Estúdios para monitorar**: ache a página de carreiras do estúdio e copie o identificador da URL (`boards.greenhouse.io/xxx`, `jobs.lever.co/xxx`, `jobs.ashbyhq.com/xxx`, `apply.workable.com/xxx`). Um por linha.
4. Clique em **Buscar vagas agora**.

## Limites que você precisa conhecer

- Os endpoints das fontes foram escritos a partir da documentação pública de cada uma e testados com respostas **sintéticas** (`tests/`). A primeira busca real pode revelar ajustes; cada fonte falha sozinha e o resultado aparece na tela.
- As vagas importadas do LinkedIn trazem só o título e o link. A nota delas é estimada pelo título.
- A nota de aderência é uma estimativa por regras, não uma garantia.
- Vagas que pedem candidatura por portal (Workable, CGconnect, Upwork, LinkedIn) não têm e-mail: o app prepara o texto e você cola no portal.

## Desenvolvimento

```bash
npm install
npm test          # testes do núcleo e da interface (Node 22)
npm start         # abre o app
npm run dist      # gera o instalador em dist/ (no Windows)
```

Para publicar uma versão: crie uma tag `v0.1.0` e faça push. O GitHub Actions roda os testes, gera o instalador e anexa na página de Releases.

Estrutura: `src/core` (coleta, nota, banco SQLite via sql.js, modelos de e-mail, Gmail), `src/main` (Electron), `src/renderer` (interface), `seed/` (vagas iniciais), `tests/`.
