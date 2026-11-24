import { describe, expect, it } from 'vitest';
import { chercher } from '../../src/application/chercher.ts';
import { etendrePassages } from '../../src/application/etendre.ts';
import { servir } from '../../src/application/servir.ts';
import { synchroniser } from '../../src/application/synchroniser.ts';
import type { Trouve } from '../../src/application/chercher.ts';
import { fauxPorts } from '../aides/faux-ports.ts';


const source = (chemin: string) => `---\nid: 01SRC\ntype: source\nchemin: ${chemin}\ntype_source: note\nupdated: 2026-11-01\n---\n# Manuel\n`;
/** Un paragraphe d'environ 1 350 caractères, marqué par `mot`. */
const paragraphe = (mot: string, n = 40) => `Le ${mot} est décrit ici. ${'Phrase de remplissage du manuel. '.repeat(n)}`;
const MANUEL = [
	'# Manuel',
	'## Journaux',
	paragraphe('ornithorynque'),
	paragraphe('pangolin'),
	paragraphe('tatou'),
	paragraphe('fennec'),
	'## Sauvegardes',
	paragraphe('quokka'),
].join('\n\n');

async function memoire() {
	const dep = fauxPorts();
	dep.documents.deposer('docs/manuel.md', MANUEL);
	await dep.coffre.ecrire('sources/manuel.md', source('docs/manuel.md'));
	await dep.coffre.ecrire(
		'projets/p.md',
		`---\nid: 01P\ntype: sujet\nupdated: 2026-11-01\n---\n# P\n\nUn projet.\n\n## Notes\n\n${paragraphe('lama')}\n\n${paragraphe('alpaga')}\n`,
	);
	// la recherche n'extrait pas : les documents sont indexés d'abord
	await synchroniser(dep);
	return dep;
}
const passage = async (dep: ReturnType<typeof fauxPorts>, mot: string): Promise<Trouve> => (await chercher(dep, { texte: mot, genres: ['passage'] }))[0]!;

describe('etendrePassages (servir un passage avec ce qui l\'entoure)', () => {
	it('un passage seul de sa section dans les résultats : servi avec ses voisins immédiats, même référence', async () => {
		const dep = await memoire();
		const t = await passage(dep, 'pangolin');
		const [e] = await etendrePassages(dep, [t]);
		expect(e!.id).toBe(t.id);
		expect(e!.score).toBe(t.score);
		expect(e!.etendue).toMatchObject({ mode: 'voisins', tronque: false, regroupes: [t.id] });
		expect(e!.etendue!.ids).toHaveLength(3);
		expect(e!.texte).toContain('ornithorynque');
		expect(e!.texte).toContain('pangolin');
		expect(e!.texte).toContain('tatou');
		// ni le passage suivant le voisin, ni une autre section
		expect(e!.texte).not.toContain('fennec');
		expect(e!.texte).not.toContain('quokka');
		expect(e!.texte.length).toBeLessThanOrEqual(6000);
	});

	it('deux passages de la même section : une seule entrée, la section, au rang du meilleur', async () => {
		const dep = await memoire();
		const [a, b, autre] = [await passage(dep, 'pangolin'), await passage(dep, 'fennec'), await passage(dep, 'quokka')];
		const fait = { ...autre, id: 'projets/p.md#^f-1', genre: 'fait' as const, texte: 'Un fait' };
		const servis = await etendrePassages(dep, [a, fait, b, autre]);
		expect(servis.map((s) => s.id)).toEqual([a.id, fait.id, autre.id]);
		expect(servis[0]!.etendue).toMatchObject({ mode: 'section', regroupes: [a.id, b.id], tronque: false });
		for (const mot of ['ornithorynque', 'pangolin', 'tatou', 'fennec']) expect(servis[0]!.texte).toContain(mot);
		expect(servis[0]!.texte).not.toContain('quokka');
		expect(servis[1]).toBe(fait);
		// la section « Sauvegardes » n'a qu'un passage : servi seul
		expect(servis[2]!.etendue).toMatchObject({ mode: 'passage', ids: [autre.id] });
	});

	it('budget par entrée : le passage reste entier, les voisins sont coupés de façon visible', async () => {
		const dep = await memoire();
		const t = await passage(dep, 'pangolin');
		const [e] = await etendrePassages(dep, [t], 2500);
		expect(e!.texte.length).toBeLessThanOrEqual(2500);
		expect(e!.texte).toContain(t.texte);
		expect(e!.texte).toContain('…');
		expect(e!.etendue!.tronque).toBe(true);
	});

	it('deux passages trouvés qui ne tiennent pas ensemble : deux entrées, chacune entière ; le voisin commun n\'est servi qu\'une fois', async () => {
		const dep = await memoire();
		const [a, b] = [await passage(dep, 'ornithorynque'), await passage(dep, 'tatou')];
		const servis = await etendrePassages(dep, [a, b], 2000);
		expect(servis.map((s) => s.id)).toEqual([a.id, b.id]);
		expect(servis[0]!.texte).toContain(a.texte);
		expect(servis[1]!.texte).toContain(b.texte);
		// « pangolin » est entre les deux : chez le premier seulement
		expect(servis.filter((s) => s.texte.includes('pangolin'))).toHaveLength(1);
		expect(servis[0]!.texte).toContain('pangolin');
	});

	it('passages de fiche aussi : voisins dans la même section (même contexte)', async () => {
		const dep = await memoire();
		const t = await passage(dep, 'alpaga');
		expect(t.chemin).toBe('projets/p.md');
		const [e] = await etendrePassages(dep, [t]);
		expect(e!.etendue!.mode).toBe('voisins');
		expect(e!.texte).toContain('lama');
		expect(e!.texte).toContain('alpaga');
	});
});
