const http = require('http');
const WebSocket = require('ws');
const url = require('url');

// Create a basic HTTP server (can serve static files or API if needed)
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('WebSocket Audio Streaming Server');
});

// Create WebSocket server on top of HTTP server
const wss = new WebSocket.Server({ server });

// Heartbeat function to detect dead connections
function heartbeat() {
  this.isAlive = true;
}

// Log helper with timestamp
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// Handle new WebSocket connections
wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress;
  log(`New client connected from ${clientIP}`);

  ws.isAlive = true;
  ws.on('pong', heartbeat);

  // Log errors on this connection
  ws.on('error', (error) => {
    log(`Error on connection from ${clientIP}:`, error);
  });

  // Handle incoming messages (expecting binary audio data)
  ws.on('message', (message, isBinary) => {
    if (isBinary) {
      log(`Received binary message (${message.length} bytes) from ${clientIP}`);

      // Broadcast binary message to all other connected clients
      wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          try {
            client.send(message, { binary: true });
            log(`Forwarded audio chunk to client`);
          } catch (sendError) {
            log(`Error sending to client:`, sendError);
          }
        }
      });

    } else {
      // For text messages, just log them
      log(`Received text message from ${clientIP}: ${message.toString()}`);
    }
  });

  ws.on('close', (code, reason) => {
    log(`Client from ${clientIP} disconnected. Code: ${code}, Reason: ${reason}`);
  });
});

// Periodically ping clients to detect broken connections
const interval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) {
      log('Terminating stale connection');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping(() => {});
  });
}, 30000); // every 30 seconds

wss.on('error', (error) => {
  log('WebSocket server error:', error);
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  log(`Server listening on port ${PORT}`);
});

// Clean up on exit
process.on('SIGINT', () => {
  log('Server shutting down...');
  clearInterval(interval);
  wss.close(() => {
    server.close(() => {
      log('Server closed');
      process.exit(0);
    });
  });
});
