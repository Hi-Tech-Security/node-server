const WebSocket = require('ws');
const net = require('net');
const http = require('http');
const axios = require('axios');

class AudioWebSocketServer {
    constructor() {
        this.microcontrollerSocket = null;
        this.webSocketClients = new Set();
        this.isStreaming = false;
        
        // Configuration
        this.config = {
            microcontrollerPort: 3000,
            webSocketPort: 3001,
            laravelBaseUrl: process.env.LARAVEL_BASE_URL || 'http://localhost:8000',
            bufferSize: 1024 * 4 // 4KB buffer for audio chunks
        };
        
        this.initializeMicrocontrollerServer();
        this.initializeWebSocketServer();
    }

    // Initialize TCP server for microcontroller connections
    initializeMicrocontrollerServer() {
        this.microcontrollerServer = net.createServer((socket) => {
            console.log('🎤 Microcontroller connected from:', socket.remoteAddress);
            
            this.microcontrollerSocket = socket;
            this.isStreaming = true;

            // Handle incoming audio data
            socket.on('data', (audioData) => {
                this.broadcastAudioToClients(audioData);
            });

            socket.on('close', () => {
                console.log('🎤 Microcontroller disconnected');
                this.microcontrollerSocket = null;
                this.isStreaming = false;
                this.notifyClientsStreamEnded();
            });

            socket.on('error', (err) => {
                console.error('🎤 Microcontroller connection error:', err);
                this.microcontrollerSocket = null;
                this.isStreaming = false;
            });
        });

        this.microcontrollerServer.listen(this.config.microcontrollerPort, () => {
            console.log(`🎤 Microcontroller server listening on port ${this.config.microcontrollerPort}`);
        });
    }

    // Initialize WebSocket server for frontend clients
    initializeWebSocketServer() {
        const server = http.createServer();
        this.wss = new WebSocket.Server({ server });

        this.wss.on('connection', async (ws, req) => {
            console.log('🌐 Frontend client attempting connection');

            try {
                // Extract token from URL query params
                const url = new URL(req.url, `http://${req.headers.host}`);
                const token = url.searchParams.get('token');

                if (!token) {
                    ws.close(1008, 'Authentication token required');
                    return;
                }

                // Validate token with Laravel backend
                const isValid = await this.validateToken(token);
                if (!isValid) {
                    ws.close(1008, 'Invalid authentication token');
                    return;
                }

                console.log('🌐 Frontend client authenticated and connected');
                this.webSocketClients.add(ws);

                // Send initial status
                ws.send(JSON.stringify({
                    type: 'status',
                    streaming: this.isStreaming,
                    message: this.isStreaming ? 'Audio stream active' : 'Waiting for microcontroller'
                }));

                // Handle client disconnection
                ws.on('close', () => {
                    console.log('🌐 Frontend client disconnected');
                    this.webSocketClients.delete(ws);
                });

                ws.on('error', (err) => {
                    console.error('🌐 WebSocket client error:', err);
                    this.webSocketClients.delete(ws);
                });

                // Handle client messages
                ws.on('message', (message) => {
                    try {
                        const data = JSON.parse(message);
                        this.handleClientMessage(ws, data);
                    } catch (err) {
                        console.error('Invalid JSON from client:', err);
                    }
                });

            } catch (error) {
                console.error('🌐 Client connection error:', error);
                ws.close(1011, 'Server error during authentication');
            }
        });

        server.listen(this.config.webSocketPort, () => {
            console.log(`🌐 WebSocket server listening on port ${this.config.webSocketPort}`);
        });
    }

    // Validate authentication token with Laravel
    async validateToken(token) {
        try {
            const response = await axios.post(`${this.config.laravelBaseUrl}/api/v1/audio/validate-token`, {
                token: token
            }, {
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            return response.data.valid === true;
        } catch (error) {
            console.error('Token validation error:', error.message);
            return false;
        }
    }

    // Broadcast audio data to all connected WebSocket clients
    broadcastAudioToClients(audioData) {
        if (this.webSocketClients.size === 0) return;

        const message = JSON.stringify({
            type: 'audio',
            data: audioData.toString('base64'), // Convert binary to base64 for WebSocket
            timestamp: Date.now()
        });

        this.webSocketClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            } else {
                this.webSocketClients.delete(client);
            }
        });
    }

    // Notify clients when stream ends
    notifyClientsStreamEnded() {
        const message = JSON.stringify({
            type: 'status',
            streaming: false,
            message: 'Audio stream ended'
        });

        this.webSocketClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    // Handle messages from WebSocket clients
    handleClientMessage(ws, data) {
        switch (data.type) {
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                break;
            
            case 'get-status':
                ws.send(JSON.stringify({
                    type: 'status',
                    streaming: this.isStreaming,
                    connectedClients: this.webSocketClients.size,
                    microcontrollerConnected: !!this.microcontrollerSocket
                }));
                break;
            
            default:
                console.log('Unknown message type:', data.type);
        }
    }

    // Graceful shutdown
    shutdown() {
        console.log('🛑 Shutting down servers...');
        
        // Close all WebSocket connections
        this.webSocketClients.forEach((client) => {
            client.close(1001, 'Server shutting down');
        });

        // Close microcontroller connection
        if (this.microcontrollerSocket) {
            this.microcontrollerSocket.end();
        }

        // Close servers
        this.microcontrollerServer.close();
        this.wss.close();
    }
}

// Initialize and start the server
const audioServer = new AudioWebSocketServer();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    audioServer.shutdown();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    audioServer.shutdown();
    process.exit(0);
});

console.log('🚀 Audio WebSocket Server started successfully!');
console.log('📡 Microcontroller should connect to: localhost:3000');
console.log('🌐 Frontend should connect to: ws://localhost:3001?token=YOUR_TOKEN');
console.log('🔧 Laravel base URL:', process.env.LARAVEL_BASE_URL || 'http://localhost:8000');