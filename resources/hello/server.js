sixm.on('playerConnected', (p) => {
  console.log(`${p.name} (#${p.id}) a rejoint`);
  sixm.emitAllClients('chat', `${p.name} a rejoint le serveur`);
});
sixm.on('playerDropped', (p) => sixm.emitAllClients('chat', `${p.name} est parti`));
sixm.onNet('chat', (p, text) => {
  if (typeof text === 'string') sixm.emitAllClients('chat', `${p.name}: ${text.slice(0, 200)}`);
});
