import { describe, expect, it } from 'vitest';
import { donneesGraphe } from '../../src/application/graphe.ts';
import { resolveurDeLiens } from '../../src/application/liens.ts';
import { synchroniser } from '../../src/application/synchroniser.ts';
import type { ElementIndexe } from '../../src/domaine/elements.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const fiche = (type: string, titre: string, corps = '', entete = '') => `---\nid: 01X\ntype: ${type}\n${entete}updated: 2026-11-01\n---\n# ${titre}\n\n${corps}`;
const ligne = (texte: string, ancre: string, extra = '') => `- ${texte} | declare | src: utilisateur oral | appris 2026-11-${ancre.slice(-2)}${extra} | confiance 100 % ^${ancre}`;

async function petiteMemoire() {
	const dep = fauxPorts();
	await dep.coffre.ecrire('projets/erp/erp.md', fiche('dossier', 'ERP'));
	await dep.coffre.ecrire('projets/erp/stocks/Module stocks.md',
		fiche('sujet', 'Module stocks', `Voir [[Inexistante]] et [[clients/acme]].\n\n## Faits\n${ligne('[montant] Budget de 10 k€', 'f-0010')}\n${ligne('[delai] Livraison au 15/12', 'f-0011', ' | a confirmer')}\n- [montant] ~~Budget de 8 k€~~ | declare | src: utilisateur oral | appris 2026-11-09 | invalidé 2026-11-10 par ^f-0010 ^f-0009\n\n## Relations\n- concerne [[clients/acme]]\n`, 'alias: [Stocks]\n'));
	await dep.coffre.ecrire('clients/acme.md', fiche('entite', 'Acme', 'Client principal. Voir [[Stocks]] et [[../hors]].'));
	await dep.coffre.ecrire('racine.md', fiche('sujet', 'Racine'));
	await synchroniser(dep);
	return dep;
}

describe('donneesGraphe', () => {
	it('petite mémoire : fiches, parent par fiche dossier, liens résolus ou non, états et faits actifs', async () => {
		const dep = await petiteMemoire();
		const g = await donneesGraphe(dep);
		expect(g.coffre).toBe('_mnemo');
		expect(g.notions).toEqual([]);
		expect(g.sens).toEqual({ disponible: false, etat: 'absent' });
		const parChemin = new Map(g.fiches.map((f) => [f.chemin, f]));
		expect([...parChemin.keys()].sort()).toEqual(['clients/acme.md', 'projets/erp/erp.md', 'projets/erp/stocks/Module stocks.md', 'racine.md']);

		const stocks = parChemin.get('projets/erp/stocks/Module stocks.md')!;
		expect(stocks).toMatchObject({ titre: 'Module stocks', type: 'sujet', alias: ['Stocks'], branche: 'projets/erp/stocks', etats: ['a_confirmer'] });
		// fait invalidé non compté
		expect(stocks.faitsActifs).toBe(2);
		expect(stocks.categories).toEqual({ montant: 1, delai: 1 });
		expect(stocks.dates.sort()).toEqual(['2026-11-10', '2026-11-11']);
		// pas de fiche dossier pour `projets/erp/stocks` : celle du premier dossier au-dessus qui en a une
		expect(stocks.parent).toBe('projets/erp/erp.md');
		// la fiche dossier elle-même : pas sa propre parente
		expect(parChemin.get('projets/erp/erp.md')).toMatchObject({ branche: 'projets/erp', parent: null, etats: [], faitsActifs: 0 });
		expect(parChemin.get('racine.md')).toMatchObject({ branche: '', parent: null });

		const depuis = (source: string) => g.liens.filter((l) => l.source === source).map(({ cible, cibleEcrite, relation }) => ({ cible, cibleEcrite, relation }));
		expect(depuis('projets/erp/stocks/Module stocks.md')).toEqual(
			expect.arrayContaining([
				{ cible: 'clients/acme.md', cibleEcrite: 'clients/acme', relation: 'concerne' },
				{ cible: null, cibleEcrite: 'Inexistante', relation: null },
				{ cible: 'clients/acme.md', cibleEcrite: 'clients/acme', relation: null },
			]),
		);
		// par alias ; un lien qui remonte (`..`) ne mène à aucune fiche
		expect(depuis('clients/acme.md')).toEqual([
			{ cible: 'projets/erp/stocks/Module stocks.md', cibleEcrite: 'Stocks', relation: null },
			{ cible: null, cibleEcrite: '../hors', relation: null },
		]);
	});

	it('parent : la fiche <d>/<d>.md seulement si elle est un lieu (tout type sauf consigne, profil, source, episode), sinon on remonte', async () => {
		const parents = async (typeAcme: string) => {
			const dep = fauxPorts();
			await dep.coffre.ecrire('clients/clients.md', fiche('dossier', 'Clients'));
			await dep.coffre.ecrire('clients/acme/acme.md', fiche(typeAcme, 'Acme'));
			await dep.coffre.ecrire('clients/acme/Contrat.md', fiche('sujet', 'Contrat'));
			await synchroniser(dep);
			const g = await donneesGraphe(dep);
			return Object.fromEntries(g.fiches.map((f) => [f.chemin, f.parent]));
		};
		expect(await parents('source')).toMatchObject({ 'clients/acme/Contrat.md': 'clients/clients.md', 'clients/acme/acme.md': 'clients/clients.md' });
		expect(await parents('organisation')).toMatchObject({ 'clients/acme/Contrat.md': 'clients/acme/acme.md', 'clients/acme/acme.md': 'clients/clients.md' });
	});

	it('modifieeMs : instant du dernier commit de la mémoire (0 sans commit)', async () => {
		const dep = await petiteMemoire();
		expect((await donneesGraphe(dep)).modifieeMs).toBe(0);
		await dep.historique.commit('mnemo: x', 'tout');
		expect((await donneesGraphe(dep)).modifieeMs).toBe(new Date(2026, 10, 22, 12, 0, 0).getTime());
	});

	it('sens disponible : d\'après le modèle installé', async () => {
		const dep = await petiteMemoire();
		dep.sens = { modele: () => 'bge-m3@abc', vecteurs: async () => null };
		expect((await donneesGraphe(dep)).sens).toEqual({ disponible: true, etat: 'prêt' });
	});

	it('ne relit aucun fichier : tout vient de l\'index', async () => {
		const dep = await petiteMemoire();
		const lire = dep.coffre.lire;
		let lectures = 0;
		dep.coffre.lire = async (c) => {
			lectures++;
			return lire(c);
		};
		dep.coffre.toutesLesFiches = async () => {
			throw new Error('liste du coffre lue');
		};
		await donneesGraphe(dep);
		expect(lectures).toBe(0);
	});

	it(`2 000 fiches, 20 000 faits : moins de ${process.env.CI ? 3 : 1} s`, async () => {
		const dep = fauxPorts();
		const element = (id: string, chemin: string, extra: Partial<ElementIndexe>): ElementIndexe => ({
			id, chemin, genre: 'fait', typeFiche: 'sujet', texte: id, contexte: '', statut: 'servi', date: '2026-11-01', valideFin: null, finIncluse: false,
			confiance: 1, source: null, typeSource: null, categorie: 'montant', niveau: null, portee: null, dossierProjet: null, ...extra,
		});
		for (let i = 0; i < 2000; i++) {
			const d = `d${i % 40}`;
			const chemin = i < 40 ? `${d}/${d}.md` : `${d}/f${i}.md`;
			const elements = [element(chemin, chemin, { genre: 'fiche', categorie: null, typeFiche: i < 40 ? 'dossier' : 'sujet' })];
			for (let k = 0; k < 10; k++) elements.push(element(`${chemin}#^f-${k}`, chemin, { statut: k === 0 ? 'a_confirmer' : k === 1 ? 'invalide' : 'servi' }));
			const liens = [{ de: chemin, vers: `d${(i + 1) % 40}/f${i + 1}.md`, verbe: null }, { de: chemin, vers: `Titre ${i + 7}.md`, verbe: 'concerne' }];
			await dep.index.remplacer({ chemin, empreinte: 'e', mtimeMs: 1, taille: 1 }, { titre: `Titre ${i}`, elements, liens, alias: [`alias ${i}`], anomalies: [] });
		}
		const debut = performance.now();
		const g = await donneesGraphe(dep);
		const ms = performance.now() - debut;
		expect(g.fiches).toHaveLength(2000);
		expect(g.liens).toHaveLength(4000);
		expect(g.fiches.find((f) => f.chemin === 'd1/f41.md')).toMatchObject({ faitsActifs: 9, etats: ['a_confirmer'], parent: 'd1/d1.md' });
		expect(ms).toBeLessThan(process.env.CI ? 3000 : 1000);
	});
});

describe('résolution des liens', () => {
	const resoudre = resolveurDeLiens([
		{ chemin: 'a/Module stocks.md', titre: 'Module stocks', alias: ['Stocks', 'Inventaire'] },
		{ chemin: 'b/Note.md', titre: 'Note B', alias: [] },
		{ chemin: 'c/Note.md', titre: 'Note C', alias: [] },
		{ chemin: 'clients/acme.md', titre: 'Acmé', alias: [] },
	]);

	it('par chemin, par nom de fichier unique, par titre ou alias (casse et accents ignorés)', () => {
		expect(resoudre('clients/acme.md')).toBe('clients/acme.md');
		expect(resoudre('Module stocks.md')).toBe('a/Module stocks.md');
		expect(resoudre('stocks.md')).toBe('a/Module stocks.md');
		expect(resoudre('ACME.md')).toBe('clients/acme.md');
		expect(resoudre('Note C.md')).toBe('c/Note.md');
	});

	it('ambigu ou inconnu : null', () => {
		expect(resoudre('Note.md')).toBeNull();
		expect(resoudre('Personne.md')).toBeNull();
	});

	it('chemin qui sort de la mémoire ou absolu : null, jamais résolu', () => {
		for (const ecrit of ['../clients/acme.md', 'clients/../clients/acme.md', '/clients/acme.md', 'C:/x.md', 'C:\\x.md', '..\\clients\\acme.md', './clients/acme.md', 'clients//acme.md', '.git/config.md'])
			expect(resoudre(ecrit), ecrit).toBeNull();
	});
});
