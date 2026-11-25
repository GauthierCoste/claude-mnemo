import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { MARGE_SORTIE_MS, traiterEvenement } from '../../src/application/evenements.ts';
import type { EtatSessions } from '../../src/application/ports.ts';
import { SANS_EXTRACTION, synchroniser } from '../../src/application/synchroniser.ts';
import { verifierAction } from '../../src/application/verifier-action.ts';
import { reponseDe, texteDuRefus } from '../../src/domaine/refus-outil.ts';
import type { ActionNonLue, ActionOutil } from '../../src/domaine/regles-verifiees.ts';
import { ouvrirEtat } from '../../src/infra/etat-sqlite.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { DEPOT_ABSENT, fauxPorts } from '../aides/faux-ports.ts';
import { OUTILS_CLAUDE_CODE } from '../../src/domaine/moteurs/claude-code/outils.ts';

const RACINE = '/r';
const ctx = { racine: RACINE, cwd: '/r/code/vela', sansCasse: false, outils: OUTILS_CLAUDE_CODE };
const consigne = (texte: string, portee: string, niveau: string, regle: string) =>
	`---\nid: C\ntype: consigne\nupdated: 2026-11-01\nportee: ${portee}\nniveau: ${niveau}\nrepetitions: []\nregle: ${regle}\n---\n# C\n\n${texte}\n`;

async function memoire() {
	const dep = fauxPorts();
	await dep.coffre.ecrire('projets/vela/vela.md', '---\nid: D\ntype: dossier\nportee: projet:vela\nupdated: 2026-11-01\n---\n# Projet Vela\n');
	await dep.coffre.ecrire('projets/autre/autre.md', '---\nid: A\ntype: dossier\nportee: projet:autre\nupdated: 2026-11-01\n---\n# Autre\n');
	await dep.coffre.ecrire('consignes/env.md', consigne('Ne touche jamais aux .env.', 'globale', 'verifiee', '{ type: chemins_interdits, motifs: ["**/.env"] }'));
	await dep.coffre.ecrire('projets/vela/consignes/push.md', consigne('Jamais de push forcé sur Vela.', 'projet:vela', 'verifiee', '{ type: commandes_interdites, motifs: ["git push --force*"] }'));
	await dep.coffre.ecrire('projets/autre/consignes/rm.md', consigne('Pas de rm dans Autre.', 'projet:autre', 'verifiee', '{ type: commandes_interdites, motifs: ["rm *"] }'));
	// toujours (pas verifiee) : sa règle n'est pas appliquée
	await dep.coffre.ecrire('consignes/ls.md', consigne('Évite ls.', 'globale', 'toujours', '{ type: commandes_interdites, motifs: ["ls*"] }'));
	await synchroniser(dep, SANS_EXTRACTION);
	return dep;
}

const bash = (command: string) => ({ nom: 'Bash', entree: { command } });
const ecrire = (file_path: string) => ({ nom: 'Write', entree: { file_path, content: '' } });

describe('verifierAction', () => {
	it('refus avec le texte de la consigne et le motif', async () => {
		const dep = await memoire();
		expect(await verifierAction(dep, { chemin: 'projets/vela' }, ecrire('/r/code/vela/.env'), ctx)).toEqual({ refus: true, consigne: 'Ne touche jamais aux .env.', motif: '**/.env' });
		expect(await verifierAction(dep, { chemin: 'projets/vela' }, bash('git push --force origin'), ctx)).toEqual({ refus: true, consigne: 'Jamais de push forcé sur Vela.', motif: 'git push --force*' });
	});

	it('consigne d\'une autre portée ignorée ; niveau toujours non vérifié', async () => {
		const dep = await memoire();
		expect(await verifierAction(dep, { chemin: 'projets/vela' }, bash('rm x'), ctx)).toEqual({ refus: false });
		expect(await verifierAction(dep, { chemin: 'projets/autre' }, bash('rm x'), ctx)).toMatchObject({ refus: true, consigne: 'Pas de rm dans Autre.' });
		expect(await verifierAction(dep, { chemin: 'projets/autre' }, bash('git push --force'), ctx)).toEqual({ refus: false });
		expect(await verifierAction(dep, { chemin: '' }, bash('ls'), ctx)).toEqual({ refus: false });
	});

	it('lit l\'index sans synchroniser ; la règle vient de la fiche', async () => {
		const dep = await memoire();
		await dep.coffre.ecrire('consignes/nouvelle.md', consigne('Nouvelle.', 'globale', 'verifiee', '{ type: commandes_interdites, motifs: ["make*"] }'));
		expect(await verifierAction(dep, { chemin: '' }, bash('make'), ctx)).toEqual({ refus: false });
		// fiche retouchée depuis la synchronisation : sa règle actuelle compte
		await dep.coffre.ecrire('consignes/env.md', consigne('Ne touche jamais aux secrets.', 'globale', 'verifiee', '{ type: chemins_interdits, motifs: ["**/secret*"] }'));
		expect(await verifierAction(dep, { chemin: '' }, ecrire('/r/.env'), ctx)).toEqual({ refus: false });
		expect(await verifierAction(dep, { chemin: '' }, ecrire('/r/secret.txt'), ctx)).toMatchObject({ refus: true, consigne: 'Ne touche jamais aux secrets.' });
	});

	it('index en panne : refus, erreur interne ; fiche illisible ou consigne vérifiée sans règle : refus, consigne illisible', async () => {
		const dep = await memoire();
		dep.index.elements = () => Promise.reject(new Error('database is locked'));
		expect(await verifierAction(dep, { chemin: 'projets/vela' }, ecrire('/r/src/a.ts'), ctx)).toEqual({ refus: true, cause: 'erreur_interne', detail: 'database is locked' });
		const dep2 = await memoire();
		await dep2.coffre.ecrire('consignes/env.md', '---\n: : :\n---\n');
		expect(await verifierAction(dep2, { chemin: '' }, ecrire('/r/src/a.ts'), ctx)).toEqual({ refus: true, cause: 'consigne_illisible', detail: 'consignes/env.md' });
		const dep3 = await memoire();
		await dep3.coffre.ecrire('consignes/env.md', consigne('Sans règle.', 'globale', 'verifiee', '{ type: inconnu, motifs: ["x"] }'));
		expect(await verifierAction(dep3, { chemin: '' }, ecrire('/r/src/a.ts'), ctx)).toEqual({ refus: true, cause: 'consigne_illisible', detail: 'consignes/env.md' });
	});

	it('index en panne : selon l\'indicateur — aucune consigne vérifiée notée : accord non vérifié ; illisible ou consignes notées : refus', async () => {
		const dep = await memoire();
		dep.index.elements = () => Promise.reject(new Error('database is locked'));
		await dep.indicateur.noter(false, 1);
		expect(await verifierAction(dep, { chemin: 'projets/vela' }, ecrire('/r/.env'), ctx)).toEqual({ refus: false, cause: 'erreur_interne', detail: 'database is locked' });
		dep.indicateur.etat = { genre: 'illisible' };
		expect(await verifierAction(dep, { chemin: 'projets/vela' }, ecrire('/r/.env'), ctx)).toMatchObject({ refus: true, cause: 'erreur_interne' });
		await dep.indicateur.noter(true, 1);
		expect(await verifierAction(dep, { chemin: 'projets/vela' }, ecrire('/r/.env'), ctx)).toMatchObject({ refus: true, cause: 'erreur_interne' });
	});

	it('fiche retirée depuis la synchronisation ou passée sous un autre niveau : sa règle ne compte plus', async () => {
		const dep = await memoire();
		await dep.coffre.supprimer('consignes/env.md');
		expect(await verifierAction(dep, { chemin: '' }, ecrire('/r/.env'), ctx)).toEqual({ refus: false });
		await dep.coffre.ecrire('projets/vela/consignes/push.md', consigne('Jamais de push forcé sur Vela.', 'projet:vela', 'toujours', '{ type: commandes_interdites, motifs: ["git push --force*"] }'));
		expect(await verifierAction(dep, { chemin: 'projets/vela' }, bash('git push --force'), ctx)).toEqual({ refus: false });
	});

	it('action non lue : refusée là où une consigne vérifiée s\'applique, permise ailleurs', async () => {
		const dep = await memoire();
		expect(await verifierAction(dep, { chemin: 'projets/vela' }, { nonLue: 'entree_trop_grosse' }, ctx)).toEqual({ refus: true, cause: 'entree_trop_grosse', detail: null });
		const sansGlobale = await memoire();
		await sansGlobale.coffre.supprimer('consignes/env.md');
		await synchroniser(sansGlobale, SANS_EXTRACTION);
		expect(await verifierAction(sansGlobale, { chemin: '' }, { nonLue: 'entree_illisible' }, ctx)).toEqual({ refus: false });
		expect(await verifierAction(sansGlobale, { chemin: 'projets/vela' }, { nonLue: 'entree_illisible' }, ctx)).toMatchObject({ refus: true, cause: 'entree_illisible' });
	});
});

describe('traiterEvenement : outil', () => {
	const ouverts: EtatSessions[] = [];
	afterEach(() => {
		while (ouverts.length > 0) ouverts.pop()?.fermer();
	});
	const ID = '11111111-2222-4333-8444-555555555555';

	it('refus rendu en texte ; session inconnue → position du cwd ; permis sinon', async () => {
		const dep = await memoire();
		await dep.coffre.ecrire('projets/vela/vela.md', '---\nid: D\ntype: dossier\nportee: projet:vela\nupdated: 2026-11-01\ndossier_projet: code/vela\n---\n# Projet Vela\n');
		await synchroniser(dep, SANS_EXTRACTION);
		const etat = ouvrirEtat(join(await dossierTemporaire(), 'etat.sqlite'));
		ouverts.push(etat);
		const entree = (outil: ActionOutil | ActionNonLue) => ({ evenement: 'outil' as const, session: ID, horodatageMs: 10, cwd: '/r/code/vela', outil });
		const reglages = { froid: 'si-budget' as const, racine: RACINE };
		expect(await traiterEvenement(dep, { etat, depot: DEPOT_ABSENT }, entree(bash('git push --force')), reglages)).toEqual({ refus: 'Mnemo : consigne vérifiée « Jamais de push forcé sur Vela. » (motif « git push --force* »).' });
		expect(await traiterEvenement(dep, { etat, depot: DEPOT_ABSENT }, entree(ecrire('.env')), reglages)).toEqual({ refus: 'Mnemo : consigne vérifiée « Ne touche jamais aux .env. » (motif « **/.env »).' });
		expect(await traiterEvenement(dep, { etat, depot: DEPOT_ABSENT }, entree(bash('git push')), reglages)).toEqual({});
		// index qui ne répond pas avant l'échéance : refus, la vérification n'a pas fini à temps (même pour une action conforme)
		const lent = await memoire();
		lent.index.elements = () => new Promise(() => {});
		const echeance = Date.now() + 50 + MARGE_SORTIE_MS;
		expect(await traiterEvenement(lent, { etat, depot: DEPOT_ABSENT }, entree(bash('git push')), { ...reglages, echeance })).toEqual({ refus: texteDuRefus({ refus: true, cause: 'delai_depasse', detail: null }) });
		expect(Date.now()).toBeGreaterThanOrEqual(echeance - MARGE_SORTIE_MS);
		// même lenteur, mémoire sans consigne vérifiée notée : accord, avec un avis pour le journal
		await lent.indicateur.noter(false, 1);
		expect(await traiterEvenement(lent, { etat, depot: DEPOT_ABSENT }, entree(bash('git push --force')), { ...reglages, echeance: Date.now() + 50 + MARGE_SORTIE_MS })).toEqual(reponseDe({ refus: false, cause: 'delai_depasse', detail: null }));
		// action non lue : refus avec sa cause
		expect(await traiterEvenement(dep, { etat, depot: DEPOT_ABSENT }, entree({ nonLue: 'entree_trop_grosse' }), reglages)).toEqual({ refus: texteDuRefus({ refus: true, cause: 'entree_trop_grosse', detail: null }) });
		// sans racine connue : permis
		expect(await traiterEvenement(dep, { etat, depot: DEPOT_ABSENT }, entree(bash('git push --force')), { froid: 'si-budget' })).toEqual({});
	});

	it('outil étranger (autre fil : agent imbriqué, /new de Codex ; autre moteur) : vérifié avec les consignes de la session, état inchangé', async () => {
		const dep = await memoire();
		const etat = ouvrirEtat(join(await dossierTemporaire(), 'etat.sqlite'));
		ouverts.push(etat);
		await etat.creer({
			id: ID, profil: 'travail', dossier: 'code/vela', position: 'projets/vela', projet: 'vela', objectif: null, etat: 'attend', creeeMs: 1, majMs: 1,
			arretAttendu: null, bilanDemandeMs: null, commitDebut: null, branche: null, pid: null, moteur: 'codex', fil: 'fil-a',
		});
		const avant = await etat.lire(ID);
		const reglages = { froid: 'si-budget' as const, racine: RACINE };
		// cwd hors de tout projet : seule la position de la session porte la consigne
		const entree = (command: string, extra: { moteur?: 'codex' | 'claude-code'; fil?: string }) => ({ evenement: 'outil' as const, session: ID, horodatageMs: 10, cwd: '/r/ailleurs', outil: bash(command), ...extra });
		const refus = { refus: 'Mnemo : consigne vérifiée « Jamais de push forcé sur Vela. » (motif « git push --force* »).' };
		expect(await traiterEvenement(dep, { etat, depot: DEPOT_ABSENT }, entree('git push --force', { moteur: 'codex', fil: 'fil-b' }), reglages)).toEqual(refus);
		expect(await traiterEvenement(dep, { etat, depot: DEPOT_ABSENT }, entree('git push --force', { moteur: 'claude-code' }), reglages)).toEqual(refus);
		expect(await traiterEvenement(dep, { etat, depot: DEPOT_ABSENT }, entree('git push', { moteur: 'codex', fil: 'fil-b' }), reglages)).toEqual({});
		expect(await etat.lire(ID)).toEqual(avant);
	});
});
