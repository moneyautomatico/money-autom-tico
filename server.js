async function engineWA(userId) {
    if (clientes[userId]) return;

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: {
            headless: "new",
            // O segredo está nestes argumentos abaixo:
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Usa o disco em vez da RAM (Evita travar)
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        }
    });

    client.on('qr', qr => {
        console.log("📢 QR Code gerado com sucesso!");
        qrcodes[userId] = qr;
    });

    client.on('ready', () => {
        console.log("✅ WhatsApp Conectado!");
        qrcodes[userId] = "READY";
    });

    clientes[userId] = client;
    client.initialize().catch(e => console.log("Erro ao abrir Chrome:", e));
}
