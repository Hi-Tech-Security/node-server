const WebSocket = require('ws');
const http = require('http');
const axios = require('axios');

class AudioWebSocketServer {
    constructor() {
        this.esp32Client = null;
        this.appClients = new Set();
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
            console.log('🔌 New client connected to microcontroller port from:', req.socket.remoteAddress);
            console.log('⏰ Connection timestamp:', new Date().toISOString());
            
            ws.on('message', (data, isBinary) => {
                console.log('📨 Message received from client:', {
                    isBinary,
                    dataLength: data.length,
                    timestamp: new Date().toISOString()
                });

                // Check if message is binary or text
                if (isBinary) {
                    console.log('🎵 Binary audio data received from ESP32');
                    console.log(`📊 Audio data size: ${data.length} bytes`);
                    
                    // Binary audio from ESP32, forward to app clients
                    this.broadcastAudioToClients(data);
                } else {
                    const message = data.toString().trim();
                    console.log(`📝 Text message received: "${message}"`);
                    
                    // Identify ESP32 client
                    if (message === 'ESP32') {
                        this.esp32Client = ws;
                        this.isStreaming = true;
                        console.log('🎤 ESP32 client registered and identified');
                        console.log('✅ Setting isStreaming to true');
                        
                        // Send connection confirmation
                        ws.send('Connected to Server');
                        console.log('📤 Sent connection confirmation to ESP32');
                        
                        // Send Listen command immediately
                        ws.send('Listen');
                        console.log('📤 Sent "Listen" command to ESP32 immediately after registration');
                        
                        // Start heartbeat
                        this.startHeartbeat(ws);
                        
                        // Notify app clients that streaming started
                        this.notifyClientsStreamStarted();
                        return;
                    }
                    
                    // Handle heartbeat response
                    if (message === 'pong') {
                        console.log('💓 Heartbeat pong received from ESP32');
                        return;
                    }
                    
                    // Log any other text messages
                    console.log(`📝 Other text message from client: "${message}"`);
                }
            });
    
            ws.on('close', (code, reason) => {
                console.log(`🔌 Client disconnected from microcontroller port`);
                console.log(`📊 Disconnect details - Code: ${code}, Reason: ${reason}`);
                console.log('⏰ Disconnect timestamp:', new Date().toISOString());
                
                if (ws === this.esp32Client) {
                    console.log('🎤 ESP32 client disconnected');
                    this.cleanupESP32Connection(ws);
                }
            });
    
            ws.on('error', (err) => {
                console.error('❌ Client WebSocket error on microcontroller port:', err);
                console.log('⏰ Error timestamp:', new Date().toISOString());
                
                if (ws === this.esp32Client) {
                    console.log('🎤 ESP32 client error - cleaning up connection');
                    this.cleanupESP32Connection(ws);
                }
            });
        });
    
        server.listen(this.config.microcontrollerPort, () => {
            console.log(`🎤 Microcontroller WebSocket server listening on port ${this.config.microcontrollerPort}`);
            console.log(`🔗 ESP32 should connect to: ws://localhost:${this.config.microcontrollerPort}`);
            console.log('⏰ Server start timestamp:', new Date().toISOString());
        });
    }

    // Start heartbeat for WebSocket connection
    startHeartbeat(ws) {
        console.log('💓 Starting heartbeat for ESP32 client');
        
        const intervalId = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send('ping');
                    console.log('💓 Heartbeat ping sent to ESP32');
                } catch (err) {
                    console.error('💓 Heartbeat send error:', err);
                    console.log('⏰ Heartbeat error timestamp:', new Date().toISOString());
                    clearInterval(intervalId);
                    this.heartbeatIntervals.delete(ws);
                }
            } else {
                console.log('💓 Stopping heartbeat - ESP32 WebSocket unavailable');
                console.log('📊 WebSocket readyState:', ws ? ws.readyState : 'null');
                clearInterval(intervalId);
                this.heartbeatIntervals.delete(ws);
            }
        }, this.config.heartbeatInterval);

        this.heartbeatIntervals.set(ws, intervalId);
        console.log(`💓 Heartbeat interval set: ${this.config.heartbeatInterval}ms`);
    }

    // Clean up ESP32 connection
    cleanupESP32Connection(ws) {
        console.log('🧹 Starting ESP32 connection cleanup');
        
        if (this.heartbeatIntervals.has(ws)) {
            clearInterval(this.heartbeatIntervals.get(ws));
            this.heartbeatIntervals.delete(ws);
            console.log('💓 Heartbeat stopped for ESP32');
        }

        if (this.esp32Client === ws) {
            this.esp32Client = null;
            this.isStreaming = false;
            console.log('🎤 ESP32 client reference cleared');
            console.log('⛔ Setting isStreaming to false');
            this.notifyClientsStreamEnded();
        }
        
        console.log('✅ ESP32 connection cleanup completed');
    }

    // Initialize WebSocket server for frontend clients
    initializeWebSocketServer() {
        const server = http.createServer();
        this.wss = new WebSocket.Server({ 
            server,
            perMessageDeflate: false,
            maxPayload: 1024 * 1024 * 10
        });

        this.wss.on('connection', async (ws, req) => {
            console.log('🌐 Frontend client attempting connection');
            console.log('⏰ Connection attempt timestamp:', new Date().toISOString());
            console.log('🔗 Connection from:', req.socket.remoteAddress);

            try {
                const url = new URL(req.url, `http://${req.headers.host}`);
                const token = url.searchParams.get('token');
                console.log('🔑 Token extraction:', token ? 'Token present' : 'No token provided');

                if (!token) {
                    console.log('❌ Authentication failed: No token provided');
                    ws.close(1008, 'Authentication token required');
                    return;
                }

                console.log('🔍 Validating token...');
                const isValid = await this.validateToken(token);
                console.log('🔍 Token validation result:', isValid ? 'Valid' : 'Invalid');
                
                if (!isValid) {
                    console.log('❌ Authentication failed: Invalid token');
                    ws.close(1008, 'Invalid authentication token');
                    return;
                }

                console.log('✅ Frontend client authenticated and connected');
                this.appClients.add(ws);
                console.log(`📊 Total app clients connected: ${this.appClients.size}`);

                ws.isAlive = true;
                
                ws.on('pong', () => {
                    ws.isAlive = true;
                    console.log('💓 Pong received from app client');
                });

                // Send initial status
                const statusMessage = {
                    type: 'status',
                    streaming: this.isStreaming,
                    message: this.isStreaming ? 'Audio stream active' : 'Waiting for ESP32',
                    esp32Connected: !!this.esp32Client
                };
                
                ws.send(JSON.stringify(statusMessage));
                console.log('📤 Initial status sent to app client:', statusMessage);

                ws.on('close', (code, reason) => {
                    console.log(`🌐 Frontend client disconnected - Code: ${code}, Reason: ${reason}`);
                    console.log('⏰ Disconnect timestamp:', new Date().toISOString());
                    this.appClients.delete(ws);
                    console.log(`📊 Remaining app clients: ${this.appClients.size}`);
                });

                ws.on('error', (err) => {
                    console.error('❌ App client WebSocket error:', err);
                    console.log('⏰ Error timestamp:', new Date().toISOString());
                    this.appClients.delete(ws);
                    console.log(`📊 Remaining app clients after error: ${this.appClients.size}`);
                });

                ws.on('message', (message) => {
                    console.log('📨 Message received from app client');
                    console.log('⏰ Message timestamp:', new Date().toISOString());
                    
                    try {
                        const data = JSON.parse(message);
                        console.log('📝 Parsed message data:', data);
                        this.handleClientMessage(ws, data);
                    } catch (err) {
                        console.error('❌ Invalid JSON from app client:', err);
                        console.log('📝 Raw message was:', message.toString());
                    }
                });

            } catch (error) {
                console.error('❌ App client connection error:', error);
                console.log('⏰ Connection error timestamp:', new Date().toISOString());
                ws.close(1011, 'Server error during authentication');
            }
        });

        // App client heartbeat
        this.wsHeartbeatInterval = setInterval(() => {
            console.log('💓 Running app client heartbeat check');
            let terminatedCount = 0;
            
            this.wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    console.log('💀 Terminating unresponsive app client');
                    terminatedCount++;
                    return ws.terminate();
                }
                
                ws.isAlive = false;
                ws.ping();
            });
            
            if (terminatedCount > 0) {
                console.log(`💀 Terminated ${terminatedCount} unresponsive app clients`);
            }
            console.log(`💓 App client heartbeat check completed - Active clients: ${this.appClients.size}`);
        }, 30000);

        server.listen(this.config.webSocketPort, () => {
            console.log(`🌐 WebSocket server listening on port ${this.config.webSocketPort}`);
            console.log(`🔗 Frontend should connect to: ws://localhost:${this.config.webSocketPort}?token=YOUR_TOKEN`);
            console.log('⏰ Server start timestamp:', new Date().toISOString());
        });
    }

    // Handle messages from WebSocket clients
    handleClientMessage(ws, data) {
        console.log('🔄 Processing client message:', data.type);
        
        switch (data.type) {
            case 'ping':
                const pongResponse = { type: 'pong', timestamp: Date.now() };
                ws.send(JSON.stringify(pongResponse));
                console.log('🏓 Sent pong response to app client');
                break;
            
            case 'start-listening':
                console.log('🎧 Start listening command received from app client');
                if (this.esp32Client && this.esp32Client.readyState === WebSocket.OPEN) {
                    this.esp32Client.send('Listen');
                    console.log('📤 Forwarded "Listen" command to ESP32');
                } else {
                    console.log('❌ Cannot send Listen command - ESP32 not connected');
                    console.log('📊 ESP32 status:', this.esp32Client ? `ReadyState: ${this.esp32Client.readyState}` : 'null');
                }
                break;
                
            case 'stop-listening':
                console.log('⏹️ Stop listening command received from app client');
                if (this.esp32Client && this.esp32Client.readyState === WebSocket.OPEN) {
                    this.esp32Client.send('Stop');
                    console.log('📤 Forwarded "Stop" command to ESP32');
                } else {
                    console.log('❌ Cannot send Stop command - ESP32 not connected');
                    console.log('📊 ESP32 status:', this.esp32Client ? `ReadyState: ${this.esp32Client.readyState}` : 'null');
                }
                break;
            
            case 'get-status':
                console.log('📊 Status request received from app client');
                const statusResponse = {
                    type: 'status',
                    streaming: this.isStreaming,
                    connectedClients: this.appClients.size,
                    esp32Connected: !!this.esp32Client,
                    uptime: process.uptime()
                };
                ws.send(JSON.stringify(statusResponse));
                console.log('📤 Status response sent:', statusResponse);
                break;
            
            default:
                console.log('❓ Unknown message type received:', data.type);
                console.log('📝 Full message data:', data);
        }
    }

    // Token validation
    async validateToken(token) {
        console.log('🔍 Starting token validation process');
        
        try {
            const response = await axios.post(`${this.config.laravelBaseUrl}/api/v1/audio/validate-token`, {
                token: token
            }, {
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            console.log('✅ Token validation request successful');
            console.log('📊 Validation response:', response.data);
            return response.data.valid === true;
        } catch (error) {
            console.error('❌ Token validation error:', error.message);
            console.log('🔗 Validation URL:', `${this.config.laravelBaseUrl}/api/v1/audio/validate-token`);
            console.log('⏰ Validation error timestamp:', new Date().toISOString());
            return false;
        }
    }

    // Broadcast audio data to app clients
    broadcastAudioToClients(audioData) {
        console.log('📡 Broadcasting audio data to app clients');
        console.log(`📊 Audio data size: ${audioData.length} bytes`);
        console.log(`👥 Number of app clients: ${this.appClients.size}`);
        
        if (this.appClients.size === 0) {
            console.log('📡 No app clients connected - skipping broadcast');
            return;
        }

        const message = JSON.stringify({
            type: 'audio',
            data: audioData.toString('base64'),
            timestamp: Date.now()
        });

        console.log('📦 Audio message prepared for broadcast');
        const deadClients = new Set();
        let successCount = 0;

        this.appClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(message);
                    successCount++;
                } catch (err) {
                    console.error('❌ Error sending audio to app client:', err);
                    deadClients.add(client);
                }
            } else {
                console.log('💀 Dead app client detected (readyState:', client.readyState, ')');
                deadClients.add(client);
            }
        });

        // Clean up dead clients
        deadClients.forEach(client => {
            this.appClients.delete(client);
        });

        console.log(`📡 Audio broadcast completed:`);
        console.log(`  ✅ Successful sends: ${successCount}`);
        console.log(`  💀 Dead clients removed: ${deadClients.size}`);
        console.log(`  👥 Active clients remaining: ${this.appClients.size}`);
    }

    // Notify clients that streaming started
    notifyClientsStreamStarted() {
        console.log('🎬 Notifying app clients that streaming started');
        
        const message = JSON.stringify({
            type: 'status',
            streaming: true,
            message: 'Audio stream started',
            esp32Connected: true
        });

        let notifiedCount = 0;
        this.appClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(message);
                    notifiedCount++;
                } catch (err) {
                    console.error('❌ Error notifying app client of stream start:', err);
                }
            }
        });
        
        console.log(`📤 Stream start notification sent to ${notifiedCount} app clients`);
    }

    // Notify clients that streaming ended
    notifyClientsStreamEnded() {
        console.log('🛑 Notifying app clients that streaming ended');
        
        const message = JSON.stringify({
            type: 'status',
            streaming: false,
            message: 'Audio stream ended',
            esp32Connected: false
        });

        let notifiedCount = 0;
        this.appClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(message);
                    notifiedCount++;
                } catch (err) {
                    console.error('❌ Error notifying app client of stream end:', err);
                }
            }
        });
        
        console.log(`📤 Stream end notification sent to ${notifiedCount} app clients`);
    }

    // Shutdown server
    shutdown() {
        console.log('🛑 Starting server shutdown process...');
        console.log('⏰ Shutdown initiated at:', new Date().toISOString());
        
        // Clear heartbeat intervals
        if (this.wsHeartbeatInterval) {
            clearInterval(this.wsHeartbeatInterval);
            console.log('💓 App client heartbeat interval cleared');
        }
        
        this.heartbeatIntervals.forEach((intervalId, ws) => {
            clearInterval(intervalId);
            console.log('💓 ESP32 heartbeat interval cleared');
        });
        this.heartbeatIntervals.clear();
        
        // Close app clients
        console.log(`🌐 Closing ${this.appClients.size} app client connections...`);
        this.appClients.forEach((client) => {
            try {
                client.close(1001, 'Server shutting down');
            } catch (err) {
                console.error('❌ Error closing app client:', err);
            }
        });

        // Close ESP32 connection
        if (this.esp32Client && this.esp32Client.readyState === WebSocket.OPEN) {
            console.log('🎤 Closing ESP32 connection...');
            this.esp32Client.close();
        }

        // Close servers
        this.microcontrollerWss.close(() => {
            console.log('🎤 Microcontroller WebSocket server closed');
        });
        
        this.wss.close(() => {
            console.log('🌐 App WebSocket server closed');
        });
        
        console.log('✅ Server shutdown process completed');
    }
}

// Initialize and start the server
console.log('🚀 Initializing Audio WebSocket Server...');
console.log('⏰ Initialization timestamp:', new Date().toISOString());

const audioServer = new AudioWebSocketServer();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT signal');
    console.log('⏰ SIGINT received at:', new Date().toISOString());
    console.log('🛑 Shutting down gracefully...');
    audioServer.shutdown();
    setTimeout(() => {
        console.log('✅ Process exit after graceful shutdown');
        process.exit(0);
    }, 2000);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM signal');
    console.log('⏰ SIGTERM received at:', new Date().toISOString());
    console.log('🛑 Shutting down gracefully...');
    audioServer.shutdown();
    setTimeout(() => {
        console.log('✅ Process exit after graceful shutdown');
        process.exit(0);
    }, 2000);
});

console.log('🚀 Audio WebSocket Server started successfully!');
console.log('📡 ESP32 should connect to: ws://localhost:3000 and send "ESP32" to identify');
console.log('🌐 Frontend should connect to: ws://localhost:3001?token=YOUR_TOKEN');
console.log('⏰ Server fully operational at:', new Date().toISOString());