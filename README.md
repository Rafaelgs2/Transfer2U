# Transfer2U

Envie textos e arquivos entre celular, computador e amigos. Sem cadastro: crie uma sala (com senha opcional), compartilhe o link/QR e ela expira sozinha (1h, 24h ou 7 dias).

Stack: Next.js na Vercel + **Upstash Redis** (salas e mensagens) + **Vercel Blob** (arquivos). Tudo no plano grátis.

## Como funciona
- Redis guarda cada sala como chaves com expiração: quando o prazo acaba, tudo some sozinho.
- Entrar numa sala gera um cookie assinado (JWT) válido até a sala expirar. Senha é guardada como hash bcrypt.
- Arquivos: o navegador envia direto ao Vercel Blob (privado) com um token curto gerado pela API; isso passa do limite de 4,5 MB das funções. O download passa pela API, que confere o cookie e faz stream do arquivo.
- Atualização quase em tempo real por polling a cada 4 s (só com a aba visível). O cliente manda a última versão vista e o servidor responde "sem mudanças" com um único comando Redis.
- Os arquivos de salas expiradas são apagados pelo cron diário (`vercel.json`); as salas em si já ficam inacessíveis na hora.

## Configurar
1. Suba o projeto para um repositório Git e importe na **Vercel**.
2. No projeto, aba **Storage**: crie um **Blob** store (gera `BLOB_STORE_ID`; a autenticação é por OIDC, sem token fixo) e adicione **Upstash Redis** pelo Marketplace (gera as variáveis de URL/token do Redis).
3. Em *Settings → Environment Variables*, adicione também `ROOM_TOKEN_SECRET` e `CRON_SECRET` (valores aleatórios; veja `.env.example`):
   ```bash
   openssl rand -base64 48
   ```
4. Rodar localmente, trazendo as variáveis do projeto:
   ```bash
   npm install
   npx vercel link
   npx vercel env pull .env.local
   npm run dev
   ```
   Abra `http://localhost:3000`. Para testar do celular, use a URL de deploy da Vercel.

## Limites do plano grátis (confira ao criar a conta)
- Arquivo: 50 MB por arquivo (limite definido no app). Blob e Redis têm cotas mensais/diárias próprias.
- Polling consome comandos Redis e invocações de função: ~15 por minuto por aba aberta. Se começar a estourar, aumente `POLL_MS` em `app/r/[id]/page.tsx`.
- Vercel Hobby é só para uso não comercial; o cron roda no máximo 1x por dia.

## Próximos passos possíveis
Tempo real de verdade (Pusher/Ably), compartilhar arquivo direto do menu do celular (Web Share Target, exige service worker), criptografia ponta a ponta, barra de progresso no upload.
