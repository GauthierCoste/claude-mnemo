import { lstat, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';
import JSZip from 'jszip';
import { list as listerTar, extract as extraireTar } from 'tar';

/**
 * Dépliage sûr d'une archive de pièce (déjà vérifiée par son empreinte : ces contrôles sont une seconde ligne de défense).
 * Refus de toute entrée au chemin absolu ou contenant `..`, de tout lien physique, périphérique ou entrée spéciale, et de
 * tout lien symbolique absolu ou qui sort du dossier ; le premier niveau de dossier est retiré quand toutes les entrées le
 * partagent (une archive à plat est dépliée telle quelle). Les liens symboliques sont créés en dernier, par nous : aucune
 * écriture ne passe par un lien, et un lien peut viser un autre lien (chaînes `libx.dylib -> libx.0.dylib -> …` des
 * archives macOS, que `tar` refuse quand la cible existe déjà).
 */

type Genre = 'fichier' | 'dossier' | 'lien' | 'autre';
type Entree = { chemin: string; genre: Genre; lien: string; brut: string };

function refus(motif: string, chemin: string): Error {
	return new Error(`Archive refusée : ${motif} (« ${chemin} »).`);
}

const absolu = (p: string) => p.startsWith('/') || /^[A-Za-z]:/u.test(p);

/** Segments d'un chemin d'archive, `\` lu comme `/` ; refus d'un chemin absolu ou contenant `..`. */
function segments(brut: string): string[] {
	const chemin = brut.replaceAll('\\', '/');
	if (absolu(chemin)) throw refus('chemin absolu', brut);
	const parts = chemin.split('/').filter((p) => p !== '' && p !== '.');
	if (parts.includes('..')) throw refus('chemin contenant « .. »', brut);
	return parts;
}

/** Faut-il retirer le premier niveau ? Oui seulement si toutes les entrées sont sous un même dossier. */
function niveauARetirer(entrees: Entree[]): 0 | 1 {
	const premiers = new Set<string>();
	for (const e of entrees) {
		const parts = segments(e.chemin);
		if (parts.length === 0) continue;
		if (parts.length === 1 && e.genre !== 'dossier') return 0;
		premiers.add(parts[0]!);
	}
	return premiers.size === 1 ? 1 : 0;
}

/** Valide une entrée et rend son chemin relatif une fois le niveau retiré (`null` : entrée sautée, c'est le dossier retiré). */
function valider(e: Entree, retirer: 0 | 1): string | null {
	const parts = segments(e.chemin).slice(retirer);
	if (e.genre === 'autre') throw refus(`entrée de type ${e.brut} interdite`, e.chemin);
	if (parts.length === 0) return null;
	const chemin = parts.join('/');
	if (e.genre === 'lien') {
		const cible = e.lien.replaceAll('\\', '/');
		if (cible === '' || absolu(cible)) throw refus('lien symbolique absolu', e.chemin);
		const resolu = posix.normalize(posix.join(posix.dirname(chemin), cible));
		if (resolu === '..' || resolu.startsWith('../')) throw refus('lien symbolique sortant du dossier', e.chemin);
	}
	return chemin;
}

function genreTar(type: string): Genre {
	if (type === 'File' || type === 'OldFile' || type === 'ContiguousFile') return 'fichier';
	if (type === 'Directory') return 'dossier';
	if (type === 'SymbolicLink') return 'lien';
	return 'autre';
}

async function deplierTar(archive: string, vers: string): Promise<Lien[]> {
	const entrees: Entree[] = [];
	await listerTar({
		file: archive,
		strict: true,
		onReadEntry: (e) => {
			entrees.push({ chemin: e.path, genre: genreTar(e.type), lien: e.linkpath ?? '', brut: e.type });
		},
	});
	const retirer = niveauARetirer(entrees);
	const liens: Lien[] = [];
	for (const e of entrees) {
		const chemin = valider(e, retirer);
		if (chemin !== null && e.genre === 'lien') liens.push({ chemin, cible: e.lien });
	}
	// Second passage, sans les liens : le filtre revalide chaque entrée (le fichier ne change pas, mais rien n'est pris sans contrôle).
	let ecart: Error | null = null;
	await extraireTar({
		file: archive,
		cwd: vers,
		strip: retirer,
		strict: true,
		preserveOwner: false,
		filter: (chemin, e) => {
			try {
				const type = 'type' in e ? e.type : 'Unsupported';
				const lien = 'linkpath' in e ? (e.linkpath ?? '') : '';
				const genre = genreTar(type);
				return valider({ chemin, genre, lien, brut: type }, retirer) !== null && genre !== 'lien';
			} catch (erreur) {
				ecart ??= erreur as Error;
				return false;
			}
		},
	});
	if (ecart !== null) throw ecart;
	await creerLiens(vers, liens);
	return liens;
}

type Lien = { chemin: string; cible: string };

/**
 * Crée (sans `recursive`) les dossiers parents de `chemin` sous `racine`, en refusant tout parent qui serait un lien ou un
 * fichier : rien n'est jamais créé au travers d'un lien.
 */
async function preparerParents(racine: string, chemin: string): Promise<void> {
	let courant = racine;
	for (const part of chemin.split('/').slice(0, -1)) {
		courant = join(courant, part);
		let info;
		try {
			info = await lstat(courant);
		} catch {
			await mkdir(courant);
			continue;
		}
		if (!info.isDirectory()) throw refus('entrée placée sous un lien ou un fichier', chemin);
	}
}

async function creerLiens(vers: string, liens: Lien[]): Promise<void> {
	for (const { chemin, cible } of liens) {
		await preparerParents(vers, chemin);
		await symlink(cible.replaceAll('\\', '/'), join(vers, ...chemin.split('/')));
	}
}

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

async function deplierZip(archive: string, vers: string): Promise<Lien[]> {
	const zip = await JSZip.loadAsync(await readFile(archive));
	const objets = Object.values(zip.files);
	const entrees: Entree[] = [];
	for (const o of objets) {
		const droits = o.unixPermissions === null || o.unixPermissions === undefined ? null : Number(o.unixPermissions);
		const format = droits === null ? 0 : droits & S_IFMT;
		let genre: Genre;
		if (o.dir || format === S_IFDIR) genre = 'dossier';
		else if (format === S_IFLNK) genre = 'lien';
		else if (format === 0 || format === S_IFREG) genre = 'fichier';
		else genre = 'autre';
		// `unsafeOriginalName` : le nom tel qu'écrit dans l'archive, avant que JSZip n'en retire les `../`.
		const chemin = o.unsafeOriginalName ?? o.name;
		entrees.push({ chemin, genre, lien: genre === 'lien' ? await o.async('string') : '', brut: `zip ${format.toString(8)}` });
	}
	const retirer = niveauARetirer(entrees);
	const chemins = entrees.map((e) => valider(e, retirer));
	const liens: Lien[] = [];
	for (const [i, o] of objets.entries()) {
		const chemin = chemins[i];
		const e = entrees[i]!;
		if (chemin === null || chemin === undefined) continue;
		if (e.genre === 'lien') {
			liens.push({ chemin, cible: e.lien });
			continue;
		}
		await preparerParents(vers, chemin);
		const cible = join(vers, ...chemin.split('/'));
		if (e.genre === 'dossier') {
			await mkdir(cible, { recursive: true });
			continue;
		}
		const droits = Number(o.unixPermissions ?? 0);
		await writeFile(cible, await o.async('nodebuffer'), { flag: 'wx', mode: droits & 0o111 ? 0o755 : 0o644 });
	}
	await creerLiens(vers, liens);
	return liens;
}

/**
 * Après dépliage : chaque lien créé (ce sont les seuls : `tar` n'en crée aucun) doit mener, une fois résolu sur le disque,
 * à un élément existant du dossier. Seuls les liens notés sont visités : pas de parcours de l'arbre, donc pas de boucle
 * possible ; une boucle de liens fait échouer `realpath` (ELOOP) et le lien est refusé.
 */
async function verifierLiens(vers: string, liens: Lien[]): Promise<void> {
	const racine = await realpath(vers);
	for (const { chemin } of liens) {
		let reel: string;
		try {
			reel = await realpath(join(vers, ...chemin.split('/')));
		} catch {
			throw refus('lien symbolique cassé, en boucle ou sortant du dossier', chemin);
		}
		const rel = relative(racine, reel);
		if (rel === '..' || rel.startsWith(`..${sep}`) || absolu(rel)) throw refus('lien symbolique sortant du dossier', chemin);
	}
}

/** Déplie `archive` dans `vers` (dossier existant et vide). En cas de refus, `vers` peut être partiellement rempli : à retirer par l'appelant. */
export async function deplierArchive(archive: string, type: 'tar.gz' | 'zip', vers: string): Promise<void> {
	const liens = type === 'tar.gz' ? await deplierTar(archive, vers) : await deplierZip(archive, vers);
	await verifierLiens(vers, liens);
}
