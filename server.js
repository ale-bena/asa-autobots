import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environmental variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const COMMENTS_FILE = path.join(__dirname, 'comments.json');
const HTML_FILE = path.join(__dirname, 'documentation.html');
const MD_FILE = path.join(__dirname, 'design_and_requirements.md');

// Helper to ensure comments.json exists
if (!fs.existsSync(COMMENTS_FILE)) {
    fs.writeFileSync(COMMENTS_FILE, JSON.stringify({}, null, 2));
}

// Active Server-Sent Events (SSE) clients for live reload
let reloadClients = [];

let ignoreCommentsWatch = false;
function safeWriteComments(comments, callback) {
    ignoreCommentsWatch = true;
    fs.writeFile(COMMENTS_FILE, JSON.stringify(comments, null, 2), 'utf8', (writeErr) => {
        setTimeout(() => {
            ignoreCommentsWatch = false;
        }, 500);
        callback(writeErr);
    });
}

const server = http.createServer(async (req, res) => {
    // Enable CORS for development convenience
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

    // API: GET /api/reload (SSE Hot Reload connection)
    if (parsedUrl.pathname === '/api/reload' && req.method === 'GET') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        
        // Write initial handshake
        res.write('data: connected\n\n');
        reloadClients.push(res);
        
        req.on('close', () => {
            reloadClients = reloadClients.filter(client => client !== res);
        });
        return;
    }

    // API: GET /api/config (Load configurations from .env)
    if (parsedUrl.pathname === '/api/config' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            baseURL: process.env.LITELLM_BASE_URL || 'https://llm.bears.disi.unitn.it/v1',
            apiKey: process.env.LITELLM_API_KEY || '',
            model: process.env.LLM_MODEL || 'llama-3.3-70b-lmstudio'
        }));
        return;
    }

    // API: GET /api/comments
    if (parsedUrl.pathname === '/api/comments' && req.method === 'GET') {
        fs.readFile(COMMENTS_FILE, 'utf8', (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to read comments file' }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(data);
        });
        return;
    }

    // API: POST /api/comments
    if (parsedUrl.pathname === '/api/comments' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const { sectionId, text } = JSON.parse(body);
                if (!sectionId || !text) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing sectionId or text' }));
                    return;
                }

                fs.readFile(COMMENTS_FILE, 'utf8', (err, data) => {
                    let comments = {};
                    if (!err && data) {
                        try {
                            comments = JSON.parse(data);
                        } catch (e) {
                            comments = {};
                        }
                    }

                    if (!comments[sectionId]) {
                        comments[sectionId] = [];
                    }

                    comments[sectionId].push({
                        id: Date.now().toString(),
                        timestamp: new Date().toISOString(),
                        text: text
                    });

                    safeWriteComments(comments, (writeErr) => {
                        if (writeErr) {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Failed to save comment' }));
                            return;
                        }
                        res.writeHead(201, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, comments: comments[sectionId] }));
                    });
                });
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Malformed JSON payload' }));
            }
        });
        return;
    }

    // API: POST /api/comments/clear
    if (parsedUrl.pathname === '/api/comments/clear' && req.method === 'POST') {
        safeWriteComments({}, (err) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to clear comments' }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, comments: {} }));
        });
        return;
    }

    // API: POST /api/comments/delete
    if (parsedUrl.pathname === '/api/comments/delete' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const { sectionId, commentId } = JSON.parse(body);
                if (!sectionId || !commentId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing sectionId or commentId' }));
                    return;
                }

                fs.readFile(COMMENTS_FILE, 'utf8', (err, data) => {
                    let comments = {};
                    if (!err && data) {
                        try {
                            comments = JSON.parse(data);
                        } catch (e) {
                            comments = {};
                        }
                    }

                    if (comments[sectionId]) {
                        comments[sectionId] = comments[sectionId].filter(c => c.id !== commentId);
                        if (comments[sectionId].length === 0) {
                            delete comments[sectionId];
                        }
                    }

                    safeWriteComments(comments, (writeErr) => {
                        if (writeErr) {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Failed to delete comment' }));
                            return;
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, comments: comments[sectionId] || [] }));
                    });
                });
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Malformed JSON payload' }));
            }
        });
        return;
    }

    // API: POST /api/chat (LLM Proxy)
    if (parsedUrl.pathname === '/api/chat' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            try {
                const { baseURL, apiKey, model, messages, tools } = JSON.parse(body);
                
                if (!baseURL || !model || !messages) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing required LLM parameters (baseURL, model, messages)' }));
                    return;
                }

                const llmHeaders = {
                    'Content-Type': 'application/json',
                };
                if (apiKey) {
                    llmHeaders['Authorization'] = `Bearer ${apiKey}`;
                }

                const requestBody = {
                    model,
                    messages
                };
                if (tools && tools.length > 0) {
                    requestBody.tools = tools;
                }

                const targetUrl = baseURL.endsWith('/') ? `${baseURL}chat/completions` : `${baseURL}/chat/completions`;
                const llmResponse = await fetch(targetUrl, {
                    method: 'POST',
                    headers: llmHeaders,
                    body: JSON.stringify(requestBody)
                });

                const responseData = await llmResponse.json();
                
                res.writeHead(llmResponse.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(responseData));

            } catch (err) {
                console.error("[proxy-error]", err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed proxying request to LLM provider', details: err.message }));
            }
        });
        return;
    }

    // Serve documentation.html at / or /index.html
    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html' || parsedUrl.pathname === '/documentation.html') {
        fs.readFile(HTML_FILE, 'utf8', (err, content) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error loading documentation.html. Make sure the file exists.');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
        });
        return;
    }

    // Default 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

// Watch files for changes to trigger live reload in the browser
let watchDebounce = false;
function broadcastReload(fileName) {
    console.log(`[reload-server] File ${fileName} changed. Reloading ${reloadClients.length} clients...`);
    reloadClients.forEach(client => {
        try {
            client.write('data: reload\n\n');
        } catch (e) {
            console.error("[reload-error] Failed writing to client", e);
        }
    });
}

function setupWatch(filePath, fileName, ignoreFlagCheck = null) {
    if (!fs.existsSync(filePath)) return;
    fs.watch(filePath, (eventType) => {
        if (eventType === 'change') {
            if (ignoreFlagCheck && ignoreFlagCheck()) {
                return; // skip reload for self-writes
            }
            if (watchDebounce) return;
            watchDebounce = true;
            setTimeout(() => { watchDebounce = false; }, 200); // 200ms debounce
            broadcastReload(fileName);
        }
    });
}

setupWatch(HTML_FILE, 'documentation.html');
setupWatch(MD_FILE, 'design_and_requirements.md');
setupWatch(COMMENTS_FILE, 'comments.json', () => ignoreCommentsWatch);

server.listen(PORT, () => {
    console.log(`[doc-server] Documentation server running at http://localhost:${PORT}`);
});
