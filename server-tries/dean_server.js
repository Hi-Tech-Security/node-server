// server.js
const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });
let esp32Client = null;
let appClient = null;
console.log(`WebSocket server running on ws://localhost:${PORT}`);
wss.on('connection', function connection(ws, req) {
console.log('New client connected');
ws.on('message', function incoming(data, isBinary) {
// Check if message is binary or text
if (isBinary) {
// Binary audio from ESP32, forward to app
if (appClient && appClient.readyState === WebSocket.OPEN) {
appClient.send(data, { binary: true });
}
} else {
const message = data.toString();
// Identify client
if (message === 'ESP32') {
esp32Client = ws;
console.log('ESP32 client registered');
return;
}
if (message === 'APP') {
appClient = ws;
console.log('App client registered');
return;
}
// Commands from App to ESP32
if (message === 'Listen' || message === 'Stop') {
if (esp32Client && esp32Client.readyState === WebSocket.OPEN) {
esp32Client.send(message);
console.log(`Command '${message}' forwarded to ESP32`);
}
}
}
});
ws.on('close', () => {
if (ws === esp32Client) {
console.log('ESP32 disconnected');
esp32Client = null;
}
if (ws === appClient) {
console.log('App disconnected');
appClient = null;
}
});
});