import { describe, expect, it } from 'vitest';
import { liensDeLaFiche } from '../../src/application/liens-de-fiche.ts';
import { positionDuProjet } from '../../src/application/position.ts';
import { consignesVerifiees } from '../../src/application/servir.ts';
import { servirQuestion } from '../aides/servir.ts';
import { synchroniser } from '../../src/application/synchroniser.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const entete = (type = 'sujet', extra = '') => `---\nid: 01ABC\ntype: ${type}\n${extra}updated: 2026-11-01\n---\n`;
const consigne = (texte: string, portee: string, niveau: string, extra = '') => `${entete('consigne', `portee: ${portee}\nniveau: ${niveau}\n${extra}`)}# C\n\n${texte}\n`;
const verifiee = (texte: string, portee: string) => consigne(texte, portee, 'verifiee', 'regle:\n  type: chemins_interdits\n  motifs:\n    - "secrets/**"\n');

/** La mémoire de l'exemple de l'audit : la racine Mnemo est `~/Travail`, le projet `~/Travail/Projets/Lumen`. */
async function memoireLumen() {
	const dep = fauxPorts();
	const e = dep.coffre.ecrire;
	await e('projets/Lumen/Lumen.md', `${entete('dossier', 'dossier_projet: Projets/Lumen\nportee: projet:Lumen\n')}# Lumen\n\nLe projet Lumen.\n\n## Relations\n- client_de [[Acme]]\n`);
	await e('projets/Lumen/consignes/tests.md', consigne('Lance les tests de Lumen.', 'projet:Lumen', 'toujours'));
	await e('projets/Lumen/consignes/secrets.md', verifiee('N\'écris pas dans secrets/.', 'projet:Lumen'));
	await e('clients/Acme/Acme.md', `${entete('entite', 'alias: [ACME SA]\nportee: client:Acme\n')}# Société Acme\n\nLe client Acme.\n`);
	await e('clients/Acme/consignes/factures.md', consigne('Factures Acme en euros.', 'client:Acme', 'toujours'));
	await e('episodes/Lumen/2026-11-20-atelier.md', `${entete('episode', 'session: s-lumen\nprojet: Lumen\n')}# Atelier Lumen\n\nOn a choisi la pile.\n`);
	return dep;
}

describe('rattachement d\'un projet à la mémoire (Projets/Lumen, couvert par projets/Lumen/Lumen.md)', () => {
	it.each(['Projets/Lumen', 'Projets/Lumen/packages/ui'])('%s : consignes du projet servies et vérifiées', async (dossier) => {
		const dep = await memoireLumen();
		const position = await positionDuProjet(dep, dossier);
		expect(position.chemin).toBe('projets/Lumen');
		const { texte } = await servirQuestion(dep, position.chemin, null);
		expect(texte).toContain('Lance les tests de Lumen.');
		expect((await consignesVerifiees(dep, position)).map((c) => c.chemin)).toEqual(['projets/Lumen/consignes/secrets.md']);
	});

	it('client_de [[Acme]] par nom : consignes d\'Acme servies', async () => {
		const dep = await memoireLumen();
		const { texte } = await servirQuestion(dep, 'projets/Lumen', null);
		expect(texte).toContain('Factures Acme en euros.');
	});

	it.each([['titre', 'Société Acme'], ['alias', 'acme sa']])('client_de par %s : même résultat', async (_, ecrit) => {
		const dep = await memoireLumen();
		await dep.coffre.ecrire('projets/Lumen/Lumen.md', `${entete('dossier', 'dossier_projet: Projets/Lumen\nportee: projet:Lumen\n')}# Lumen\n\nLe projet Lumen.\n\n## Relations\n- client_de [[${ecrit}]]\n`);
		const { texte } = await servirQuestion(dep, 'projets/Lumen', null);
		expect(texte).toContain('Factures Acme en euros.');
	});

	it('la vue de la fiche d\'Acme montre Lumen en lien entrant', async () => {
		const dep = await memoireLumen();
		await synchroniser(dep);
		expect((await liensDeLaFiche(dep, 'clients/Acme/Acme.md')).entrants).toEqual([{ chemin: 'projets/Lumen/Lumen.md', titre: 'Lumen', verbe: 'client_de' }]);
	});

	it('portée déclarée par la fiche du dossier : une mémoire rangée hors de projets/ a ses consignes', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('travail/lumen/lumen.md', `${entete('dossier', 'dossier_projet: Code/lumen\nportee: projet:Lumen\n')}# Lumen\n`);
		await dep.coffre.ecrire('consignes/lumen.md', consigne('Lance les tests de Lumen.', 'projet:Lumen', 'toujours'));
		const position = await positionDuProjet(dep, 'Code/lumen');
		expect(position.chemin).toBe('travail/lumen');
		expect((await servirQuestion(dep, position.chemin, null)).texte).toContain('Lance les tests de Lumen.');
	});
});
