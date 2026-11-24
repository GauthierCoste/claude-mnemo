import { describe, expect, it } from 'vitest';
import { chercher } from '../../src/application/chercher.ts';
import { avertissementIndex, reindexerApresEcriture, synchroniser } from '../../src/application/synchroniser.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const fiche = (corps: string, entete = 'type: sujet') => `---\nid: 01ABC\n${entete}\nupdated: 2026-11-01\n---\n# Titre\n\n${corps}\n`;
const fait = (texte: string, ancre = 'f-0001') => `## Faits\n- ${texte} | declare | src: utilisateur oral | appris 2026-11-20 | confiance 100 % ^${ancre}\n`;

function espion(dep: ReturnType<typeof fauxPorts>) {
	const lectures: string[] = [];
	const lire = dep.coffre.lire;
	dep.coffre.lire = async (chemin) => {
		lectures.push(chemin);
		return lire(chemin);
	};
	return lectures;
}

describe('reindexerApresEcriture', () => {
	it('réindexation réussie : aucun avertissement', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('projets/a.md', fiche('Texte.'));
		expect(await reindexerApresEcriture(dep)).toEqual({});
	});

	it('réindexation en échec : succès avec un avertissement (jamais un échec, l\'écriture est faite), indicateur « illisible » (strict)', async () => {
		const dep = fauxPorts();
		await dep.indicateur.noter(false, 1);
		await dep.coffre.ecrire('consignes/push.md', fiche('Jamais de push forcé.', 'type: consigne\nportee: globale\nniveau: verifiee\nregle: { type: commandes_interdites, motifs: ["git push --force*"] }'));
		dep.index.remplacer = () => Promise.reject(new Error('database is locked'));
		expect(await reindexerApresEcriture(dep)).toEqual({ avertissements: [avertissementIndex('database is locked')] });
		expect(await dep.indicateur.lire()).toEqual({ genre: 'illisible' });
		expect(dep.fichiers.has('consignes/push.md')).toBe(true);
	});
});

describe('reindexerApresEcriture : l\'indicateur ne peut pas être marqué', () => {
	it('l\'écriture reste un succès : l\'erreur de l\'indicateur s\'ajoute aux avertissements', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('projets/a.md', fiche('Texte.'));
		dep.index.remplacer = () => Promise.reject(new Error('database is locked'));
		dep.indicateur.marquerIllisible = () => Promise.reject(new Error('EACCES'));
		expect(await reindexerApresEcriture(dep)).toEqual({
			avertissements: [avertissementIndex('database is locked'), 'L\'indicateur des consignes vérifiées n\'a pas pu être marqué « pas à jour » : EACCES.'],
		});
	});
});

describe('synchroniser', () => {
	it('note à chaque fois si la mémoire contient des consignes vérifiées (indicateur de l\'état local)', async () => {
		const dep = fauxPorts();
		const consigne = (niveau: string) => fiche('Jamais de push forcé.', `type: consigne\nportee: globale\nniveau: ${niveau}\nregle: { type: commandes_interdites, motifs: ["git push --force*"] }`);
		await dep.coffre.ecrire('consignes/push.md', consigne('toujours'));
		await synchroniser(dep);
		expect(await dep.indicateur.lire()).toEqual({ genre: 'note', presentes: false, horodatageMs: dep.systeme.maintenant().getTime() });
		await dep.coffre.ecrire('consignes/push.md', consigne('verifiee'));
		await synchroniser(dep);
		expect(await dep.indicateur.lire()).toMatchObject({ genre: 'note', presentes: true });
		await dep.coffre.supprimer('consignes/push.md');
		await synchroniser(dep);
		expect(await dep.indicateur.lire()).toMatchObject({ genre: 'note', presentes: false });
	});

	it('voit l\'ajout, la modification et la suppression sans commande manuelle', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('projets/p/p.md', fiche(fait('La licorne mange des pommes')));
		expect((await chercher(dep, { texte: 'licorne' })).map((t) => t.chemin)).toEqual(['projets/p/p.md']);

		await dep.coffre.ecrire('projets/p/p.md', fiche(fait('Le dragon mange des poires')));
		expect(await chercher(dep, { texte: 'licorne' })).toEqual([]);
		expect((await chercher(dep, { texte: 'dragon' })).length).toBe(1);

		await dep.coffre.supprimer('projets/p/p.md');
		expect(await chercher(dep, { texte: 'dragon' })).toEqual([]);

		// renommage : ancien chemin disparu, nouveau trouvé
		await dep.coffre.ecrire('a/ancien.md', fiche(fait('Le phénix chante')));
		expect((await chercher(dep, { texte: 'phénix' })).map((t) => t.chemin)).toEqual(['a/ancien.md']);
		await dep.coffre.supprimer('a/ancien.md');
		await dep.coffre.ecrire('a/nouveau.md', fiche(fait('Le phénix chante')));
		expect((await chercher(dep, { texte: 'phénix' })).map((t) => t.chemin)).toEqual(['a/nouveau.md']);
	});

	it('une 2e synchronisation sans changement ne lit aucun contenu', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('a.md', fiche(fait('Premier')));
		await dep.coffre.ecrire('b.md', fiche(fait('Second')));
		expect(await synchroniser(dep)).toEqual({ ajoutees: 2, modifiees: 0, retirees: 0, illisibles: [] });
		const lectures = espion(dep);
		expect(await synchroniser(dep)).toEqual({ ajoutees: 0, modifiees: 0, retirees: 0, illisibles: [] });
		expect(lectures).toEqual([]);
	});

	it('compte modifiées et retirées ; un horodatage seul n\'est pas une modification', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('a.md', fiche(fait('Premier')));
		await dep.coffre.ecrire('b.md', fiche(fait('Second')));
		await synchroniser(dep);
		await dep.coffre.ecrire('a.md', fiche(fait('Premier'))); // même contenu, mtime changé
		expect(await synchroniser(dep)).toEqual({ ajoutees: 0, modifiees: 0, retirees: 0, illisibles: [] });
		await dep.coffre.ecrire('a.md', fiche(fait('Premier bis')));
		await dep.coffre.supprimer('b.md');
		expect(await synchroniser(dep)).toEqual({ ajoutees: 0, modifiees: 1, retirees: 1, illisibles: [] });
	});

	it('une fiche qui disparaît entre etats et lire est retirée sans erreur', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('a.md', fiche(fait('Premier')));
		await synchroniser(dep);
		await dep.coffre.ecrire('a.md', fiche(fait('Premier bis')));
		const etats = dep.coffre.etats;
		dep.coffre.etats = async () => {
			const r = await etats();
			dep.fichiers.delete('a.md');
			return r;
		};
		expect(await synchroniser(dep)).toEqual({ ajoutees: 0, modifiees: 0, retirees: 1, illisibles: [] });
		expect(await dep.index.fiches()).toEqual([]);
	});

	it('n\'indexe pas SCHEMA.md', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('SCHEMA.md', '---\nseuil_rappel: 0.4\n---\n# Schéma\n\nmystère\n');
		expect(await synchroniser(dep)).toEqual({ ajoutees: 0, modifiees: 0, retirees: 0, illisibles: [] });
	});

	it('résout le type d\'un fait qui cite une fiche de source', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('sources/cr.md', '---\nid: 01SRC\ntype: source\ntype_source: compte_rendu\nupdated: 2026-11-01\n---\n# cr\n');
		await dep.coffre.ecrire('a.md', fiche('## Faits\n- Le budget est validé | declare | src: [[sources/cr]] | appris 2026-11-20 | confiance 90 % ^f-0001\n- Fait orphelin | declare | src: [[sources/absente]] | appris 2026-11-20 | confiance 90 % ^f-0002\n'));
		await synchroniser(dep);
		expect((await dep.index.element('a.md#^f-0001'))!.typeSource).toBe('compte_rendu');
		expect((await dep.index.element('a.md#^f-0002'))!.typeSource).toBe('inconnue');
	});

	it('une source en texte libre non personnel est un document (« inconnue »)', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('a.md', fiche('## Faits\n- Budget validé | declare | src: email de Marc | appris 2026-11-20 | confiance 90 % ^f-0001\n'));
		await synchroniser(dep);
		expect((await dep.index.element('a.md#^f-0001'))!.typeSource).toBe('inconnue');
	});

	it('une fiche illisible (EBUSY) est ignorée : ancienne entrée gardée, réessayée ensuite', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('a.md', fiche(fait('Licorne')));
		await dep.coffre.ecrire('b.md', fiche(fait('Dragon')));
		await synchroniser(dep);
		await dep.coffre.ecrire('a.md', fiche(fait('Griffon')));
		const lire = dep.coffre.lire;
		let bloque = true;
		dep.coffre.lire = async (chemin) => {
			if (bloque && chemin === 'a.md') throw Object.assign(new Error('busy'), { code: 'EBUSY' });
			return lire(chemin);
		};
		expect((await chercher(dep, { texte: 'dragon' })).map((t) => t.chemin)).toEqual(['b.md']);
		expect((await chercher(dep, { texte: 'licorne' })).length).toBe(1);
		bloque = false;
		expect((await chercher(dep, { texte: 'griffon' })).length).toBe(1);
		expect(await chercher(dep, { texte: 'licorne' })).toEqual([]);
	});

	it('rend les fiches illisibles (sautées) ; elles sont reprises dès qu\'elles se lisent', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('a.md', fiche(fait('Licorne')));
		await dep.coffre.ecrire('b.md', fiche(fait('Dragon')));
		const lire = dep.coffre.lire;
		let bloque = true;
		dep.coffre.lire = async (chemin) => {
			if (bloque && chemin === 'a.md') throw Object.assign(new Error('refusé'), { code: 'EACCES' });
			return lire(chemin);
		};
		expect(await synchroniser(dep)).toEqual({ ajoutees: 1, modifiees: 0, retirees: 0, illisibles: ['a.md'], motifs: { 'a.md': 'lecture impossible : refusé' } });
		bloque = false;
		expect(await synchroniser(dep)).toEqual({ ajoutees: 1, modifiees: 0, retirees: 0, illisibles: [] });
	});

	it('une panne de l\'index n\'est pas avalée : elle remonte', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('a.md', fiche(fait('Licorne')));
		dep.index.remplacer = async () => {
			throw new Error('disque plein');
		};
		await expect(synchroniser(dep)).rejects.toThrow('disque plein');
	});

	it('le type de source d\'un fait suit la fiche de source quand elle change', async () => {
		const dep = fauxPorts();
		const source = (type: string) => `---\nid: 01SRC\ntype: source\ntype_source: ${type}\nupdated: 2026-11-01\n---\n# cr\n`;
		await dep.coffre.ecrire('sources/cr.md', source('utilisateur'));
		await dep.coffre.ecrire('a.md', fiche('## Faits\n- Budget validé | declare | src: [[sources/cr]] | appris 2026-11-20 | confiance 90 % ^f-0001\n'));
		await synchroniser(dep);
		expect((await dep.index.element('a.md#^f-0001'))!.typeSource).toBe('utilisateur');
		await dep.coffre.ecrire('sources/cr.md', source('email'));
		await chercher(dep, { texte: 'budget' });
		expect((await dep.index.element('a.md#^f-0001'))!.typeSource).toBe('email');
		await dep.coffre.supprimer('sources/cr.md');
		await synchroniser(dep);
		expect((await dep.index.element('a.md#^f-0001'))!.typeSource).toBe('inconnue');
	});
});

describe('synchroniser : fiches hors de leur forme', () => {
	it('trouvées par leur texte ; l\'index garde leurs anomalies, relues sans réindexer', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('notes/r.md', '---\ntype: Réunion\n---\n# Réunion\n\nLe tarif journalier est revu.\n');
		await dep.coffre.ecrire('notes/t.md', '# T\n\n## Informations\n- Ristourne annuelle | 5 %\n');
		expect((await chercher(dep, { texte: 'tarif journalier' })).map((t) => t.chemin)).toEqual(['notes/r.md']);
		expect((await chercher(dep, { texte: 'ristourne' })).map((t) => t.chemin)).toEqual(['notes/t.md']);
		const anomalies = Object.fromEntries((await dep.index.fiches()).map((f) => [f.chemin, f.anomalies]));
		expect(anomalies['notes/r.md']).toEqual([expect.stringContaining('« Réunion »')]);
		expect(anomalies['notes/t.md']).toEqual([expect.stringContaining('« Informations »')]);
	});
});
