import { describe, expect, it } from 'vitest';
import { cheminDeDepot, cheminDeLaRacine } from '../../src/domaine/chemin.ts';

describe('cheminDeLaRacine : un seul traitement pour tout chemin de dossier ou de document sous la racine', () => {
	it('accepté : tout nom, toute profondeur, caché ou non, « \\ » et « / » final normalisés ; « » = la racine', () => {
		const cas: [string, string][] = [
			['', ''],
			['Documents/Paula', 'Documents/Paula'],
			['.notes', '.notes'],
			['Clients/.archives/2026', 'Clients/.archives/2026'],
			['Projets\\Site\\', 'Projets/Site'],
			['a/b/c/d/e/f/g', 'a/b/c/d/e/f/g'],
			['mnemo', 'mnemo'],
			['Projets/_mnemo', 'Projets/_mnemo'],
			['Notes "client" ?', 'Notes "client" ?'],
			['.notes/cr.pdf', '.notes/cr.pdf'],
			// un dossier existant s'utilise quel que soit son nom : contrôles et bidi compris
			['a/\u0007b', 'a/\u0007b'],
			['docs/\u202eabc', 'docs/\u202eabc'],
		];
		for (const [brut, attendu] of cas) expect(cheminDeLaRacine(brut), brut).toEqual({ ok: true, chemin: attendu });
	});

	it('refusé avec son motif : absolu, sortie par « .. », segment vide, caractère de contrôle, dossiers de Mnemo (toute casse)', () => {
		const cas: [string, RegExp][] = [
			['/etc', /absolu/u],
			['\\x', /absolu/u],
			['C:\\Users', /absolu/u],
			['../x', /\.\./u],
			['a/./b', /\.\./u],
			['a//b', /vide/u],
			['a/\u0000b', /nul/u],
			['_mnemo', /Mnemo/u],
			['_MNEMO/fiches', /Mnemo/u],
			['.mnemo', /Mnemo/u],
			['.Mnemo/depots', /Mnemo/u],
		];
		for (const [brut, motif] of cas) {
			const r = cheminDeLaRacine(brut);
			expect(r.ok, brut).toBe(false);
			if (!r.ok) expect(r.motif, brut).toMatch(motif);
		}
	});
});

describe('cheminDeDepot : dossier existant (cheminDeLaRacine) + nom nouveau (nomDeFichierNouveauValide)', () => {
	it('un dossier au nom invisible reçoit un dépôt ; un nom nouveau invisible est refusé', () => {
		expect(cheminDeDepot('docs/\u202eabc/x.txt')).toEqual({ ok: true, chemin: 'docs/\u202eabc/x.txt' });
		expect(cheminDeDepot('Clients\\.archives\\devis.pdf')).toEqual({ ok: true, chemin: 'Clients/.archives/devis.pdf' });
		expect(cheminDeDepot('x.txt')).toEqual({ ok: true, chemin: 'x.txt' });
		for (const vers of ['docs/\u202etxt.exe', 'docs//x.txt', '_mnemo/x.md', '.mnemo/x', '../x.txt', '/tmp/x.txt', '', 'docs/']) expect(cheminDeDepot(vers).ok, vers).toBe(false);
	});
});
