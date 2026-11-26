import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { c } from 'tar';
import { describe, expect, it } from 'vitest';
import { ErreurConstruction } from '../../outils/erreur.ts';
import { createHash } from 'node:crypto';
import { archiveNodeVerifiee, extraireNode, lireVersionNode, nomArchiveNode, sommeAttendue, sommeEpinglee } from '../../outils/node-officiel.ts';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('Node officiel emporté par l’app', () => {
	it('nom de l’archive officielle', () => {
		expect(nomArchiveNode('26.13.1', 'arm64')).toBe('node-v26.13.1-darwin-arm64.tar.gz');
		expect(nomArchiveNode('26.13.1', 'x64')).toBe('node-v26.13.1-darwin-x64.tar.gz');
	});

	it('somme attendue : la ligne exacte du fichier, jamais un nom voisin', () => {
		const sommes = `${A}  node-v26.13.1-darwin-arm64.tar.gz\n${B}  node-v26.13.1-darwin-arm64.tar.xz\n${B} *autre.tar.gz\n`;
		expect(sommeAttendue(sommes, 'node-v26.13.1-darwin-arm64.tar.gz')).toBe(A);
		expect(sommeAttendue(sommes, 'autre.tar.gz')).toBe(B);
		expect(sommeAttendue(sommes, 'node-v26.13.1-darwin-arm64.tar')).toBeUndefined();
		expect(sommeAttendue('pas une somme  node.tar.gz', 'node.tar.gz')).toBeUndefined();
	});

	it('version épinglée : précise, avec ou sans « v » ; sinon refusée', () => {
		const dossier = mkdtempSync(join(tmpdir(), 'mnemo-version-node-'));
		try {
			const fichier = join(dossier, 'version-node.txt');
			writeFileSync(fichier, 'v26.13.1\n');
			expect(lireVersionNode(fichier)).toBe('26.13.1');
			writeFileSync(fichier, '26\n');
			expect(() => lireVersionNode(fichier)).toThrow(ErreurConstruction);
		} finally {
			rmSync(dossier, { recursive: true, force: true });
		}
	});

	it('extraction : bin/node et LICENSE seuls, fichiers ordinaires ; un lien à la place de bin/node est refusé', async () => {
		const dossier = mkdtempSync(join(tmpdir(), 'mnemo-extraire-node-'));
		try {
			const prefixe = 'node-v1.2.3-darwin-arm64';
			mkdirSync(join(dossier, 'src', prefixe, 'bin'), { recursive: true });
			writeFileSync(join(dossier, 'src', prefixe, 'bin', 'node'), 'binaire');
			writeFileSync(join(dossier, 'src', prefixe, 'LICENSE'), 'licence');
			writeFileSync(join(dossier, 'src', prefixe, 'README.md'), 'inutile');
			await c({ file: join(dossier, 'bonne.tar.gz'), gzip: true, cwd: join(dossier, 'src') }, [prefixe]);
			await extraireNode(join(dossier, 'bonne.tar.gz'), '1.2.3', 'arm64', join(dossier, 'sortie', 'node'));
			expect(readFileSync(join(dossier, 'sortie', 'node', 'bin', 'node'), 'utf8')).toBe('binaire');
			expect(lstatSync(join(dossier, 'sortie', 'node', 'bin', 'node')).mode & 0o777).toBe(0o755);
			expect(existsSync(join(dossier, 'sortie', 'node', 'LICENSE'))).toBe(true);
			expect(existsSync(join(dossier, 'sortie', 'node', 'README.md'))).toBe(false);

			rmSync(join(dossier, 'src', prefixe, 'bin', 'node'));
			symlinkSync('/bin/sh', join(dossier, 'src', prefixe, 'bin', 'node'));
			await c({ file: join(dossier, 'lien.tar.gz'), gzip: true, cwd: join(dossier, 'src') }, [prefixe]);
			await expect(extraireNode(join(dossier, 'lien.tar.gz'), '1.2.3', 'arm64', join(dossier, 'autre', 'node'))).rejects.toThrow(ErreurConstruction);
			expect(existsSync(join(dossier, 'autre', 'node'))).toBe(false);
		} finally {
			rmSync(dossier, { recursive: true, force: true });
		}
	});

	it('sommes épinglées : une pour chaque archive darwin de la version épinglée', () => {
		const outils = join(import.meta.dirname, '../../outils');
		const version = lireVersionNode(join(outils, 'version-node.txt'));
		const epinglees = readFileSync(join(outils, 'sommes-node.txt'), 'utf8');
		for (const arch of ['arm64', 'x64'] as const) expect(sommeEpinglee(epinglees, nomArchiveNode(version, arch))).toMatch(/^[0-9a-f]{64}$/u);
		expect(() => sommeEpinglee(epinglees, nomArchiveNode('1.2.3', 'arm64'))).toThrow(ErreurConstruction);
	});

	it('archive du cache : acceptée si épinglée et SHASUMS256.txt donnent sa somme ; refusée si SHASUMS256.txt diffère de l’épinglée', async () => {
		const cache = mkdtempSync(join(tmpdir(), 'mnemo-cache-node-'));
		try {
			const nom = nomArchiveNode('26.13.1', 'arm64');
			const archive = Buffer.from('archive factice');
			const somme = createHash('sha256').update(archive).digest('hex');
			writeFileSync(join(cache, nom), archive);
			writeFileSync(join(cache, 'SHASUMS256-v26.13.1.txt'), `${somme}  ${nom}\n`);
			await expect(archiveNodeVerifiee('26.13.1', 'arm64', cache, `${somme}  ${nom}\n`)).resolves.toBe(join(cache, nom));
			await expect(archiveNodeVerifiee('26.13.1', 'arm64', cache, `${A}  ${nom}\n`)).rejects.toThrow(/somme épinglée/u);
			// SHASUMS256.txt refusé : retiré du cache, l'archive gardée
			expect(existsSync(join(cache, 'SHASUMS256-v26.13.1.txt'))).toBe(false);
			expect(existsSync(join(cache, nom))).toBe(true);
		} finally {
			rmSync(cache, { recursive: true, force: true });
		}
	});
});
