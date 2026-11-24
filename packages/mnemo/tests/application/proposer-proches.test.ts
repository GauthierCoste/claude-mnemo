import { describe, expect, it } from 'vitest';
import { avertissementIndex } from '../../src/application/synchroniser.ts';
import { deplacer } from '../../src/application/deplacer.ts';
import { proposer } from '../../src/application/proposer.ts';
import type { DemandeConsigne, DemandeFait } from '../../src/application/proposer.ts';
import { prochesDeConsigne, prochesDeFait } from '../../src/application/proposer/proches.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const P = 'projets/p/p.md';
const SOURCE = { ref: 'réunion du 3 mars', type: 'utilisateur' } as const;
const fait = (texte: string, surcharge: Partial<DemandeFait> = {}): DemandeFait => ({ genre: 'fait', fiche: P, texte, nature: 'declare', source: SOURCE, ...surcharge });
const consigne = (texte: string, surcharge: Partial<DemandeConsigne> = {}): DemandeConsigne => ({ genre: 'consigne', texte, portee: { genre: 'globale' }, source: SOURCE, ...surcharge });
const AVERTISSEMENT_INDEX = avertissementIndex('index cassé');

describe('proposer : proches avant écriture', () => {
	it('un fait très proche rend les proches sans rien écrire ni commiter', async () => {
		const dep = fauxPorts();
		await proposer(dep, fait('Le client paie les factures à trente jours fin de mois'));
		const commits = dep.commits.length;
		const avant = dep.fichiers.get(P);
		const r = await proposer(dep, fait('Le client paie ses factures à trente jours fin de mois exactement'));
		expect(r.statut).toBe('proches');
		if (r.statut === 'proches') expect(r.proches.map((v) => v.id)).toEqual([`${P}#^f-0001`]);
		expect(dep.commits).toHaveLength(commits);
		expect(dep.fichiers.get(P)).toBe(avant);
	});

	it('proches trouvés dans une autre fiche (sans périmètre)', async () => {
		const dep = fauxPorts();
		await proposer(dep, fait('Le client paie les factures à trente jours fin de mois', { fiche: 'clients/c/c.md' }));
		const r = await proposer(dep, fait('Le client paie ses factures à trente jours fin de mois exactement'));
		expect(r.statut).toBe('proches');
	});

	it('la même demande avec apresProches écrit', async () => {
		const dep = fauxPorts();
		await proposer(dep, fait('Le client paie les factures à trente jours fin de mois'));
		const r = await proposer(dep, fait('Le client paie ses factures à trente jours fin de mois exactement', { apresProches: true }));
		expect(r).toMatchObject({ statut: 'ecrit', ancre: 'f-0002' });
	});

	it('deux fiches qui portent le même fait proche : toutes deux rendues (pas de dédoublonnage)', async () => {
		const dep = fauxPorts();
		const fiche = (titre: string) =>
			`---\nid: 01ABC\ntype: sujet\nupdated: 2026-11-01\n---\n# ${titre}\n\n## Faits\n- Le client paie les factures à trente jours fin de mois | declare | src: utilisateur oral | appris 2026-11-20 | confiance 100 % ^f-0001\n`;
		await dep.coffre.ecrire('clients/c/c.md', fiche('C'));
		await dep.coffre.ecrire('clients/d/d.md', fiche('D'));
		const proches = await prochesDeFait(dep, fait('Le client paie ses factures à trente jours fin de mois exactement'));
		expect(proches.map((v) => v.chemin).sort()).toEqual(['clients/c/c.md', 'clients/d/d.md']);
	});

	it('un fait éloigné est écrit directement', async () => {
		const dep = fauxPorts();
		await proposer(dep, fait('Le client paie les factures à trente jours fin de mois'));
		const r = await proposer(dep, fait('Le serveur de recette tourne sous Debian'));
		expect(r.statut).toBe('ecrit');
	});

	it('un fait identique dans la même fiche reste un doublon, pas des proches', async () => {
		const dep = fauxPorts();
		await proposer(dep, fait('Le client paie les factures à trente jours fin de mois'));
		const r = await proposer(dep, fait('Le client paie les factures à trente jours fin de mois'));
		expect(r.statut).toBe('doublon');
	});

	it('avec remplace, la recherche des proches est sautée', async () => {
		const dep = fauxPorts();
		await proposer(dep, fait('Le client paie les factures à trente jours fin de mois'));
		const r = await proposer(dep, fait('Le client paie ses factures à quarante jours fin de mois', { remplace: 'f-0001', annuleEtRemplace: true }));
		expect(r.statut).toBe('ecrit');
	});

	it('une demande invalide est refusée, pas traitée comme des proches', async () => {
		const dep = fauxPorts();
		await proposer(dep, fait('Le client paie les factures à trente jours fin de mois'));
		const r = await proposer(dep, fait('Le client paie ses factures à trente jours fin de mois | x ~~y', {}));
		expect(r.statut).toBe('refuse');
	});

	it('un fait à confirmer, ancien et peu frais compte parmi les proches (pas de seuil de rappel)', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire(
			'projets/p/p.md',
			'---\nid: 01ABC\ntype: sujet\nupdated: 2010-01-01\n---\n# p\n\n## Faits\n- Le client paie les factures à trente jours fin de mois | infere | src: note x | appris 2010-01-01 | confiance 10 % | a confirmer ^f-0001\n',
		);
		const r = await proposer(dep, fait('Le client paie ses factures à trente jours fin de mois exactement'));
		expect(r.statut).toBe('proches');
	});

	it('une consigne reformulée rend les proches ; avec apresProches elle est écrite', async () => {
		const dep = fauxPorts();
		await proposer(dep, consigne('Toujours relire les migrations avant de les appliquer en production'));
		const r = await proposer(dep, consigne('Toujours relire les migrations avant de les appliquer en production svp'));
		expect(r.statut).toBe('proches');
		const r2 = await proposer(dep, consigne('Toujours relire les migrations avant de les appliquer en production svp', { apresProches: true }));
		expect(r2.statut).toBe('ecrit');
	});

	it('une consigne identique reste une répétition, même avec une consigne proche', async () => {
		const dep = fauxPorts();
		await proposer(dep, consigne('Toujours relire les migrations avant de les appliquer en production'));
		await proposer(dep, consigne('Toujours relire les migrations avant de les appliquer en production svp', { apresProches: true }));
		const r = await proposer(dep, consigne('Toujours relire les migrations avant de les appliquer en production'));
		expect(r.statut).toBe('repetition');
	});

	it('une consigne proche d\'une autre portée n\'est pas un proche', async () => {
		const dep = fauxPorts();
		await proposer(dep, consigne('Toujours relire les migrations avant de les appliquer en production', { portee: { genre: 'projet', nom: 'p' } }));
		const r = await proposer(dep, consigne('Toujours relire les migrations avant de les appliquer en production svp'));
		expect(r.statut).toBe('ecrit');
	});
});

describe('réindexation après écriture', () => {
	it('le nouveau fait est dans l\'index sans appel explicite à synchroniser', async () => {
		const dep = fauxPorts();
		await proposer(dep, fait('Le client paie les factures à trente jours fin de mois'));
		expect(await dep.index.element(`${P}#^f-0001`)).not.toBeNull();
	});

	it('deplacer réindexe', async () => {
		const dep = fauxPorts();
		await proposer(dep, fait('Le client paie les factures à trente jours fin de mois'));
		await deplacer(dep, P, 'projets/q/q.md');
		expect(await dep.index.element('projets/q/q.md#^f-0001')).not.toBeNull();
		expect(await dep.index.element(`${P}#^f-0001`)).toBeNull();
	});

	it('un échec d\'indexation n\'annule pas l\'écriture : succès avec avertissement, fait écrit et commité, indicateur strict', async () => {
		const dep = fauxPorts();
		dep.index.fiches = async () => {
			throw new Error('index cassé');
		};
		const r = await proposer(dep, fait('Le client paie les factures à trente jours fin de mois', { apresProches: true }));
		expect(r).toMatchObject({ statut: 'ecrit', fiche: P, avertissements: [AVERTISSEMENT_INDEX] });
		expect(dep.fichiers.get(P)).toContain('Le client paie les factures à trente jours fin de mois');
		expect(dep.commits).toHaveLength(1);
		expect(await dep.indicateur.lire()).toEqual({ genre: 'illisible' });
	});

	it('deplacer avec un index en panne : déplacé, succès avec avertissement', async () => {
		const dep = fauxPorts();
		await proposer(dep, fait('Le client paie les factures à trente jours fin de mois'));
		dep.index.fiches = async () => {
			throw new Error('index cassé');
		};
		const r = await deplacer(dep, P, 'projets/q/q.md');
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'projets/q/q.md', avertissements: [AVERTISSEMENT_INDEX] });
		expect(dep.fichiers.has('projets/q/q.md')).toBe(true);
	});

	it('une écriture réindexée sans erreur ne porte aucun avertissement', async () => {
		const r = await proposer(fauxPorts(), fait('Le client paie les factures à trente jours fin de mois'));
		expect(r.statut === 'ecrit' && 'avertissements' in r).toBe(false);
	});

	it('une panne de l\'index pendant la recherche des proches n\'empêche pas d\'écrire', async () => {
		for (const methode of ['chercher', 'fiches'] as const) {
			const dep = fauxPorts();
			dep.index[methode] = async () => {
				throw new Error('index cassé');
			};
			expect((await proposer(dep, fait('Le client paie les factures à trente jours fin de mois'))).statut, methode).toBe('ecrit');
			expect((await proposer(dep, consigne('Toujours relire les migrations'))).statut, methode).toBe('ecrit');
		}
	});

	it('une répétition exacte est vue même au-delà de 10 consignes proches', async () => {
		const dep = fauxPorts();
		const base = 'Toujours relire les migrations avant de les appliquer en production';
		await proposer(dep, consigne(base));
		for (let i = 0; i < 12; i++) await proposer(dep, consigne(`${base} variante${i}`, { apresProches: true }));
		expect((await proposer(dep, consigne(base))).statut).toBe('repetition');
	});

	it('une seule synchronisation de l\'index pour la recherche des proches', async () => {
		const dep = fauxPorts();
		await proposer(dep, fait('Le client paie ses factures à trente jours fin de mois'));
		await proposer(dep, consigne('Toujours relire les migrations avant de les appliquer'));
		let etats = 0;
		const origine = dep.coffre.etats;
		dep.coffre.etats = async () => {
			etats++;
			return origine();
		};
		expect(await prochesDeFait(dep, fait('Le client paie ses factures à trente jours fin de mois exactement'))).toHaveLength(1);
		expect(etats).toBe(1);
		etats = 0;
		expect(await prochesDeConsigne(dep, consigne('Toujours relire les migrations avant de les appliquer en production svp'))).toHaveLength(1);
		expect(etats).toBe(1);
	});
});
