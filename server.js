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

// 세션 저장소 (프로젝트 ID별로 쿠키 저장)
const sessionStore = new Map();

// JSON body parser
app.use(express.json());

// CORS 헤더 설정
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, csrf-token, x-client-type, x-entry-cookie');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.send('OK');
});

// playentry.org 프록시 - iframe 페이지 (CSRF 토큰 + 쿠키 획득용)
app.get('/api/playentry/iframe/:id', async (req, res) => {
    try {
        const projectId = req.params.id;
        
        const response = await fetch(`https://playentry.org/iframe/${projectId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
            }
        });
        
        // Set-Cookie 헤더 캡처
        const setCookieHeaders = response.headers.getSetCookie ? 
            response.headers.getSetCookie() : 
            (response.headers.get('set-cookie') || '').split(', ');
        
        // 쿠키를 파싱하여 저장
        const cookies = [];
        for (const cookieStr of setCookieHeaders) {
            if (cookieStr) {
                // 쿠키 이름=값 부분만 추출
                const cookiePart = cookieStr.split(';')[0];
                if (cookiePart) {
                    cookies.push(cookiePart);
                }
            }
        }
        
        const cookieString = cookies.join('; ');
        console.log(`Captured cookies for project ${projectId}: ${cookieString.substring(0, 50)}...`);
        
        // 세션 저장소에 쿠키 저장
        sessionStore.set(projectId, cookieString);
        
        const html = await response.text();
        
        // 쿠키 정보를 응답 헤더에 포함
        res.setHeader('X-Entry-Cookie', cookieString);
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
        
        // 클라이언트가 보낸 쿠키 또는 세션 저장소에서 쿠키 가져오기
        const clientCookie = req.headers['x-entry-cookie'] || '';
        const storedCookie = sessionStore.get(projectId) || '';
        const cookieToUse = clientCookie || storedCookie;
        
        console.log(`GraphQL request: operation=${operation}, csrf=${csrfToken.substring(0, 10)}..., cookie=${cookieToUse.substring(0, 30)}...`);
        
        const response = await fetch(`https://playentry.org/graphql/${operation}`, {
            method: 'POST',
            headers: {
                'accept': '*/*',
                'accept-language': 'ja',
                'content-type': 'application/json',
                'csrf-token': csrfToken,
                'cookie': cookieToUse,  // 쿠키 추가!
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
            
            console.log('GraphQL 응답 구조:', JSON.stringify({
                hasData: !!data.data,
                hasProject: !!(data.data && data.data.project),
                hasErrors: !!data.errors,
                topLevelKeys: Object.keys(data)
            }));
            
            // project 객체만 추출해서 반환
            if (data.data && data.data.project) {
                const project = data.data.project;
                console.log('Project data extracted:', project.name || 'unnamed', 'id:', project.id);
                
                // 프로젝트 데이터가 실제로 있는지 확인
                if (!project.id) {
                    console.error('프로젝트 데이터가 비어있음:', JSON.stringify(project).substring(0, 200));
                    return res.status(404).json({ 
                        error: '프로젝트 데이터가 비어있습니다',
                        detail: 'project.id가 없습니다',
                        received: project
                    });
                }
                
                res.json(project);
            } else if (data.errors) {
                console.error('GraphQL errors:', JSON.stringify(data.errors));
                res.status(400).json({ 
                    error: data.errors[0]?.message || 'GraphQL 에러',
                    detail: 'GraphQL 서버에서 에러 반환',
                    errors: data.errors 
                });
            } else if (data.data && !data.data.project) {
                // data는 있지만 project가 없는 경우
                console.error('data.project가 없음. data 내용:', JSON.stringify(data.data).substring(0, 300));
                res.status(404).json({
                    error: '프로젝트를 찾을 수 없습니다',
                    detail: 'data.project가 undefined/null입니다',
                    dataKeys: Object.keys(data.data || {}),
                    received: data.data
                });
            } else {
                // 완전히 예상치 못한 형식
                console.error('예상치 못한 응답 형식:', JSON.stringify(data).substring(0, 500));
                res.status(500).json({
                    error: '예상치 못한 응답 형식',
                    detail: 'data 필드가 없습니다',
                    topLevelKeys: Object.keys(data),
                    preview: JSON.stringify(data).substring(0, 300)
                });
            }
        } catch (e) {
            // Return raw text if not JSON
            console.error('JSON 파싱 실패:', e.message);
            console.error('응답 원본 (처음 500자):', responseText.substring(0, 500));
            res.status(500).json({
                error: 'JSON 파싱 실패',
                detail: e.message,
                responsePreview: responseText.substring(0, 300)
            });
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
