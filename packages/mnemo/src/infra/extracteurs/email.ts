import PostalMime from 'postal-mime';
import type { Email } from 'postal-mime';
import { lireEntier, lirePlage, morceaux } from '../../application/contenu.ts';
import { tailleLisible } from '@mnemo/commun';
import { ErreurExtraction, TEXTE_MAX_DOCUMENT } from '../../application/ports.ts';
import type { Contenu, DocumentExtrait, Extracteur, PieceJointe, ReperePiece } from '../../application/ports.ts';
import { ECHANTILLON_NATURE } from '@mnemo/commun';
import { estCherchable, RAISON_NON_CHERCHABLE } from '../../domaine/source.ts';
import { clesDeFils, filsDe, horodatage, markdownDuFil, nettoyerMessage } from '../../domaine/emails.ts';
import type { MessageAvecIdentifiants, MessageDeFil } from '../../domaine/emails.ts';
import { htmlVersMarkdown, metadonnee, nomDuFichier } from './commun.ts';
import { TAILLE_MAX_PDF } from './pdf.ts';

/**
 * Taille maximale d'un courriel : un `.eml`, ou un message d'une boîte `.mbox`. postal-mime lit le message entier en
 * mémoire (et décode ses pièces jointes) : au-delà, un `.eml` est refusé et un message de boîte est écarté (avertissement).
 * La boîte elle-même n'a pas d'autre limite que `TAILLE_MAX_DOCUMENT` : elle est lue message par message.
 */
export const TAILLE_MAX_MESSAGE = 256 * 1024 * 1024;
/**
 * Pièce jointe gardée pour l'extraction, au plus : alignée sur la plus haute limite des formats extraits (PDF), chaque
 * format appliquant ensuite la sienne. Au-delà, la pièce est seulement nommée (`ecartee`).
 */
export const TAILLE_MAX_PIECE = TAILLE_MAX_PDF;
/**
 * Texte des messages d'une boîte gardé pour reconstituer ses fils, au plus (caractères) : deux fois `TEXTE_MAX_DOCUMENT`.
 * Au-delà, le texte des messages suivants est coupé (avertissement) ; leurs fils, sujets et dates restent.
 */
export const TEXTE_MAX_BOITE = 2 * TEXTE_MAX_DOCUMENT;

type Lu = { message: MessageAvecIdentifiants; pieces: PieceJointe[] };

/** Extension d'une pièce jointe sans nom, tirée de son type MIME (formats lisibles seulement), sinon aucune. */
const EXTENSIONS_MIME: Record<string, string> = {
	'application/pdf': '.pdf',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
	'text/plain': '.txt',
	'text/markdown': '.md',
	'message/rfc822': '.eml',
};

/** Ligne de séparation d'un `.mbox` (sans sa fin de ligne). */
const SEPARATEUR = /^From \S+ +(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),? +)(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +\d{1,2} +\d{1,2}:\d{2}(?::\d{2})?(?: +(?:[A-Z]{2,5}|[+-]\d{4}))? +\d{4}[ \t]*$/;
/** Une ligne de séparation est courte : au-delà, ce n'en est pas une (seule sa tête est gardée pendant la lecture). */
const TETE_MAX = 512;

/** Plage d'octets d'un message dans sa boîte : de la ligne qui suit son séparateur au séparateur suivant (exclu). */
export type PlageMessage = { debut: number; fin: number };

/**
 * Plages des messages d'un `.mbox` (mboxrd), lu morceau par morceau : un séparateur est une ligne `From ` en tête de fichier ou
 * après une ligne vide. La boîte n'est jamais chargée en entier : seule la tête de la ligne courante est gardée.
 */
export async function* plagesMbox(contenu: Contenu): AsyncGenerator<PlageMessage> {
	const tete = new Uint8Array(TETE_MAX + 1);
	let teteLongueur = 0;
	let ligneLongueur = 0;
	let ligneDebut = 0;
	let precedenteVide = false;
	let courant: number | null = null;
	const plages: PlageMessage[] = [];
	const finDeLigne = (suivante: number): void => {
		const vide = ligneLongueur === 0 || (ligneLongueur === 1 && tete[0] === 13);
		if ((ligneDebut === 0 || precedenteVide) && ligneLongueur <= TETE_MAX && tete[0] === 0x46) {
			const ligne = Buffer.from(tete.buffer, 0, teteLongueur).toString('latin1').replace(/\r$/, '');
			if (SEPARATEUR.test(ligne)) {
				if (courant !== null) plages.push({ debut: courant, fin: ligneDebut });
				courant = suivante;
			}
		}
		precedenteVide = vide;
		ligneDebut = suivante;
		teteLongueur = 0;
		ligneLongueur = 0;
	};
	let position = 0;
	for await (const m of morceaux(contenu)) {
		let i = 0;
		while (i < m.length) {
			const nl = m.indexOf(10, i);
			const fin = nl === -1 ? m.length : nl;
			const copie = Math.min(fin - i, TETE_MAX + 1 - teteLongueur);
			if (copie > 0) {
				tete.set(m.subarray(i, i + copie), teteLongueur);
				teteLongueur += copie;
			}
			ligneLongueur += fin - i;
			if (nl === -1) break;
			finDeLigne(position + nl + 1);
			i = nl + 1;
		}
		position += m.length;
		yield* plages.splice(0);
	}
	if (ligneLongueur > 0) finDeLigne(position);
	yield* plages.splice(0);
	if (courant !== null) yield { debut: courant, fin: position };
}

/** Octets d'un message de boîte, « >From » rétabli en « From » (mboxrd). */
export async function lireMessage(contenu: Contenu, plage: PlageMessage): Promise<Uint8Array> {
	return retablirFrom(await lirePlage(contenu, plage.debut, plage.fin));
}

/** « From » suivi d'une espace, en octets. */
const FROM = [0x46, 0x72, 0x6f, 0x6d, 0x20];

/**
 * « >From » rétabli en « From » en tête de ligne (mboxrd : un `>` de moins devant `>*From `), sur les octets. Le message
 * n'est jamais copié en chaîne : une chaîne de sa taille vivrait dans le tas du fil d'extraction, borné, et l'y ferait
 * déborder d'un coup (un message de 54 Mo dans un tas de 64 Mo), ce que le fil ne sait pas toujours contenir (le processus
 * entier tombait). Rien à rétablir : les octets rendus tels quels, sans copie.
 */
export function retablirFrom(brut: Uint8Array): Uint8Array {
	const retires: number[] = [];
	for (let p = brut.indexOf(0x3e); p !== -1; p = brut.indexOf(0x3e, p + 1)) {
		// en tête de ligne : début du message, ou après \n ou \r (comme `^` en mode multiligne)
		if (p > 0 && brut[p - 1] !== 0x0a && brut[p - 1] !== 0x0d) continue;
		let j = p + 1;
		while (brut[j] === 0x3e) j++;
		if (FROM.every((octet, k) => brut[j + k] === octet)) retires.push(p);
		p = j - 1;
	}
	if (retires.length === 0) return brut;
	const sortie = new Uint8Array(brut.byteLength - retires.length);
	let lu = 0;
	let ecrit = 0;
	for (const p of retires) {
		sortie.set(brut.subarray(lu, p), ecrit);
		ecrit += p - lu;
		lu = p + 1;
	}
	sortie.set(brut.subarray(lu), ecrit);
	return sortie;
}

function adresse(email: Email): string | null {
	const { name, address } = email.from ?? {};
	if (name && address) return metadonnee(`${name} <${address}>`);
	return metadonnee(address ?? name);
}

function dateIso(valeur: string | undefined): string | null {
	if (!valeur) return null;
	const t = Date.parse(valeur);
	return Number.isNaN(t) ? null : new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Nom de pièce jointe sûr : dernier segment, sans `..` ni caractères de contrôle, sur une ligne, borné.
function nomSur(valeur: string | null | undefined): string | null {
	const segment = (valeur ?? '').split(/[\\/]/).pop() ?? '';
	if (/^[.\s]*$/.test(segment)) return null;
	return metadonnee(segment.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\.{2,}/g, '.'));
}

function identifiants(valeur: string | undefined): string[] {
	return valeur?.match(/<[^<>\s]+>/g) ?? [];
}

/** Pourquoi une pièce ne sera pas extraite, ou null : décidé au balayage, sur son contenu décodé ; seul ce verdict est rangé. */
function raisonDEcart(nom: string, contenu: ArrayBuffer, pieceMax: number): string | null {
	if (contenu.byteLength > pieceMax) return `plus de ${tailleLisible(pieceMax)}`;
	const echantillon = new Uint8Array(contenu, 0, Math.min(ECHANTILLON_NATURE, contenu.byteLength));
	return estCherchable(nom, echantillon) ? null : RAISON_NON_CHERCHABLE;
}

/**
 * Lit un message : texte nettoyé et métadonnées ; ses pièces jointes ne sont que nommées, mesurées et repérées (`plage` : les
 * octets du message dans son fichier) ; leur contenu est relu à la demande (`relire`), une pièce à la fois.
 */
async function lire(brut: Uint8Array, plage: PlageMessage, relire: (repere: ReperePiece) => Promise<Uint8Array>, pieceMax: number): Promise<Lu> {
	const email = await PostalMime.parse(brut, { attachmentEncoding: 'arraybuffer' });
	const corpsTexte = email.text?.trim() ?? '';
	const corps = corpsTexte !== '' ? corpsTexte : email.html ? htmlVersMarkdown(email.html) : '';
	const pieces: PieceJointe[] = [];
	for (const [rang, p] of email.attachments.entries()) {
		const contenu = p.content as ArrayBuffer;
		const taille = contenu.byteLength;
		const nom = nomSur(p.filename) ?? `piece-jointe-${rang + 1}${EXTENSIONS_MIME[p.mimeType.toLowerCase()] ?? ''}`;
		const ecartee = raisonDEcart(nom, contenu, pieceMax);
		const repere: ReperePiece = { debut: plage.debut, fin: plage.fin, rang };
		pieces.push({ nom, type: p.mimeType, taille, repere, ecartee, contenu: () => relire(repere) });
	}
	return {
		message: {
			id: identifiants(email.messageId)[0] ?? null,
			reponseA: [...identifiants(email.inReplyTo), ...identifiants(email.references)],
			de: adresse(email),
			date: dateIso(email.date),
			sujet: metadonnee(email.subject),
			texte: nettoyerMessage(corps),
		},
		pieces,
	};
}

function documentDuFil(format: string, cle: string, fil: MessageDeFil[], pieces: PieceJointe[], repli: string, avertissements: string[]): DocumentExtrait {
	const premier = fil[0]!;
	const debut = horodatage(premier.date);
	const titre = metadonnee(premier.sujet) ?? nomSur(repli) ?? 'courriel';
	return {
		format,
		titre,
		markdown: `# ${titre}\n\n${markdownDuFil(fil)}`.trimEnd() + '\n',
		pages: null,
		date: premier.date?.slice(0, 10) ?? null,
		auteur: premier.de,
		pieces,
		cle,
		...(Number.isNaN(debut) ? {} : { debut }),
		...(avertissements.length > 0 ? { avertissements } : {}),
	};
}

/** Messages lus d'un `.eml` (un seul, en entier) ou d'un `.mbox` (un par un), et ce qui a dû être écarté ou coupé. */
async function messagesDe(
	format: 'eml' | 'mbox',
	contenu: Contenu,
	options: OptionsEmail,
	relire: (repere: ReperePiece) => Promise<Uint8Array>,
): Promise<{ lus: Lu[]; avertissements: string[] }> {
	if (format === 'eml') {
		const brut = await lireEntier(contenu, options.messageMax, 'Courriel');
		return { lus: [await lire(brut, { debut: 0, fin: contenu.taille }, relire, options.pieceMax)], avertissements: [] };
	}
	const lus: Lu[] = [];
	let ecartes = 0;
	let texte = 0;
	let coupe = false;
	for await (const plage of plagesMbox(contenu)) {
		if (plage.fin - plage.debut > options.messageMax) {
			ecartes++;
			continue;
		}
		const lu = await lire(await lireMessage(contenu, plage), plage, relire, options.pieceMax);
		const reste = options.texteBoiteMax - texte;
		if (lu.message.texte.length > reste) {
			lu.message.texte = lu.message.texte.slice(0, Math.max(0, reste));
			coupe = true;
		}
		texte += lu.message.texte.length;
		lus.push(lu);
	}
	const avertissements: string[] = [];
	if (ecartes > 0) avertissements.push(`${ecartes} message${ecartes > 1 ? 's' : ''} de plus de ${tailleLisible(options.messageMax)} écarté${ecartes > 1 ? 's' : ''} (limite par message)`);
	if (coupe) avertissements.push(`texte des messages coupé après ${options.texteBoiteMax} caractères pour la boîte entière : la suite n'est pas indexée`);
	return { lus, avertissements };
}

/** Limites d'un extracteur de courriels (abaissées par les tests). */
export type OptionsEmail = { messageMax: number; pieceMax: number; texteBoiteMax: number };

/**
 * Courriels : `.eml` (un fil) et `.mbox` (un fil par document via `extraireTout`, boîte lue message par message) ; citations
 * et signatures retirées, pièces jointes rendues (décodées à la demande, une à la fois).
 */
export function extracteurEmail(format: 'eml' | 'mbox', limites: Partial<OptionsEmail> = {}): Extracteur {
	const options: OptionsEmail = {
		messageMax: limites.messageMax ?? TAILLE_MAX_MESSAGE,
		pieceMax: limites.pieceMax ?? TAILLE_MAX_PIECE,
		texteBoiteMax: limites.texteBoiteMax ?? TEXTE_MAX_BOITE,
	};
	/** Pièces du dernier message relu : ses pièces se suivent, il n'est décodé qu'une fois pour toutes (une entrée, bornée par message). */
	let dernier: { contenu: Contenu; debut: number; fin: number; pieces: Promise<ArrayBuffer[]> } | null = null;
	async function piece(contenu: Contenu, repere: ReperePiece): Promise<Uint8Array> {
		if (dernier === null || dernier.contenu !== contenu || dernier.debut !== repere.debut || dernier.fin !== repere.fin) {
			const plage = { debut: repere.debut, fin: repere.fin };
			const octets = format === 'eml' ? lirePlage(contenu, plage.debut, plage.fin) : lireMessage(contenu, plage);
			const pieces = octets.then(async (o) => (await PostalMime.parse(o, { attachmentEncoding: 'arraybuffer' })).attachments.map((a) => a.content as ArrayBuffer));
			dernier = { contenu, ...plage, pieces };
			// un échec n'est pas gardé : la pièce suivante relit le message
			pieces.catch(() => {
				if (dernier?.pieces === pieces) dernier = null;
			});
		}
		const relue = (await dernier.pieces)[repere.rang];
		if (relue === undefined) throw new ErreurExtraction(`Pièce jointe n° ${repere.rang + 1} introuvable à la relecture du message.`);
		return new Uint8Array(relue);
	}
	async function documents(chemin: string, contenu: Contenu): Promise<DocumentExtrait[]> {
		try {
			const { lus, avertissements } = await messagesDe(format, contenu, options, (repere) => piece(contenu, repere));
			if (lus.length === 0) throw new Error(avertissements.length > 0 ? avertissements.join(' ; ') : 'aucun message trouvé');
			const fils = filsDe(lus.map((l) => ({ ...l.message, lu: l })));
			const cles = clesDeFils(fils);
			return fils.map((fil, i) =>
				documentDuFil(
					format,
					cles[i]!,
					fil.map(({ lu: _lu, id: _id, reponseA: _r, ...message }) => message),
					fil.flatMap((m) => m.lu.pieces),
					nomDuFichier(chemin),
					// ce qui vaut pour toute la boîte est dit une fois, sur son premier fil
					i === 0 ? avertissements : [],
				),
			);
		} catch (e) {
			if (e instanceof ErreurExtraction) throw e;
			throw new ErreurExtraction(`Extraction ${format === 'eml' ? 'du courriel' : 'de la boîte mbox'} impossible : ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	return {
		piece,
		extraireTout: documents,
		async extraire(chemin, contenu): Promise<DocumentExtrait> {
			const docs = await documents(chemin, contenu);
			const premier = docs[0]!;
			if (docs.length === 1) return premier;
			const { cle: _cle, ...sansCle } = premier;
			return {
				...sansCle,
				titre: metadonnee(nomDuFichier(chemin)) ?? premier.titre,
				markdown: docs.map((d) => d.markdown.trimEnd()).join('\n\n') + '\n',
				pieces: docs.flatMap((d) => d.pieces),
				...(docs.some((d) => d.avertissements) ? { avertissements: docs.flatMap((d) => d.avertissements ?? []) } : {}),
			};
		},
	};
}
