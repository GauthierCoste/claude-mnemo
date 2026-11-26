/**
 * `mnemo banc contexte --juger` : le jugement au terminal, une fiche à la fois, une touche par réponse. Chaque réponse est
 * enregistrée aussitôt dans `.mnemo/banc-contexte.json` ; on reprend là où l'on s'est arrêté.
 */
import { rename, rm, writeFile } from 'node:fs/promises';
import type { CasContexte } from '../../application/banc-contexte.ts';
import { annuler, prochaine, progression, repondre } from '../../application/banc-juger.ts';
import type { AJuger, Annulation, Reponse } from '../../application/banc-juger.ts';

/** Au-delà, le message est coupé à l'écran (il reste entier dans le fichier). */
const MESSAGE_MAX = 1500;
const LIGNES_MAX = 24;
const PRECEDENT_MAX = 300;

const TOUCHES: Record<string, Reponse> = {
	o: { genre: 'juger', jugement: 'pertinente' },
	n: { genre: 'juger', jugement: 'non_pertinente' },
	i: { genre: 'juger', jugement: 'indecise' },
	r: { genre: 'silence' },
	s: { genre: 'sauter' },
};

/** Numéro du fichier provisoire suivant : deux écritures du même processus n'ont jamais le même. */
let ecritures = 0;

/**
 * Enregistre les cas sans jamais laisser un fichier à moitié écrit (fichier voisin propre à cette écriture, puis renommage ;
 * deux écritures du même processus, le service par exemple, ne se marchent pas dessus). En échec, le fichier provisoire est
 * retiré : un fichier provisoire numéroté ne serait jamais repris par une écriture suivante.
 */
export async function enregistrerCas(fichier: string, cas: readonly CasContexte[]): Promise<void> {
	const provisoire = `${fichier}.${process.pid}.${++ecritures}.tmp`;
	try {
		await writeFile(provisoire, `${JSON.stringify(cas, null, 2)}\n`);
		await rename(provisoire, fichier);
	} catch (erreur) {
		await rm(provisoire, { force: true }).catch(() => {});
		throw erreur;
	}
}

function couper(texte: string, maxCaracteres: number, maxLignes: number): string {
	const lignes = texte.trim().split('\n');
	let coupe = lignes.slice(0, maxLignes).join('\n');
	if ([...coupe].length > maxCaracteres) coupe = [...coupe].slice(0, maxCaracteres).join('').trimEnd();
	const reste = [...texte.trim()].length - [...coupe].length;
	return reste > 0 ? `${coupe} … (${reste} caractères de plus)` : coupe;
}

const enRetrait = (texte: string) => texte.split('\n').map((l) => `  ${l}`).join('\n');

/** L'écran d'une fiche à juger : progression, message (et le message d'avant, en retrait), puis la fiche, sans note ni rang. */
export function ecranDeJugement(cas: readonly CasContexte[], cible: AJuger, options: { couleurs: boolean; avis?: string }): string {
	const gras = (t: string) => (options.couleurs ? `\x1b[1m${t}\x1b[22m` : t);
	const pale = (t: string) => (options.couleurs ? `\x1b[2m${t}\x1b[22m` : t);
	const c = cas[cible.indice]!;
	const p = progression(cas);
	const origine = [c.session === undefined ? null : `session ${c.session.slice(0, 8)}`, c.rang === undefined ? null : `message porteur n° ${c.rang}`, `position ${c.position === '' ? '(racine)' : c.position}`]
		.filter((x) => x !== null)
		.join(' · ');
	const lignes = [
		pale(`Banc du contexte · ${p.messagesJuges} / ${p.messages} messages jugés · fiche ${cible.place} / ${cible.sur} de ce message`),
		'',
		pale(origine),
		...(c.precedent === undefined || c.precedent === null ? [] : [pale(enRetrait(`Message d'avant : ${couper(c.precedent, PRECEDENT_MAX, 4)}`))]),
		gras('Message :'),
		enRetrait(couper(c.message, MESSAGE_MAX, LIGNES_MAX)),
		'',
		gras('Fiche :'),
		enRetrait(gras(cible.candidate.titre)),
		enRetrait(pale(cible.candidate.chemin)),
		...(cible.candidate.ligne === '' ? [] : [enRetrait(cible.candidate.ligne)]),
		'',
		`Utile pour ce message ?  ${gras('o')} oui · ${gras('n')} non · ${gras('i')} indécis`,
		pale(`r rien d'utile pour ce message (silence) · s sauter le message · b revenir · q quitter`),
		...(options.avis === undefined ? [] : ['', options.avis]),
	];
	return lignes.join('\n');
}

/** Une touche lue en mode brut ; Ctrl-C et Ctrl-D valent `q`. */
function lireTouche(entree: NodeJS.ReadStream): Promise<string> {
	return new Promise((resolve) => {
		entree.once('data', (donnees: Buffer) => {
			const t = donnees.toString('utf8');
			resolve(t === '\u0003' || t === '\u0004' ? 'q' : t.toLowerCase());
		});
	});
}

/**
 * Boucle de jugement : montre la prochaine fiche, lit la touche, enregistre. `b` annule la dernière réponse (autant de fois
 * qu'on veut dans la même séance). Rend la progression finale.
 */
export async function jugerAuTerminal(fichier: string, depart: readonly CasContexte[], terminal: { entree: NodeJS.ReadStream; sortie: NodeJS.WriteStream }): Promise<ReturnType<typeof progression>> {
	const { entree, sortie } = terminal;
	if (!entree.isTTY) throw new Error('--juger demande un terminal (une touche par réponse).');
	let cas = [...depart];
	const annulations: Annulation[] = [];
	let avis: string | undefined;
	entree.setRawMode(true);
	entree.resume();
	try {
		for (;;) {
			const cible = prochaine(cas);
			if (cible === null) break;
			sortie.write(`\x1b[2J\x1b[H${ecranDeJugement(cas, cible, { couleurs: sortie.isTTY === true, ...(avis === undefined ? {} : { avis }) })}\n`);
			avis = undefined;
			const touche = await lireTouche(entree);
			if (touche === 'q') break;
			if (touche === 'b') {
				const derniere = annulations.pop();
				if (derniere === undefined) avis = 'Rien à annuler dans cette séance.';
				else {
					cas = annuler(cas, derniere);
					await enregistrerCas(fichier, cas);
				}
				continue;
			}
			const reponse = TOUCHES[touche];
			if (reponse === undefined) {
				avis = `Touche « ${touche.replace(/[\x00-\x1f]/gu, '')} » inconnue.`;
				continue;
			}
			const fait = repondre(cas, cible, reponse);
			if (fait === null) {
				avis = 'Une fiche de ce message est déjà jugée utile : « silence » refusé (b pour revenir).';
				continue;
			}
			cas = fait.cas;
			annulations.push(fait.annulation);
			await enregistrerCas(fichier, cas);
		}
	} finally {
		entree.setRawMode(false);
		entree.pause();
	}
	sortie.write('\x1b[2J\x1b[H');
	return progression(cas);
}
