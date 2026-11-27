import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deplacer } from '../../src/application/deplacer.ts';
import { lister } from '../../src/application/lister.ts';
import { proposer } from '../../src/application/proposer.ts';
import type { Demande } from '../../src/application/proposer.ts';
import { dependancesFermees } from '../aides/dependances-reelles.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const src = { ref: 'dit en séance', type: 'utilisateur' as const };
const fait = (fiche: string, texte = 'Un fait', surcharge = {}): Demande => ({ genre: 'fait', fiche, texte, nature: 'declare', source: src, ...surcharge });
const git = (racine: string, ...args: string[]) => execFileSync('git', args, { cwd: join(racine, '_mnemo'), encoding: 'utf8' });

async function coffreReel() {
	const racine = await dossierTemporaire();
	const dep = dependancesFermees(racine);
	await dep.historique.initialiser();
	return { racine, dep };
}

describe('chemins à la casse près (ports réels)', () => {
	it('refuse un fait sur une variante de casse d\'une fiche existante, sans rien écrire', async () => {
		const { racine, dep } = await coffreReel();
		expect((await proposer(dep, fait('projets/mnemo.md'))).statut).toBe('ecrit');
		const avant = git(racine, 'rev-list', '--count', 'HEAD');
		const r = await proposer(dep, fait('Projets/Mnemo.md', 'Autre fait'));
		expect(r.statut).toBe('refuse');
		if (r.statut === 'refuse') expect(r.motif).toContain('projets/mnemo.md');
		expect(git(racine, 'rev-list', '--count', 'HEAD')).toBe(avant);
		expect(git(racine, 'status', '--porcelain')).toBe('');
		expect(await dep.coffre.lire('projets/mnemo.md')).not.toContain('Autre fait');
	});

	it('refuse relation, décision, consigne imposée et déplacement sur une variante de casse', async () => {
		const { racine, dep } = await coffreReel();
		await proposer(dep, fait('projets/mnemo.md', 'Montant', { categorie: 'montant' }));
		const avant = git(racine, 'rev-list', '--count', 'HEAD');
		const demandes: Demande[] = [
			{ genre: 'relation', fiche: 'projets/Mnemo.md', verbe: 'concerne', cible: 'x' },
			{ genre: 'confirmer', fiche: 'Projets/mnemo.md', ancre: 'f-0001' },
			{ genre: 'consigne', fiche: 'projets/MNEMO.md', texte: 'Règle', portee: { genre: 'globale' }, source: src },
		];
		for (const d of demandes) {
			const r = await proposer(dep, d, { appliquerDirectement: true });
			expect(r.statut, d.genre).toBe('refuse');
			if (r.statut === 'refuse') expect(r.motif, d.genre).toContain('projets/mnemo.md');
		}
		const r = await deplacer(dep, 'Projets/Mnemo.md', 'projets/autre.md');
		expect(r.statut).toBe('refuse');
		expect(git(racine, 'rev-list', '--count', 'HEAD')).toBe(avant);
		expect(git(racine, 'status', '--porcelain')).toBe('');
	});

	it('refuse une source dont la fiche existe à la casse près', async () => {
		const { dep } = await coffreReel();
		await proposer(dep, fait('a.md', 'A', { source: { ref: '[[sources/cdc]]', type: 'contrat' } }));
		const r = await proposer(dep, fait('a.md', 'B', { source: { ref: '[[sources/CDC]]', type: 'contrat' } }));
		expect(r.statut).toBe('refuse');
		if (r.statut === 'refuse') expect(r.motif).toContain('sources/cdc.md');
	});

	it('déplace avec les ports réels : un commit, ancien fichier supprimé, arbre propre', async () => {
		const { racine, dep } = await coffreReel();
		await proposer(dep, fait('projets/p/a.md'));
		const r = await deplacer(dep, 'projets/p/a.md', 'projets/q/a.md');
		expect(r.statut).toBe('ecrit');
		expect(git(racine, 'status', '--porcelain')).toBe('');
		expect(git(racine, 'ls-files')).not.toContain('projets/p/a.md');
		expect(git(racine, 'ls-files')).toContain('projets/q/a.md');
		expect(git(racine, 'log', '-1', '--format=%s')).toBe('mnemo: déplace projets/p/a.md → projets/q/a.md\n');
	});
});

describe('chemins réservés et cachés', () => {
	it('refuse d\'écrire SCHEMA.md ou sous un dossier caché', async () => {
		const dep = fauxPorts();
		for (const chemin of ['SCHEMA.md', 'schema.md', '.obsidian/x.md', '.git/x.md', 'a/.cache/x.md', 'a/.x.md']) {
			expect((await proposer(dep, fait(chemin))).statut, chemin).toBe('refuse');
			expect((await proposer(dep, { genre: 'fiche', chemin, type: 'sujet', titre: 'T' })).statut, chemin).toBe('refuse');
		}
		expect(dep.fichiers.size).toBe(0);
	});

	it('refuse de déplacer depuis ou vers un chemin réservé', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('SCHEMA.md', '---\nseuil_rappel: 0.4\n---\n# Schéma\n');
		await proposer(dep, fait('a.md'));
		const n = dep.commits.length;
		for (const [de, vers] of [['SCHEMA.md', 'b.md'], ['a.md', 'SCHEMA.md'], ['a.md', '.obsidian/a.md'], ['a.md', 'x/.a.md']] as const) {
			expect((await deplacer(dep, de, vers)).statut, `${de} → ${vers}`).toBe('refuse');
		}
		expect(dep.commits).toHaveLength(n);
	});

	it('lister n\'affiche pas SCHEMA.md', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('SCHEMA.md', '---\nseuil_rappel: 0.4\n---\n# Schéma\n');
		dep.fichiers.set('a.md', '# A\n');
		expect((await lister(dep, '')).fiches.map((f) => f.chemin)).toEqual(['a.md']);
	});
});

describe('syntaxe de lien dans les noms', () => {
	it('une consigne avec # ^ [ ] donne un nom de fichier sans syntaxe de lien', async () => {
		const dep = fauxPorts();
		const r2 = await proposer(dep, { genre: 'consigne', texte: 'Tester avec #vitest [v3] ^x', portee: { genre: 'globale' }, source: src });
		expect(r2.statut).toBe('ecrit');
		if (r2.statut === 'ecrit') expect(r2.fiche).not.toMatch(/[#^[\]|]/u);
	});

	it('refuse un chemin de fiche avec # ^ [ ] |', async () => {
		const dep = fauxPorts();
		for (const chemin of ['a#b.md', 'a^b.md', 'a[b].md', 'x/a]b.md']) {
			expect((await proposer(dep, fait(chemin))).statut, chemin).toBe('refuse');
		}
		expect(dep.fichiers.size).toBe(0);
	});

	it('un lien de source vers une section désigne la fiche de source', async () => {
		const dep = fauxPorts();
		const r = await proposer(dep, fait('a.md', 'A', { source: { ref: '[[sources/cdc#Livraison]] p.3', type: 'contrat' } }));
		expect(r.statut).toBe('ecrit');
		expect(dep.fichiers.has('sources/cdc.md')).toBe(true);
		expect([...dep.fichiers.keys()].some((c) => c.includes('#'))).toBe(false);
		expect(dep.fichiers.get('a.md')).toContain('src: [[sources/cdc#Livraison]] p.3');
		const r2 = await proposer(dep, fait('a.md', 'B', { source: { ref: '[[sources/cdc^bloc]]', type: 'contrat' } }));
		expect(r2.statut).toBe('ecrit');
		expect([...dep.fichiers.keys()].filter((c) => c.startsWith('sources/'))).toEqual(['sources/cdc.md', 'sources/sources.md']);
	});
});
