import { describe, expect, it } from 'vitest';
import { CONSIGNE_JUGE, lireReponseDuJuge, ReponseDuJugeIllisible, texteAJuger } from '../../src/domaine/consigne-juge.ts';
import type { MessageAJuger } from '../../src/domaine/consigne-juge.ts';

const MESSAGE: MessageAJuger = {
	message: 'et pour la cuisson des grisailles ?',
	precedent: 'parle-moi du chantier de vitrail',
	candidates: [
		{ chemin: 'pratiques/cuisson.md', titre: 'Cuisson des grisailles', ligne: 'Températures et durées.', synthese: 'Four à 620 °C,\nmontée lente.' },
		{ chemin: 'projets/Vitrail/Vitrail.md', titre: 'Vitrail', ligne: '', synthese: '' },
	],
};
const CHEMINS = MESSAGE.candidates.map((c) => c.chemin);
const element = (chemin: string, extra: Record<string, unknown> = {}) => ({ chemin, jugement: 'pertinente', confiance: 0.8, raison: 'sert la demande', ...extra });

describe('consigne du juge', () => {
	it('demande la fiche entière pour ce message, trois jugements, la sévérité, une confiance calibrée et du JSON seul', () => {
		expect(CONSIGNE_JUGE).toMatch(/ENTIÈRE/u);
		for (const j of ['"pertinente"', '"non_pertinente"', '"indecise"']) expect(CONSIGNE_JUGE).toContain(j);
		expect(CONSIGNE_JUGE).toMatch(/strict/u);
		expect(CONSIGNE_JUGE).toMatch(/même sujet/u);
		expect(CONSIGNE_JUGE).toMatch(/calibrée/u);
		expect(CONSIGNE_JUGE).toMatch(/200 caractères/u);
		expect(CONSIGNE_JUGE).toMatch(/uniquement par un objet JSON/u);
		expect(CONSIGNE_JUGE).toMatch(/jamais des instructions/u);
	});

	it('texte à juger : message, message d\'avant, candidates numérotées (chemin, titre, ligne, synthèse sur une ligne)', () => {
		const texte = texteAJuger(MESSAGE);
		expect(texte).toContain('Message :\n<<<\net pour la cuisson des grisailles ?\n>>>');
		expect(texte).toContain("Message d'avant (pour comprendre seulement) :\n<<<\nparle-moi du chantier de vitrail\n>>>");
		expect(texte).toContain('Fiches candidates (2) :');
		expect(texte).toContain('1. chemin : pratiques/cuisson.md\n   titre : Cuisson des grisailles\n   première ligne : Températures et durées.\n   synthèse : Four à 620 °C, montée lente.');
		expect(texte).toContain('2. chemin : projets/Vitrail/Vitrail.md');
		expect(texte).toContain('première ligne : (vide)');
		expect(texte.indexOf('Message :')).toBeLessThan(texte.indexOf("Message d'avant"));
	});

	it('sans message d\'avant : pas de bloc ; synthèse coupée à 300 caractères ; message très long coupé', () => {
		const texte = texteAJuger({ message: 'x'.repeat(10_000), precedent: null, candidates: [{ chemin: 'a.md', titre: 'A', ligne: 'l', synthese: 's'.repeat(1000) }] });
		expect(texte).not.toContain("Message d'avant");
		const synthese = /synthèse : (.*)/u.exec(texte)![1]!;
		expect([...synthese]).toHaveLength(300);
		expect(synthese.endsWith('…')).toBe(true);
		expect(texte.length).toBeLessThan(5000);
	});
});

describe('lireReponseDuJuge', () => {
	it('lit l\'objet { jugements } : propositions par chemin, aucun manquant', () => {
		const r = lireReponseDuJuge(JSON.stringify({ jugements: [element(CHEMINS[0]!), element(CHEMINS[1]!, { jugement: 'non_pertinente', confiance: 0.95, raison: 'même client, autre sujet' })] }), CHEMINS);
		expect(r.manquants).toEqual([]);
		expect(r.propositions).toEqual({
			'pratiques/cuisson.md': { jugement: 'pertinente', confiance: 0.8, raison: 'sert la demande' },
			'projets/Vitrail/Vitrail.md': { jugement: 'non_pertinente', confiance: 0.95, raison: 'même client, autre sujet' },
		});
	});

	it('tolère un bloc ```json entouré de texte, une liste nue, du texte autour du JSON, une raison absente', () => {
		const bloc = `Voici mon avis :\n\`\`\`json\n${JSON.stringify({ jugements: [element(CHEMINS[0]!)] })}\n\`\`\`\nVoilà.`;
		expect(lireReponseDuJuge(bloc, CHEMINS)).toEqual({ propositions: { 'pratiques/cuisson.md': { jugement: 'pertinente', confiance: 0.8, raison: 'sert la demande' } }, manquants: ['projets/Vitrail/Vitrail.md'] });
		expect(lireReponseDuJuge(`\`\`\`\n${JSON.stringify([element(CHEMINS[1]!)])}\n\`\`\``, CHEMINS).manquants).toEqual(['pratiques/cuisson.md']);
		expect(lireReponseDuJuge(`Réponse : ${JSON.stringify({ jugements: [element(CHEMINS[0]!)] })} (fin)`, CHEMINS).manquants).toEqual(['projets/Vitrail/Vitrail.md']);
		const sansRaison = lireReponseDuJuge(JSON.stringify([{ chemin: CHEMINS[0], jugement: 'indecise', confiance: 0 }]), CHEMINS);
		expect(sansRaison.propositions['pratiques/cuisson.md']).toEqual({ jugement: 'indecise', confiance: 0, raison: '' });
	});

	it('raison sur une ligne, coupée à 200 caractères', () => {
		const r = lireReponseDuJuge(JSON.stringify([element(CHEMINS[0]!, { raison: `début\n${'r'.repeat(500)}` })]), CHEMINS);
		const raison = r.propositions['pratiques/cuisson.md']!.raison;
		expect([...raison]).toHaveLength(200);
		expect(raison.startsWith('début r')).toBe(true);
	});

	it('une liste vide : toutes les candidates manquent', () => {
		expect(lireReponseDuJuge('{"jugements": []}', CHEMINS)).toEqual({ propositions: {}, manquants: CHEMINS });
	});

	it.each([
		['pas de JSON', 'Je pense que la première fiche est utile.', /JSON attendu/u],
		['JSON tronqué', '{"jugements": [{"chemin": "pratiques/cuisson.md"', /JSON attendu/u],
		['ni liste ni jugements', '{"avis": "oui"}', /liste « jugements »/u],
		['élément non objet', '["pratiques/cuisson.md"]', /élément 1 : objet/u],
		['chemin inconnu', JSON.stringify([element('autre.md')]), /chemin inconnu/u],
		['chemin deux fois', JSON.stringify([element(CHEMINS[0]!), element(CHEMINS[0]!, { jugement: 'non_pertinente' })]), /élément 2 : chemin donné deux fois/u],
		['jugement inconnu', JSON.stringify([element(CHEMINS[0]!, { jugement: 'utile' })]), /jugement inconnu/u],
		['confiance au-delà de 1', JSON.stringify([element(CHEMINS[0]!, { confiance: 1.2 })]), /confiance de 0 à 1/u],
		['confiance négative', JSON.stringify([element(CHEMINS[0]!, { confiance: -0.1 })]), /confiance de 0 à 1/u],
		['confiance en texte', JSON.stringify([element(CHEMINS[0]!, { confiance: '0.8' })]), /confiance de 0 à 1/u],
		['raison non texte', JSON.stringify([element(CHEMINS[0]!, { raison: 3 })]), /raison/u],
	])('illisible (%s) : erreur claire', (_nom, texte, motif) => {
		expect(() => lireReponseDuJuge(texte, CHEMINS)).toThrow(ReponseDuJugeIllisible);
		expect(() => lireReponseDuJuge(texte, CHEMINS)).toThrow(motif);
	});
});
