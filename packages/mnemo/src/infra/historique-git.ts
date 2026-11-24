import { execFile } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Historique } from '../application/ports.ts';
import { estUuid } from '../domaine/session.ts';
import { argumentsGit } from './git.ts';
import { retirerVerrouGitPerime } from './verrou-git.ts';
import type { OptionsVerrouGit } from './verrou-git.ts';

/** Plafond du nombre de commits relus par `journal`. */
const JOURNAL_MAX = 500;
const RE_JOUR = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** Minuit local du jour `AAAA-MM-JJ`, en ISO 8601 avec le décalage de ce moment-là ; null si la date est mal formée. */
function minuitLocal(jour: string): string | null {
	const m = RE_JOUR.exec(jour);
	if (m === null) return null;
	const [annee, mois, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const d = new Date(annee, mois - 1, j);
	if (d.getFullYear() !== annee || d.getMonth() !== mois - 1 || d.getDate() !== j) return null;
	const deux = (n: number) => String(n).padStart(2, '0');
	const decalage = -d.getTimezoneOffset();
	const signe = decalage < 0 ? '-' : '+';
	const absolu = Math.abs(decalage);
	return `${m[1]}-${m[2]}-${m[3]}T00:00:00${signe}${deux(Math.floor(absolu / 60))}:${deux(absolu % 60)}`;
}

// La mémoire est écrite en « \n » : aucune conversion de fin de ligne, quel que soit le réglage global de l'utilisateur.
const OPTIONS_MEMOIRE = ['core.autocrlf=false'];
/** Branche de la mémoire. */
const BRANCHE = 'main';

/** `options` : détection d'un git en cours et journal du retrait d'un `index.lock` périmé (tests). */
export function historiqueGit(racineMemoire: string, options: OptionsVerrouGit = {}): Historique {
	function git(args: string[]): Promise<string> {
		return new Promise((resoudre, rejeter) => {
			execFile(
				'git',
				argumentsGit(OPTIONS_MEMOIRE, args),
				{
					cwd: racineMemoire,
					maxBuffer: 64 * 1024 * 1024,
					// Windows : sans console qui s'ouvre à chaque commit quand le service tourne détaché
					windowsHide: true,
					env: {
						...process.env,
						GIT_AUTHOR_NAME: 'Mnemo',
						GIT_AUTHOR_EMAIL: 'mnemo@localhost',
						GIT_COMMITTER_NAME: 'Mnemo',
						GIT_COMMITTER_EMAIL: 'mnemo@localhost',
					},
				},
				(erreur, sortie, sortieErreur) => {
					if (erreur) {
						rejeter(new Error(messageEchecGit(args[0] ?? '', sortieErreur || erreur.message, racineMemoire)));
					} else {
						resoudre(sortie);
					}
				},
			);
		});
	}

	return {
		async initialiser() {
			try {
				await access(join(racineMemoire, '.git'));
				return;
			} catch {
				// pas encore initialisé
			}
			await mkdir(racineMemoire, { recursive: true });
			// `--initial-branch` n'existe qu'à partir de git 2.28 : la branche est posée ensuite, pour tout git
			await git(['init']);
			await git(['symbolic-ref', 'HEAD', `refs/heads/${BRANCHE}`]);
		},

		async modificationsEnCours() {
			const sortie = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
			const morceaux = sortie.split('\0');
			const chemins: string[] = [];
			for (let i = 0; i < morceaux.length; i++) {
				const entree = morceaux[i] ?? '';
				if (entree.length < 4) continue;
				const etat = entree.slice(0, 2);
				chemins.push(entree.slice(3));
				// Renommage ou copie : le chemin d'origine suit dans l'entrée suivante.
				if (etat.includes('R') || etat.includes('C')) {
					i += 1;
					const origine = morceaux[i];
					if (origine) chemins.push(origine);
				}
			}
			return chemins.sort();
		},

		async commit(message, chemins, session) {
			const cibles = chemins === 'tout' ? [] : ['--', ...chemins];
			if (chemins !== 'tout' && chemins.length === 0) return null;
			// un git tué (hook `fin` coupé) a pu laisser son verrou : sans ce retrait, toute écriture échouerait désormais
			await retirerVerrouGitPerime(racineMemoire, options);
			await git(['add', '-A', ...cibles]);
			const staged = (await git(['diff', '--cached', '--name-only', ...cibles])).trim();
			if (staged === '') return null;
			await git(['commit', '--no-verify', '-m', message, ...(session !== undefined && estUuid(session) ? ['-m', `Mnemo-Session: ${session}`] : []), ...cibles]);
			return (await git(['rev-parse', '--short', 'HEAD'])).trim();
		},

		async journal(depuis, limite, jusqua) {
			const since = minuitLocal(depuis);
			if (since === null) throw new Error(`Date invalide : « ${depuis} » (attendu AAAA-MM-JJ).`);
			const until = jusqua === undefined ? null : minuitLocal(jusqua);
			if (jusqua !== undefined && until === null) throw new Error(`Date invalide : « ${jusqua} » (attendu AAAA-MM-JJ).`);
			if (!Number.isInteger(limite) || limite < 1) return [];
			try {
				await git(['rev-parse', '--verify', '--quiet', 'HEAD']);
			} catch {
				return []; // aucun commit encore
			}
			// Format fixe : \x1e avant chaque commit ; champs séparés par \x1f : hash, date, trailer, sujet, puis un \x1f final ;
			// avec -z, un NUL suit l'en-tête et les fichiers viennent ensuite, séparés par NUL. Le sujet, en dernier, peut contenir
			// n'importe quoi sauf NUL : on découpe sur l'en-tête (hash et date) et sur ce premier NUL, jamais sur le sujet.
			const sortie = await git([
				'log',
				'-z',
				'--name-only',
				`--since=${since}`,
				...(until === null ? [] : [`--until=${until}`]),
				`--max-count=${Math.min(limite, JOURNAL_MAX)}`,
				'--format=%x1e%h%x1f%ct%x1f%(trailers:key=Mnemo-Session,valueonly=true,separator=%x2c)%x1f%s%x1f',
			]);
			const lignes: { hash: string; dateMs: number; message: string; fichiers: string[]; session: string | null }[] = [];
			const entete = /\x1e([0-9a-f]{4,64})\x1f(\d+)\x1f/uy;
			let position = 0;
			while (position < sortie.length) {
				entete.lastIndex = position;
				const m = entete.exec(sortie);
				if (m === null) break; // sortie inattendue : on garde ce qui est lu
				// Le sujet va jusqu'au premier NUL (il n'en contient pas) ; un faux en-tête dans le sujet est ainsi sauté.
				const nul = sortie.indexOf('\0', entete.lastIndex);
				const tete = sortie.slice(entete.lastIndex, nul === -1 ? sortie.length : nul);
				const fichiers: string[] = [];
				position = nul === -1 ? sortie.length : nul + 1;
				while (position < sortie.length) {
					entete.lastIndex = position;
					if (entete.test(sortie)) break; // commit suivant
					const fin = sortie.indexOf('\0', position);
					const brut = sortie.slice(position, fin === -1 ? sortie.length : fin).replace(/^\n/u, '');
					if (brut !== '') fichiers.push(brut);
					position = fin === -1 ? sortie.length : fin + 1;
				}
				const separateur = tete.indexOf('\x1f');
				if (separateur === -1) continue;
				const dernier = tete.slice(0, separateur).trim().split(',').at(-1)?.trim() ?? '';
				const sujet = tete.slice(separateur + 1).replace(/\x1f$/u, '').replace(/[\x00-\x1f]/gu, ' ');
				lignes.push({ hash: m[1]!, dateMs: Number(m[2]) * 1000, message: sujet, fichiers, session: estUuid(dernier) ? dernier : null });
			}
			return lignes;
		},
	};
}

/**
 * Message d'un git en échec. Git refuse un dépôt dont le propriétaire n'est pas l'utilisateur (« dubious ownership » : dossier
 * créé par un administrateur, disque FAT ou exFAT, partage réseau, fréquent sous Windows) : la commande qui l'autorise est donnée.
 */
export function messageEchecGit(sousCommande: string, sortieErreur: string, racineMemoire: string): string {
	const brut = `git ${sousCommande} a échoué : ${sortieErreur.trim()}`;
	if (!/dubious ownership/iu.test(sortieErreur)) return brut;
	const chemin = racineMemoire.replaceAll('\\', '/');
	return `${brut}\nGit refuse ce dépôt, qui n'appartient pas à l'utilisateur courant. Pour l'autoriser : git config --global --add safe.directory "${chemin}"`;
}
