const WebSocket = require('ws');
const http = require('http');
const axios = require('axios');
// const WebSocket = require('ws');
// const http = require('http');
// const axios = require('axios');
const fs = require('fs');
const path = require('path');

class AudioWebSocketServer {
    constructor() {
        this.esp32Client = null;
        this.appClients = new Set();
        this.isStreaming = false;
        this.heartbeatIntervals = new Map();
        
        // Configuration
        this.config = {
            esp32Port: process.env.ESP32_PORT || 3000,
            appPort: process.env.APP_PORT || 3001,
            dashboardPort: process.env.DASHBOARD_PORT || 3002, // New port for dashboard
            laravelBaseUrl: process.env.LARAVEL_BASE_URL || 'http://localhost:8000',
            heartbeatInterval: 30000,
            connectionTimeout: 300000,
            maxPayload: 1024 * 1024 * 10
        };
        
        this.initializeESP32Server();
        this.initializeAppServer();
        this.initializeDashboardServer(); // New method for dashboard
    }

    // Initialize HTTP server for dashboard
    initializeDashboardServer() {
        console.log('🖥️ Initializing Dashboard HTTP Server...');
        console.log('⏰ Dashboard server initialization at:', new Date().toISOString());
        
        const server = http.createServer((req, res) => {
            if (req.url === '/' || req.url === '/index.html') {
                const filePath = path.join(__dirname, 'index.html');
                fs.readFile(filePath, (err, content) => {
                    if (err) {
                        console.error('❌ Error reading index.html:', err);
                        res.writeHead(500, { 'Content-Type': 'text/plain' });
                        res.end('Internal Server Error');
                        return;
                    }
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(content);
                });
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            }
        });

        server.listen(this.config.dashboardPort, () => {
            console.log(`🖥️ Dashboard HTTP server listening on port ${this.config.dashboardPort}`);
            console.log(`🔗 Dashboard URL: http://localhost:${this.config.dashboardPort}`);
            console.log('⏰ Dashboard server ready at:', new Date().toISOString());
        });
    }
// class AudioWebSocketServer {
//     constructor() {
//         this.esp32Client = null;
//         this.appClients = new Set();
//         this.isStreaming = false;
//         this.heartbeatIntervals = new Map();
        
//         // Configuration
//         this.config = {
//             esp32Port: 3000,               // WebSocket port for ESP32
//             appPort: 3001,                 // WebSocket port for app clients
//             laravelBaseUrl: process.env.LARAVEL_BASE_URL || 'http://localhost:8000',
//             heartbeatInterval: 30000,      // 30 seconds
//             connectionTimeout: 300000,     // 5 minutes
//             maxPayload: 1024 * 1024 * 10  // 10MB max payload
//         };
        
//         this.initializeESP32Server();
//         this.initializeAppServer();
//     }

    // Initialize WebSocket server for ESP32 device
    initializeESP32Server() {
        console.log('🚀 Initializing ESP32 WebSocket Server...');
        console.log('⏰ ESP32 server initialization at:', new Date().toISOString());
        
        const server = http.createServer();
        this.esp32Wss = new WebSocket.Server({ 
            server,
            perMessageDeflate: false,
            maxPayload: this.config.maxPayload
        });
    
        this.esp32Wss.on('connection', (ws, req) => {
            console.log('🎤 New ESP32 client attempting connection');
            console.log('🔗 Connection from IP:', req.socket.remoteAddress);
            console.log('⏰ ESP32 connection timestamp:', new Date().toISOString());
            
            ws.on('message', (data, isBinary) => {
                console.log('📨 Message received from ESP32:', {
                    isBinary,
                    dataLength: data.length,
                    timestamp: new Date().toISOString()
                });

                if (isBinary) {
                    console.log('🎵 Binary audio data received from ESP32');
                    console.log(`📊 Audio data size: ${data.length} bytes`);
                    
                    // Forward raw binary audio to all app clients
                    this.broadcastAudioToClients(data);
                } else {
                    const message = data.toString().trim();
                    console.log(`📝 Text message from ESP32: "${message}"`);
                    
                    // ESP32 identification
                    if (message === 'ESP32') {
                        // Check if ESP32 already connected
                        if (this.esp32Client && this.esp32Client.readyState === WebSocket.OPEN) {
                            console.log('⚠️ ESP32 already connected, closing existing connection');
                            this.cleanupESP32Connection(this.esp32Client);
                        }
                        
                        this.esp32Client = ws;
                        this.isStreaming = true;
                        console.log('✅ ESP32 client registered and identified');
                        console.log('📡 Setting streaming status to active');
                        
                        // Send connection confirmation
                        ws.send('Connected to Server');
                        console.log('📤 Sent connection confirmation to ESP32');
                        
                        // Start heartbeat
                        this.startESP32Heartbeat(ws);
                        
                        // Notify app clients
                        this.notifyClientsStreamingStatus(true);
                        return;
                    }
                    
                    // Handle heartbeat response
                    if (message === 'pong') {
                        console.log('💓 Heartbeat pong received from ESP32');
                        return;
                    }
                    
                    // Handle status messages
                    if (message.startsWith('STATUS:')) {
                        console.log(`📊 ESP32 status: ${message}`);
                        this.notifyClientsESP32Status(message);
                        return;
                    }
                    
                    console.log(`📝 Unhandled ESP32 message: "${message}"`);
                }
            });
    
            ws.on('close', (code, reason) => {
                console.log('🔌 ESP32 client disconnected');
                console.log(`📊 Disconnect - Code: ${code}, Reason: ${reason}`);
                console.log('⏰ ESP32 disconnect timestamp:', new Date().toISOString());
                
                if (ws === this.esp32Client) {
                    this.cleanupESP32Connection(ws);
                }
            });
    
            ws.on('error', (err) => {
                console.error('❌ ESP32 WebSocket error:', err);
                console.log('⏰ ESP32 error timestamp:', new Date().toISOString());
                
                if (ws === this.esp32Client) {
                    console.log('🧹 Cleaning up ESP32 connection due to error');
                    this.cleanupESP32Connection(ws);
                }
            });
        });
    
        server.listen(this.config.esp32Port, () => {
            console.log(`🎤 ESP32 WebSocket server listening on port ${this.config.esp32Port}`);
            console.log(`🔗 ESP32 connection URL: ws://localhost:${this.config.esp32Port}`);
            console.log('⏰ ESP32 server ready at:', new Date().toISOString());
        });
    }

    // Initialize WebSocket server for app clients
    initializeAppServer() {
        console.log('🚀 Initializing App Client WebSocket Server...');
        console.log('⏰ App server initialization at:', new Date().toISOString());
        
        const server = http.createServer();
        this.appWss = new WebSocket.Server({ 
            server,
            perMessageDeflate: false,
            maxPayload: this.config.maxPayload
        });

        this.appWss.on('connection', async (ws, req) => {
            console.log('🌐 New app client attempting connection');
            console.log('🔗 App client IP:', req.socket.remoteAddress);
            console.log('⏰ App connection timestamp:', new Date().toISOString());

            try {
                // Extract token from URL parameters
                const url = new URL(req.url, `http://${req.headers.host}`);
                const token = url.searchParams.get('token');
                
                console.log('🔑 Token extraction:', token ? 'Token provided' : 'No token in URL');

                if (!token) {
                    console.log('❌ Authentication failed: Missing token');
                    ws.close(1008, 'Authentication token required');
                    return;
                }

                console.log('🔍 Validating token with Laravel backend...');
                const isValid = await this.validateToken(token);
                
                if (!isValid) {
                    console.log('❌ Authentication failed: Invalid token');
                    ws.close(1008, 'Invalid authentication token');
                    return;
                }

                console.log('✅ App client authenticated successfully');
                
                // Add to active clients
                this.appClients.add(ws);
                ws.isAlive = true;
                ws.clientId = this.generateClientId();
                
                console.log(`👥 App client added - ID: ${ws.clientId}`);
                console.log(`📊 Total app clients: ${this.appClients.size}`);
                
                // Send initial status
                this.sendInitialStatus(ws);
                
                // Set up ping/pong for keepalive
                ws.on('pong', () => {
                    ws.isAlive = true;
                    console.log(`💓 Pong received from client ${ws.clientId}`);
                });

                ws.on('message', (message) => {
                    console.log(`📨 Message from app client ${ws.clientId}`);
                    console.log('⏰ Message timestamp:', new Date().toISOString());
                    
                    try {
                        const data = JSON.parse(message);
                        console.log(`📝 Parsed message from ${ws.clientId}:`, data);
                        this.handleAppClientMessage(ws, data);
                    } catch (err) {
                        console.error(`❌ Invalid JSON from client ${ws.clientId}:`, err);
                        console.log('📝 Raw message:', message.toString());
                        
                        // Send error response
                        this.sendErrorToClient(ws, 'Invalid JSON format');
                    }
                });

                ws.on('close', (code, reason) => {
                    console.log(`🔌 App client ${ws.clientId} disconnected`);
                    console.log(`📊 Disconnect - Code: ${code}, Reason: ${reason}`);
                    console.log('⏰ App disconnect timestamp:', new Date().toISOString());
                    
                    this.appClients.delete(ws);
                    console.log(`📊 Remaining app clients: ${this.appClients.size}`);
                });

                ws.on('error', (err) => {
                    console.error(`❌ App client ${ws.clientId} error:`, err);
                    console.log('⏰ App error timestamp:', new Date().toISOString());
                    
                    this.appClients.delete(ws);
                    console.log(`📊 Remaining app clients after error: ${this.appClients.size}`);
                });

            } catch (error) {
                console.error('❌ App client connection setup error:', error);
                console.log('⏰ Setup error timestamp:', new Date().toISOString());
                ws.close(1011, 'Server error during authentication');
            }
        });

        // Start heartbeat for app clients
        this.startAppClientHeartbeat();

        server.listen(this.config.appPort, () => {
            console.log(`🌐 App WebSocket server listening on port ${this.config.appPort}`);
            console.log(`🔗 App connection URL: ws://localhost:${this.config.appPort}?token=YOUR_TOKEN`);
            console.log('⏰ App server ready at:', new Date().toISOString());
        });
    }

    // Validate token with Laravel backend
    async validateToken(token) {
        console.log('🔍 Starting token validation...');
        console.log('⏰ Validation start time:', new Date().toISOString());
        
        try {
            const response = await axios.post(`${this.config.laravelBaseUrl}/api/v1/audio/validate-token`, {
                token: token
            }, {
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });

            console.log('✅ Token validation response received');
            console.log('📊 Response status:', response.status);
            console.log('📊 Response data:', response.data);
            
            return response.data.valid === true;
        } catch (error) {
            console.error('❌ Token validation failed:', error.message);
            
            if (error.response) {
                console.log('📊 Error response status:', error.response.status);
                console.log('📊 Error response data:', error.response.data);
            }
            
            console.log('🔗 Validation URL:', `${this.config.laravelBaseUrl}/api/v1/audio/validate-token`);
            console.log('⏰ Validation error time:', new Date().toISOString());
            return false;
        }
    }

    // Handle messages from app clients
    handleAppClientMessage(ws, data) {
        console.log(`🔄 Processing message from client ${ws.clientId}:`, data.type);
        
        switch (data.type) {
            case 'ping':
                const pongResponse = { 
                    type: 'pong', 
                    timestamp: Date.now(),
                    clientId: ws.clientId
                };
                this.sendToClient(ws, pongResponse);
                console.log(`🏓 Sent pong to client ${ws.clientId}`);
                break;
            
            case 'start-listening':
                console.log(`🎧 Start listening command from client ${ws.clientId}`);
                this.sendCommandToESP32('Listen');
                break;
                
            case 'stop-listening':
                console.log(`⏹️ Stop listening command from client ${ws.clientId}`);
                this.sendCommandToESP32('Stop');
                break;
            
            case 'get-status':
                console.log(`📊 Status request from client ${ws.clientId}`);
                this.sendStatusToClient(ws);
                break;
                
            case 'get-clients':
                console.log(`👥 Client list request from client ${ws.clientId}`);
                this.sendClientListToClient(ws);
                break;
            
            default:
                console.log(`❓ Unknown message type from client ${ws.clientId}:`, data.type);
                this.sendErrorToClient(ws, `Unknown message type: ${data.type}`);
        }
    }

    // Send command to ESP32
    sendCommandToESP32(command) {
        console.log(`📤 Attempting to send command to ESP32: "${command}"`);
        
        if (this.esp32Client && this.esp32Client.readyState === WebSocket.OPEN) {
            try {
                this.esp32Client.send(command);
                console.log(`✅ Command "${command}" sent to ESP32`);
                
                // Notify app clients about command
                this.broadcastToAppClients({
                    type: 'command-sent',
                    command: command,
                    timestamp: Date.now()
                });
            } catch (error) {
                console.error(`❌ Error sending command to ESP32:`, error);
            }
        } else {
            console.log('❌ Cannot send command - ESP32 not connected');
            console.log('📊 ESP32 status:', this.esp32Client ? 
                `ReadyState: ${this.esp32Client.readyState}` : 'null');
                
            // Notify app clients that ESP32 is unavailable
            this.broadcastToAppClients({
                type: 'error',
                message: 'ESP32 not connected',
                timestamp: Date.now()
            });
        }
    }

    // Broadcast audio data to all app clients
    broadcastAudioToClients(audioData) {
        console.log('📡 Broadcasting audio data to app clients');
        console.log(`📊 Audio data size: ${audioData.length} bytes`);
        console.log(`👥 Target clients: ${this.appClients.size}`);
        
        if (this.appClients.size === 0) {
            console.log('📡 No app clients - skipping broadcast');
            return;
        }

        const deadClients = new Set();
        let successCount = 0;
        let errorCount = 0;

        this.appClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    // Send raw binary data directly
                    client.send(audioData, { binary: true });
                    successCount++;
                    console.log(`📡 Audio sent to client ${client.clientId}`);
                } catch (err) {
                    console.error(`❌ Error sending audio to client ${client.clientId}:`, err);
                    errorCount++;
                    deadClients.add(client);
                }
            } else {
                console.log(`💀 Dead client detected: ${client.clientId} (readyState: ${client.readyState})`);
                deadClients.add(client);
            }
        });

        // Clean up dead clients
        deadClients.forEach(client => {
            this.appClients.delete(client);
            console.log(`🧹 Removed dead client: ${client.clientId}`);
        });

        console.log(`📡 Audio broadcast summary:`);
        console.log(`  ✅ Successful: ${successCount}`);
        console.log(`  ❌ Errors: ${errorCount}`);
        console.log(`  💀 Dead clients removed: ${deadClients.size}`);
        console.log(`  👥 Active clients: ${this.appClients.size}`);
    }

    // Start heartbeat for ESP32
    startESP32Heartbeat(ws) {
        console.log('💓 Starting ESP32 heartbeat');
        
        const intervalId = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send('ping');
                    console.log('💓 Heartbeat ping sent to ESP32');
                } catch (err) {
                    console.error('💓 ESP32 heartbeat error:', err);
                    clearInterval(intervalId);
                    this.heartbeatIntervals.delete(ws);
                    this.cleanupESP32Connection(ws);
                }
            } else {
                console.log('💓 ESP32 heartbeat stopped - connection unavailable');
                clearInterval(intervalId);
                this.heartbeatIntervals.delete(ws);
            }
        }, this.config.heartbeatInterval);

        this.heartbeatIntervals.set(ws, intervalId);
        console.log(`💓 ESP32 heartbeat interval: ${this.config.heartbeatInterval}ms`);
    }

    // Start heartbeat for app clients
    startAppClientHeartbeat() {
        console.log('💓 Starting app client heartbeat system');
        
        this.appHeartbeatInterval = setInterval(() => {
            console.log('💓 Running app client heartbeat check');
            
            let deadCount = 0;
            const deadClients = [];
            
            this.appClients.forEach((client) => {
                if (client.isAlive === false) {
                    console.log(`💀 Terminating unresponsive client: ${client.clientId}`);
                    deadClients.push(client);
                    deadCount++;
                    return client.terminate();
                }
                
                client.isAlive = false;
                try {
                    client.ping();
                    console.log(`💓 Ping sent to client ${client.clientId}`);
                } catch (err) {
                    console.error(`❌ Ping error for client ${client.clientId}:`, err);
                    deadClients.push(client);
                }
            });
            
            // Clean up dead clients
            deadClients.forEach(client => {
                this.appClients.delete(client);
            });
            
            if (deadCount > 0) {
                console.log(`💀 Terminated ${deadCount} unresponsive clients`);
            }
            
            console.log(`💓 Heartbeat check complete - Active clients: ${this.appClients.size}`);
        }, this.config.heartbeatInterval);
    }

    // Clean up ESP32 connection
    cleanupESP32Connection(ws) {
        console.log('🧹 Starting ESP32 connection cleanup');
        console.log('⏰ Cleanup timestamp:', new Date().toISOString());
        
        // Clear heartbeat
        if (this.heartbeatIntervals.has(ws)) {
            clearInterval(this.heartbeatIntervals.get(ws));
            this.heartbeatIntervals.delete(ws);
            console.log('💓 ESP32 heartbeat cleared');
        }

        // Reset connection state
        if (this.esp32Client === ws) {
            this.esp32Client = null;
            this.isStreaming = false;
            console.log('📡 ESP32 client reference cleared');
            console.log('⛔ Streaming status set to inactive');
            
            // Notify app clients
            this.notifyClientsStreamingStatus(false);
        }
        
        console.log('✅ ESP32 cleanup completed');
    }

    // Utility functions for client communication
    sendToClient(client, data) {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(JSON.stringify(data));
                return true;
            } catch (err) {
                console.error(`❌ Error sending to client ${client.clientId}:`, err);
                return false;
            }
        }
        return false;
    }

    sendErrorToClient(client, message) {
        const errorData = {
            type: 'error',
            message: message,
            timestamp: Date.now()
        };
        this.sendToClient(client, errorData);
        console.log(`❌ Error sent to client ${client.clientId}: ${message}`);
    }

    sendInitialStatus(client) {
        const status = {
            type: 'status',
            streaming: this.isStreaming,
            esp32Connected: !!this.esp32Client,
            clientId: client.clientId,
            serverTime: Date.now(),
            message: this.isStreaming ? 'Audio stream active' : 'Waiting for ESP32'
        };
        
        this.sendToClient(client, status);
        console.log(`📊 Initial status sent to client ${client.clientId}`);
    }

    sendStatusToClient(client) {
        const status = {
            type: 'status',
            streaming: this.isStreaming,
            esp32Connected: !!this.esp32Client,
            connectedClients: this.appClients.size,
            serverUptime: process.uptime(),
            serverTime: Date.now(),
            clientId: client.clientId
        };
        
        this.sendToClient(client, status);
        console.log(`📊 Status sent to client ${client.clientId}`);
    }

    sendClientListToClient(client) {
        const clientList = Array.from(this.appClients).map(c => ({
            id: c.clientId,
            connected: c.readyState === WebSocket.OPEN
        }));
        
        const response = {
            type: 'client-list',
            clients: clientList,
            total: clientList.length,
            timestamp: Date.now()
        };
        
        this.sendToClient(client, response);
        console.log(`👥 Client list sent to client ${client.clientId}`);
    }

    broadcastToAppClients(data) {
        console.log(`📡 Broadcasting to ${this.appClients.size} app clients:`, data.type);
        
        let successCount = 0;
        const deadClients = [];
        
        this.appClients.forEach((client) => {
            if (this.sendToClient(client, data)) {
                successCount++;
            } else {
                deadClients.push(client);
            }
        });
        
        // Clean up dead clients
        deadClients.forEach(client => {
            this.appClients.delete(client);
            console.log(`🧹 Removed dead client from broadcast: ${client.clientId}`);
        });
        
        console.log(`📡 Broadcast complete - Reached: ${successCount} clients`);
    }

    notifyClientsStreamingStatus(isStreaming) {
        console.log(`📡 Notifying clients - Streaming: ${isStreaming}`);
        
        const message = {
            type: 'streaming-status',
            streaming: isStreaming,
            esp32Connected: !!this.esp32Client,
            message: isStreaming ? 'Audio stream started' : 'Audio stream stopped',
            timestamp: Date.now()
        };

        this.broadcastToAppClients(message);
    }

    notifyClientsESP32Status(status) {
        console.log(`📡 Broadcasting ESP32 status: ${status}`);
        
        const message = {
            type: 'esp32-status',
            status: status,
            timestamp: Date.now()
        };

        this.broadcastToAppClients(message);
    }

    generateClientId() {
        return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Graceful shutdown
    shutdown() {
        console.log('🛑 Starting graceful shutdown...');
        console.log('⏰ Shutdown initiated:', new Date().toISOString());
        
        // Clear all intervals
        if (this.appHeartbeatInterval) {
            clearInterval(this.appHeartbeatInterval);
            console.log('💓 App heartbeat interval cleared');
        }
        
        this.heartbeatIntervals.forEach((intervalId, ws) => {
            clearInterval(intervalId);
        });
        this.heartbeatIntervals.clear();
        console.log('💓 All ESP32 heartbeat intervals cleared');
        
        // Close all app clients
        console.log(`🌐 Closing ${this.appClients.size} app clients...`);
        this.appClients.forEach((client) => {
            try {
                const shutdownMessage = {
                    type: 'server-shutdown',
                    message: 'Server is shutting down',
                    timestamp: Date.now()
                };
                this.sendToClient(client, shutdownMessage);
                setTimeout(() => client.close(1001, 'Server shutdown'), 100);
            } catch (err) {
                console.error('❌ Error closing app client:', err);
            }
        });

        // Close ESP32 connection
        if (this.esp32Client && this.esp32Client.readyState === WebSocket.OPEN) {
            console.log('🎤 Closing ESP32 connection...');
            try {
                this.esp32Client.send('Server shutting down');
                this.esp32Client.close();
            } catch (err) {
                console.error('❌ Error closing ESP32 connection:', err);
            }
        }

        // Close servers
        if (this.esp32Wss) {
            this.esp32Wss.close(() => {
                console.log('🎤 ESP32 WebSocket server closed');
            });
        }
        
        if (this.appWss) {
            this.appWss.close(() => {
                console.log('🌐 App WebSocket server closed');
            });
        }
        
        console.log('✅ Graceful shutdown completed');
    }
}

// Initialize and start the server
console.log('🚀 Starting Audio WebSocket Server...');
console.log('⏰ Server initialization:', new Date().toISOString());
console.log('🔧 Configuration:', {
    esp32Port: process.env.ESP32_PORT || 3000,
    appPort: process.env.APP_PORT || 3001,
    dashboardPort: process.env.DASHBOARD_PORT || 3002,
    laravelUrl: process.env.LARAVEL_BASE_URL || 'http://localhost:8000'
});

const audioServer = new AudioWebSocketServer();

// Handle graceful shutdown signals
process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT (Ctrl+C)');
    console.log('⏰ SIGINT timestamp:', new Date().toISOString());
    console.log('🛑 Initiating graceful shutdown...');
    
    audioServer.shutdown();
    
    setTimeout(() => {
        console.log('✅ Forcing process exit after graceful shutdown');
        process.exit(0);
    }, 3000);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM');
    console.log('⏰ SIGTERM timestamp:', new Date().toISOString());
    console.log('🛑 Initiating graceful shutdown...');
    
    audioServer.shutdown();
    
    setTimeout(() => {
        console.log('✅ Forcing process exit after graceful shutdown');
        process.exit(0);
    }, 3000);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    console.log('⏰ Exception timestamp:', new Date().toISOString());
    console.log('🛑 Shutting down due to uncaught exception...');
    
    audioServer.shutdown();
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    console.log('⏰ Rejection timestamp:', new Date().toISOString());
});

console.log('🚀 Audio WebSocket Server started successfully!');
console.log('📡 Server endpoints:');
console.log(`  🎤 ESP32: ws://localhost:3000 (send "ESP32" to identify)`);
console.log(`  🌐 Apps: ws://localhost:3001?token=YOUR_TOKEN`);
console.log(`  🖥️ Dashboard: http://localhost:3002`);
console.log('⏰ Server fully operational:', new Date().toISOString());