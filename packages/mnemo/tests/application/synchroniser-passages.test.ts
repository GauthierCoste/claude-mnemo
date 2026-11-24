import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chercher as chercherSeul, chercherAvecAvis, chronologie as chronologieSeule } from '../../src/application/chercher.ts';
import { extraireSource } from '../../src/application/extraire-source.ts';
import { extractionDifferee } from '../../src/application/extraction-differee.ts';
import { extractionLocale } from '../../src/application/extraire-passages.ts';
import { ErreurExtraction } from '../../src/application/ports.ts';
import type { Dependances, Extracteur, Extracteurs } from '../../src/application/ports.ts';
import { reindexerApresEcriture, synchroniser } from '../../src/application/synchroniser.ts';
import { lireElement } from '../../src/application/lire.ts';
import { expressionFts } from '../../src/domaine/requete.ts';
import { extracteursReels } from '../../src/infra/extracteurs/index.ts';
import { ouvrirIndex } from '../../src/infra/index-sqlite.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const source = (chemin: string, extra = '', titre = 'Cahier des charges') =>
	`---\nid: 01SRC\ntype: source\nchemin: ${chemin}\n${extra}updated: 2026-11-01\n---\n# ${titre}\n`;
const fait = (texte: string, src: string) => `---\nid: 01P\ntype: sujet\nupdated: 2026-11-01\n---\n# P\n\n## Faits\n- ${texte} | declare | src: ${src} | appris 2026-11-20 | confiance 90 % ^f-0001\n`;
const corps = (mot: string) => `# Cahier\n\n## Besoins\n\nLe ${mot} doit être livré avec son enclos. ${'Phrase de remplissage pour le passage. '.repeat(10)}\n`;

/** Extracteurs réels, comptés : `appels` donne les chemins extraits, dans l'ordre. */
function comptes(base: Extracteurs = extracteursReels()): Extracteurs & { appels: string[] } {
	const appels: string[] = [];
	return {
		appels,
		pour(chemin) {
			const e = base.pour(chemin);
			const compte: Extracteur = {
				extraire: async (c, o) => {
					appels.push(c);
					return e.extraire(c, o);
				},
			};
			if (e.extraireTout !== undefined) {
				compte.extraireTout = async (c, o) => {
					appels.push(c);
					return e.extraireTout!(c, o);
				};
			}
			return compte;
		},
	};
}

/**
 * Ces tests portent sur la synchronisation des passages : les documents sont d'abord extraits (la recherche, elle, ne
 * l'attend jamais : voir « recherche sans attente »), puis cherchés.
 */
const chercher: typeof chercherSeul = async (dep, requete) => {
	await synchroniser(dep);
	return chercherSeul(dep, requete);
};
const chronologie: typeof chronologieSeule = async (dep, sujet, limite) => {
	await synchroniser(dep);
	return chronologieSeule(dep, sujet, limite);
};

const ids = async (dep: Dependances, texte: string) => (await chercher(dep, { texte })).map((t) => t.id);

describe('synchroniser : ligne de contexte des passages de document', () => {
	const long = (sujet: string) =>
		`${sujet}\n\n## Sauvegardes\n\nUn export de la base part chaque nuit vers le NAS. ${'Phrase de remplissage. '.repeat(60)}\n\n## Suite\n\nAutre chose. ${'Encore du texte. '.repeat(60)}\n`;

	/** Ids trouvés par l'index quand TOUS les mots y sont (texte, préfixe ou ligne de contexte). */
	const tousLesMots = async (dep: Dependances, texte: string) => {
		await synchroniser(dep);
		return dep.index.chercher(expressionFts(texte)!.toutes, {}, 20);
	};

	it('sans synthèse : les premières lignes utiles du document situent chaque passage (cherchées, jamais servies)', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/passation.md', long('Reprise de l\'extranet des adhérents de la Mutuelle.'));
		await dep.coffre.ecrire('sources/passation.md', source('docs/passation.md', 'type_source: note\n', 'Notes de passation'));
		const trouves = await tousLesMots(dep, 'export base extranet adhérents');
		const sauvegardes = trouves.find((t) => t.texte.includes('Un export de la base'));
		expect(sauvegardes).toBeDefined();
		expect(sauvegardes!.texte).not.toContain('Mutuelle');
		expect(sauvegardes!.contexte).not.toContain('Mutuelle');
	});

	it('avec une synthèse dans la fiche source : elle sert de ligne de contexte, à la place des premières lignes', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/passation.md', long('Document reçu le 12 octobre.'));
		await dep.coffre.ecrire('sources/passation.md', `${source('docs/passation.md', 'type_source: note\n', 'Notes de passation')}\nPassation de l'extranet des adhérents.\n`);
		expect((await tousLesMots(dep, 'export base extranet adhérents')).some((t) => t.texte.includes('Un export de la base'))).toBe(true);
		expect((await tousLesMots(dep, 'export base octobre')).some((t) => t.texte.includes('Un export de la base'))).toBe(false);
	});
});

describe('synchroniser : passages des documents', () => {
	it('source md indexée, puis trouvée par un mot de son corps ; passage = document typé', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/cdc.md', corps('quokka'));
		await dep.coffre.ecrire('sources/cdc.md', source('docs/cdc.md', 'type_source: contrat\ndate: 2026-10-01\nauteur: Marc\n'));
		const [t, ...autres] = await chercher(dep, { texte: 'quokka' });
		expect(autres).toEqual([]);
		expect(t).toMatchObject({ genre: 'passage', chemin: 'sources/cdc.md', typeFiche: 'source', typeSource: 'contrat', statut: 'servi', source: 'sources/cdc.md', date: '2026-10-01' });
		expect(t!.id).toMatch(/^sources\/cdc\.md#p-[0-9a-f]{8}$/u);
		expect(t!.contexte).toContain('Besoins');
		expect(t!.contexte).toContain('Marc');
		// confiance tirée du type de la source (contrat : 1)
		expect(t!.confiance).toBe(1);
	});

	it('modifiée → passages refaits ; supprimée → passages retirés, fait citant « source_disparue » ; revenue → servi', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/cdc.md', corps('quokka'));
		await dep.coffre.ecrire('sources/cdc.md', source('docs/cdc.md'));
		await dep.coffre.ecrire('projets/p.md', fait('Le zoo veut un enclos', '[[sources/cdc]]'));
		expect(await ids(dep, 'quokka')).toHaveLength(1);

		dep.documents.deposer('docs/cdc.md', corps('wombat'));
		expect(await ids(dep, 'quokka')).toEqual([]);
		expect(await ids(dep, 'wombat')).toHaveLength(1);
		expect((await chercher(dep, { texte: 'enclos', genres: ['fait'] }))[0]!.statut).toBe('servi');

		dep.documents.retirer('docs/cdc.md');
		expect(await synchroniser(dep)).toEqual({ ajoutees: 0, modifiees: 0, retirees: 0, illisibles: [] });
		expect(await ids(dep, 'wombat')).toEqual([]);
		const [f] = await chercher(dep, { texte: 'enclos', genres: ['fait'] });
		expect(f).toMatchObject({ id: 'projets/p.md#^f-0001', statut: 'source_disparue' });
		expect((await dep.index.sources()).find((s) => s.fiche === 'sources/cdc.md')).toMatchObject({ etat: 'disparue', passages: 0 });

		dep.documents.deposer('docs/cdc.md', corps('wombat'));
		expect((await chercher(dep, { texte: 'enclos', genres: ['fait'] }))[0]!.statut).toBe('servi');
		expect(await ids(dep, 'wombat')).toHaveLength(1);
	});

	it('le fait qui cite une source disparue garde son statut même quand sa fiche est réindexée', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('sources/cdc.md', source('docs/absent.md'));
		await dep.coffre.ecrire('projets/p.md', fait('Le zoo veut un enclos', '[[sources/cdc]]'));
		await synchroniser(dep);
		await dep.coffre.ecrire('projets/p.md', fait('Le zoo veut un grand enclos', '[[sources/cdc]]'));
		expect((await chercher(dep, { texte: 'grand enclos', genres: ['fait'] }))[0]!.statut).toBe('source_disparue');
		// une fiche source sans document ni contenu n'est pas « disparue »
		await dep.coffre.ecrire('sources/mail.md', '---\nid: 01M\ntype: source\ntype_source: email\nupdated: 2026-11-01\n---\n# Mail\n');
		await dep.coffre.ecrire('projets/q.md', fait('La girafe arrive lundi', '[[sources/mail]]'));
		expect((await chercher(dep, { texte: 'girafe', genres: ['fait'] }))[0]!.statut).toBe('servi');
	});

	it('note amorcée (sans chemin) : passages tirés de sa section Contenu, sans la clôture du bloc', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire(
			'sources/claude-code/p/note.md',
			'---\nid: 01N\ntype: source\ntype_source: note\norigine: claude-code/p/memory/note.md\nupdated: 2026-11-01\n---\n# note\n\n## Contenu\n\n````\nLe pangolin préfère les fourmis.\n```\ncode\n```\n````\n',
		);
		const trouves = await chercher(dep, { texte: 'pangolin', genres: ['passage'] });
		expect(trouves).toHaveLength(1);
		expect(trouves[0]!.texte).toContain('Le pangolin préfère les fourmis.');
		expect(trouves[0]!.texte).not.toContain('````');
		expect(trouves[0]!.typeSource).toBe('note');
	});

	it('ancienne version : ses passages sont « ancienne_version » dans chercher, la dernière reste servie', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/v1.md', corps('ornithorynque'));
		dep.documents.deposer('docs/v2.md', corps('ornithorynque bleu'));
		await dep.coffre.ecrire('sources/v1.md', source('docs/v1.md'));
		await dep.coffre.ecrire('sources/v2.md', source('docs/v2.md', 'version_de: "[[sources/v1]]"\n'));
		const trouves = await chercher(dep, { texte: 'ornithorynque' });
		expect(trouves.map((t) => [t.chemin, t.statut]).sort()).toEqual([
			['sources/v1.md', 'ancienne_version'],
			['sources/v2.md', 'servi'],
		]);
	});

	it('extraction qui échoue : source dans illisibles, anciens passages gardés, pas réessayée tant que le fichier ne change pas', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/cdc.md', corps('quokka'));
		await dep.coffre.ecrire('sources/cdc.md', source('docs/cdc.md'));
		await synchroniser(dep);
		let essais = 0;
		const panne: Extracteurs = {
			pour: () => ({
				extraire: async () => {
					essais++;
					throw new ErreurExtraction('Extraction Markdown impossible : test.');
				},
			}),
		};
		const reels = dep.extraction;
		dep.extraction = extractionLocale(panne);
		dep.documents.deposer('docs/cdc.md', corps('wombat'));
		expect(await synchroniser(dep)).toEqual({ ajoutees: 0, modifiees: 0, retirees: 0, illisibles: ['sources/cdc.md'], motifs: { 'sources/cdc.md': 'Extraction Markdown impossible : test.' } });
		expect(await ids(dep, 'quokka')).toHaveLength(1);
		expect(essais).toBe(1);
		await synchroniser(dep);
		expect(essais).toBe(1);
		expect((await dep.index.sources())[0]).toMatchObject({ etat: 'illisible', passages: 1 });
		dep.extraction = reels;
		// réessayée quand le fichier change
		dep.documents.deposer('docs/cdc.md', corps('wombat géant'));
		expect(await ids(dep, 'wombat')).toHaveLength(1);
		expect(await ids(dep, 'quokka')).toEqual([]);
	});

	it('un chemin refusé (hors du dossier, dans _mnemo/) : source illisible, jamais d\'exception', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('sources/a.md', source('../dehors.md'));
		await dep.coffre.ecrire('sources/b.md', source('_mnemo/x.md'));
		const bilan = await synchroniser(dep);
		expect(bilan.illisibles).toEqual(['sources/a.md', 'sources/b.md']);
		expect(bilan.motifs!['sources/a.md']).toMatch(/^Chemin de document refusé : /u);
		expect(bilan.motifs!['sources/a.md']).not.toMatch(/chemin refusé/u);
	});

	it('reindexerApresEcriture et lire (passage) n\'extraient aucun document', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/cdc.md', corps('quokka'));
		await dep.coffre.ecrire('sources/cdc.md', source('docs/cdc.md'));
		const [t] = await chercher(dep, { texte: 'quokka' });
		let extractions = 0;
		const reelle = dep.extraction;
		dep.extraction = { extraire: async (...a) => (extractions++, reelle.extraire(...a)), decouper: async (...a) => (extractions++, reelle.decouper(...a)) };
		dep.documents.deposer('docs/cdc.md', corps('wombat'));
		await reindexerApresEcriture(dep);
		expect((await lireElement(dep, t!.id))?.texte).toContain('quokka');
		expect(extractions).toBe(0);
		expect(await ids(dep, 'wombat')).toHaveLength(1);
		expect(extractions).toBe(1);
	});

	it('50 sources : la 2e synchronisation n\'extrait rien ; un document modifié est seul réextrait', async () => {
		const dep = fauxPorts();
		const compteur = comptes();
		dep.extraction = extractionLocale(compteur);
		for (let i = 0; i < 50; i++) {
			dep.documents.deposer(`docs/d${i}.md`, corps(`animal${i}`));
			await dep.coffre.ecrire(`sources/d${i}.md`, source(`docs/d${i}.md`));
		}
		await synchroniser(dep);
		expect(compteur.appels).toHaveLength(50);
		const lectures: string[] = [];
		const ouvrir = dep.documents.ouvrir;
		dep.documents.ouvrir = async (c) => {
			lectures.push(c);
			return ouvrir(c);
		};
		await synchroniser(dep);
		expect(compteur.appels).toHaveLength(50);
		expect(lectures).toEqual([]);
		// même contenu, date changée : relu (empreinte), pas réextrait
		dep.documents.deposer('docs/d3.md', corps('animal3'));
		await synchroniser(dep);
		expect(lectures).toEqual(['docs/d3.md']);
		expect(compteur.appels).toHaveLength(50);
		dep.documents.deposer('docs/d7.md', corps('zèbre'));
		await synchroniser(dep);
		expect(compteur.appels.slice(50)).toEqual(['docs/d7.md']);
		expect(await ids(dep, 'zèbre')).toEqual([expect.stringMatching(/^sources\/d7\.md#p-/u)]);
	});

	it('un secret du document n\'est jamais indexé ; le nombre masqué est noté', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/cfg.md', '# Config\n\nLe serveur du kangourou.\n\npassword: hunter2secret\n\nclé sk-abcdefghijklmnopqrstuvwxyz123456\n');
		await dep.coffre.ecrire('sources/cfg.md', source('docs/cfg.md'));
		expect(await ids(dep, 'kangourou')).toHaveLength(1);
		expect(await ids(dep, 'hunter2secret')).toEqual([]);
		expect(await ids(dep, 'abcdefghijklmnopqrstuvwxyz123456')).toEqual([]);
		expect((await dep.index.sources())[0]!.secrets).toBe(2);
	});

	it('mbox : `fil` choisit un fil ; sans `fil`, le plus ancien (jamais un autre fil sous ce titre)', async () => {
		const dep = fauxPorts();
		const msg = (id: string, sujet: string, texte: string) => `From: a@exemple.fr\nDate: Mon, 02 Mar 2026 10:00:00 +0000\nSubject: ${sujet}\nMessage-ID: ${id}\nContent-Type: text/plain; charset=utf-8\n\n${texte}\n`;
		const mbox = [msg('<1@x>', 'Lamas', 'Les lamas arrivent.'), msg('<2@x>', 'Alpagas', 'Les alpagas partent.')]
			.map((m, i) => `From MAILER-DAEMON Mon Mar  2 10:0${i}:00 2026\n${m}\n`)
			.join('');
		const compteur = comptes();
		dep.extraction = extractionLocale(compteur);
		dep.documents.deposer('mails/b.mbox', mbox);
		await dep.coffre.ecrire('sources/fil0.md', source('mails/b.mbox', 'type_source: email\nfil: 0\n'));
		await dep.coffre.ecrire('sources/fil.md', source('mails/b.mbox', 'type_source: email\nfil: 1\n'));
		await dep.coffre.ecrire('sources/tout.md', source('mails/b.mbox', 'type_source: email\n'));
		expect((await chercher(dep, { texte: 'alpagas', genres: ['passage'] })).map((t) => t.chemin).sort()).toEqual(['sources/fil.md']);
		// même fil, même texte dans fil0 et tout : une entrée, l'autre en copie
		expect((await chercher(dep, { texte: 'lamas', genres: ['passage'] })).flatMap((t) => [t.chemin, ...(t.copies ?? [])]).sort()).toEqual(['sources/fil0.md', 'sources/tout.md']);
		// la boîte est découpée en fils une seule fois pour toutes ses fiches, jamais relue en entier
		expect(compteur.appels).toEqual(['mails/b.mbox']);
	});

	it('source fille : passages tirés de la pièce jointe de la source parente', async () => {
		const dep = fauxPorts();
		const eml = [
			'From: a@exemple.fr', 'Subject: Devis', 'Message-ID: <d@x>', 'Content-Type: multipart/mixed; boundary=zz', '',
			'--zz', 'Content-Type: text/plain; charset=utf-8', '', 'Voici le devis du tapir.', '',
			'--zz', 'Content-Type: text/plain; name="annexe.txt"', 'Content-Disposition: attachment; filename="annexe.txt"', 'Content-Transfer-Encoding: base64', '',
			Buffer.from('Annexe : le capybara mange du foin.').toString('base64'), '--zz--', '',
		].join('\r\n');
		dep.documents.deposer('mails/devis.eml', eml);
		await dep.coffre.ecrire('sources/devis.md', source('mails/devis.eml', 'type_source: email\n'));
		await dep.coffre.ecrire('sources/devis/annexe.md', '---\nid: 01F\ntype: source\ntype_source: email\nsource_parente: "[[sources/devis]]"\npiece: annexe.txt\nupdated: 2026-11-01\n---\n# annexe.txt\n');
		expect((await chercher(dep, { texte: 'capybara', genres: ['passage'] })).map((t) => t.chemin)).toEqual(['sources/devis/annexe.md']);
		expect((await chercher(dep, { texte: 'tapir', genres: ['passage'] })).map((t) => t.chemin)).toEqual(['sources/devis.md']);
		dep.documents.retirer('mails/devis.eml');
		expect(await chercher(dep, { texte: 'capybara', genres: ['passage'] })).toEqual([]);
	});

	it('une fiche source supprimée emporte ses passages', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/cdc.md', corps('quokka'));
		await dep.coffre.ecrire('sources/cdc.md', source('docs/cdc.md'));
		expect(await ids(dep, 'quokka')).toHaveLength(1);
		await dep.coffre.supprimer('sources/cdc.md');
		expect(await ids(dep, 'quokka')).toEqual([]);
		expect(await dep.index.sources()).toEqual([]);
	});

	it('l\'extraction se fait hors transaction : un autre processus peut écrire dans l\'index pendant qu\'elle tourne', async () => {
		const dossier = await dossierTemporaire();
		const fichier = join(dossier, 'index.sqlite');
		const dep = fauxPorts();
		dep.index.fermer();
		dep.index = ouvrirIndex(fichier);
		let ecritPendant = false;
		dep.extraction = extractionLocale({
			pour: () => ({
				extraire: async (chemin, octets) => {
					const autre = new DatabaseSync(fichier);
					try {
						autre.exec('PRAGMA busy_timeout = 0');
						autre.exec('BEGIN IMMEDIATE');
						autre.exec('COMMIT');
						ecritPendant = true;
					} finally {
						autre.close();
					}
					return extracteursReels().pour(chemin)!.extraire(chemin, octets);
				},
			}),
		});
		dep.documents.deposer('docs/cdc.md', corps('quokka'));
		await dep.coffre.ecrire('sources/cdc.md', source('docs/cdc.md'));
		expect(await ids(dep, 'quokka')).toHaveLength(1);
		expect(ecritPendant).toBe(true);
		dep.index.fermer();
	});
});

describe('secrets hors de l\'index', () => {
	it('aucun secret d\'une fiche source ni de son document n\'est écrit dans index.sqlite (toutes tables, toutes colonnes)', async () => {
		const fichier = join(await dossierTemporaire(), 'index.sqlite');
		const dep = fauxPorts();
		dep.index.fermer();
		dep.index = ouvrirIndex(fichier);
		const secrets = ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'sk-proj1234567890abcdefghijklmnop', 'hunter2secret', 'AKIAIOSFODNN7EXAMPLE'];
		dep.documents.deposer('docs/cfg.md', `# Config ${secrets[0]}\n\n## Accès\n\nLe serveur du kangourou.\n\npassword: ${secrets[2]}\n`);
		await dep.coffre.ecrire(
			'sources/cfg.md',
			`---\nid: 01S\ntype: source\nchemin: docs/cfg.md\nauteur: "token: ${secrets[2]}"\nalias: ["${secrets[3]}"]\nupdated: 2026-11-01\n---\n# Jeton ${secrets[0]}\n\nRésumé : la clé ${secrets[1]} ouvre le kangourou.\n\n## Faits\n- La clé AWS est ${secrets[3]} | declare ^f-0001\n`,
		);
		await dep.coffre.ecrire('sources/note.md', `---\nid: 01N\ntype: source\ntype_source: note\nupdated: 2026-11-01\n---\n# Note\n\n## Contenu\n\n\`\`\`\nLe kangourou : api_key=${secrets[1]}\n\`\`\`\n`);
		expect((await chercher(dep, { texte: 'kangourou' })).length).toBeGreaterThan(0);
		dep.index.fermer();

		const brut = new DatabaseSync(fichier);
		const tables = (brut.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
		let lignes = 0;
		for (const table of tables) {
			for (const ligne of brut.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[]) {
				lignes++;
				for (const valeur of Object.values(ligne)) {
					const texte = (valeur instanceof Uint8Array ? Buffer.from(valeur).toString('latin1') : String(valeur)).toLowerCase();
					for (const secret of secrets) expect(texte, `${table}`).not.toContain(secret.toLowerCase().slice(4, 16));
				}
			}
		}
		brut.close();
		expect(lignes).toBeGreaterThan(10);
	});
});

describe('réservation entre processus', () => {
	it('une source réservée par un autre processus est sautée (anciens passages gardés) ; une réservation périmée est reprise', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/cdc.md', corps('quokka'));
		await dep.coffre.ecrire('sources/cdc.md', source('docs/cdc.md'));
		await synchroniser(dep);
		const maintenant = dep.systeme.maintenant().getTime();
		expect(await dep.index.reserverSources(['sources/cdc.md'], 'autre', maintenant, 600_000)).toEqual(['sources/cdc.md']);
		let extractions = 0;
		const reelle = dep.extraction;
		dep.extraction = { ...reelle, extraire: async (...a) => (extractions++, reelle.extraire(...a)) };
		dep.documents.deposer('docs/cdc.md', corps('wombat'));
		expect(await ids(dep, 'quokka')).toHaveLength(1);
		expect(extractions).toBe(0);
		// la réservation de l'autre processus date de plus de 10 min : reprise
		const horloge = dep.systeme.maintenant;
		dep.systeme.maintenant = () => new Date(horloge().getTime() + 11 * 60 * 1000);
		expect(await ids(dep, 'wombat')).toHaveLength(1);
		expect(extractions).toBe(1);
		expect(await dep.index.reserverSources(['sources/cdc.md'], 'tiers', maintenant, 600_000)).toEqual(['sources/cdc.md']);
	});

	it('index : réserver, refuser à un autre jeton, libérer', async () => {
		const index = ouvrirIndex(':memory:');
		expect(await index.reserverSources(['sources/a.md', 'sources/b.md'], 'j1', 1000, 600_000)).toEqual(['sources/a.md', 'sources/b.md']);
		expect(await index.reserverSources(['sources/a.md'], 'j2', 2000, 600_000)).toEqual([]);
		expect(await index.reserverSources(['sources/a.md'], 'j1', 2000, 600_000)).toEqual(['sources/a.md']);
		await index.libererSources(['sources/a.md'], 'j2');
		expect(await index.reserverSources(['sources/a.md'], 'j2', 3000, 600_000)).toEqual([]);
		await index.libererSources(['sources/a.md'], 'j1');
		expect(await index.reserverSources(['sources/a.md'], 'j2', 3000, 600_000)).toEqual(['sources/a.md']);
		await index.noterSource('sources/b.md', { descripteur: '{}', versionDe: null, mtimeMs: 1, taille: 1, empreinteFichier: 'e', etat: 'indexee', secrets: 0, avertissements: [] });
		expect(await index.reserverSources(['sources/b.md'], 'j2', 3000, 600_000)).toEqual(['sources/b.md']);
		index.fermer();
	});
});

describe('versions et chronologie', () => {
	it('une nouvelle version disparue ou illisible ne fait pas de l\'ancienne une « ancienne_version »', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/v1.md', corps('ornithorynque'));
		await dep.coffre.ecrire('sources/v1.md', source('docs/v1.md'));
		await dep.coffre.ecrire('sources/v2.md', source('docs/v2.md', 'version_de: "[[sources/v1]]"\n'));
		expect((await chercher(dep, { texte: 'ornithorynque' })).map((t) => t.statut)).toEqual(['servi']);
	});

	it('chronologie : les passages datés prennent leur place dans le temps', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/a.md', corps('okapi'));
		dep.documents.deposer('docs/b.md', corps('okapi'));
		await dep.coffre.ecrire('sources/a.md', source('docs/a.md', 'date: 2026-09-01\n'));
		await dep.coffre.ecrire('sources/b.md', source('docs/b.md', 'date: 2025-01-15\n'));
		await dep.coffre.ecrire('projets/p.md', fait('L\'okapi arrive au zoo', 'utilisateur oral'));
		const t = await chronologie(dep, 'okapi');
		expect(t.map((x) => [x.genre, x.date])).toEqual([
			['passage', '2025-01-15'],
			['passage', '2026-09-01'],
			['fait', '2026-11-20'],
		]);
	});
});

describe('recherche sans attente', () => {
	/** La recherche elle-même, sans synchronisation complète d'abord. */
	const seule = async (dep: Dependances, texte: string) => (await chercherSeul(dep, { texte })).map((t) => t.id);
	/** Extraction qui attend `barriere` avant d'extraire ; `appels` : extractions commencées. */
	function extractionRetenue(dep: Dependances) {
		let liberer!: () => void;
		const barriere = new Promise<void>((r) => (liberer = r));
		const reelle = dep.extraction;
		const suivi = { appels: 0, liberer };
		dep.extraction = { ...reelle, extraire: async (...a) => (suivi.appels++, await barriere, reelle.extraire(...a)) };
		return suivi;
	}

	it('une extraction longue ne retarde pas la recherche : index servi tel quel, puis à jour une fois la file d\'arrière-plan passée', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/cdc.md', corps('quokka'));
		await dep.coffre.ecrire('sources/cdc.md', source('docs/cdc.md'));
		await synchroniser(dep);
		const differee = extractionDifferee(dep);
		dep.extractionDifferee = differee;
		const retenue = extractionRetenue(dep);
		dep.documents.deposer('docs/cdc.md', corps('wombat'));
		const debut = performance.now();
		// l'extraction du document changé est bloquée : la recherche répond quand même, avec les anciens passages
		expect(await seule(dep, 'quokka')).toHaveLength(1);
		expect(await seule(dep, 'wombat')).toEqual([]);
		expect(performance.now() - debut).toBeLessThan(2000);
		expect(retenue.appels).toBe(1);
		retenue.liberer();
		await differee.calme();
		expect(await seule(dep, 'wombat')).toHaveLength(1);
		expect(await seule(dep, 'quokka')).toEqual([]);
		// des réveils pendant un tour n'en relancent qu'un ensuite : une seule extraction du document
		expect(retenue.appels).toBe(1);
	});

	it('avis « fils nouveaux » gardés d\'un tour à l\'autre : une recherche pendant l\'extraction n\'efface pas celui de la boîte relue', async () => {
		const dep = fauxPorts();
		const msg = (id: string, sujet: string, corps: string, h: number) =>
			`From x Mon Mar  2 1${h}:00:00 2026\nFrom: a@exemple.fr\nDate: Mon, 02 Mar 2026 1${h}:00:00 +0000\nSubject: ${sujet}\nMessage-ID: ${id}\nContent-Type: text/plain; charset=utf-8\n\n${corps}\n\n`;
		dep.documents.deposer('mails/b.mbox', msg('<a@x>', 'Tapir', 'Le tapir arrive lundi.', 0));
		expect(await extraireSource(dep, { chemin: 'mails/b.mbox' })).toMatchObject({ statut: 'ecrit' });
		const differee = extractionDifferee(dep);
		dep.extractionDifferee = differee;
		const retenue = extractionRetenue(dep);
		dep.documents.deposer('mails/b.mbox', msg('<a@x>', 'Tapir', 'Le tapir arrive lundi.', 0) + msg('<b@x>', 'Zèbre', 'Le zèbre part mardi.', 1));
		// première recherche : réveille le tour qui relit la boîte (retenu) ; la seconde, pendant ce tour, en demande un autre
		expect((await chercherAvecAvis(dep, { texte: 'tapir' })).avis).toEqual({});
		expect((await chercherAvecAvis(dep, { texte: 'tapir' })).avis).toEqual({});
		retenue.liberer();
		// le tour suivant ne relit plus rien (boîte à jour) : il n'efface pas l'avis du premier
		await differee.calme();
		expect((await chercherAvecAvis(dep, { texte: 'tapir' })).avis).toEqual({ 'sources/Tapir.md': '1 fil nouveau : relancer extraire_source' });
		await differee.calme();
		// rendu une fois
		expect((await chercherAvecAvis(dep, { texte: 'tapir' })).avis).toEqual({});
		expect(retenue.appels).toBe(1);
	});

	it('avis de la file gardés pour la recherche suivante quand une recherche est abandonnée (remplacée par une plus récente)', async () => {
		const dep = fauxPorts();
		const lus: Record<string, string>[] = [];
		let enFile: Record<string, string> = { 'sources/Tapir.md': '1 fil nouveau : relancer extraire_source' };
		dep.extractionDifferee = {
			reveiller() {},
			avis() {
				const a = enFile;
				enFile = {};
				lus.push(a);
				return a;
			},
		};
		const remplacee = new AbortController();
		const abandonnee = chercherAvecAvis(dep, { texte: 'tapir' }, { signal: remplacee.signal });
		remplacee.abort();
		await expect(abandonnee).rejects.toThrow();
		expect((await chercherAvecAvis(dep, { texte: 'tapir' })).avis).toEqual({ 'sources/Tapir.md': '1 fil nouveau : relancer extraire_source' });
		// rapide aussi
		enFile = { 'sources/B.md': '2 fils nouveaux : relancer extraire_source' };
		const autre = new AbortController();
		const rapide = chercherAvecAvis(dep, { texte: 'tapir' }, { rapide: true, signal: autre.signal });
		autre.abort();
		await expect(rapide).rejects.toThrow();
		expect((await chercherAvecAvis(dep, { texte: 'tapir' }, { rapide: true })).avis).toEqual({ 'sources/B.md': '2 fils nouveaux : relancer extraire_source' });
	});

	it('sans file d\'arrière-plan (CLI), la recherche n\'extrait rien', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/cdc.md', corps('quokka'));
		await dep.coffre.ecrire('sources/cdc.md', source('docs/cdc.md'));
		const retenue = extractionRetenue(dep);
		expect(await seule(dep, 'quokka')).toEqual([]);
		expect(retenue.appels).toBe(0);
	});

	it('réservation renouvelée pendant une extraction plus longue que sa péremption : aucune seconde extraction', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/cdc.md', corps('quokka'));
		await dep.coffre.ecrire('sources/cdc.md', source('docs/cdc.md'));
		await synchroniser(dep);
		const retenue = extractionRetenue(dep);
		dep.documents.deposer('docs/cdc.md', corps('wombat'));
		const premiere = synchroniser(dep, { extraire: true, renouvellementMs: 5 });
		while (retenue.appels === 0) await new Promise((r) => setTimeout(r, 5));
		// 11 min plus tard (péremption : 10 min) ; la réservation a été renouvelée entre-temps
		const horloge = dep.systeme.maintenant;
		dep.systeme.maintenant = () => new Date(horloge().getTime() + 11 * 60 * 1000);
		await new Promise((r) => setTimeout(r, 50));
		await synchroniser(dep);
		expect(retenue.appels).toBe(1);
		retenue.liberer();
		await premiere;
		expect(await seule(dep, 'wombat')).toHaveLength(1);
	});
});
