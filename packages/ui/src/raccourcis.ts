/**
 * Raccourcis de l'interface, lus par `event.code` (⌥ change la lettre produite sous macOS) : ⌥1…⌥9 session n, ⌥0 grille,
 * ⌥A archiviste, ⌥⇧A archiviste en grand (ou réduit), ⌥M première fiche servie, ⌥L localiser la fiche ouverte (vue Mémoire), ⌘K palette (Ctrl+K
 * aussi, sauf sous macOS où il va à `claude` : effacer jusqu'à la fin de la ligne), Échap hors terminal (dans un terminal,
 * Échap va à `claude`), ⌥, réglages (⌘, reste au navigateur, qui y met ses propres réglages). Dans un arbre qui a le focus : ⌘- tout replier, ⌘+ / ⌘= tout déplier (`pliageArbre`).
 * Les raccourcis ⌥ ne valent pas dans un champ de saisie ni dans un terminal : sur un Mac AZERTY, ⌥( écrit `{`, ⌥7 `«`, ⌥, `…`.
 */

type Plateforme = { platform?: string; userAgentData?: { platform?: string } };

/** Vrai sous macOS (ou iPadOS) : `userAgentData.platform` quand le navigateur le donne, sinon `navigator.platform`. */
export function plateformeMac(n: Plateforme | undefined = globalThis.navigator as Plateforme | undefined): boolean {
	const nom = n?.userAgentData?.platform || n?.platform || '';
	return /^(mac|iphone|ipad|ipod)/i.test(nom);
}

/** Touche de commande des raccourcis ⌘K, ⌘-, ⌘+ : son libellé affiché et son nom pour `aria-keyshortcuts`. */
export function toucheCommande(mac: boolean = plateformeMac()): { libelle: string; aria: string } {
	return mac ? { libelle: '⌘', aria: 'Meta' } : { libelle: 'Ctrl+', aria: 'Control' };
}

/**
 * Libellé affiché d'un raccourci avec Alt (les raccourcis ⌥ de l'en-tête) : `⌥A`, `⌥⇧A` sous macOS ; ailleurs `Alt+A`,
 * `Alt+Maj+A`. `aria-keyshortcuts` dit déjà `Alt+…` partout.
 */
export function raccourciAlt(touche: string, o: { maj?: boolean; mac?: boolean } = {}): string {
	const mac = o.mac ?? plateformeMac();
	return mac ? `⌥${o.maj === true ? '⇧' : ''}${touche}` : `Alt+${o.maj === true ? 'Maj+' : ''}${touche}`;
}

export type Action =
	| { genre: 'session'; rang: number }
	| { genre: 'grille' }
	| { genre: 'archiviste' }
	| { genre: 'archiviste_grand' }
	| { genre: 'fiche_servie' }
	| { genre: 'localiser' }
	| { genre: 'palette' }
	| { genre: 'reglages' }
	| { genre: 'echap' };

export type Origine = 'terminal' | 'champ' | 'page';

const SELECTEUR_CHAMP = 'textarea, select, [contenteditable]:not([contenteditable="false"])';
const TYPES_INPUT_TEXTE = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/** Le champ caché d'xterm est un `textarea` : `.xterm` est testé avant les champs. */
export function origineDeLaTouche(cible: EventTarget | null): Origine {
	if (!(cible instanceof Element)) return 'page';
	if (cible.closest('.xterm')) return 'terminal';
	if (cible instanceof HTMLInputElement) return TYPES_INPUT_TEXTE.has(cible.type) ? 'champ' : 'page';
	if (cible.closest(SELECTEUR_CHAMP)) return 'champ';
	return 'page';
}

export function actionDuRaccourci(
	e: Pick<KeyboardEvent, 'code' | 'key' | 'altKey' | 'metaKey' | 'ctrlKey'> & { shiftKey?: boolean },
	contexte: { origine: Origine; /** Par défaut, détecté (`plateformeMac`). */ mac?: boolean },
): Action | null {
	const aucun = !e.altKey && !e.metaKey && !e.ctrlKey;
	if (e.code === 'Escape' || e.key === 'Escape') return aucun && contexte.origine !== 'terminal' ? { genre: 'echap' } : null;
	const mac = contexte.mac ?? plateformeMac();
	if ((e.metaKey || (e.ctrlKey && !mac)) && !e.altKey && e.code === 'KeyK') return { genre: 'palette' };
	if (!e.altKey || e.metaKey || e.ctrlKey || contexte.origine !== 'page') return null;
	const chiffre = /^Digit([0-9])$/.exec(e.code);
	if (chiffre) {
		const rang = Number(chiffre[1]);
		return rang === 0 ? { genre: 'grille' } : { genre: 'session', rang };
	}
	if (e.code === 'KeyA') return e.shiftKey ? { genre: 'archiviste_grand' } : { genre: 'archiviste' };
	if (e.code === 'KeyM') return { genre: 'fiche_servie' };
	if (e.code === 'Comma') return { genre: 'reglages' };
	if (e.code === 'KeyL') return { genre: 'localiser' };
	return null;
}

/**
 * Pliage d'un arbre qui a le focus : ⌘- (Ctrl aussi hors macOS) replie tout, ⌘+ ou ⌘= déplie tout. Lu par le caractère (claviers
 * où « - » et « = » ne sont pas sur les touches `Minus` et `Equal`), sinon par la touche. Seul l'arbre l'appelle : hors de
 * lui, ces touches restent au navigateur (zoom).
 */
export function pliageArbre(e: Pick<KeyboardEvent, 'code' | 'key' | 'altKey' | 'metaKey' | 'ctrlKey'>, contexte: { mac?: boolean } = {}): 'replier' | 'deplier' | null {
	const mac = contexte.mac ?? plateformeMac();
	const modificateur = (e.metaKey && !e.ctrlKey) || (!mac && e.ctrlKey && !e.metaKey);
	if (e.altKey || !modificateur) return null;
	if (e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract') return 'replier';
	if (e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd') return 'deplier';
	return null;
}
