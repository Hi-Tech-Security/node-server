const net = require('net');
const http = require('http');

const TARGET_HOST = 'quicknotify.fly.dev';
const TARGET_PORTS = [3000, 3001, 80, 443, 8080];

console.log('🔍 Checking server availability...');
console.log('=' .repeat(50));

// Quick port scan
async function checkPort(host, port, timeout = 5000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        
        const timeoutHandler = setTimeout(() => {
            socket.destroy();
            resolve({ port, status: 'timeout', error: 'Connection timeout' });
        }, timeout);

        socket.connect(port, host, () => {
            clearTimeout(timeoutHandler);
            socket.end();
            resolve({ port, status: 'open' });
        });

        socket.on('error', (error) => {
            clearTimeout(timeoutHandler);
            resolve({ port, status: 'closed', error: error.message, code: error.code });
        });
    });
}

// Check HTTP response
async function checkHTTP(host, port) {
    return new Promise((resolve) => {
        const options = {
            hostname: host,
            port: port,
            path: '/',
            method: 'GET',
            timeout: 5000
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: data.substring(0, 200) + (data.length > 200 ? '...' : '')
                });
            });
        });

        req.on('error', (error) => {
            resolve({ error: error.message, code: error.code });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ error: 'HTTP request timeout' });
        });

        req.end();
    });
}

async function main() {
    console.log(`🎯 Target host: ${TARGET_HOST}`);
    console.log(`⏰ Check started: ${new Date().toISOString()}\n`);

    // Test all ports
    console.log('🔍 Port Scan Results:');
    for (const port of TARGET_PORTS) {
        const result = await checkPort(TARGET_HOST, port);
        const statusIcon = result.status === 'open' ? '✅' : '❌';
        console.log(`${statusIcon} Port ${port}: ${result.status}`);
        if (result.error) {
            console.log(`   Error: ${result.error}`);
        }
        if (result.code) {
            console.log(`   Code: ${result.code}`);
        }
    }

    console.log('\n🌐 HTTP Service Check:');
    
    // Check common HTTP ports
    const httpPorts = [80, 3000, 8080];
    for (const port of httpPorts) {
        console.log(`\n🔍 Checking HTTP service on port ${port}...`);
        const httpResult = await checkHTTP(TARGET_HOST, port);
        
        if (httpResult.status) {
            console.log(`✅ HTTP response: ${httpResult.status}`);
            console.log(`📋 Headers:`, JSON.stringify(httpResult.headers, null, 2));
            if (httpResult.body) {
                console.log(`📝 Body preview: ${httpResult.body}`);
            }
        } else {
            console.log(`❌ HTTP request failed: ${httpResult.error}`);
            if (httpResult.code) {
                console.log(`   Code: ${httpResult.code}`);
            }
        }
    }

    console.log('\n💡 Analysis:');
    console.log('=' .repeat(50));
    
    // Analyze results
    const openPorts = TARGET_PORTS.filter(async (port) => {
        const result = await checkPort(TARGET_HOST, port);
        return result.status === 'open';
    });

    if (openPorts.length === 0) {
        console.log('❌ No ports are accessible');
        console.log('   • Server may be down or not deployed');
        console.log('   • Check if quicknotify.fly.dev is the correct domain');
        console.log('   • Verify your Fly.io deployment status');
    } else {
        console.log(`✅ Found ${openPorts.length} accessible ports`);
    }

    console.log('\n🔧 Troubleshooting Steps:');
    console.log('1. Check Fly.io deployment status: `fly status`');
    console.log('2. Check application logs: `fly logs`');
    console.log('3. Verify the app is running: `fly apps list`');
    console.log('4. Try redeploying: `fly deploy`');
    console.log('5. Check fly.toml configuration');
    
    console.log('\n📱 Quick Commands:');
    console.log('# Check if your Fly app is running');
    console.log('fly status');
    console.log('');
    console.log('# View recent logs');
    console.log('fly logs');
    console.log('');
    console.log('# Scale your app (if it\'s sleeping)');
    console.log('fly scale count 1');
    console.log('');
    console.log('# Connect to your app console');
    console.log('fly ssh console');
}

main().catch(console.error);