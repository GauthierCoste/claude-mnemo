import { describe, expect, it } from 'vitest';
import { proposer as proposerBrut } from '../../src/application/proposer.ts';
import type { Demande } from '../../src/application/proposer.ts';
import { validerDemande } from '../../src/application/validation.ts';
import { lireConsigne } from '../../src/domaine/consigne.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const CHEMIN = 'consignes/env.md';
const utilisateur = { ref: 'dit en séance', type: 'utilisateur' as const };
const session = { ref: 'session 11111111', type: 'session' as const };
const REGLE = { type: 'chemins_interdits' as const, motifs: ['**/.env'] };

async function avecConsigne(niveau = 'toujours', extra = '') {
	const dep = fauxPorts();
	dep.fichiers.set(CHEMIN, `---\nid: C1\ntype: consigne\nupdated: 2026-11-01\nportee: globale\nniveau: ${niveau}\nrepetitions: []\n${extra}---\n# Env\n\nNe touche jamais aux .env.\n`);
	return dep;
}
const lue = (dep: ReturnType<typeof fauxPorts>) => lireConsigne(lireFiche(CHEMIN, dep.fichiers.get(CHEMIN)!));
/** Canal de l'utilisateur (CLI, service) : la source `utilisateur` y est crue. */
const proposer = (dep: ReturnType<typeof fauxPorts>, demande: Demande) => proposerBrut(dep, demande, { appliquerDirectement: true });
const niveau = (surcharge: Record<string, unknown>): Demande => ({ genre: 'niveau', fiche: CHEMIN, source: utilisateur, ...surcharge }) as Demande;

describe('proposer : genre niveau', () => {
	it('session : montée et règle posées en proposition, niveau inchangé, à confirmer', async () => {
		const dep = await avecConsigne();
		const r = await proposer(dep, niveau({ niveau: 'verifiee', regle: REGLE, source: session }));
		expect(r).toMatchObject({ statut: 'ecrit', fiche: CHEMIN, aConfirmer: true });
		const c = lue(dep);
		expect(c.niveau).toBe('toujours');
		expect(c.regle).toBeUndefined();
		expect(c.proposition).toEqual({ niveau: 'verifiee', regle: REGLE, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u), source: 'session 11111111' });
		expect(dep.commits.at(-1)!.message).toBe(`mnemo: propose niveau ${CHEMIN}`);
	});

	it('utilisateur : appliqué, proposition effacée', async () => {
		const dep = await avecConsigne();
		await proposer(dep, niveau({ niveau: 'verifiee', regle: REGLE, source: session }));
		const r = await proposer(dep, niveau({ niveau: 'verifiee', regle: REGLE }));
		expect(r).toMatchObject({ statut: 'ecrit', aConfirmer: false });
		const c = lue(dep);
		expect(c.niveau).toBe('verifiee');
		expect(c.regle).toEqual(REGLE);
		expect(c.proposition).toBeUndefined();
		expect(c.texte).toBe('Ne touche jamais aux .env.');
		expect(dep.commits.at(-1)!.message).toBe(`mnemo: niveau ${CHEMIN}`);
	});

	it('utilisateur : une montée sans règle (rappelee → toujours), la règle seule', async () => {
		const dep = await avecConsigne('rappelee');
		expect(await proposer(dep, niveau({ niveau: 'toujours' }))).toMatchObject({ statut: 'ecrit' });
		expect(lue(dep).niveau).toBe('toujours');
		expect(await proposer(dep, niveau({ regle: REGLE }))).toMatchObject({ statut: 'ecrit' });
		expect(lue(dep)).toMatchObject({ niveau: 'toujours', regle: REGLE });
		// la règle déjà posée suffit pour monter à verifiee
		expect(await proposer(dep, niveau({ niveau: 'verifiee' }))).toMatchObject({ statut: 'ecrit' });
		expect(lue(dep).niveau).toBe('verifiee');
	});

	it('verifiee sans règle valide : refusé', async () => {
		const dep = await avecConsigne();
		expect(await proposer(dep, niveau({ niveau: 'verifiee' }))).toMatchObject({ statut: 'refuse' });
		expect(await proposer(dep, niveau({ niveau: 'verifiee', source: session }))).toMatchObject({ statut: 'refuse' });
		expect(await proposer(dep, niveau({ niveau: 'verifiee', regle: { type: 'chemins_interdits', motifs: [] } }))).toMatchObject({ statut: 'refuse' });
		expect(await proposer(dep, niveau({ niveau: 'verifiee', regle: { type: 'commandes_interdites', motifs: ['a\nb'] } }))).toMatchObject({ statut: 'refuse' });
		expect(dep.commits).toHaveLength(0);
		expect(lue(dep).niveau).toBe('toujours');
	});

	it('retirerProposition (utilisateur) : rejette la proposition ; refusé pour une session ou sans proposition', async () => {
		const dep = await avecConsigne();
		expect(await proposer(dep, niveau({ retirerProposition: true }))).toMatchObject({ statut: 'refuse' });
		await proposer(dep, niveau({ niveau: 'verifiee', regle: REGLE, source: session }));
		expect(await proposer(dep, niveau({ retirerProposition: true, source: session }))).toMatchObject({ statut: 'refuse' });
		expect(await proposer(dep, niveau({ retirerProposition: true, niveau: 'verifiee' }))).toMatchObject({ statut: 'refuse' });
		expect(await proposer(dep, niveau({ retirerProposition: true }))).toMatchObject({ statut: 'ecrit', aConfirmer: false });
		expect(lue(dep)).toMatchObject({ niveau: 'toujours' });
		expect(lue(dep).proposition).toBeUndefined();
		expect(dep.commits.at(-1)!.message).toBe(`mnemo: rejette niveau ${CHEMIN}`);
	});

	it('refus : fiche absente ou pas une consigne, source document, rien demandé ou rien à changer', async () => {
		const dep = await avecConsigne();
		dep.fichiers.set('sujets/s.md', '---\nid: S\ntype: sujet\n---\n# S\n');
		expect(await proposer(dep, { ...niveau({ niveau: 'toujours' }), fiche: 'consignes/absente.md' } as Demande)).toMatchObject({ statut: 'refuse' });
		expect(await proposer(dep, { ...niveau({ niveau: 'toujours' }), fiche: 'sujets/s.md' } as Demande)).toMatchObject({ statut: 'refuse' });
		expect(await proposer(dep, niveau({ niveau: 'rappelee', source: { ref: '[[sources/a]]', type: 'email' } }))).toMatchObject({ statut: 'refuse' });
		expect(await proposer(dep, niveau({}))).toMatchObject({ statut: 'refuse' });
		expect(await proposer(dep, niveau({ niveau: 'toujours' }))).toMatchObject({ statut: 'refuse' });
		expect(dep.commits).toHaveLength(0);
	});

	it('sans canal de confiance (défaut) : source utilisateur posée en proposition ; retirerProposition refusé', async () => {
		const dep = await avecConsigne();
		expect(await proposerBrut(dep, niveau({ niveau: 'verifiee', regle: REGLE }))).toMatchObject({ statut: 'ecrit', aConfirmer: true });
		expect(lue(dep)).toMatchObject({ niveau: 'toujours', proposition: { niveau: 'verifiee', regle: REGLE, source: 'utilisateur dit en séance' } });
		expect(lue(dep).regle).toBeUndefined();
		expect(await proposerBrut(dep, niveau({ retirerProposition: true }))).toMatchObject({ statut: 'refuse' });
		expect(lue(dep).proposition).toBeDefined();
	});

	it('validation : forme du genre niveau', () => {
		expect(validerDemande({ genre: 'niveau', fiche: CHEMIN, niveau: 'verifiee', regle: REGLE, source: session })).toMatchObject({ ok: true });
		expect(validerDemande({ genre: 'niveau', fiche: CHEMIN, regle: { type: 'chemins_interdits', motifs: 'x' }, source: session })).toMatchObject({ ok: false });
		expect(validerDemande({ genre: 'niveau', fiche: CHEMIN, regle: { type: 'chemins_interdits', motifs: [1] }, source: session })).toMatchObject({ ok: false });
		expect(validerDemande({ genre: 'niveau', fiche: CHEMIN, regle: { type: 'autre', motifs: ['a'] }, source: session })).toMatchObject({ ok: false });
		expect(validerDemande({ genre: 'niveau', fiche: CHEMIN, niveau: 'max', source: session })).toMatchObject({ ok: false });
	});
});
