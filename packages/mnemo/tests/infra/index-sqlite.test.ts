import { execFile } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EtatSource, FicheIndexee, Index, PassageIndexe } from '../../src/application/ports.ts';
import { empreinte } from '../../src/domaine/empreinte.ts';
import { normaliser, prefixeIndexe, texteAVectoriser, VERSION_PREFIXE } from '../../src/domaine/sens.ts';
import { expressionFts } from '../../src/domaine/requete.ts';
import type { ElementIndexe } from '../../src/domaine/elements.ts';
import { coffreFichiers } from '../../src/infra/coffre-fichiers.ts';
import { ouvrirIndex, VERSION_SCHEMA } from '../../src/infra/index-sqlite.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

function element(id: string, texte: string, extra: Partial<ElementIndexe> = {}): ElementIndexe {
	const chemin = extra.chemin ?? id.split('#')[0]!;
	return {
		id, chemin, genre: id.includes('#') ? 'fait' : 'fiche', typeFiche: 'sujet', texte, contexte: '', statut: 'servi',
		date: null, valideFin: null, finIncluse: false, confiance: null, source: null, typeSource: null, categorie: null, niveau: null, portee: null, dossierProjet: null,
		...extra,
	};
}
const fiche = (chemin: string, n = 1): FicheIndexee => ({ chemin, empreinte: `e${n}`, mtimeMs: n, taille: n });
const contenu = (elements: ElementIndexe[], extra: { liens?: { de: string; vers: string; verbe: string | null }[]; alias?: string[]; titre?: string } = {}) => ({
	titre: extra.titre ?? 'Titre', elements, liens: extra.liens ?? [], alias: extra.alias ?? [], anomalies: [],
});

describe('index SQLite', () => {
	it('trouve sans accents ni casse, et par préfixe', async () => {
		const index = ouvrirIndex(':memory:');
		await index.remplacer(fiche('a.md'), contenu([element('a.md', 'Réunion du lundi')]));
		await index.remplacer(fiche('b.md'), contenu([element('b.md', 'Les inventaires annuels')]));
		expect((await index.chercher('"reunion"*', {}, 10)).map((e) => e.id)).toEqual(['a.md']);
		expect((await index.chercher('"inventaire"*', {}, 10)).map((e) => e.id)).toEqual(['b.md']);
		index.fermer();
	});

	it('restitue dossierProjet', async () => {
		const index = ouvrirIndex(':memory:');
		const f = element('a.md', 'Fiche', { dossierProjet: 'verdure/transport' });
		await index.remplacer(fiche('a.md'), contenu([f]));
		expect((await index.element('a.md'))?.dossierProjet).toBe('verdure/transport');
		index.fermer();
	});

	it('restitue exactement les éléments stockés', async () => {
		const index = ouvrirIndex(':memory:');
		const e = element('a.md#^x', 'Un fait', { contexte: 'a › A', statut: 'a_confirmer', date: '2026-01-02', valideFin: '2027-01-01', finIncluse: true, confiance: 0.8, source: 'email: x', typeSource: 'email', categorie: 'montant', niveau: null });
		const c = element('c.md', 'Consigne', { genre: 'consigne', niveau: 'regle' as ElementIndexe['niveau'], portee: 'globale' });
		await index.remplacer(fiche('a.md'), contenu([element('a.md', 'Fiche'), e]));
		await index.remplacer(fiche('c.md'), contenu([c]));
		expect(await index.element('a.md#^x')).toEqual(e);
		expect(await index.element('inconnu')).toBeNull();
		expect(await index.elements({ chemins: ['a.md'] })).toEqual([element('a.md', 'Fiche'), e]);
		expect(await index.element('c.md')).toEqual(c);
		index.fermer();
	});

	it('remplacer deux fois : pas de doublon ; retirer : plus trouvée ; liens entrants à jour', async () => {
		const index = ouvrirIndex(':memory:');
		const lien = { de: 'a.md', vers: 'b.md', verbe: null };
		await index.remplacer(fiche('a.md'), contenu([element('a.md', 'budget')], { liens: [lien] }));
		await index.remplacer(fiche('a.md', 2), contenu([element('a.md', 'budget')], { liens: [lien] }));
		expect(await index.chercher('"budget"*', {}, 10)).toHaveLength(1);
		expect(await index.fiches()).toEqual([{ ...fiche('a.md', 2), anomalies: [] }]);
		expect((await index.liens('b.md')).entrants).toEqual([lien]);
		expect((await index.liens('a.md')).sortants).toEqual([lien]);
		await index.retirer('a.md');
		expect(await index.chercher('"budget"*', {}, 10)).toEqual([]);
		expect((await index.liens('b.md')).entrants).toEqual([]);
		expect(await index.fiches()).toEqual([]);
		index.fermer();
	});

	it('tousLesLiens : tous les liens, par fiche d\'origine puis dans l\'ordre de la fiche', async () => {
		const index = ouvrirIndex(':memory:');
		const b1 = { de: 'b.md', vers: 'z.md', verbe: 'concerne' };
		const b2 = { de: 'b.md', vers: 'a.md', verbe: null };
		const a1 = { de: 'a.md', vers: 'b.md', verbe: null };
		await index.remplacer(fiche('b.md'), contenu([element('b.md', 'b')], { liens: [b1, b2] }));
		await index.remplacer(fiche('a.md'), contenu([element('a.md', 'a')], { liens: [a1] }));
		expect(await index.tousLesLiens()).toEqual([a1, b1, b2]);
		await index.retirer('b.md');
		expect(await index.tousLesLiens()).toEqual([a1]);
		index.fermer();
	});

	it('pondère le texte plus que le contexte', async () => {
		const index = ouvrirIndex(':memory:');
		await index.remplacer(fiche('a.md'), contenu([element('a.md', 'autre chose', { contexte: 'tarif' })]));
		await index.remplacer(fiche('b.md'), contenu([element('b.md', 'tarif', { contexte: 'autre chose' })]));
		expect((await index.chercher('"tarif"*', {}, 10)).map((e) => e.id)).toEqual(['b.md', 'a.md']);
		index.fermer();
	});

	it('filtre par périmètre (frontière de dossier), statuts, genres, types', async () => {
		const index = ouvrirIndex(':memory:');
		await index.remplacer(fiche('projets/a/a.md'), contenu([element('projets/a/a.md', 'mot')]));
		await index.remplacer(fiche('projets/a/x.md'), contenu([element('projets/a/x.md#^1', 'mot', { statut: 'invalide' })]));
		await index.remplacer(fiche('projets/ab/y.md'), contenu([element('projets/ab/y.md', 'mot', { typeFiche: 'entite' })]));
		const ids = async (f: Parameters<typeof index.chercher>[1]) => (await index.chercher('"mot"*', f, 10)).map((e) => e.id).sort();
		expect(await ids({ perimetre: 'projets/a' })).toEqual(['projets/a/a.md', 'projets/a/x.md#^1']);
		expect(await ids({ perimetre: 'projets/a/' })).toEqual(['projets/a/a.md', 'projets/a/x.md#^1']);
		expect(await ids({ statuts: ['servi'] })).toEqual(['projets/a/a.md', 'projets/ab/y.md']);
		expect(await ids({ genres: ['fait'] })).toEqual(['projets/a/x.md#^1']);
		expect(await ids({ typesFiche: ['entite'] })).toEqual(['projets/ab/y.md']);
		expect((await index.elements({ perimetre: 'projets/ab' })).map((e) => e.id)).toEqual(['projets/ab/y.md']);
		index.fermer();
	});

	it('alias : titre et alias se renvoient les uns aux autres', async () => {
		const index = ouvrirIndex(':memory:');
		await index.remplacer(fiche('a.md'), contenu([element('a.md', 'x')], { titre: 'Société Générale', alias: ['SG', 'Soc Gen'] }));
		await index.remplacer(fiche('b.md'), contenu([element('b.md', 'y')], { titre: 'Sans alias' }));
		const carte = await index.alias();
		expect(carte.get('societe generale')).toEqual(['SG', 'Soc Gen']);
		expect(carte.get('sg')).toEqual(['Société Générale', 'Soc Gen']);
		expect(carte.has('sans alias')).toBe(false);
		index.fermer();
	});

	it('user_version différent : reconstruit un index vide sans exception', async () => {
		const fichier = join(await dossierTemporaire(), 'index.sqlite');
		const premier = ouvrirIndex(fichier);
		await premier.remplacer(fiche('a.md'), contenu([element('a.md', 'x')]));
		premier.fermer();
		const brut = new DatabaseSync(fichier);
		brut.exec('PRAGMA user_version = 0');
		brut.close();
		const second = ouvrirIndex(fichier);
		expect(await second.fiches()).toEqual([]);
		await second.remplacer(fiche('b.md'), contenu([element('b.md', 'x')]));
		expect(await second.fiches()).toHaveLength(1);
		second.fermer();
	});

	it('fichier corrompu : reconstruit sans exception', async () => {
		const dossier = await dossierTemporaire();
		const fichier = join(dossier, 'index.sqlite');
		await writeFile(fichier, Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37 + 11) % 256)));
		const index = ouvrirIndex(fichier);
		expect(await index.fiches()).toEqual([]);
		index.fermer();
	});

	it('deux connexions, 2 × 50 remplacements entrelacés : aucune erreur, 100 fiches', async () => {
		const fichier = join(await dossierTemporaire(), 'index.sqlite');
		const a = ouvrirIndex(fichier);
		const b = ouvrirIndex(fichier);
		const lot = (index: typeof a, prefixe: string) =>
			Array.from({ length: 50 }, (_, i) => index.remplacer(fiche(`${prefixe}${i}.md`), contenu([element(`${prefixe}${i}.md`, `texte ${prefixe}${i}`)])));
		await Promise.all([...lot(a, 'a'), ...lot(b, 'b')]);
		expect(await a.fiches()).toHaveLength(100);
		expect(await b.elements({})).toHaveLength(100);
		a.fermer();
		b.fermer();
	});
});

describe('ouverture sûre', () => {
	it('4 processus ouvrent le même fichier neuf et écrivent 20 fiches chacun : tout sort à 0, 80 fiches', async () => {
		const fichier = join(await dossierTemporaire(), 'index.sqlite');
		const script = new URL('../aides/ecrire-index.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1');
		const lancer = promisify(execFile);
		await Promise.all(['a', 'b', 'c', 'd'].map((p) => lancer(process.execPath, [script, fichier, p, '20'])));
		const index = ouvrirIndex(fichier);
		expect(await index.fiches()).toHaveLength(80);
		index.fermer();
	});

	it('une autre version du schéma est reconstruite sur place, une connexion ouverte reste valide', async () => {
		const fichier = join(await dossierTemporaire(), 'index.sqlite');
		const ancien = new DatabaseSync(fichier);
		ancien.exec('PRAGMA journal_mode = WAL');
		ancien.exec("CREATE TABLE fiches (chemin TEXT, vieux TEXT); INSERT INTO fiches VALUES ('a.md', 'x'); PRAGMA user_version = 99");
		const avant = (await stat(fichier)).ino;
		const index = ouvrirIndex(fichier);
		expect(await index.fiches()).toEqual([]);
		await index.remplacer(fiche('b.md'), contenu([element('b.md', 'x')]));
		expect((await stat(fichier)).ino).toBe(avant);
		expect((ancien.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(VERSION_SCHEMA);
		expect((ancien.prepare('SELECT count(*) AS n FROM fiches').get() as { n: number }).n).toBe(1);
		ancien.close();
		index.fermer();
	});

	it('vider reconstruit sur place, alors qu\'une autre connexion reste ouverte : les deux continuent', async () => {
		const fichier = join(await dossierTemporaire(), 'index.sqlite');
		const a = ouvrirIndex(fichier);
		const b = ouvrirIndex(fichier);
		await a.remplacer(fiche('a.md'), contenu([element('a.md', 'licorne')]));
		await b.remplacer(fiche('b.md'), contenu([element('b.md', 'dragon')]));
		const avant = (await stat(fichier)).ino;
		await b.vider();
		expect((await stat(fichier)).ino).toBe(avant);
		expect(await a.fiches()).toEqual([]);
		expect(await a.chercher('"licorne"*', {}, 5)).toEqual([]);
		await a.remplacer(fiche('c.md'), contenu([element('c.md', 'griffon')]));
		await b.remplacer(fiche('d.md'), contenu([element('d.md', 'phenix')]));
		expect((await b.fiches()).map((f) => f.chemin)).toEqual(['c.md', 'd.md']);
		expect((await b.chercher('"griffon"*', {}, 5)).map((e) => e.id)).toEqual(['c.md']);
		expect(await a.elements({})).toHaveLength(2);
		a.fermer();
		b.fermer();
	});

	it('lecture seule : lit sous un verrou d\'écriture tenu ailleurs ; base verrouillée en exclusif : erreur avant finMs ; n\'écrit rien', async () => {
		const fichier = join(await dossierTemporaire(), 'index.sqlite');
		const ecrivain = ouvrirIndex(fichier);
		await ecrivain.remplacer(fiche('a.md'), contenu([element('a.md', 'licorne')]));
		ecrivain.fermer();
		const autre = new DatabaseSync(fichier);
		autre.exec('BEGIN IMMEDIATE');
		const lecteur = ouvrirIndex(fichier, { lectureSeule: { finMs: Date.now() + 200 } });
		expect((await lecteur.elements({})).map((e) => e.id)).toEqual(['a.md']);
		await expect(lecteur.remplacer(fiche('b.md'), contenu([element('b.md', 'x')]))).rejects.toThrow();
		lecteur.fermer();
		autre.exec('ROLLBACK');
		autre.exec('PRAGMA locking_mode = EXCLUSIVE');
		autre.exec('BEGIN EXCLUSIVE');
		autre.exec('UPDATE fiches SET taille = taille');
		autre.exec('COMMIT');
		const debut = Date.now();
		expect(() => ouvrirIndex(fichier, { lectureSeule: { finMs: debut + 150 } })).toThrow(/locked/u);
		expect(Date.now() - debut).toBeLessThan(150 + 100);
		autre.close();
	});

	it('lecture seule : index absent ou d\'une autre version → erreur, sans le créer ni le reconstruire', async () => {
		const dossier = await dossierTemporaire();
		const absent = join(dossier, 'absent.sqlite');
		expect(() => ouvrirIndex(absent, { lectureSeule: { finMs: Date.now() + 100 } })).toThrow(/Index absent/u);
		await expect(stat(absent)).rejects.toThrow();
		const ancien = join(dossier, 'ancien.sqlite');
		const base = new DatabaseSync(ancien);
		base.exec('CREATE TABLE fiches (chemin TEXT); PRAGMA user_version = 3');
		base.close();
		expect(() => ouvrirIndex(ancien, { lectureSeule: { finMs: Date.now() + 100 } })).toThrow(/version 3/u);
		const relu = new DatabaseSync(ancien);
		expect((relu.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3);
		relu.close();
	});

	it('recherche vide ou syntaxe FTS invalide : aucun résultat, pas d\'erreur', async () => {
		const index = ouvrirIndex(':memory:');
		await index.remplacer(fiche('a.md'), contenu([element('a.md', 'x')]));
		expect(await index.chercher('  ', {}, 5)).toEqual([]);
		expect(await index.chercher('"', {}, 5)).toEqual([]);
		index.fermer();
	});
});

describe('Coffre.etats', () => {
	it('chemins en « / », cachés exclus, mtime et taille présents', async () => {
		const racine = await dossierTemporaire();
		const coffre = coffreFichiers(racine);
		await coffre.ecrire('x/un.md', 'abc');
		await coffre.ecrire('y.md', 'é');
		await mkdir(join(racine, '.cache'), { recursive: true });
		await writeFile(join(racine, '.cache', 'z.md'), 'z');
		await writeFile(join(racine, 'x', 'note.txt'), 'z');
		const etats = await coffre.etats();
		expect(etats.map((e) => e.chemin)).toEqual(['x/un.md', 'y.md']);
		expect(etats.map((e) => e.taille)).toEqual([3, 2]);
		expect(etats.every((e) => e.mtimeMs > 0)).toBe(true);
	});
});

describe('index SQLite : passages et sources', () => {
	const passage = (ancre: string, texte: string, extra: Partial<PassageIndexe> = {}): PassageIndexe => ({
		ancre, texte, prefixe: 'Doc › Titre — sources/d.md', titres: ['Titre'], page: 2, position: 0, section: 0, typeSource: 'contrat', date: '2026-10-01', ...extra,
	});
	const SECTIONS = ['## Titre\n\nLa section entière'];
	const etat = (extra: Partial<EtatSource> = {}): Omit<EtatSource, 'fiche'> => ({
		descripteur: '{}', versionDe: null, parente: null, mtimeMs: 1, taille: 1, empreinteFichier: 'e', etat: 'indexee', secrets: 0, avertissements: [], ...extra,
	});

	it('version 14 du schéma (13 : portée déclarée par une fiche ; 14 : session et projet des épisodes) ; une version 3 est reconstruite sur place', async () => {
		expect(VERSION_SCHEMA).toBe(14);
		const fichier = join(await dossierTemporaire(), 'index.sqlite');
		const brut = new DatabaseSync(fichier);
		brut.exec("CREATE TABLE fiches (chemin TEXT PRIMARY KEY, empreinte TEXT, mtime_ms REAL, taille INTEGER, titre TEXT); INSERT INTO fiches VALUES ('a.md', 'x', 1, 1, 'A'); PRAGMA user_version = 3");
		brut.close();
		const index = ouvrirIndex(fichier);
		expect(await index.fiches()).toEqual([]);
		expect(await index.sources()).toEqual([]);
		index.fermer();
	});

	it('un index de la version 10 (sans racines) est reconstruit sans erreur ; ses vecteurs sont refaits une seule fois', async () => {
		const fichier = join(await dossierTemporaire(), 'index.sqlite');
		const premier = ouvrirIndex(fichier);
		await premier.remplacer(fiche('a.md'), contenu([element('a.md', 'Fiche'), element('a.md#^f', 'Un fait')]));
		await premier.remplacerPassages('sources/d.md', [passage('p-00000001', 'Le tapir')], SECTIONS, etat());
		const lot = await premier.aVectoriser('m', 10);
		await premier.enregistrerVecteurs('m', 2, lot.map((a) => ({ id: a.id, empreinte: a.empreinte, vecteur: new Float32Array([1, 0]) })));
		premier.fermer();
		// l'ancien schéma : tables FTS à deux colonnes, sans `ligne_contexte`
		const brut = new DatabaseSync(fichier);
		brut.exec('DROP TABLE elements_fts; CREATE VIRTUAL TABLE elements_fts USING fts5(texte, contexte); ALTER TABLE elements DROP COLUMN ligne_contexte; PRAGMA user_version = 10');
		brut.close();
		const second = ouvrirIndex(fichier);
		// tout est à refaire : la prochaine synchronisation relit les fiches et réextrait les documents
		expect(await second.fiches()).toEqual([]);
		expect(await second.nombreVecteurs('m')).toBe(0);
		await second.remplacer(fiche('a.md'), contenu([element('a.md', 'Fiche'), element('a.md#^f', 'Un fait')]));
		const refaire = await second.aVectoriser('m', 10);
		expect(refaire.map((a) => a.id)).toEqual(['a.md', 'a.md#^f']);
		await second.enregistrerVecteurs('m', 2, refaire.map((a) => ({ id: a.id, empreinte: a.empreinte, vecteur: new Float32Array([1, 0]) })));
		// puis incrémental : rien tant que rien ne change
		expect(await second.nombreAVectoriser('m')).toBe(0);
		await second.remplacer(fiche('a.md', 2), contenu([element('a.md', 'Fiche'), element('a.md#^f', 'Un fait')]));
		expect(await second.nombreAVectoriser('m')).toBe(0);
		second.fermer();
		const verif = new DatabaseSync(fichier);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_SCHEMA });
		verif.close();
	});

	it('ancresCommunes : nombre d\'ancres distinctes en commun, par source', async () => {
		const index = ouvrirIndex(':memory:');
		await index.remplacerPassages('sources/a.md', [passage('p-00000001', 'Le tapir'), passage('p-00000002', 'Le zèbre', { position: 1 })], SECTIONS, etat());
		await index.remplacerPassages('sources/b.md', [passage('p-00000002', 'Le zèbre')], SECTIONS, etat());
		expect(await index.ancresCommunes(['p-00000001', 'p-00000002', 'p-00000009'])).toEqual([
			{ fiche: 'sources/a.md', communes: 2 },
			{ fiche: 'sources/b.md', communes: 1 },
		]);
		expect(await index.ancresCommunes([])).toEqual([]);
		index.fermer();
	});

	it('remplacerPassages : trouvés par le texte et le préfixe, lus par id ; remplacés sans doublon ; retirés', async () => {
		const index = ouvrirIndex(':memory:');
		await index.remplacerPassages('sources/d.md', [passage('p-00000001', 'Le tapir boit'), passage('p-00000002', 'Le zèbre court', { position: 1, page: null })], SECTIONS, etat({ secrets: 2 }));
		const [t] = await index.chercher('"tapir"*', {}, 10);
		expect(t).toMatchObject({ id: 'sources/d.md#p-00000001', chemin: 'sources/d.md', genre: 'passage', typeFiche: 'source', statut: 'servi', typeSource: 'contrat', date: '2026-10-01', source: 'sources/d.md', contexte: 'Doc › Titre — sources/d.md' });
		expect((await index.chercher('"titre"*', {}, 10)).length).toBe(2);
		expect(await index.passage('sources/d.md#p-00000002')).toMatchObject({ ficheSource: 'sources/d.md', ancre: 'p-00000002', titres: ['Titre'], page: null, position: 1, section: '## Titre\n\nLa section entière', statut: 'servi' });
		expect(await index.sources()).toEqual([{ fiche: 'sources/d.md', ...etat({ secrets: 2 }), passages: 2 }]);

		await index.remplacerPassages('sources/d.md', [passage('p-00000003', 'Le tapir dort')], SECTIONS, etat());
		expect((await index.chercher('"tapir"*', {}, 10)).map((e) => e.id)).toEqual(['sources/d.md#p-00000003']);
		expect(await index.passage('sources/d.md#p-00000001')).toBeNull();

		await index.retirerPassages('sources/d.md', etat({ etat: 'disparue' }));
		expect(await index.chercher('"tapir"*', {}, 10)).toEqual([]);
		expect((await index.sources())[0]).toMatchObject({ etat: 'disparue', passages: 0 });
		await index.retirerPassages('sources/d.md');
		expect(await index.sources()).toEqual([]);
		index.fermer();
	});

	it('genres, périmètre et statuts filtrent aussi les passages ; passages et éléments fusionnés par pertinence', async () => {
		const index = ouvrirIndex(':memory:');
		await index.remplacer(fiche('a.md'), contenu([element('a.md', 'Le tapir de la fiche')]));
		await index.remplacerPassages('sources/d.md', [passage('p-00000001', 'Le tapir du document')], SECTIONS, etat());
		expect((await index.chercher('"tapir"*', {}, 10)).map((e) => e.genre).sort()).toEqual(['fiche', 'passage']);
		expect((await index.chercher('"tapir"*', { genres: ['passage'] }, 10)).map((e) => e.genre)).toEqual(['passage']);
		expect((await index.chercher('"tapir"*', { genres: ['fiche'] }, 10)).map((e) => e.genre)).toEqual(['fiche']);
		expect((await index.chercher('"tapir"*', { perimetre: 'sources' }, 10)).map((e) => e.id)).toEqual(['sources/d.md#p-00000001']);
		expect((await index.chercher('"tapir"*', {}, 1)).length).toBe(1);
		expect(await index.chercher('"tapir"*', { genres: ['passage'], statuts: ['ancienne_version'] }, 10)).toEqual([]);
		index.fermer();
	});

	it('statuts dérivés : ancienne_version (version_de) et source_disparue (fait citant une source disparue)', async () => {
		const index = ouvrirIndex(':memory:');
		await index.remplacerPassages('sources/v1.md', [passage('p-00000001', 'Le tapir v1')], SECTIONS, etat());
		await index.remplacerPassages('sources/v2.md', [passage('p-00000002', 'Le tapir v2')], SECTIONS, etat({ versionDe: 'sources/v1.md' }));
		const statuts = Object.fromEntries((await index.chercher('"tapir"*', {}, 10)).map((e) => [e.chemin, e.statut]));
		expect(statuts).toEqual({ 'sources/v1.md': 'ancienne_version', 'sources/v2.md': 'servi' });
		expect((await index.passage('sources/v1.md#p-00000001'))!.statut).toBe('ancienne_version');

		await index.remplacer(fiche('p.md'), contenu([element('p.md#^f-0001', 'Le tapir arrive', { ficheCitee: 'sources/v2.md' }), element('p.md#^f-0002', 'Le tapir part', { ficheCitee: 'sources/v2.md', statut: 'a_confirmer' })]));
		expect((await index.element('p.md#^f-0001'))!.statut).toBe('servi');
		await index.retirerPassages('sources/v2.md', etat({ etat: 'disparue', versionDe: 'sources/v1.md' }));
		expect((await index.element('p.md#^f-0001'))!.statut).toBe('source_disparue');
		expect((await index.element('p.md#^f-0002'))!.statut).toBe('a_confirmer');
		expect((await index.elements({ statuts: ['source_disparue'] })).map((e) => e.id)).toEqual(['p.md#^f-0001']);
		expect((await index.element('p.md#^f-0001'))).not.toHaveProperty('ficheCitee');
		index.fermer();
	});

	it('retirer une fiche source emporte ses passages et son état ; vider aussi', async () => {
		const index = ouvrirIndex(':memory:');
		await index.remplacer(fiche('sources/d.md'), contenu([element('sources/d.md', 'Doc', { typeFiche: 'source' })]));
		await index.remplacerPassages('sources/d.md', [passage('p-00000001', 'Le tapir')], SECTIONS, etat());
		await index.retirer('sources/d.md');
		expect(await index.chercher('"tapir"*', {}, 10)).toEqual([]);
		expect(await index.sources()).toEqual([]);
		await index.remplacerPassages('sources/d.md', [passage('p-00000001', 'Le tapir')], SECTIONS, etat());
		await index.vider();
		expect(await index.chercher('"tapir"*', {}, 10)).toEqual([]);
		index.fermer();
	});
});

describe('index SQLite : vecteurs', () => {
	const M = 'faux@1';
	const passage = (ancre: string, texte: string, extra: Partial<PassageIndexe> = {}): PassageIndexe => ({
		ancre, texte, prefixe: 'Doc › Titre', titres: ['Titre'], page: null, position: 0, section: 0, typeSource: 'contrat', date: null, ...extra,
	});
	const etat = (extra: Partial<EtatSource> = {}): Omit<EtatSource, 'fiche'> => ({
		descripteur: '{}', versionDe: null, parente: null, mtimeMs: 1, taille: 1, empreinteFichier: 'e', etat: 'indexee', secrets: 0, avertissements: [], ...extra,
	});
	/** Vecteur unitaire de dimension `d` dirigé selon l'axe `axe` (et un peu `voisin`). */
	const axe = (i: number, d = 4, poids: number[] = []): Float32Array => {
		const v = new Float32Array(d);
		v[i] = 1;
		poids.forEach((p, j) => (v[j] = (v[j] ?? 0) + p));
		return normaliser(v);
	};
	/** Enregistre pour chaque à-vectoriser le vecteur donné par `vecteurDe(id)`. */
	const toutVectoriser = async (index: Index, vecteurDe: (id: string) => Float32Array, modele = M): Promise<string[]> => {
		const lot = await index.aVectoriser(modele, 1000);
		const d = vecteurDe(lot[0]!.id).length;
		await index.enregistrerVecteurs(modele, d, lot.map((a) => ({ id: a.id, empreinte: a.empreinte, vecteur: vecteurDe(a.id) })));
		return lot.map((a) => a.id);
	};
	const memoire = async (index: Index): Promise<void> => {
		await index.remplacer(fiche('p/a.md'), contenu([
			element('p/a.md', 'A\n\nSynthèse'),
			element('p/a.md#^f-1', 'Le tapir boit', { genre: 'fait' }),
			element('p/a.md#^f-2', 'Le tapir dort', { genre: 'fait', statut: 'a_confirmer' }),
			element('p/a.md#^f-3', 'Le tapir barré', { genre: 'fait', statut: 'invalide' }),
		], { titre: 'Titre A' }));
		await index.remplacer(fiche('c.md'), contenu([element('c.md', 'Toujours vérifier', { genre: 'consigne', portee: 'globale' })], { titre: 'Consigne C' }));
		await index.remplacerPassages('sources/d.md', [passage('p-00000001', 'Un passage'), passage('p-00000002', 'Un autre', { position: 1 })], [''], etat());
	};

	it('aVectoriser : éléments (hors invalides) puis passages, par id ; texte = préfixe + texte ; empreinte du texte', async () => {
		const index = ouvrirIndex(':memory:');
		await memoire(index);
		const lot = await index.aVectoriser(M, 100);
		expect(lot.map((a) => a.id)).toEqual(['c.md', 'p/a.md', 'p/a.md#^f-1', 'p/a.md#^f-2', 'sources/d.md#p-00000001', 'sources/d.md#p-00000002']);
		const parId = new Map(lot.map((a) => [a.id, a]));
		expect(parId.get('p/a.md#^f-1')!.texte).toBe(texteAVectoriser('Titre A', 'Le tapir boit'));
		expect(parId.get('c.md')!.texte).toBe(texteAVectoriser('Consigne C', 'Toujours vérifier'));
		expect(parId.get('sources/d.md#p-00000002')!.texte).toBe(texteAVectoriser('Doc › Titre', 'Un autre'));
		// l'empreinte porte la version du préfixe : une autre façon de bâtir le préfixe rend les vecteurs périmés
		for (const a of lot) expect(a.empreinte).toBe(empreinte(`${VERSION_PREFIXE}\u0000${a.texte}`));
		expect((await index.aVectoriser(M, 2)).map((a) => a.id)).toEqual(['c.md', 'p/a.md']);
		expect(await index.nombreAVectoriser(M)).toBe(6);
		index.fermer();
	});

	it('vecteurs enregistrés : plus rien à faire ; texte modifié ou autre modèle : à refaire ; id inconnu ignoré', async () => {
		const index = ouvrirIndex(':memory:');
		await memoire(index);
		await toutVectoriser(index, () => axe(0));
		expect(await index.aVectoriser(M, 100)).toEqual([]);
		expect(await index.nombreAVectoriser(M)).toBe(0);
		// même contenu réindexé (horodatage seul) : vecteurs gardés
		await index.remplacer(fiche('c.md', 2), contenu([element('c.md', 'Toujours vérifier', { genre: 'consigne', portee: 'globale' })], { titre: 'Consigne C' }));
		expect(await index.aVectoriser(M, 100)).toEqual([]);
		// texte modifié, ou titre de la fiche modifié
		await index.remplacer(fiche('c.md', 3), contenu([element('c.md', 'Toujours relire', { genre: 'consigne', portee: 'globale' })], { titre: 'Consigne C' }));
		expect((await index.aVectoriser(M, 100)).map((a) => a.id)).toEqual(['c.md']);
		// autre modèle : tout est à refaire
		expect(await index.aVectoriser('autre@2', 100)).toHaveLength(6);
		// id inconnu : rien n'est écrit
		await index.enregistrerVecteurs(M, 4, [{ id: 'inconnu.md', empreinte: 'x', vecteur: axe(0) }]);
		expect(await index.plusProches(M, axe(0), {}, 50)).not.toContainEqual(expect.objectContaining({ id: 'inconnu.md' }));
		index.fermer();
	});

	it('cacheVecteurs : froid jusqu’au premier parcours de ce modèle, chaud ensuite ; nombreVecteurs compte ceux du modèle', async () => {
		const index = ouvrirIndex(':memory:');
		await memoire(index);
		expect(index.cacheVecteurs(M)).toBe('froid');
		expect(await index.nombreVecteurs(M)).toBe(0);
		await toutVectoriser(index, () => axe(0));
		expect(await index.nombreVecteurs(M)).toBe(6);
		expect(await index.nombreVecteurs('autre@2')).toBe(0);
		expect(index.cacheVecteurs(M)).toBe('froid');
		await index.plusProches(M, axe(0), {}, 5);
		expect(index.cacheVecteurs(M)).toBe('chaud');
		expect(index.cacheVecteurs('autre@2')).toBe('froid');
		index.fermer();
	});

	it('plusProches : filtre de chercher (statuts, périmètre, genres) ; autre modèle, autre texte, autre dimension ignorés', async () => {
		const index = ouvrirIndex(':memory:');
		await memoire(index);
		const ids = ['c.md', 'p/a.md', 'p/a.md#^f-1', 'p/a.md#^f-2', 'sources/d.md#p-00000001', 'sources/d.md#p-00000002'];
		await toutVectoriser(index, (id) => axe(0, 8, [0, ids.indexOf(id) * 0.1]));
		const requete = axe(0, 8);
		const tous = await index.plusProches(M, requete, {}, 10);
		expect(tous.map((v) => v.id)).toEqual(ids);
		expect(tous[0]!.similarite).toBeCloseTo(1, 5);
		expect((await index.plusProches(M, requete, {}, 2)).map((v) => v.id)).toEqual(['c.md', 'p/a.md']);
		expect((await index.plusProches(M, requete, { statuts: ['servi'] }, 10)).map((v) => v.id)).not.toContain('p/a.md#^f-2');
		expect((await index.plusProches(M, requete, { perimetre: 'p' }, 10)).map((v) => v.id)).toEqual(['p/a.md', 'p/a.md#^f-1', 'p/a.md#^f-2']);
		expect((await index.plusProches(M, requete, { genres: ['passage'] }, 10)).map((v) => v.id)).toEqual(['sources/d.md#p-00000001', 'sources/d.md#p-00000002']);
		expect((await index.plusProches(M, requete, { genres: ['fait', 'consigne'] }, 10)).map((v) => v.id)).toEqual(['c.md', 'p/a.md#^f-1', 'p/a.md#^f-2']);
		// autre modèle : rien ; autre dimension : rien
		expect(await index.plusProches('autre@2', requete, {}, 10)).toEqual([]);
		expect(await index.plusProches(M, axe(0, 4), {}, 10)).toEqual([]);
		// texte modifié sans nouveau vecteur : l'ancien n'est plus utilisé
		await index.remplacer(fiche('c.md', 2), contenu([element('c.md', 'Toujours relire', { genre: 'consigne', portee: 'globale' })], { titre: 'Consigne C' }));
		expect((await index.plusProches(M, requete, {}, 10)).map((v) => v.id)).not.toContain('c.md');
		// un vecteur d'une autre dimension pour un élément : jamais comparé à la requête
		const [c] = await index.aVectoriser(M, 1);
		await index.enregistrerVecteurs(M, 4, [{ id: c!.id, empreinte: c!.empreinte, vecteur: axe(0, 4) }]);
		expect((await index.plusProches(M, requete, {}, 10)).map((v) => v.id)).not.toContain('c.md');
		expect((await index.plusProches(M, axe(0, 4), {}, 10)).map((v) => v.id)).toEqual(['c.md']);
		index.fermer();
	});

	it('retirer, remplacerPassages, retirerPassages, vider emportent les vecteurs', async () => {
		const fichier = join(await dossierTemporaire(), 'index.sqlite');
		const index = ouvrirIndex(fichier);
		const brut = new DatabaseSync(fichier);
		const ids = () => (brut.prepare('SELECT id FROM vecteurs ORDER BY id').all() as { id: string }[]).map((l) => l.id);
		await memoire(index);
		await toutVectoriser(index, () => axe(1));
		expect(ids()).toHaveLength(6);
		await index.remplacer(fiche('p/a.md', 2), contenu([element('p/a.md', 'A\n\nSynthèse'), element('p/a.md#^f-1', 'Le tapir boit', { genre: 'fait' })], { titre: 'Titre A' }));
		expect(ids()).toEqual(['c.md', 'p/a.md', 'p/a.md#^f-1', 'sources/d.md#p-00000001', 'sources/d.md#p-00000002']);
		await index.retirer('p/a.md');
		expect(ids()).toEqual(['c.md', 'sources/d.md#p-00000001', 'sources/d.md#p-00000002']);
		await index.remplacerPassages('sources/d.md', [passage('p-00000001', 'Un passage'), passage('p-00000003', 'Neuf')], [''], etat());
		expect(ids()).toEqual(['c.md', 'sources/d.md#p-00000001']);
		await index.retirerPassages('sources/d.md', etat({ etat: 'disparue' }));
		expect(ids()).toEqual(['c.md']);
		await index.vider();
		expect(ids()).toEqual([]);
		brut.close();
		index.fermer();
	});

	it('cache du processus : les écritures d\'une autre connexion sont vues', async () => {
		const fichier = join(await dossierTemporaire(), 'index.sqlite');
		const a = ouvrirIndex(fichier);
		const b = ouvrirIndex(fichier);
		await memoire(b);
		await toutVectoriser(b, () => axe(1));
		expect((await a.plusProches(M, axe(1), {}, 1))[0]!.similarite).toBeCloseTo(1, 5);
		expect((await a.plusProches(M, axe(0), {}, 1))[0]!.similarite).toBeCloseTo(0, 5);
		// b recalcule c.md (autre modèle puis retour au premier) : a voit le nouveau vecteur
		const [c] = (await b.aVectoriser('autre@2', 100)).filter((x) => x.id === 'c.md');
		await b.enregistrerVecteurs(M, 4, [{ id: 'c.md', empreinte: c!.empreinte, vecteur: axe(0) }]);
		expect(await a.plusProches(M, axe(0), {}, 1)).toEqual([{ id: 'c.md', similarite: expect.closeTo(1, 5), genre: 'consigne' }]);
		// b retire un élément puis le recrée sans vecteur : a ne sert pas l'ancien
		await b.retirer('c.md');
		await b.remplacer(fiche('c.md'), contenu([element('c.md', 'Toujours vérifier', { genre: 'consigne', portee: 'globale' })], { titre: 'Consigne C' }));
		expect((await a.plusProches(M, axe(0), {}, 10)).map((v) => v.id)).not.toContain('c.md');
		// b vide l'index puis réécrit : a repart de zéro
		await b.vider();
		expect(await a.plusProches(M, axe(1), {}, 10)).toEqual([]);
		await memoire(b);
		await toutVectoriser(b, () => axe(2));
		expect((await a.plusProches(M, axe(2), {}, 10)).map((v) => v.similarite)).toEqual(Array(6).fill(expect.closeTo(1, 5)));
		a.fermer();
		b.fermer();
	});

	it('50 000 vecteurs de 1 024 : plusProches < 300 ms (2 000 ms sur la CI), cache chaud', { timeout: 120_000 }, async () => {
		const index = ouvrirIndex(':memory:');
		const D = 1024;
		const SOURCES = 50;
		const PAR_SOURCE = 1000;
		for (let s = 0; s < SOURCES; s++) {
			const passages = Array.from({ length: PAR_SOURCE }, (_, i) => passage(`p-${String(i).padStart(8, '0')}`, `passage ${s} ${i}`, { position: i }));
			await index.remplacerPassages(`sources/s${s}.md`, passages, [''], etat());
		}
		let graine = 1;
		const hasard = () => ((graine = (graine * 1103515245 + 12345) >>> 0) / 4294967296) - 0.5;
		for (;;) {
			const lot = await index.aVectoriser(M, 5000);
			if (lot.length === 0) break;
			await index.enregistrerVecteurs(M, D, lot.map((a) => ({ id: a.id, empreinte: a.empreinte, vecteur: normaliser(Float32Array.from({ length: D }, hasard)) })));
		}
		const requete = normaliser(Float32Array.from({ length: D }, hasard));
		const froid = await index.plusProches(M, requete, { statuts: ['servi', 'source_disparue', 'ancienne_version'] }, 50);
		const t1 = performance.now();
		const chaud = await index.plusProches(M, requete, { statuts: ['servi', 'source_disparue', 'ancienne_version'] }, 50);
		const duree = performance.now() - t1;
		expect(chaud).toHaveLength(50);
		expect(chaud).toEqual(froid);
		expect(duree).toBeLessThan(process.env.CI ? 2000 : 300);
		index.fermer();
	});
});

describe('index SQLite : racines françaises et ligne de contexte', () => {
	const passageDoc = (ancre: string, texte: string, extra: Partial<PassageIndexe> = {}): PassageIndexe => ({
		ancre, texte, prefixe: 'Manuel › Exploitation', titres: ['Exploitation'], page: null, position: 0, section: 0, typeSource: 'note', date: null, ...extra,
	});
	const etatIndexe: Omit<EtatSource, 'fiche'> = { descripteur: '{}', versionDe: null, parente: null, mtimeMs: 1, taille: 1, empreinteFichier: 'e', etat: 'indexee', secrets: 0, avertissements: [] };

	it('« déploiement » trouve un texte qui ne contient que « déployer » (fiches et documents) ; l\'exact est classé avant le fléchi', async () => {
		const index = ouvrirIndex(':memory:');
		await index.remplacer(fiche('flechi.md'), contenu([element('flechi.md', 'On peut déployer le soir')]));
		await index.remplacer(fiche('exact.md'), contenu([element('exact.md', 'Le déploiement est le soir')]));
		await index.remplacerPassages('sources/d.md', [passageDoc('p-00000001', 'Ne pas déployer le vendredi')], ['s'], etatIndexe);
		const { toutes } = expressionFts('déploiement')!;
		const [premier, ...flechis] = (await index.chercher(toutes, {}, 10)).map((e) => e.id);
		expect(premier).toBe('exact.md');
		expect(flechis.sort()).toEqual(['flechi.md', 'sources/d.md#p-00000001']);
		expect((await index.chercher(expressionFts('configurer')!.toutes, {}, 10))).toEqual([]);
		index.fermer();
	});

	it('un identifiant de code n\'est pas racinisé : « déployer » ne trouve pas `deploiement_auto`', async () => {
		const index = ouvrirIndex(':memory:');
		await index.remplacer(fiche('a.md'), contenu([element('a.md', 'Lancer deploiement_auto chaque nuit')]));
		expect(await index.chercher(expressionFts('déployer')!.toutes, {}, 10)).toEqual([]);
		// le texte exact le trouve toujours
		expect((await index.chercher(expressionFts('deploiement_auto')!.toutes, {}, 10)).map((e) => e.id)).toEqual(['a.md']);
		index.fermer();
	});

	it('la ligne de contexte d\'un passage est cherchée et vectorisée, jamais rendue', async () => {
		const index = ouvrirIndex(':memory:');
		const p = element('a.md#notes', 'Le serveur est chez Ovh.', { genre: 'passage', contexte: 'Projet › Notes', ligneContexte: 'Projet Héron pour la Mutuelle' });
		await index.remplacer(fiche('a.md'), contenu([element('a.md', 'Projet'), p]));
		await index.remplacerPassages('sources/d.md', [passageDoc('p-00000001', 'Restaurer la sauvegarde', { ligneContexte: 'Passation de l\'extranet' })], ['s'], etatIndexe);
		expect((await index.chercher(expressionFts('héron mutuelle serveur')!.toutes, {}, 10)).map((e) => e.id)).toEqual(['a.md#notes']);
		expect((await index.chercher(expressionFts('extranet sauvegarde')!.toutes, {}, 10)).map((e) => e.id)).toEqual(['sources/d.md#p-00000001']);
		const lu = (await index.element('a.md#notes'))!;
		expect(lu.contexte).toBe('Projet › Notes');
		expect(lu.texte).toBe('Le serveur est chez Ovh.');
		expect((await index.elementsParId(['sources/d.md#p-00000001']))[0]!.contexte).toBe('Manuel › Exploitation');
		const textes = (await index.aVectoriser('m', 10)).map((a) => a.texte);
		expect(textes).toContain(texteAVectoriser(prefixeIndexe('Projet › Notes', 'Projet Héron pour la Mutuelle'), 'Le serveur est chez Ovh.'));
		expect(textes).toContain(texteAVectoriser(prefixeIndexe('Manuel › Exploitation', 'Passation de l\'extranet'), 'Restaurer la sauvegarde'));
		index.fermer();
	});

	it('correspondParLeTexte : les éléments dont le texte même (formes exactes ou racines) a un mot de la recherche, pas la seule ligne de contexte', async () => {
		const index = ouvrirIndex(':memory:');
		const p = (id: string, texte: string) => element(id, texte, { genre: 'passage', contexte: 'Projet › Notes', ligneContexte: 'Projet Héron pour la Mutuelle' });
		await index.remplacer(fiche('a.md'), contenu([element('a.md', 'Projet'), p('a.md#notes~1', 'Le serveur est chez Ovh.'), p('a.md#notes~2', 'On peut déployer le soir.')]));
		await index.remplacerPassages(
			'sources/d.md',
			[passageDoc('p-00000001', 'Le tamanoir mange des termites'), passageDoc('p-00000002', 'Annexe sur le tatou', { position: 1 })].map((x) => ({ ...x, ligneContexte: 'Notice du tamanoir' })),
			['s'],
			etatIndexe,
		);
		const tous = ['a.md#notes~1', 'a.md#notes~2', 'sources/d.md#p-00000001', 'sources/d.md#p-00000002'];
		// « héron » n'est que dans la ligne de contexte ; « déploiement » trouve « déployer » par sa racine
		expect([...(await index.correspondParLeTexte(expressionFts('héron déploiement')!.une, tous))]).toEqual(['a.md#notes~2']);
		expect([...(await index.correspondParLeTexte(expressionFts('tamanoir')!.une, tous))]).toEqual(['sources/d.md#p-00000001']);
		// la recherche, elle, trouve aussi l'annexe par la ligne de contexte
		expect((await index.chercher(expressionFts('tamanoir')!.une, {}, 10)).map((e) => e.id)).toContain('sources/d.md#p-00000002');
		expect(await index.correspondParLeTexte(expressionFts('tamanoir')!.une, [])).toEqual(new Set());
		// les titres ancêtres (préfixe « Doc › Section ») comptent, eux, comme le texte
		expect([...(await index.correspondParLeTexte(expressionFts('exploitation notes')!.une, tous))].sort()).toEqual(tous);
		index.fermer();
	});

	it('passagesDeSection : les passages de la section d\'un passage, dans l\'ordre (documents : même rang de section ; fiches : même contexte)', async () => {
		const index = ouvrirIndex(':memory:');
		await index.remplacerPassages(
			'sources/d.md',
			[
				passageDoc('p-00000001', 'Un', { position: 0, section: 0 }),
				passageDoc('p-00000002', 'Deux', { position: 1, section: 1 }),
				passageDoc('p-00000003', 'Trois', { position: 2, section: 1 }),
			],
			['s0', 's1'],
			etatIndexe,
		);
		const section = await index.passagesDeSection('sources/d.md#p-00000003');
		expect(section!.passages).toEqual([{ id: 'sources/d.md#p-00000002', texte: 'Deux' }, { id: 'sources/d.md#p-00000003', texte: 'Trois' }]);
		expect((await index.passagesDeSection('sources/d.md#p-00000002'))!.cle).toBe(section!.cle);
		expect((await index.passagesDeSection('sources/d.md#p-00000001'))!.cle).not.toBe(section!.cle);
		const passageFiche = (id: string, texte: string, contexte: string) => element(id, texte, { genre: 'passage', contexte });
		await index.remplacer(fiche('f.md'), contenu([element('f.md', 'F'), passageFiche('f.md#a~1', 'A1', 'F › A'), passageFiche('f.md#b', 'B', 'F › B'), passageFiche('f.md#a~2', 'A2', 'F › A')]));
		expect((await index.passagesDeSection('f.md#a~2'))!.passages.map((p) => p.id)).toEqual(['f.md#a~1', 'f.md#a~2']);
		expect(await index.passagesDeSection('f.md#^f-1')).toBeNull();
		expect(await index.passagesDeSection('inconnu.md#p-1')).toBeNull();
		index.fermer();
	});
});
