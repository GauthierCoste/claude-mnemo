import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { contenuEnMemoire, MORCEAU } from '../../src/application/contenu.ts';
import { decouperFichier, extractionLocale } from '../../src/application/extraire-passages.ts';
import { extraireSource } from '../../src/application/extraire-source.ts';
import { presenterSource } from '../../src/application/presenter.ts';
import { synchroniser } from '../../src/application/synchroniser.ts';
import { ErreurExtraction, TEXTE_MAX_DOCUMENT } from '../../src/application/ports.ts';
import type { CibleExtraction, Contenu, Extracteurs } from '../../src/application/ports.ts';
import { extracteurEmail } from '../../src/infra/extracteurs/email.ts';
import { extracteursReels } from '../../src/infra/extracteurs/index.ts';
import { extracteurPdf, TAILLE_MAX_PDF } from '../../src/infra/extracteurs/pdf.ts';
import { extracteurTexte } from '../../src/infra/extracteurs/texte.ts';
import { extracteurWord, TAILLE_MAX_WORD } from '../../src/infra/extracteurs/word.ts';
import { extractionIsolee, TROP_LOURD } from '../../src/infra/extraction-isolee.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const MO = 1024 * 1024;

/** Lectures d'un contenu : plus grande lecture, octets lus au total. */
type Suivi = Contenu & { plusGrande: number; total: number };

/** Contenu de `taille` octets produit à la demande par `octet(position)` : rien n'est jamais alloué en entier. */
function contenuGenere(taille: number, remplir: (cible: Uint8Array, position: number) => void): Suivi {
	const suivi: Suivi = {
		taille,
		plusGrande: 0,
		total: 0,
		async lire(position, longueur) {
			const fin = Math.min(taille, position + longueur);
			const tampon = new Uint8Array(Math.max(0, fin - position));
			remplir(tampon, position);
			suivi.plusGrande = Math.max(suivi.plusGrande, tampon.byteLength);
			suivi.total += tampon.byteLength;
			return tampon;
		},
	};
	return suivi;
}

/**
 * Une boîte `.mbox` de `n` messages de même longueur, générée à la volée : chacun a son Message-ID et son sujet, un court
 * texte et une pièce jointe binaire (octets nuls : ni texte, ni format extrait) de `piece` octets.
 */
function boiteGeneree(n: number, piece: number): Suivi {
	const base64 = Buffer.alloc(piece, 0x00).toString('base64').replace(/(.{76})/g, '$1\n');
	const message = (i: number): Buffer => {
		const id = String(i).padStart(6, '0');
		return Buffer.from(
			[
				`From MAILER-DAEMON Mon Mar  2 10:00:00 2026`,
				`From: Marc <marc@exemple.fr>`,
				`Subject: Lot ${id}`,
				`Message-ID: <m${id}@exemple.fr>`,
				'Date: Mon, 02 Mar 2026 10:00:00 +0000',
				'Content-Type: multipart/mixed; boundary=zz',
				'',
				'--zz',
				'Content-Type: text/plain; charset=utf-8',
				'',
				`Message numéro ${id}, rien d'autre.`,
				'--zz',
				'Content-Type: application/octet-stream',
				`Content-Disposition: attachment; filename="donnees-${id}.bin"`,
				'Content-Transfer-Encoding: base64',
				'',
				base64,
				'--zz--',
				'',
				'',
			].join('\n'),
		);
	};
	const longueur = message(0).byteLength;
	let cache: { i: number; octets: Buffer } = { i: 0, octets: message(0) };
	return contenuGenere(n * longueur, (cible, position) => {
		for (let k = 0; k < cible.byteLength; ) {
			const i = Math.floor((position + k) / longueur);
			if (cache.i !== i) cache = { i, octets: message(i) };
			const debut = (position + k) % longueur;
			const copie = Math.min(longueur - debut, cible.byteLength - k);
			cible.set(cache.octets.subarray(debut, debut + copie), k);
			k += copie;
		}
	});
}

describe('extraction sans tout charger', () => {
	it('mbox de ~270 Mo générée : extraite message par message dans un fil limité à 128 Mo de tas', async () => {
		const boite = boiteGeneree(200, MO);
		expect(boite.taille).toBeGreaterThan(250 * MO);
		const r = await extractionIsolee({ memoireMo: 128 }).decouper('boites/lot.mbox', boite);
		expect(r).toMatchObject({ ok: true, format: 'mbox' });
		if (!r.ok) return;
		expect(r.parties).toHaveLength(200);
		expect(r.parties[0]).toMatchObject({ fil: '<m000000@exemple.fr>', titre: 'Lot 000000' });
		expect(r.parties[199]!.passages[0]!.texte).toContain('Message numéro 000199');
		expect(r.autresPieces).toHaveLength(200);
		// lue par morceaux : jamais plus d'un morceau à la fois ; le balayage et la relecture de chaque message, rien de plus (une
		// pièce binaire est reconnue sur l'échantillon pris pendant le balayage, jamais relue)
		expect(boite.plusGrande).toBeLessThanOrEqual(MORCEAU);
		expect(boite.total).toBeLessThanOrEqual(2 * boite.taille);
	}, 120_000);

	it('mbox : un message au-delà de la limite par message est écarté (avertissement), les autres sont extraits', async () => {
		const petit = 'From a Mon Mar  2 10:00:00 2026\nSubject: Petit\nMessage-ID: <p@x>\n\ncourt\n\n';
		const gros = `From a Mon Mar  2 10:00:00 2026\nSubject: Gros\nMessage-ID: <g@x>\n\n${'long '.repeat(2000)}\n\n`;
		const mbox = extracteurEmail('mbox', { messageMax: 5000 });
		const docs = await mbox.extraireTout!('b.mbox', contenuEnMemoire(new TextEncoder().encode(petit + gros + petit.replace(/<p@x>/, '<q@x>'))));
		expect(docs.map((d) => d.titre)).toEqual(['Petit']);
		expect(docs[0]!.markdown.match(/^## /gmu)).toHaveLength(2);
		expect(docs[0]!.avertissements).toEqual(['1 message de plus de 4,9 Ko écarté (limite par message)']);
		// un .eml au-delà : refus clair
		const e = await extracteurEmail('eml', { messageMax: 10 }).extraire('a.eml', contenuEnMemoire(new TextEncoder().encode(petit))).catch((x: unknown) => x);
		expect(e).toBeInstanceOf(ErreurExtraction);
		expect((e as Error).message).toMatch(/^Courriel trop volumineux pour être extrait : \d+ octets \(10 octets au plus pour ce format\)\.$/u);
	});

	it('mbox : texte total de la boîte plafonné (avertissement), fils et sujets gardés', async () => {
		const msg = (i: number) => `From a Mon Mar  2 10:00:00 2026\nSubject: S${i}\nMessage-ID: <${i}@x>\n\n${'mot '.repeat(50)}\n\n`;
		const docs = await extracteurEmail('mbox', { texteBoiteMax: 300 }).extraireTout!('b.mbox', contenuEnMemoire(new TextEncoder().encode([0, 1, 2, 3].map(msg).join(''))));
		expect(docs.map((d) => d.titre)).toEqual(['S0', 'S1', 'S2', 'S3']);
		expect(docs[0]!.avertissements).toEqual(['texte des messages coupé après 300 caractères pour la boîte entière : la suite n\'est pas indexée']);
		expect(docs[3]!.markdown).not.toContain('mot');
	});

	it('texte : lecture arrêtée au plafond de texte (le reste du fichier n\'est pas lu), avec avertissement', async () => {
		const enorme = contenuGenere(500 * MO, (cible) => cible.fill(0x61));
		const d = await extracteurTexte({ texteMax: 1000 }).extraire('notes.txt', enorme);
		expect(d.markdown).toHaveLength(1000);
		expect(d.avertissements).toEqual(['texte extrait coupé après 1000 caractères (limite par document) : la suite n\'est pas indexée']);
		expect(enorme.total).toBeLessThanOrEqual(MORCEAU);
		const court = await extracteurTexte({ texteMax: 1000 }).extraire('n.md', contenuEnMemoire(new TextEncoder().encode('# T\n\nok\n')));
		expect(court.avertissements).toBeUndefined();
	});

	it('tout format : le texte indexé d\'un document est plafonné à TEXTE_MAX_DOCUMENT, avec avertissement dans la partie', async () => {
		const ligne = 'Une phrase de remplissage assez ordinaire pour le découpage.\n\n';
		const markdown = ligne.repeat(Math.ceil((TEXTE_MAX_DOCUMENT + 5000) / ligne.length));
		const extracteurs: Extracteurs = { pour: () => ({ extraire: async () => ({ format: 'pdf', titre: 'Long', markdown, pages: [0, TEXTE_MAX_DOCUMENT + 10], date: null, auteur: null, pieces: [] }) }) };
		const r = await decouperFichier(extracteurs, 'docs/long.pdf', contenuEnMemoire(new Uint8Array(1)));
		expect(r).toMatchObject({ ok: true });
		if (!r.ok) return;
		expect(r.parties[0]!.avertissements).toEqual([`texte extrait coupé après ${TEXTE_MAX_DOCUMENT} caractères (limite par document) : la suite n'est pas indexée`]);
		const longueur = r.parties[0]!.passages.reduce((n, p) => n + p.texte.length, 0);
		expect(longueur).toBeLessThanOrEqual(TEXTE_MAX_DOCUMENT);
	}, 60_000);

	it('PDF et Word : au-delà de leur limite propre (lus en mémoire par leur bibliothèque), refus clair qui dit la taille', async () => {
		expect(TAILLE_MAX_PDF).toBe(256 * MO);
		expect(TAILLE_MAX_WORD).toBe(100 * MO);
		const pdf = new Uint8Array(await readFile(new URL('../fixtures/documents/contrat.pdf', import.meta.url)));
		const e = await extracteurPdf({ tailleMax: 100 }).extraire('c.pdf', contenuEnMemoire(pdf)).catch((x: unknown) => x);
		expect(e).toBeInstanceOf(ErreurExtraction);
		expect((e as Error).message).toMatch(/^PDF trop volumineux pour être extrait : [\d,]+ Ko \(100 octets au plus pour ce format\)\.$/u);
		const enorme = contenuGenere(300 * MO, () => {});
		await expect(extracteursReels().pour('x.pdf')!.extraire('x.pdf', enorme)).rejects.toThrow('PDF trop volumineux pour être extrait : 300 Mo (256 Mo au plus pour ce format).');
		await expect(extracteursReels().pour('x.docx')!.extraire('x.docx', enorme)).rejects.toThrow('Document Word trop volumineux pour être extrait : 300 Mo (100 Mo au plus pour ce format).');
		expect(enorme.total).toBe(0);
		await expect(extracteurWord(undefined, 10).extraire('x.docx', contenuEnMemoire(new Uint8Array(11)))).rejects.toThrow(/Document Word trop volumineux/u);
	});

	it('bilan : extraire_source et la synchronisation disent une extraction incomplète', async () => {
		const dep = fauxPorts();
		const texte = extracteurTexte({ texteMax: 40 });
		dep.extraction = extractionLocale({ pour: () => texte });
		dep.documents.deposer('docs/long.md', `# Long\n\n${'Le tapir mange des feuilles. '.repeat(20)}\n`);
		const r = await extraireSource(dep, { chemin: 'docs/long.md' });
		expect(r).toMatchObject({ statut: 'ecrit', avertissements: ['extraction incomplète : texte extrait coupé après 40 caractères (limite par document) : la suite n\'est pas indexée'] });
		expect(presenterSource(r)).toContain('extraction incomplète : texte extrait coupé après 40 caractères');
		// le fichier change : la synchronisation le réindexe et le signale
		dep.documents.deposer('docs/long.md', `# Long\n\n${'Le tapir dort. '.repeat(20)}\n`);
		const bilan = await synchroniser(dep);
		expect(bilan.incompletes).toEqual({ [r.statut === 'ecrit' ? r.fiche : '']: 'texte extrait coupé après 40 caractères (limite par document) : la suite n\'est pas indexée' });
	});
});

/** Un message de boîte (en-têtes, texte, pièces jointes en base64). */
function messageMbox(id: string, pieces: [nom: string, type: string, octets: Buffer][]): string {
	const base64 = (b: Buffer): string => b.toString('base64').replace(/(.{76})/g, '$1\n');
	return [
		'From MAILER-DAEMON Mon Mar  2 10:00:00 2026',
		'From: Marc <marc@exemple.fr>',
		`Subject: Sujet ${id}`,
		`Message-ID: <${id}@exemple.fr>`,
		'Date: Mon, 02 Mar 2026 10:00:00 +0000',
		'Content-Type: multipart/mixed; boundary=zz',
		'',
		'--zz',
		'Content-Type: text/plain; charset=utf-8',
		'',
		`Texte du message ${id}.`,
		...pieces.flatMap(([nom, type, octets]) => ['--zz', `Content-Type: ${type}`, `Content-Disposition: attachment; filename="${nom}"`, 'Content-Transfer-Encoding: base64', '', base64(octets)]),
		'--zz--',
		'',
		'',
	].join('\n');
}

/**
 * PDF corrompu de `taille` octets : un catalogue, puis des objets à la chaîne sans table de références valable — pdf.js la
 * reconstruit en balayant tout le fichier (coûteux en mémoire).
 */
function pdfCorrompu(taille: number): Buffer {
	const parts = ['%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'];
	let n = 3;
	for (let l = parts[0]!.length; l < taille - 200; n++) {
		const objet = `${n} 0 obj\n<< /Type /Page /Parent 2 0 R /Contents ${n + 1} 0 R >>\nendobj\n`;
		parts.push(objet);
		l += objet.length;
	}
	parts.push(`trailer\n<< /Root 1 0 R /Size ${n} >>\nstartxref\n999999999\n%%EOF\n`);
	return Buffer.from(parts.join(''));
}

const txt = (t: string): Buffer => Buffer.from(t);

describe('pièces jointes : chacune son échec, la boîte continue', () => {
	it('sonde : PDF corrompu de 40 Mo dans une mbox (fil à tas réduit) → seule la pièce échoue ; messages et autres pièces extraits', async () => {
		const boite = contenuEnMemoire(
			Buffer.from(
				messageMbox('a', [['avant.txt', 'text/plain', txt('Le tapir dort avant.')]]) +
					messageMbox('b', [
						['a.pdf', 'application/pdf', pdfCorrompu(40 * MO)],
						['apres.txt', 'text/plain', txt('Le tapir dort après.')],
					]) +
					messageMbox('c', []),
			),
		);
		const extraction = extractionIsolee({ memoireMo: 64 });
		const r = await extraction.decouper('boites/b.mbox', boite);
		expect(r).toMatchObject({ ok: true, format: 'mbox', autresPieces: ['a.pdf (pièce 2)'] });
		if (!r.ok) return;
		expect(r.parties.map((p) => [p.fil, p.piece])).toEqual([
			['<a@exemple.fr>', null],
			['<b@exemple.fr>', null],
			['<c@exemple.fr>', null],
			[null, 'avant.txt'],
			[null, 'apres.txt'],
		]);
		expect(r.parties[4]!.passages[0]!.texte).toContain('Le tapir dort après.');
		// la pièce refusée est dite dans le bilan (avertissement de la première partie)
		expect(r.parties[0]!.avertissements).toEqual([`pièce jointe « a.pdf (pièce 2) » non extraite : ${TROP_LOURD}`]);

		// synchronisation (fiches existantes) : la cible de la pièce échoue seule
		const cible = (extra: Partial<CibleExtraction>): CibleExtraction => ({ fiche: 's.md', fil: null, piece: null, positionPiece: null, titre: '', date: null, auteur: null, typeSource: 'email', resume: null, ...extra });
		const cibles = [cible({ fil: '<b@exemple.fr>' }), cible({ piece: 'a.pdf' }), cible({ piece: 'apres.txt' })];
		const resultats = await extraction.extraire('boites/b.mbox', boite, cibles);
		expect(resultats.map((x) => x.ok)).toEqual([true, false, true]);
		expect(resultats[1]).toEqual({ ok: false, motif: TROP_LOURD });
		expect(resultats[2]).toMatchObject({ ok: true, fils: ['<a@exemple.fr>', '<b@exemple.fr>', '<c@exemple.fr>'] });
	}, 120_000);

	it('texte cumulé des pièces plafonné par fichier : les pièces au-delà sont nommées, avec un avertissement', async () => {
		const boite = contenuEnMemoire(
			Buffer.from(
				messageMbox('a', [
					['un.txt', 'text/plain', txt('a'.repeat(60))],
					['deux.txt', 'text/plain', txt('b'.repeat(60))],
					['trois.txt', 'text/plain', txt('c'.repeat(10))],
				]),
			),
		);
		const r = await extractionLocale(extracteursReels(), { textePiecesMax: 100 }).decouper('b.mbox', boite);
		expect(r).toMatchObject({ ok: true, autresPieces: ['deux.txt (pièce 2)', 'trois.txt (pièce 3)'] });
		if (!r.ok) return;
		expect(r.parties.map((p) => p.piece)).toEqual([null, 'un.txt']);
		expect(r.parties[0]!.avertissements).toEqual(['2 pièces jointes non extraites : texte des pièces du fichier plafonné à 100 caractères']);
	});

	it('un message n\'est relu qu\'une fois pour toutes ses pièces', async () => {
		const texte = messageMbox('a', [1, 2, 3, 4].map((i): [string, string, Buffer] => [`p${i}.txt`, 'text/plain', txt(`pièce ${i} `.repeat(1000))]));
		const octets = new Uint8Array(Buffer.from(texte));
		let lus = 0;
		const boite: Contenu = { taille: octets.byteLength, lire: async (p, l) => ((lus += Math.min(l, octets.byteLength - p)), octets.slice(p, p + l)) };
		const r = await extractionLocale(extracteursReels()).decouper('b.mbox', boite);
		expect(r).toMatchObject({ ok: true, autresPieces: [] });
		if (!r.ok) return;
		expect(r.parties).toHaveLength(5);
		// balayage, lecture du message, une relecture pour les quatre pièces (le message sans sa ligne de séparation)
		expect(lus).toBeGreaterThan(2 * octets.byteLength);
		expect(lus).toBeLessThan(3 * octets.byteLength);
	});
});
