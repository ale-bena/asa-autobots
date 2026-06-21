import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const HTML_FILE = path.join(__dirname, 'docs', 'index.html');

const server = http.createServer((req, res) => {
    // We only serve the index.html for all requests
    fs.readFile(HTML_FILE, 'utf8', (err, content) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(`Internal Server Error: Could not read index.html.\nMake sure the file exists under docs/index.html.`);
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
    });
});

server.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`  Deliveroo Map Builder is running successfully!`);
    console.log(` Open your browser at: http://localhost:${PORT}`);
    console.log(`==================================================\n`);
});
