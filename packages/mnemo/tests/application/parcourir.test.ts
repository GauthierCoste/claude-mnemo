import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deplacer } from '../../src/application/deplacer.ts';
import { lire } from '../../src/application/lire.ts';
import { lister } from '../../src/application/lister.ts';
import { proposer } from '../../src/application/proposer.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const fiche = (type: string, titre: string, corps = '', alias = '') => `---\nid: X\ntype: ${type}\n${alias}updated: 2026-11-01\n---\n# ${titre}\n\n${corps}\n`;

function vault() {
	const dep = fauxPorts();
	dep.fichiers.set('projets/projets.md', fiche('dossier', 'projets'));
	dep.fichiers.set('projets/p/p.md', fiche('dossier', 'p'));
	dep.fichiers.set('projets/p/zeta.md', fiche('sujet', 'Zeta'));
	dep.fichiers.set('projets/p/a.md', fiche('sujet', 'Alpha', 'Résumé.\n\n## Faits\n- Un fait ^f-0001'));
	dep.fichiers.set('projets/p/casse.md', 'pas une fiche');
	dep.fichiers.set('projets/p/sous/sous.md', fiche('dossier', 'sous'));
	dep.fichiers.set('autre.md', fiche('sujet', 'Autre', 'Voir [[projets/p/a#^f-0001|voir]] et [[projets/p/a]] et [[a]] et [[a|lib]].\n\n```\n[[projets/p/a]]\n```\n\nFin [[b]]'));
	return dep;
}

describe('lire et lister', () => {
	it('lire : chemin invalide ou absent donne null', async () => {
		const dep = vault();
		expect(await lire(dep, '../x.md')).toBeNull();
		expect(await lire(dep, 'nope.md')).toBeNull();
		expect((await lire(dep, 'projets/p/a.md'))?.titre).toBe('Alpha');
	});

	it('lister renvoie fiche de dossier, fiches triées, sous-dossiers', async () => {
		const l = await lister(vault(), 'projets/p');
		expect(l.ficheDossier?.titre).toBe('p');
		expect(l.fiches).toEqual([
			{ chemin: 'projets/p/a.md', titre: 'Alpha', type: 'sujet' },
			{ chemin: 'projets/p/casse.md', titre: 'casse', type: 'sujet' },
			{ chemin: 'projets/p/zeta.md', titre: 'Zeta', type: 'sujet' },
		]);
		expect(l.sousDossiers).toEqual(['sous']);
	});

	it('lister la racine', async () => {
		const l = await lister(vault(), '');
		expect(l.ficheDossier).toBeNull();
		expect(l.fiches.map((f) => f.chemin)).toEqual(['autre.md']);
		expect(l.sousDossiers).toEqual(['projets']);
	});
});

describe('deplacer', () => {
	it('refuse de déplacer un profil (chemin fixe), sans rien écrire ; une note importée de Claude Code se déplace', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('profils/travail/travail.md', '---\nid: 01PRO\ntype: profil\nupdated: 2026-11-01\n---\n# Profil travail\n\nConsigne.\n');
		dep.fichiers.set('sources/claude-code/x/n.md', '---\nid: 01NOT\ntype: source\ntype_source: note\norigine: claude-code/x/memory/n.md\nupdated: 2026-11-01\n---\n# n\n');
		const profil = await deplacer(dep, 'profils/travail/travail.md', 'notes/travail.md');
		expect(profil).toMatchObject({ statut: 'refuse', motif: expect.stringMatching(/chemin (est )?fixe/u) });
		expect(dep.commits).toHaveLength(0);
		expect((await deplacer(dep, 'sources/claude-code/x/n.md', 'notes/n.md')).statut).toBe('ecrit');
		expect(dep.fichiers.has('notes/n.md')).toBe(true);
	});

	it('déplace une fiche qui déclare dossier_projet (le lien suit la fiche), quel que soit son type', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('clients/acme.md', '---\nid: 01ENT\ntype: entite\ndossier_projet: Sites/acme\nupdated: 2026-11-01\n---\n# Acme\n');
		dep.fichiers.set('notes/n.md', '---\nid: 01SUJ\ntype: sujet\ndossier_projet: Sites/n\nupdated: 2026-11-01\n---\n# N\n');
		for (const [de, vers] of [['clients/acme.md', 'clients/acme2.md'], ['notes/n.md', 'notes/n2.md']] as const) {
			expect((await deplacer(dep, de, vers)).statut, de).toBe('ecrit');
		}
		expect(dep.commits).toHaveLength(2);
	});

	it('déplace, réécrit les liens, ajoute l\'alias, crée les dossiers, un seul commit', async () => {
		const dep = vault();
		const r = await deplacer(dep, 'projets/p/a.md', 'projets/q/b2.md');
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'projets/q/b2.md', aConfirmer: false });
		expect(dep.fichiers.has('projets/p/a.md')).toBe(false);
		expect(dep.fichiers.get('projets/q/b2.md')).toContain('alias: [a]');
		expect(dep.fichiers.has('projets/q/q.md')).toBe(true);
		const autre = dep.fichiers.get('autre.md')!;
		expect(autre).toContain('[[projets/q/b2#^f-0001|voir]] et [[projets/q/b2]] et [[projets/q/b2]] et [[projets/q/b2|lib]]');
		expect(autre).toContain('```\n[[projets/p/a]]\n```');
		expect(autre).toContain('[[b]]');
		expect(dep.commits).toHaveLength(1);
		expect(dep.commits[0]!.message).toBe('mnemo: déplace projets/p/a.md → projets/q/b2.md');
		expect(dep.commits[0]!.chemins).toEqual(expect.arrayContaining(['projets/p/a.md', 'projets/q/b2.md', 'autre.md', 'projets/q/q.md']));
	});

	it('ne réécrit pas un lien par nom nu quand le nom est ambigu ; pas d\'alias si le nom est le titre', async () => {
		const dep = vault();
		dep.fichiers.set('ailleurs/a.md', fiche('sujet', 'A'));
		await deplacer(dep, 'projets/p/a.md', 'projets/p/c.md');
		expect(dep.fichiers.get('autre.md')).toContain('et [[a]] et [[a|lib]]');
		dep.fichiers.set('x/Nom.md', fiche('sujet', 'Nom'));
		await deplacer(dep, 'x/Nom.md', 'y/Autre.md');
		expect(dep.fichiers.get('y/Autre.md')).not.toContain('alias');
	});

	it('refuse les cas invalides sans rien écrire', async () => {
		const dep = vault();
		const avant = new Map(dep.fichiers);
		for (const [de, vers] of [
			['absente.md', 'z.md'],
			['projets/p/p.md', 'z.md'],
			['projets/p/a.md', '../z.md'],
			['projets/p/a.md', 'z'],
			['projets/p/a.md', 'projets/p/ZETA.md'],
			['projets/p/a.md', 'autre.md'],
			['projets/p/a.md', 'projets/p/a.md'],
		] as const) {
			expect(await deplacer(dep, de, vers)).toMatchObject({ statut: 'refuse' });
		}
		expect(dep.fichiers).toEqual(avant);
		expect(dep.commits).toHaveLength(0);
	});

	it('intégration : ports réels, fichier déplacé, un commit avec renommage', async () => {
		const racine = await dossierTemporaire();
		const dep = dependancesReelles(racine);
		await dep.historique.initialiser();
		await proposer(dep, { genre: 'fiche', chemin: 'projets/p/a.md', type: 'sujet', titre: 'Alpha', synthese: 'R' });
		const avant = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: join(racine, '_mnemo') }).toString().trim();
		const r = await deplacer(dep, 'projets/p/a.md', 'projets/p/b.md');
		expect(r.statut).toBe('ecrit');
		expect(await dep.coffre.lire('projets/p/a.md')).toBeNull();
		expect(await dep.coffre.lire('projets/p/b.md')).toContain('alias: [a]');
		const apres = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: join(racine, '_mnemo') }).toString().trim();
		expect(Number(apres)).toBe(Number(avant) + 1);
		const diff = execFileSync('git', ['show', '--stat', '--format=%s', 'HEAD'], { cwd: join(racine, '_mnemo') }).toString();
		expect(diff).toContain('mnemo: déplace projets/p/a.md → projets/p/b.md');
		expect(diff).toContain('a.md');
		expect(diff).toContain('b.md');
	});
});
