<script src="https://cdn.rawgit.com/davidshimjs/qrcodejs/gh-pages/qrcode.min.js"></script>

<script>
    // 1. Variável global para não recriar o objeto toda hora
    let geradorQR = null;

    async function atualizarStatus() {
        const token = localStorage.getItem("tk");
        if(!token) return;

        try {
            const res = await fetch("/sync", { headers: {"Authorization": token} });
            const d = await res.json();
            
            const areaQR = document.getElementById("qrcode");
            const txtStatus = document.getElementById("st");

            if(d.status === "READY") {
                txtStatus.innerText = "CONECTADO ✅";
                areaQR.style.display = "none";
            } 
            else if(d.status && d.status.length > 50) {
                txtStatus.innerText = "ESCANEIE O QR CODE ⚠️";
                areaQR.style.display = "block";
                
                // LIMPA E RECRIA O QR CODE PARA NÃO ACUMULAR IMAGENS
                areaQR.innerHTML = ""; 
                new QRCode(areaQR, {
                    text: d.status,
                    width: 200,
                    height: 200
                });
            } else {
                txtStatus.innerText = "Iniciando WhatsApp...";
                areaQR.style.display = "none";
            }

            // Atualiza o chat
            const box = document.getElementById("chatBox");
            if(d.chats) {
                box.innerHTML = d.chats.map(c => `
                    <div class="${c.de==='IA'?'m-ia':'m-us'}">
                        <b>${c.de}:</b> ${c.txt}
                    </div>
                `).join('');
            }
        } catch (e) { console.log("Erro na sincronização"); }
    }

    // Aumentamos o intervalo para 5 segundos para dar tempo do Railway processar
    setInterval(atualizarStatus, 5000);
</script>
