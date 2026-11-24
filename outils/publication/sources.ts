/**
 * Fichiers à vérifier :
 * - mode git : l'arbre d'un commit (`HEAD` par défaut, `--commit <rév>` sinon), lu par `git ls-tree` et `git cat-file
 *   --batch` — c'est le contenu commité qui sera publié, pas la copie de travail ni l'index ; une copie de travail qui
 *   diffère est signalée par un avertissement. Un lien symbolique y est un blob dont le contenu est la cible ;
 * - mode dossier : tous les fichiers du dossier (sauf `.git/` et `node_modules/`) ; les liens symboliques ne sont pas
 *   suivis, mais leur cible est vérifiée.
 */
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

/** Un fichier à vérifier ; `lien` : cible d'un lien symbolique (le fichier n'a alors pas d'autre contenu). */
export type Entree = { chemin: string; taille: number; lire: () => Buffer; lien: string | null; executable: boolean };

export type Source = { racine: string; entrees: Entree[]; avertissements: string[] };

const TAMPON = 512 * 1024 * 1024;

export function depuisGit(cwd: string, revision: string): Source {
	const git = (args: string[], input?: Buffer) => execFileSync('git', args, { cwd, maxBuffer: TAMPON, input, stdio: ['pipe', 'pipe', 'pipe'] });
	const racine = git(['rev-parse', '--show-toplevel']).toString('utf8').trim();
	const avertissements: string[] = [];
	const lignes = git(['ls-tree', '-r', '-z', '-l', '--full-tree', revision]).toString('utf8').split('\0').filter((l) => l !== '');
	const blobs: { mode: string; sha: string; taille: number; chemin: string }[] = [];
	for (const l of lignes) {
		const tab = l.indexOf('\t');
		const [mode, type, sha, taille] = l.slice(0, tab).split(/\s+/) as [string, string, string, string];
		const chemin = l.slice(tab + 1);
		if (type !== 'blob') {
			avertissements.push(`${chemin} : sous-module (${type}) non vérifié.`);
			continue;
		}
		blobs.push({ mode, sha, taille: Number(taille), chemin });
	}
	// Tout le contenu en un appel : `<sha> blob <taille>\n<contenu>\n` par objet.
	const contenus = new Map<string, Buffer>();
	if (blobs.length > 0) {
		const sortie = git(['cat-file', '--batch'], Buffer.from(`${[...new Set(blobs.map((b) => b.sha))].join('\n')}\n`));
		for (let i = 0; i < sortie.length; ) {
			const finEntete = sortie.indexOf(0x0a, i);
			const [sha, , taille] = sortie.toString('utf8', i, finEntete).split(' ') as [string, string, string];
			const debut = finEntete + 1;
			contenus.set(sha, sortie.subarray(debut, debut + Number(taille)));
			i = debut + Number(taille) + 1;
		}
	}
	if (revision === 'HEAD' && git(['status', '--porcelain', '--untracked-files=no']).length > 0) {
		avertissements.push('la copie de travail diffère de HEAD : seul le contenu commité est vérifié.');
	}
	return {
		racine,
		avertissements,
		entrees: blobs.map((b) => {
			const lire = () => contenus.get(b.sha) ?? Buffer.alloc(0);
			return { chemin: b.chemin, taille: b.taille, lire, lien: b.mode === '120000' ? lire().toString('utf8') : null, executable: b.mode === '100755' };
		}),
	};
}

export function depuisDossier(racine: string): Source {
	const entrees: Entree[] = [];
	const avertissements: string[] = [];
	const parcourir = (dossier: string) => {
		for (const e of readdirSync(dossier, { withFileTypes: true })) {
			const absolu = join(dossier, e.name);
			const chemin = relative(racine, absolu).split(sep).join('/');
			if (e.isDirectory()) {
				if (e.name !== '.git' && e.name !== 'node_modules') parcourir(absolu);
			} else if (e.isSymbolicLink()) {
				avertissements.push(`${chemin} : lien symbolique, non suivi (sa cible est vérifiée).`);
				const cible = readlinkSync(absolu);
				entrees.push({ chemin, taille: 0, lire: () => Buffer.from(cible), lien: cible, executable: false });
			} else if (e.isFile()) {
				const etat = lstatSync(absolu);
				entrees.push({ chemin, taille: etat.size, lire: () => readFileSync(absolu), lien: null, executable: (etat.mode & 0o111) !== 0 });
			}
		}
	};
	parcourir(racine);
	return { racine, entrees, avertissements };
}

/** Vrai si la cible d'un lien posé en `chemin` sort de la racine (cible absolue, ou qui remonte au-dessus). */
export function lienHorsRacine(chemin: string, cible: string): boolean {
	const c = cible.replace(/\\/g, '/');
	if (c.startsWith('/') || /^[A-Za-z]:/.test(c)) return true;
	const resolu = posix.normalize(posix.join(posix.dirname(chemin), c));
	return resolu === '..' || resolu.startsWith('../');
}
