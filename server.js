/**
 * Entry Player Server
 * 
 * Node.js 서버로 정적 파일을 서빙하고,
 * playentry.org API를 프록시합니다 (curl처럼 서버 측 요청)
 */

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// JSON body parser
app.use(express.json());

// CORS 헤더 설정
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, CSRF-Token, x-client-type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.send('OK');
});

// playentry.org 프록시 - iframe 페이지 (CSRF 토큰 획득용)
app.get('/api/playentry/iframe/:id', async (req, res) => {
    try {
        const response = await fetch(`https://playentry.org/iframe/${req.params.id}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
            }
        });
        
        const html = await response.text();
        res.send(html);
    } catch (error) {
        console.error('iframe fetch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// playentry.org GraphQL 프록시 (curl처럼 서버 측 요청)
app.post('/api/playentry/graphql/:operation', async (req, res) => {
    try {
        const csrfToken = req.headers['csrf-token'] || '';
        const operation = req.params.operation || 'SELECT_PROJECT';
        const projectId = req.query.id || '';
        
        console.log(`GraphQL request: operation=${operation}, csrf=${csrfToken.substring(0, 10)}...`);
        
        const response = await fetch(`https://playentry.org/graphql/${operation}`, {
            method: 'POST',
            headers: {
                'accept': '*/*',
                'accept-language': 'ja',
                'content-type': 'application/json',
                'csrf-token': csrfToken,
                'priority': 'u=1, i',
                'sec-ch-ua': '"Chromium";v="143", "Not A(Brand";v="24"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Linux"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'x-client-type': 'Client',
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                'Referer': `https://playentry.org/iframe/${projectId}`,
                'Origin': 'https://playentry.org',
            },
            body: JSON.stringify(req.body)
        });
        
        const responseText = await response.text();
        console.log(`GraphQL response status: ${response.status}, body preview: ${responseText.substring(0, 100)}...`);
        
        if (!response.ok) {
            console.error(`GraphQL error: ${response.status} - ${responseText}`);
            return res.status(response.status).send(responseText);
        }
        
        // Parse and return JSON
        try {
            const data = JSON.parse(responseText);
            res.json(data);
        } catch (e) {
            // Return raw text if not JSON
            res.send(responseText);
        }
    } catch (error) {
        console.error('GraphQL proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 정적 파일 서빙 (player 디렉토리)
app.use(express.static(path.join(__dirname, 'player'), {
    setHeaders: (res, filePath) => {
        // WASM 파일에 올바른 MIME type 설정
        if (filePath.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
        }
    }
}));

// SPA fallback - 모든 경로를 index.html로
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'player', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Entry Player Server running on port ${PORT}`);
    console.log(`   Open: http://localhost:${PORT}/?id=YOUR_PROJECT_ID`);
});
