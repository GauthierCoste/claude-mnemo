import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { filDuJour } from '../../src/application/fil.ts';
import { proposer } from '../../src/application/proposer.ts';
import type { Demande } from '../../src/application/proposer.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const UUID = '11111111-2222-4333-8444-555555555555';
const session = { ref: 'session 11111111', type: 'session' as const };
const CONSIGNE = 'consignes/env.md';

const fait = (surcharge: Record<string, unknown> = {}): Demande =>
	({ genre: 'fait', fiche: 'projets/p/p.md', texte: 'Le client paie à 30 jours', nature: 'declare', source: { ref: 'réunion', type: 'utilisateur' }, ...surcharge }) as Demande;

describe('filDuJour', () => {
	it('relit le trailer : commit d\'une session et commit sans session, hier exclu', async () => {
		const dep = fauxPorts();
		dep.origine = { session: UUID, projet: 'alpha' };
		await proposer(dep, fait());
		const hier = new Date(2026, 10, 21, 23, 0).getTime();
		const normal = dep.historique.journal.bind(dep.historique);
		dep.historique.journal = async (depuis, limite) => [
			...(await normal(depuis, limite)),
			{ hash: 'abc1234', dateMs: hier, message: 'ancien', fichiers: ['x.md'], session: null },
		];
		const fil = await filDuJour(dep);
		expect(fil.commits).toHaveLength(1);
		expect(fil.commits[0]).toMatchObject({ message: 'mnemo: information projets/p/p.md', session: UUID });
		expect(fil.commits[0]!.fiches).toContain('projets/p/p.md');
		expect(fil.commits.map((c) => c.message)).not.toContain('ancien');
	});

	it('jour explicite : seuls les commits de ce jour', async () => {
		const dep = fauxPorts();
		dep.historique.journal = async () => [
			{ hash: 'a', dateMs: new Date(2026, 10, 21, 10).getTime(), message: 'hier', fichiers: ['a.md', 'notes.txt'], session: null },
			{ hash: 'b', dateMs: new Date(2026, 10, 22, 10).getTime(), message: 'aujourd\'hui', fichiers: ['b.md'], session: null },
		];
		const fil = await filDuJour(dep, '2026-11-21');
		expect(fil.commits).toEqual([{ hash: 'a', dateMs: new Date(2026, 10, 21, 10).getTime(), message: 'hier', fiches: ['a.md'], session: null }]);
	});

	it('un fait inféré est dans aConfirmer', async () => {
		const dep = fauxPorts();
		await proposer(dep, fait({ nature: 'infere' }));
		const fil = await filDuJour(dep);
		expect(fil.aConfirmer.map((e) => e.texte)).toEqual([expect.stringContaining('Le client paie à 30 jours')]);
		expect(fil.aConfirmer[0]!.statut).toBe('a_confirmer');
	});

	it('une consigne répétée deux fois est dans montees avec le niveau proposé', async () => {
		const dep = fauxPorts();
		const demande: Demande = { genre: 'consigne', texte: 'Toujours relire les commits', portee: { genre: 'globale' }, source: { ref: 'dit', type: 'utilisateur' } } as Demande;
		await proposer(dep, demande);
		expect((await filDuJour(dep)).montees).toEqual([]);
		await proposer(dep, demande);
		await proposer(dep, demande);
		const { montees } = await filDuJour(dep);
		expect(montees).toHaveLength(1);
		expect(montees[0]).toMatchObject({ texte: 'Toujours relire les commits', niveau: 'toujours', proposition: null });
	});

	it('une proposition de session est dans montees', async () => {
		const dep = fauxPorts();
		dep.fichiers.set(CONSIGNE, '---\nid: C1\ntype: consigne\nupdated: 2026-11-01\nportee: globale\nniveau: toujours\nrepetitions: []\n---\n# Env\n\nNe touche jamais aux .env.\n');
		await proposer(dep, { genre: 'niveau', fiche: CONSIGNE, niveau: 'verifiee', regle: { type: 'chemins_interdits', motifs: ['**/.env'] }, source: session });
		const { montees } = await filDuJour(dep);
		expect(montees).toHaveLength(1);
		expect(montees[0]).toMatchObject({ fiche: CONSIGNE, niveau: 'verifiee', proposition: { niveau: 'verifiee', source: 'session 11111111' } });
	});
});

describe('commiter : origine', () => {
	it('transmet la session valide, jamais une valeur qui n\'est pas un uuid', async () => {
		const dep = fauxPorts();
		dep.origine = { session: UUID, projet: 'alpha' };
		await proposer(dep, fait());
		expect(dep.commits.at(-1)!.session).toBe(UUID);
		dep.origine = { session: `${UUID}\nMnemo-Session: autre`, projet: 'alpha' };
		await proposer(dep, fait({ texte: 'Autre fait' }));
		expect(dep.commits.at(-1)!.session).toBeUndefined();
	});
});

describe('filDuJour : limites', () => {
	it('commits très nombreux après le jour (vrai git) : le jour demandé reste complet et n\'est pas tronqué', async () => {
		const racine = await dossierTemporaire();
		const dep = dependancesReelles(racine);
		try {
			await dep.historique.initialiser();
			const midi = (j: number) => Math.floor(new Date(2026, 5, j, 12).getTime() / 1000);
			let flux = '';
			const ajouter = (ms: number, message: string, i: number) => {
				flux += `commit refs/heads/main\ncommitter T <t@l> ${ms} +0000\ndata ${message.length}\n${message}\nM 100644 inline f${i}.md\ndata 1\nx\n`;
			};
			ajouter(midi(15), 'un', 0);
			ajouter(midi(15) + 60, 'deux', 1);
			for (let i = 0; i < 510; i++) ajouter(midi(18) + i, `futur ${i}`, i + 2);
			execFileSync('git', ['fast-import', '--quiet'], { cwd: `${racine}/_mnemo`, input: flux });
			const fil = await filDuJour(dep, '2026-06-15');
			expect(fil.commits.map((c) => c.message)).toEqual(['deux', 'un']);
			expect(fil.tronque).toBe(false);
		} finally {
			dep.index.fermer();
		}
	});

	it('tronque vaut vrai quand le journal atteint 500 commits', async () => {
		const dep = fauxPorts();
		const dateMs = new Date(2026, 10, 22, 10).getTime();
		dep.historique.journal = async (_d, limite) => Array.from({ length: limite }, (_, i) => ({ hash: `h${i}`, dateMs, message: `m${i}`, fichiers: [], session: null }));
		const fil = await filDuJour(dep);
		expect(fil.commits).toHaveLength(500);
		expect(fil.tronque).toBe(true);
		expect((await filDuJour(fauxPorts())).tronque).toBe(false);
	});

	it('une fiche de consigne illisible est ignorée sans faire échouer le fil', async () => {
		const dep = fauxPorts();
		dep.fichiers.set(CONSIGNE, '---\nid: C1\ntype: consigne\nupdated: 2026-11-01\nportee: globale\nniveau: toujours\nrepetitions: []\n---\n# Env\n\nNe touche jamais aux .env.\n');
		await proposer(dep, { genre: 'niveau', fiche: CONSIGNE, niveau: 'verifiee', regle: { type: 'chemins_interdits', motifs: ['**/.env'] }, source: session });
		dep.fichiers.set(CONSIGNE, '---\nid: [pas fermé\n---\n');
		expect((await filDuJour(dep)).montees).toEqual([]);
	});
});
