import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import { marked } from 'marked';

// Load environmental variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const COMMENTS_FILE = path.join(__dirname, 'comments.json');
const TEMPLATE_FILE = path.join(__dirname, 'template.html');
const WORKSPACE_DIR = path.join(__dirname, '..');

function getProjectDir(projectId) {
    const internalPath = path.join(__dirname, 'projects', projectId);
    if (fs.existsSync(internalPath)) {
        return internalPath;
    }
    return path.join(WORKSPACE_DIR, projectId);
}

function getProjectDocsDir(projectId) {
    return path.join(getProjectDir(projectId), 'docs');
}

function getProjectToolPath(projectId, toolFilename) {
    return path.join(getProjectDir(projectId), toolFilename);
}

// ============================================================
// Git & GitHub Integration Helpers
// ============================================================

function execGit(projectId, gitArgs, opts = {}) {
    const projectDir = path.join(WORKSPACE_DIR, projectId);
    if (!fs.existsSync(path.join(projectDir, '.git'))) {
        throw new Error(`Project '${projectId}' is not a git repository`);
    }
    const result = execSync(`git ${gitArgs}`, {
        cwd: projectDir,
        encoding: 'utf8',
        timeout: 15000,
        maxBuffer: 5 * 1024 * 1024,
        ...opts
    });
    return result.trim();
}

function parseGitRemote(projectId) {
    try {
        const url = execGit(projectId, 'remote get-url origin');
        // Handle https://github.com/owner/repo.git or git@github.com:owner/repo.git
        let match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/);
        if (match) {
            return { owner: match[1], repo: match[2], url };
        }
        return { owner: null, repo: null, url };
    } catch {
        return { owner: null, repo: null, url: null };
    }
}

async function githubApiFetch(endpoint, options = {}) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        throw new Error('GITHUB_TOKEN is not configured in .env');
    }
    const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'DocHub-Server/1.0',
        ...(options.headers || {})
    };
    const url = endpoint.startsWith('https://') ? endpoint : `https://api.github.com${endpoint}`;
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.message || `GitHub API error: ${response.status}`);
    }
    return response.json();
}

function parseGitStatus(raw) {
    const lines = raw.split('\n').filter(l => l.length > 0);
    const staged = [];
    const modified = [];
    const untracked = [];
    for (const line of lines) {
        const indexStatus = line[0];
        const workTreeStatus = line[1];
        const filePath = line.substring(3);
        if (indexStatus === '?' && workTreeStatus === '?') {
            untracked.push(filePath);
        } else {
            if (indexStatus !== ' ' && indexStatus !== '?') {
                staged.push({ file: filePath, status: indexStatus });
            }
            if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
                modified.push({ file: filePath, status: workTreeStatus });
            }
        }
    }
    return { staged, modified, untracked };
}

function parseGitLog(raw) {
    if (!raw) return [];
    return raw.split('\n').filter(l => l).map(line => {
        const parts = line.split('|||');
        return {
            hash: parts[0] || '',
            shortHash: (parts[0] || '').substring(0, 7),
            author: parts[1] || '',
            email: parts[2] || '',
            date: parts[3] || '',
            message: parts[4] || ''
        };
    });
}

function isGitProject(projectId) {
    const gitDir = path.join(WORKSPACE_DIR, projectId, '.git');
    return fs.existsSync(gitDir);
}

function getProjects() {
    const projects = new Set();

    // 1. Add projects from collab-agent-team/projects/
    const internalProjectsDir = path.join(__dirname, 'projects');
    if (fs.existsSync(internalProjectsDir)) {
        fs.readdirSync(internalProjectsDir).forEach(file => {
            const fullPath = path.join(internalProjectsDir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                const docsPath = path.join(fullPath, 'docs');
                if (fs.existsSync(docsPath) && fs.statSync(docsPath).isDirectory()) {
                    projects.add(file);
                }
            }
        });
    }

    // 2. Add projects from WORKSPACE_DIR siblings
    if (fs.existsSync(WORKSPACE_DIR)) {
        fs.readdirSync(WORKSPACE_DIR).forEach(file => {
            const fullPath = path.join(WORKSPACE_DIR, file);
            if (!fs.statSync(fullPath).isDirectory()) return;
            
            // Check if it has a docs directory
            const docsPath = path.join(fullPath, 'docs');
            if (fs.existsSync(docsPath) && fs.statSync(docsPath).isDirectory()) {
                projects.add(file);
            }
        });
    }

    return Array.from(projects);
}

function getProjectSelectorHtml(currentProjectId) {
    const projects = getProjects();
    if (projects.length <= 1) return '';

    let options = '';
    projects.forEach(p => {
        const displayName = p.replace(/-/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        const selected = (p === currentProjectId) ? 'selected' : '';
        options += `<option value="${p}" ${selected}>${displayName}</option>`;
    });

    return `
    <div class="project-selector-container" style="margin-bottom: 1.5rem; flex-shrink: 0;">
        <label style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 0.35rem; display: block;">Active Project</label>
        <select id="projectSelect" class="form-input form-select" onchange="window.location.href = '/projects/' + this.value" style="font-size: 0.85rem; padding: 0.4rem 0.6rem; background-color: rgba(255,255,255,0.03);">
            ${options}
        </select>
    </div>
    `;
}

function getSidebarHtml(currentProjectId, currentDocId) {
    const projectDir = getProjectDocsDir(currentProjectId);
    if (!fs.existsSync(projectDir)) return '';
    const files = fs.readdirSync(projectDir)
        .filter(f => f.endsWith('.md'))
        .sort((a, b) => a.localeCompare(b));

    let html = '';
    files.forEach(file => {
        const id = file.slice(0, -3);
        const displayName = id.replace(/^\d+-/, '').replace(/-/g, ' ');
        const capitalized = displayName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        const activeClass = (id === currentDocId) ? 'active' : '';
        html += `<li class="nav-item ${activeClass}" data-sec="${id}"><a href="/projects/${currentProjectId}/${id}">${capitalized}</a></li>\n`;
    });

    // Dynamically append Policy Builder if it exists in the project
    const policyBuilderPath = getProjectToolPath(currentProjectId, 'policy_builder.html');
    if (fs.existsSync(policyBuilderPath)) {
        const activeClass = (currentDocId === 'policy-builder') ? 'active' : '';
        html += `<li class="nav-item ${activeClass}" data-sec="policy-builder"><a href="/projects/${currentProjectId}/policy-builder">🛠 Policy Builder</a></li>\n`;
    }

    // Dynamically append Map Creator if it exists in the project
    const mapCreatorPath = getProjectToolPath(currentProjectId, 'map_creator.html');
    if (fs.existsSync(mapCreatorPath)) {
        const activeClass = (currentDocId === 'map-creator') ? 'active' : '';
        html += `<li class="nav-item ${activeClass}" data-sec="map-creator"><a href="/projects/${currentProjectId}/map-creator">🗺 Map Creator</a></li>\n`;
    }

    return html;
}

function deindentHtmlBlocks(content) {
    const lines = content.split('\n');
    let inPre = false;
    let preIndent = 0;
    
    return lines.map(line => {
        const trimmed = line.trimStart();
        
        // Handle pre/code tags to preserve their internal indentation
        const hasPreStart = /<pre[ >]/.test(line);
        const hasPreEnd = /<\/pre>/.test(line);
        
        if (hasPreStart) {
            inPre = true;
            preIndent = line.match(/^\s*/)[0].length;
        }
        
        let resultLine = line;
        if (inPre) {
            if (line.startsWith(' '.repeat(preIndent))) {
                resultLine = line.slice(preIndent);
            } else {
                resultLine = trimmed;
            }
        } else if (trimmed.startsWith('<')) {
            // Trim leading whitespace for raw HTML tags to prevent indented code blocks
            resultLine = trimmed;
        }
        
        if (hasPreEnd) {
            inPre = false;
            preIndent = 0;
        }
        
        return resultLine;
    }).join('\n');
}

// Helper to ensure comments.json exists
if (!fs.existsSync(COMMENTS_FILE)) {
    fs.writeFileSync(COMMENTS_FILE, JSON.stringify({}, null, 2));
}

// Active Server-Sent Events (SSE) clients for live reload
let reloadClients = [];

function broadcastCommentsUpdate() {
    console.log(`[reload-server] Comments updated. Broadcasting to ${reloadClients.length} clients...`);
    reloadClients.forEach(client => {
        try {
            client.write('data: comments_updated\n\n');
        } catch (e) {
            console.error("[reload-error] Failed writing to client", e);
        }
    });
}

let ignoreCommentsWatch = false;
function safeWriteComments(comments, callback) {
    ignoreCommentsWatch = true;
    fs.writeFile(COMMENTS_FILE, JSON.stringify(comments, null, 2), 'utf8', (writeErr) => {
        setTimeout(() => {
            ignoreCommentsWatch = false;
        }, 500);
        if (!writeErr) {
            broadcastCommentsUpdate();
        }
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

    // API: GET /api/projects
    if (parsedUrl.pathname === '/api/projects' && req.method === 'GET') {
        const projects = getProjects();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(projects));
        return;
    }

    // API: POST /api/projects
    if (parsedUrl.pathname === '/api/projects' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const { name } = JSON.parse(body);
                if (!name || !name.trim()) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Project name is required' }));
                    return;
                }

                // Slugify the project name
                const slug = name.trim().toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/(^-|-$)/g, '');

                if (!slug) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid project name' }));
                    return;
                }

                const projectPath = path.join(WORKSPACE_DIR, slug);
                if (fs.existsSync(projectPath)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'A project with that name already exists' }));
                    return;
                }

                const projectDocsPath = path.join(projectPath, 'docs');

                // Create project directory and its docs/ folder
                fs.mkdirSync(projectDocsPath, { recursive: true });

                // Initialize a default 1-overview.md
                const defaultOverviewContent = `<main class="main-panel">
    <header style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border-color); padding-bottom: 1.5rem; margin-bottom: 3rem;">
        <div>
            <div class="badge-header">Project Overview</div>
            <h1>${name}</h1>
            <div class="subtitle">Documentation and critique space for the ${name} project.</div>
        </div>
    </header>

    <section id="overview">
        <div class="section-header">
            <div class="section-num">1</div>
            <h2>Project Overview</h2>
        </div>
        <p class="commentable" data-comment-id="overview-p1">
            Welcome to the <strong>${name}</strong> workspace! You can edit this file under <code>${slug}/docs/1-overview.md</code>, or add new markdown documents inside the directory.
        </p>
    </section>
</main>
`;
                const defaultOverviewPath = path.join(projectDocsPath, '1-overview.md');
                fs.writeFileSync(defaultOverviewPath, defaultOverviewContent, 'utf8');

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, redirectUrl: `/projects/${slug}/1-overview` }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to create project directory', details: err.message }));
            }
        });
        return;
    }

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

    // ============================================================
    // Git Local API Routes
    // ============================================================

    // Pattern: /api/git/:projectId/:action
    const gitApiMatch = parsedUrl.pathname.match(/^\/api\/git\/([^/]+)\/(.+)$/);
    if (gitApiMatch) {
        const [, gitProjectId, gitAction] = gitApiMatch;
        const projectDir = path.join(WORKSPACE_DIR, gitProjectId);

        if (!fs.existsSync(projectDir) || !isGitProject(gitProjectId)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Project '${gitProjectId}' is not a git repository` }));
            return;
        }

        try {
            // GET /api/git/:projectId/status
            if (gitAction === 'status' && req.method === 'GET') {
                const raw = execGit(gitProjectId, 'status --porcelain');
                const branch = execGit(gitProjectId, 'rev-parse --abbrev-ref HEAD');
                const status = parseGitStatus(raw);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ branch, ...status }));
                return;
            }

            // GET /api/git/:projectId/log
            if (gitAction === 'log' && req.method === 'GET') {
                const count = parsedUrl.searchParams.get('count') || '20';
                const raw = execGit(gitProjectId, `log --format="%H|||%an|||%ae|||%aI|||%s" -n ${parseInt(count)}`);
                const commits = parseGitLog(raw);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(commits));
                return;
            }

            // GET /api/git/:projectId/diff
            if (gitAction === 'diff' && req.method === 'GET') {
                const unstaged = execGit(gitProjectId, 'diff');
                const staged = execGit(gitProjectId, 'diff --staged');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ unstaged, staged }));
                return;
            }

            // GET /api/git/:projectId/diff/:hash
            const diffHashMatch = gitAction.match(/^diff\/([a-f0-9]+)$/);
            if (diffHashMatch && req.method === 'GET') {
                const hash = diffHashMatch[1];
                const stat = execGit(gitProjectId, `show ${hash} --stat --format="%H|||%an|||%ae|||%aI|||%s"`);
                const diff = execGit(gitProjectId, `show ${hash} --format=""`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ stat, diff }));
                return;
            }

            // GET /api/git/:projectId/branches
            if (gitAction === 'branches' && req.method === 'GET') {
                const current = execGit(gitProjectId, 'rev-parse --abbrev-ref HEAD');
                const localRaw = execGit(gitProjectId, 'branch --format="%(refname:short)"');
                const remoteRaw = execGit(gitProjectId, 'branch -r --format="%(refname:short)"').split('\n').filter(b => b && !b.includes('HEAD'));
                const local = localRaw.split('\n').filter(b => b);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ current, local, remote: remoteRaw }));
                return;
            }

            // POST /api/git/:projectId/checkout
            if (gitAction === 'checkout' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                req.on('end', () => {
                    try {
                        const { branch } = JSON.parse(body);
                        if (!branch) throw new Error('Branch name is required');
                        const output = execGit(gitProjectId, `checkout ${branch}`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: output || `Switched to branch '${branch}'` }));
                    } catch (err) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    }
                });
                return;
            }

            // POST /api/git/:projectId/stage
            if (gitAction === 'stage' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                req.on('end', () => {
                    try {
                        const { files, all } = JSON.parse(body);
                        if (all) {
                            execGit(gitProjectId, 'add -A');
                        } else if (files && files.length > 0) {
                            const safeFiles = files.map(f => `"${f.replace(/"/g, '\\"')}"`).join(' ');
                            execGit(gitProjectId, `add ${safeFiles}`);
                        } else {
                            throw new Error('Specify files array or all: true');
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } catch (err) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    }
                });
                return;
            }

            // POST /api/git/:projectId/unstage
            if (gitAction === 'unstage' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                req.on('end', () => {
                    try {
                        const { files } = JSON.parse(body);
                        if (!files || files.length === 0) throw new Error('Specify files to unstage');
                        const safeFiles = files.map(f => `"${f.replace(/"/g, '\\"')}"`).join(' ');
                        execGit(gitProjectId, `restore --staged ${safeFiles}`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } catch (err) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    }
                });
                return;
            }

            // POST /api/git/:projectId/commit
            if (gitAction === 'commit' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                req.on('end', () => {
                    try {
                        const { message } = JSON.parse(body);
                        if (!message || !message.trim()) throw new Error('Commit message is required');
                        const safeMsg = message.replace(/"/g, '\\"');
                        const output = execGit(gitProjectId, `commit -m "${safeMsg}"`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: output }));
                    } catch (err) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    }
                });
                return;
            }

            // POST /api/git/:projectId/pull
            if (gitAction === 'pull' && req.method === 'POST') {
                try {
                    const branch = execGit(gitProjectId, 'rev-parse --abbrev-ref HEAD');
                    const output = execGit(gitProjectId, `pull origin ${branch}`, { timeout: 30000 });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: output }));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                }
                return;
            }

            // POST /api/git/:projectId/push
            if (gitAction === 'push' && req.method === 'POST') {
                try {
                    const branch = execGit(gitProjectId, 'rev-parse --abbrev-ref HEAD');
                    const output = execGit(gitProjectId, `push origin ${branch}`, { timeout: 30000 });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: output || 'Push successful' }));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                }
                return;
            }

            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Unknown git action: ${gitAction}` }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // ============================================================
    // GitHub Remote API Routes
    // ============================================================

    const ghApiMatch = parsedUrl.pathname.match(/^\/api\/github\/([^/]+)\/(.+)$/);
    if (ghApiMatch) {
        const [, ghProjectId, ghAction] = ghApiMatch;
        const remote = parseGitRemote(ghProjectId);

        if (!remote.owner || !remote.repo) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Could not resolve GitHub owner/repo for '${ghProjectId}'. Remote URL: ${remote.url}` }));
            return;
        }

        try {
            const repoPath = `/repos/${remote.owner}/${remote.repo}`;

            // GET /api/github/:projectId/repo
            if (ghAction === 'repo' && req.method === 'GET') {
                const data = await githubApiFetch(repoPath);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    name: data.full_name,
                    description: data.description,
                    stars: data.stargazers_count,
                    forks: data.forks_count,
                    watchers: data.watchers_count,
                    defaultBranch: data.default_branch,
                    htmlUrl: data.html_url,
                    private: data.private,
                    openIssues: data.open_issues_count
                }));
                return;
            }

            // GET /api/github/:projectId/issues
            if (ghAction === 'issues' && req.method === 'GET') {
                const page = parsedUrl.searchParams.get('page') || '1';
                const data = await githubApiFetch(`${repoPath}/issues?state=open&per_page=20&page=${page}`);
                const issues = data.filter(i => !i.pull_request).map(i => ({
                    number: i.number,
                    title: i.title,
                    body: i.body,
                    state: i.state,
                    labels: i.labels.map(l => ({ name: l.name, color: l.color })),
                    assignees: i.assignees.map(a => ({ login: a.login, avatar: a.avatar_url })),
                    author: { login: i.user.login, avatar: i.user.avatar_url },
                    createdAt: i.created_at,
                    updatedAt: i.updated_at,
                    htmlUrl: i.html_url,
                    comments: i.comments
                }));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(issues));
                return;
            }

            // POST /api/github/:projectId/issues
            if (ghAction === 'issues' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                req.on('end', async () => {
                    try {
                        const { title, body: issueBody, labels } = JSON.parse(body);
                        if (!title) throw new Error('Issue title is required');
                        const payload = { title, body: issueBody || '' };
                        if (labels && labels.length > 0) payload.labels = labels;
                        const data = await githubApiFetch(`${repoPath}/issues`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        res.writeHead(201, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ number: data.number, htmlUrl: data.html_url, title: data.title }));
                    } catch (err) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    }
                });
                return;
            }

            // GET /api/github/:projectId/pulls
            if (ghAction === 'pulls' && req.method === 'GET') {
                const data = await githubApiFetch(`${repoPath}/pulls?state=open&per_page=20`);
                const pulls = data.map(pr => ({
                    number: pr.number,
                    title: pr.title,
                    state: pr.state,
                    author: { login: pr.user.login, avatar: pr.user.avatar_url },
                    head: pr.head.ref,
                    base: pr.base.ref,
                    createdAt: pr.created_at,
                    htmlUrl: pr.html_url,
                    draft: pr.draft,
                    mergeable: pr.mergeable,
                    reviewers: (pr.requested_reviewers || []).map(r => ({ login: r.login, avatar: r.avatar_url }))
                }));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(pulls));
                return;
            }

            // GET /api/github/:projectId/contributors
            if (ghAction === 'contributors' && req.method === 'GET') {
                const data = await githubApiFetch(`${repoPath}/contributors?per_page=30`);
                const contributors = data.map(c => ({
                    login: c.login,
                    avatar: c.avatar_url,
                    contributions: c.contributions,
                    htmlUrl: c.html_url
                }));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(contributors));
                return;
            }

            // POST /api/github/:projectId/comment-to-issue
            if (ghAction === 'comment-to-issue' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                req.on('end', async () => {
                    try {
                        const { sectionId, text, docId } = JSON.parse(body);
                        if (!text) throw new Error('Comment text is required');
                        const issueBody = [
                            `**Source:** Doc comment from \`${ghProjectId}\``,
                            docId ? `**Document:** [${docId}](http://localhost:${PORT}/projects/${ghProjectId}/${docId})` : '',
                            sectionId ? `**Section:** \`${sectionId}\`` : '',
                            '',
                            '---',
                            '',
                            text
                        ].filter(l => l !== undefined).join('\n');

                        const data = await githubApiFetch(`${repoPath}/issues`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                title: `[Doc Comment] ${text.substring(0, 80)}${text.length > 80 ? '...' : ''}`,
                                body: issueBody,
                                labels: ['documentation']
                            })
                        });

                        // Update comment in comments.json with the issue URL
                        if (sectionId) {
                            try {
                                const commentsRaw = fs.readFileSync(COMMENTS_FILE, 'utf8');
                                const comments = JSON.parse(commentsRaw);
                                if (comments[sectionId]) {
                                    const comment = comments[sectionId].find(c => c.text === text);
                                    if (comment) {
                                        comment.githubIssueUrl = data.html_url;
                                        comment.githubIssueNumber = data.number;
                                        safeWriteComments(comments, () => {});
                                    }
                                }
                            } catch { /* non-critical */ }
                        }

                        res.writeHead(201, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ number: data.number, htmlUrl: data.html_url }));
                    } catch (err) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    }
                });
                return;
            }

            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Unknown GitHub action: ${ghAction}` }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // Serve Markdown files dynamically in a multi-project layout
    let projectId = null;
    let docId = null;

    // Serve Project selection/creation dashboard at root
    if (parsedUrl.pathname === '/') {
        const dashboardPath = path.join(__dirname, 'dashboard.html');
        fs.readFile(dashboardPath, 'utf8', (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error loading dashboard file');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    // Serve Git Panel
    const gitPanelMatch = parsedUrl.pathname.match(/^\/git\/([^/]+)$/);
    if (gitPanelMatch) {
        const filePath = path.join(__dirname, 'git_panel.html');
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error loading Git Panel file');
                return;
            }
            // Inject the project ID into the page
            const injected = data.replace('{{PROJECT_ID}}', gitPanelMatch[1]);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(injected);
        });
        return;
    }

    // Serve Git Panel index (redirect to first git project)
    if (parsedUrl.pathname === '/git' || parsedUrl.pathname === '/git/') {
        const projects = getProjects().filter(p => isGitProject(p));
        if (projects.length > 0) {
            res.writeHead(302, { 'Location': `/git/${projects[0]}` });
        } else {
            res.writeHead(302, { 'Location': '/' });
        }
        res.end();
        return;
    }


    if (parsedUrl.pathname === '/index.html' || parsedUrl.pathname === '/documentation.html') {
        res.writeHead(302, { 'Location': '/' });
        res.end();
        return;
    }
    if (parsedUrl.pathname.startsWith('/projects/autobots')) {
        const newPath = parsedUrl.pathname.replace('/projects/autobots', '/projects/asa-autobots');
        res.writeHead(302, { 'Location': newPath });
        res.end();
        return;
    }
    if (parsedUrl.pathname === '/design' || parsedUrl.pathname === '/design.html' || parsedUrl.pathname === '/js-design') {
        res.writeHead(302, { 'Location': '/projects/asa-autobots/2-design' });
        res.end();
        return;
    }
    if (parsedUrl.pathname.startsWith('/docs/')) {
        const parts = parsedUrl.pathname.split('/');
        let fileId = parts[2];
        if (fileId.endsWith('.md')) fileId = fileId.slice(0, -3);
        res.writeHead(302, { 'Location': `/projects/asa-autobots/${fileId}` });
        res.end();
        return;
    }

    // 2. Project routing
    if (parsedUrl.pathname.startsWith('/projects')) {
        const parts = parsedUrl.pathname.split('/');
        // /projects -> redirect to dashboard
        if (parts.length <= 2 || !parts[2]) {
            res.writeHead(302, { 'Location': '/' });
            res.end();
            return;
        }
        
        projectId = parts[2];
        const projectDir = getProjectDocsDir(projectId);
        if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end(`Project '${projectId}' not found`);
            return;
        }

        // /projects/:projectId -> redirect to first doc inside
        if (parts.length <= 3 || !parts[3]) {
            const files = fs.readdirSync(projectDir)
                .filter(f => f.endsWith('.md'))
                .sort((a, b) => a.localeCompare(b));
            if (files.length === 0) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end(`Project '${projectId}' has no documentation files`);
                return;
            }
            const firstDoc = files[0].slice(0, -3);
            res.writeHead(302, { 'Location': `/projects/${projectId}/${firstDoc}` });
            res.end();
            return;
        }

        docId = parts[3];
        if (docId.endsWith('.md')) docId = docId.slice(0, -3);

        if (docId === 'policy-builder') {
            const filePath = getProjectToolPath(projectId, 'policy_builder.html');
            if (fs.existsSync(filePath)) {
                fs.readFile(filePath, 'utf8', (err, data) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'text/plain' });
                        res.end('Error loading Policy Builder');
                        return;
                    }
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(data);
                });
                return;
            }
        }

        if (docId === 'map-creator') {
            const filePath = getProjectToolPath(projectId, 'map_creator.html');
            if (fs.existsSync(filePath)) {
                fs.readFile(filePath, 'utf8', (err, data) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'text/plain' });
                        res.end('Error loading Map Creator');
                        return;
                    }
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(data);
                });
                return;
            }
        }
    }

    if (projectId && docId) {
        const markdownPath = path.join(getProjectDocsDir(projectId), `${docId}.md`);
        if (!fs.existsSync(markdownPath)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end(`Document '${docId}' not found inside project '${projectId}'`);
            return;
        }

        // Dynamically watch project docs directory if not already watched
        watchProjectDocs(projectId);

        fs.readFile(markdownPath, 'utf8', (err, markdownContent) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error reading document file');
                return;
            }

            fs.readFile(TEMPLATE_FILE, 'utf8', (templateErr, templateContent) => {
                if (templateErr) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Error loading template file');
                    return;
                }

                // Compile markdown to HTML
                const cleanedMarkdown = deindentHtmlBlocks(markdownContent);
                const compiledHtml = marked.parse(cleanedMarkdown);
                const sidebarHtml = getSidebarHtml(projectId, docId);
                const projectSelectorHtml = getProjectSelectorHtml(projectId);
                
                // Format Project Name
                const projectName = projectId.replace(/-/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

                // Inject content and sidebar
                let finalContent = templateContent
                    .replace('{{CONTENT}}', () => compiledHtml)
                    .replace('{{SIDEBAR}}', () => sidebarHtml)
                    .replace('{{PROJECT_SELECTOR}}', () => projectSelectorHtml)
                    .replace('{{PROJECT_NAME}}', () => projectName);

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(finalContent);
            });
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

const activeWatchers = new Map();

function watchProjectDocs(projectId) {
    if (activeWatchers.has(projectId)) return;
    const projectDir = getProjectDir(projectId);
    if (!fs.existsSync(projectDir)) return;

    try {
        const watcher = fs.watch(projectDir, { recursive: true }, (eventType, filename) => {
            if (filename && (filename.endsWith('.md') || filename === 'policy_builder.html' || filename === 'map_creator.html')) {
                if (watchDebounce) return;
                watchDebounce = true;
                setTimeout(() => { watchDebounce = false; }, 200);
                broadcastReload(filename);
            }
        });
        activeWatchers.set(projectId, watcher);
        console.log(`[reload-server] Started watching docs/tools for project: ${projectId}`);
    } catch (err) {
        console.error(`[reload-error] Failed to watch project ${projectId}`, err);
    }
}

setupWatch(TEMPLATE_FILE, 'template.html');
setupWatch(COMMENTS_FILE, 'comments.json', () => ignoreCommentsWatch);
setupWatch(path.join(__dirname, 'git_panel.html'), 'git_panel.html');

function setupBidirectionalSync() {
    const dirA = path.join(__dirname, 'projects', 'asa-autobots');
    const dirB = path.join(WORKSPACE_DIR, 'asa-autobots');
    if (!fs.existsSync(dirA) || !fs.existsSync(dirB)) return;

    console.log(`[sync-service] Initializing bidirectional sync between collab-agent-team/projects/asa-autobots and asa-autobots...`);

    const syncPath = (relPath, sourceOfEvent) => {
        const base = path.basename(relPath);
        const isDocFolder = relPath.startsWith('docs' + path.sep) || relPath.startsWith('docs/');
        const allowedFiles = ['policy_builder.html', 'map_creator.html', 'system_spec.md'];
        const isAllowedFile = allowedFiles.includes(base);

        if (!isDocFolder && !isAllowedFile) {
            return; // Skip syncing other files (code, config, etc.)
        }
        
        const pathA = path.join(dirA, relPath);
        const pathB = path.join(dirB, relPath);
        
        try {
            const existsA = fs.existsSync(pathA);
            const existsB = fs.existsSync(pathB);

            // Handle deletion from A -> delete in B
            if (sourceOfEvent === 'A' && !existsA) {
                if (existsB) {
                    const stat = fs.statSync(pathB);
                    if (stat.isFile()) fs.unlinkSync(pathB);
                    else if (stat.isDirectory()) fs.rmSync(pathB, { recursive: true, force: true });
                    console.log(`[sync-service] Deleted in B (since deleted in A): ${relPath}`);
                }
                return;
            }

            // Handle deletion from B -> delete in A
            if (sourceOfEvent === 'B' && !existsB) {
                if (existsA) {
                    const stat = fs.statSync(pathA);
                    if (stat.isFile()) fs.unlinkSync(pathA);
                    else if (stat.isDirectory()) fs.rmSync(pathA, { recursive: true, force: true });
                    console.log(`[sync-service] Deleted in A (since deleted in B): ${relPath}`);
                }
                return;
            }

            if (existsA && !existsB) {
                const parent = path.dirname(pathB);
                if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
                fs.copyFileSync(pathA, pathB);
                const stat = fs.statSync(pathA);
                fs.utimesSync(pathB, stat.atime, stat.mtime);
                console.log(`[sync-service] Synced A -> B: ${relPath}`);
            } else if (existsB && !existsA) {
                const parent = path.dirname(pathA);
                if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
                fs.copyFileSync(pathB, pathA);
                const stat = fs.statSync(pathB);
                fs.utimesSync(pathA, stat.atime, stat.mtime);
                console.log(`[sync-service] Synced B -> A: ${relPath}`);
            } else if (existsA && existsB) {
                const statA = fs.statSync(pathA);
                const statB = fs.statSync(pathB);
                if (Math.abs(statA.size - statB.size) > 0 || Math.abs(statA.mtimeMs - statB.mtimeMs) > 1000) {
                    if (statA.mtimeMs > statB.mtimeMs) {
                        fs.copyFileSync(pathA, pathB);
                        fs.utimesSync(pathB, statA.atime, statA.mtime);
                        console.log(`[sync-service] Synced A -> B (newer A): ${relPath}`);
                    } else {
                        fs.copyFileSync(pathB, pathA);
                        fs.utimesSync(pathA, statB.atime, statB.mtime);
                        console.log(`[sync-service] Synced B -> A (newer B): ${relPath}`);
                    }
                }
            }
        } catch (err) {
            console.error(`[sync-error] Error syncing path ${relPath}:`, err);
        }
    };

    const walkAndSync = (dir, currentSub = '') => {
        const fullDir = path.join(dir, currentSub);
        if (!fs.existsSync(fullDir)) return;
        const entries = fs.readdirSync(fullDir, { withFileTypes: true });
        for (const entry of entries) {
            const rel = currentSub ? path.join(currentSub, entry.name) : entry.name;
            if (entry.isDirectory()) {
                if (entry.name !== 'node_modules' && entry.name !== '.git') {
                    walkAndSync(dir, rel);
                }
            } else {
                syncPath(rel);
            }
        }
    };

    try {
        walkAndSync(dirA);
        walkAndSync(dirB);
    } catch (err) {
        console.error(`[sync-error] Initial walk failed:`, err);
    }

    fs.watch(dirA, { recursive: true }, (eventType, filename) => {
        if (filename) syncPath(filename, 'A');
    });

    fs.watch(dirB, { recursive: true }, (eventType, filename) => {
        if (filename) syncPath(filename, 'B');
    });
}

try {
    setupBidirectionalSync();
} catch (e) {
    console.error("[sync-error] Failed starting bidirectional sync service:", e);
}

server.listen(PORT, () => {
    console.log(`[doc-server] Documentation server running at http://localhost:${PORT}`);
});
