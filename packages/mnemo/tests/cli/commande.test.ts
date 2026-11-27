import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { commandeCommande } from '../../src/adaptateurs/cli/commande.ts';
import { commandeAJour, dansLePath, dossierDeCommande, ecrireCommande, retirerCommande } from '../../src/infra/commande-mnemo.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const MAIN = join(import.meta.dirname, '../../src/adaptateurs/cli/main.ts');

/** La commande est un script POSIX (shebang, droit d'exécution, PATH séparé par « : ») : Windows la refuse (avant-dernier test). */
const POSIX = process.platform !== 'win32';

describe('commande « mnemo » (~/.local/bin/mnemo)', () => {
	it.runIf(POSIX)('écrite exécutable, avec le Node absolu ; elle lance vraiment Mnemo, arguments transmis', async () => {
		const dossier = await dossierTemporaire();
		const r = ecrireCommande(dossier, { node: process.execPath, main: MAIN });
		expect(r).toEqual({ fichier: join(dossier, 'mnemo'), remplace: false });
		const fichier = join(dossier, 'mnemo');
		expect(readFileSync(fichier, 'utf8').startsWith(`#!${process.execPath}\n`)).toBe(true);
		expect(statSync(fichier).mode & 0o111).not.toBe(0);
		expect(execFileSync(fichier, ['--aide'], { encoding: 'utf8', timeout: 30_000 })).toContain('Usage : mnemo');
		expect(commandeAJour(dossier, { node: process.execPath, main: MAIN })).toBe(true);
		expect(commandeAJour(dossier, { node: process.execPath, main: '/ailleurs/main.ts' })).toBe(false);
	});

	it('remplace la nôtre ; ne touche jamais un « mnemo » étranger ; refuse un Node à espace', async () => {
		const dossier = await dossierTemporaire();
		ecrireCommande(dossier, { node: process.execPath, main: MAIN });
		expect(ecrireCommande(dossier, { node: process.execPath, main: '/autre/main.ts' })).toMatchObject({ remplace: true });
		const etranger = await dossierTemporaire();
		writeFileSync(join(etranger, 'mnemo'), '#!/bin/sh\necho autre\n');
		expect(ecrireCommande(etranger, { node: process.execPath, main: MAIN })).toHaveProperty('refus');
		expect(retirerCommande(etranger)).toHaveProperty('refus');
		expect(readFileSync(join(etranger, 'mnemo'), 'utf8')).toContain('echo autre');
		expect(ecrireCommande(dossier, { node: '/Application Support/node', main: MAIN })).toHaveProperty('refus');
	});

	it('retirer : la nôtre disparaît ; absente : dit absente', async () => {
		const dossier = await dossierTemporaire();
		ecrireCommande(dossier, { node: process.execPath, main: MAIN });
		expect(retirerCommande(dossier)).toEqual({ retire: join(dossier, 'mnemo') });
		expect(existsSync(join(dossier, 'mnemo'))).toBe(false);
		expect(retirerCommande(dossier)).toEqual({ absent: join(dossier, 'mnemo') });
	});

	it.runIf(POSIX)('mnemo commande : installe dans <maison>/.local/bin, signale un PATH qui ne le contient pas', async () => {
		const maison = await dossierTemporaire();
		const lignes: string[] = [];
		await commandeCommande([], { maison, plateforme: 'darwin', path: '/usr/bin', ecrire: (l) => void lignes.push(l) });
		expect(existsSync(join(dossierDeCommande(maison), 'mnemo'))).toBe(true);
		expect(lignes.join('\n')).toContain('export PATH=');
		const lignes2: string[] = [];
		await commandeCommande([], { maison, plateforme: 'darwin', path: `/usr/bin:${dossierDeCommande(maison)}`, ecrire: (l) => void lignes2.push(l) });
		expect(lignes2.join('\n')).toContain('Commande mise à jour');
		expect(lignes2.join('\n')).not.toContain('export PATH=');
		await commandeCommande(['--retirer'], { maison, plateforme: 'darwin', ecrire: () => {} });
		expect(existsSync(join(dossierDeCommande(maison), 'mnemo'))).toBe(false);
	});

	it('mnemo commande : Windows refusé ; option inconnue', async () => {
		const maison = await dossierTemporaire();
		await expect(commandeCommande([], { maison, plateforme: 'win32' })).rejects.toThrow(/pnpm link --global/u);
		await expect(commandeCommande(['--x'], { maison })).rejects.toThrow(/Option inconnue/u);
	});

	it.runIf(POSIX)('dansLePath : compare des chemins résolus', () => {
		expect(dansLePath('/a/b', '/x:/a/b/')).toBe(true);
		expect(dansLePath('/a/b', '/x:/a')).toBe(false);
		expect(dansLePath('/a/b', undefined)).toBe(false);
	});
});
