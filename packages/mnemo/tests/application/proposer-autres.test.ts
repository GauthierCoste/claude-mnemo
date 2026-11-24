import { avertissementIndex, SANS_EXTRACTION, synchroniser } from '../../src/application/synchroniser.ts';
import { describe, expect, it } from 'vitest';
import { proposer } from '../../src/application/proposer.ts';
import type { Demande } from '../../src/application/proposer.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const src = { ref: 'dit en séance', type: 'utilisateur' as const };
const fait = (fiche: string, texte = 'Un fait', surcharge = {}): Demande => ({ genre: 'fait', fiche, texte, nature: 'declare', source: src, ...surcharge });

describe('proposer une fiche', () => {
	it('crée les dossiers ascendants manquants dans le même commit', async () => {
		const dep = fauxPorts();
		const r = await proposer(dep, { genre: 'fiche', chemin: 'projets/p/vente/catalogue/catalogue.md', type: 'sujet', titre: 'Catalogue', synthese: 'Résumé', donnees: { couleur: 'bleu' } });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'projets/p/vente/catalogue/catalogue.md' });
		expect([...dep.fichiers.keys()].sort()).toEqual(['projets/p/p.md', 'projets/p/vente/catalogue/catalogue.md', 'projets/p/vente/vente.md', 'projets/projets.md']);
		const texte = dep.fichiers.get('projets/p/vente/catalogue/catalogue.md')!;
		expect(texte).toContain('couleur: bleu');
		expect(texte).toContain('# Catalogue\n\nRésumé');
		expect(dep.fichiers.get('projets/p/p.md')).toContain('type: dossier');
		expect(dep.fichiers.get('projets/p/p.md')).toContain('# p');
		expect(dep.commits).toHaveLength(1);
		expect(dep.commits[0]!.message).toBe('mnemo: fiche projets/p/vente/catalogue/catalogue.md');
	});

	it('refuse un chemin existant, même à la casse près', async () => {
		const dep = fauxPorts();
		await proposer(dep, { genre: 'fiche', chemin: 'a/b.md', type: 'sujet', titre: 'B' });
		for (const chemin of ['a/b.md', 'a/B.md', 'A/b.md']) {
			expect((await proposer(dep, { genre: 'fiche', chemin, type: 'sujet', titre: 'B' })).statut, chemin).toBe('refuse');
		}
		expect(dep.commits).toHaveLength(1);
	});

	it('refuse les demandes invalides sans rien écrire', async () => {
		const dep = fauxPorts();
		for (const surcharge of [{ chemin: '../x.md' }, { chemin: 'x.txt' }, { titre: '' }, { titre: 'a\nb' }, { titre: 'x'.repeat(201) }, { synthese: 'a\n## Faits' }, { donnees: { id: 'x' } }, { type: 'episode', donnees: { session: 's1' } }, { donnees: { projet: 'p' } }, { type: 'source', donnees: { origine: 'claude-code/CLAUDE.md' } }]) {
			const r = await proposer(dep, { genre: 'fiche', chemin: 'a/b.md', type: 'sujet', titre: 'T', ...surcharge });
			expect(r.statut, JSON.stringify(surcharge)).toBe('refuse');
		}
		expect(dep.fichiers.size).toBe(0);
		expect(dep.commits).toHaveLength(0);
	});

	it('commite d\'abord les modifications manuelles', async () => {
		const dep = fauxPorts();
		dep.modificationsManuelles.push('x.md');
		await proposer(dep, { genre: 'fiche', chemin: 'b.md', type: 'sujet', titre: 'B' });
		expect(dep.commits.map((c) => c.message)).toEqual(['mnemo: modification manuelle', 'mnemo: fiche b.md']);
	});
});

describe('erreurs et collisions', () => {
	it('refuse une fiche dont un dossier existe à la casse près', async () => {
		const dep = fauxPorts();
		await proposer(dep, { genre: 'fiche', chemin: 'projets/p/p.md', type: 'sujet', titre: 'P' });
		const n = dep.commits.length;
		const r = await proposer(dep, { genre: 'fiche', chemin: 'Projets/p/x.md', type: 'sujet', titre: 'X' });
		expect(r.statut).toBe('refuse');
		if (r.statut === 'refuse') expect(r.motif).toContain('projets/projets.md');
		expect(dep.commits).toHaveLength(n);
		expect(dep.fichiers.size).toBe(2);
	});

	it('propage une erreur de commit pendant une répétition sans créer de doublon', async () => {
		const dep = fauxPorts();
		const d: Demande = { genre: 'consigne', texte: 'Règle', portee: { genre: 'globale' }, source: src };
		await proposer(dep, d);
		const avant = dep.fichiers.size;
		dep.historique.commit = async () => {
			throw new Error('git KO');
		};
		await expect(proposer(dep, d)).rejects.toThrow('git KO');
		expect(dep.fichiers.size).toBe(avant);
	});
});

describe('proposer une relation', () => {
	it('ajoute la relation sans doublon', async () => {
		const dep = fauxPorts();
		await proposer(dep, fait('a/a.md'));
		const r = await proposer(dep, { genre: 'relation', fiche: 'a/a.md', verbe: 'depend_de', cible: 'b/b' });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'a/a.md' });
		expect(dep.fichiers.get('a/a.md')).toContain('## Relations\n- depend_de [[b/b]]');
		expect(dep.commits.at(-1)!.message).toBe('mnemo: relation a/a.md');
		const n = dep.commits.length;
		expect(await proposer(dep, { genre: 'relation', fiche: 'a/a.md', verbe: 'depend_de', cible: 'b/b' })).toEqual({ statut: 'doublon', fiche: 'a/a.md' });
		expect(dep.commits).toHaveLength(n);
	});

	it('refuse verbe ou cible invalides, fiche absente', async () => {
		const dep = fauxPorts();
		await proposer(dep, fait('a/a.md'));
		const n = dep.commits.length;
		for (const [fiche, verbe, cible] of [['a/a.md', 'Dépend', 'x'], ['a/a.md', '', 'x'], ['a/a.md', 'v', ' '], ['a/a.md', 'v', 'a]]b'], ['a/a.md', 'v', 'a\nb'], ['absente.md', 'v', 'x'], ['../x.md', 'v', 'x']] as const) {
			expect((await proposer(dep, { genre: 'relation', fiche, verbe, cible })).statut, `${fiche} ${verbe} ${cible}`).toBe('refuse');
		}
		expect(dep.commits).toHaveLength(n);
	});
});

describe('retirer une relation', () => {
	it('retire la ligne visée et commite', async () => {
		const dep = fauxPorts();
		await proposer(dep, fait('a/a.md'));
		await proposer(dep, { genre: 'relation', fiche: 'a/a.md', verbe: 'depend_de', cible: 'b/b' });
		await proposer(dep, { genre: 'relation', fiche: 'a/a.md', verbe: 'utilise_par', cible: 'c/c' });
		const r = await proposer(dep, { genre: 'retirer_relation', fiche: 'a/a.md', verbe: 'depend_de', cible: 'b/b' });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'a/a.md' });
		const texte = dep.fichiers.get('a/a.md')!;
		expect(texte).not.toContain('depend_de');
		expect(texte).toContain('- utilise_par [[c/c]]');
		expect(dep.commits.at(-1)!.message).toBe('mnemo: retirer_relation a/a.md');
	});

	it('la cible est résolue comme tout lien (résolveur unique) : par titre, la relation écrite par chemin est retirée ; avertissements de l’index rendus', async () => {
		const dep = fauxPorts();
		await proposer(dep, fait('a/a.md'));
		await dep.coffre.ecrire('b/b.md', '---\nid: 01BBB\ntype: sujet\nupdated: 2026-11-01\n---\n# Bravo\n');
		await proposer(dep, { genre: 'relation', fiche: 'a/a.md', verbe: 'depend_de', cible: 'b/b' });
		const r = await proposer(dep, { genre: 'retirer_relation', fiche: 'a/a.md', verbe: 'depend_de', cible: 'Bravo' });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'a/a.md' });
		expect(dep.fichiers.get('a/a.md')!).not.toContain('depend_de');
		await proposer(dep, { genre: 'relation', fiche: 'a/a.md', verbe: 'depend_de', cible: 'b/b' });
		dep.index.remplacer = async () => {
			throw new Error('index cassé');
		};
		expect(await proposer(dep, { genre: 'retirer_relation', fiche: 'a/a.md', verbe: 'depend_de', cible: 'b/b' })).toMatchObject({ statut: 'ecrit', avertissements: [avertissementIndex('index cassé')] });
	});

	it('refuse une relation absente et liste les relations présentes', async () => {
		const dep = fauxPorts();
		await proposer(dep, fait('a/a.md'));
		await proposer(dep, { genre: 'relation', fiche: 'a/a.md', verbe: 'depend_de', cible: 'b/b' });
		const n = dep.commits.length;
		const r = await proposer(dep, { genre: 'retirer_relation', fiche: 'a/a.md', verbe: 'utilise_par', cible: 'b/b' });
		expect(r.statut).toBe('refuse');
		expect('motif' in r ? r.motif : '').toContain('depend_de [[b/b]]');
		expect(dep.commits).toHaveLength(n);
	});

	it('refuse une fiche absente ou un chemin invalide', async () => {
		const dep = fauxPorts();
		for (const fiche of ['absente.md', '../x.md']) {
			expect((await proposer(dep, { genre: 'retirer_relation', fiche, verbe: 'v', cible: 'x' })).statut, fiche).toBe('refuse');
		}
		expect(dep.commits).toHaveLength(0);
	});
});

describe('proposer une consigne', () => {
	const demande = (texte: string, surcharge = {}): Demande => ({ genre: 'consigne', texte, portee: { genre: 'globale' }, source: src, ...surcharge });

	it('place la consigne selon la portée, avec niveau rappelee', async () => {
		const dep = fauxPorts();
		const r = await proposer(dep, demande('Toujours répondre en français'));
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'consignes/Toujours répondre en français.md' });
		const texte = dep.fichiers.get('consignes/Toujours répondre en français.md')!;
		expect(texte).toContain('type: consigne');
		expect(texte).toContain('portee: globale');
		expect(texte).toContain('niveau: rappelee');
		expect(texte).toContain('source: utilisateur dit en séance');
		expect(dep.fichiers.has('consignes/consignes.md')).toBe(true);
		expect(dep.commits[0]!.message).toBe('mnemo: consigne consignes/Toujours répondre en français.md');
		// sans lieu qui déclare la portée : sous consignes/, comme une globale
		const sansLieu = await proposer(dep, demande('Règle Y', { portee: { genre: 'projet', nom: 'Z' } }));
		expect(sansLieu).toMatchObject({ fiche: 'consignes/Règle Y.md' });
	});

	it('une consigne de portée nommée naît sous le lieu qui déclare cette portée, où qu\'il soit rangé', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('travail/z/z.md', '---\nid: Z\ntype: dossier\nportee: projet:Z\nupdated: 2026-11-01\n---\n# Z\n');
		await dep.coffre.ecrire('travail/z/sous/sous.md', '---\nid: S\ntype: dossier\nportee: projet:Z\nupdated: 2026-11-01\n---\n# Sous\n');
		await dep.coffre.ecrire('acme.md', '---\nid: A\ntype: organisation\nportee: client:Acme\nupdated: 2026-11-01\n---\n# Acme\n');
		await dep.coffre.ecrire('clients/beta.md', '---\nid: B\ntype: organisation\nportee: client:Beta\nupdated: 2026-11-01\n---\n# Beta\n');
		await synchroniser(dep, SANS_EXTRACTION);
		expect(await proposer(dep, demande('Règle Z', { portee: { genre: 'projet', nom: 'Z' } }))).toMatchObject({ fiche: 'travail/z/consignes/Règle Z.md' });
		expect(await proposer(dep, demande('Règle B', { portee: { genre: 'client', nom: 'Beta' } }))).toMatchObject({ fiche: 'clients/consignes/Règle B.md' });
		expect(await proposer(dep, demande('Règle A', { portee: { genre: 'client', nom: 'Acme' } }))).toMatchObject({ fiche: 'consignes/Règle A.md' });
	});

	it('suffixe le chemin pris par une autre consigne, et tronque le titre', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('consignes/Règle X.md', '---\nid: A\ntype: consigne\nportee: projet:Q\n---\nautre texte\n');
		const r = await proposer(dep, demande('Règle X'));
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'consignes/Règle X 2.md' });
		const longue = 'mot '.repeat(40).trim();
		await proposer(dep, demande(longue));
		const f = [...dep.fichiers.entries()].find(([c]) => c.startsWith('consignes/mot'))!;
		expect(f[0].length).toBeLessThanOrEqual('consignes/.md'.length + 60);
		expect(f[1]).toContain(`# ${longue.slice(0, 80)}…`);
	});

	it('honore la fiche imposée, la valide et refuse une collision', async () => {
		const dep = fauxPorts();
		expect(await proposer(dep, demande('A', { fiche: 'x/ma-consigne.md' }))).toMatchObject({ statut: 'ecrit', fiche: 'x/ma-consigne.md' });
		expect((await proposer(dep, demande('B', { fiche: 'x/Ma-Consigne.md' }))).statut).toBe('refuse');
		expect((await proposer(dep, demande('C', { fiche: '../x.md' }))).statut).toBe('refuse');
	});

	it('compte les répétitions et propose de monter', async () => {
		const dep = fauxPorts();
		await proposer(dep, demande('Pas de  Commentaires inutiles'));
		const r1 = await proposer(dep, demande('pas de commentaires INUTILES'));
		expect(r1).toMatchObject({ statut: 'repetition', repetitions: 1, niveauPropose: null });
		const r2 = await proposer(dep, demande(' Pas de commentaires inutiles '));
		expect(r2).toMatchObject({ statut: 'repetition', repetitions: 2, niveauPropose: 'toujours', fiche: 'consignes/Pas de Commentaires inutiles.md' });
		expect(dep.fichiers.get(r2.statut === 'repetition' ? r2.fiche : '')).toContain('2026-11-22');
		expect(dep.commits.at(-1)!.message).toBe(`mnemo: consigne ${r2.statut === 'repetition' ? r2.fiche : ''}`);
	});

	it('ne confond pas les portées, ignore les fiches illisibles', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('cassee.md', '---\nid: [\n---\n');
		await proposer(dep, demande('Règle', { portee: { genre: 'projet', nom: 'A' } }));
		expect((await proposer(dep, demande('Règle', { portee: { genre: 'projet', nom: 'B' } }))).statut).toBe('ecrit');
		expect((await proposer(dep, demande('Règle'))).statut).toBe('ecrit');
		expect((await proposer(dep, demande('Règle', { portee: { genre: 'projet', nom: 'A' } }))).statut).toBe('repetition');
	});

	it('une consigne de portée mal écrite n\'est jamais comptée comme répétée (ni « réparée » en globale)', async () => {
		const dep = fauxPorts();
		const mal = '---\nid: A\ntype: consigne\nportee: projets:vela\nniveau: toujours\n---\n# Règle\n\nRègle\n';
		dep.fichiers.set('consignes/mal.md', mal);
		expect(await proposer(dep, demande('Règle'))).toMatchObject({ statut: 'ecrit', fiche: 'consignes/Règle.md' });
		expect(dep.fichiers.get('consignes/mal.md')).toBe(mal);
	});

	it('exige une source valide et un texte valide', async () => {
		const dep = fauxPorts();
		for (const surcharge of [{ texte: '' }, { texte: 'a\nb' }, { source: { ref: '', type: 'utilisateur' as const } }, { source: { ref: 'x', type: 'contrat' as const } }, { portee: { genre: 'projet' as const, nom: 'a/b' } }, { portee: { genre: 'projet' as const, nom: '' } }]) {
			expect((await proposer(dep, demande('ok', surcharge))).statut, JSON.stringify(surcharge)).toBe('refuse');
		}
		expect(dep.fichiers.size).toBe(0);
		const r = await proposer(dep, demande('ok', { source: { ref: 'session s1', type: 'session' as const } }));
		expect(r.statut).toBe('ecrit');
	});
});

describe('décisions de l\'utilisateur', () => {
	const mise = async (dep: ReturnType<typeof fauxPorts>) => {
		await proposer(dep, fait('a/a.md', 'Montant', { categorie: 'montant' })); // à confirmer, f-0001
		await proposer(dep, fait('a/a.md', 'Autre')); // f-0002
	};

	it('confirme un fait à confirmer, une seule fois', async () => {
		const dep = fauxPorts();
		await mise(dep);
		expect(dep.fichiers.get('a/a.md')).toContain('| a confirmer');
		const r = await proposer(dep, { genre: 'confirmer', fiche: 'a/a.md', ancre: 'f-0001' }, { appliquerDirectement: true });
		expect(r).toMatchObject({ statut: 'ecrit', ancre: 'f-0001' });
		expect(dep.fichiers.get('a/a.md')).not.toContain('a confirmer');
		expect(dep.commits.at(-1)!.message).toBe('mnemo: confirme a/a.md ^f-0001');
		expect((await proposer(dep, { genre: 'confirmer', fiche: 'a/a.md', ancre: 'f-0001' }, { appliquerDirectement: true })).statut).toBe('refuse');
		expect((await proposer(dep, { genre: 'confirmer', fiche: 'a/a.md', ancre: 'f-0002' }, { appliquerDirectement: true })).statut).toBe('refuse');
	});

	it('rejette (barre) un fait, une seule fois', async () => {
		const dep = fauxPorts();
		await mise(dep);
		await proposer(dep, { genre: 'rejeter', fiche: 'a/a.md', ancre: 'f-0002' }, { appliquerDirectement: true });
		expect(dep.fichiers.get('a/a.md')).toContain('- ~~Autre~~');
		expect(dep.fichiers.get('a/a.md')).toContain('invalidé 2026-11-22 ^f-0002');
		expect(dep.commits.at(-1)!.message).toBe('mnemo: rejette a/a.md ^f-0002');
		expect((await proposer(dep, { genre: 'rejeter', fiche: 'a/a.md', ancre: 'f-0002' }, { appliquerDirectement: true })).statut).toBe('refuse');
	});

	it('hors d\'un canal de l\'utilisateur (MCP), confirmer, rejeter et supprimer sont refusés sans rien écrire', async () => {
		const dep = fauxPorts();
		await mise(dep);
		const avant = dep.fichiers.get('a/a.md');
		const commits = dep.commits.length;
		for (const genre of ['confirmer', 'rejeter', 'supprimer'] as const) {
			const r = await proposer(dep, { genre, fiche: 'a/a.md', ancre: 'f-0001' });
			expect(r.statut, genre).toBe('refuse');
			if (r.statut === 'refuse') expect(r.motif, genre).toContain('réservé à l\'utilisateur');
		}
		expect(dep.fichiers.get('a/a.md')).toBe(avant);
		expect(dep.commits).toHaveLength(commits);
	});

	it('supprime la ligne d\'un fait', async () => {
		const dep = fauxPorts();
		await mise(dep);
		await proposer(dep, { genre: 'supprimer', fiche: 'a/a.md', ancre: 'f-0001' }, { appliquerDirectement: true });
		expect(dep.fichiers.get('a/a.md')).not.toContain('Montant');
		expect(dep.fichiers.get('a/a.md')).toContain('Autre');
		expect(dep.commits.at(-1)!.message).toBe('mnemo: supprime a/a.md ^f-0001');
	});

	it('refuse une ancre ou une fiche inconnue sans écrire', async () => {
		const dep = fauxPorts();
		await mise(dep);
		const n = dep.commits.length;
		for (const genre of ['confirmer', 'rejeter', 'supprimer'] as const) {
			expect((await proposer(dep, { genre, fiche: 'a/a.md', ancre: 'f-0099' })).statut).toBe('refuse');
			expect((await proposer(dep, { genre, fiche: 'z.md', ancre: 'f-0001' })).statut).toBe('refuse');
		}
		expect(dep.commits).toHaveLength(n);
	});
});
