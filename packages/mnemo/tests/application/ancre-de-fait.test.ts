import { describe, expect, it } from 'vitest';
import { ancreDeFait } from '../../src/application/commun.ts';
import { proposer } from '../../src/application/proposer.ts';
import type { DemandeFait } from '../../src/application/proposer.ts';
import { TABLES_DEMANDE } from '../../src/application/validation.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const P = 'projets/p/p.md';
const src = { ref: 'dit en séance', type: 'utilisateur' as const };
function demande(surcharge: Partial<DemandeFait> = {}): DemandeFait {
	return { genre: 'fait', fiche: P, texte: 'Le client paie à 30 jours', nature: 'declare', source: src, ...surcharge };
}

describe('ancreDeFait : les identifiants affichés par les outils sont acceptés', () => {
	it('accepte « f-0001 », « ^f-0001 » et « <fiche>#^f-0001 » (casse du chemin indifférente)', () => {
		expect(ancreDeFait('f-0001', P)).toEqual({ ancre: 'f-0001' });
		expect(ancreDeFait('^f-0001', P)).toEqual({ ancre: 'f-0001' });
		expect(ancreDeFait(`${P}#^f-0001`, P)).toEqual({ ancre: 'f-0001' });
		expect(ancreDeFait('Projets/P/p.md#^f-0001', P)).toEqual({ ancre: 'f-0001' });
	});

	it('refuse un identifiant d\'une autre fiche, avec un motif en français', () => {
		const r = ancreDeFait('projets/q/q.md#^f-0001', P);
		expect(r).toHaveProperty('motif');
		expect((r as { motif: string }).motif).toContain('projets/q/q.md');
		expect((r as { motif: string }).motif).toContain(P);
	});

	it('refuse une ancre vide ou malformée', () => {
		for (const brut of ['', '^', `${P}#`, `${P}#^`, '^^f-0001']) expect(ancreDeFait(brut, P), brut).toHaveProperty('motif');
	});
});

describe('proposer accepte les identifiants affichés', () => {
	it('remplace avec « chemin#^f-0001 » et « ^f-0001 »', async () => {
		const dep = fauxPorts();
		await proposer(dep, demande());
		const r = await proposer(dep, demande({ texte: 'Le client paie à 45 jours', remplace: `${P}#^f-0001`, annuleEtRemplace: true }));
		expect(r).toMatchObject({ statut: 'ecrit', ancre: 'f-0002' });
		const r2 = await proposer(dep, demande({ texte: 'Le client paie à 60 jours', remplace: '^f-0002', annuleEtRemplace: true }));
		expect(r2).toMatchObject({ statut: 'ecrit', ancre: 'f-0003' });
	});

	it('remplace refuse l\'identifiant d\'une autre fiche', async () => {
		const dep = fauxPorts();
		await proposer(dep, demande());
		const r = await proposer(dep, demande({ texte: 'autre', remplace: 'projets/q/q.md#^f-0001' }));
		expect(r.statut).toBe('refuse');
		if (r.statut === 'refuse') expect(r.motif).not.toContain('^^');
	});

	it('confirmer / rejeter / supprimer acceptent « chemin#^f-0001 » et « ^f-0001 »', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('a.md', '---\ntype: sujet\nupdated: 2026-01-01\n---\n# A\n\n## Faits\n- Un | declare | a confirmer ^f-0001\n- Deux | declare | a confirmer ^f-0002\n- Trois | declare ^f-0003\n');
		expect(await proposer(dep, { genre: 'confirmer', fiche: 'a.md', ancre: 'a.md#^f-0001' }, { appliquerDirectement: true })).toMatchObject({ statut: 'ecrit', ancre: 'f-0001' });
		expect(await proposer(dep, { genre: 'rejeter', fiche: 'a.md', ancre: '^f-0002' }, { appliquerDirectement: true })).toMatchObject({ statut: 'ecrit', ancre: 'f-0002' });
		expect(await proposer(dep, { genre: 'supprimer', fiche: 'a.md', ancre: 'A.md#^f-0003' }, { appliquerDirectement: true })).toMatchObject({ statut: 'ecrit', ancre: 'f-0003' });
		const r = await proposer(dep, { genre: 'supprimer', fiche: 'a.md', ancre: 'b.md#^f-0001' }, { appliquerDirectement: true });
		expect(r.statut).toBe('refuse');
	});
});

describe('les champs d\'identifiant sont décrits pour Claude', () => {
	it('fiche, remplace, ancre, source.ref, valideDebut, valideFin ont une description', () => {
		const t = TABLES_DEMANDE;
		for (const champ of [t.fait.fiche, t.fait.remplace, t.fait.valideDebut, t.fait.valideFin, t.confirmer.ancre, t.confirmer.fiche, t.relation.fiche, t.consigne.fiche, t.fiche.chemin]) {
			expect((champ as { description?: string }).description).toMatch(/\S/u);
		}
		const source = t.fait.source.sorte as { objet: Record<string, { description?: string }> };
		expect(source.objet.ref!.description).toContain('[[sources/');
	});
});
