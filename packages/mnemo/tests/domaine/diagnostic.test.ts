import { describe, expect, it } from 'vitest';
import { resolveurDeLiens } from '../../src/application/liens.ts';
import { diagnostiquer, RUBRIQUES, SEUIL_FICHE_CHARGEE, textesProches } from '../../src/domaine/diagnostic.ts';
import type { EntreeDiagnostic, Rubrique } from '../../src/domaine/diagnostic.ts';
import { normaliserCible } from '../../src/domaine/elements.ts';
import { analyserFiche } from '../../src/domaine/fiche.ts';
import { empreinte } from '../../src/domaine/empreinte.ts';
import { empreinteDInformation } from '../../src/domaine/lot.ts';
import type { Lot } from '../../src/domaine/lot.ts';
import { rapportDeDiagnostic } from '../../src/domaine/rapport-diagnostic.ts';

const fiche = (type: string, titre: string, corps = '', extra = '') => `---\nid: 01X\ntype: ${type}\n${extra}updated: 2026-11-01\n---\n# ${titre}\n${corps}`;
const avecInformations = (synthese: string, lignes: string[]) => `\n${synthese}\n\n## Informations\n${lignes.join('\n')}\n`;

function entree(fichiers: Record<string, string>, autres: Partial<EntreeDiagnostic> = {}): EntreeDiagnostic {
	const fiches = Object.entries(fichiers).map(([chemin, texte]) => ({ chemin, texte, fiche: analyserFiche(chemin, texte).fiche }));
	const resoudre = resolveurDeLiens(fiches.map((f) => ({ chemin: f.chemin, titre: f.fiche.titre, alias: f.fiche.alias })));
	const dossiers = [...new Set(Object.keys(fichiers).flatMap((c) => c.split('/').slice(0, -1).map((_s, i, t) => t.slice(0, i + 1).join('/'))))];
	return {
		fiches,
		dossiers,
		designee: (cible) => {
			const vers = normaliserCible(cible);
			return vers === null ? null : resoudre(vers);
		},
		empreintesSources: new Map(),
		seuilRappel: 0.4,
		categoriesAEnjeu: ['montant', 'echeance', 'perimetre'],
		...autres,
	};
}

const rubrique = (e: EntreeDiagnostic, r: Rubrique): string[] => diagnostiquer(e, [r]).rubriques[0]!.entrees;

describe('diagnostic de la mémoire', () => {
	it('liens cassés : cible absente, ancre absente de la fiche visée, renvoi interne introuvable ; un lien par titre ou alias résolu', () => {
		const e = entree({
			'clients/clients.md': fiche('dossier', 'Clients', '\nLes clients.\n'),
			'clients/acme.md': fiche('organisation', 'Acme', avecInformations('Client [[Zeta]] et [[Bêta SA]], voir [[clients/beta#^f-0001]] et [[clients/beta#^f-0009|ici]].', [
				'- Le siège est à Lyon | declare | src: utilisateur ^f-0001',
				'- ~~Le siège est à Paris~~ | declare | src: utilisateur | invalidé 2026-11-02 par ^f-0007 ^f-0002',
			])),
			'clients/beta.md': fiche('organisation', 'Bêta', avecInformations('Cliente.', ['- Une information | declare | src: utilisateur ^f-0001']), 'alias: [Bêta SA]\n'),
		});
		expect(rubrique(e, 'liens_casses')).toEqual([
			'clients/acme.md → [[Zeta]]',
			'clients/acme.md → [[clients/beta#^f-0009]] : ancre absente de clients/beta.md',
			'clients/acme.md#^f-0002 : renvoi ^f-0007 absent de la fiche',
		]);
	});

	it('liens vers un fichier qui n’est pas une fiche (image, pdf, pièce jointe) : ni cassés, ni liens du graphe', () => {
		const e = entree({
			'clients/acme.md': fiche('organisation', 'Acme', '\nPlan : ![[plan.png]], contrat [[docs/contrat.pdf|le contrat]], photo [[Photo.JPG]], tableau [[budget.xlsx]] ; et [[Dr. Who]].\n'),
		});
		expect(rubrique(e, 'liens_casses')).toEqual(['clients/acme.md → [[Dr. Who]]']);
		expect(rubrique(e, 'fiches_isolees')).toEqual(['clients/acme.md']);
	});

	it('fiches isolées : ni lien entrant ni sortant ; ni source, ni épisode, ni fiche de dossier, ni consigne, ni SCHEMA.md', () => {
		const e = entree({
			'SCHEMA.md': fiche('sujet', 'Schéma'),
			'projets/projets.md': fiche('dossier', 'Projets', '\nTous les projets.\n'),
			'projets/a.md': fiche('projet', 'A', '\nLié à [[b]].\n'),
			'projets/b.md': fiche('projet', 'B', '\nCité par A.\n'),
			'projets/seule.md': fiche('projet', 'Seule', '\nPersonne ne me cite.\n'),
			'consignes/regle.md': fiche('consigne', 'Règle', '\nToujours vouvoyer.\n', 'portee: globale\nniveau: toujours\n'),
			'sources/doc.md': fiche('source', 'Doc', '\nUn document.\n'),
			'episodes/alpha/2026-11-01-point.md': fiche('episode', 'Point', '\nUne session.\n'),
		});
		expect(rubrique(e, 'fiches_isolees')).toEqual(['projets/seule.md']);
	});

	it('fiches sans synthèse (hors fiches de dossier et sources) ; dossiers sans fiche ou à synthèse vide, hors profils/, skills/ et dossiers de sources ou d’épisodes seulement', () => {
		const e = entree({
			'projets/projets.md': fiche('dossier', 'Projets', '\n'),
			'projets/vide.md': fiche('projet', 'Vide', '\n## Informations\n- Une information | declare | src: utilisateur ^f-0001\n'),
			'projets/alpha/notes.md': fiche('sujet', 'Notes', '\nDes notes.\n'),
			'sources/doc.md': fiche('source', 'Doc'),
			'sources/pieces/piece.md': fiche('source', 'Pièce'),
			'episodes/alpha/2026-11-01-point.md': fiche('episode', 'Point', '\nUne session.\n'),
			'docs/contrat.md': fiche('source', 'Contrat'),
			'docs/note.md': fiche('sujet', 'Note', '\nUne note.\n'),
			'profils/travail/travail.md': fiche('profil', 'Travail'),
			'skills/menage/SKILL.md': '# Ménage\n',
		});
		expect(rubrique(e, 'sans_synthese')).toEqual(['projets/vide.md']);
		// docs/ mêle une source et une note : il se décrit ; sources/, sources/pieces/, episodes/, episodes/alpha/ non
		expect(rubrique(e, 'dossiers')).toEqual(['docs/ : sans fiche (docs/docs.md)', 'projets/projets.md : synthèse vide', 'projets/alpha/ : sans fiche (projets/alpha/alpha.md)']);
	});

	it('informations de confiance faible (sous le seuil de rappel), à confirmer, barrées (consignes exclues)', () => {
		const e = entree({
			'clients/acme.md': fiche('organisation', 'Acme', avecInformations('Client.', [
				'- Bas | declare | src: [[sources/a]] | confiance 30 % ^f-0001',
				'- Haut | declare | src: utilisateur | confiance 100 % ^f-0002',
				'- Douteux | declare | src: utilisateur | a confirmer ^f-0003',
				'- ~~Ancien~~ | declare | src: utilisateur | confiance 10 % | invalidé 2026-11-02 ^f-0004',
				'- Sans ancre | declare | src: utilisateur | confiance 20 %',
			])),
			'consignes/regle.md': fiche('consigne', 'Règle', avecInformations('Règle.', ['- Bas aussi | declare | src: utilisateur | confiance 10 % ^f-0001'])),
		});
		expect(rubrique(e, 'sous_seuil')).toEqual(['clients/acme.md#^f-0001 (confiance 30 %)', 'clients/acme.md « Sans ancre » (confiance 20 %)']);
		expect(rubrique(e, 'a_confirmer')).toEqual(['clients/acme.md#^f-0003 « Douteux »']);
		expect(rubrique(e, 'barrees')).toEqual(['clients/acme.md#^f-0004 « Ancien »']);
		// le seuil vient de SCHEMA.md
		expect(rubrique({ ...e, seuilRappel: 0.2 }, 'sous_seuil')).toEqual([]);
	});

	it('doublons probables : même fiche seulement, textes proches aux mêmes nombres ; ni barrée, ni contradiction notée', () => {
		expect(textesProches('Le client est Acme.', 'le client est ACME')).toBe(true);
		expect(textesProches('Le siège social est à Lyon', 'Le siège social est situé à Lyon')).toBe(true);
		expect(textesProches('Budget de 1200 €', 'Budget de 1500 €')).toBe(false);
		expect(textesProches('Le client est Acme', 'Le fournisseur livre le lundi')).toBe(false);
		expect(textesProches('Contact : [[personnes/marie|Marie]]', 'Contact : Marie')).toBe(true);
		// longueurs trop différentes : pas comparées
		expect(textesProches('Le client est Acme', 'Le client est Acme, rencontré au salon avec toute l’équipe de direction')).toBe(false);
		const e = entree({
			'clients/acme.md': fiche('organisation', 'Acme', avecInformations('Client.', [
				'- Le siège social est à Lyon | declare | src: utilisateur ^f-0001',
				'- Le siège social est situé à Lyon | observe | src: utilisateur ^f-0002',
				'- ~~Le siège social est à Lyon~~ | declare | src: utilisateur | invalidé 2026-11-02 ^f-0003',
				'- Livraison le lundi | declare | src: utilisateur ^f-0004',
				'- Livraison le mardi | declare | src: utilisateur | a confirmer | contredit ^f-0004 ^f-0005',
			])),
			'clients/beta.md': fiche('organisation', 'Beta', avecInformations('Client.', ['- Le siège social est à Lyon | declare | src: utilisateur ^f-0001'])),
		});
		const d = rubrique(e, 'doublons');
		expect(d).toHaveLength(1);
		expect(d[0]).toMatch(/^clients\/acme\.md : \^f-0001 ≈ \^f-0002 /u);
	});

	it(`fiches de plus de ${SEUIL_FICHE_CHARGEE} informations, barrées comptées`, () => {
		const lignes = (n: number, barrees = 0) => Array.from({ length: n }, (_x, i) => (i < barrees ? `- ~~Information ${i}~~ | declare | invalidé 2026-11-02 ^f-${String(i + 1).padStart(4, '0')}` : `- Information ${i} | declare ^f-${String(i + 1).padStart(4, '0')}`));
		const e = entree({
			'a.md': fiche('sujet', 'A', avecInformations('A.', lignes(SEUIL_FICHE_CHARGEE))),
			'b.md': fiche('sujet', 'B', avecInformations('B.', lignes(SEUIL_FICHE_CHARGEE + 1, 3))),
		});
		expect(rubrique(e, 'fiches_chargees')).toEqual([`b.md (${SEUIL_FICHE_CHARGEE + 1} informations, dont 3 barrées)`]);
	});

	it('sources en double (même empreinte, index d’abord) et jamais citées (un lien, une source d’information ou un frontmatter les cite)', () => {
		const e = entree(
			{
				'sources/a.md': fiche('source', 'A', '', 'chemin: docs/a.pdf\nempreinte: e1\n'),
				'sources/a-copie.md': fiche('source', 'A copie', '', 'chemin: docs/copie/a.pdf\nempreinte: e1\n'),
				'sources/b.md': fiche('source', 'B', '', 'chemin: docs/b.pdf\nempreinte: e2\n'),
				'sources/c.md': fiche('source', 'C', '', 'chemin: docs/c.pdf\nempreinte: e3\n'),
				'sources/mbox.md': fiche('source', 'Boîte', '', 'chemin: docs/m.mbox\nempreinte: e4\nfils: 2\n'),
				'sources/fil-1.md': fiche('source', 'Fil 1', '', 'chemin: docs/m.mbox\nempreinte: e4\nfil: 1\nsource_parente: "[[sources/mbox]]"\n'),
				'sources/fil-2.md': fiche('source', 'Fil 2', '', 'chemin: docs/m.mbox\nempreinte: e4\nfil: 2\nsource_parente: "[[sources/mbox]]"\na_traiter: true\n'),
				'clients/acme.md': fiche('organisation', 'Acme', avecInformations('Client.', [
					'- Le client est Acme | declare | src: [[sources/a]] ^f-0001',
					'  + src: [[sources/fil-1]] | corroboré 2026-11-20',
				])),
			},
			// l'empreinte de l'index l'emporte sur celle du frontmatter (le fichier a changé depuis)
			{ empreintesSources: new Map([['sources/c.md', 'e2']]) },
		);
		expect(rubrique(e, 'sources_en_double')).toEqual(['sources/a-copie.md, sources/a.md : même document', 'sources/b.md, sources/c.md : même document']);
		expect(rubrique(e, 'sources_non_citees')).toEqual(['sources/a-copie.md', 'sources/b.md', 'sources/c.md', 'sources/fil-2.md (à traiter)']);
	});

	it('catégories rares (≤ 2 emplois, hors catégories à fort enjeu et informations barrées) ; nom de fichier différent du titre (hors fiches de dossier)', () => {
		const e = entree({
			'clients/clients.md': fiche('dossier', 'Nos clients', '\nLes clients.\n'),
			'clients/acme-corp.md': fiche('organisation', 'Acme Corp', avecInformations('Client.', [
				'- [contact] Marie | declare ^f-0001',
				'- [contact] Paul | declare ^f-0002',
				'- [contact] Léa | declare ^f-0003',
				'- [contacts] Jean | declare ^f-0004',
				'- [montant] 1200 € | declare ^f-0005',
				'- ~~[adresse] Lyon~~ | declare | invalidé 2026-11-02 ^f-0006',
			])),
			'clients/beta.md': fiche('organisation', 'Société Bêta', '\nCliente.\n', 'alias: [Beta]\n'),
			'clients/gamma.md': fiche('organisation', 'Delta', '\nCliente.\n'),
			'episodes/2026-11-01-point.md': fiche('episode', 'Point du lundi', '\nRésumé.\n'),
		});
		expect(rubrique(e, 'categories_rares')).toEqual(['[contacts] (1) : clients/acme-corp.md#^f-0004']);
		expect(rubrique(e, 'nom_titre')).toEqual(['clients/gamma.md : « Delta »']);
	});

	it('rubriques filtrées dans l’ordre de RUBRIQUES ; comptes totaux', () => {
		const e = entree({ 'a.md': fiche('sujet', 'A', avecInformations('A.', ['- Une | declare ^f-0001', '- ~~Deux~~ | declare | invalidé 2026-11-02 ^f-0002'])) });
		const d = diagnostiquer(e, ['barrees', 'liens_casses']);
		expect(d).toMatchObject({ fiches: 1, informations: 2 });
		expect(d.rubriques.map((r) => r.rubrique)).toEqual(['liens_casses', 'barrees']);
		expect(diagnostiquer(e).rubriques.map((r) => r.rubrique)).toEqual([...RUBRIQUES]);
	});

	it('reste rapide sur une grande mémoire (400 fiches de 30 informations, liens croisés)', () => {
		const fichiers: Record<string, string> = {};
		for (let i = 0; i < 400; i++) {
			const lignes = Array.from({ length: 30 }, (_x, j) => `- Information numéro ${j} de la fiche ${i} sur le sujet ${j % 7} | declare | src: [[sources/s${i % 50}]] ^f-${String(j + 1).padStart(4, '0')}`);
			fichiers[`d${i % 20}/f${i}.md`] = fiche('sujet', `F${i}`, avecInformations(`Voir [[d${(i + 1) % 20}/f${(i + 1) % 400}]].`, lignes));
		}
		for (let s = 0; s < 50; s++) fichiers[`sources/s${s}.md`] = fiche('source', `S${s}`, '', `chemin: docs/s${s}.pdf\nempreinte: e${s}\n`);
		const e = entree(fichiers);
		const debut = performance.now();
		const d = diagnostiquer(e);
		expect(performance.now() - debut).toBeLessThan(2000);
		expect(d.informations).toBe(12_000);
	});
});

describe('lots en attente', () => {
	it('par fiche puis par date ; périmé si une information visée a changé ou si la fiche n\'existe plus ; lot sans empreintes par information : si la fiche a changé', () => {
		const texte = fiche('sujet', 'A', avecInformations('A.', ['- Une | declare ^f-0001', '- Une aussi | declare ^f-0002']));
		const faits = analyserFiche('a.md', texte).fiche.faits;
		const lot = (id: string, fiche: string, proposeMs: number, empreinteLot = empreinte(texte), empreintes?: Record<string, string>): Lot => ({ id, genre: 'fusionner', fiche, lignes: [{ garder: 'f-0001', absorber: ['f-0002'] }], motif: 'Doublons', empreinte: empreinteLot, ...(empreintes === undefined ? {} : { empreintes }), proposeMs, session: null });
		const intactes = { 'f-0001': empreinteDInformation(faits, 'f-0001')!, 'f-0002': empreinteDInformation(faits, 'f-0002')! };
		const e = entree({ 'a.md': texte }, {
			lots: [lot('L2', 'a.md', 20, 'autre'), lot('L3', 'disparue.md', 5), lot('L1', 'a.md', 10), lot('L4', 'a.md', 40, 'autre', intactes), lot('L5', 'a.md', 50, empreinte(texte), { ...intactes, 'f-0002': 'changee' })],
		});
		expect(rubrique(e, 'lots_en_attente')).toEqual([
			'a.md : lot L1 (fusionner, 1 ligne(s)) « Doublons »',
			'a.md : lot L2 (fusionner, 1 ligne(s)) « Doublons » — périmé : une information visée a changé, à reproposer',
			'a.md : lot L4 (fusionner, 1 ligne(s)) « Doublons »',
			'a.md : lot L5 (fusionner, 1 ligne(s)) « Doublons » — périmé : une information visée a changé, à reproposer',
			'disparue.md : lot L3 (fusionner, 1 ligne(s)) « Doublons » — périmé : une information visée a changé, à reproposer',
		]);
		expect(rubrique(entree({ 'a.md': texte }), 'lots_en_attente')).toEqual([]);
	});
});

describe('rapport du diagnostic', () => {
	const d = {
		fiches: 3,
		informations: 5,
		rubriques: [
			{ rubrique: 'liens_casses' as const, entrees: ['a.md → [[x]]', 'b.md → [[y]]', 'c.md → [[z]]'] },
			{ rubrique: 'barrees' as const, entrees: [] },
		],
	};

	it('comptes en tête, puis chaque rubrique non vide bornée à la limite', () => {
		expect(rapportDeDiagnostic(d, 0.4, 2, 20_000)).toBe(
			[
				'Diagnostic de la mémoire : 3 fiches, 5 informations.',
				'- liens_casses : 3',
				'- barrees : 0',
				'',
				'## Liens cassés (3)',
				'- a.md → [[x]]',
				'- b.md → [[y]]',
				'… 1 de plus',
			].join('\n'),
		);
	});

	it('rien à signaler ; au-delà du budget, la limite baisse et le rapport le dit, les comptes restent entiers', () => {
		expect(rapportDeDiagnostic({ ...d, rubriques: [{ rubrique: 'barrees', entrees: [] }] }, 0.4, 20, 20_000)).toContain('Rien à signaler.');
		const grand = { ...d, rubriques: [{ rubrique: 'liens_casses' as const, entrees: Array.from({ length: 200 }, (_x, i) => `fiche-${i}.md → [[${'x'.repeat(80)}]]`) }] };
		const texte = rapportDeDiagnostic(grand, 0.4, 200, 5000);
		expect(texte.length).toBeLessThanOrEqual(5000);
		expect(texte).toContain('- liens_casses : 200');
		expect(texte).toMatch(/\(\d+ entrées au plus par rubrique/u);
	});
});
