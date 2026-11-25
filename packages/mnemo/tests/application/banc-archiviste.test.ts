import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	CORPUS_ARCHIVISTE,
	lancerArchiviste,
	lireBancArchiviste,
	MISSIONS,
	mesurerArchiviste,
} from '../../src/adaptateurs/cli/banc.ts';
import type { Executer } from '../../src/application/ports.ts';
import { ErreurCli } from '../../src/adaptateurs/cli/erreurs.ts';
import { cle, couvre, faitsDeMemoire, lancerBancConsignes, noterContradictions, noterExtraction } from '../../src/application/banc-archiviste.ts';
import type { CasConsigne } from '../../src/application/banc-archiviste.ts';
import { extraireSource } from '../../src/application/extraire-source.ts';
import { proposer } from '../../src/application/proposer.ts';
import type { TypeSource } from '../../src/domaine/regles.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { ENV_TEST } from '../aides/env-test.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const MAIN = join(import.meta.dirname, '../../src/adaptateurs/cli/main.ts');
const QUESTIONS = join(import.meta.dirname, '../../banc/questions.yaml');
const FAUX_CLAUDE = join(import.meta.dirname, '../aides/faux-claude.mjs');
const banc = () => lireBancArchiviste(readFileSync(QUESTIONS, 'utf8'));

function mnemo(cwd: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
	return mnemoAvec({}, cwd, ...args);
}

function mnemoAvec(env: Record<string, string>, cwd: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
	return new Promise((resoudre) => {
		execFile(process.execPath, [MAIN, ...args], { cwd, env: { ...ENV_TEST, TMPDIR: cwd, ...env } }, (erreur, out, err) => {
			resoudre({ code: erreur ? (erreur.code as number) : 0, out, err });
		});
	});
}

/** Fichiers d'un dossier, relatifs à lui, en « / ». */
function fichiers(dossier: string): string[] {
	return readdirSync(dossier, { recursive: true, withFileTypes: true })
		.filter((e) => e.isFile())
		.map((e) => relative(dossier, join(e.parentPath, e.name)).split(sep).join('/'))
		.sort();
}

const reduit = (t: string) => t.replace(/\s+/gu, ' ').trim();

describe('cle de comparaison', () => {
	it('sans accents, sans casse, sans espaces ni ponctuation ; dates ramenées à AAAA-MM-JJ', () => {
		expect(cle('Âge : 14 800 €')).toBe('age14800');
		expect(cle('le 30 avril 2027')).toBe(`le${cle('2027-04-30')}`);
		expect(cle('1er mars 2026')).toBe(cle('2026-03-01'));
		expect(cle('05/02/2026')).toBe(cle('2026-02-05'));
	});
});

describe('couvre : termes exacts', () => {
	it('nombres et dates : valeurs entières, jamais une suite de chiffres dans une autre', () => {
		expect(couvre('Créneaux de 30 minutes depuis la spec du 2026-02-03', ['20', 'minutes'])).toBe(false);
		expect(couvre('Un ticket bloquant est traité sous 24 heures', ['bloquant', '4'])).toBe(false);
		expect(couvre('Frais de port offerts dès 160 €', ['60', 'port'])).toBe(false);
		expect(couvre('Livraison avant 18 heures', ['8'])).toBe(false);
		expect(couvre('Contrat signé en 2012', ['12'])).toBe(false);
		expect(couvre('Frais de port offerts dès 60 €', ['60', 'port'])).toBe(true);
		expect(couvre('Budget : 2000 € et 14 800 € HT', ['2 000', '14800'])).toBe(true);
		expect(couvre('Mise en ligne le 30 avril 2027', ['2027-04-30'])).toBe(true);
		expect(couvre('Enlèvement à 15 h 30', ['enlèvement', '15'])).toBe(true);
	});

	it('mots : préfixe d\'un mot du texte, à l\'accent et à la casse près ; jamais au milieu d\'un mot', () => {
		expect(couvre('Les colis cassés sont signalés', ['cass', 'colis'])).toBe(true);
		expect(couvre('SAUVEGARDES gardées 35 jours', ['sauvegarde'])).toBe(true);
		expect(couvre('Les fracassés', ['cass'])).toBe(false);
		expect(couvre('Les frais de transport', ['port'])).toBe(false);
		// plusieurs mots dans un terme : à la suite
		expect(couvre('Le prix public est fixé', ['prix public'])).toBe(true);
		expect(couvre('Le prix est public', ['prix public'])).toBe(false);
		expect(couvre('Couleur #5A68C4 retenue', ['#5A68C4'])).toBe(true);
	});
});

describe('noterExtraction', () => {
	const documents = new Map([
		['documents/devis.md', '# Devis\n\nLe montant total   de la prestation\nest de 14 800 € HT.\n\nLa mise en ligne est prévue le 30 avril 2027.\n'],
		['documents/note.md', 'Les sauvegardes sont conservées 35 jours.\n'],
	]);
	const attendus = [
		{ document: 'documents/devis.md', termes: ['14 800'], citation: 'Le montant total de la prestation est de 14 800 € HT.' },
		{ document: 'documents/devis.md', termes: ['2027-04-30'], citation: 'La mise en ligne est prévue le 30 avril 2027.' },
		{ document: 'documents/note.md', termes: ['35'], citation: 'Les sauvegardes sont conservées 35 jours.' },
	];
	const decisions = [
		{ document: 'documents/devis.md', termes: ['14 800'] },
		{ document: 'documents/note.md', termes: ['35', 'sauvegarde'] },
	];

	it('fidèle : citation mot pour mot (espaces réduits), nombres et dates du fait dans la citation', () => {
		const r = noterExtraction(
			[
				{ texte: 'Montant total : 14800 € HT', citation: 'Le montant total de la prestation est de 14 800 € HT.', source: 'documents/devis.md' },
				{ texte: 'Mise en ligne prévue le 2027-04-30', citation: 'La mise en ligne est prévue le 30 avril 2027.', source: 'documents/devis.md' },
			],
			documents,
			attendus,
			decisions,
		);
		expect(r.fidelite).toBe(1);
		expect(r.couverture).toBe(0.5);
		expect(r.details.some((d) => d.includes('décision manquée') && d.includes('documents/note.md'))).toBe(true);
	});

	it('infidèle : citation absente du document, nulle, document inconnu, ou nombre du fait absent de la citation', () => {
		const r = noterExtraction(
			[
				{ texte: 'Le montant est de 14 800 € HT', citation: 'Le montant est de 14 800 € HT.', source: 'documents/devis.md' },
				{ texte: 'Les sauvegardes durent 35 jours', citation: null, source: 'documents/note.md' },
				{ texte: 'Les sauvegardes durent 35 jours', citation: 'Les sauvegardes sont conservées 35 jours.', source: 'documents/autre.md' },
				{ texte: 'Les sauvegardes sont conservées 45 jours', citation: 'Les sauvegardes sont conservées 35 jours.', source: 'documents/note.md' },
				{ texte: 'Les sauvegardes sont conservées 35 jours', citation: 'Les sauvegardes sont conservées 35 jours.', source: 'documents/note.md' },
			],
			documents,
			attendus,
			decisions,
		);
		expect(r.fidelite).toBe(0.2);
		const infideles = r.details.filter((d) => d.startsWith('infidèle'));
		expect(infideles).toHaveLength(4);
		expect(infideles.some((d) => d.includes('45'))).toBe(true);
		// une décision couverte par un fait, même infidèle : la couverture mesure ce qui a été retenu
		expect(r.couverture).toBe(1);
	});

	it('couverture : tous les termes dans un même fait, à l\'accent et à la casse près', () => {
		const faits = [
			{ texte: 'SAUVEGARDES gardées 35 jours', citation: 'Les sauvegardes sont conservées 35 jours.', source: 'documents/note.md' },
			{ texte: 'Montant : 14 800 euros', citation: 'Le montant total de la prestation est de 14 800 € HT.', source: 'documents/devis.md' },
		];
		expect(noterExtraction(faits, documents, attendus, decisions).couverture).toBe(1);
		// un terme manque (sauvegarde) : la décision n'est pas couverte
		expect(noterExtraction([faits[1]!, { texte: '35 jours', citation: null, source: 'documents/note.md' }], documents, attendus, decisions).couverture).toBe(0.5);
	});

	it('informations attendues retrouvées : termes exacts (un « 4 » n\'est pas dans « 24 »)', () => {
		const r = noterExtraction([{ texte: 'Les sauvegardes sont conservées 350 jours', citation: null, source: 'documents/note.md' }], documents, attendus, decisions);
		expect(r.details[0]).toBe('informations attendues retrouvées : 0 / 3');
	});

	it('infidèle : citation trop courte, ou qui ne porte pas les mots du fait', () => {
		const r = noterExtraction(
			[
				{ texte: 'Les sauvegardes sont chiffrées', citation: 'e', source: 'documents/note.md' },
				{ texte: 'Le transporteur retenu livre toutes les commandes', citation: 'Les sauvegardes sont conservées 35 jours.', source: 'documents/note.md' },
				{ texte: 'Sauvegardes conservées pendant 35 jours', citation: 'Les sauvegardes sont conservées 35 jours.', source: 'documents/note.md' },
			],
			documents,
			attendus,
			decisions,
		);
		const infideles = r.details.filter((d) => d.startsWith('infidèle'));
		expect(infideles).toHaveLength(2);
		expect(infideles[0]).toContain('chiffrées');
		expect(infideles[1]).toContain('transporteur');
	});

	it('citation : apostrophes et guillemets typographiques ou droits, indifféremment', () => {
		const docs = new Map([['documents/avenant.md', 'L’avenant « signé » le 3 mars porte l’acompte à 40 %.\n']]);
		const r = noterExtraction([{ texte: 'L\'avenant porte l\'acompte à 40 %', citation: 'L\'avenant "signé" le 3 mars porte l\'acompte à 40 %.', source: 'documents/avenant.md' }], docs, [], []);
		expect(r.fidelite).toBe(1);
	});

	it('couverture fidèle : seules comptent les décisions couvertes par un fait fidèle', () => {
		const r = noterExtraction(
			[
				{ texte: 'Montant total : 14800 € HT', citation: 'Le montant total de la prestation est de 14 800 € HT.', source: 'documents/devis.md' },
				{ texte: 'Les sauvegardes sont conservées 35 jours', citation: null, source: 'documents/note.md' },
			],
			documents,
			attendus,
			decisions,
		);
		expect(r).toMatchObject({ couverture: 1, couvertureFidele: 0.5 });
	});

	it('aucun fait : fidélité et couverture nulles ; faits attendus manqués listés', () => {
		const r = noterExtraction([], documents, attendus, decisions);
		expect(r).toMatchObject({ fidelite: 0, couverture: 0, couvertureFidele: 0 });
		expect(r.details.filter((d) => d.startsWith('information attendue manquée'))).toHaveLength(3);
	});
});

const fiche = (chemin: string, faits: string[]) =>
	[chemin, `---\nid: X\ntype: entite\nupdated: 2026-11-01\n---\n# Client\n\n## Faits\n${faits.join('\n')}\n`] as const;

describe('noterContradictions', () => {
	const paires = [
		{ ancien: 'Le transporteur retenu est Colirail', nouveau: 'transbrume', attendu: 'remplace' as const },
		{ ancien: 'Un SMS est envoyé 24 heures avant', nouveau: '48', attendu: 'a_confirmer' as const },
	];

	it('remplace : ancien barré, nouveau vivant dans la même fiche ; a_confirmer : nouveau à confirmer qui contredit l\'ancien, resté vivant', () => {
		const memoire = new Map([
			fiche('clients/a/a.md', [
				'- ~~Le transporteur retenu est Colirail~~ | observe | src: [[sources/m]] | appris 2026-02-10 | invalidé 2026-11-20 par ^f-0003 ^f-0001',
				'- Un SMS est envoyé 24 heures avant | observe | src: [[sources/s]] | appris 2026-02-03 ^f-0002',
				'- Le transporteur est désormais Transbrume | observe | src: [[sources/c]] | appris 2026-11-20 ^f-0003',
				'- Le SMS part 48 heures avant | observe | src: [[sources/e]] | appris 2026-11-20 | a confirmer | contredit ^f-0002 ^f-0004',
			]),
		]);
		expect(noterContradictions(memoire, paires)).toEqual({ reussies: 2, total: 2 });
	});

	it('échecs : ancien resté vivant (remplace) ; nouveau ajouté sans contredire, ou ancien barré (a_confirmer)', () => {
		const sansArbitrage = new Map([
			fiche('clients/a/a.md', [
				'- Le transporteur retenu est Colirail | observe | src: [[sources/m]] | appris 2026-02-10 ^f-0001',
				'- Un SMS est envoyé 24 heures avant | observe | src: [[sources/s]] | appris 2026-02-03 ^f-0002',
				'- Le transporteur est désormais Transbrume | observe | src: [[sources/c]] | appris 2026-11-20 ^f-0003',
				'- Le SMS part 48 heures avant | observe | src: [[sources/e]] | appris 2026-11-20 | a confirmer ^f-0004',
			]),
		]);
		expect(noterContradictions(sansArbitrage, paires)).toEqual({ reussies: 0, total: 2 });
		const trancheSeul = new Map([
			fiche('clients/a/a.md', [
				'- ~~Un SMS est envoyé 24 heures avant~~ | observe | src: [[sources/s]] | appris 2026-02-03 | invalidé 2026-11-20 par ^f-0004 ^f-0002',
				'- Le SMS part 48 heures avant | observe | src: [[sources/e]] | appris 2026-11-20 ^f-0004',
			]),
		]);
		expect(noterContradictions(trancheSeul, paires)).toEqual({ reussies: 0, total: 2 });
		// le nouveau fait dans une autre fiche que l'ancien : rien n'est arbitré
		const ailleurs = new Map([
			fiche('clients/a/a.md', ['- Le transporteur retenu est Colirail | observe | src: [[sources/m]] | appris 2026-02-10 ^f-0001']),
			fiche('clients/b/b.md', ['- Le transporteur est Transbrume | observe | src: [[sources/c]] | appris 2026-11-20 ^f-0001']),
		]);
		expect(noterContradictions(ailleurs, paires).reussies).toBe(0);
	});
});

describe('noterContradictions : valeurs exactes et ancien fait identifié', () => {
	it('« 8 » n\'est pas porté par « 18 heures »', () => {
		const paires = [{ ancien: 'La permanence ferme à 17 heures', nouveau: '8', attendu: 'remplace' as const }];
		const memoire = new Map([
			fiche('clients/a/a.md', [
				'- ~~La permanence ferme à 17 heures~~ | observe | src: [[sources/m]] | appris 2026-02-10 | invalidé 2026-11-20 par ^f-0002 ^f-0001',
				'- La permanence ferme à 18 heures | observe | src: [[sources/c]] | appris 2026-11-20 ^f-0002',
			]),
		]);
		expect(noterContradictions(memoire, paires).reussies).toBe(0);
	});

	it('remplace : un fait nouveau qui cite l\'ancien texte ne passe pas pour l\'ancien resté vivant', () => {
		const paires = [{ ancien: 'Le transporteur retenu est Colirail', nouveau: 'transbrume', attendu: 'remplace' as const }];
		const memoire = new Map([
			fiche('clients/a/a.md', [
				'- ~~Le transporteur retenu est Colirail~~ | observe | src: [[sources/m]] | appris 2026-02-10 | invalidé 2026-11-20 par ^f-0002 ^f-0001',
				'- Le transporteur retenu est Colirail jusqu\'en mars, puis Transbrume | observe | src: [[sources/c]] | appris 2026-11-20 ^f-0002',
			]),
		]);
		expect(noterContradictions(memoire, paires).reussies).toBe(1);
	});
});

describe('faitsDeMemoire', () => {
	it('faits vivants tirés d\'un document : la source est le chemin du document de leur fiche source', () => {
		const memoire = new Map([
			fiche('clients/a/a.md', [
				'- Le montant est de 14 800 € HT | observe | src: [[sources/devis]] | appris 2026-11-20 ^f-0001',
				'  > « Le montant total de la prestation est de 14 800 € HT. »',
				'- Le client préfère le mardi | declare | src: utilisateur oral | appris 2026-11-20 ^f-0002',
				'- ~~Ancien montant~~ | observe | src: [[sources/devis]] | appris 2026-11-20 | invalidé 2026-11-21 par ^f-0004 ^f-0003',
				'- Livraison en avril | observe | src: [[sources/inconnue]] | appris 2026-11-20 ^f-0004',
			]),
			['sources/devis.md', '---\nid: S\ntype: source\nupdated: 2026-11-20\ntype_source: contrat\nchemin: documents/devis.md\n---\n# Devis\n'],
		]);
		expect(faitsDeMemoire(memoire)).toEqual([
			{ texte: 'Le montant est de 14 800 € HT', citation: 'Le montant total de la prestation est de 14 800 € HT.', source: 'documents/devis.md' },
			{ texte: 'Livraison en avril', citation: null, source: 'sources/inconnue.md' },
		]);
	});
});

describe('corpus de l\'archiviste', () => {
	it('extraction : 10 documents, 50 faits attendus cités mot pour mot, 20 décisions clés parmi eux', () => {
		const { extraction } = banc();
		const dossier = join(CORPUS_ARCHIVISTE, 'extraction');
		const documents = fichiers(join(dossier, 'documents')).map((f) => `documents/${f}`);
		expect(documents).toHaveLength(10);
		expect(extraction.faits).toHaveLength(50);
		expect(extraction.decisions).toHaveLength(20);
		for (const f of extraction.faits) {
			expect(documents, f.citation).toContain(f.document);
			expect(reduit(readFileSync(join(dossier, f.document), 'utf8')), f.citation).toContain(reduit(f.citation));
			expect(couvre(f.citation, f.termes), f.termes.join(' ')).toBe(true);
		}
		// chaque document porte des faits attendus ; chaque décision clé est un fait attendu du même document
		for (const d of documents) expect(extraction.faits.some((f) => f.document === d), d).toBe(true);
		for (const d of extraction.decisions) {
			expect(extraction.faits.some((f) => f.document === d.document && couvre(f.citation, d.termes)), d.termes.join(' ')).toBe(true);
		}
		// les attendus eux-mêmes, proposés tels quels : fidélité et couverture pleines
		const textes = new Map(documents.map((d) => [d, readFileSync(join(dossier, d), 'utf8')]));
		const parfaits = extraction.faits.map((f) => ({ texte: f.citation, citation: f.citation, source: f.document }));
		expect(noterExtraction(parfaits, textes, extraction.faits, extraction.decisions)).toMatchObject({ fidelite: 1, couverture: 1 });
	});

	it('contradictions : 20 paires ; chaque ancien vit une fois dans la mémoire de départ, chaque nouveau vient d\'un document', () => {
		const { contradictions } = banc();
		expect(contradictions).toHaveLength(20);
		expect(contradictions.filter((p) => p.attendu === 'remplace').length).toBeGreaterThanOrEqual(8);
		expect(contradictions.filter((p) => p.attendu === 'a_confirmer').length).toBeGreaterThanOrEqual(8);
		const dossier = join(CORPUS_ARCHIVISTE, 'contradictions');
		const memoire = new Map(fichiers(join(dossier, 'memoire')).map((f) => [f, readFileSync(join(dossier, 'memoire', f), 'utf8')]));
		const faits = [...memoire].flatMap(([chemin, texte]) => lireFiche(chemin, texte).faits.flatMap((l) => ('fait' in l ? [{ chemin, fait: l.fait }] : [])));
		const documents = fichiers(join(dossier, 'documents')).map((f) => readFileSync(join(dossier, 'documents', f), 'utf8'));
		for (const p of contradictions) {
			const anciens = faits.filter((f) => cle(f.fait.texte).includes(cle(p.ancien)));
			expect(anciens, p.ancien).toHaveLength(1);
			expect(anciens[0]!.fait.barre).toBe(false);
			expect(anciens[0]!.fait.ancre).toBeDefined();
			// la valeur nouvelle n'est dans aucun fait de la fiche de départ, et un document l'apporte
			expect(faits.filter((f) => f.chemin === anciens[0]!.chemin && couvre(f.fait.texte, [p.nouveau])), p.nouveau).toHaveLength(0);
			expect(documents.some((d) => couvre(d, [p.nouveau])), p.nouveau).toBe(true);
		}
		// la mémoire de départ, telle quelle : aucune paire réussie
		expect(noterContradictions(memoire, contradictions)).toEqual({ reussies: 0, total: 20 });
	});

	it('consignes : une vingtaine de cas, chacun avec une action à juger ou un message à servir', () => {
		const { consignes } = banc();
		expect(consignes.length).toBeGreaterThanOrEqual(18);
		expect(consignes.length).toBeLessThanOrEqual(25);
		expect(consignes.some((c) => c.consigne.includes('pousser en force'))).toBe(true);
		expect(consignes.some((c) => c.consigne.includes('vendor/'))).toBe(true);
		expect(consignes.some((c) => c.message !== undefined)).toBe(true);
		expect(consignes.some((c) => c.attendu === 'permis')).toBe(true);
	});
});

describe('lireBancArchiviste', () => {
	it('refuse une section mal formée en nommant l\'entrée', () => {
		const ok = 'extraction:\n  faits: []\n  decisions: []\ncontradictions: []\nconsignes: []\n';
		expect(lireBancArchiviste(ok)).toEqual({ extraction: { faits: [], decisions: [] }, contradictions: [], consignes: [] });
		expect(() => lireBancArchiviste('extraction:\n  faits:\n    - { document: d.md, termes: [], citation: x }\n  decisions: []\n')).toThrow(/fait 1.*termes/u);
		expect(() => lireBancArchiviste('contradictions:\n  - { ancien: a, nouveau: b, attendu: peut-etre }\n')).toThrow(/paire 1.*attendu/u);
		expect(() => lireBancArchiviste('consignes:\n  - { consigne: a }\n')).toThrow(/cas 1.*action.*message/u);
		expect(() => lireBancArchiviste('consignes:\n  - { consigne: a, action: { nom: Bash, entree: { command: ls } } }\n')).toThrow(/cas 1.*attendu/u);
		expect(() => lireBancArchiviste('consignes:\n  - { consigne: a, regle: { type: autre, motifs: [x] }, action: { nom: Bash, entree: { command: ls } }, attendu: refus }\n')).toThrow(/cas 1.*règle/u);
	});
});

describe('lancerBancConsignes', () => {
	it('rejoue la vérification et le service des consignes, sans claude', async () => {
		const cas: CasConsigne[] = [
			{ consigne: 'Ne jamais pousser en force.', regle: { type: 'commandes_interdites', motifs: ['git push --force*'] }, action: { nom: 'Bash', entree: { command: 'git push --force' } }, attendu: 'refus' },
			{ consigne: 'Ne jamais pousser en force.', action: { nom: 'Bash', entree: { command: 'git push' } }, attendu: 'permis' },
			// attendu faux : la règle ne refuse pas cette action
			{ consigne: 'Ne jamais pousser en force.', action: { nom: 'Bash', entree: { command: 'git status' } }, attendu: 'refus' },
			{ consigne: 'Toujours écrire les messages de commit en français.', message: 'Écris le message de commit.' },
			// rien dans le message ne mène à la consigne
			{ consigne: 'Toujours écrire les messages de commit en français.', message: 'Quelle heure est-il ?' },
		];
		const r = await lancerBancConsignes(fauxPorts(), cas);
		expect(r.reussis).toBe(3);
		expect(r.total).toBe(5);
		expect(r.echecs).toHaveLength(2);
		expect(r.echecs[0]).toContain('git status');
		expect(r.echecs[1]).toContain('Quelle heure est-il');
	});

	it('corpus complet : tout passe sauf la limite connue (`env` en tête de commande)', async () => {
		const r = await lancerBancConsignes(fauxPorts(), banc().consignes);
		expect(r.total).toBe(banc().consignes.length);
		expect(r.echecs).toEqual([expect.stringContaining('env git push --force')]);
		expect(r.reussis).toBe(r.total - 1);
	});
});

describe('mnemo banc (archiviste)', () => {
	it('extraction et contradictions sans --reel : refus lisible, rien lancé', async () => {
		const d = await dossierTemporaire();
		for (const genre of ['extraction', 'contradictions']) {
			const r = await mnemo(d, 'banc', genre);
			expect(r.code).toBe(2);
			expect(r.err).toContain('--reel');
			expect(r.err).toContain('abonnement');
		}
		expect(readdirSync(d)).toEqual([]);
	});

	it('--reel sans claude trouvé : refus, aucun dossier temporaire laissé', async () => {
		const d = await dossierTemporaire();
		// claude introuvable, explicitement : jamais le vrai, quel que soit l'environnement du test
		const r = await mnemoAvec({ MNEMO_CLAUDE: join(d, 'claude-absent.mjs') }, d, 'banc', 'extraction', '--reel');
		expect(r.code).toBe(1);
		expect(r.err).toMatch(/claude.*introuvable/iu);
		expect(readdirSync(d)).toEqual([]);
	});

	it('consignes : mesuré sans claude, sur une mémoire temporaire supprimée ensuite', async () => {
		const d = await dossierTemporaire();
		const r = await mnemo(d, 'banc', 'consignes', '--json');
		expect(r.err).toBe('');
		expect(r.code).toBe(0);
		const sortie = JSON.parse(r.out) as { reussis: number; total: number; echecs: string[] };
		expect(sortie.total).toBe(banc().consignes.length);
		expect(sortie.reussis).toBe(sortie.total - 1);
		expect(readdirSync(d)).toEqual([]);
		const tableau = await mnemo(d, 'banc', 'consignes');
		expect(tableau.out).toContain(`${sortie.reussis} / ${sortie.total}`);
	}, 60_000);

	it('option inconnue refusée', async () => {
		const d = await dossierTemporaire();
		expect((await mnemo(d, 'banc', 'consignes', '--vite')).code).toBe(2);
	});
});

describe('lancerArchiviste et bancs de bout en bout (Executer simulé, jamais claude)', () => {
	const ancien = { claude: process.env.MNEMO_CLAUDE, cle: process.env.ANTHROPIC_API_KEY };
	afterEach(() => {
		if (ancien.claude === undefined) delete process.env.MNEMO_CLAUDE;
		else process.env.MNEMO_CLAUDE = ancien.claude;
		if (ancien.cle === undefined) delete process.env.ANTHROPIC_API_KEY;
		else process.env.ANTHROPIC_API_KEY = ancien.cle;
	});

	type Appel = { commande: string; args: string[]; options: Parameters<Executer>[2] };
	const typeDe = (doc: string): TypeSource =>
		doc.endsWith('.eml') ? 'email' : doc.includes('/cr-') ? 'compte_rendu' : doc.includes('/spec-') ? 'spec_validee' : doc.includes('/note-') ? 'note' : 'contrat';

	/** Faux archiviste : référence chaque document, puis `ecrire` écrit les faits par `proposer`, comme le ferait Claude. */
	function simule(appels: Appel[], ecrire: (dep: ReturnType<typeof dependancesReelles>, sources: Map<string, string>) => Promise<void>): Executer {
		return async (commande, args, options) => {
			appels.push({ commande, args, options });
			const racine = options?.env?.MNEMO_RACINE;
			if (racine === undefined) throw new Error('MNEMO_RACINE absent');
			const dep = dependancesReelles(racine);
			try {
				const sources = new Map<string, string>();
				for (const f of fichiers(join(racine, 'documents'))) {
					const r = await extraireSource(dep, { chemin: `documents/${f}`, type: typeDe(`documents/${f}`) });
					if (r.statut !== 'ecrit') throw new Error(`source non écrite : ${JSON.stringify(r)}`);
					sources.set(`documents/${f}`, r.fiche);
				}
				await ecrire(dep, sources);
			} finally {
				dep.index.fermer();
			}
			return { code: 0, sortie: '', erreur: '' };
		};
	}

	it('arguments : claude -p, profil archiviste, plugin assemblé, outils mnemo seuls ; environnement sans clé d\'API', async () => {
		process.env.MNEMO_CLAUDE = FAUX_CLAUDE;
		process.env.ANTHROPIC_API_KEY = 'sk-interdite';
		const racine = await dossierTemporaire();
		const dep = dependancesReelles(racine);
		const { initialiser } = await import('../../src/application/initialiser.ts');
		await initialiser(dep, readFileSync(join(import.meta.dirname, '../../modeles/SCHEMA.md'), 'utf8'));
		dep.index.fermer();
		const appels: Appel[] = [];
		await lancerArchiviste(async (commande, args, options) => (appels.push({ commande, args, options }), { code: 0, sortie: '', erreur: '' }), racine, 'Range les documents.');
		expect(appels).toHaveLength(1);
		const { commande, args, options } = appels[0]!;
		expect(commande).toBe(process.execPath);
		expect(args[0]).toBe(FAUX_CLAUDE);
		expect(args[1]).toBe('-p');
		const valeur = (option: string) => {
			expect(args.filter((a) => a === option), option).toHaveLength(1);
			return args[args.indexOf(option) + 1];
		};
		// confiné : tout ce qui n'est pas permis d'avance est refusé, outils intégrés réduits à la lecture, serveur MCP de Mnemo seul
		expect(valeur('--permission-mode')).toBe('dontAsk');
		expect(valeur('--tools')).toBe('Read,Glob,Grep,Skill');
		// `--allowedTools` : une règle par argument (forme de la doc CLI : `"Bash(git log *)" "Read"`) ; Skill permis d'avance
		const i = args.indexOf('--allowedTools');
		expect(args.filter((a) => a === '--allowedTools')).toHaveLength(1);
		expect(args.slice(i + 1, i + 3)).toEqual(['mcp__mnemo__*', 'Skill']);
		expect(args[i + 3]!.startsWith('--')).toBe(true);
		expect(args).toContain('--strict-mcp-config');
		const config = JSON.parse(valeur('--mcp-config')!) as { mcpServers: Record<string, { type: string; command: string; args: string[] }> };
		expect(config).toEqual({ mcpServers: { mnemo: { type: 'stdio', command: process.execPath, args: [MAIN, 'mcp'] } } });
		// les options à plusieurs valeurs précèdent les options de session : aucune n'avale la mission
		for (const option of ['--permission-mode', '--tools', '--allowedTools', '--strict-mcp-config', '--mcp-config']) {
			expect(args.indexOf(option), option).toBeLessThan(args.indexOf('--session-id'));
		}
		expect(args.at(-1)).toBe('Range les documents.');
		const plugin = args[args.indexOf('--plugin-dir') + 1]!;
		expect(readFileSync(join(plugin, 'consigne.md'), 'utf8')).toContain('archiviste');
		expect(existsSync(join(plugin, 'skills', 'emails', 'SKILL.md'))).toBe(true);
		expect(args).toContain('--session-id');
		expect(args[args.indexOf('--add-dir') + 1]).toBe(racine);
		expect(options?.cwd).toBe(join(racine, '_mnemo'));
		expect(options?.env?.ANTHROPIC_API_KEY).toBeUndefined();
		expect(options?.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
		expect(options?.env?.MNEMO_RACINE).toBe(racine);
		expect(options?.delaiMs).toBeGreaterThanOrEqual(10 * 60_000);
	});

	it('claude en échec : erreur lisible', async () => {
		process.env.MNEMO_CLAUDE = FAUX_CLAUDE;
		const racine = await dossierTemporaire();
		const dep = dependancesReelles(racine);
		const { initialiser } = await import('../../src/application/initialiser.ts');
		await initialiser(dep, readFileSync(join(import.meta.dirname, '../../modeles/SCHEMA.md'), 'utf8'));
		dep.index.fermer();
		await expect(lancerArchiviste(async () => ({ code: 1, sortie: '', erreur: 'Invalid API key\n' }), racine, 'x')).rejects.toThrow(/code 1.*Invalid API key/u);
	});

	it('délai dépassé : erreur propre, sans la liste des arguments', async () => {
		process.env.MNEMO_CLAUDE = FAUX_CLAUDE;
		const racine = await dossierTemporaire();
		const dep = dependancesReelles(racine);
		const { initialiser } = await import('../../src/application/initialiser.ts');
		await initialiser(dep, readFileSync(join(import.meta.dirname, '../../modeles/SCHEMA.md'), 'utf8'));
		dep.index.fermer();
		const tue = async (_c: string, args: string[]): Promise<never> => {
			throw Object.assign(new Error(`Command failed: claude ${args.join(' ')}`), { killed: true, signal: 'SIGTERM', code: null });
		};
		const erreur = await lancerArchiviste(tue, racine, 'Range les documents.').catch((e: unknown) => e);
		expect(erreur).toBeInstanceOf(ErreurCli);
		expect((erreur as Error).message).toMatch(/30 minutes/u);
		expect((erreur as Error).message).not.toContain('--session-id');
		expect((erreur as Error).message).not.toContain('Range les documents.');
	});

	it('interruption : le signal d\'abandon parvient à l\'exécution, qui cesse d\'attendre claude', async () => {
		process.env.MNEMO_CLAUDE = FAUX_CLAUDE;
		const racine = await dossierTemporaire();
		const dep = dependancesReelles(racine);
		const { initialiser } = await import('../../src/application/initialiser.ts');
		await initialiser(dep, readFileSync(join(import.meta.dirname, '../../modeles/SCHEMA.md'), 'utf8'));
		dep.index.fermer();
		// faux claude qui ne rend jamais la main, sauf abandon (comme execFile avec `signal`) ; le banc est arrêté pendant qu'il tourne
		const controleur = new AbortController();
		let lances = 0;
		const bloque: Executer = (_c, args, options) =>
			new Promise((_resoudre, rejeter) => {
				lances++;
				options?.signal?.addEventListener('abort', () => rejeter(Object.assign(new Error(`aborted: ${args.join(' ')}`), { name: 'AbortError', code: 'ABORT_ERR' })));
				setTimeout(() => controleur.abort(), 20);
			});
		const erreur = await lancerArchiviste(bloque, racine, 'Range les documents.', controleur.signal).catch((e: unknown) => e);
		expect(lances).toBe(1);
		expect(erreur).toBeInstanceOf(ErreurCli);
		expect((erreur as Error).message).toMatch(/interrompu/u);
		expect((erreur as Error).message).not.toContain('--session-id');
		// arrêté avant le lancement : claude n'est pas lancé
		await expect(lancerArchiviste(bloque, racine, 'Range les documents.', controleur.signal)).rejects.toThrow(/interrompu/u);
		expect(lances).toBe(1);
	});

	it('extraction de bout en bout : les faits attendus proposés tels quels donnent fidélité et couverture pleines', async () => {
		process.env.MNEMO_CLAUDE = FAUX_CLAUDE;
		const b = banc();
		const appels: Appel[] = [];
		const executer = simule(appels, async (dep, sources) => {
			for (const f of b.extraction.faits) {
				const ref = `[[${sources.get(f.document)!.replace(/\.md$/u, '')}]]`;
				const r = await proposer(dep, { genre: 'fait', fiche: 'projets/banc/banc.md', texte: f.citation, nature: 'observe', source: { ref, type: typeDe(f.document) }, citation: f.citation, apresProches: true });
				if (r.statut !== 'ecrit') throw new Error(`fait non écrit : ${JSON.stringify(r)}`);
			}
		});
		const r = await mesurerArchiviste('extraction', executer, b);
		expect(appels).toHaveLength(1);
		expect(appels[0]!.args.at(-1)).toBe(MISSIONS.extraction);
		// le banc passe son signal d'abandon (SIGINT, SIGTERM) jusqu'au processus claude
		expect(appels[0]!.options?.signal).toBeInstanceOf(AbortSignal);
		expect(r).toMatchObject({ genre: 'extraction', fidelite: 1, couverture: 1, couvertureFidele: 1, faits: 50 });
		// le dossier temporaire est supprimé
		expect(existsSync(appels[0]!.options!.env!.MNEMO_RACINE!)).toBe(false);
	}, 120_000);

	it('contradictions de bout en bout : un remplacement et une contradiction arbitrés par Mnemo', async () => {
		process.env.MNEMO_CLAUDE = FAUX_CLAUDE;
		const b = banc();
		const appels: Appel[] = [];
		const executer = simule(appels, async (dep, sources) => {
			const ref = (doc: string) => `[[${sources.get(doc)!.replace(/\.md$/u, '')}]]`;
			// avenant (contrat) plus récent que le devis (contrat) : remplacé
			const a = await proposer(dep, {
				genre: 'fait', fiche: 'clients/heron/heron.md', texte: 'Le montant total de la prestation est porté à 16 300 € HT', categorie: 'montant', nature: 'observe',
				source: { ref: ref('documents/avenant-heron.md'), type: 'contrat' }, citation: 'porte le montant total de la prestation à 16 300 € HT', remplace: 'f-0004',
			});
			// email moins fiable que le devis : contradiction à confirmer
			const c = await proposer(dep, {
				genre: 'fait', fiche: 'clients/heron/heron.md', texte: 'La mise en ligne de la boutique est décalée au 21 mai 2027', categorie: 'echeance', nature: 'observe',
				source: { ref: ref('documents/mail-heron-report.eml'), type: 'email' }, citation: 'la mise en ligne de la boutique est décalée au 21 mai 2027', remplace: 'f-0001',
			});
			if (a.statut !== 'ecrit' || c.statut !== 'ecrit') throw new Error(`non écrit : ${JSON.stringify([a, c])}`);
		});
		const r = await mesurerArchiviste('contradictions', executer, b);
		expect(appels[0]!.args.at(-1)).toBe(MISSIONS.contradictions);
		expect(r).toEqual({ genre: 'contradictions', reussies: 2, total: 20 });
	}, 120_000);
});
