const WebSocket = require('ws');
const http = require('http');
const uuid = require('uuid');

const server = http.createServer();
const wss = new WebSocket.Server({ server });
const rooms = new Map();

wss.on('connection', (ws) => {
  ws.id = uuid.v4();
  let roomId = null;

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    switch (msg.type) {
      case 'join':
        roomId = msg.roomId;
        if (!rooms.has(roomId)) rooms.set(roomId, new Set());
        rooms.get(roomId).add(ws);
        broadcast(roomId, { type: 'user-joined', userId: ws.id }, ws);
        break;

      case 'signal':
        const target = [...rooms.get(roomId)].find(client => client.id === msg.target);
        target?.send(JSON.stringify(msg));
        break;
    }
  });

  ws.on('close', () => {
    if (roomId && rooms.has(roomId)) {
      rooms.get(roomId).delete(ws);
      broadcast(roomId, { type: 'user-left', userId: ws.id });
    }
  });
});

function broadcast(roomId, msg, exclude = null) {
  const clients = rooms.get(roomId) || [];
  clients.forEach(client => {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  });
}

server.listen(3001, () => console.log('Signaling server running on ws://localhost:3001'));