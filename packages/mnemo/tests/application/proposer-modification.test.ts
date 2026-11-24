import { describe, expect, it } from 'vitest';
import { proposer as proposerBrut } from '../../src/application/proposer.ts';
import type { Demande } from '../../src/application/proposer.ts';
import { presenterResultat } from '../../src/application/presenter.ts';
import { filDuJour } from '../../src/application/fil.ts';
import { positionDuProjet } from '../../src/application/position.ts';
import { synchroniser } from '../../src/application/synchroniser.ts';
import { validerDemande } from '../../src/application/validation.ts';
import { vectoriser } from '../../src/application/vectoriser.ts';
import { lireConsigne } from '../../src/domaine/consigne.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { fauxPorts } from '../aides/faux-ports.ts';
import { fauxSens } from '../aides/faux-sens.ts';

const CHEMIN = 'stacks/stacks.md';
const FICHE = `---
id: 01STACK
type: sujet
alias: [piles]
updated: 2026-11-01
---
# Stacks

Ancienne synthèse des stacks.

## Informations
- [outil] On utilise pnpm partout. | declare | src: utilisateur oral | appris 2026-11-20 | confiance 100 % ^f-0001

## Conventions
Les branches suivent le motif feature/ticket.

## Notes
Texte à retirer.
`;
const AUTRE = `---\nid: 01AUTRE\ntype: sujet\nupdated: 2026-11-01\n---\n# Autre\n\nLe tapir dort au zoo.\n`;
const CONSIGNE = 'consignes/env.md';
const TEXTE_CONSIGNE = `---\nid: C1\ntype: consigne\nupdated: 2026-11-01\nportee: globale\nniveau: toujours\nrepetitions: []\n---\n# Env\n\nNe touche jamais aux .env.\n`;

const utilisateur = { ref: 'dit en séance', type: 'utilisateur' as const };
const session = { ref: 'session 11111111', type: 'session' as const };
const SANS_LIMITE = { budgetMs: 60_000, demarrer: true };

async function memoire() {
	const dep = fauxPorts();
	await dep.coffre.ecrire(CHEMIN, FICHE);
	await dep.coffre.ecrire('autre/autre.md', AUTRE);
	await dep.coffre.ecrire(CONSIGNE, TEXTE_CONSIGNE);
	await synchroniser(dep);
	return dep;
}
type Dep = Awaited<ReturnType<typeof memoire>>;
const lue = (dep: Dep, chemin = CHEMIN) => lireFiche(chemin, dep.fichiers.get(chemin)!);
/** Canal de l'utilisateur (CLI, service HTTP) ; `agent` : le serveur MCP, où seul un agent appelle. */
const parUtilisateur = (dep: Dep, d: Record<string, unknown>) => proposerBrut(dep, { genre: 'modification', fiche: CHEMIN, source: utilisateur, ...d } as Demande, { appliquerDirectement: true });
const parAgent = (dep: Dep, d: Record<string, unknown>) => proposerBrut(dep, { genre: 'modification', fiche: CHEMIN, source: session, ...d } as Demande, { appliquerDirectement: false });

describe('proposer : genre modification', () => {
	it('synthèse d\'une fiche existante : réécrite, informations intactes, un commit, passages de synthèse réindexés pour cette fiche seulement', async () => {
		const dep = await memoire();
		const sens = fauxSens();
		dep.sens = sens;
		await vectoriser(dep, SANS_LIMITE);
		const avant = dep.commits.length;
		const r = await parAgent(dep, { synthese: 'Les stacks techniques de l\'atelier : pangolin et outils.' });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: CHEMIN, aConfirmer: false, changements: [expect.stringMatching(/^synthèse : « Ancienne synthèse.* » → « Les stacks techniques/u)] });
		expect(dep.commits.length).toBe(avant + 1);
		expect(dep.commits.at(-1)!.message).toBe(`mnemo: fiche ${CHEMIN} (synthese)`);
		const fiche = lue(dep);
		expect(fiche.synthese).toBe('Les stacks techniques de l\'atelier : pangolin et outils.');
		expect(fiche.id).toBe('01STACK');
		expect(fiche.faits).toHaveLength(1);
		expect(dep.fichiers.get(CHEMIN)).toContain('- [outil] On utilise pnpm partout. | declare | src: utilisateur oral | appris 2026-11-20 | confiance 100 % ^f-0001');
		expect(fiche.autresSections.map((s) => s.titre)).toEqual(['Conventions', 'Notes']);
		expect(fiche.updated).toBe('2026-11-22');
		// index : le passage de synthèse porte le nouveau texte
		const [passage] = await dep.index.elementsParId([`${CHEMIN}#synthese`]);
		expect(passage?.texte).toContain('pangolin');
		// vecteurs : seuls des textes de cette fiche sont recalculés (ses sections aussi : la synthèse est leur ligne de contexte)
		sens.appels.length = 0;
		await vectoriser(dep, SANS_LIMITE);
		const refaits = sens.appels.flatMap((a) => a.textes);
		expect(refaits.some((t) => t.includes('pangolin'))).toBe(true);
		expect(refaits.some((t) => t.includes('feature/ticket') && t.includes('pangolin'))).toBe(true);
		expect(refaits.some((t) => t.includes('tapir') || t.includes('.env'))).toBe(false);
		expect(presenterResultat(r)).toContain('synthèse');
	});

	it('section libre : remplacer, créer, retirer (texte vide), en une écriture', async () => {
		const dep = await memoire();
		const r = await parAgent(dep, { sections: { Conventions: 'Les branches suivent le motif tache/ticket.', 'Outils internes': 'Le zèbre déploie le vendredi.', Notes: '' } });
		expect(r).toMatchObject({ statut: 'ecrit', changements: ['section « Conventions » : remplacée', 'section « Outils internes » : créée', 'section « Notes » : retirée'] });
		expect(dep.commits.at(-1)!.message).toBe(`mnemo: fiche ${CHEMIN} (section Conventions, section Outils internes, section Notes)`);
		const fiche = lue(dep);
		expect(fiche.autresSections).toEqual([
			{ titre: 'Conventions', corps: 'Les branches suivent le motif tache/ticket.' },
			{ titre: 'Outils internes', corps: 'Le zèbre déploie le vendredi.' },
		]);
		expect(fiche.faits).toHaveLength(1);
		expect(fiche.synthese).toBe('Ancienne synthèse des stacks.');
		// rien à changer : rien n'est écrit
		const n = dep.commits.length;
		expect(await parAgent(dep, { sections: { Notes: '' } })).toMatchObject({ statut: 'doublon', fiche: CHEMIN });
		expect(dep.commits.length).toBe(n);
	});

	it('type : libre → changé ; mal formé → refus ; consigne et profil jamais par ce chemin', async () => {
		const dep = await memoire();
		expect(await parAgent(dep, { type: 'personne' })).toMatchObject({ statut: 'ecrit', changements: ['type : sujet → personne'] });
		expect(await parAgent(dep, { type: 'dossier' })).toMatchObject({ statut: 'ecrit', changements: ['type : personne → dossier'] });
		expect(lue(dep).type).toBe('dossier');
		expect(await parAgent(dep, { type: 'Pas Bien' })).toMatchObject({ statut: 'refuse', motif: expect.stringContaining('Type de fiche mal formé : « Pas Bien »') });
		expect(await parUtilisateur(dep, { type: 'consigne' })).toMatchObject({ statut: 'refuse', motif: expect.stringContaining('consigne') });
		expect(await parUtilisateur(dep, { fiche: CONSIGNE, type: 'sujet' })).toMatchObject({ statut: 'refuse', motif: expect.stringContaining('consigne') });
		expect(lue(dep).type).toBe('dossier');
	});

	it('titre et alias ; la section des informations (et des relations) refusée', async () => {
		const dep = await memoire();
		expect(await parAgent(dep, { titre: 'Stacks techniques', alias: ['piles', 'technos'] })).toMatchObject({
			statut: 'ecrit',
			changements: ['titre : « Stacks » → « Stacks techniques »', 'alias : piles → piles, technos'],
		});
		expect(lue(dep)).toMatchObject({ titre: 'Stacks techniques', alias: ['piles', 'technos'] });
		const n = dep.commits.length;
		for (const titre of ['Informations', 'informations', 'Faits', 'Relations']) {
			expect(await parAgent(dep, { sections: { [titre]: '- rien' } }), titre).toMatchObject({ statut: 'refuse' });
		}
		expect(await parAgent(dep, {})).toMatchObject({ statut: 'refuse', motif: expect.stringContaining('Rien à modifier') });
		expect(await parAgent(dep, { synthese: 'Texte\n\n## Informations\n- [x] faux' })).toMatchObject({ statut: 'refuse' });
		expect(dep.commits.length).toBe(n);
		expect(lue(dep).faits).toHaveLength(1);
	});

	it('secrets masqués ; fiche absente refusée ; forme validée (sections : un texte par titre)', async () => {
		const dep = await memoire();
		await parAgent(dep, { synthese: 'Accès : token = ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
		expect(dep.fichiers.get(CHEMIN)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
		expect(dep.fichiers.get(CHEMIN)).toContain('[secret masqué]');
		expect(await parAgent(dep, { fiche: 'absente/absente.md', synthese: 'x' })).toMatchObject({ statut: 'refuse', motif: expect.stringContaining('n\'existe pas') });
		expect(validerDemande({ genre: 'modification', fiche: CHEMIN, sections: { A: 'texte' }, source: session }).ok).toBe(true);
		expect(await parAgent(dep, { sections: { A: 3 } })).toMatchObject({ statut: 'refuse', motif: expect.stringContaining('A') });
	});

	it('session sur une consigne : proposition « à confirmer » ; confirmer l\'applique, rejeter ne change rien', async () => {
		const dep = await memoire();
		const proposition = await parAgent(dep, { fiche: CONSIGNE, synthese: 'Ne touche jamais aux .env ni aux clés.' });
		expect(proposition).toMatchObject({ statut: 'ecrit', fiche: CONSIGNE, aConfirmer: true });
		expect(dep.commits.at(-1)!.message).toBe(`mnemo: propose fiche ${CONSIGNE} (synthese)`);
		expect(lireConsigne(lue(dep, CONSIGNE)).texte).toBe('Ne touche jamais aux .env.');
		// le fil la montre, avec ce qui changerait
		const fil = await filDuJour(dep);
		expect(fil.modifications).toEqual([
			{ fiche: CONSIGNE, titre: 'Env', cibles: ['synthese'], changements: [expect.stringContaining('Ne touche jamais aux .env ni aux clés.')], date: '2026-11-22', source: 'session 11111111' },
		]);
		// un agent ne confirme pas
		expect(await parAgent(dep, { fiche: CONSIGNE, appliquerProposition: true })).toMatchObject({ statut: 'refuse' });
		expect(await parUtilisateur(dep, { fiche: CONSIGNE, appliquerProposition: true })).toMatchObject({ statut: 'ecrit', aConfirmer: false });
		expect(dep.commits.at(-1)!.message).toBe(`mnemo: fiche ${CONSIGNE} (synthese)`);
		const appliquee = lue(dep, CONSIGNE);
		expect(lireConsigne(appliquee)).toMatchObject({ texte: 'Ne touche jamais aux .env ni aux clés.', niveau: 'toujours' });
		expect(appliquee.donnees['modification_proposee']).toBeUndefined();
		expect((await filDuJour(dep)).modifications).toEqual([]);

		// rejeter : la fiche reste telle quelle, la proposition disparaît
		await parAgent(dep, { fiche: CONSIGNE, titre: 'Fichiers sensibles' });
		const avant = lue(dep, CONSIGNE);
		expect(await parUtilisateur(dep, { fiche: CONSIGNE, retirerProposition: true })).toMatchObject({ statut: 'ecrit', aConfirmer: false });
		expect(dep.commits.at(-1)!.message).toBe(`mnemo: rejette fiche ${CONSIGNE}`);
		const apres = lue(dep, CONSIGNE);
		expect(apres.titre).toBe('Env');
		expect(apres.titre).toBe(avant.titre);
		expect(lireConsigne(apres)).toEqual(lireConsigne(avant));
		expect(apres.donnees['modification_proposee']).toBeUndefined();
		expect(await parUtilisateur(dep, { fiche: CONSIGNE, retirerProposition: true })).toMatchObject({ statut: 'refuse' });
	});

	it('utilisateur sur une consigne : appliqué directement ; un document ne modifie jamais une consigne', async () => {
		const dep = await memoire();
		expect(await parUtilisateur(dep, { fiche: CONSIGNE, synthese: 'Jamais de .env.' })).toMatchObject({ statut: 'ecrit', aConfirmer: false });
		expect(lireConsigne(lue(dep, CONSIGNE)).texte).toBe('Jamais de .env.');
		const contrat = { ref: '[[sources/contrat]]', type: 'contrat' as const };
		expect(await proposerBrut(dep, { genre: 'modification', fiche: CONSIGNE, synthese: 'Autre.', source: contrat } as Demande)).toMatchObject({ statut: 'refuse' });
	});

	it('la clé de proposition ne s\'écrit pas par le genre fiche', async () => {
		const dep = await memoire();
		expect(await proposerBrut(dep, { genre: 'fiche', chemin: 'x/y.md', type: 'sujet', titre: 'Y', donnees: { modification_proposee: { titre: 'Z' } } })).toMatchObject({ statut: 'refuse' });
	});

	it('dossier_projet : un changement de type libre garde le lieu ; la position suit', async () => {
		const dep = await memoire();
		const lieu = (type: string) => `---\nid: 01COD\ntype: ${type}\ndossier_projet: h1\nupdated: 2026-11-01\n---\n# Code\n\nUn lieu.\n`;
		await dep.coffre.ecrire('g1/d1/d1.md', lieu('dossier'));
		await synchroniser(dep);
		expect((await positionDuProjet(dep, 'h1')).chemin).toBe('g1/d1');
		expect(await parAgent(dep, { fiche: 'g1/d1/d1.md', type: 'personne' })).toMatchObject({ statut: 'ecrit' });
		expect((await positionDuProjet(dep, 'h1')).chemin).toBe('g1/d1');
	});

	it('source et episode : une session n\'y fait ni entrer ni sortir une fiche ; l\'utilisateur, si', async () => {
		const dep = await memoire();
		await dep.coffre.ecrire('sources/doc.md', `---\nid: 01SRC\ntype: source\ntype_source: note\nupdated: 2026-11-01\n---\n# Doc\n`);
		for (const [fiche, type] of [[CHEMIN, 'source'], [CHEMIN, 'episode'], ['sources/doc.md', 'sujet']] as const) {
			expect(await parAgent(dep, { fiche, type }), `${fiche} → ${type}`).toMatchObject({ statut: 'refuse', motif: expect.stringContaining('utilisateur') });
		}
		expect(await parUtilisateur(dep, { type: 'episode' })).toMatchObject({ statut: 'ecrit' });
	});

	it('une proposition sur une consigne est validée comme appliquée : texte vide refusé, rien au fil', async () => {
		const dep = await memoire();
		expect(await parAgent(dep, { fiche: CONSIGNE, synthese: '' })).toMatchObject({ statut: 'refuse', motif: expect.stringContaining('vide') });
		expect((await filDuJour(dep)).modifications).toEqual([]);
	});
});

