import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { avertissementIndex } from '../../src/application/synchroniser.ts';
import { contenuEnMemoire } from '../../src/application/contenu.ts';
import { chercher } from '../../src/application/chercher.ts';
import { extraireSource } from '../../src/application/extraire-source.ts';
import { TAILLE_MAX_DOCUMENT } from '@mnemo/commun';
import type { Dependances } from '../../src/application/ports.ts';
import { decouperFichier } from '../../src/application/extraire-passages.ts';
import { lireElement } from '../../src/application/lire.ts';
import { synchroniser } from '../../src/application/synchroniser.ts';
import { validerDemandeSource } from '../../src/application/validation.ts';
import { empreinteOctets } from '../../src/domaine/empreinte.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { ECHANTILLON_NATURE } from '@mnemo/commun';
import { fichiersDossier } from '../../src/infra/fichiers-dossier.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { pdfDePages } from '../aides/pdf.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const FIXTURES = join(import.meta.dirname, '../fixtures/documents');

/** Un document Markdown de `n` sections d'environ 1 200 caractères : un passage par section. */
function document(n = 20, modifiees: number[] = [], titre = 'Cahier des charges'): string {
	const sections = Array.from({ length: n }, (_, i) => {
		const mot = modifiees.includes(i) ? `remanie${i}` : `section${i}`;
		return `## Partie ${i}\n\nLe ${mot} décrit le besoin numéro ${i} du zoo. ${`Phrase de remplissage ${i} pour atteindre la taille d'un passage. `.repeat(18)}`;
	});
	return `# ${titre}\n\n${sections.join('\n\n')}\n`;
}

function message(o: { id: string; sujet: string; corps: string; reponseA?: string; date?: string }): string {
	return [
		'From: Marc Dupont <marc@exemple.fr>',
		`Date: ${o.date ?? 'Mon, 02 Mar 2026 10:00:00 +0000'}`,
		`Subject: ${o.sujet}`,
		`Message-ID: ${o.id}`,
		...(o.reponseA ? [`In-Reply-To: ${o.reponseA}`] : []),
		'Content-Type: text/plain; charset=utf-8',
		'',
		o.corps,
		'',
	].join('\n');
}
const enMbox = (msgs: string[]) => msgs.map((m, i) => `From MAILER-DAEMON Mon Mar  2 10:0${i}:00 2026\n${m}\n`).join('');

const frontmatter = (dep: ReturnType<typeof fauxPorts>, chemin: string) => lireFiche(chemin, dep.fichiers.get(chemin)!).donnees;
/** Documents extraits (synchronisation complète : la recherche ne l'attend pas), puis cherchés. */
const ids = async (dep: Dependances, texte: string) => (await synchroniser(dep), await chercher(dep, { texte, genres: ['passage'] })).map((t) => t.id);

describe('extraireSource', () => {
	it('document md → fiche source (jamais copié), passages indexés, un commit ; extrait une seule fois', async () => {
		const dep = fauxPorts();
		const reelle = dep.extraction;
		const appels: string[] = [];
		dep.extraction = {
			extraire: async (...a) => (appels.push('extraire'), reelle.extraire(...a)),
			decouper: async (...a) => (appels.push('decouper'), reelle.decouper(...a)),
		};
		dep.documents.deposer('docs/cdc.md', document());
		const r = await extraireSource(dep, { chemin: 'docs/cdc.md' });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'sources/Cahier des charges.md', passages: 20, secrets: 0, filles: [], commit: 'c000001' });
		expect(r).not.toHaveProperty('avertissements');
		expect(r).not.toHaveProperty('indexe');
		expect(appels).toEqual(['decouper']);
		expect(dep.commits).toEqual([{ message: 'mnemo: source sources/Cahier des charges.md', chemins: ['sources/Cahier des charges.md', 'sources/sources.md'] }]);
		const fiche = lireFiche('sources/Cahier des charges.md', dep.fichiers.get('sources/Cahier des charges.md')!);
		expect(fiche).toMatchObject({ type: 'source', titre: 'Cahier des charges', synthese: '' });
		expect(fiche.donnees).toMatchObject({ chemin: 'docs/cdc.md', format: 'markdown', type_source: 'inconnue' });
		expect(fiche.donnees['empreinte']).toMatch(/^[0-9a-f]{16}$/u);
		expect(dep.fichiers.get('sources/Cahier des charges.md')).not.toContain('Phrase de remplissage');
		expect(await ids(dep, 'section7')).toEqual([expect.stringMatching(/^sources\/Cahier des charges\.md#p-[0-9a-f]{8}$/u)]);
		expect(appels).toEqual(['decouper']);
	});

	it('document dans un dossier caché (.notes/, Clients/.archives/) → fiche source, comme ailleurs', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('.notes/cr.md', document(2, [], 'Compte rendu'));
		dep.documents.deposer('Clients/.archives/devis.md', '# Devis\n\nLe devis du tapir pour la volière.\n');
		expect(await extraireSource(dep, { chemin: '.notes/cr.md' })).toMatchObject({ statut: 'ecrit', fiche: 'sources/Compte rendu.md' });
		expect(await extraireSource(dep, { chemin: 'Clients/.archives/devis.md' })).toMatchObject({ statut: 'ecrit', fiche: 'sources/Devis.md' });
	});

	it('la synchronisation qui suit n\'extrait que les sources écrites (pas un autre document en attente)', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/autre.md', '# Autre\n\nLe wombat.\n');
		await dep.coffre.ecrire('sources/autre.md', '---\nid: 01A\ntype: source\nchemin: docs/autre.md\nupdated: 2026-11-01\n---\n# Autre\n');
		const reelle = dep.extraction;
		const extraits: string[] = [];
		dep.extraction = { ...reelle, extraire: async (chemin, ...a) => (extraits.push(chemin), reelle.extraire(chemin, ...a)) };
		dep.documents.deposer('docs/cdc.md', document());
		expect(await extraireSource(dep, { chemin: 'docs/cdc.md' })).toMatchObject({ statut: 'ecrit', passages: 20 });
		expect(extraits).toEqual([]);
		expect(await ids(dep, 'wombat')).toHaveLength(1);
		expect(extraits).toEqual(['docs/autre.md']);
	});

	it('deuxième appel → deja ; copie sous un autre nom → deja', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/cdc.md', document());
		await extraireSource(dep, { chemin: 'docs/cdc.md' });
		expect(await extraireSource(dep, { chemin: 'docs/cdc.md' })).toEqual({ statut: 'deja', fiche: 'sources/Cahier des charges.md' });
		dep.documents.deposer('archives/copie.md', document());
		expect(await extraireSource(dep, { chemin: 'archives/copie.md' })).toEqual({ statut: 'deja', fiche: 'sources/Cahier des charges.md' });
		expect(dep.commits).toHaveLength(1);
	});

	it('même contenu modifié à 5 % → proches ; apresProches → écrit sous un nom unique', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/cdc.md', document());
		await extraireSource(dep, { chemin: 'docs/cdc.md' });
		dep.documents.deposer('docs/cdc-bis.md', document(20, [3]));
		const r = await extraireSource(dep, { chemin: 'docs/cdc-bis.md' });
		expect(r.statut).toBe('proches');
		if (r.statut !== 'proches') return;
		expect(r.proches.map((t) => [t.chemin, t.genre, t.typeFiche])).toEqual([['sources/Cahier des charges.md', 'fiche', 'source']]);
		expect(r.proches[0]!.score).toBeGreaterThanOrEqual(0.9);
		expect(dep.commits).toHaveLength(1);
		const apres = await extraireSource(dep, { chemin: 'docs/cdc-bis.md', apresProches: true });
		expect(apres).toMatchObject({ statut: 'ecrit', fiche: 'sources/Cahier des charges (2).md', passages: 20 });
		// un document nettement différent n'est pas un proche
		dep.documents.deposer('docs/autre.md', document(20, [0, 1, 2, 3, 4], 'Autre'));
		expect(await extraireSource(dep, { chemin: 'docs/autre.md' })).toMatchObject({ statut: 'ecrit' });
	});

	it('version_de : vise une fiche source existante (pas de proches avec elle) ; absente → refus', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/v1.md', document());
		await extraireSource(dep, { chemin: 'docs/v1.md' });
		dep.documents.deposer('docs/v2.md', document(20, [3], 'Cahier v2'));
		expect(await extraireSource(dep, { chemin: 'docs/v2.md', version_de: 'sources/absente.md' })).toEqual({
			statut: 'refuse',
			motif: expect.stringContaining('sources/absente.md'),
		});
		expect(await extraireSource(dep, { chemin: 'docs/v2.md', version_de: 'projets/x.md' })).toMatchObject({ statut: 'refuse' });
		const r = await extraireSource(dep, { chemin: 'docs/v2.md', version_de: '[[sources/Cahier des charges]]' });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'sources/Cahier v2.md' });
		expect(frontmatter(dep, 'sources/Cahier v2.md')['version_de']).toBe('[[sources/Cahier des charges]]');
		// même texte dans les deux versions : une entrée, la nouvelle version, l'ancienne listée en copie
		const trouves = await chercher(dep, { texte: 'section7' });
		expect(trouves.map((t) => [t.chemin, t.statut, t.copies])).toEqual([['sources/Cahier v2.md', 'servi', ['sources/Cahier des charges.md']]]);
		// l'ancienne version reste trouvable, avec son statut
		const toutes = await chercher(dep, { texte: 'section7', dedoublonner: false });
		expect([...new Set(toutes.map((t) => `${t.chemin} ${t.statut}`))].sort()).toEqual(['sources/Cahier des charges.md ancienne_version', 'sources/Cahier v2.md servi']);
	});

	it('secret dans le document → secrets: 1, introuvable par chercher, absent de la fiche', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/acces.md', '# Accès au serveur\n\nLe serveur du zoo est en salle B.\n\npassword: hunter2secret\n');
		const r = await extraireSource(dep, { chemin: 'docs/acces.md' });
		expect(r).toMatchObject({ statut: 'ecrit', secrets: 1, passages: 1 });
		expect(await ids(dep, 'hunter2secret')).toEqual([]);
		expect((await chercher(dep, { texte: 'serveur', genres: ['passage'] })).map((t) => t.chemin)).toEqual(['sources/Accès au serveur.md']);
		expect([...dep.fichiers.values()].join('\n')).not.toContain('hunter2secret');
	});

	it('titre contenant un secret : masqué dans la fiche et son nom', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/t.md', '# Clé ghp_abcdefghijklmnopqrstuvwxyz0123456789\n\nLe tapir dort.\n');
		const r = await extraireSource(dep, { chemin: 'docs/t.md' });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'sources/Clé - secret masqué.md' });
		expect([...dep.fichiers.keys(), ...dep.fichiers.values()].join('\n')).not.toContain('ghp_');
	});

	it.each([
		['../ailleurs.md', /hors|refusé/u],
		['/etc/passwd.md', /refusé/u],
		['_mnemo/projets/p.md', /refusé/u],
		['.mnemo/index.md', /refusé/u],
		['docs/outil.exe', /pas un fichier texte.*ne sera pas cherchable/u],
		['docs/absent.md', /introuvable/u],
	])('chemin %s → refus lisible', async (chemin, motif) => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/outil.exe', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]));
		const r = await extraireSource(dep, { chemin });
		expect(r).toEqual({ statut: 'refuse', motif: expect.stringMatching(motif) });
		expect(dep.commits).toEqual([]);
	});

	it('plus de TAILLE_MAX_DOCUMENT (10 Go, taille annoncée) → refus, rien n\'est lu', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/gros.md', '# Gros\n');
		const docs = dep.documents;
		let ouvertures = 0;
		dep.documents = {
			...docs,
			etat: async () => ({ mtimeMs: 1, taille: TAILLE_MAX_DOCUMENT + 1 }),
			ouvrir: async (c) => (ouvertures++, docs.ouvrir(c)),
		};
		expect(await extraireSource(dep, { chemin: 'docs/gros.md' })).toEqual({ statut: 'refuse', motif: 'Document trop volumineux : « docs/gros.md » (plus de 10 Go).' });
		expect(ouvertures).toBe(0);
	});

	it('lien symbolique (vrai disque) → refus', async () => {
		const racine = await dossierTemporaire();
		await mkdir(join(racine, 'docs'));
		await writeFile(join(racine, 'hors.md'), '# Hors\n\nsecret\n');
		await symlink(join(racine, 'hors.md'), join(racine, 'docs', 'lien.md'));
		const dep = fauxPorts();
		dep.documents = Object.assign(fichiersDossier(racine), { documents: new Map(), deposer() {}, retirer() {} });
		expect(await extraireSource(dep, { chemin: 'docs/lien.md' })).toEqual({ statut: 'refuse', motif: expect.stringContaining('lien symbolique') });
	});

	it('types : email par défaut pour .eml, inconnue sinon ; utilisateur/session/deduction refusés', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('mails/devis.eml', message({ id: '<1@x>', sujet: 'Devis mars', corps: 'Le devis du tapir est validé.' }));
		dep.documents.deposer('docs/note.md', '# Note\n\nLe zèbre.\n');
		for (const type of ['utilisateur', 'session', 'deduction'] as const) {
			expect(await extraireSource(dep, { chemin: 'docs/note.md', type })).toEqual({ statut: 'refuse', motif: expect.stringContaining(type) });
		}
		expect(await extraireSource(dep, { chemin: 'mails/devis.eml' })).toMatchObject({ statut: 'ecrit', fiche: 'sources/Devis mars.md' });
		expect(frontmatter(dep, 'sources/Devis mars.md')).toMatchObject({ type_source: 'email', format: 'eml', date: '2026-03-02', auteur: 'Marc Dupont <marc@exemple.fr>' });
		expect(await extraireSource(dep, { chemin: 'docs/note.md', type: 'contrat' })).toMatchObject({ statut: 'ecrit' });
		expect(frontmatter(dep, 'sources/Note.md')['type_source']).toBe('contrat');
	});

	it('.mbox à 2 fils → une fiche par fil sous le dossier de la source, passages de chaque fil', async () => {
		const dep = fauxPorts();
		dep.documents.deposer(
			'mails/boite.mbox',
			enMbox([
				message({ id: '<a1@x>', sujet: 'Livraison du tapir', corps: 'Le tapir arrive lundi.' }),
				message({ id: '<b1@x>', sujet: 'Facture zèbre', corps: 'La facture du zèbre est payée.' }),
				message({ id: '<a2@x>', sujet: 'Re: Livraison du tapir', reponseA: '<a1@x>', corps: 'Bien noté pour lundi.', date: 'Tue, 03 Mar 2026 10:00:00 +0000' }),
			]),
		);
		const r = await extraireSource(dep, { chemin: 'mails/boite.mbox' });
		// la fiche du fichier n'a pas de passages propres : ceux des fils (un par message ici : 2 + 1)
		const parFiche = Object.fromEntries((await dep.index.sources()).map((s) => [s.fiche, s.passages]));
		expect(parFiche).toEqual({ 'sources/boite.md': 0, 'sources/boite/Livraison du tapir.md': 2, 'sources/boite/Facture zèbre.md': 1 });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'sources/boite.md', passages: 3, filles: ['sources/boite/Livraison du tapir.md', 'sources/boite/Facture zèbre.md'] });
		// un fil est désigné par sa clé stable (Message-ID de son premier message), pas par son rang
		expect(frontmatter(dep, 'sources/boite/Livraison du tapir.md')).toMatchObject({ chemin: 'mails/boite.mbox', fil: '<a1@x>', type_source: 'email', source_parente: '[[sources/boite]]' });
		expect(frontmatter(dep, 'sources/boite/Facture zèbre.md')).toMatchObject({ chemin: 'mails/boite.mbox', fil: '<b1@x>' });
		expect(frontmatter(dep, 'sources/boite.md')).toMatchObject({ chemin: 'mails/boite.mbox', fils: 2 });
		expect(dep.commits).toHaveLength(1);
		expect(dep.commits[0]!.chemins).toEqual(['sources/boite.md', 'sources/boite/Livraison du tapir.md', 'sources/boite/Facture zèbre.md', 'sources/sources.md', 'sources/boite/boite.md']);
		expect(await ids(dep, 'facture')).toEqual([expect.stringMatching(/^sources\/boite\/Facture zèbre\.md#p-/u)]);
		// les deux passages du fil (sans dédoublonnage : une entrée par document sinon)
		const lundi = (await chercher(dep, { texte: 'lundi', genres: ['passage'], dedoublonner: false })).map((t) => t.id);
		expect(lundi).toHaveLength(2);
		for (const id of lundi) expect(id).toMatch(/^sources\/boite\/Livraison du tapir\.md#p-/u);
		expect(await extraireSource(dep, { chemin: 'mails/boite.mbox' })).toEqual({ statut: 'deja', fiche: 'sources/boite.md' });
	});

	it('pièce jointe PDF → source fille (jamais copiée), passages tirés de la pièce ; autres pièces seulement listées', async () => {
		const dep = fauxPorts();
		const pdf = (await readFile(join(FIXTURES, 'contrat.pdf'))).toString('base64');
		const eml = [
			'From: a@exemple.fr', 'Subject: Contrat signé', 'Message-ID: <c@x>', 'Content-Type: multipart/mixed; boundary=zz', '',
			'--zz', 'Content-Type: text/plain; charset=utf-8', '', 'Voici le contrat signé.', '',
			'--zz', 'Content-Type: application/pdf; name="contrat.pdf"', 'Content-Disposition: attachment; filename="contrat.pdf"', 'Content-Transfer-Encoding: base64', '', pdf, '',
			'--zz', 'Content-Type: image/png', 'Content-Disposition: attachment; filename="logo.png"', 'Content-Transfer-Encoding: base64', '', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]).toString('base64'), '',
			'--zz--', '',
		].join('\r\n');
		dep.documents.deposer('mails/contrat.eml', eml);
		const r = await extraireSource(dep, { chemin: 'mails/contrat.eml' });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'sources/Contrat signé.md', filles: ['sources/Contrat signé/contrat.pdf.md'] });
		expect(frontmatter(dep, 'sources/Contrat signé/contrat.pdf.md')).toMatchObject({ source_parente: '[[sources/Contrat signé]]', piece: 'contrat.pdf', type_source: 'email', format: 'pdf' });
		expect(frontmatter(dep, 'sources/Contrat signé/contrat.pdf.md')['chemin']).toBeUndefined();
		expect(dep.fichiers.get('sources/Contrat signé.md')).toContain('logo.png');
		expect(await ids(dep, 'montant')).toEqual([expect.stringMatching(/^sources\/Contrat signé\/contrat\.pdf\.md#p-/u)]);
		expect(r.statut === 'ecrit' && r.passages).toBe(2);
	});

	it('tout fichier texte est lu (CSV, YAML, sans extension) ; un binaire sans extracteur est refusé « pas cherchable »', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/tarifs.csv', 'poste;prix\nsite;1200\nmaintenance;tapirs\n');
		expect(await extraireSource(dep, { chemin: 'docs/tarifs.csv' })).toMatchObject({ statut: 'ecrit', fiche: 'sources/tarifs.md' });
		expect(frontmatter(dep, 'sources/tarifs.md')).toMatchObject({ format: 'texte' });
		expect(await ids(dep, 'tapirs')).toEqual([expect.stringMatching(/^sources\/tarifs\.md#p-/u)]);
		dep.documents.deposer('docs/LISEZMOI', 'Le dromadaire boit peu.\n');
		expect(await extraireSource(dep, { chemin: 'docs/LISEZMOI' })).toMatchObject({ statut: 'ecrit' });
		dep.documents.deposer('docs/compta.xlsx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]));
		expect(await extraireSource(dep, { chemin: 'docs/compta.xlsx' })).toEqual({ statut: 'refuse', motif: expect.stringContaining('« docs/compta.xlsx » : pas un fichier texte') });
	});

	it('un binaire sans extracteur est refusé sur ses premiers octets, sans être lu ni haché en entier', async () => {
		const dep = fauxPorts();
		const binaire = new Uint8Array(4 * 1024 * 1024);
		binaire.set([0x50, 0x4b, 0x03, 0x04]);
		dep.documents.deposer('docs/video.mov', binaire);
		let lus = 0;
		const ouvrir = dep.documents.ouvrir.bind(dep.documents);
		dep.documents.ouvrir = async (c) => {
			const o = await ouvrir(c);
			return o === null ? null : { ...o, taille: o.taille, lire: async (p, l) => { const b = await o.lire(p, l); lus += b.byteLength; return b; }, fermer: () => o.fermer() };
		};
		expect(await extraireSource(dep, { chemin: 'docs/video.mov' })).toEqual({ statut: 'refuse', motif: expect.stringContaining('ne sera pas cherchable') });
		expect(lus).toBeLessThanOrEqual(ECHANTILLON_NATURE);
	});

	it('boîte déjà référencée par son chemin, illisible après ses premiers octets : « Lecture impossible », pas une exception', async () => {
		const dep = fauxPorts();
		const corps = 'Le tapir arrive lundi. '.repeat(500);
		dep.documents.deposer('mails/boite.mbox', enMbox([message({ id: '<a1@x>', sujet: 'Livraison', corps })]));
		expect(await extraireSource(dep, { chemin: 'mails/boite.mbox' })).toMatchObject({ statut: 'ecrit' });
		const ouvrir = dep.documents.ouvrir.bind(dep.documents);
		dep.documents.ouvrir = async (c) => {
			const o = await ouvrir(c);
			return o === null ? null : { ...o, taille: o.taille, lire: async (p, l) => { if (p + l > ECHANTILLON_NATURE) throw new Error('disque débranché'); return o.lire(p, l); }, fermer: () => o.fermer() };
		};
		expect(await extraireSource(dep, { chemin: 'mails/boite.mbox' })).toEqual({ statut: 'refuse', motif: 'Lecture impossible : « mails/boite.mbox » (disque débranché).' });
	});

	it('PDF en partie scanné : écrit, pages sans texte signalées et gardées dans l\'index pour sa fiche ; entièrement scanné : refus qui le dit', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/contrat.pdf', pdfDePages(['Contrat de maintenance', '', 'Signatures']));
		const r = await extraireSource(dep, { chemin: 'docs/contrat.pdf' });
		const avertissement = "1 page sur 3 sans texte (scannée ?) : non indexée, la reconnaissance de caractères n'est pas faite";
		expect(r).toMatchObject({ statut: 'ecrit', avertissements: [`extraction incomplète : ${avertissement}`] });
		const fiche = r.statut === 'ecrit' ? r.fiche : '';
		expect((await dep.index.sources()).find((s) => s.fiche === fiche)?.avertissements).toEqual([avertissement]);
		dep.documents.deposer('docs/scan.pdf', pdfDePages(['', '']));
		expect(await extraireSource(dep, { chemin: 'docs/scan.pdf' })).toEqual({ statut: 'refuse', motif: expect.stringContaining('2 pages sur 2 sans texte') });
	});

	it('extraction en échec → refus lisible, rien d\'écrit', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/x.pdf', await readFile(join(FIXTURES, 'corrompu.pdf')));
		expect(await extraireSource(dep, { chemin: 'docs/x.pdf' })).toEqual({ statut: 'refuse', motif: expect.stringMatching(/PDF/u) });
		expect(dep.commits).toEqual([]);
	});
});

describe('extraireSource : doublons, déplacements, concurrence', () => {
	it('fichier déplacé (ancien chemin disparu, même contenu) → deja, chemin réécrit en un commit ; la découpe qui l’a reconnu sert aux passages (une seule extraction)', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/cdc.md', document());
		await extraireSource(dep, { chemin: 'docs/cdc.md' });
		dep.documents.retirer('docs/cdc.md');
		dep.documents.deposer('docs/deplace.md', document());
		const reelle = dep.extraction;
		let extractions = 0;
		dep.extraction = { extraire: async (...a) => (extractions++, reelle.extraire(...a)), decouper: async (...a) => (extractions++, reelle.decouper(...a)) };
		const r = await extraireSource(dep, { chemin: 'docs/deplace.md' });
		expect(r).toEqual({ statut: 'deja', fiche: 'sources/Cahier des charges.md', deplacee: true, commit: 'c000002' });
		expect(dep.commits[1]).toEqual({ message: 'mnemo: source sources/Cahier des charges.md déplacée', chemins: ['sources/Cahier des charges.md'] });
		expect(frontmatter(dep, 'sources/Cahier des charges.md')['chemin']).toBe('docs/deplace.md');
		expect(extractions).toBe(1);
		expect(await ids(dep, 'section7')).toHaveLength(1);
		expect(extractions).toBe(1);
		expect((await dep.index.sources()).find((s) => s.fiche === 'sources/Cahier des charges.md')).toMatchObject({ etat: 'indexee', passages: 20 });
		// de nouveau : plus rien à déplacer
		expect(await extraireSource(dep, { chemin: 'docs/deplace.md' })).toEqual({ statut: 'deja', fiche: 'sources/Cahier des charges.md' });
	});

	it('fichier déplacé, index en panne après le commit : deja et déplacée, avertissement, indicateur strict', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/cdc.md', document());
		await extraireSource(dep, { chemin: 'docs/cdc.md' });
		dep.documents.retirer('docs/cdc.md');
		dep.documents.deposer('docs/deplace.md', document());
		const remplacer = dep.index.remplacer.bind(dep.index);
		// la synchronisation sous verrou passe, celle d'après le commit échoue
		dep.index.remplacer = (...a) => (dep.commits.length > 1 ? Promise.reject(new Error('index cassé')) : remplacer(...a));
		const r = await extraireSource(dep, { chemin: 'docs/deplace.md' });
		expect(r).toEqual({ statut: 'deja', fiche: 'sources/Cahier des charges.md', deplacee: true, commit: 'c000002', avertissements: [avertissementIndex('index cassé')] });
		expect(frontmatter(dep, 'sources/Cahier des charges.md')['chemin']).toBe('docs/deplace.md');
		expect(await dep.indicateur.lire()).toEqual({ genre: 'illisible' });
	});

	it('.mbox déplacé : la fiche du fichier et chaque fil suivent ; leurs passages sont refaits', async () => {
		const dep = fauxPorts();
		const boite = enMbox([message({ id: '<a@x>', sujet: 'Tapir', corps: 'Le tapir arrive.' }), message({ id: '<b@x>', sujet: 'Zèbre', corps: 'Le zèbre part.' })]);
		dep.documents.deposer('mails/b.mbox', boite);
		await extraireSource(dep, { chemin: 'mails/b.mbox' });
		dep.documents.retirer('mails/b.mbox');
		dep.documents.deposer('archives/b.mbox', boite);
		expect(await extraireSource(dep, { chemin: 'archives/b.mbox' })).toMatchObject({ statut: 'deja', fiche: 'sources/b.md', deplacee: true });
		expect(dep.commits[1]!.chemins).toEqual(['sources/b.md', 'sources/b/Tapir.md', 'sources/b/Zèbre.md']);
		for (const f of ['sources/b.md', 'sources/b/Tapir.md', 'sources/b/Zèbre.md']) expect(frontmatter(dep, f)['chemin']).toBe('archives/b.mbox');
		expect(await ids(dep, 'zèbre')).toEqual([expect.stringMatching(/^sources\/b\/Zèbre\.md#p-/u)]);
	});

	it('même chemin, document modifié → deja pour sa fiche (réextrait à la synchronisation suivante), pas de seconde fiche', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/m.md', '# Mémo\n\nLe tapir dort.\n');
		await extraireSource(dep, { chemin: 'docs/m.md' });
		dep.documents.deposer('docs/m.md', '# Mémo\n\nLe wombat dort.\n');
		expect(await extraireSource(dep, { chemin: './docs/m.md' })).toEqual({ statut: 'deja', fiche: 'sources/Mémo.md' });
		expect(dep.commits).toHaveLength(1);
		expect(await ids(dep, 'wombat')).toEqual([expect.stringMatching(/^sources\/Mémo\.md#p-/u)]);
	});

	it('deux appels simultanés du même document : une seule fiche, un seul commit', async () => {
		const dep = fauxPorts();
		let file: Promise<unknown> = Promise.resolve();
		dep.verrou = {
			avec: <T>(action: () => Promise<T>): Promise<T> => {
				const suite = file.then(action);
				file = suite.catch(() => {});
				return suite;
			},
		};
		let liberer!: () => void;
		const barriere = new Promise<void>((r) => (liberer = r));
		let enAttente = 0;
		const reelle = dep.extraction;
		dep.extraction = { ...reelle, decouper: async (...a) => (enAttente++, await barriere, reelle.decouper(...a)) };
		dep.documents.deposer('docs/cdc.md', document());
		const appels = [extraireSource(dep, { chemin: 'docs/cdc.md' }), extraireSource(dep, { chemin: 'docs/cdc.md' })];
		while (enAttente < 2) await new Promise((r) => setTimeout(r, 1));
		liberer();
		const resultats = await Promise.all(appels);
		expect(resultats.map((r) => r.statut).sort()).toEqual(['deja', 'ecrit']);
		expect(resultats.find((r) => r.statut === 'deja')).toEqual({ statut: 'deja', fiche: 'sources/Cahier des charges.md' });
		expect(dep.commits).toHaveLength(1);
		expect([...dep.fichiers.keys()].filter((f) => f.startsWith('sources/Cahier'))).toEqual(['sources/Cahier des charges.md']);
	});

	it('plusieurs fiches de même empreinte : celle sans suffixe « (n) » est rendue', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/x.md', '# X\n\nLe tapir.\n');
		dep.documents.deposer('docs/y.md', '# X\n\nLe tapir.\n');
		dep.documents.deposer('docs/z.md', '# X\n\nLe tapir.\n');
		const empreinte = empreinteOctets(new TextEncoder().encode('# X\n\nLe tapir.\n'));
		const fiche = (id: string, chemin: string) => `---\nid: ${id}\ntype: source\nupdated: 2026-11-01\nchemin: ${chemin}\nempreinte: "${empreinte}"\n---\n# X\n`;
		await dep.coffre.ecrire('sources/A (2).md', fiche('01A', 'docs/x.md'));
		await dep.coffre.ecrire('sources/Z.md', fiche('01Z', 'docs/y.md'));
		expect(await extraireSource(dep, { chemin: 'docs/z.md' })).toEqual({ statut: 'deja', fiche: 'sources/Z.md' });
	});

	it('casse : le chemin est gardé tel qu\'il est écrit sur le disque', async () => {
		const dep = fauxPorts();
		const docs = dep.documents;
		const vrai = (c: string) => [...docs.documents.keys()].find((k) => k.toLowerCase() === c.toLowerCase()) ?? c;
		dep.documents = { ...docs, etat: (c) => docs.etat(vrai(c)), ouvrir: (c) => docs.ouvrir(vrai(c)) };
		docs.deposer('Docs/CDC.md', '# Cdc\n\nLe tapir.\n');
		expect(await extraireSource(dep, { chemin: 'docs/cdc.md' })).toMatchObject({ statut: 'ecrit', fiche: 'sources/Cdc.md' });
		expect(frontmatter(dep, 'sources/Cdc.md')['chemin']).toBe('Docs/CDC.md');
		expect(await extraireSource(dep, { chemin: 'DOCS/cdc.MD' })).toEqual({ statut: 'deja', fiche: 'sources/Cdc.md' });
	});

	it('document vide → refus ; passages d\'une fiche non indexés → écrit, avec un avertissement', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/vide.md', '\n\n');
		expect(await extraireSource(dep, { chemin: 'docs/vide.md' })).toEqual({ statut: 'refuse', motif: expect.stringContaining('Document vide') });
		dep.documents.deposer('docs/a.md', '# A\n\nLe tapir.\n');
		const remplacer = dep.index.remplacerPassages.bind(dep.index);
		dep.index.remplacerPassages = async (fiche, ...a) => {
			if (fiche === 'sources/A.md') throw new Error('disque plein');
			return remplacer(fiche, ...a);
		};
		const r = await extraireSource(dep, { chemin: 'docs/a.md' });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'sources/A.md', passages: 0, avertissements: [expect.stringContaining('disque plein')] });
		expect(r).not.toHaveProperty('motif');
	});

	it('index en panne après le commit : écrit, avertissement de l\'index (le même que les autres écritures), indicateur strict', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/a.md', '# A\n\nLe tapir.\n');
		const remplacer = dep.index.remplacer.bind(dep.index);
		dep.index.remplacer = (...a) => (dep.commits.length > 0 ? Promise.reject(new Error('index cassé')) : remplacer(...a));
		const r = await extraireSource(dep, { chemin: 'docs/a.md' });
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'sources/A.md', commit: 'c000001', avertissements: [avertissementIndex('index cassé')] });
		expect(await dep.indicateur.lire()).toEqual({ genre: 'illisible' });
	});
});

describe('extraireSource : .mbox qui grandit', () => {
	const a1 = message({ id: '<a1@x>', sujet: 'Tapir', corps: 'Le tapir arrive lundi.', date: 'Mon, 02 Mar 2026 10:00:00 +0000' });
	const b1 = message({ id: '<b1@x>', sujet: 'Zèbre', corps: 'Le zèbre part mardi.', date: 'Mon, 02 Mar 2026 11:00:00 +0000' });
	// plus ancien que les autres : par rang, il prendrait la place du fil « Tapir »
	const c1 = message({ id: '<c1@x>', sujet: 'Wombat', corps: 'Le wombat dort.', date: 'Sun, 01 Mar 2026 09:00:00 +0000' });
	const textesDe = async (dep: Dependances, fiche: string) => (await chercher(dep, { texte: 'le', genres: ['passage'], limite: 50 })).filter((t) => t.chemin === fiche).map((t) => t.texte).join('\n');

	it('un fil ajouté (plus ancien) : aucune fiche ne prend ses passages ; la synchronisation le signale ; extraire_source le référence', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('mails/b.mbox', enMbox([a1, b1]));
		await extraireSource(dep, { chemin: 'mails/b.mbox' });
		dep.documents.deposer('mails/b.mbox', enMbox([c1, a1, b1]));
		const bilan = await synchroniser(dep);
		expect(bilan.motifs).toEqual({ 'sources/b.md': '1 fil nouveau : relancer extraire_source' });
		expect(bilan.illisibles).toEqual([]);
		expect(await textesDe(dep, 'sources/b/Tapir.md')).toContain('tapir');
		expect(await textesDe(dep, 'sources/b/Tapir.md')).not.toContain('wombat');
		expect(await textesDe(dep, 'sources/b/Zèbre.md')).not.toContain('wombat');
		expect(dep.commits).toHaveLength(1);

		const r = await extraireSource(dep, { chemin: 'mails/b.mbox' });
		expect(r).toEqual({ statut: 'deja', fiche: 'sources/b.md', ajoutes: 1, commit: 'c000002' });
		expect(dep.commits[1]).toEqual({ message: 'mnemo: source sources/b.md — 1 fil ajouté', chemins: ['sources/b/Wombat.md', 'sources/b.md'] });
		expect(frontmatter(dep, 'sources/b/Wombat.md')).toMatchObject({ fil: '<c1@x>', chemin: 'mails/b.mbox', source_parente: '[[sources/b]]' });
		expect(frontmatter(dep, 'sources/b.md')['fils']).toBe(3);
		expect(await ids(dep, 'wombat')).toEqual([expect.stringMatching(/^sources\/b\/Wombat\.md#p-/u)]);
		expect((await synchroniser(dep)).motifs).toBeUndefined();
		expect(await extraireSource(dep, { chemin: 'mails/b.mbox' })).toEqual({ statut: 'deja', fiche: 'sources/b.md' });
	});

	it('une réponse qui réunit deux fils : le fil réuni garde sa clé, l\'autre fiche ne montre jamais les passages d\'un autre fil', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('mails/b.mbox', enMbox([a1, b1]));
		await extraireSource(dep, { chemin: 'mails/b.mbox' });
		const lien = message({ id: '<m@x>', sujet: 'Re: Tapir', reponseA: '<a1@x> <b1@x>', corps: 'Le tapir et le zèbre voyagent ensemble.', date: 'Tue, 03 Mar 2026 10:00:00 +0000' });
		dep.documents.deposer('mails/b.mbox', enMbox([a1, b1, lien]));
		const bilan = await synchroniser(dep);
		// le fil « Zèbre » n'existe plus seul : sa fiche est signalée, ses anciens passages (les siens) restent
		expect(bilan.illisibles).toEqual(['sources/b/Zèbre.md']);
		expect(await textesDe(dep, 'sources/b/Tapir.md')).toContain('voyagent ensemble');
		expect(await textesDe(dep, 'sources/b/Zèbre.md')).not.toMatch(/tapir|voyagent/u);
		// un fil nouveau en plus : `fils` = nombre réel de fils du fichier (2), pas clés connues + nouvelles (3)
		dep.documents.deposer('mails/b.mbox', enMbox([a1, b1, lien, c1]));
		expect(await extraireSource(dep, { chemin: 'mails/b.mbox' })).toMatchObject({ statut: 'deja', ajoutes: 1 });
		expect(frontmatter(dep, 'sources/b.md')['fils']).toBe(2);
	});

	it('une fiche seule dont le fil le plus ancien vient après : elle garde le plus ancien, pas le fichier entier', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('mails/b.mbox', enMbox([a1]));
		await extraireSource(dep, { chemin: 'mails/b.mbox' });
		dep.documents.deposer('mails/b.mbox', enMbox([b1, a1]));
		expect((await synchroniser(dep)).motifs).toEqual({ 'sources/Tapir.md': '1 fil nouveau : relancer extraire_source' });
		expect(await textesDe(dep, 'sources/Tapir.md')).toContain('tapir');
		expect(await textesDe(dep, 'sources/Tapir.md')).not.toContain('zèbre');
	});

	it('une seule fiche pour un .mbox d\'un fil, qui en a deux ensuite : elle devient conteneur, chaque fil a sa fiche', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('mails/b.mbox', enMbox([a1]));
		expect(await extraireSource(dep, { chemin: 'mails/b.mbox' })).toMatchObject({ statut: 'ecrit', fiche: 'sources/Tapir.md' });
		dep.documents.deposer('mails/b.mbox', enMbox([a1, b1]));
		expect((await synchroniser(dep)).motifs).toEqual({ 'sources/Tapir.md': '1 fil nouveau : relancer extraire_source' });
		// la fiche garde son fil (le plus ancien) : jamais les passages d'un autre fil sous son titre
		expect(await textesDe(dep, 'sources/Tapir.md')).toContain('tapir');
		expect(await textesDe(dep, 'sources/Tapir.md')).not.toContain('zèbre');
		expect(await extraireSource(dep, { chemin: 'mails/b.mbox' })).toMatchObject({ statut: 'deja', fiche: 'sources/Tapir.md', ajoutes: 1 });
		expect(dep.commits.at(-1)!.message).toBe('mnemo: source sources/Tapir.md — 1 fil ajouté');
		expect(frontmatter(dep, 'sources/Tapir.md')['fils']).toBe(2);
		const parFiche = Object.fromEntries((await dep.index.sources()).map((s) => [s.fiche, s.passages]));
		expect(parFiche).toEqual({ 'sources/Tapir.md': 0, 'sources/Tapir/Tapir (2).md': 1, 'sources/Tapir/Zèbre.md': 1 });
	});
});

describe('extraireSource : revue finale', () => {
	it('deja par chemin avec un type ou un version_de différent : signalé, fiche laissée telle quelle', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/a.md', document());
		await extraireSource(dep, { chemin: 'docs/a.md' });
		const r = await extraireSource(dep, { chemin: 'docs/a.md', type: 'contrat' });
		expect(r).toEqual({ statut: 'deja', fiche: 'sources/Cahier des charges.md', note: 'déjà référencée ; type inchangé — modifie la fiche sources/Cahier des charges.md' });
		expect(frontmatter(dep, 'sources/Cahier des charges.md')['type_source']).toBe('inconnue');
		expect(await extraireSource(dep, { chemin: 'docs/a.md', type: 'inconnue' })).toEqual({ statut: 'deja', fiche: 'sources/Cahier des charges.md' });
	});

	it('version_de vers un .mbox : ses fils sont aussi des anciennes versions', async () => {
		const dep = fauxPorts();
		const a = message({ id: '<a@x>', sujet: 'Tapir', corps: 'Le tapir arrive lundi au zoo.' });
		const b = message({ id: '<b@x>', sujet: 'Zèbre', corps: 'Le zèbre part mardi du zoo.' });
		dep.documents.deposer('mails/v1.mbox', enMbox([a, b]));
		await extraireSource(dep, { chemin: 'mails/v1.mbox' });
		dep.documents.deposer('docs/v2.md', '# Nouvelles\n\nLe tapir et le zèbre sont arrivés.\n');
		await extraireSource(dep, { chemin: 'docs/v2.md', version_de: 'sources/v1.md' });
		const trouves = await chercher(dep, { texte: 'tapir', genres: ['passage'] });
		expect(trouves.map((t) => [t.chemin, t.statut]).sort()).toEqual([
			['sources/Nouvelles.md', 'servi'],
			['sources/v1/Tapir.md', 'ancienne_version'],
		]);
	});

	it('le dossier des filles porte le type du document (titre encadré comme le sien)', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('mails/b.mbox', enMbox([message({ id: '<a@x>', sujet: 'Tapir', corps: 'Le tapir.' }), message({ id: '<b@x>', sujet: 'Zèbre', corps: 'Le zèbre.' })]));
		await extraireSource(dep, { chemin: 'mails/b.mbox' });
		const dossier = lireFiche('sources/b/b.md', dep.fichiers.get('sources/b/b.md')!);
		expect(dossier.type).toBe('dossier');
		expect(dossier.donnees['type_source']).toBe('email');
		const lu = await lireElement(dep, 'sources/b/b.md');
		expect(lu!.document).toBe('email');
		expect(lireFiche('sources/sources.md', dep.fichiers.get('sources/sources.md')!).donnees['type_source']).toBeUndefined();
	});

	it('e-mail au corps vide : aucun passage de titres seuls → document vide', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('mails/vide.eml', message({ id: '<v@x>', sujet: 'Rien', corps: '' }));
		expect(await extraireSource(dep, { chemin: 'mails/vide.eml' })).toEqual({ statut: 'refuse', motif: expect.stringContaining('Document vide') });
	});

	it('titre avec un secret : compté une seule fois', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('docs/t.md', '# token: abcdef123456\n\nLe tapir dort au zoo.\n');
		expect(await extraireSource(dep, { chemin: 'docs/t.md' })).toMatchObject({ statut: 'ecrit', secrets: 1 });
	});
});

describe('decouperFichier : pièces jointes trop lourdes', () => {
	it('listées avec les autres pièces non indexées, avec leur position et leur raison, jamais relues', async () => {
		const ecartee = { nom: 'g.bin', type: 'application/octet-stream', taille: 1e9, repere: { debut: 0, fin: 10, rang: 0 }, ecartee: 'plus de 256 Mo', contenu: async () => { throw new Error('relue'); } };
		const doc = { format: 'email', titre: 'Gros', markdown: '# Gros\n\nVoir la pièce.\n', pages: null, date: null, auteur: null, pieces: [ecartee] };
		const r = await decouperFichier({ pour: () => ({ extraire: async () => doc }) }, 'mails/g.eml', contenuEnMemoire(new Uint8Array()));
		expect(r).toMatchObject({ ok: true, autresPieces: ['g.bin (pièce 1)'] });
		expect(r.ok && r.parties[0]!.avertissements).toEqual(['1 pièce jointe non extraite (plus de 256 Mo) : g.bin']);
	});
});

describe('validerDemandeSource', () => {
	it.each([
		[{ chemin: 'docs/a.md' }, true],
		[{ chemin: 'docs/a.md', type: 'contrat', version_de: '[[sources/a]]', apresProches: true }, true],
		[{}, false],
		[{ chemin: 3 }, false],
		[{ chemin: 'a.md', type: 'banane' }, false],
		[{ chemin: 'a.md', apresProches: 'oui' }, false],
		[{ chemin: 'a.md', autre: 1 }, false],
		[{ chemin: 'x'.repeat(20001) }, false],
	])('%j → %s', (brut, ok) => {
		expect(validerDemandeSource(brut).ok).toBe(ok);
	});
});

describe('extraire_source : instructions de Claude Code', () => {
	it('.claude/CLAUDE.md, .claude/rules/x.md et CLAUDE.md en toute casse acceptés ; .claude/settings.local.json et .env : fichiers texte, acceptés comme tout document', async () => {
		const racine = await dossierTemporaire();
		await mkdir(join(racine, 'Projets', 'Verdure', '.claude', 'rules'), { recursive: true });
		await writeFile(join(racine, 'Projets', 'Verdure', '.claude', 'claude.md'), '# Consignes Verdure\n\nLe pangolin relit chaque fusion.\n');
		await writeFile(join(racine, 'Projets', 'Verdure', '.claude', 'rules', 'x.md'), '# Règle X\n\nToujours tester le tapir.\n');
		await writeFile(join(racine, 'Projets', 'Verdure', 'Claude.MD'), '# Racine Verdure\n\nLe zèbre range les branches.\n');
		await writeFile(join(racine, 'Projets', 'Verdure', '.claude', 'settings.local.json'), '{"token": "x"}');
		await writeFile(join(racine, '.env'), 'SECRET=1');
		const dep = fauxPorts();
		dep.documents = Object.assign(fichiersDossier(racine, { claudeGlobal: join(racine, 'absent', '.claude') }), { documents: new Map(), deposer() {}, retirer() {} });
		for (const chemin of ['Projets/Verdure/.claude/claude.md', 'Projets/Verdure/.claude/rules/x.md', 'Projets/Verdure/Claude.MD']) {
			expect(await extraireSource(dep, { chemin }), chemin).toMatchObject({ statut: 'ecrit' });
		}
		for (const chemin of ['Projets/Verdure/.claude/settings.local.json', '.env']) {
			expect(await extraireSource(dep, { chemin }), chemin).toMatchObject({ statut: 'ecrit' });
		}
		expect((await chercher(dep, { texte: 'pangolin fusion' }))[0]?.chemin).toMatch(/^sources\//u);
	});

	it('faux port : mêmes règles que le vrai (un fichier caché est un document ; _mnemo/ et .mnemo/ refusés)', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('.claude/CLAUDE.md', '# Globale du dossier\n\nLe lama.\n');
		dep.documents.deposer('.claude/.notes.md', '# Notes\n\nLe yack.\n');
		expect(await extraireSource(dep, { chemin: '.claude/CLAUDE.md' })).toMatchObject({ statut: 'ecrit' });
		expect(await extraireSource(dep, { chemin: '.claude/.notes.md' })).toMatchObject({ statut: 'ecrit' });
		expect(await extraireSource(dep, { chemin: '.mnemo/x.md' })).toMatchObject({ statut: 'refuse' });
	});
});


describe('extraireSource : pièces jointes de même nom', () => {
	/** Un message qui joint `devis.pdf`, dont la page porte `texte`. */
	const avecDevis = (id: string, sujet: string, texte: string) =>
		[
			'From: a@exemple.fr', `Subject: ${sujet}`, `Message-ID: ${id}`, 'Date: Mon, 02 Mar 2026 10:00:00 +0000', 'Content-Type: multipart/mixed; boundary=zz', '',
			'--zz', 'Content-Type: text/plain; charset=utf-8', '', `Voici le devis ${sujet}.`, '',
			'--zz', 'Content-Type: application/pdf; name="devis.pdf"', 'Content-Disposition: attachment; filename="devis.pdf"', 'Content-Transfer-Encoding: base64', '',
			Buffer.from(pdfDePages([texte])).toString('base64'), '',
			'--zz--', '',
		].join('\n');
	const premiers = [avecDevis('<d1@x>', 'Devis un', 'Tarif tapir'), avecDevis('<d2@x>', 'Devis deux', 'Tarif zebre'), avecDevis('<d3@x>', 'Devis trois', 'Tarif wombat')];

	it('chacune a sa fiche (identifiée par sa position), cherchable, y compris après une reconstruction de l\'index ; un ajout est complété', async () => {
		const dep = fauxPorts();
		dep.documents.deposer('mails/devis.mbox', enMbox(premiers));
		const r = await extraireSource(dep, { chemin: 'mails/devis.mbox' });
		expect(r.statut).toBe('ecrit');
		const pieces = [...dep.fichiers.keys()].filter((c) => /devis\.pdf( \(\d\))?\.md$/u.test(c)).sort();
		expect(pieces).toHaveLength(3);
		expect(pieces.map((c) => frontmatter(dep, c)['piece_position']).sort()).toEqual([1, 2, 3]);
		for (const mot of ['tapir', 'zebre', 'wombat']) expect(await ids(dep, mot), mot).toHaveLength(1);
		const ficheDe = async (mot: string) => (await ids(dep, mot))[0]!.split('#')[0]!;
		const parMot = { tapir: await ficheDe('tapir'), zebre: await ficheDe('zebre'), wombat: await ficheDe('wombat') };
		expect(new Set(Object.values(parMot)).size).toBe(3);

		// reconstruite, chaque fiche retrouve sa propre pièce (pas la première du même nom)
		await dep.index.vider();
		await synchroniser(dep);
		expect({ tapir: await ficheDe('tapir'), zebre: await ficheDe('zebre'), wombat: await ficheDe('wombat') }).toEqual(parMot);

		dep.documents.deposer('mails/devis.mbox', enMbox([...premiers, avecDevis('<d4@x>', 'Devis quatre', 'Tarif okapi')]));
		expect(await extraireSource(dep, { chemin: 'mails/devis.mbox' })).toMatchObject({ statut: 'deja', ajoutes: 1 });
		expect(await ids(dep, 'okapi')).toHaveLength(1);
		expect([...dep.fichiers.keys()].filter((c) => /devis\.pdf( \(\d\))?\.md$/u.test(c))).toHaveLength(4);
	});
});

describe('extraireSource : pièces binaires d\'une boîte', () => {
	const avecPieces = (id: string, pieces: { nom: string; octets: Uint8Array; type: string }[]) =>
		[
			'From: a@exemple.fr', `Subject: Lot ${id}`, `Message-ID: <${id}@x>`, 'Date: Mon, 02 Mar 2026 10:00:00 +0000', 'Content-Type: multipart/mixed; boundary=zz', '',
			'--zz', 'Content-Type: text/plain; charset=utf-8', '', `Message ${id}.`, '',
			...pieces.flatMap((p) => ['--zz', `Content-Type: ${p.type}; name="${p.nom}"`, `Content-Disposition: attachment; filename="${p.nom}"`, 'Content-Transfer-Encoding: base64', '', Buffer.from(p.octets).toString('base64'), '']),
			'--zz--', '',
		].join('\n');
	const image = () => {
		const o = new Uint8Array(512 * 1024);
		o.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		return o;
	};

	it('reconnues pendant le balayage, jamais relues ; listées avec leur position (même nom) ; un avertissement groupé ; boîte et empreinte en un parcours', async () => {
		const dep = fauxPorts();
		const boite = enMbox([
			avecPieces('a', [{ nom: 'image.png', octets: image(), type: 'image/png' }]),
			avecPieces('b', [{ nom: 'image.png', octets: image(), type: 'image/png' }]),
			avecPieces('c', [{ nom: 'devis.pdf', octets: pdfDePages(['Tarif okapi']), type: 'application/pdf' }]),
		]);
		dep.documents.deposer('mails/lot.mbox', boite);
		let lus = 0;
		const ouvrir = dep.documents.ouvrir.bind(dep.documents);
		dep.documents.ouvrir = async (c) => {
			const o = await ouvrir(c);
			return o === null ? null : { ...o, taille: o.taille, lire: async (p, l) => { const b = await o.lire(p, l); lus += b.byteLength; return b; }, fermer: () => o.fermer() };
		};
		const r = await extraireSource(dep, { chemin: 'mails/lot.mbox' });
		expect(r.statut).toBe('ecrit');
		const taille = new TextEncoder().encode(boite).byteLength;
		// échantillon, balayage haché, relecture de chaque message, et du seul message du PDF pour sa pièce ; la synchronisation
		// qui suit reprend l'empreinte : les messages des images ne sont jamais relus pour elles
		expect(lus).toBeLessThan(2 * taille + ECHANTILLON_NATURE + 20_000);
		const principale = r.statut === 'ecrit' ? dep.fichiers.get(r.fiche)! : '';
		expect(principale).toContain('image.png (pièce 1)');
		expect(principale).toContain('image.png (pièce 2)');
		const avertissements = r.statut === 'ecrit' ? (r.avertissements ?? []) : [];
		expect(avertissements.filter((a) => a.includes('image.png'))).toEqual([expect.stringMatching(/^extraction incomplète : 2 pièces jointes non extraites \(.*\) : image\.png, image\.png$/u)]);
		expect(await ids(dep, 'okapi')).toHaveLength(1);
	});
});
