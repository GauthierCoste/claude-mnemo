import { describe, expect, it } from 'vitest';
import { avertissementIndex } from '../../src/application/synchroniser.ts';
import { ecrireBrut } from '../../src/application/proposer.ts';
import { empreinte } from '../../src/domaine/empreinte.ts';
import { synchroniser } from '../../src/application/synchroniser.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const CHEMIN = 'projets/alpha/Stocks.md';
const TEXTE = '---\nid: 01ABC\ntype: sujet\nupdated: 2026-11-01\n---\n# Stocks\n\nInventaire le lundi.\n';

async function memoire() {
	const dep = fauxPorts();
	await dep.coffre.ecrire(CHEMIN, TEXTE);
	await synchroniser(dep);
	return dep;
}

const demande = (texte: string, e = empreinte(TEXTE), chemin = CHEMIN) => ({ genre: 'brut' as const, chemin, texte, empreinte: e });

describe('ecrireBrut (édition brute, canal de l\'utilisateur)', () => {
	it('valide : écrit le texte tel quel, un commit « mnemo: brut <chemin> », fiche réindexée', async () => {
		const dep = await memoire();
		const texte = TEXTE.replace('le lundi', 'le mardi [[projets/alpha/alpha]]');
		const r = await ecrireBrut(dep, demande(texte));
		expect(r).toMatchObject({ statut: 'ecrit', fiche: CHEMIN, aConfirmer: false });
		expect(dep.fichiers.get(CHEMIN)).toBe(texte);
		expect(dep.commits.map((c) => c.message)).toEqual([`mnemo: brut ${CHEMIN}`]);
		expect(dep.commits[0]!.chemins).toEqual([CHEMIN]);
		expect((await dep.index.element(CHEMIN))!.texte).toContain('le mardi');
		expect((await dep.index.liens(CHEMIN)).sortants).toEqual([{ de: CHEMIN, vers: 'projets/alpha/alpha.md', verbe: null }]);
	});

	it('index en panne après l\'écriture : écrit, succès avec avertissement, indicateur strict', async () => {
		const dep = await memoire();
		dep.index.remplacer = () => Promise.reject(new Error('index cassé'));
		const texte = TEXTE.replace('le lundi', 'le mardi');
		const r = await ecrireBrut(dep, demande(texte));
		expect(r).toMatchObject({ statut: 'ecrit', fiche: CHEMIN, avertissements: [avertissementIndex('index cassé')] });
		expect(dep.fichiers.get(CHEMIN)).toBe(texte);
		expect(await dep.indicateur.lire()).toEqual({ genre: 'illisible' });
	});

	it('empreinte périmée : conflit, fichier inchangé, aucun commit', async () => {
		const dep = await memoire();
		const r = await ecrireBrut(dep, demande(TEXTE.replace('lundi', 'mardi'), empreinte('autre version')));
		expect(r.statut).toBe('conflit');
		expect(dep.fichiers.get(CHEMIN)).toBe(TEXTE);
		expect(dep.commits).toEqual([]);
	});

	it('type ou identifiant changé, fiche illisible : refusé (motif en français), fichier inchangé', async () => {
		const dep = await memoire();
		for (const [texte, motif] of [
			[TEXTE.replace('type: sujet', 'type: entite'), /type/u],
			[TEXTE.replace('id: 01ABC', 'id: 01XYZ'), /identifiant/u],
			[TEXTE.replace('updated: 2026-11-01\n---\n', 'updated: 2026-11-01\n'), /frontmatter/u],
			[TEXTE.replace('type: sujet', 'type: inconnu'), /type/u],
		] as const) {
			const r = await ecrireBrut(dep, demande(texte));
			expect(r.statut, texte).toBe('refuse');
			expect(r.statut === 'refuse' ? r.motif : '').toMatch(motif);
		}
		expect(dep.fichiers.get(CHEMIN)).toBe(TEXTE);
		expect(dep.commits).toEqual([]);
	});

	it('chemin invalide ou qui sort de la mémoire, fiche absente : refusé', async () => {
		const dep = await memoire();
		for (const chemin of ['../x.md', '/etc/x.md', 'a/../../x.md', '.git/config', 'SCHEMA.md', 'absente.md'])
			expect((await ecrireBrut(dep, demande(TEXTE, empreinte(TEXTE), chemin))).statut, chemin).toBe('refuse');
		expect(dep.commits).toEqual([]);
	});

	it('texte identique : rien à écrire (doublon), aucun commit', async () => {
		const dep = await memoire();
		expect(await ecrireBrut(dep, demande(TEXTE))).toEqual({ statut: 'doublon', fiche: CHEMIN });
		expect(dep.commits).toEqual([]);
	});

	it('sous verrou', async () => {
		const dep = await memoire();
		let dansVerrou = false;
		const ecrire = dep.coffre.ecrire;
		dep.verrou = { avec: async (action) => { dansVerrou = true; try { return await action(); } finally { dansVerrou = false; } } };
		dep.coffre.ecrire = async (c, t) => {
			expect(dansVerrou).toBe(true);
			return ecrire(c, t);
		};
		expect((await ecrireBrut(dep, demande(TEXTE.replace('lundi', 'jeudi')))).statut).toBe('ecrit');
	});
});
