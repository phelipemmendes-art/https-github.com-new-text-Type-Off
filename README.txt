CAT CHIBI ARENA ONLINE

ARQUIVOS
--------
server.js          servidor HTTP + WebSocket
package.json       configuração Node.js
public/index.html  jogo no navegador
render.yaml        configuração automática para Render
.node-version      versão de Node usada no deploy
DEPLOY_RENDER.md   passo a passo para publicar

TESTAR NO PC
------------
1. Instale Node.js.
2. Abra o terminal nesta pasta.
3. Rode:
      npm start
4. Abra:
      http://localhost:3000

JOGAR ONLINE
------------
O projeto já está preparado para Render.
Leia DEPLOY_RENDER.md.

Depois de publicado:
1. Os dois jogadores abrem a mesma URL pública.
2. Jogador 1 clica em Criar sala.
3. Jogador 2 digita o código e entra.

CONTROLES
---------
A / D: mover
Segurar W: carregar
Soltar W: lançar

PODERES
-------
Bola de Pelo: bloqueia o próximo golpe.
Catnip: aumenta velocidade e reduz intervalo entre disparos.
Super Rato Gigante: próximo disparo atravessa gatos comuns e causa 2 de dano.

IMPORTANTE
----------
As salas são mantidas na memória do servidor. Se o serviço reiniciar, é preciso criar uma sala nova.
