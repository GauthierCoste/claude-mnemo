// Masquage des secrets avant indexation. Pur, sans module `node:`. Toutes les expressions sont linéaires :
// classes de caractères bornées ou à fin déterministe, aucune alternance imbriquée, aucun balayage « jusqu’à la fin ».

export const MARQUE_SECRET = '[secret masqué]';

/** Plage `[debut, fin[` du texte d’origine remplacée par `MARQUE_SECRET`. */
export type Remplacement = { debut: number; fin: number };

const MOTIFS_JETONS: RegExp[] = [
	/\bsk-[A-Za-z0-9_-]{20,}/gu,
	/\bgh[pousr]_[A-Za-z0-9]{30,}/gu,
	/\bgithub_pat_[A-Za-z0-9_]{20,}/gu,
	/\bxox[bp]-[A-Za-z0-9-]{10,}/gu,
	/\bAKIA[0-9A-Z]{16}\b/gu,
	/\bAIza[0-9A-Za-z_-]{35}/gu,
	/\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}/gu,
	/\bBearer[ \t]+[A-Za-z0-9._~+/-]{20,}=*/gu,
];

// Un jeton candidat : suite de caractères de jeton (linéaire) ; le JWT est vérifié ensuite, en code.
const MOTIF_CANDIDAT_JWT = /eyJ[A-Za-z0-9_.-]*/gu;

const ESPACES = '[ \\t\\u00a0\\u202f]';
// Mot-clé (précédé et suivi d’une non-alphanumérique ou de `_`), guillemet facultatif, `:` ou `=` (espaces fines
// typographiques françaises admises), puis la valeur jusqu’à la fin de la ligne.
const MOTIF_MOT_CLE = new RegExp(
	`(?<![A-Za-z0-9])(?:password|mot de passe|passwd|token|secret|api[_-]?key)(?:_[A-Za-z0-9_]{0,30})?(?![A-Za-z0-9])["']?${ESPACES}{0,3}[:=]${ESPACES}{0,3}([^\\n]*)`,
	'giu',
);
// Cellule de tableau : `| password | valeur |`.
const MOTIF_CELLULE = new RegExp(
	`(?<![A-Za-z0-9])(?:password|mot de passe|passwd|token|secret|api[_-]?key)(?:_[A-Za-z0-9_]{0,30})?(?![A-Za-z0-9])${ESPACES}{0,3}\\|${ESPACES}{0,3}([^|\\n]*)`,
	'giu',
);

const DEBUT_PEM = /-----BEGIN [A-Z ]{0,30}PRIVATE KEY(?: BLOCK)?-----/gu;
const FIN_PEM = /-----END [A-Z ]{0,30}PRIVATE KEY(?: BLOCK)?-----/gu;
const LIGNE_VIDE = /\n[ \t\r]*\n/gu;

/**
 * Une valeur est un secret si, une fois ôtés espaces et guillemets, elle compte au moins 6 caractères non blancs et
 * n’est pas une phrase : une valeur faite uniquement de lettres et d’espaces, avec un espace à l’intérieur
 * (« à définir », « oublié, à renouveler »), n’en est pas un. Un mot seul, ou toute valeur portant un chiffre ou un
 * symbole, en est un. La marque `[secret masqué]` elle-même n'en est pas un.
 */
function valeurSecrete(valeur: string): boolean {
	const v = valeur.trim().replace(/^["'`]+|["'`,;]+$/gu, '').trim();
	// Déjà masquée (métadonnée masquée une première fois) : ni remasquée, ni comptée deux fois.
	if (v === MARQUE_SECRET) return false;
	if ([...v.replace(/\s/gu, '')].length < 6) return false;
	return !/^[\p{L} ]+$/u.test(v) || !v.includes(' ');
}

function pem(texte: string): Remplacement[] {
	const plages: Remplacement[] = [];
	const debuts = new RegExp(DEBUT_PEM.source, 'gu');
	const fins = new RegExp(FIN_PEM.source, 'gu');
	let position = 0;
	let sansFin = false;
	for (;;) {
		debuts.lastIndex = position;
		const debut = debuts.exec(texte);
		if (debut === null) return plages;
		// Chaque balayage avance : sans fin trouvée, plus aucune clé ne peut se refermer (linéaire).
		fins.lastIndex = debut.index + debut[0].length;
		const fin: RegExpExecArray | null = sansFin ? null : fins.exec(texte);
		if (fin === null) sansFin = true;
		if (fin !== null) {
			position = fin.index + fin[0].length;
			plages.push({ debut: debut.index, fin: position });
			continue;
		}
		// Clé tronquée : masquée jusqu’à la prochaine ligne vide, ou jusqu’à la fin du document.
		const vide = new RegExp(LIGNE_VIDE.source, 'gu');
		vide.lastIndex = debut.index + debut[0].length;
		const v = vide.exec(texte);
		plages.push({ debut: debut.index, fin: v === null ? texte.length : v.index });
		if (v === null) return plages;
		position = v.index;
	}
}

function jwt(texte: string): Remplacement[] {
	const plages: Remplacement[] = [];
	for (const m of texte.matchAll(MOTIF_CANDIDAT_JWT)) {
		if (m.index > 0 && /[A-Za-z0-9]/u.test(texte[m.index - 1]!)) continue;
		const jeton = m[0].replace(/\.+$/u, '');
		const parties = jeton.split('.');
		if (parties.length === 3 && parties.every((p) => p.length >= 5)) plages.push({ debut: m.index, fin: m.index + jeton.length });
	}
	return plages;
}

/** Plages à masquer, triées et fusionnées. */
export function plagesSecretes(texte: string): Remplacement[] {
	const plages = [...pem(texte), ...jwt(texte)];
	for (const motif of MOTIFS_JETONS) {
		for (const m of texte.matchAll(motif)) plages.push({ debut: m.index, fin: m.index + m[0].length });
	}
	for (const m of [...texte.matchAll(MOTIF_MOT_CLE), ...texte.matchAll(MOTIF_CELLULE)]) {
		const valeur = m[1]!;
		if (!valeurSecrete(valeur)) continue;
		const debut = m.index + m[0].length - valeur.length;
		plages.push({ debut, fin: debut + valeur.trimEnd().length });
	}
	plages.sort((a, b) => a.debut - b.debut || b.fin - a.fin);
	const fusion: Remplacement[] = [];
	for (const p of plages) {
		const dernier = fusion[fusion.length - 1];
		if (dernier !== undefined && p.debut <= dernier.fin) dernier.fin = Math.max(dernier.fin, p.fin);
		else fusion.push({ ...p });
	}
	return fusion;
}

/** Remplace chaque secret reconnu par `[secret masqué]` ; `masques` est le nombre de remplacements. */
export function masquerSecrets(texte: string): { texte: string; masques: number } {
	const { texte: masque, remplacements } = masquerAvecPlages(texte);
	return { texte: masque, masques: remplacements.length };
}

/** Comme `masquerSecrets`, avec les plages d’origine remplacées (pour recaler des positions). */
export function masquerAvecPlages(texte: string): { texte: string; remplacements: Remplacement[] } {
	const remplacements = plagesSecretes(texte);
	let sortie = '';
	let curseur = 0;
	for (const r of remplacements) {
		sortie += texte.slice(curseur, r.debut) + MARQUE_SECRET;
		curseur = r.fin;
	}
	return { texte: sortie + texte.slice(curseur), remplacements };
}

/** Position dans le texte masqué d’une position du texte d’origine (début de la marque si elle tombe dans un secret). */
export function positionMasquee(position: number, remplacements: Remplacement[]): number {
	let decalage = 0;
	for (const r of remplacements) {
		if (r.debut >= position) break;
		if (position < r.fin) return r.debut + decalage;
		decalage += MARQUE_SECRET.length - (r.fin - r.debut);
	}
	return position + decalage;
}
