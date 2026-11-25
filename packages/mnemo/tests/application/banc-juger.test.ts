import { describe, expect, it } from 'vitest';
import type { CasContexte } from '../../src/application/banc-contexte.ts';
import { annuler, estJuge, ordreDePresentation, prochaine, progression, repondre } from '../../src/application/banc-juger.ts';
import type { AJuger } from '../../src/application/banc-juger.ts';

const aJuger = (nom: string, chemins: string[], extra: Partial<CasContexte> = {}): CasContexte => ({
	nom,
	position: 'p',
	message: `message ${nom}`,
	premier: false,
	attendues: [],
	interdites: [],
	silence: false,
	session: 's',
	rang: 1,
	candidates: chemins.map((chemin) => ({ chemin, titre: chemin, ligne: '', listes: ['sens'], signaux: {} })),
	jugements: {},
	...extra,
});

/** Répond à toutes les fiches du premier message à juger, dans l'ordre de présentation. */
function jugerLeMessage(cas: CasContexte[], jugement: 'pertinente' | 'non_pertinente' | 'indecise'): CasContexte[] {
	const indice = prochaine(cas)!.indice;
	let courant = cas;
	while (prochaine(courant)?.indice === indice) courant = repondre(courant, prochaine(courant)!, { genre: 'juger', jugement })!.cas;
	return courant;
}

describe('jugement une fiche à la fois', () => {
	const CAS = [aJuger('étiqueté à la main', [], { candidates: undefined }), aJuger('m1', ['a.md', 'b.md', 'c.md']), aJuger('m2', ['d.md'])];

	it('la prochaine fiche : premier message à juger, première fiche non jugée de son ordre de présentation', () => {
		const cible = prochaine(CAS)!;
		expect(cible).toMatchObject({ indice: 1, place: 1, sur: 3 });
		expect(cible.candidate.chemin).toBe(ordreDePresentation(CAS[1]!)[0]!.chemin);
	});

	it('ordre de présentation mêlé mais fixe, sans rapport avec l’ordre des candidates', () => {
		const lettres = 'abcdefghijklmnop'.split('').map((l) => `${l}.md`);
		const c = aJuger('mêlé', lettres);
		expect(ordreDePresentation(c)).toEqual(ordreDePresentation({ ...c, candidates: [...c.candidates!].reverse() }));
		expect(ordreDePresentation(c).map((x) => x.chemin)).not.toEqual(lettres);
	});

	it('juger chaque fiche passe au message suivant ; la progression compte les messages jugés ; on reprend où l’on s’est arrêté', () => {
		let cas = repondre(CAS, prochaine(CAS)!, { genre: 'juger', jugement: 'pertinente' })!.cas;
		// reprise : la même liste relue (fichier) donne la fiche suivante, pas la première
		const relue = JSON.parse(JSON.stringify(cas)) as CasContexte[];
		expect(prochaine(relue)).toMatchObject({ indice: 1, place: 2 });
		expect(progression(cas)).toEqual({ messagesJuges: 0, messages: 2, sautes: 0, silences: 0 });
		cas = jugerLeMessage(cas, 'indecise');
		expect(estJuge(cas[1]!)).toBe(true);
		expect(prochaine(cas)).toMatchObject({ indice: 2, place: 1, sur: 1 });
		expect(progression(cas).messagesJuges).toBe(1);
		expect(CAS[1]!.jugements).toEqual({});
	});

	it('silence : toutes les fiches du message non pertinentes, message jugé ; refusé si une fiche est déjà jugée utile', () => {
		const fait = repondre(CAS, prochaine(CAS)!, { genre: 'silence' })!;
		expect(fait.cas[1]).toMatchObject({ silence: true, jugements: { 'a.md': 'non_pertinente', 'b.md': 'non_pertinente', 'c.md': 'non_pertinente' } });
		expect(progression(fait.cas)).toMatchObject({ messagesJuges: 1, silences: 1 });
		const utile = repondre(CAS, prochaine(CAS)!, { genre: 'juger', jugement: 'pertinente' })!.cas;
		expect(repondre(utile, prochaine(utile)!, { genre: 'silence' })).toBeNull();
	});

	it('sauter : le message ne compte plus nulle part', () => {
		const cas = repondre(CAS, prochaine(CAS)!, { genre: 'sauter' })!.cas;
		expect(prochaine(cas)!.indice).toBe(2);
		expect(progression(cas)).toEqual({ messagesJuges: 0, messages: 1, sautes: 1, silences: 0 });
	});

	it('annuler rend le message tel qu’il était', () => {
		const cible: AJuger = prochaine(CAS)!;
		const fait = repondre(CAS, cible, { genre: 'silence' })!;
		const retour = annuler(fait.cas, fait.annulation);
		expect(retour).toEqual(CAS);
		expect(prochaine(retour)).toEqual(cible);
	});

	it('plus rien à juger : null', () => {
		let cas = jugerLeMessage(CAS, 'non_pertinente');
		cas = jugerLeMessage(cas, 'pertinente');
		expect(prochaine(cas)).toBeNull();
		expect(progression(cas)).toMatchObject({ messagesJuges: 2, messages: 2 });
	});
});
