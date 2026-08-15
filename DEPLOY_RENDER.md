# Publicar o Cat Chibi Arena Online no Render

O projeto já está configurado para Render por meio do arquivo `render.yaml`.

## Você só precisa fazer estas ações nas suas contas

1. Crie um repositório novo no GitHub.
2. Envie **o conteúdo desta pasta** para a raiz do repositório.
3. Entre no Render e escolha **New > Blueprint**.
4. Conecte sua conta do GitHub e selecione o repositório.
5. O Render detectará `render.yaml` e mostrará o serviço `cat-chibi-arena-online`.
6. Clique em **Apply / Deploy**.
7. Quando aparecer a URL `https://...onrender.com`, abra-a nos dois computadores/celulares.
8. Um jogador cria a sala e manda o código para o outro.

## Configuração já pronta

- Runtime: Node.js
- Plano inicial: Free
- Build: `npm install`
- Start: `npm start`
- Health check: `/`
- WebSocket público suportado pelo mesmo serviço
- Porta: variável `PORT` do Render
- Bind: `0.0.0.0`

## Observação

O servidor guarda as salas na memória. Se uma instância gratuita dormir ou reiniciar, a sala atual desaparece e basta criar outra.
