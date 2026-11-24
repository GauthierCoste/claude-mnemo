// Courriels : nettoyage des messages (citations, signatures) et regroupement en fils. Pur, sans `node:`.

import { empreinte } from './empreinte.ts';
/** Un message nettoyé, tel que rangé dans un fil. */
export type MessageDeFil = { de: string | null; date: string | null; sujet: string | null; texte: string };
export type MessageAvecIdentifiants = MessageDeFil & { id: string | null; reponseA: string[] };

const ENTETE_REPONSE = /^(le|on)\s.+\s(a écrit|a ecrit|wrote)\s*:\s*$/i;
const MESSAGE_ORIGINE = /^-{2,}\s*(original message|message d['’]origine|message transféré|forwarded message)\s*-{2,}$/i;
const OUTLOOK_DEBUT = /^(de|from)\s*:\s*\S/i;
const OUTLOOK_RUBRIQUES = [/^(envoyé|envoye|sent|date)\s*:/i, /^(à|a|to)\s*:/i, /^(objet|subject)\s*:/i];
const FORMULES = /^(cordialement|bien cordialement|très cordialement|bien à vous|bien a vous|bonne journée|bonne soirée|bonne fin de journée|amicalement|bien amicalement|best regards|kind regards|regards)\s*[,.!]*\s*$/i;
const DERNIERES_LIGNES = 6;
const MOTS_DATE = new Set(
	('janvier janv jan février fevrier févr fevr février feb february mars mar march avril avr apr april mai may juin jun june juillet juil jul july août aout aug august septembre sept sep september octobre oct october novembre nov november décembre decembre déc dec december ' +
		'lundi mardi mercredi jeudi vendredi samedi dimanche mon monday tue tuesday wed wednesday thu thursday fri friday sat saturday sun sunday').split(' '),
);

// Un en-tête « Le … a écrit : » doit contenir une date ou une adresse (sinon « Le client nous a écrit : » serait coupé).
function contientDateOuAdresse(texte: string): boolean {
	if (/[\d@<]/.test(texte)) return true;
	return (texte.toLowerCase().match(/[\p{L}]+/gu) ?? []).some((m) => MOTS_DATE.has(m));
}

function estEnteteReponse(lignes: string[], i: number): boolean {
	// L'en-tête peut être replié sur 2 ou 3 lignes.
	for (let n = 1; n <= 3 && i + n <= lignes.length; n++) {
		const bloc = lignes.slice(i, i + n).map((l) => l.trim());
		if (bloc.some((l) => l === '')) return false;
		const joint = bloc.join(' ');
		if (ENTETE_REPONSE.test(joint) && contientDateOuAdresse(joint)) return true;
	}
	return false;
}

function estEnteteOutlook(lignes: string[], i: number): boolean {
	if (!OUTLOOK_DEBUT.test(lignes[i]!.trim())) return false;
	const suite = lignes.slice(i + 1, i + 5).map((l) => l.trim());
	return OUTLOOK_RUBRIQUES.filter((r) => suite.some((l) => r.test(l))).length >= 2;
}

function estSignature(lignes: string[], i: number): boolean {
	return lignes[i] === '-- ';
}

const DEBUT_ARTICLE = /^(le|la|les|l['’]|un|une|des|du|de|à|au|aux|et|pour|avec)(\s|['’]|$)/i;

// Ligne de nom, de fonction, de téléphone, de courriel ou d'adresse web ; tout le reste est du contenu.
function estLigneDeSignature(l: string): boolean {
	const t = l.trim();
	if (/^\+?[\d][\d\s.()-]{6,}$/.test(t) || /^\S+@\S+$/.test(t) || /^(https?:\/\/|www\.)\S+$/i.test(t)) return true;
	if (t.split(/\s+/).length > 4 || !/^\p{Lu}/u.test(t) || /[€$%\d]/.test(t) || DEBUT_ARTICLE.test(t)) return false;
	return !/[!?;:]/.test(t) && !/[.]$/.test(t);
}

/** Retire du corps d'un message le texte cité, l'historique de réponse, la signature et la formule de politesse finale. */
export function nettoyerMessage(texte: string): string {
	let lignes = texte.replace(/\r\n?/g, '\n').split('\n');
	let coupe = lignes.length;
	for (let i = 0; i < lignes.length; i++) {
		if (estSignature(lignes, i) || MESSAGE_ORIGINE.test(lignes[i]!.trim()) || estEnteteReponse(lignes, i) || estEnteteOutlook(lignes, i)) {
			coupe = i;
			break;
		}
	}
	lignes = lignes.slice(0, coupe).filter((l) => !/^\s*>/.test(l));
	while (lignes.length > 0 && lignes[lignes.length - 1]!.trim() === '') lignes.pop();
	for (let i = Math.max(0, lignes.length - DERNIERES_LIGNES); i < lignes.length; i++) {
		if (!FORMULES.test(lignes[i]!.trim())) continue;
		const apres = lignes.slice(i + 1).filter((l) => l.trim() !== '');
		if (apres.length <= 3 && apres.every(estLigneDeSignature)) {
			lignes = lignes.slice(0, i);
			break;
		}
	}
	return lignes
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function avant(messages: MessageDeFil[], i: number, j: number): boolean {
	const ti = horodatage(messages[i]!.date);
	const tj = horodatage(messages[j]!.date);
	if (Number.isNaN(ti) || Number.isNaN(tj)) return Number.isNaN(tj) && !Number.isNaN(ti);
	return ti < tj;
}

/** Sujet normalisé : sans préfixes `Re:`/`TR:`/`Fwd:`/`Fw:` répétés, casse et espaces ignorés. */
export function sujetNormalise(sujet: string | null): string {
	let s = (sujet ?? '').trim();
	for (;;) {
		const suivant = s.replace(/^(re|tr|fwd?|rép|réf)\s*:\s*/i, '');
		if (suivant === s) break;
		s = suivant;
	}
	return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Instant d'une date d'en-tête (ms), NaN si illisible ou absente. */
export function horodatage(date: string | null): number {
	if (date === null) return Number.NaN;
	return Date.parse(date);
}

/**
 * Regroupe les messages en fils : d'abord par `Message-ID`/`In-Reply-To`/`References`, puis, pour les messages
 * sans lien d'identifiant, par sujet normalisé. Chaque fil est trié par date (dates illisibles à la fin, ordre stable) ;
 * les messages sont rendus tels quels (mêmes objets) ; les fils sont rendus dans l'ordre de leur premier message en entrée.
 */
export function filsDe<T extends MessageAvecIdentifiants>(entree: T[]): T[][] {
	// Un même Message-ID présent plusieurs fois (copies) : on garde la première.
	const vus = new Set<string>();
	const messages = entree.filter((m) => {
		if (m.id === null || m.id === '') return true;
		if (vus.has(m.id)) return false;
		vus.add(m.id);
		return true;
	});
	const parent = messages.map((_, i) => i);
	const racine = (i: number): number => {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]!]!;
			i = parent[i]!;
		}
		return i;
	};
	const unir = (a: number, b: number) => {
		const ra = racine(a);
		const rb = racine(b);
		if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
	};
	const parCle = new Map<string, number>();
	const lie = new Set<number>();
	messages.forEach((m, i) => {
		for (const cle of [m.id, ...m.reponseA]) {
			if (cle === null || cle === '') continue;
			const deja = parCle.get(cle);
			if (deja === undefined) parCle.set(cle, i);
			else {
				unir(deja, i);
				lie.add(deja);
				lie.add(i);
			}
		}
	});
	// Repli par sujet : un message sans lien d'identifiant se rattache à un seul fil, celui du plus ancien message de même sujet.
	// Deux fils déjà liés ne sont jamais réunis par le sujet.
	const plusAncien = new Map<string, number>();
	messages.forEach((m, i) => {
		const sujet = sujetNormalise(m.sujet);
		if (sujet === '') return;
		const autre = plusAncien.get(sujet);
		if (autre === undefined || avant(messages, i, autre)) plusAncien.set(sujet, i);
	});
	messages.forEach((m, i) => {
		if (lie.has(i)) return;
		const cible = plusAncien.get(sujetNormalise(m.sujet));
		if (cible !== undefined && cible !== i) unir(cible, i);
	});
	const groupes = new Map<number, number[]>();
	messages.forEach((_, i) => {
		const r = racine(i);
		groupes.set(r, [...(groupes.get(r) ?? []), i]);
	});
	return [...groupes.values()]
		.map((indices) =>
			[...indices]
				.sort((a, b) => {
					const ta = horodatage(messages[a]!.date);
					const tb = horodatage(messages[b]!.date);
					if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.isNaN(ta) === Number.isNaN(tb) ? a - b : Number.isNaN(ta) ? 1 : -1;
					return ta - tb || a - b;
				})
				.map((i) => messages[i]!),
		);
}

/**
 * Clé stable d'un fil (triés par date, comme `filsDe` les rend) : le `Message-ID` de son premier message, sinon une empreinte
 * du sujet normalisé et de la date de ce message. Un fil qui grandit (réponses) garde sa clé ; son rang dans le fichier,
 * lui, peut changer quand des fils s'ajoutent.
 */
export function cleDeFil(fil: MessageAvecIdentifiants[]): string {
	const premier = fil[0];
	if (premier === undefined) return 'fil-vide';
	if (premier.id !== null && premier.id !== '') return premier.id;
	return `sujet-${empreinte(`${sujetNormalise(premier.sujet)}|${premier.date ?? ''}`)}`;
}

/** Clés des fils, rendues uniques (une clé répétée reçoit « ~2 », « ~3 »… dans l'ordre). */
export function clesDeFils(fils: MessageAvecIdentifiants[][]): string[] {
	const vues = new Map<string, number>();
	return fils.map((fil) => {
		const cle = cleDeFil(fil);
		const n = (vues.get(cle) ?? 0) + 1;
		vues.set(cle, n);
		return n === 1 ? cle : `${cle}~${n}`;
	});
}

/** Un `## <date> — <auteur>` par message, suivi du texte nettoyé. */
export function markdownDuFil(fil: MessageDeFil[]): string {
	return fil.map((m) => `## ${m.date ?? 'date inconnue'} — ${m.de ?? 'auteur inconnu'}\n\n${m.texte}`.trimEnd()).join('\n\n');
}
