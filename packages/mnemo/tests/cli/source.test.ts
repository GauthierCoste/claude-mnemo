import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { ENV_TEST } from '../aides/env-test.ts';

const MAIN = join(import.meta.dirname, '../../src/adaptateurs/cli/main.ts');

function mnemo(cwd: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
	return new Promise((resoudre) => {
		execFile(process.execPath, [MAIN, ...args], { cwd, env: { ...ENV_TEST, CLAUDE_PROJECT_DIR: '' } }, (erreur, out, err) => {
			resoudre({ code: erreur ? (erreur.code as number) : 0, out, err });
		});
	});
}

const DOC = '# Cahier des charges\n\n## Livraison\n\nLa livraison des enclos du zoo est prévue au printemps.\n';

async function memoire(): Promise<string> {
	const d = await dossierTemporaire();
	await mnemo(d, 'init', '--sans-mcp');
	await mkdir(join(d, 'docs'));
	await writeFile(join(d, 'docs', 'cdc.md'), DOC);
	return d;
}

describe('commande mnemo source', () => {
	it('référence un document, affiche le bilan, puis cherche le retrouve ; relancée : déjà référencé', async () => {
		const d = await memoire();
		const r = await mnemo(d, 'source', 'docs/cdc.md');
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/^Source écrite : sources\/Cahier des charges\.md \(1 passage indexé\) — commit [0-9a-f]+\.\n$/u);
		const encore = await mnemo(d, 'source', 'docs/cdc.md');
		expect(encore.code).toBe(0);
		expect(encore.out).toContain('Source déjà référencée : sources/Cahier des charges.md');
		const cherche = await mnemo(d, 'cherche', 'livraison', 'enclos');
		expect(cherche.out).toContain('sources/Cahier des charges.md#p-');
	});

	it('un chemin relatif au dossier courant, sous la racine, est ramené à la racine', async () => {
		const d = await memoire();
		const r = await mnemo(join(d, 'docs'), 'source', 'cdc.md');
		expect(r.code).toBe(0);
		expect(r.out).toContain('Source écrite');
	});

	it('refus (hors racine, format) : code 1 ; usage et option inconnue : code 2 ; sans mémoire : erreur', async () => {
		const d = await memoire();
		const dehors = await mnemo(d, 'source', '../hors.md');
		expect(dehors.code).toBe(1);
		expect(dehors.out).toMatch(/^Refusé : /u);
		expect((await mnemo(d, 'source', 'docs/image.png')).code).toBe(1);
		expect((await mnemo(d, 'source')).code).toBe(2);
		expect((await mnemo(d, 'source', '')).code).toBe(2);
		expect((await mnemo(d, 'source', 'docs/cdc.md', '--bidule')).code).toBe(2);
		expect((await mnemo(d, 'source', 'docs/cdc.md', '--type', 'utilisateur')).code).toBe(1);
		const vide = await dossierTemporaire();
		const sans = await mnemo(vide, 'source', 'a.md');
		expect(sans.code).toBe(1);
		expect(sans.err).toContain('Aucune mémoire Mnemo');
	});

	it('quasi-copie : code 2, rien écrit, puis --apres-proches écrit', async () => {
		const d = await memoire();
		await mnemo(d, 'source', 'docs/cdc.md');
		await writeFile(join(d, 'docs', 'copie.md'), `${DOC}\n`);
		const proches = await mnemo(d, 'source', 'docs/copie.md');
		expect(proches.code).toBe(2);
		expect(proches.out).toContain('Document très proche de :');
		expect(proches.out).toContain('--apres-proches');
		expect(proches.out).not.toContain('apres_proches');
		const apres = await mnemo(d, 'source', 'docs/copie.md', '--apres-proches');
		expect(apres.code).toBe(0);
		expect(apres.out).toContain('Source écrite');
	});

	it('un .mbox qui grandit : mnemo index l\'annonce, mnemo source référence le fil nouveau', async () => {
		const d = await memoire();
		const msg = (id: string, sujet: string, corps: string, h: number) =>
			`From x Mon Mar  2 1${h}:00:00 2026\nFrom: a@exemple.fr\nDate: Mon, 02 Mar 2026 1${h}:00:00 +0000\nSubject: ${sujet}\nMessage-ID: ${id}\nContent-Type: text/plain; charset=utf-8\n\n${corps}\n\n`;
		await mkdir(join(d, 'mails'));
		await writeFile(join(d, 'mails', 'b.mbox'), msg('<a@x>', 'Tapir', 'Le tapir arrive lundi.', 0));
		expect((await mnemo(d, 'source', 'mails/b.mbox')).code).toBe(0);
		await writeFile(join(d, 'mails', 'b.mbox'), msg('<a@x>', 'Tapir', 'Le tapir arrive lundi.', 0) + msg('<b@x>', 'Zèbre', 'Le zèbre part mardi.', 1));
		const index = await mnemo(d, 'index');
		expect(index.code).toBe(0);
		expect(index.out).toContain('1 document à compléter :\n- sources/Tapir.md : 1 fil nouveau : relancer mnemo source');
		const ajout = await mnemo(d, 'source', 'mails/b.mbox');
		expect(ajout.out).toContain('1 nouveau fil référencé');
	});
});
