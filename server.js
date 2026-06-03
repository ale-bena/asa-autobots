import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const COMMENTS_FILE = path.join(__dirname, 'comments.json');
const HTML_FILE = path.join(__dirname, 'documentation.html');

// Helper to ensure comments.json exists
if (!fs.existsSync(COMMENTS_FILE)) {
    fs.writeFileSync(COMMENTS_FILE, JSON.stringify({}, null, 2));
}

const server = http.createServer((req, res) => {
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

                    fs.writeFile(COMMENTS_FILE, JSON.stringify(comments, null, 2), 'utf8', (writeErr) => {
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

server.listen(PORT, () => {
    console.log(`[doc-server] Documentation server running at http://localhost:${PORT}`);
});
