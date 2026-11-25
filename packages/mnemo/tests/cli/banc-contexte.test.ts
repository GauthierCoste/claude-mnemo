import { describe, expect, it } from 'vitest';
import { lireCasContexte, lireOptionsContexte } from '../../src/adaptateurs/cli/banc-contexte.ts';
import { ecranDeJugement } from '../../src/adaptateurs/cli/banc-juger.ts';
import type { CasContexte } from '../../src/application/banc-contexte.ts';
import { prochaine } from '../../src/application/banc-juger.ts';

const JUGE: CasContexte = {
	nom: 'abcdef12 #3',
	position: 'projets/Vitrail',
	message: 'et pour la cuisson des grisailles ?',
	premier: false,
	attendues: [],
	interdites: [],
	silence: false,
	session: 'abcdef1234',
	rang: 3,
	precedent: 'parle-moi du chantier de vitrail',
	candidates: [
		{
			chemin: 'pratiques/cuisson-grisailles.md',
			titre: 'Cuisson des grisailles',
			ligne: 'Températures et durées de cuisson.',
			listes: ['sens', 'reranker'],
			signaux: { seule: { logit: 2.5, cosinus: 0.71, cosinusRelatif: 0.12, bm25Relatif: 1 } },
		},
	],
	jugements: {},
};

describe('banc-contexte.json', () => {
	it('relit à l’identique un cas jugé (session, rang, message d’avant, candidates, signaux, jugements)', () => {
		const avecJugement = { ...JUGE, jugements: { 'pratiques/cuisson-grisailles.md': 'pertinente' as const }, saute: true };
		expect(lireCasContexte(JSON.stringify([avecJugement]))).toEqual([avecJugement]);
	});

	it('un ancien cas étiqueté reste lisible, sans champ ajouté', () => {
		const ancien = { nom: 'n', position: 'p', message: 'm', premier: true, attendues: ['A.md'], interdites: [], silence: false };
		expect(lireCasContexte(JSON.stringify([ancien]))).toEqual([ancien]);
	});

	it('jugement inconnu : erreur lisible', () => {
		expect(() => lireCasContexte(JSON.stringify([{ ...JUGE, jugements: { 'a.md': 'peut-être' } }]))).toThrow('jugement inconnu');
	});
});

describe('options de mnemo banc contexte', () => {
	it('--extraire avec ou sans session, --nombre', () => {
		expect(lireOptionsContexte(['--extraire'])).toMatchObject({ extraire: true, session: null, nombre: null });
		expect(lireOptionsContexte(['--extraire', 'abc', '--nombre', '120'])).toMatchObject({ extraire: true, session: 'abc', nombre: 120 });
		expect(lireOptionsContexte(['--juger'])).toMatchObject({ juger: true });
	});

	it('combinaisons refusées', () => {
		expect(() => lireOptionsContexte(['--juger', '--extraire'])).toThrow('ne vont pas ensemble');
		expect(() => lireOptionsContexte(['--nombre', '3'])).toThrow('--nombre');
		expect(() => lireOptionsContexte(['--extraire', '--nombre', 'x'])).toThrow('Nombre');
		expect(() => lireOptionsContexte(['--juger', '--json'])).toThrow('--json');
		expect(() => lireOptionsContexte(['--inconnue'])).toThrow('Option inconnue');
	});
});

describe('écran de jugement', () => {
	it('montre la progression, le message et celui d’avant, puis titre, chemin et première ligne ; jamais une note ni un rang', () => {
		const ecran = ecranDeJugement([JUGE], prochaine([JUGE])!, { couleurs: false });
		expect(ecran).toContain('0 / 1 messages jugés · fiche 1 / 1');
		expect(ecran).toContain('session abcdef12 · message porteur n° 3 · position projets/Vitrail');
		expect(ecran).toContain("Message d'avant : parle-moi du chantier de vitrail");
		expect(ecran).toContain('et pour la cuisson des grisailles ?');
		expect(ecran).toContain('Cuisson des grisailles');
		expect(ecran).toContain('pratiques/cuisson-grisailles.md');
		expect(ecran).toContain('Températures et durées de cuisson.');
		expect(ecran).toContain('o oui · n non · i indécis');
		expect(ecran).not.toMatch(/2\.5|0\.71|reranker|logit/u);
	});

	it('un long message est coupé à l’écran, le reste compté', () => {
		const long = { ...JUGE, message: 'x'.repeat(2000) };
		expect(ecranDeJugement([long], prochaine([long])!, { couleurs: false })).toContain('(500 caractères de plus)');
	});
});
