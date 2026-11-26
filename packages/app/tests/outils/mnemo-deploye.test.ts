import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErreurConstruction } from '../../outils/erreur.ts';
import { dependancesSansChemin, elaguerNodePty, precompilesNodePty, verifierSansLien } from '../../outils/mnemo-deploye.ts';

let dossier: string;
beforeEach(() => {
	dossier = mkdtempSync(join(tmpdir(), 'mnemo-deploye-'));
});
afterEach(() => {
	rmSync(dossier, { recursive: true, force: true });
});

/** Un node-pty factice : ses précompilés pour macOS et Windows, et ses sources. */
function nodePty(): string {
	const racine = join(dossier, 'node-pty');
	const fichiers: Record<string, string[]> = {
		'darwin-arm64': ['pty.node', 'spawn-helper'],
		'darwin-x64': ['pty.node', 'spawn-helper'],
		'win32-x64': ['pty.node', 'pty.pdb', 'conpty.node', 'conpty.pdb', 'conpty_console_list.node', 'winpty.dll', 'winpty-agent.exe', 'conpty/conpty.dll', 'conpty/OpenConsole.exe'],
		'win32-arm64': ['pty.node', 'conpty.node'],
	};
	for (const [plateforme, noms] of Object.entries(fichiers)) {
		for (const nom of noms) {
			mkdirSync(join(racine, 'prebuilds', plateforme, nom, '..'), { recursive: true });
			writeFileSync(join(racine, 'prebuilds', plateforme, nom), 'x');
		}
	}
	for (const d of ['deps', 'src', 'scripts']) mkdirSync(join(racine, d));
	mkdirSync(join(racine, 'lib'));
	return racine;
}

describe('node-pty emporté', () => {
	it('macOS : seuls les précompilés de l’architecture, spawn-helper exécutable', () => {
		const racine = nodePty();
		elaguerNodePty(racine, { plateforme: 'darwin', arch: 'arm64' });
		expect(existsSync(join(racine, 'prebuilds', 'darwin-arm64', 'pty.node'))).toBe(true);
		expect(lstatSync(join(racine, 'prebuilds', 'darwin-arm64', 'spawn-helper')).mode & 0o111).not.toBe(0);
		for (const autre of ['darwin-x64', 'win32-x64', 'win32-arm64']) expect(existsSync(join(racine, 'prebuilds', autre))).toBe(false);
		expect(existsSync(join(racine, 'src'))).toBe(false);
		expect(existsSync(join(racine, 'lib'))).toBe(true);
	});

	it('Windows : win32-x64 seul (ConPTY compris), sans spawn-helper ni symboles de débogage', () => {
		const racine = nodePty();
		elaguerNodePty(racine, { plateforme: 'win32', arch: 'x64' });
		const gardes = join(racine, 'prebuilds', 'win32-x64');
		for (const nom of ['pty.node', 'conpty.node', 'conpty_console_list.node', 'winpty.dll', 'conpty/conpty.dll', 'conpty/OpenConsole.exe']) expect(existsSync(join(gardes, nom))).toBe(true);
		for (const nom of ['pty.pdb', 'conpty.pdb']) expect(existsSync(join(gardes, nom))).toBe(false);
		for (const autre of ['darwin-arm64', 'darwin-x64', 'win32-arm64']) expect(existsSync(join(racine, 'prebuilds', autre))).toBe(false);
		expect(precompilesNodePty({ plateforme: 'win32', arch: 'x64' })).toEqual({ dossier: 'win32-x64', exiges: ['pty.node', 'conpty.node'] });
	});

	it('précompilé exigé absent, ou node-pty absent : la construction s’arrête', () => {
		const racine = nodePty();
		rmSync(join(racine, 'prebuilds', 'win32-x64', 'conpty.node'));
		expect(() => elaguerNodePty(racine, { plateforme: 'win32', arch: 'x64' })).toThrow(ErreurConstruction);
		expect(() => elaguerNodePty(join(dossier, 'absent'), { plateforme: 'darwin', arch: 'arm64' })).toThrow(ErreurConstruction);
	});
});

describe('arbre emporté', () => {
	it('dépendances vers les paquets du dépôt : leur version, plus aucun chemin de la machine ; autre dépendance locale refusée', () => {
		const versions = { '@mnemo/commun': '1.8.0', '@mnemo/contrat': '1.8.0' };
		const paquet = { dependencies: { '@mnemo/commun': '@mnemo/commun@file:///Users/exemple/depot/packages/commun', '@mnemo/contrat': 'workspace:*', ws: '8.23.0' } };
		expect(dependancesSansChemin(paquet, versions, 'package.json')).toEqual({ '@mnemo/commun': '1.8.0', '@mnemo/contrat': '1.8.0', ws: '8.23.0' });
		expect(() => dependancesSansChemin({ dependencies: { autre: 'file:../autre' } }, versions, 'package.json')).toThrow(ErreurConstruction);
		expect(dependancesSansChemin({}, versions, 'package.json')).toEqual({});
	});

	it('aucun lien symbolique accepté, même relatif et interne', () => {
		mkdirSync(join(dossier, 'a', 'b'), { recursive: true });
		writeFileSync(join(dossier, 'a', 'b', 'f'), 'x');
		verifierSansLien(dossier);
		symlinkSync(join('b', 'f'), join(dossier, 'a', 'lien'));
		expect(() => verifierSansLien(dossier)).toThrow(/Lien refusé/u);
	});
});
