delay));
  }

  if (disparo.status !== 'cancelado') disparo.status = 'finalizado';
}

// /progresso — estado atual do disparo
app.get('/progresso', autenticar, (req, res) => {
  return res.json({
    status:  disparo.status,
    atual:   disparo.atual,
    total:   disparo.total,
    pausado: disparo.pausado,
  });
});

// /logs-envio — logs do disparo atual
app.get('/logs-envio', autenticar, (req, res) => {
  return res.json(disparo.logs.slice(-100));
});

// /pausar — alterna pause/retomar
app.post('/pausar', autenticar, (req, res) => {
  disparo.pausado = !disparo.pausado;
  return res.json({ pausado: disparo.pausado });
});

// /cancelar — cancela disparo em andamento
app.post('/cancelar', autenticar, (req, res) => {
  disparo.status  = 'cancelado';
  disparo.pausado = false;
  return res.json({ ok: true });
});

// /chats — mensagens recebidas e enviadas em memória
app.get('/chats', autenticar, (req, res) => {
  return res.json(chatsMemoria.slice(-100));
});

// /stats — estatísticas do último disparo
app.get('/stats', autenticar, (req, res) => {
  return res.json(disparo.stats);
});

// ─────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Money Partner Pro 2026 rodando na porta ${PORT}`);
});
