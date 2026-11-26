import { describe, expect, it } from 'vitest';
import type { CasContexte, Prejugement } from '../../src/application/banc-contexte.ts';
import { accepterSures, annuler, estJuge, messagesARelire, ordreDePresentation, prochaine, prochainMessage, progression, repondre, repondreMessage } from '../../src/application/banc-juger.ts';
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
		expect(progression(cas)).toEqual({ messagesJuges: 0, messages: 2, sautes: 0, silences: 0, aRelire: 0, pairesValidees: 0 });
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

	it('silence après une indécise : l’indécise le reste, les autres deviennent non pertinentes', () => {
		const indecise = repondre(CAS, prochaine(CAS)!, { genre: 'juger', jugement: 'indecise' })!.cas;
		const chemin = Object.keys(indecise[1]!.jugements!)[0]!;
		const fait = repondre(indecise, prochaine(indecise)!, { genre: 'silence' })!;
		expect(fait.cas[1]!.jugements![chemin]).toBe('indecise');
		expect(Object.values(fait.cas[1]!.jugements!).filter((j) => j === 'non_pertinente')).toHaveLength(2);
	});

	it('sauter : le message ne compte plus nulle part', () => {
		const cas = repondre(CAS, prochaine(CAS)!, { genre: 'sauter' })!.cas;
		expect(prochaine(cas)!.indice).toBe(2);
		expect(progression(cas)).toEqual({ messagesJuges: 0, messages: 1, sautes: 1, silences: 0, aRelire: 0, pairesValidees: 0 });
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

const MAINTENANT = '2026-11-26T10:00:00.000Z';
const propose = (jugement: Prejugement['jugement'], confiance: number): Prejugement => ({ jugement, confiance, raison: 'parce que' });

describe('jugement d’un message entier', () => {
	const CAS = [aJuger('m1', ['a.md', 'b.md', 'c.md']), aJuger('m2', ['d.md'])];

	it('valider : fusionne les jugements donnés, le reste devient pas utile si coché, date de validation posée ; le message est jugé', () => {
		const fait = repondreMessage(CAS, 0, { jugements: { 'a.md': 'pertinente' }, resteNonUtile: true }, { maintenant: MAINTENANT })!;
		expect(fait.cas[0]).toMatchObject({ valideLe: MAINTENANT, jugements: { 'a.md': 'pertinente', 'b.md': 'non_pertinente', 'c.md': 'non_pertinente' } });
		expect(estJuge(fait.cas[0]!)).toBe(true);
		expect(fait.annulation).toEqual({ indice: 0, avant: CAS[0] });
		expect(CAS[0]!.jugements).toEqual({});
		expect(progression(fait.cas)).toMatchObject({ messagesJuges: 1, pairesValidees: 3 });
	});

	it('valider sans « le reste n’est pas utile » : les fiches sans réponse restent sans jugement, le message est quand même jugé', () => {
		const fait = repondreMessage(CAS, 0, { jugements: { 'a.md': 'pertinente', 'b.md': 'indecise' }, resteNonUtile: false }, { maintenant: MAINTENANT })!;
		expect(fait.cas[0]!.jugements).toEqual({ 'a.md': 'pertinente', 'b.md': 'indecise' });
		expect(estJuge(fait.cas[0]!)).toBe(true);
		expect(prochaine(fait.cas)!.indice).toBe(1);
		// l'indécise n'est pas une paire
		expect(progression(fait.cas).pairesValidees).toBe(1);
	});

	it('les jugements déjà là sont gardés, ceux donnés les remplacent ; un chemin qui n’est pas candidate est ignoré', () => {
		const partiel = [{ ...CAS[0]!, jugements: { 'a.md': 'indecise' as const, 'b.md': 'pertinente' as const } }];
		const fait = repondreMessage(partiel, 0, { jugements: { 'a.md': 'non_pertinente', 'z.md': 'pertinente' }, resteNonUtile: true }, { maintenant: MAINTENANT })!;
		expect(fait.cas[0]!.jugements).toEqual({ 'a.md': 'non_pertinente', 'b.md': 'pertinente', 'c.md': 'non_pertinente' });
	});

	it('rien d’utile ici : silence, l’indécise le reste ; refusé si une fiche est utile (déjà jugée ou donnée)', () => {
		const fait = repondreMessage(CAS, 0, { jugements: { 'b.md': 'indecise' }, resteNonUtile: true, silence: true }, { maintenant: MAINTENANT })!;
		expect(fait.cas[0]).toMatchObject({ silence: true, valideLe: MAINTENANT, jugements: { 'a.md': 'non_pertinente', 'b.md': 'indecise', 'c.md': 'non_pertinente' } });
		expect(progression(fait.cas)).toMatchObject({ messagesJuges: 1, silences: 1 });
		expect(repondreMessage(CAS, 0, { jugements: { 'a.md': 'pertinente' }, resteNonUtile: true, silence: true })).toBeNull();
		const deja = [{ ...CAS[0]!, jugements: { 'a.md': 'pertinente' as const } }];
		expect(repondreMessage(deja, 0, { jugements: {}, resteNonUtile: true, silence: true })).toBeNull();
	});

	it('passer : le message est sauté, sans jugement ni validation ; annuler le rend tel qu’il était', () => {
		const fait = repondreMessage(CAS, 0, { jugements: { 'a.md': 'pertinente' }, resteNonUtile: true, passer: true })!;
		expect(fait.cas[0]).toMatchObject({ saute: true, jugements: {} });
		expect(fait.cas[0]!.valideLe).toBeUndefined();
		expect(prochainMessage(fait.cas)).toBe(1);
		expect(annuler(fait.cas, fait.annulation)).toEqual(CAS);
	});

	it('sans date donnée : la date de validation est l’heure courante (ISO)', () => {
		const fait = repondreMessage(CAS, 1, { jugements: {}, resteNonUtile: true })!;
		expect(Number.isNaN(Date.parse(fait.cas[1]!.valideLe!))).toBe(false);
	});
});

describe('propositions du juge', () => {
	const sur = aJuger('sûr', ['a.md', 'b.md'], { prejugements: { 'a.md': propose('pertinente', 0.95), 'b.md': propose('non_pertinente', 0.9) } });
	const incertain = aJuger('incertain', ['c.md', 'd.md'], { prejugements: { 'c.md': propose('pertinente', 0.95), 'd.md': propose('non_pertinente', 0.5) } });
	const tresIncertain = aJuger('très incertain', ['e.md'], { prejugements: { 'e.md': propose('indecise', 0.3) } });
	const incomplet = aJuger('incomplet', ['f.md', 'g.md'], { prejugements: { 'f.md': propose('non_pertinente', 0.99) } });
	const sansProposition = aJuger('sans proposition', ['h.md']);
	const valide = aJuger('validé', ['i.md'], { prejugements: { 'i.md': propose('pertinente', 0.99) }, valideLe: MAINTENANT, jugements: { 'i.md': 'non_pertinente' } });
	const saute = aJuger('sauté', ['j.md'], { prejugements: { 'j.md': propose('pertinente', 0.99) }, saute: true });
	const CAS = [sansProposition, incertain, sur, tresIncertain, incomplet, valide, saute];

	it('accepter les sûres : seuls les messages dont toutes les propositions couvrent les candidates à 0,9 ou plus', () => {
		const { cas, acceptes } = accepterSures(CAS, 0.9, { maintenant: MAINTENANT });
		expect(acceptes).toBe(1);
		expect(cas[2]).toMatchObject({ valideLe: MAINTENANT, jugements: { 'a.md': 'pertinente', 'b.md': 'non_pertinente' } });
		expect(estJuge(cas[2]!)).toBe(true);
		for (const i of [0, 1, 3, 4]) expect(cas[i]!.valideLe).toBeUndefined();
		expect(cas[5]).toEqual(valide);
		expect(cas[6]).toEqual(saute);
		expect(CAS[2]!.valideLe).toBeUndefined();
	});

	it('accepter les sûres garde un jugement déjà donné à la main', () => {
		const partiel = [{ ...sur, jugements: { 'a.md': 'non_pertinente' as const } }];
		expect(accepterSures(partiel, 0.9, { maintenant: MAINTENANT }).cas[0]!.jugements).toEqual({ 'a.md': 'non_pertinente', 'b.md': 'non_pertinente' });
	});

	it('à relire : messages non validés ayant des propositions, les plus incertains d’abord', () => {
		expect(messagesARelire(CAS)).toEqual([3, 1, 2, 4]);
		expect(messagesARelire(accepterSures(CAS, 0.9).cas)).toEqual([3, 1, 4]);
		expect(progression(CAS)).toMatchObject({ aRelire: 4, pairesValidees: 1 });
	});

	it('prochain message : d’abord ceux à relire, puis les autres dans l’ordre du fichier ; null quand tout est fait', () => {
		expect(prochainMessage(CAS)).toBe(3);
		let cas = CAS;
		const vus: number[] = [];
		for (let i = prochainMessage(cas); i !== null; i = prochainMessage(cas)) {
			vus.push(i);
			cas = repondreMessage(cas, i, { jugements: {}, resteNonUtile: true })!.cas;
		}
		expect(vus).toEqual([3, 1, 2, 4, 0]);
		expect(prochainMessage([aJuger('étiqueté', [], { candidates: undefined })])).toBeNull();
	});
});
