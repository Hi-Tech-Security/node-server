const WebSocket = require('ws');

// Replace with your server address and port
const SERVER_URL = 'wss://quicknotify.fly.dev';

// Connect to WebSocket server
// const ws = new WebSocket(SERVER_URL);

const ws = new WebSocket(SERVER_URL, {
    rejectUnauthorized: false, // Optional: skip TLS verification if testing
  });

ws.binaryType = 'arraybuffer';

ws.on('open', () => {
  console.log('Connected to server');

  // Simulate sending audio chunks every 500ms
  setInterval(() => {
    // Generate dummy audio data chunk (e.g., 512 bytes of random data)
    const audioChunk = Buffer.alloc(512);
    for (let i = 0; i < audioChunk.length; i++) {
      audioChunk[i] = Math.floor(Math.random() * 256);
    }

    ws.send(audioChunk, { binary: true }, (err) => {
      if (err) {
        console.error('Error sending audio chunk:', err);
      } else {
        console.log(`Sent audio chunk (${audioChunk.length} bytes)`);
      }
    });
  }, 500);
});

ws.on('message', (data, isBinary) => {
  if (isBinary) {
    console.log(`Received binary data (${data.length} bytes) from server`);
  } else {
    console.log(`Received text message from server: ${data.toString()}`);
  }
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

ws.on('close', (code, reason) => {
  console.log(`Connection closed. Code: ${code}, Reason: ${reason}`);
});
