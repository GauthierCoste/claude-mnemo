import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { proposer } from '../../src/application/proposer.ts';
import type { DemandeFait } from '../../src/application/proposer.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const P = 'projets/p/p.md';
function demande(surcharge: Partial<DemandeFait> = {}): DemandeFait {
	return { genre: 'fait', fiche: P, texte: 'Le client paie à 30 jours', nature: 'declare', source: { ref: 'réunion du 3 mars', type: 'utilisateur' }, ...surcharge };
}

describe('proposer un fait', () => {
	it('crée la fiche et écrit le fait', async () => {
		const dep = fauxPorts();
		const r = await proposer(dep, demande());
		expect(r).toMatchObject({ statut: 'ecrit', fiche: P, ancre: 'f-0001', aConfirmer: false });
		const texte = dep.fichiers.get(P)!;
		expect(texte).toContain('id: ID0001');
		expect(texte).toContain('# p');
		expect(texte).toContain('- Le client paie à 30 jours | declare | src: utilisateur réunion du 3 mars | appris 2026-11-22 | confiance 100 % ^f-0001');
		expect(dep.commits).toEqual([{ message: 'mnemo: information projets/p/p.md', chemins: [P, 'projets/projets.md'] }]);
	});

	it('crée les fiches dossier manquantes d\'une nouvelle fiche, sans toucher aux existantes', async () => {
		const dep = fauxPorts();
		await proposer(dep, demande({ fiche: 'projets/p/vente/catalogue/catalogue.md' }));
		expect([...dep.fichiers.keys()].sort()).toEqual(['projets/p/p.md', 'projets/p/vente/catalogue/catalogue.md', 'projets/p/vente/vente.md', 'projets/projets.md']);
		expect(dep.fichiers.get('projets/p/vente/vente.md')).toContain('type: dossier');
		expect(dep.fichiers.get('projets/p/vente/vente.md')).toContain('# vente');
		const avant = dep.fichiers.get('projets/projets.md');
		await proposer(dep, demande({ fiche: 'projets/p/autre.md' }));
		expect(dep.fichiers.get('projets/projets.md')).toBe(avant);
	});

	it('refuse une nouvelle fiche qui ne diffère d\'une existante que par la casse', async () => {
		const dep = fauxPorts();
		await proposer(dep, demande());
		const n = dep.commits.length;
		const r = await proposer(dep, demande({ fiche: 'projets/P/p.md' }));
		expect(r.statut).toBe('refuse');
		const r2 = await proposer(dep, demande({ fiche: 'Projets/q/q.md' }));
		expect(r2.statut).toBe('refuse');
		if (r2.statut === 'refuse') expect(r2.motif).toContain('projets/projets.md');
		expect(dep.commits).toHaveLength(n);
		expect(dep.fichiers.size).toBe(2);
	});

	it('valide le titre et le type d\'une nouvelle fiche', async () => {
		const dep = fauxPorts();
		for (const surcharge of [{ titreSiNouvelle: '' }, { titreSiNouvelle: 'a\nb' }, { titreSiNouvelle: '# t' }, { titreSiNouvelle: 'x'.repeat(201) }, { typeSiNouvelle: 'Pas Bien' }]) {
			expect((await proposer(dep, demande(surcharge))).statut, JSON.stringify(surcharge)).toBe('refuse');
		}
		expect(dep.fichiers.size).toBe(0);
		await proposer(dep, demande({ titreSiNouvelle: '  Projet P  ', typeSiNouvelle: 'entite' }));
		expect(dep.fichiers.get(P)).toContain('# Projet P\n');
		expect(dep.fichiers.get(P)).toContain('type: entite');
	});

	it('calcule la confiance selon la source et la nature', async () => {
		const dep = fauxPorts();
		await proposer(dep, demande({ nature: 'infere', source: { ref: 'x', type: 'deduction' }, texte: 'a' }));
		expect(dep.fichiers.get(P)).toContain('confiance 35 %');
		await proposer(dep, demande({ nature: 'observe', source: { ref: 'session s1', type: 'session' }, texte: 'b' }));
		expect(dep.fichiers.get(P)).toContain('src: session s1 |');
		expect(dep.fichiers.get(P)).toContain('confiance 51 %');
	});

	it('signale un doublon sans écrire ni commiter', async () => {
		const dep = fauxPorts();
		await proposer(dep, demande());
		const r = await proposer(dep, demande({ source: { ref: 'autre', type: 'utilisateur' } }));
		expect(r).toEqual({ statut: 'doublon', fiche: P, ancre: 'f-0001' });
		expect(dep.commits).toHaveLength(1);
	});

	it('remplace explicitement un fait en le barrant', async () => {
		const dep = fauxPorts();
		await proposer(dep, demande());
		const r = await proposer(dep, demande({ texte: 'Le client paie à 45 jours', remplace: 'f-0001', annuleEtRemplace: true }));
		expect(r).toMatchObject({ statut: 'ecrit', ancre: 'f-0002' });
		const texte = dep.fichiers.get(P)!;
		expect(texte).toContain('- ~~Le client paie à 30 jours~~ | declare');
		expect(texte).toContain('invalidé 2026-11-22 par ^f-0002 ^f-0001');
		expect(texte).toContain('- Le client paie à 45 jours | declare');
	});

	it('écrit à confirmer un email plus récent, moins fiable que la spec, sans barrer la spec', async () => {
		const dep = fauxPorts();
		await proposer(dep, demande({ texte: 'Paiement à 30 jours', valideDebut: '2026-01-01', source: { ref: '[[sources/spec]]', type: 'spec_validee' } }));
		const r = await proposer(dep, demande({ texte: 'Paiement à 45 jours', remplace: 'f-0001', source: { ref: '[[sources/mail]]', type: 'email' } }));
		expect(r).toMatchObject({ statut: 'ecrit', ancre: 'f-0002', aConfirmer: true });
		const texte = dep.fichiers.get(P)!;
		expect(texte).not.toContain('~~');
		expect(texte).toContain('| a confirmer');
	});

	describe('contradiction', () => {
		const spec = { ref: '[[sources/spec]]', type: 'spec_validee' as const };
		const mail = { ref: '[[sources/mail]]', type: 'email' as const };
		const mise = async (dep: ReturnType<typeof fauxPorts>) => {
			await proposer(dep, demande({ texte: 'Paiement à 30 jours', valideDebut: '2026-01-01', source: spec }));
			return proposer(dep, demande({ texte: 'Paiement à 45 jours', remplace: 'f-0001', source: mail }));
		};

		it('le nouveau fait porte « contredit ^f-0001 » juste après « a confirmer »', async () => {
			const dep = fauxPorts();
			expect(await mise(dep)).toMatchObject({ statut: 'ecrit', ancre: 'f-0002', aConfirmer: true });
			expect(dep.fichiers.get(P)).toContain('| a confirmer | contredit ^f-0001 ^f-0002');
		});

		it('confirmer barre le fait contredit dans la même écriture et garde la mention', async () => {
			const dep = fauxPorts();
			await mise(dep);
			const n = dep.commits.length;
			expect(await proposer(dep, { genre: 'confirmer', fiche: P, ancre: 'f-0002' }, { appliquerDirectement: true })).toMatchObject({ statut: 'ecrit' });
			const texte = dep.fichiers.get(P)!;
			expect(texte).toContain('- ~~Paiement à 30 jours~~');
			expect(texte).toContain('valide [2026-01-01,2026-11-22) | confiance 90 % | invalidé 2026-11-22 par ^f-0002 ^f-0001');
			expect(texte).toContain('| contredit ^f-0001 ^f-0002');
			expect(texte).not.toContain('a confirmer');
			expect(dep.commits).toHaveLength(n + 1);
		});

		it('confirmer ne change pas une fin de validité déjà fixée', async () => {
			const dep = fauxPorts();
			await proposer(dep, demande({ texte: 'Paiement à 30 jours', valideDebut: '2026-01-01', valideFin: '2027-01-01', source: spec }));
			await proposer(dep, demande({ texte: 'Paiement à 45 jours', remplace: 'f-0001', source: mail }));
			await proposer(dep, { genre: 'confirmer', fiche: P, ancre: 'f-0002' }, { appliquerDirectement: true });
			expect(dep.fichiers.get(P)).toContain('- ~~Paiement à 30 jours~~ | declare | src: [[sources/spec]] | appris 2026-11-22 | valide [2026-01-01,2027-01-01)');
		});

		it('confirmer ne barre jamais avant le début de validité du fait contredit', async () => {
			const dep = fauxPorts();
			await proposer(dep, demande({ texte: 'Paiement à 30 jours', valideDebut: '2027-01-01', source: spec }));
			await proposer(dep, demande({ texte: 'Paiement à 45 jours', valideDebut: '2027-02-01', remplace: 'f-0001', source: mail }));
			await proposer(dep, { genre: 'confirmer', fiche: P, ancre: 'f-0002' }, { appliquerDirectement: true });
			expect(dep.fichiers.get(P)).toContain('- ~~Paiement à 30 jours~~ | declare | src: [[sources/spec]] | appris 2026-11-22 | valide [2027-01-01,2027-01-01)');
		});

		it('rejeter laisse le fait contredit intact et ôte « a confirmer »', async () => {
			const dep = fauxPorts();
			await mise(dep);
			const avant = dep.fichiers.get(P)!.split('\n').find((l) => l.includes('^f-0001'));
			await proposer(dep, { genre: 'rejeter', fiche: P, ancre: 'f-0002' }, { appliquerDirectement: true });
			const texte = dep.fichiers.get(P)!;
			expect(texte.split('\n').find((l) => l.includes('^f-0001') && !l.includes('contredit'))).toBe(avant);
			expect(texte).toContain('- ~~Paiement à 45 jours~~');
			expect(texte).not.toContain('a confirmer');
		});
	});

	it('refuse des dates de validité mal formées ou inversées', async () => {
		const dep = fauxPorts();
		for (const surcharge of [{ valideDebut: '2026-1-1' }, { valideFin: 'demain' }, { valideDebut: '2026-02-30' }, { valideDebut: '2026-03-01', valideFin: '2026-02-01' }]) {
			const r = await proposer(dep, demande(surcharge));
			expect(r.statut, JSON.stringify(surcharge)).toBe('refuse');
			if (r.statut === 'refuse') expect(r.motif).toMatch(/date|validité/u);
		}
		expect((await proposer(dep, demande({ valideDebut: '2026-03-01', valideFin: '2026-03-01' }))).statut).toBe('ecrit');
	});

	it('refuse un type de source inconnu', async () => {
		const dep = fauxPorts();
		const r = await proposer(dep, demande({ source: { ref: '[[sources/x]]', type: 'rumeur' as never } }));
		expect(r).toMatchObject({ statut: 'refuse' });
		if (r.statut === 'refuse') expect(r.motif).toContain('rumeur');
	});

	it('un doublon sans ancre ne renvoie pas d\'ancre vide', async () => {
		const dep = fauxPorts();
		dep.fichiers.set(P, '---\nid: X\ntype: sujet\n---\n# p\n\n## Faits\n- Le client paie à 30 jours | declare\n');
		expect(await proposer(dep, demande())).toEqual({ statut: 'doublon', fiche: P });
	});

	it('ne fait rien pour un email moins fiable et plus ancien que la spec', async () => {
		const dep = fauxPorts();
		await proposer(dep, demande({ texte: 'Paiement à 30 jours', valideDebut: '2026-01-01', source: { ref: '[[sources/spec]]', type: 'spec_validee' } }));
		const avant = dep.commits.length;
		const r = await proposer(dep, demande({ texte: 'Paiement à 45 jours', valideDebut: '2025-01-01', remplace: 'f-0001', source: { ref: '[[sources/mail]]', type: 'email' } }));
		expect(r).toEqual({ statut: 'doublon', fiche: P, ancre: 'f-0001' });
		expect(dep.commits).toHaveLength(avant);
	});

	it('remplace selon les règles normales quand la source est plus fiable', async () => {
		const dep = fauxPorts();
		await proposer(dep, demande({ source: { ref: 'x', type: 'deduction' } }));
		await proposer(dep, demande({ texte: 'autre', remplace: 'f-0001' }));
		expect(dep.fichiers.get(P)).toContain('invalidé 2026-11-22 par ^f-0002');
	});

	it('refuse de remplacer un fait absent ou déjà barré', async () => {
		const dep = fauxPorts();
		await proposer(dep, demande());
		expect((await proposer(dep, demande({ texte: 'z', remplace: 'f-0042' }))).statut).toBe('refuse');
		await proposer(dep, demande({ texte: 'y', remplace: 'f-0001' }));
		expect((await proposer(dep, demande({ texte: 'w', remplace: 'f-0001' }))).statut).toBe('refuse');
	});

	it('ajoute les autres faits sans les toucher', async () => {
		const dep = fauxPorts();
		await proposer(dep, demande());
		const r = await proposer(dep, demande({ texte: 'Le client paie à 45 jours', source: { ref: 'x', type: 'deduction' }, apresProches: true }));
		expect(r).toMatchObject({ statut: 'ecrit', ancre: 'f-0002' });
		expect(dep.fichiers.get(P)).not.toContain('~~');
	});

	it('marque à confirmer une catégorie à enjeu', async () => {
		const dep = fauxPorts();
		const r = await proposer(dep, demande({ categorie: 'montant', texte: '12 000 EUR' }));
		expect(r).toMatchObject({ statut: 'ecrit', aConfirmer: true });
		expect(dep.fichiers.get(P)).toContain('- [montant] 12 000 EUR');
		expect(dep.fichiers.get(P)).toContain('| a confirmer');
	});

	it('refuse les demandes invalides avec un motif', async () => {
		const dep = fauxPorts();
		for (const surcharge of [
			{ texte: 'x'.repeat(501) },
			{ texte: '' },
			{ texte: 'a | b' },
			{ texte: 'a ~~ b' },
			{ source: { ref: '', type: 'utilisateur' as const } },
			{ source: { ref: 'a | b', type: 'utilisateur' as const } },
			{ fiche: '../x.md' },
			{ fiche: 'x.txt' },
			{ categorie: 'Majuscule' },
			{ citation: 'c'.repeat(501) },
			{ texte: '[abc] def' },
			{ source: { ref: '[[sources/../SCHEMA]]', type: 'contrat' as const } },
			{ source: { ref: '[[sources/../projets/q/q]]', type: 'contrat' as const } },
			{ source: { ref: '[[sources/../../x]]', type: 'contrat' as const } },
			{ source: { ref: '[[sources/CON]]', type: 'contrat' as const } },
			{ source: { ref: '[[sources/a:b?]]', type: 'contrat' as const } },
			{ source: { ref: '[[sources/]]', type: 'contrat' as const } },
		]) {
			const r = await proposer(dep, demande(surcharge));
			expect(r.statut, JSON.stringify(surcharge)).toBe('refuse');
			if (r.statut === 'refuse') expect(r.motif).not.toBe('');
		}
		expect(dep.commits).toHaveLength(0);
		expect(dep.fichiers.size).toBe(0);
	});

	it('conserve la citation sur la ligne suivante', async () => {
		const dep = fauxPorts();
		await proposer(dep, demande({ citation: 'Nous payons à 30 jours' }));
		expect(dep.fichiers.get(P)).toContain('^f-0001\n  > « Nous payons à 30 jours »');
	});

	it('exige un lien [[sources/…]] pour un document et crée la fiche de source', async () => {
		const dep = fauxPorts();
		expect((await proposer(dep, demande({ source: { ref: 'le contrat', type: 'contrat' } }))).statut).toBe('refuse');
		const r = await proposer(dep, demande({ source: { ref: '[[sources/contrat-acme]] p.12', type: 'contrat' } }));
		expect(r.statut).toBe('ecrit');
		const source = dep.fichiers.get('sources/contrat-acme.md')!;
		expect(source).toContain('type: source');
		expect(source).toContain('type_source: contrat');
		expect(source).toContain('# contrat-acme');
		expect(dep.commits[0]!.chemins).toEqual([P, 'projets/projets.md', 'sources/contrat-acme.md', 'sources/sources.md']);
	});

	it('déduit le type de source d\'un fait existant et applique les règles du coffre', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('SCHEMA.md', '---\nfiabilites:\n  email: 0.5\n---\n');
		await proposer(dep, demande({ source: { ref: '[[sources/mail]]', type: 'email' } }));
		expect(dep.fichiers.get(P)).toContain('confiance 50 %');
		const r = await proposer(dep, demande({ texte: 'autre', remplace: 'f-0001' }));
		expect(r.statut).toBe('ecrit');
	});

	it('ignore un lien de source malformé dans un fait existant', async () => {
		const dep = fauxPorts();
		dep.fichiers.set(P, '---\nid: X\ntype: sujet\nupdated: 2026-01-01\n---\n# p\n\n## Faits\n- ancien | src: [[sources/../../x]] | appris 2026-01-01 ^f-0001\n');
		const r = await proposer(dep, demande({ texte: 'nouveau', remplace: 'f-0001' }));
		expect(r.statut).toBe('ecrit');
	});

	it('ne laisse rien derrière lui si l\'écriture de la fiche principale échoue', async () => {
		const dep = fauxPorts();
		const ecrire = dep.coffre.ecrire;
		dep.coffre.ecrire = async (chemin, texte) => {
			if (chemin === P) throw new Error('disque plein');
			await ecrire(chemin, texte);
		};
		await expect(proposer(dep, demande({ source: { ref: '[[sources/contrat-acme]]', type: 'contrat' } }))).rejects.toThrow('disque plein');
		expect(dep.fichiers.size).toBe(0);
		expect(dep.commits).toHaveLength(0);
	});

	it('un secret reconnu est masqué avant l\'écriture : information, citation, consigne, fiche (jamais en clair dans git)', async () => {
		const dep = fauxPorts();
		const jeton = ['ghp', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_');
		expect((await proposer(dep, demande({ texte: `Le jeton de déploiement est ${jeton}`, citation: `password: Tr0ub4dor&3` }))).statut).toBe('ecrit');
		expect((await proposer(dep, { genre: 'consigne', texte: `Utiliser le jeton ${jeton} pour la CI`, portee: { genre: 'globale' }, source: { ref: 'dit en séance', type: 'utilisateur' }, apresProches: true })).statut).toBe('ecrit');
		expect((await proposer(dep, { genre: 'fiche', chemin: 'sujets/ci.md', type: 'sujet', titre: 'CI', synthese: `api_key = ${jeton}`, donnees: { jeton } })).statut).toBe('ecrit');
		const tout = [...dep.fichiers.values()].join('\n');
		expect(tout).not.toContain(jeton);
		expect(tout).not.toContain('Tr0ub4dor');
		expect(tout).toContain('[secret masqué]');
	});

	it('tout ou rien : un commit en échec remet chaque fichier écrit comme avant (fiche existante, fiches créées)', async () => {
		const dep = fauxPorts();
		await proposer(dep, demande());
		const avant = new Map(dep.fichiers);
		dep.historique.commit = async () => {
			throw new Error('git en panne');
		};
		await expect(proposer(dep, demande({ texte: 'Autre information', source: { ref: '[[sources/contrat-acme]]', type: 'contrat' } }))).rejects.toThrow('git en panne');
		expect(new Map(dep.fichiers)).toEqual(avant);
	});

	it('commite d\'abord les modifications manuelles', async () => {
		const dep = fauxPorts();
		dep.modificationsManuelles.push(P);
		await proposer(dep, demande());
		expect(dep.commits.map((c) => c.message)).toEqual(['mnemo: modification manuelle', 'mnemo: information projets/p/p.md']);
		expect(dep.commits[0]!.chemins).toBe('tout');
	});

	it('écrit sur disque et dans git (entrées/sorties réelles)', async () => {
		const racine = await dossierTemporaire();
		const dep = dependancesReelles(racine);
		await dep.historique.initialiser();
		const r = await proposer(dep, demande());
		expect(r).toMatchObject({ statut: 'ecrit', ancre: 'f-0001' });
		expect(await readFile(join(racine, '_mnemo', P), 'utf8')).toContain('^f-0001');
		const journal = execFileSync('git', ['log', '--format=%s'], { cwd: join(racine, '_mnemo'), encoding: 'utf8' });
		expect(journal).toContain('mnemo: information projets/p/p.md');
	});
});

describe('un fait ne contourne pas le chemin des consignes et des profils', () => {
	const email = { ref: '[[sources/mail]]', type: 'email' as const };

	it('refuse typeSiNouvelle consigne ou profil', async () => {
		const dep = fauxPorts();
		for (const type of ['consigne', 'profil'] as const) {
			const r = await proposer(dep, { genre: 'fait', fiche: `x/${type}.md`, typeSiNouvelle: type, texte: 'Un fait', nature: 'declare', source: { ref: 'dit', type: 'utilisateur' } });
			expect(r.statut, type).toBe('refuse');
		}
		expect(dep.fichiers.size).toBe(0);
	});

	it('refuse un fait de document sur une fiche existante de type consigne ou profil', async () => {
		const dep = fauxPorts();
		await proposer(dep, { genre: 'consigne', texte: 'Ne jamais pousser', portee: { genre: 'globale' }, source: { ref: 'dit', type: 'utilisateur' } });
		const consigne = [...dep.fichiers.keys()].find((c) => c.startsWith('consignes/Ne jamais'))!;
		dep.fichiers.set('profil/moi.md', dep.fichiers.get(consigne)!.replace('type: consigne', 'type: profil'));
		for (const chemin of [consigne, 'profil/moi.md']) {
			const n = dep.commits.length;
			const r = await proposer(dep, { genre: 'fait', fiche: chemin, texte: 'Un fait', nature: 'declare', source: email });
			expect(r.statut, chemin).toBe('refuse');
			expect(dep.commits).toHaveLength(n);
		}
	});
});

describe('la fiche de source suit les règles des fiches nouvelles', () => {
	it('crée sources/sources.md dans le même commit', async () => {
		const dep = fauxPorts();
		const r = await proposer(dep, { genre: 'fait', fiche: 'a/a.md', texte: 'Un fait', nature: 'declare', source: { ref: '[[sources/x]]', type: 'email' } });
		expect(r.statut).toBe('ecrit');
		expect(dep.fichiers.get('sources/sources.md')).toContain('type: dossier');
		expect(dep.fichiers.has('sources/x.md')).toBe(true);
		expect(dep.commits).toHaveLength(1);
	});
});
