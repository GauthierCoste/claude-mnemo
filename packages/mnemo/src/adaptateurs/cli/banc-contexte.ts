import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { extraireCas, rejouerCas } from '../../application/banc-contexte.ts';
import type { CasContexte, EchecContexte, MesureContexte } from '../../application/banc-contexte.ts';
import { DOSSIER_LOCAL } from '../../domaine/dossier-memoire.ts';
import { compterGestes, GESTES } from '../../domaine/gestes.ts';
import type { ComptesDesGestes } from '../../domaine/gestes.ts';
import { estObjet } from '../../domaine/valeurs.ts';
import { dependancesReelles, etatParesseux } from '../../infra/systeme.ts';
import { AUCUNE_MEMOIRE, ErreurCli } from './erreurs.ts';
import { trouverRacine } from './racine.ts';

const USAGE_CONTEXTE = 'Usage : mnemo banc contexte [--json] | mnemo banc contexte --extraire <session> | mnemo banc contexte --gestes [--json]';

/** Cas du banc `contexte` : `.mnemo/banc-contexte.json` (état local, ignoré par git, jamais commité). */
export function fichierBancContexte(racine: string): string {
	return join(racine, DOSSIER_LOCAL, 'banc-contexte.json');
}

const textes = (v: unknown, nom: string, i: number): string[] => {
	if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new ErreurCli(`banc-contexte.json, cas ${i + 1} : « ${nom} » doit être une liste de textes.`);
	return v as string[];
};

/** Cas d'un fichier `banc-contexte.json` (liste de cas) ; erreur lisible sur un cas mal formé. */
export function lireCasContexte(texte: string): CasContexte[] {
	let brut: unknown;
	try {
		brut = JSON.parse(texte);
	} catch {
		throw new ErreurCli('banc-contexte.json : JSON invalide.');
	}
	if (!Array.isArray(brut)) throw new ErreurCli('banc-contexte.json : une liste de cas est attendue.');
	return brut.map((c: unknown, i): CasContexte => {
		if (!estObjet(c) || typeof c['nom'] !== 'string' || typeof c['position'] !== 'string' || typeof c['message'] !== 'string') {
			throw new ErreurCli(`banc-contexte.json, cas ${i + 1} : « nom », « position » et « message » (textes) sont attendus.`);
		}
		return {
			nom: c['nom'],
			position: c['position'],
			message: c['message'],
			premier: c['premier'] === true,
			attendues: textes(c['attendues'] ?? [], 'attendues', i),
			interdites: textes(c['interdites'] ?? [], 'interdites', i),
			silence: c['silence'] === true,
			...(c['injectees'] === undefined ? {} : { injectees: textes(c['injectees'], 'injectees', i) }),
		};
	});
}

/** Cas du fichier ; aucun cas s'il n'existe pas encore. */
export async function lireCasDuFichier(fichier: string): Promise<CasContexte[]> {
	let texte: string;
	try {
		texte = await readFile(fichier, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw e;
	}
	return lireCasContexte(texte);
}

export function contexteEnTexte(mesure: MesureContexte, echecs: EchecContexte[]): string {
	const moyenne = mesure.cas === 0 ? 0 : Math.round(mesure.caracteres / mesure.cas);
	return [
		`Contexte : ${mesure.justes} / ${mesure.cas} cas justes, ${mesure.attenduesProposees} / ${mesure.attenduesTotal} attendues proposées, ${mesure.indesirables} indésirables, ${moyenne} caractères par cas`,
		...echecs.map((e) => `  échec : ${e.nom}${e.manquees.length === 0 ? '' : ` ; manquées : ${e.manquees.join(', ')}`}${e.indesirables.length === 0 ? '' : ` ; indésirables : ${e.indesirables.join(', ')}`}`),
	].join('\n');
}

/** Comptes du journal des gestes, sans aucun texte de message : par geste, puis par fiche. */
export function gestesEnTexte(comptes: ComptesDesGestes): string {
	const parGeste = GESTES.map((g) => `${g} ${comptes.parGeste[g]}`).join(', ');
	return [
		`Gestes : ${comptes.total} (${parGeste})`,
		...comptes.parFiche.map((f) => `  ${f.fiche} : ${f.total} (${GESTES.filter((g) => f.parGeste[g] !== undefined).map((g) => `${g} ${f.parGeste[g]}`).join(', ')})`),
	].join('\n');
}

/** Les cas à ajouter : ceux dont le couple (position, message) n'est pas déjà connu, une seule fois chacun. */
export function casNouveaux(existants: readonly CasContexte[], extraits: readonly CasContexte[]): CasContexte[] {
	const cle = (c: CasContexte) => JSON.stringify([c.position, c.message]);
	const connus = new Set(existants.map(cle));
	const nouveaux: CasContexte[] = [];
	for (const c of extraits) {
		if (connus.has(cle(c))) continue;
		connus.add(cle(c));
		nouveaux.push(c);
	}
	return nouveaux;
}

/**
 * `mnemo banc contexte [--json]` : rejoue les cas étiquetés de `.mnemo/banc-contexte.json` sur la mémoire courante (sans
 * `claude`). `--extraire <session>` ajoute au fichier les messages journalisés de la session (dédoublonnés par position et
 * message), à étiqueter. `--gestes` : comptes du journal durable des gestes, par geste et par fiche (sans texte de message).
 */
export async function commandeContexte(args: string[]): Promise<void> {
	const json = args.includes('--json');
	if (args.includes('--gestes')) {
		const autre = args.find((a) => a !== '--json' && a !== '--gestes');
		if (autre !== undefined) throw new ErreurCli(`${autre.startsWith('--') ? `Option inconnue : « ${autre} »` : `Argument inattendu : « ${autre} »`}.\n${USAGE_CONTEXTE}`, 2);
		const racine = trouverRacine(process.cwd());
		if (racine === null) throw new ErreurCli(AUCUNE_MEMOIRE);
		const etat = etatParesseux(racine);
		try {
			const comptes = compterGestes(await etat.gestes({ limite: null }));
			console.log(json ? JSON.stringify(comptes, null, 2) : gestesEnTexte(comptes));
		} finally {
			etat.fermer();
		}
		return;
	}
	const i = args.indexOf('--extraire');
	const session = i === -1 ? null : (args[i + 1] ?? null);
	if (i !== -1 && (session === null || session.startsWith('--'))) throw new ErreurCli(`Session manquante après --extraire.\n${USAGE_CONTEXTE}`, 2);
	const autre = args.find((a, k) => a !== '--json' && a !== '--extraire' && !(i !== -1 && k === i + 1));
	if (autre !== undefined) throw new ErreurCli(`${autre.startsWith('--') ? `Option inconnue : « ${autre} »` : `Argument inattendu : « ${autre} »`}.\n${USAGE_CONTEXTE}`, 2);
	const racine = trouverRacine(process.cwd());
	if (racine === null) throw new ErreurCli(AUCUNE_MEMOIRE);
	const fichier = fichierBancContexte(racine);
	const existants = await lireCasDuFichier(fichier);

	if (session !== null) {
		const etat = etatParesseux(racine);
		try {
			const extraits = await extraireCas(etat, session).catch((e: unknown) => {
				throw new ErreurCli(e instanceof Error ? e.message : String(e));
			});
			const nouveaux = casNouveaux(existants, extraits);
			await mkdir(dirname(fichier), { recursive: true });
			await writeFile(fichier, `${JSON.stringify([...existants, ...nouveaux], null, 2)}\n`);
			console.log(json ? JSON.stringify({ ajoutes: nouveaux.length, total: existants.length + nouveaux.length }) : `${nouveaux.length} cas ajouté(s) à ${fichier} (à étiqueter : attendues, interdites, silence).`);
		} finally {
			etat.fermer();
		}
		return;
	}
	if (existants.length === 0) throw new ErreurCli(`Aucun cas dans ${fichier}. Ajoutez-en avec : mnemo banc contexte --extraire <session>`);
	const dep = dependancesReelles(racine);
	try {
		const { mesure, echecs } = await rejouerCas(dep, existants);
		console.log(json ? JSON.stringify({ mesure, echecs }, null, 2) : contexteEnTexte(mesure, echecs));
	} finally {
		dep.index.fermer();
	}
}
