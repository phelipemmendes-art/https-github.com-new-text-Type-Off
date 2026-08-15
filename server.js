const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");

const server = http.createServer((req, res) => {
  let reqPath = req.url.split("?")[0];
  if (reqPath === "/") reqPath = "/index.html";

  const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC, safePath);

  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }

    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml"
    };

    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
});

const rooms = new Map();

const COLORS = [
  ["#f0a75f", "#ffe2ae"],
  ["#999ca0", "#e7e7e7"],
  ["#f4f0ea", "#ffffff"],
  ["#bd8661", "#efc29d"],
  ["#705d89", "#aa98c5"],
  ["#d895ae", "#ffd0dd"],
  ["#69aaa3", "#a9d8d3"]
];

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 6; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  } while (rooms.has(code));
  return code;
}

function makePlayer(id) {
  return {
    id,
    x: 0.5,
    y: id === "p1" ? 0.88 : 0.12,
    hp: 5,
    left: false,
    right: false,
    shield: 0,
    catnipUntil: 0,
    superMouse: false,
    cooldownUntil: 0
  };
}

function makeRoom(code) {
  return {
    code,
    clients: new Map(),
    players: {
      p1: makePlayer("p1"),
      p2: makePlayer("p2")
    },
    projectiles: [],
    powerups: [],
    nextProjectileId: 1,
    nextPowerId: 1,
    nextPowerAt: Date.now() + 5500,
    events: [],
    winnerId: null,
    lastTick: Date.now(),
    lastBroadcast: 0
  };
}

function resetRoom(room) {
  room.players.p1 = makePlayer("p1");
  room.players.p2 = makePlayer("p2");
  room.projectiles = [];
  room.powerups = [];
  room.nextPowerAt = Date.now() + 4500;
  room.events = [];
  room.winnerId = null;
}

function encodeWsFrame(text, opcode = 0x1) {
  const payload = Buffer.from(text);
  const length = payload.length;
  let header;

  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

function send(ws, payload) {
  if (!ws || ws.destroyed || !ws.writable) return;
  try {
    ws.write(encodeWsFrame(JSON.stringify(payload)));
  } catch {}
}

function broadcast(room, payload) {
  for (const ws of room.clients.values()) {
    send(ws, payload);
  }
}

function roomReady(room) {
  return room.clients.has("p1") && room.clients.has("p2");
}

function publicState(room) {
  const now = Date.now();

  return {
    type: "state",
    code: room.code,
    ready: roomReady(room),
    winnerId: room.winnerId,
    players: {
      p1: {
        id: "p1",
        x: room.players.p1.x,
        y: room.players.p1.y,
        hp: room.players.p1.hp,
        shield: room.players.p1.shield,
        catnipMs: Math.max(0, room.players.p1.catnipUntil - now),
        superMouse: room.players.p1.superMouse
      },
      p2: {
        id: "p2",
        x: room.players.p2.x,
        y: room.players.p2.y,
        hp: room.players.p2.hp,
        shield: room.players.p2.shield,
        catnipMs: Math.max(0, room.players.p2.catnipUntil - now),
        superMouse: room.players.p2.superMouse
      }
    },
    projectiles: room.projectiles.map(p => ({
      id: p.id,
      ownerId: p.ownerId,
      x: p.x,
      y: p.y,
      vy: p.vy,
      kind: p.kind,
      color: p.color
    })),
    powerups: room.powerups.map(p => ({
      id: p.id,
      type: p.type,
      x: p.x,
      y: p.y,
      targetId: p.targetId,
      lifeMs: Math.max(0, p.expiresAt - now)
    })),
    events: room.events.splice(0, room.events.length)
  };
}

function addEvent(room, event) {
  room.events.push({ ...event, id: `${Date.now()}-${Math.random()}` });
}

function shoot(room, playerId) {
  if (!roomReady(room) || room.winnerId) return;

  const now = Date.now();
  const p = room.players[playerId];
  if (now < p.cooldownUntil) return;

  const catnip = now < p.catnipUntil;
  p.cooldownUntil = now + (catnip ? 280 : 650);

  const isP1 = playerId === "p1";
  const useMouse = p.superMouse;
  p.superMouse = false;

  room.projectiles.push({
    id: room.nextProjectileId++,
    ownerId: playerId,
    x: p.x,
    y: p.y + (isP1 ? -0.065 : 0.065),
    vy: isP1 ? -0.070 : 0.070,
    kind: useMouse ? "mouse" : "cat",
    damage: useMouse ? 2 : 1,
    color: Math.floor(Math.random() * COLORS.length)
  });

  addEvent(room, { type: "shoot", playerId });
}

function spawnPower(room) {
  if (!roomReady(room) || room.winnerId) return;
  if (room.powerups.length >= 2) return;

  const targetId = Math.random() < 0.5 ? "p1" : "p2";
  const target = room.players[targetId];
  const types = ["furball", "catnip", "mouse"];
  const type = types[Math.floor(Math.random() * types.length)];

  room.powerups.push({
    id: room.nextPowerId++,
    type,
    targetId,
    x: 0.18 + Math.random() * 0.64,
    y: target.y,
    expiresAt: Date.now() + 12000
  });
}

function applyPower(room, player, power) {
  const now = Date.now();

  if (power.type === "furball") {
    player.shield = 1;
  } else if (power.type === "catnip") {
    player.catnipUntil = now + 8000;
  } else if (power.type === "mouse") {
    player.superMouse = true;
  }

  addEvent(room, {
    type: "power",
    playerId: player.id,
    powerType: power.type,
    x: player.x,
    y: player.y
  });
}

function updateRoom(room, dt) {
  if (!roomReady(room) || room.winnerId) return;

  const now = Date.now();

  for (const id of ["p1", "p2"]) {
    const p = room.players[id];
    const catnip = now < p.catnipUntil;
    const speed = catnip ? 0.62 : 0.42;
    const dir = (p.right ? 1 : 0) - (p.left ? 1 : 0);
    p.x += dir * speed * dt;
    p.x = Math.max(0.10, Math.min(0.90, p.x));
  }

  // Power-ups: aparecem na faixa do jogador indicado e são coletados por aproximação horizontal.
  for (let i = room.powerups.length - 1; i >= 0; i--) {
    const power = room.powerups[i];

    if (now >= power.expiresAt) {
      room.powerups.splice(i, 1);
      continue;
    }

    const p = room.players[power.targetId];
    if (Math.abs(p.x - power.x) < 0.055) {
      applyPower(room, p, power);
      room.powerups.splice(i, 1);
    }
  }

  if (now >= room.nextPowerAt) {
    spawnPower(room);
    room.nextPowerAt = now + 6500 + Math.random() * 4500;
  }

  // Movimento dos projéteis.
  for (const p of room.projectiles) {
    p.y += p.vy * dt;
  }

  // Colisão projétil x projétil.
  const removeIds = new Set();

  for (let i = 0; i < room.projectiles.length; i++) {
    const a = room.projectiles[i];
    if (removeIds.has(a.id)) continue;

    for (let j = i + 1; j < room.projectiles.length; j++) {
      const b = room.projectiles[j];
      if (removeIds.has(b.id)) continue;
      if (a.ownerId === b.ownerId) continue;

      if (Math.abs(a.x - b.x) < 0.052 && Math.abs(a.y - b.y) < 0.045) {
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;

        addEvent(room, { type: "catCollision", x: cx, y: cy });

        const aMouse = a.kind === "mouse";
        const bMouse = b.kind === "mouse";

        if (aMouse && !bMouse) {
          removeIds.add(b.id);
          continue;
        }

        if (bMouse && !aMouse) {
          removeIds.add(a.id);
          break;
        }

        removeIds.add(a.id);
        removeIds.add(b.id);
        break;
      }
    }
  }

  if (removeIds.size) {
    room.projectiles = room.projectiles.filter(p => !removeIds.has(p.id));
  }

  // Colisão projétil x jogador.
  for (let i = room.projectiles.length - 1; i >= 0; i--) {
    const shot = room.projectiles[i];
    const targetId = shot.ownerId === "p1" ? "p2" : "p1";
    const target = room.players[targetId];

    const hitX = Math.abs(shot.x - target.x) < 0.052;
    const hitY = Math.abs(shot.y - target.y) < 0.055;

    if (hitX && hitY) {
      if (target.shield > 0) {
        target.shield = 0;
        addEvent(room, {
          type: "blocked",
          playerId: targetId,
          x: shot.x,
          y: shot.y
        });
      } else {
        target.hp = Math.max(0, target.hp - shot.damage);
        addEvent(room, {
          type: "hit",
          playerId: targetId,
          damage: shot.damage,
          x: shot.x,
          y: shot.y
        });

        if (target.hp <= 0) {
          room.winnerId = shot.ownerId;
          addEvent(room, { type: "gameOver", winnerId: room.winnerId });
        }
      }

      room.projectiles.splice(i, 1);
      continue;
    }

    if (shot.y < -0.12 || shot.y > 1.12) {
      room.projectiles.splice(i, 1);
    }
  }
}


function handleClientMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }

  if (msg.type === "create_room") {
    if (ws.meta.roomCode) return;

    const code = randomCode();
    const room = makeRoom(code);
    rooms.set(code, room);

    room.clients.set("p1", ws);
    ws.meta.roomCode = code;
    ws.meta.playerId = "p1";

    send(ws, { type: "joined", code, playerId: "p1", waiting: true });
    return;
  }

  if (msg.type === "join_room") {
    if (ws.meta.roomCode) return;

    const code = String(msg.code || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      send(ws, { type: "error", message: "Sala não encontrada." });
      return;
    }

    if (room.clients.has("p2")) {
      send(ws, { type: "error", message: "Essa sala já está cheia." });
      return;
    }

    room.clients.set("p2", ws);
    ws.meta.roomCode = code;
    ws.meta.playerId = "p2";
    resetRoom(room);

    send(ws, { type: "joined", code, playerId: "p2", waiting: false });
    broadcast(room, { type: "room_ready", code });
    return;
  }

  const room = rooms.get(ws.meta.roomCode);
  const playerId = ws.meta.playerId;
  if (!room || !playerId) return;

  if (msg.type === "input") {
    const p = room.players[playerId];
    p.left = !!msg.left;
    p.right = !!msg.right;
    return;
  }

  if (msg.type === "shoot") {
    shoot(room, playerId);
    return;
  }

  if (msg.type === "restart") {
    if (roomReady(room)) {
      resetRoom(room);
      broadcast(room, { type: "restarted" });
    }
  }
}

function handleDisconnect(ws) {
  if (ws._closedHandled) return;
  ws._closedHandled = true;

  const { roomCode, playerId } = ws.meta || {};
  if (!roomCode || !playerId) return;

  const room = rooms.get(roomCode);
  if (!room) return;

  room.clients.delete(playerId);

  if (room.clients.size === 0) {
    rooms.delete(roomCode);
    return;
  }

  resetRoom(room);
  broadcast(room, {
    type: "opponent_left",
    message: "O outro jogador saiu da sala."
  });
}

function parseWsFrames(ws, chunk) {
  ws._wsBuffer = Buffer.concat([ws._wsBuffer || Buffer.alloc(0), chunk]);

  while (true) {
    const buffer = ws._wsBuffer;
    if (buffer.length < 2) return;

    const first = buffer[0];
    const second = buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (buffer.length < 4) return;
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buffer.length < 10) return;
      const big = buffer.readBigUInt64BE(2);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
        ws.destroy();
        return;
      }
      length = Number(big);
      offset = 10;
    }

    let mask = null;
    if (masked) {
      if (buffer.length < offset + 4) return;
      mask = buffer.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buffer.length < offset + length) return;

    let payload = Buffer.from(buffer.subarray(offset, offset + length));
    ws._wsBuffer = buffer.subarray(offset + length);

    if (masked) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= mask[i % 4];
      }
    }

    if (opcode === 0x8) {
      try { ws.end(encodeWsFrame("", 0x8)); } catch {}
      handleDisconnect(ws);
      return;
    }

    if (opcode === 0x9) {
      try { ws.write(encodeWsFrame(payload.toString(), 0xA)); } catch {}
      continue;
    }

    if (opcode === 0x1) {
      handleClientMessage(ws, payload.toString("utf8"));
    }
  }
}

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  const upgrade = String(req.headers.upgrade || "").toLowerCase();

  if (!key || upgrade !== "websocket") {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    "\r\n"
  );

  socket.meta = { roomCode: null, playerId: null };
  socket._wsBuffer = Buffer.alloc(0);
  socket._closedHandled = false;

  socket.on("data", chunk => parseWsFrames(socket, chunk));
  socket.on("close", () => handleDisconnect(socket));
  socket.on("end", () => handleDisconnect(socket));
  socket.on("error", () => handleDisconnect(socket));
});

setInterval(() => {
  const now = Date.now();

  for (const room of rooms.values()) {
    const dt = Math.min(0.05, Math.max(0.001, (now - room.lastTick) / 1000));
    room.lastTick = now;

    updateRoom(room, dt);

    // 30 atualizações por segundo deixam o movimento suave sem exagerar no tráfego.
    if (now - room.lastBroadcast >= 33) {
      room.lastBroadcast = now;
      broadcast(room, publicState(room));
    }
  }
}, 16);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Cat Chibi Arena Online rodando na porta ${PORT}`);
});
