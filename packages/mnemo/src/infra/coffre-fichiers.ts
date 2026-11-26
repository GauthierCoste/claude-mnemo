import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Coffre, EtatFichier } from '../application/ports.ts';
import { EXTENSION_MARKDOWN } from '../domaine/chemin.ts';
import { DELAIS_RENOMMAGE, reessayer } from './reessayer.ts';

/** Pour les tests : renommage injecté et délais entre essais. */
export type OptionsCoffre = { renommer?: (de: string, vers: string) => Promise<void>; delais?: readonly number[] };

/** Fichier que le Finder de macOS dépose dans tout dossier ouvert : il ne rend pas un dossier « non vide ». */
const FICHIER_DU_FINDER = '.DS_Store';

function estDossierCache(nom: string): boolean {
	return nom.startsWith('.');
}

export function coffreFichiers(racineMemoire: string, options: OptionsCoffre = {}): Coffre {
	const racine = resolve(racineMemoire);
	const renommer = options.renommer ?? rename;
	const delais = options.delais ?? DELAIS_RENOMMAGE;

	function absolu(chemin: string): string {
		const complet = resolve(join(racine, ...chemin.split('/').filter((p) => p !== '')));
		const rel = relative(racine, complet);
		if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(racine, rel) !== complet) {
			throw new Error(`Chemin hors de la mémoire : ${chemin}`);
		}
		return complet;
	}

	function versRelatif(complet: string): string {
		return relative(racine, complet).split(sep).join('/');
	}

	async function entrees(complet: string) {
		try {
			return await readdir(complet, { withFileTypes: true });
		} catch (erreur) {
			if ((erreur as NodeJS.ErrnoException).code === 'ENOENT') return [];
			throw erreur;
		}
	}

	/** Un segment de `chemin` (sous la racine) est-il un lien symbolique ? Absent : non. */
	async function traverseUnLien(chemin: string): Promise<boolean> {
		let courant = racine;
		for (const segment of chemin.split('/').filter((p) => p !== '')) {
			courant = join(courant, segment);
			try {
				if ((await lstat(courant)).isSymbolicLink()) return true;
			} catch (erreur) {
				if ((erreur as NodeJS.ErrnoException).code === 'ENOENT') return false;
				throw erreur;
			}
		}
		return false;
	}

	/**
	 * Le fichier réel (liens résolus) reste-t-il sous la racine réelle, hors de son `.git/` (toute casse) ? Absent : oui (la
	 * lecture dira ENOENT).
	 */
	async function resteDansLaMemoire(complet: string): Promise<boolean> {
		let reel: string;
		try {
			reel = await realpath(complet);
		} catch (erreur) {
			if ((erreur as NodeJS.ErrnoException).code === 'ENOENT') return true;
			throw erreur;
		}
		const rel = relative(await realpath(racine), reel);
		if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
		return !rel.split(sep).some((segment) => segment.toLowerCase() === '.git');
	}

	/**
	 * Dossiers à retirer, chacun avec ses `.DS_Store` (le dossier d'abord, puis ses sous-dossiers en profondeur), si `complet`
	 * ne contient rien d'autre, sinon null. Un lien symbolique, même vers un dossier vide, est un contenu. Rien n'est touché ici.
	 */
	async function vide(complet: string): Promise<{ dossier: string; fichiers: string[] }[] | null> {
		const ici = { dossier: complet, fichiers: [] as string[] };
		const resultat = [ici];
		for (const entree of await entrees(complet)) {
			const enfant = join(complet, entree.name);
			if (entree.isFile() && entree.name === FICHIER_DU_FINDER) {
				ici.fichiers.push(enfant);
			} else if (entree.isDirectory()) {
				const sous = await vide(enfant);
				if (sous === null) return null;
				resultat.push(...sous);
			} else {
				return null;
			}
		}
		return resultat;
	}

	/** Absent : déjà retiré, toléré. */
	const sansAbsent = (erreur: unknown): void => {
		if ((erreur as NodeJS.ErrnoException).code !== 'ENOENT') throw erreur;
	};

	async function toutesLesFiches(): Promise<string[]> {
		const resultat: string[] = [];
		async function parcourir(complet: string): Promise<void> {
			for (const entree of await entrees(complet)) {
				const enfant = join(complet, entree.name);
				if (entree.isDirectory()) {
					if (!estDossierCache(entree.name)) await parcourir(enfant);
				} else if (entree.isFile() && entree.name.endsWith(EXTENSION_MARKDOWN) && !estDossierCache(entree.name)) {
					resultat.push(versRelatif(enfant));
				}
			}
		}
		await parcourir(racine);
		return resultat.sort();
	}

	return {
		async lire(chemin) {
			try {
				const complet = absolu(chemin);
				// Un lien symbolique qui sort de la mémoire n'est jamais suivi.
				if (!(await resteDansLaMemoire(complet))) return null;
				return await readFile(complet, 'utf8');
			} catch (erreur) {
				if ((erreur as NodeJS.ErrnoException).code === 'ENOENT') return null;
				throw erreur;
			}
		},

		async ecrire(chemin, texte) {
			const cible = absolu(chemin);
			await mkdir(dirname(cible), { recursive: true });
			const temporaire = join(dirname(cible), `.mnemo-${randomBytes(6).toString('hex')}.tmp`);
			try {
				await writeFile(temporaire, texte.replace(/\r\n?/g, '\n'), 'utf8');
				// Sous Windows, un fichier ouvert ailleurs refuse un instant d'être remplacé.
				await reessayer(() => renommer(temporaire, cible), delais);
			} catch (erreur) {
				await rm(temporaire, { force: true });
				throw erreur;
			}
		},

		async supprimer(chemin) {
			await rm(absolu(chemin), { force: true });
		},

		async retirerDossierVide(dossier) {
			const complet = absolu(dossier);
			if (complet === racine) return 'racine';
			if (await traverseUnLien(dossier)) return 'lien';
			try {
				if (!(await lstat(complet)).isDirectory()) return 'pas_un_dossier';
			} catch (erreur) {
				if ((erreur as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
				throw erreur;
			}
			// L'arbre entier est examiné avant de toucher à quoi que ce soit ; puis du plus profond au dossier lui-même, chaque
			// dossier perd ses .DS_Store juste avant d'être retiré : un fichier apparu entre-temps arrête tout plus haut.
			const aRetirer = await vide(complet);
			if (aRetirer === null) return 'non_vide';
			for (const { dossier: d, fichiers } of aRetirer.reverse()) {
				for (const fichier of fichiers) await rm(fichier).catch(sansAbsent);
				try {
					await rmdir(d);
				} catch (erreur) {
					const code = (erreur as NodeJS.ErrnoException).code;
					if (code === 'ENOTEMPTY' || code === 'EEXIST') return 'non_vide';
					sansAbsent(erreur);
				}
			}
			return 'retire';
		},

		async deplacerDossier(de, vers) {
			const source = absolu(de);
			const cible = absolu(vers);
			if (source === racine || cible === racine) throw new Error('La racine de la mémoire ne se déplace pas.');
			if ((await traverseUnLien(de)) || (await traverseUnLien(vers))) throw new Error(`Déplacement refusé : ${de} ou ${vers} passe par un lien symbolique.`);
			if (!(await lstat(source)).isDirectory()) throw new Error(`${de} n'est pas un dossier.`);
			const existe = await lstat(cible).then(
				() => true,
				(erreur: unknown) => {
					sansAbsent(erreur);
					return false;
				},
			);
			if (existe) throw new Error(`${vers} existe déjà.`);
			await mkdir(dirname(cible), { recursive: true });
			await reessayer(() => renommer(source, cible), delais);
		},

		async retirerDossier(dossier) {
			const complet = absolu(dossier);
			if (complet === racine) throw new Error('La racine de la mémoire ne se retire pas.');
			if (await traverseUnLien(dossier)) throw new Error(`Retrait refusé : ${dossier} passe par un lien symbolique.`);
			await rm(complet, { recursive: true, force: true });
		},

		async lister(dossier) {
			const complet = absolu(dossier);
			const fiches: string[] = [];
			const dossiers: string[] = [];
			// Comme le parcours de `toutesLesFiches` : un dossier atteint par un lien symbolique n'est jamais suivi.
			if (await traverseUnLien(dossier)) return { fiches, dossiers };
			for (const entree of await entrees(complet)) {
				if (entree.isDirectory()) {
					if (!estDossierCache(entree.name)) dossiers.push(versRelatif(join(complet, entree.name)));
				} else if (entree.isFile() && entree.name.endsWith(EXTENSION_MARKDOWN) && !estDossierCache(entree.name)) {
					fiches.push(versRelatif(join(complet, entree.name)));
				}
			}
			return { fiches: fiches.sort(), dossiers: dossiers.sort() };
		},

		toutesLesFiches,

		async etats() {
			const chemins = await toutesLesFiches();
			const etats: EtatFichier[] = [];
			for (const chemin of chemins) {
				try {
					const infos = await stat(absolu(chemin));
					etats.push({ chemin, mtimeMs: infos.mtimeMs, taille: infos.size });
				} catch (erreur) {
					// Supprimé entre le parcours et la lecture : ignoré.
					if ((erreur as NodeJS.ErrnoException).code !== 'ENOENT') throw erreur;
				}
			}
			return etats;
		},
	};
}
