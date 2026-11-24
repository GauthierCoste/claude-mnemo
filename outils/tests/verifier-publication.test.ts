import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { principal } from '../verifier-publication.ts';

// Les jetons de test sont assemblés à l'exécution : ce fichier ne contient lui-même aucun secret reconnaissable.
const JETON_GITHUB = 'ghp' + '_' + 'Zx8Qm2Lp7Rt4Vw9Ny3Kb6Hd1Fg5Js0Ac8Ue2';
const CLE_AWS = 'AKIA' + 'QZ7XK2M4PL9RT3VW';
const CLE_PEM = '-----BEGIN ' + 'RSA PRIVATE KEY-----';

let dossier: string;
let config: string;
let liste: string;
let exceptions: string;
let termes: string;
let identite: string;

beforeEach(() => {
	dossier = mkdtempSync(join(tmpdir(), 'mnemo-publication-'));
	config = mkdtempSync(join(tmpdir(), 'mnemo-publication-config-'));
	liste = join(config, 'liste-blanche.txt');
	exceptions = join(config, 'exceptions.txt');
	termes = join(config, 'termes.txt');
	identite = join(config, 'identite-publique.txt');
	writeFileSync(liste, '# Publiable\nsrc/**\nREADME.md\n!src/prive/**\n');
	writeFileSync(exceptions, '# Aucune exception.\n');
	writeFileSync(termes, '# Un terme par ligne.\n');
	writeFileSync(identite, '# Aucune identité publique.\n');
});

afterEach(() => {
	rmSync(dossier, { recursive: true, force: true });
	rmSync(config, { recursive: true, force: true });
});

function ecrire(chemin: string, contenu: string | Buffer): void {
	mkdirSync(dirname(join(dossier, chemin)), { recursive: true });
	writeFileSync(join(dossier, chemin), contenu);
}

function git(...a: string[]): Buffer {
	return execFileSync('git', a, { cwd: dossier, stdio: 'pipe' });
}

function commit(): void {
	git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'x');
}

/** Mode git : sans dossier, depuis le dépôt de test. */
async function enGit(args: string[] = []): Promise<{ code: number; sortie: string; erreur: string }> {
	let sortie = '';
	let erreur = '';
	const code = await principal(['--liste-blanche', liste, '--exceptions', exceptions, '--identite', identite, ...args], { MNEMO_TERMES_INTERDITS: termes }, { ecrire: (t) => (sortie += t), erreur: (t) => (erreur += t) }, dossier);
	return { code, sortie, erreur };
}

/** PNG minimal (1 × 1) avec des blocs de texte. */
function png(...blocs: [string, Buffer][]): Buffer {
	const bloc = (type: string, donnees: Buffer) => {
		const corps = Buffer.concat([Buffer.from(type, 'latin1'), donnees]);
		const tete = Buffer.alloc(4);
		tete.writeUInt32BE(donnees.length);
		const queue = Buffer.alloc(4);
		queue.writeUInt32BE(crc32(corps));
		return Buffer.concat([tete, corps, queue]);
	};
	const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		bloc('IHDR', ihdr),
		...blocs.map(([t, d]) => bloc(t, d)),
		bloc('IEND', Buffer.alloc(0)),
	]);
}

async function lancer(args: string[] = [], env: Record<string, string> = {}): Promise<{ code: number; sortie: string; erreur: string }> {
	let sortie = '';
	let erreur = '';
	const code = await principal(
		[dossier, '--liste-blanche', liste, '--exceptions', exceptions, '--identite', identite, ...args],
		{ MNEMO_TERMES_INTERDITS: termes, ...env },
		{ ecrire: (t) => (sortie += t), erreur: (t) => (erreur += t) },
	);
	return { code, sortie, erreur };
}

type Constat = { regle: string; fichier: string; ligne?: number; lieu?: string; detail: string; extrait?: string };
async function constats(args: string[] = [], env: Record<string, string> = {}): Promise<Constat[]> {
	const r = await lancer(['--json', ...args], env);
	return (JSON.parse(r.sortie) as { constats: Constat[] }).constats;
}

describe('verifier-publication', () => {
	it('arbre propre : code 0', async () => {
		ecrire('src/a.ts', 'export const a = 1;\n');
		ecrire('README.md', '# Projet\n');
		const r = await lancer();
		expect(r.code).toBe(0);
		expect(r.sortie).toContain('aucun constat');
	});

	it('fichier hors liste blanche (ou exclu par « ! ») : échec, avec la liste', async () => {
		ecrire('src/a.ts', 'export const a = 1;\n');
		ecrire('docs/conception.md', '# Conception\n');
		ecrire('src/prive/notes.md', 'notes\n');
		const r = await lancer();
		expect(r.code).toBe(1);
		expect(r.sortie).toContain('docs/conception.md');
		expect(r.sortie).toContain('src/prive/notes.md');
		expect(r.sortie).not.toContain('src/a.ts');
	});

	it('terme interdit trouvé malgré la casse et les accents (contenu et chemin), jamais affiché : chemins masqués', async () => {
		writeFileSync(termes, '# Clients\nÉléphant Rose\n\nzébulon\n');
		ecrire('src/a.ts', '// Le client ELEPHANT ROSE paie à trente jours.\nconst x = 1;\nconst y = "Zebulon";\n');
		ecrire('src/Zébulon/b.md', 'rien\n');
		const r = await lancer();
		expect(r.code).toBe(1);
		const texte = (r.sortie + r.erreur).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
		expect(texte).not.toContain('elephant');
		expect(texte).not.toContain('zebulon');
		expect(r.sortie).toContain('src/a.ts:1');
		expect(r.sortie).toContain('terme n°2');
		expect(r.sortie).toContain('src/a.ts:3');
		expect(r.sortie).toContain('terme n°4');
		const json = await lancer(['--json']);
		const sansAccents = json.sortie.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
		expect(sansAccents).not.toContain('elephant');
		const c = (JSON.parse(json.sortie) as { constats: Constat[] }).constats.filter((k) => k.regle === 'terme-interdit');
		expect(c.map((k) => `${k.fichier}:${k.ligne ?? 0} ${k.detail}`).sort()).toEqual(['src/a.ts:1 terme n°2', 'src/a.ts:3 terme n°4', 'src/[terme n°4]/b.md:0 terme n°4'].sort());
		expect(c.every((k) => k.extrait === undefined)).toBe(true);
	});

	it('secrets usuels détectés, extraits masqués', async () => {
		ecrire(
			'src/secrets.ts',
			[
				`const a = "${JETON_GITHUB}";`,
				`const b = "${CLE_AWS}";`,
				CLE_PEM,
				`fetch(u, { headers: { Authorization: "Bearer ${'eyJhbGciOiJIUzI1NiJ9' + '.k8Pq2Zr7Tw'}" } });`,
				`const url = "https://admin:${'s3cr3t' + 'Pass'}@base.exemple.fr/db";`,
				`const glab = "${'glpat' + '-' + 'Wq3Er5Ty7Ui9Op1As2Df'}";`,
				`const apiKey = "${'q8ZrT2vLm9Xc4Bn7Kd1Wf6Hs3Jp0Gy5'}";`,
				`const motif = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; const token = "${'a'.repeat(30)}";`,
			].join('\n') + '\n',
		);
		const c = (await constats()).filter((k) => k.regle === 'secret');
		expect(c.map((k) => `${k.ligne} ${k.detail}`)).toEqual([
			'1 jeton GitHub',
			'2 clé AWS',
			'3 clé privée',
			'4 jeton Bearer',
			'5 URL avec identifiants',
			'6 jeton GitLab',
			'7 chaîne à forte entropie',
		]);
		const sortie = (await lancer()).sortie;
		expect(sortie).not.toContain(JETON_GITHUB);
		expect(sortie).not.toContain(CLE_AWS);
	});

	it('exception documentée respectée ; une exception sans commentaire est refusée', async () => {
		ecrire('src/doc.md', 'Exemple : https://utilisateur:motdepasse@depot.exemple.fr\n');
		ecrire('src/autre.md', 'Exemple : https://utilisateur:motdepasse@depot.exemple.fr\n');
		writeFileSync(exceptions, '# Exemple d’URL de la documentation, sans vrai mot de passe.\nsecret:url-identifiants src/doc.md ^https://utilisateur:motdepasse@\n');
		const c = await constats();
		expect(c.map((k) => k.fichier)).toEqual(['src/autre.md']);

		writeFileSync(exceptions, 'secret src/doc.md\n');
		const r = await lancer();
		expect(r.code).toBe(1);
		expect(r.erreur).toContain('commentaire');
	});

	it('chemins personnels et adresses e-mail hors exemple détectés', async () => {
		ecrire(
			'src/a.ts',
			[
				"const h = '/Users/x/Notes';",
				"const w = '~/Workspace/Projets/Truc';",
				"const c = '-Users-x-Projets-Truc';",
				"const e = '$HOME/Workspace/a', f = 'travail-workspace-projets-truc';",
				"const m = 'paul@societe.fr';",
				"const ok = 'marc@exemple.fr alice@example.com b@brasserie.example';",
				"const p = 'pnpm@12.15.0 @types/node';",
				"const s = '/Users/Shared/x';",
			].join('\n') + '\n',
		);
		const c = await constats();
		expect(c.map((k) => `${k.ligne} ${k.regle} ${k.extrait}`)).toEqual([
			'1 chemin-personnel /Users/x',
			'2 chemin-personnel ~/Workspace',
			'2 chemin-personnel Workspace/Projets',
			'3 chemin-personnel -Users-x-',
			'4 chemin-personnel $HOME/Workspace',
			'4 chemin-personnel workspace-projets',
			'5 email paul@societe.fr',
		]);
	});

	it('fichier de plus de 1 Mo et binaire inattendu détectés ; image admise', async () => {
		ecrire('src/gros.txt', 'a'.repeat(1024 * 1024 + 1));
		ecrire('src/donnees.bin', Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]));
		ecrire('src/icone.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]));
		const c = await constats();
		expect(c.map((k) => `${k.fichier} ${k.regle}`)).toEqual(['src/donnees.bin binaire', 'src/gros.txt fichier-lourd']);
	});

	it('--json : rapport lisible par un programme', async () => {
		ecrire('src/a.ts', "const h = '/Users/x/Notes';\n");
		const r = await lancer(['--json']);
		expect(r.code).toBe(1);
		const rapport = JSON.parse(r.sortie) as { ok: boolean; fichiers: number; constats: Constat[]; avertissements: string[] };
		expect(rapport.ok).toBe(false);
		expect(rapport.fichiers).toBe(1);
		expect(rapport.constats).toEqual([{ regle: 'chemin-personnel', fichier: 'src/a.ts', ligne: 1, detail: 'chemin personnel', extrait: '/Users/x' }]);
	});

	it('fichier des termes absent : avertissement clair, code 0 ; --strict échoue', async () => {
		ecrire('src/a.ts', 'export const a = 1;\n');
		const absent = join(dossier, '..', 'aucun-fichier-de-termes.txt');
		const r = await lancer([], { MNEMO_TERMES_INTERDITS: absent });
		expect(r.code).toBe(0);
		expect(r.erreur).toContain('termes interdits');
		expect(r.erreur).toContain(absent);
		const strict = await lancer(['--strict'], { MNEMO_TERMES_INTERDITS: absent });
		expect(strict.code).toBe(1);
		const json = JSON.parse((await lancer(['--json'], { MNEMO_TERMES_INTERDITS: absent })).sortie) as { avertissements: string[] };
		expect(json.avertissements.join('\n')).toContain('termes interdits');
	});

	it('sans MNEMO_TERMES_INTERDITS : ~/.config/mnemo/termes-interdits.txt (du HOME donné)', async () => {
		ecrire('src/a.ts', 'const x = "zebulon";\n');
		const home = mkdtempSync(join(tmpdir(), 'mnemo-publication-home-'));
		mkdirSync(join(home, '.config', 'mnemo'), { recursive: true });
		writeFileSync(join(home, '.config', 'mnemo', 'termes-interdits.txt'), 'Zébulon\n');
		let sortie = '';
		const code = await principal([dossier, '--liste-blanche', liste, '--exceptions', exceptions], { HOME: home }, { ecrire: (t) => (sortie += t), erreur: () => {} });
		rmSync(home, { recursive: true, force: true });
		expect(code).toBe(1);
		expect(sortie).toContain('terme n°1');
	});

	it('sans dossier : le contenu commité (HEAD), pas les fichiers non suivis', async () => {
		git('init', '-q');
		ecrire('src/a.ts', 'export const a = 1;\n');
		ecrire('src/non-suivi.ts', "const h = '/Users/x/Notes';\n");
		ecrire('hors-liste.md', 'non suivi\n');
		git('add', 'src/a.ts');
		commit();
		const r = await enGit(['--json']);
		const rapport = JSON.parse(r.sortie) as { fichiers: number; constats: Constat[] };
		expect(r.code).toBe(0);
		expect(rapport.fichiers).toBe(1);
	});

	it('mode git : un terme commité puis effacé de la copie de travail est trouvé ; --commit vérifie un commit précis', async () => {
		writeFileSync(termes, 'Zébulon\n');
		git('init', '-q');
		ecrire('src/a.ts', 'const client = "Zebulon";\n');
		git('add', 'src/a.ts');
		commit();
		ecrire('src/a.ts', 'const client = "X";\n');
		const r = await enGit(['--json']);
		expect(r.code).toBe(1);
		expect((JSON.parse(r.sortie) as { constats: Constat[] }).constats.map((k) => `${k.fichier}:${k.ligne} ${k.detail}`)).toEqual(['src/a.ts:1 terme n°1']);
		expect(r.erreur).toContain('copie de travail diffère de HEAD');

		git('add', 'src/a.ts');
		commit();
		expect((await enGit()).code).toBe(0);
		expect((await enGit(['--commit', 'HEAD~1'])).code).toBe(1);
	});

	it.skipIf(process.platform === 'win32')('liens symboliques : avertissement en mode dossier, cible vérifiée ; cible hors du dépôt refusée en mode git', async () => {
		ecrire('src/a.ts', 'export const a = 1;\n');
		symlinkSync('/Users/x/secret', join(dossier, 'src', 'lien'));
		const r = await lancer(['--json']);
		expect(r.erreur).toContain('src/lien : lien symbolique');
		expect((JSON.parse(r.sortie) as { constats: Constat[] }).constats.map((k) => `${k.regle} ${k.lieu ?? ''} ${k.extrait}`)).toEqual([
			'lien-symbolique  /Users/x/secret',
			'chemin-personnel cible du lien /Users/x',
		]);

		rmSync(join(dossier, 'src', 'lien'));
		git('init', '-q');
		symlinkSync('../../dehors', join(dossier, 'src', 'dehors'));
		symlinkSync('a.ts', join(dossier, 'src', 'dedans'));
		git('add', 'src');
		commit();
		const c = (JSON.parse((await enGit(['--json'])).sortie) as { constats: Constat[] }).constats;
		expect(c.map((k) => `${k.fichier} ${k.regle}`)).toEqual(['src/dehors lien-symbolique']);
	});

	it('termes : les 14 variantes usuelles (séparateurs, slugs, ligatures, pleine chasse, œ, nom de fichier) sont trouvées', async () => {
		writeFileSync(termes, 'Verdurette\nOmbelle Rail\nCœur Vaillant\nfiche\n');
		const variantes = [
			'Vérdurette', // e accent aigu précomposé
			'{"client":"Verdurette","x":1}',
			'verdurette',
			'Verdu-rette',
			'verdu_rette',
			'VERDU RETTE',
			'ombellerail',
			'ombelle-rail',
			'Ombelle  Rail',
			'Ombelle Rail',
			'Coeur Vaillant',
			'ﬁche',
			'Ｖｅｒｄｕｒｅｔｔｅ',
		];
		ecrire('src/a.txt', variantes.join('\n') + '\n');
		ecrire('src/Verdu-Rette.txt', 'rien\n');
		const r = await lancer(['--json']);
		const c = (JSON.parse(r.sortie) as { constats: Constat[] }).constats.filter((k) => k.regle === 'terme-interdit');
		expect(c.map((k) => (k.ligne === undefined ? k.fichier : String(k.ligne)))).toEqual([
			'src/[terme n°1].txt',
			'1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
		]);
		const sortie = (r.sortie + r.erreur + (await lancer()).sortie).toLowerCase();
		for (const morceau of ['rette', 'ombelle', 'rail', 'coeur', 'cœur', 'vaillant', 'ﬁ']) expect(sortie).not.toContain(morceau);
	});

	it('identité publique : un terme admis seulement dans le texte exact déclaré, et seulement dans son fichier', async () => {
		writeFileSync(termes, 'Zébulon\nMartinou\nzebulonmartinou\n');
		writeFileSync(identite, "# Auteur et dépôt public.\nREADME.md Zébulon Martinou\nsrc/*.md github.com/ZebulonMartinou/projet\n");
		ecrire('README.md', '# Projet\n\nCopyright Zébulon Martinou.\n');
		ecrire('src/doc.md', 'git clone https://github.com/ZebulonMartinou/projet.git\nAutre : zebulon martinou\n');
		ecrire('src/a.ts', "// Zébulon Martinou\n");
		const c = (await constats()).filter((k) => k.regle === 'terme-interdit');
		expect(c.map((k) => `${k.fichier}:${k.ligne}`)).toEqual(['src/a.ts:1', 'src/a.ts:1', 'src/a.ts:1', 'src/doc.md:2', 'src/doc.md:2', 'src/doc.md:2']);
	});

	it('identité publique : une ligne sans commentaire au-dessus est refusée, sans afficher le texte', async () => {
		writeFileSync(termes, 'Zébulon\n');
		writeFileSync(identite, 'README.md Zébulon Martinou\n');
		ecrire('README.md', 'Zébulon Martinou\n');
		const r = await lancer();
		expect(r.code).toBe(1);
		expect(r.erreur).toContain('identite-publique.txt:1');
		expect((r.sortie + r.erreur).toLowerCase()).not.toContain('zébulon');
	});

	it('termes courts (moins de 4 lettres et chiffres) : comparés en mot entier, sans faux positif', async () => {
		writeFileSync(termes, 'RT\n');
		ecrire('src/a.ts', 'const port = start;\nconst chemin = "projets/rt/rt.md";\nconst x = "R-T";\nconst y = "RTC";\n');
		const c = (await constats()).filter((k) => k.regle === 'terme-interdit');
		expect(c.map((k) => k.ligne)).toEqual([2, 3]);
	});

	it('binaires fouillés : métadonnées PNG (tEXt, zTXt), chaînes UTF-16, flux et chaînes PDF', async () => {
		writeFileSync(termes, 'Zébulon\n');
		ecrire(
			'src/capture.png',
			png(
				['tEXt', Buffer.concat([Buffer.from('Author\0', 'latin1'), Buffer.from('Zébulon', 'latin1')])],
				['zTXt', Buffer.concat([Buffer.from('Comment\0\0', 'latin1'), deflateSync(Buffer.from('capturé dans /Users/x/Captures'))])],
			),
		);
		ecrire('src/donnees.bin', Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('dossier /Users/x/doc', 'utf16le')]));
		const hex = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('Zébulon', 'utf16le').swap16()]).toString('hex');
		ecrire(
			'src/doc.pdf',
			Buffer.concat([
				Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'),
				deflateSync(Buffer.from('BT (Fichier de /Users/x/Bureau) Tj ET')),
				Buffer.from(`\nendstream\nendobj\n2 0 obj\n<< /Author <${hex}> >>\nendobj\n%%EOF\n`, 'latin1'),
			]),
		);
		const c = await constats();
		expect(c.map((k) => `${k.fichier} ${k.regle} ${k.lieu} ${k.extrait ?? k.detail}`)).toEqual([
			'src/capture.png terme-interdit PNG tEXt terme n°1',
			'src/capture.png chemin-personnel PNG zTXt /Users/x',
			'src/doc.pdf terme-interdit PDF chaîne hexadécimale, octet 133 terme n°1',
			'src/doc.pdf chemin-personnel PDF flux 1, octet 0 /Users/x',
			'src/donnees.bin binaire undefined binaire inattendu',
			'src/donnees.bin chemin-personnel octet 3 (UTF-16) /Users/x',
		]);
	});

	it('racine et fichier des termes jamais affichés en clair quand ils contiennent un terme', async () => {
		const racine = mkdtempSync(join(tmpdir(), 'zebulon-racine-'));
		const dossierTermes = mkdtempSync(join(tmpdir(), 'zebulon-config-'));
		const fichierTermes = join(dossierTermes, 'termes.txt');
		writeFileSync(fichierTermes, 'Zébulon\n');
		mkdirSync(join(racine, 'src'));
		writeFileSync(join(racine, 'src', 'a.ts'), "const h = '/Users/x/Notes';\n");
		let sortie = '';
		const io = { ecrire: (t: string) => (sortie += t), erreur: (t: string) => (sortie += t) };
		const env = { MNEMO_TERMES_INTERDITS: fichierTermes };
		const codes = [
			await principal([racine, '--liste-blanche', liste, '--exceptions', exceptions], env, io),
			await principal([racine, '--json', '--liste-blanche', liste, '--exceptions', exceptions], env, io),
			await principal([racine, '--liste-blanche', liste, '--exceptions', join(racine, 'absent.txt')], env, io),
			await principal(['--liste-blanche', liste, '--exceptions', exceptions], env, io, racine),
		];
		rmSync(racine, { recursive: true, force: true });
		rmSync(dossierTermes, { recursive: true, force: true });
		expect(codes).toEqual([1, 1, 1, 1]);
		expect(sortie).toContain('[terme n°1]');
		expect(sortie.toLowerCase()).not.toContain('zebulon');
	});

	it('autres secrets : JWT, clé Google, Stripe, npm', async () => {
		const jwt = 'eyJ' + 'hbGciOiJIUzI1NiJ9' + '.' + 'eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0' + '.' + 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
		const google = 'AIza' + 'SyD3x9Kq2Lm7Np4Rs8Tv1Wx5Yz0Ab6Cd9EfGh'.slice(0, 35);
		const stripe = 'sk' + '_live_' + 'Q9w8E7r6T5y4U3i2O1p0As';
		const npm = 'npm' + '_' + 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2Yz3'.slice(0, 36);
		ecrire('src/s.ts', [jwt, google, stripe, npm].map((v, i) => `const v${i} = "${v}";`).join('\n') + '\n');
		const c = await constats();
		expect(c.map((k) => `${k.ligne} ${k.detail}`)).toEqual(['1 jeton JWT', '2 clé Google', '3 clé Stripe', '4 jeton npm']);
	});

	it('se lance en ligne de commande (node, sans compilation)', () => {
		ecrire('src/a.ts', "const h = '/Users/x/Notes';\n");
		const script = join(import.meta.dirname, '..', 'verifier-publication.ts');
		let code = 0;
		let sortie = '';
		try {
			execFileSync(process.execPath, [script, dossier, '--json', '--liste-blanche', liste, '--exceptions', exceptions], {
				env: { ...process.env, MNEMO_TERMES_INTERDITS: termes },
				stdio: 'pipe',
			});
		} catch (e) {
			const err = e as { status: number; stdout: Buffer };
			code = err.status;
			sortie = err.stdout.toString();
		}
		expect(code).toBe(1);
		expect((JSON.parse(sortie) as { constats: Constat[] }).constats[0]?.regle).toBe('chemin-personnel');
	});
});
