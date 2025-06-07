const WebSocket = require('ws');
const net = require('net');
const dns = require('dns');
const { promisify } = require('util');

// Configuration
const TARGET_HOST = 'quicknotify.fly.dev';
const TARGET_PORT = 3000;
const WS_URL = `ws://${TARGET_HOST}:${TARGET_PORT}`;

class ConnectionDiagnostic {
    constructor() {
        this.results = {
            dns: null,
            tcp: null,
            websocket: null,
            httpUpgrade: null
        };
    }

    // Test DNS resolution
    async testDNS() {
        console.log('🔍 Testing DNS resolution...');
        try {
            const lookup = promisify(dns.lookup);
            const result = await lookup(TARGET_HOST);
            console.log(`✅ DNS resolution successful: ${TARGET_HOST} -> ${result.address}`);
            this.results.dns = {
                success: true,
                address: result.address,
                family: result.family
            };
            return result;
        } catch (error) {
            console.log(`❌ DNS resolution failed: ${error.message}`);
            this.results.dns = {
                success: false,
                error: error.message
            };
            throw error;
        }
    }

    // Test TCP connectivity
    async testTCP() {
        console.log('🔍 Testing TCP connectivity...');
        return new Promise((resolve, reject) => {
            const socket = new net.Socket();
            const timeout = setTimeout(() => {
                socket.destroy();
                const error = new Error('TCP connection timeout');
                console.log(`❌ TCP connection failed: ${error.message}`);
                this.results.tcp = {
                    success: false,
                    error: error.message
                };
                reject(error);
            }, 10000);

            socket.connect(TARGET_PORT, TARGET_HOST, () => {
                clearTimeout(timeout);
                console.log(`✅ TCP connection successful to ${TARGET_HOST}:${TARGET_PORT}`);
                this.results.tcp = {
                    success: true,
                    localAddress: socket.localAddress,
                    localPort: socket.localPort
                };
                socket.end();
                resolve();
            });

            socket.on('error', (error) => {
                clearTimeout(timeout);
                console.log(`❌ TCP connection failed: ${error.message}`);
                this.results.tcp = {
                    success: false,
                    error: error.message,
                    code: error.code
                };
                reject(error);
            });
        });
    }

    // Test HTTP upgrade to WebSocket
    async testHTTPUpgrade() {
        console.log('🔍 Testing HTTP upgrade to WebSocket...');
        return new Promise((resolve, reject) => {
            const http = require('http');
            const crypto = require('crypto');
            
            const key = crypto.randomBytes(16).toString('base64');
            
            const options = {
                hostname: TARGET_HOST,
                port: TARGET_PORT,
                path: '/',
                method: 'GET',
                timeout: 10000,
                headers: {
                    'Upgrade': 'websocket',
                    'Connection': 'Upgrade',
                    'Sec-WebSocket-Key': key,
                    'Sec-WebSocket-Version': '13'
                }
            };

            const req = http.request(options, (res) => {
                console.log(`📊 HTTP response status: ${res.statusCode}`);
                console.log(`📊 HTTP response headers:`, res.headers);
                
                if (res.statusCode === 101) {
                    console.log('✅ HTTP upgrade to WebSocket successful');
                    this.results.httpUpgrade = {
                        success: true,
                        statusCode: res.statusCode,
                        headers: res.headers
                    };
                    resolve();
                } else {
                    const error = new Error(`HTTP upgrade failed with status ${res.statusCode}`);
                    console.log(`❌ HTTP upgrade failed: ${error.message}`);
                    this.results.httpUpgrade = {
                        success: false,
                        statusCode: res.statusCode,
                        headers: res.headers,
                        error: error.message
                    };
                    reject(error);
                }
            });

            req.on('error', (error) => {
                console.log(`❌ HTTP upgrade request failed: ${error.message}`);
                this.results.httpUpgrade = {
                    success: false,
                    error: error.message,
                    code: error.code
                };
                reject(error);
            });

            req.on('timeout', () => {
                req.destroy();
                const error = new Error('HTTP upgrade request timeout');
                console.log(`❌ HTTP upgrade failed: ${error.message}`);
                this.results.httpUpgrade = {
                    success: false,
                    error: error.message
                };
                reject(error);
            });

            req.end();
        });
    }

    // Test WebSocket connection
    async testWebSocket() {
        console.log('🔍 Testing WebSocket connection...');
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(WS_URL, {
                handshakeTimeout: 10000
            });

            const timeout = setTimeout(() => {
                ws.terminate();
                const error = new Error('WebSocket connection timeout');
                console.log(`❌ WebSocket connection failed: ${error.message}`);
                this.results.websocket = {
                    success: false,
                    error: error.message
                };
                reject(error);
            }, 10000);

            ws.on('open', () => {
                clearTimeout(timeout);
                console.log('✅ WebSocket connection successful');
                this.results.websocket = {
                    success: true,
                    readyState: ws.readyState
                };
                ws.close();
                resolve();
            });

            ws.on('error', (error) => {
                clearTimeout(timeout);
                console.log(`❌ WebSocket connection failed: ${error.message}`);
                this.results.websocket = {
                    success: false,
                    error: error.message,
                    code: error.code
                };
                reject(error);
            });

            ws.on('close', (code, reason) => {
                console.log(`📊 WebSocket closed with code: ${code}, reason: ${reason}`);
            });
        });
    }

    // Test alternative ports
    async testAlternativePorts() {
        console.log('\n🔍 Testing alternative ports...');
        const portsToTest = [80, 443, 8080, 8443, 3001];
        
        for (const port of portsToTest) {
            console.log(`🔍 Testing port ${port}...`);
            try {
                await this.testTCPPort(port);
                console.log(`✅ Port ${port} is accessible`);
            } catch (error) {
                console.log(`❌ Port ${port} is not accessible: ${error.message}`);
            }
        }
    }

    // Test specific TCP port
    async testTCPPort(port) {
        return new Promise((resolve, reject) => {
            const socket = new net.Socket();
            const timeout = setTimeout(() => {
                socket.destroy();
                reject(new Error('TCP connection timeout'));
            }, 5000);

            socket.connect(port, TARGET_HOST, () => {
                clearTimeout(timeout);
                socket.end();
                resolve();
            });

            socket.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    // Run all diagnostics
    async runDiagnostics() {
        console.log('🚀 Starting WebSocket Connection Diagnostics');
        console.log('=' .repeat(50));
        console.log(`🎯 Target: ${WS_URL}`);
        console.log(`⏰ Started at: ${new Date().toISOString()}`);
        console.log('=' .repeat(50));

        try {
            // Test DNS
            await this.testDNS();
            console.log('');

            // Test TCP
            await this.testTCP();
            console.log('');

            // Test HTTP Upgrade
            try {
                await this.testHTTPUpgrade();
            } catch (error) {
                console.log('⚠️ HTTP upgrade test failed, continuing...');
            }
            console.log('');

            // Test WebSocket
            await this.testWebSocket();

        } catch (error) {
            console.log(`\n❌ Diagnostic stopped due to error: ${error.message}`);
        }

        // Test alternative ports regardless of previous results
        await this.testAlternativePorts();

        // Print summary
        this.printSummary();
    }

    // Print diagnostic summary
    printSummary() {
        console.log('\n📊 DIAGNOSTIC SUMMARY');
        console.log('=' .repeat(50));
        
        console.log('DNS Resolution:', this.results.dns?.success ? '✅' : '❌');
        if (this.results.dns?.address) {
            console.log(`  Address: ${this.results.dns.address}`);
        }
        if (this.results.dns?.error) {
            console.log(`  Error: ${this.results.dns.error}`);
        }

        console.log('TCP Connection:', this.results.tcp?.success ? '✅' : '❌');
        if (this.results.tcp?.error) {
            console.log(`  Error: ${this.results.tcp.error}`);
            console.log(`  Code: ${this.results.tcp.code}`);
        }

        console.log('HTTP Upgrade:', this.results.httpUpgrade?.success ? '✅' : '❌');
        if (this.results.httpUpgrade?.statusCode) {
            console.log(`  Status Code: ${this.results.httpUpgrade.statusCode}`);
        }
        if (this.results.httpUpgrade?.error) {
            console.log(`  Error: ${this.results.httpUpgrade.error}`);
        }

        console.log('WebSocket:', this.results.websocket?.success ? '✅' : '❌');
        if (this.results.websocket?.error) {
            console.log(`  Error: ${this.results.websocket.error}`);
            console.log(`  Code: ${this.results.websocket.code}`);
        }

        console.log('\n💡 RECOMMENDATIONS');
        console.log('=' .repeat(50));

        if (!this.results.dns?.success) {
            console.log('• DNS resolution failed - check internet connection or use IP address');
        }

        if (!this.results.tcp?.success) {
            console.log('• TCP connection failed - server may be down or port blocked');
            console.log('• Try using a different port (80, 443, 8080)');
            console.log('• Check if you\'re behind a corporate firewall');
        }

        if (this.results.tcp?.success && !this.results.websocket?.success) {
            console.log('• TCP works but WebSocket fails - server may not support WebSocket');
            console.log('• Check if the server is actually running WebSocket service');
        }

        if (this.results.websocket?.code === 'ETIMEDOUT') {
            console.log('• Connection timeout - server may be overloaded or unreachable');
        }

        if (this.results.websocket?.code === 'ECONNRESET') {
            console.log('• Connection reset - server actively refused connection');
            console.log('• Server may be configured to reject certain connections');
        }

        console.log('\n🔧 NEXT STEPS');
        console.log('=' .repeat(50));
        console.log('1. Verify the server is running: `fly status` (if using Fly.io)');
        console.log('2. Check server logs: `fly logs` (if using Fly.io)');
        console.log('3. Try connecting to a different port');
        console.log('4. Test with a local server first');
        console.log('5. Check firewall and proxy settings');
    }
}

// Run diagnostics
const diagnostic = new ConnectionDiagnostic();
diagnostic.runDiagnostics().catch(console.error);