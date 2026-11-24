import { chmodSync, lstatSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jetonDuDossier, renouvelerJeton } from '../../src/infra/jeton-local.ts';
import { preparerDossierLocal } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const FORME = /^[0-9a-f]{64}$/u;
const posix = process.platform !== 'win32';

async function racine(): Promise<{ racine: string; fichier: string }> {
	const r = await dossierTemporaire();
	return { racine: r, fichier: join(preparerDossierLocal(r), 'jeton') };
}

describe('jeton du dossier (.mnemo/jeton)', () => {
	it('créé une fois (64 hex, droits 0600), puis réutilisé à chaque lecture', async () => {
		const { racine: r, fichier } = await racine();
		const avis: string[] = [];
		const a = jetonDuDossier(r, (m) => avis.push(m));
		expect(a).toMatch(FORME);
		expect(readFileSync(fichier, 'utf8').trim()).toBe(a);
		if (posix) expect(statSync(fichier).mode & 0o777).toBe(0o600);
		expect(jetonDuDossier(r, (m) => avis.push(m))).toBe(a);
		// une création n'est pas un avertissement
		expect(avis).toEqual([]);
	});

	it('mauvaise forme ou vide : remplacé, avec un avertissement qui ne contient aucun jeton', async () => {
		for (const contenu of ['pas un jeton\n', '', `${'a'.repeat(63)}\n`, `${'A'.repeat(64)}\n`]) {
			const { racine: r, fichier } = await racine();
			writeFileSync(fichier, contenu, { mode: 0o600 });
			const avis: string[] = [];
			const j = jetonDuDossier(r, (m) => avis.push(m));
			expect(j).toMatch(FORME);
			expect(readFileSync(fichier, 'utf8').trim()).toBe(j);
			expect(avis).toHaveLength(1);
			expect(avis[0]).toMatch(/jeton/u);
			expect(avis[0]).not.toContain(j);
		}
	});

	it.skipIf(!posix)('droits trop larges (lisible par d’autres) : remplacé, avertissement', async () => {
		const { racine: r, fichier } = await racine();
		const ancien = 'c'.repeat(64);
		writeFileSync(fichier, `${ancien}\n`);
		chmodSync(fichier, 0o644);
		const avis: string[] = [];
		const j = jetonDuDossier(r, (m) => avis.push(m));
		expect(j).not.toBe(ancien);
		expect(statSync(fichier).mode & 0o777).toBe(0o600);
		expect(avis.join('\n')).toMatch(/droits/u);
	});

	it.skipIf(!posix)('lien symbolique : remplacé par un fichier ordinaire, la cible n’est ni lue ni écrite', async () => {
		const { racine: r, fichier } = await racine();
		const cible = join(r, 'ailleurs.txt');
		writeFileSync(cible, `${'d'.repeat(64)}\n`, { mode: 0o600 });
		symlinkSync(cible, fichier);
		const avis: string[] = [];
		const j = jetonDuDossier(r, (m) => avis.push(m));
		expect(j).not.toBe('d'.repeat(64));
		expect(lstatSync(fichier).isSymbolicLink()).toBe(false);
		expect(readFileSync(cible, 'utf8')).toBe(`${'d'.repeat(64)}\n`);
		expect(avis).toHaveLength(1);
	});

	it('renouvelerJeton : un jeton neuf, gardé, différent du précédent', async () => {
		const { racine: r, fichier } = await racine();
		const a = jetonDuDossier(r, () => {});
		const b = renouvelerJeton(r);
		expect(b).toMatch(FORME);
		expect(b).not.toBe(a);
		expect(readFileSync(fichier, 'utf8').trim()).toBe(b);
		if (posix) expect(statSync(fichier).mode & 0o777).toBe(0o600);
		expect(jetonDuDossier(r, () => {})).toBe(b);
	});
});
