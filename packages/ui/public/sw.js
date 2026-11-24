// Service worker de Mnemo. Il ne sert qu'à rendre l'interface installable (« Installer Mnemo » : fenêtre propre, icône du
// Dock) : il ne garde rien, ni l'interface, ni l'API, ni les données. Seules les navigations passent par lui, telles quelles
// (le service répond, ou le navigateur affiche son erreur) ; l'API, le WebSocket et les fichiers ne le traversent pas.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (evenement) => evenement.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (evenement) => {
	if (evenement.request.mode !== 'navigate') return;
	evenement.respondWith(fetch(evenement.request));
});
