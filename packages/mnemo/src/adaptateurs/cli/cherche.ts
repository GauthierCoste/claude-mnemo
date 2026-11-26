import { chercherAvecAvis } from '../../application/chercher.ts';
import type { Trouve } from '../../application/chercher.ts';
import { etendrePassages } from '../../application/etendre.ts';
import { libelleEtendue } from '../../domaine/etendue.ts';
import { baseEnClair, libelleApports } from '../../domaine/note-de-recherche.ts';
import { tronquerTexte } from '../../domaine/texte.ts';
import { dependancesReelles } from '../../infra/systeme.ts';
import { AUCUNE_MEMOIRE, ErreurCli } from './erreurs.ts';
import { trouverRacine } from './racine.ts';

const USAGE = 'Usage : mnemo cherche <texte…> [--dossier <chemin>] [--tout] [--limite N] [--contexte]';
const LONGUEUR_TEXTE = 100;

/** « 2 documents changés pas encore réindexés (recherche sur leur ancien texte) : lancer « mnemo index ». » */
export const documentsDifferes = (n: number): string =>
	`${n} document${n > 1 ? 's' : ''} changé${n > 1 ? 's' : ''} pas encore réindexé${n > 1 ? 's' : ''} (recherche sur ${n > 1 ? 'leur' : 'son'} ancien texte) : lancer « mnemo index ».`;

/** `--contexte` : base, référence et étendue injectée, puis le texte entier (passage élargi à sa section ou ses voisins), en retrait. */
function enEntier(t: Trouve): string {
	const etendue = t.etendue === undefined ? '' : ` (${libelleEtendue(t.etendue)})`;
	return [`  ${baseEnClair(t.base)}  ${t.id}${etendue}`, ...t.texte.split('\n').map((l) => (l === '' ? '' : `    ${l}`))].join('\n');
}

/** Raisons de la note après l'id : « · projet courant, confiance 60 % » ; rien sans apport. */
function raisons(t: Trouve): string {
	const libelle = libelleApports({ base: t.base, apports: t.apports });
	const i = libelle.indexOf(' · ');
	return i < 0 ? '' : libelle.slice(i);
}

export async function commandeCherche(args: string[]): Promise<void> {
	const mots: string[] = [];
	let dossier: string | undefined;
	let tout = false;
	let contexte = false;
	let limite: number | undefined;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;
		if (arg === '--tout') tout = true;
		else if (arg === '--contexte') contexte = true;
		else if (arg === '--dossier') {
			dossier = args[++i];
			if (dossier === undefined) throw new ErreurCli(USAGE, 2);
		} else if (arg === '--limite') {
			const valeur = args[++i];
			if (valeur === undefined || !/^[1-9]\d*$/u.test(valeur)) throw new ErreurCli(`${USAGE}\n--limite demande un entier positif.`, 2);
			limite = Number(valeur);
		} else if (arg.startsWith('--')) throw new ErreurCli(`Option inconnue : « ${arg} ».\n${USAGE}`, 2);
		else mots.push(arg);
	}
	if (mots.length === 0) throw new ErreurCli(USAGE, 2);
	const racine = trouverRacine(process.cwd());
	if (racine === null) throw new ErreurCli(AUCUNE_MEMOIRE);

	const dependances = dependancesReelles(racine);
	const { trouves, differees } = await (async () => {
		const brut = await chercherAvecAvis(dependances, {
			texte: mots.join(' '),
			...(dossier !== undefined ? { perimetre: dossier } : {}),
			...(limite !== undefined ? { limite } : {}),
			...(tout ? { inclureAConfirmer: true, inclureInvalides: true } : {}),
		});
		return { trouves: contexte ? await etendrePassages(dependances, brut.trouves) : brut.trouves, differees: brut.differees };
	})().finally(() => dependances.index.fermer());
	if (trouves.length === 0) console.log('Rien trouvé.');
	else if (contexte) console.log(trouves.map(enEntier).join('\n\n'));
	else {
		console.log(
			trouves
				.map((t) => `  ${baseEnClair(t.base)}  ${tronquerTexte(t.texte.replace(/\s+/gu, ' '), LONGUEUR_TEXTE)}  (${t.id}${raisons(t)})`)
				.join('\n'),
		);
	}
	// la recherche n'extrait aucun document : ceux qui ont changé servent leur ancien texte jusqu'à `mnemo index`
	if (differees.length > 0) console.log(documentsDifferes(differees.length));
}
