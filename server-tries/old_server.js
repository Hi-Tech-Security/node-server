const WebSocket = require('ws');
const http = require('http');
const axios = require('axios');

class AudioWebSocketServer {
    constructor() {
        this.microcontrollerWs = null;
        this.webSocketClients = new Set();
        this.isStreaming = false;
        this.heartbeatIntervals = new Map();
        
        // Configuration
        this.config = {
            microcontrollerPort: 3000,  // WebSocket port for microcontroller
            webSocketPort: 3001,        // WebSocket port for frontend
            laravelBaseUrl: process.env.LARAVEL_BASE_URL || 'http://localhost:8000',
            heartbeatInterval: 120000,
            connectionTimeout: 300000
        };
        
        this.initializeMicrocontrollerWebSocketServer();
        this.initializeWebSocketServer();
    }

    // Initialize WebSocket server for microcontroller connections
    
    initializeMicrocontrollerWebSocketServer() {
        const server = http.createServer();
        this.microcontrollerWss = new WebSocket.Server({ 
            server,
            perMessageDeflate: false
        });
    
        this.microcontrollerWss.on('connection', (ws, req) => {
            console.log('🎤 Microcontroller WebSocket connected from:', req.socket.remoteAddress);
            
            this.microcontrollerWs = ws;
            this.isStreaming = true;
    
            // Send connection confirmation
            ws.send('Connected to Server');
            console.log('📤 Sent connection confirmation to microcontroller');
    
            // Send Listen command immediately
            ws.send('Listen');
            console.log('📤 Sent "Listen" command to microcontroller immediately after connection');
    
            // Start heartbeat
            this.startHeartbeat(ws);
    
            ws.on('message', (data) => {
                const message = data.toString().trim();
                
                // Handle text messages
                if (message === 'pong') {
                    console.log('💓 Heartbeat response received');
                    return;
                }
                
                if (message === 'ESP32 connected') {
                    console.log('🎤 ESP32 identification received');
            
                    return;
                }
                
                // Handle binary audio data
                if (Buffer.isBuffer(data) && data.length > 100) {
                    console.log(`📊 Received ${data.length} bytes at ${new Date().toISOString()}`);
                    this.broadcastAudioToClients(data);
                } else if (message.length < 100) {
                    console.log(`📝 Text message from microcontroller: ${message}`);
                }
            });
    
            ws.on('close', (code, reason) => {
                console.log(`🎤 Microcontroller disconnected (${code}: ${reason})`);
                this.cleanupMicrocontrollerConnection(ws);
            });
    
            ws.on('error', (err) => {
                console.error('🎤 Microcontroller WebSocket error:', err);
                this.cleanupMicrocontrollerConnection(ws);
            });
        });
    
        server.listen(this.config.microcontrollerPort, () => {
            console.log(`🎤 Microcontroller WebSocket server listening on port ${this.config.microcontrollerPort}`);
        });
    }

    // Start heartbeat for WebSocket connection
    startHeartbeat(ws) {
        const intervalId = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send('ping');
                    console.log('💓 Heartbeat sent to microcontroller');
                } catch (err) {
                    console.error('💓 Heartbeat send error:', err);
                    clearInterval(intervalId);
                    this.heartbeatIntervals.delete(ws);
                }
            } else {
                console.log('💓 Stopping heartbeat - WebSocket unavailable');
                clearInterval(intervalId);
                this.heartbeatIntervals.delete(ws);
            }
        }, this.config.heartbeatInterval);

        this.heartbeatIntervals.set(ws, intervalId);
        console.log('💓 Heartbeat started for microcontroller');
    }

    // Clean up microcontroller connection
    cleanupMicrocontrollerConnection(ws) {
        if (this.heartbeatIntervals.has(ws)) {
            clearInterval(this.heartbeatIntervals.get(ws));
            this.heartbeatIntervals.delete(ws);
            console.log('💓 Heartbeat stopped for microcontroller');
        }

        if (this.microcontrollerWs === ws) {
            this.microcontrollerWs = null;
            this.isStreaming = false;
            this.notifyClientsStreamEnded();
        }
    }

    // Initialize WebSocket server for frontend clients (unchanged)
    initializeWebSocketServer() {
        const server = http.createServer();
        this.wss = new WebSocket.Server({ 
            server,
            perMessageDeflate: false,
            maxPayload: 1024 * 1024 * 10
        });

        this.wss.on('connection', async (ws, req) => {
            console.log('🌐 Frontend client attempting connection');

            try {
                const url = new URL(req.url, `http://${req.headers.host}`);
                const token = url.searchParams.get('token');

                if (!token) {
                    ws.close(1008, 'Authentication token required');
                    return;
                }

                const isValid = await this.validateToken(token);
                if (!isValid) {
                    ws.close(1008, 'Invalid authentication token');
                    return;
                }

                console.log('🌐 Frontend client authenticated and connected');
                this.webSocketClients.add(ws);

                ws.isAlive = true;
                
                ws.on('pong', () => {
                    ws.isAlive = true;
                });

                ws.send(JSON.stringify({
                    type: 'status',
                    streaming: this.isStreaming,
                    message: this.isStreaming ? 'Audio stream active' : 'Waiting for microcontroller'
                }));

                ws.on('close', (code, reason) => {
                    console.log(`🌐 Frontend client disconnected (${code}: ${reason})`);
                    this.webSocketClients.delete(ws);
                });

                ws.on('error', (err) => {
                    console.error('🌐 WebSocket client error:', err);
                    this.webSocketClients.delete(ws);
                });

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

        this.wsHeartbeatInterval = setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    console.log('🌐 Terminating unresponsive WebSocket client');
                    return ws.terminate();
                }
                
                ws.isAlive = false;
                ws.ping();
            });
        }, 30000);

        server.listen(this.config.webSocketPort, () => {
            console.log(`🌐 WebSocket server listening on port ${this.config.webSocketPort}`);
        });
    }

    // Handle messages from WebSocket clients
    handleClientMessage(ws, data) {
        switch (data.type) {
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                break;
            
            case 'start-listening':
                if (this.microcontrollerWs && this.microcontrollerWs.readyState === WebSocket.OPEN) {
                    this.microcontrollerWs.send('Listen');
                    console.log('📤 Sent "Listen" command to microcontroller via WebSocket request');
                }
                break;
                
            case 'stop-listening':
                if (this.microcontrollerWs && this.microcontrollerWs.readyState === WebSocket.OPEN) {
                    this.microcontrollerWs.send('Stop');
                    console.log('📤 Sent "Stop" command to microcontroller via WebSocket request');
                }
                break;
            
            case 'get-status':
                ws.send(JSON.stringify({
                    type: 'status',
                    streaming: this.isStreaming,
                    connectedClients: this.webSocketClients.size,
                    microcontrollerConnected: !!this.microcontrollerWs,
                    uptime: process.uptime()
                }));
                break;
            
            default:
                console.log('Unknown message type:', data.type);
        }
    }

    // Rest of the methods remain the same...
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

    broadcastAudioToClients(audioData) {
        if (this.webSocketClients.size === 0) return;

        const message = JSON.stringify({
            type: 'audio',
            data: audioData.toString('base64'),
            timestamp: Date.now()
        });

        const deadClients = new Set();

        this.webSocketClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(message);
                } catch (err) {
                    console.error('🌐 Error sending to WebSocket client:', err);
                    deadClients.add(client);
                }
            } else {
                deadClients.add(client);
            }
        });

        deadClients.forEach(client => {
            this.webSocketClients.delete(client);
        });

        if (deadClients.size > 0) {
            console.log(`🌐 Cleaned up ${deadClients.size} dead WebSocket connections`);
        }
    }

    notifyClientsStreamEnded() {
        const message = JSON.stringify({
            type: 'status',
            streaming: false,
            message: 'Audio stream ended'
        });

        this.webSocketClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(message);
                } catch (err) {
                    console.error('🌐 Error notifying client of stream end:', err);
                }
            }
        });
    }

    shutdown() {
        console.log('🛑 Shutting down servers...');
        
        if (this.wsHeartbeatInterval) {
            clearInterval(this.wsHeartbeatInterval);
        }
        
        this.heartbeatIntervals.forEach((intervalId) => {
            clearInterval(intervalId);
        });
        this.heartbeatIntervals.clear();
        
        this.webSocketClients.forEach((client) => {
            try {
                client.close(1001, 'Server shutting down');
            } catch (err) {
                console.error('Error closing WebSocket client:', err);
            }
        });

        if (this.microcontrollerWs && this.microcontrollerWs.readyState === WebSocket.OPEN) {
            this.microcontrollerWs.close();
        }

        this.microcontrollerWss.close(() => {
            console.log('🎤 Microcontroller WebSocket server closed');
        });
        
        this.wss.close(() => {
            console.log('🌐 WebSocket server closed');
        });
    }
}

// Initialize and start the server
const audioServer = new AudioWebSocketServer();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    audioServer.shutdown();
    setTimeout(() => process.exit(0), 2000);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    audioServer.shutdown();
    setTimeout(() => process.exit(0), 2000);
});

console.log('🚀 Audio WebSocket Server started successfully!');
console.log('📡 Microcontroller should connect to: ws://localhost:3000');
console.log('🌐 Frontend should connect to: ws://localhost:3001?token=YOUR_TOKEN');