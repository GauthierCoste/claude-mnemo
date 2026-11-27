/**
 * `setupFiles` de l'interface : les tests lisent les textes français. La langue montrée suit `navigator.language` tant que
 * le réglage n'est pas lu ; happy-dom annonce « en-US », on annonce donc le français.
 */
if (typeof navigator !== 'undefined') Object.defineProperty(navigator, 'language', { value: 'fr-FR', configurable: true });
