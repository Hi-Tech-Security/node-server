const WebSocket = require('ws');
const net = require('net');
const http = require('http');
const axios = require('axios');

class AudioWebSocketServer {
    constructor() {
        this.microcontrollerSocket = null;
        this.webSocketClients = new Set();
        this.isStreaming = false;
        this.heartbeatIntervals = new Map(); // Track heartbeat intervals
        
        // Configuration
        this.config = {
            microcontrollerPort: 3000,
            webSocketPort: 3001,
            laravelBaseUrl: process.env.LARAVEL_BASE_URL || 'http://localhost:8000',
            bufferSize: 1024 * 4, // 4KB buffer for audio chunks
            heartbeatInterval: 120000, // 2 minutes
            connectionTimeout: 300000 // 5 minutes total timeout
        };
        
        this.initializeMicrocontrollerServer();
        this.initializeWebSocketServer();
    }

    // Initialize TCP server for microcontroller connections
    initializeMicrocontrollerServer() {
        this.microcontrollerServer = net.createServer((socket) => {
            console.log('🎤 Microcontroller connected from:', socket.remoteAddress);
            
            // Configure socket for stability and real-time audio
            socket.setKeepAlive(true, 30000); // Enable TCP keepalive with 30s interval
            socket.setNoDelay(true); // Disable Nagle's algorithm for real-time data
            socket.setTimeout(this.config.connectionTimeout); // 5 minute timeout
            
            this.microcontrollerSocket = socket;
            this.isStreaming = true;

            // Send connection confirmation message
            socket.write('Connected to Server\n');
            console.log('📤 Sent connection confirmation to microcontroller');

            // Start heartbeat mechanism (every 2 minutes to avoid disrupting microcontroller)
            this.startHeartbeat(socket);

            // Handle incoming audio data
            socket.on('data', (audioData) => {
                const dataStr = audioData.toString().trim();
                
                // Check if this is a heartbeat response
                if (dataStr === 'pong') {
                    console.log('💓 Heartbeat response received');
                    return;
                }
                
                // Check if this is the ESP32 connection message
                if (dataStr === 'ESP32 connected') {
                    console.log('🎤 ESP32 identification received');
                    // Send Listen command to start audio streaming
                    socket.write('Listen\n');
                    console.log('📤 Sent "Listen" command to ESP32');
                    return;
                }
                
                // Check if this is a text message (not audio data)
                if (audioData.length < 100 && /^[a-zA-Z0-9\s]+$/.test(dataStr)) {
                    console.log(`📝 Text message from microcontroller: ${dataStr}`);
                    return;
                }
                
                console.log(`📊 Received ${audioData.length} bytes at ${new Date().toISOString()}`);
                this.broadcastAudioToClients(audioData);
            });

            socket.on('close', (hadError) => {
                console.log('🎤 Microcontroller disconnected', hadError ? '(with error)' : '(gracefully)');
                this.cleanupMicrocontrollerConnection(socket);
            });

            socket.on('error', (err) => {
                console.error('🎤 Microcontroller connection error:', err);
                this.cleanupMicrocontrollerConnection(socket);
            });

            socket.on('timeout', () => {
                console.log('⏰ Microcontroller socket timeout occurred');
                socket.destroy(); // Force close the connection
            });

            socket.on('end', () => {
                console.log('🎤 Microcontroller ended connection');
                this.cleanupMicrocontrollerConnection(socket);
            });
        });

        // Handle server errors
        this.microcontrollerServer.on('error', (err) => {
            console.error('🎤 Microcontroller server error:', err);
        });

        this.microcontrollerServer.listen(this.config.microcontrollerPort, () => {
            console.log(`🎤 Microcontroller server listening on port ${this.config.microcontrollerPort}`);
        });
    }

    // Start heartbeat mechanism for microcontroller connection
    startHeartbeat(socket) {
        const intervalId = setInterval(() => {
            if (socket && !socket.destroyed && socket.readyState === 'open') {
                try {
                    socket.write('ping');
                    console.log('💓 Heartbeat sent to microcontroller');
                } catch (err) {
                    console.error('💓 Heartbeat send error:', err);
                    clearInterval(intervalId);
                    this.heartbeatIntervals.delete(socket);
                }
            } else {
                console.log('💓 Stopping heartbeat - socket unavailable');
                clearInterval(intervalId);
                this.heartbeatIntervals.delete(socket);
            }
        }, this.config.heartbeatInterval);

        this.heartbeatIntervals.set(socket, intervalId);
        console.log('💓 Heartbeat started for microcontroller');
    }

    // Clean up microcontroller connection
    cleanupMicrocontrollerConnection(socket) {
        // Clear heartbeat interval
        if (this.heartbeatIntervals.has(socket)) {
            clearInterval(this.heartbeatIntervals.get(socket));
            this.heartbeatIntervals.delete(socket);
            console.log('💓 Heartbeat stopped for microcontroller');
        }

        // Reset connection state
        if (this.microcontrollerSocket === socket) {
            this.microcontrollerSocket = null;
            this.isStreaming = false;
            this.notifyClientsStreamEnded();
        }
    }

    // Initialize WebSocket server for frontend clients
    initializeWebSocketServer() {
        const server = http.createServer();
        this.wss = new WebSocket.Server({ 
            server,
            perMessageDeflate: false, // Disable compression for better performance
            maxPayload: 1024 * 1024 * 10 // 10MB max payload
        });

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

                // Configure WebSocket for better performance
                ws.isAlive = true;
                
                // WebSocket heartbeat
                ws.on('pong', () => {
                    ws.isAlive = true;
                });

                // Send initial status
                ws.send(JSON.stringify({
                    type: 'status',
                    streaming: this.isStreaming,
                    message: this.isStreaming ? 'Audio stream active' : 'Waiting for microcontroller'
                }));

                // Handle client disconnection
                ws.on('close', (code, reason) => {
                    console.log(`🌐 Frontend client disconnected (${code}: ${reason})`);
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

        // WebSocket heartbeat interval
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

        // Clean up dead connections while broadcasting
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

        // Remove dead connections
        deadClients.forEach(client => {
            this.webSocketClients.delete(client);
        });

        if (deadClients.size > 0) {
            console.log(`🌐 Cleaned up ${deadClients.size} dead WebSocket connections`);
        }
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
                try {
                    client.send(message);
                } catch (err) {
                    console.error('🌐 Error notifying client of stream end:', err);
                }
            }
        });
    }

    // Handle messages from WebSocket clients
    handleClientMessage(ws, data) {
        switch (data.type) {
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                break;
            
            case 'start-listening':
                // Send Listen command to microcontroller
                if (this.microcontrollerSocket && !this.microcontrollerSocket.destroyed) {
                    this.microcontrollerSocket.write('Listen\n');
                    console.log('📤 Sent "Listen" command to microcontroller via WebSocket request');
                }
                break;
                
            case 'stop-listening':
                // Send Stop command to microcontroller
                if (this.microcontrollerSocket && !this.microcontrollerSocket.destroyed) {
                    this.microcontrollerSocket.write('Stop\n');
                    console.log('📤 Sent "Stop" command to microcontroller via WebSocket request');
                }
                break;
            
            case 'get-status':
                ws.send(JSON.stringify({
                    type: 'status',
                    streaming: this.isStreaming,
                    connectedClients: this.webSocketClients.size,
                    microcontrollerConnected: !!this.microcontrollerSocket,
                    uptime: process.uptime()
                }));
                break;
            
            default:
                console.log('Unknown message type:', data.type);
        }
    }

    // Graceful shutdown
    shutdown() {
        console.log('🛑 Shutting down servers...');
        
        // Clear all intervals
        if (this.wsHeartbeatInterval) {
            clearInterval(this.wsHeartbeatInterval);
        }
        
        this.heartbeatIntervals.forEach((intervalId) => {
            clearInterval(intervalId);
        });
        this.heartbeatIntervals.clear();
        
        // Close all WebSocket connections
        this.webSocketClients.forEach((client) => {
            try {
                client.close(1001, 'Server shutting down');
            } catch (err) {
                console.error('Error closing WebSocket client:', err);
            }
        });

        // Close microcontroller connection
        if (this.microcontrollerSocket && !this.microcontrollerSocket.destroyed) {
            this.microcontrollerSocket.end();
        }

        // Close servers
        this.microcontrollerServer.close(() => {
            console.log('🎤 Microcontroller server closed');
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
    setTimeout(() => process.exit(0), 2000); // Give 2 seconds for cleanup
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    audioServer.shutdown();
    setTimeout(() => process.exit(0), 2000); // Give 2 seconds for cleanup
});

process.on('uncaughtException', (err) => {
    console.error('🚨 Uncaught Exception:', err);
    audioServer.shutdown();
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
});

console.log('🚀 Audio WebSocket Server started successfully!');
console.log('📡 Microcontroller should connect to: localhost:3000');
console.log('🌐 Frontend should connect to: ws://localhost:3001?token=YOUR_TOKEN');
console.log('🔧 Laravel base URL:', process.env.LARAVEL_BASE_URL || 'http://localhost:8000');
console.log('💓 Heartbeat interval: 2 minutes');
console.log('⏰ Connection timeout: 5 minutes');