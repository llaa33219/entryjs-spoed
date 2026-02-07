/**
 * EntryJS Compiled Project - Proxy Server
 * 
 * This server serves static files and proxies requests to playentry.org
 * to avoid CORS issues when loading assets.
 * 
 * Usage: node server.js
 * Then open http://localhost:3000 in your browser
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

// MIME types for static files
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.wasm': 'application/wasm',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
};

// Allowed proxy domains (security)
const ALLOWED_DOMAINS = [
    'playentry.org',
    'play-entry.org',
    'entry.com',
    'entryjs.org',
    'jsdelivr.net',
    'cdnjs.cloudflare.com',
    'unpkg.com'
];

function isAllowedDomain(urlString) {
    try {
        const parsed = new URL(urlString);
        return ALLOWED_DOMAINS.some(domain => parsed.hostname.endsWith(domain));
    } catch {
        return false;
    }
}

// Proxy request to external URL
function proxyRequest(targetUrl, res) {
    if (!isAllowedDomain(targetUrl)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: Domain not allowed');
        return;
    }
    
    const parsedUrl = new URL(targetUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; EntryJS-Compiler/1.0)',
            'Accept': '*/*',
            'Referer': 'https://playentry.org/'
        }
    };
    
    const proxyReq = protocol.request(options, (proxyRes) => {
        // Get content type from response or guess from URL
        let contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
        const ext = path.extname(parsedUrl.pathname).toLowerCase();
        if (MIME_TYPES[ext]) {
            contentType = MIME_TYPES[ext];
        }
        
        // Set CORS headers
        const headers = {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Cache-Control': 'public, max-age=86400'
        };
        
        // Pass through content-length if available
        if (proxyRes.headers['content-length']) {
            headers['Content-Length'] = proxyRes.headers['content-length'];
        }
        
        res.writeHead(proxyRes.statusCode, headers);
        proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (err) => {
        console.error('[Proxy] Error:', err.message);
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Proxy Error: ' + err.message);
    });
    
    proxyReq.setTimeout(30000, () => {
        proxyReq.destroy();
        res.writeHead(504, { 'Content-Type': 'text/plain' });
        res.end('Proxy Timeout');
    });
    
    proxyReq.end();
}

// Serve static file
function serveStatic(filePath, res) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
            }
            return;
        }
        
        res.writeHead(200, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': ext === '.wasm' ? 'public, max-age=86400' : 'no-cache'
        });
        res.end(data);
    });
}

// Create HTTP server
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Max-Age': '86400'
        });
        res.end();
        return;
    }
    
    // Handle proxy requests
    if (pathname === '/proxy') {
        const targetUrl = parsedUrl.query.url;
        if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Bad Request: Missing url parameter');
            return;
        }
        
        console.log('[Proxy]', decodeURIComponent(targetUrl));
        proxyRequest(decodeURIComponent(targetUrl), res);
        return;
    }
    
    // Serve static files
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(__dirname, filePath);
    
    // Security: prevent directory traversal
    const resolvedPath = path.resolve(filePath);
    const rootDir = path.resolve(__dirname);
    if (!resolvedPath.startsWith(rootDir)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }
    
    serveStatic(resolvedPath, res);
});

server.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('  EntryJS Compiled Project Server');
    console.log('========================================');
    console.log('');
    console.log('  Local:   http://localhost:' + PORT);
    console.log('  Network: http://' + getLocalIP() + ':' + PORT);
    console.log('');
    console.log('  Press Ctrl+C to stop');
    console.log('');
});

function getLocalIP() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}
