import { describe, expect, it } from 'vitest';
import { contenuEnMemoire } from '../../src/application/contenu.ts';
import { ErreurExtraction } from '../../src/application/ports.ts';
import type { Contenu } from '../../src/application/ports.ts';
import { extracteursReels } from '../../src/infra/extracteurs/index.ts';
import { extracteurEmail, lireMessage, plagesMbox, retablirFrom, TAILLE_MAX_PIECE } from '../../src/infra/extracteurs/email.ts';
import { TAILLE_MAX_PDF } from '../../src/infra/extracteurs/pdf.ts';
import { RAISON_NON_CHERCHABLE } from '../../src/domaine/source.ts';

const octets = (t: string) => contenuEnMemoire(new TextEncoder().encode(t));
const lat1 = (t: string) => contenuEnMemoire(Uint8Array.from(Buffer.from(t, 'latin1')));
/** Les messages bruts d'une boîte, découpés en flux. */
async function decouperMbox(contenu: Contenu): Promise<Uint8Array[]> {
	const messages: Uint8Array[] = [];
	for await (const plage of plagesMbox(contenu)) messages.push(await lireMessage(contenu, plage));
	return messages;
}
const extracteurs = extracteursReels();
const eml = extracteurs.pour('a.eml')!;
const mbox = extracteurs.pour('a.mbox')!;

function message(o: { id: string; de?: string; date?: string; sujet: string; reponseA?: string; corps: string; entetes?: string }): string {
	return [
		`From: ${o.de ?? 'Marc Dupont <marc@exemple.fr>'}`,
		`Date: ${o.date ?? 'Mon, 02 Mar 2026 10:00:00 +0000'}`,
		`Subject: ${o.sujet}`,
		`Message-ID: ${o.id}`,
		...(o.reponseA ? [`In-Reply-To: ${o.reponseA}`] : []),
		...(o.entetes ? [o.entetes] : []),
		'Content-Type: text/plain; charset=utf-8',
		'',
		o.corps,
		'',
	].join('\r\n');
}
const enMbox = (msgs: string[]) => msgs.map((m, i) => `From MAILER-DAEMON Mon Mar  2 10:0${i % 10}:00 2026\n${m.replace(/\r\n/g, '\n')}\n`).join('');

describe('.eml', () => {
	it('un message : citation, « a écrit », signature retirées ; métadonnées', async () => {
		const brut = message({
			id: '<1@x>',
			sujet: 'Devis mars',
			corps: ['Bonjour,', 'Le devis est validé.', '', 'Le 3 mars 2026 à 10:00, Alice <a@exemple.fr> a écrit :', '> Peux-tu valider ?', '', '-- ', 'Marc'].join('\r\n'),
		});
		const d = await eml.extraire('a.eml', octets(brut));
		expect(d).toMatchObject({ format: 'eml', titre: 'Devis mars', auteur: 'Marc Dupont <marc@exemple.fr>', date: '2026-03-02', pages: null, pieces: [] });
		expect(d.markdown).toBe('# Devis mars\n\n## 2026-03-02T10:00:00Z — Marc Dupont <marc@exemple.fr>\n\nBonjour,\nLe devis est validé.\n');
		expect(d.cle).toBe('<1@x>');
		expect(await eml.extraireTout!('a.eml', octets(brut))).toHaveLength(1);
	});

	it('quoted-printable Latin-1', async () => {
		const brut = ['From: a@exemple.fr', 'Subject: =?ISO-8859-1?Q?Caf=E9?=', 'Content-Type: text/plain; charset=iso-8859-1', 'Content-Transfer-Encoding: quoted-printable', '', 'Le caf=E9 est pr=EAt =E0 8=20h.', ''].join('\r\n');
		const d = await eml.extraire('a.eml', octets(brut));
		expect(d.titre).toBe('Café');
		expect(d.markdown).toContain('Le café est prêt à 8 h.');
	});

	it('base64 UTF-8', async () => {
		const corps = Buffer.from('Réunion à 14 h — « ok » ✓', 'utf8').toString('base64');
		const brut = ['From: a@exemple.fr', 'Subject: x', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', corps, ''].join('\r\n');
		expect((await eml.extraire('a.eml', octets(brut))).markdown).toContain('Réunion à 14 h — « ok » ✓');
	});

	it('HTML seul : converti en Markdown ; HTML ignoré quand text/plain est présent', async () => {
		const html = ['From: a@exemple.fr', 'Subject: h', 'Content-Type: text/html; charset=utf-8', '', '<p>Bonjour <b>toi</b></p><ul><li>un</li><li>deux</li></ul>', ''].join('\r\n');
		const d = await eml.extraire('a.eml', octets(html));
		expect(d.markdown).toContain('Bonjour **toi**');
		expect(d.markdown).toContain('-   un');
		const mixte = ['From: a@exemple.fr', 'Subject: m', 'Content-Type: multipart/alternative; boundary=zz', '', '--zz', 'Content-Type: text/plain; charset=utf-8', '', 'version texte', '--zz', 'Content-Type: text/html; charset=utf-8', '', '<p>version html</p>', '--zz--', ''].join('\r\n');
		const m = await eml.extraire('a.eml', octets(mixte));
		expect(m.markdown).toContain('version texte');
		expect(m.markdown).not.toContain('version html');
	});

	it('pièces jointes : toutes rendues (pdf et png)', async () => {
		const brut = [
			'From: a@exemple.fr', 'Subject: pj', 'Content-Type: multipart/mixed; boundary=zz', '',
			'--zz', 'Content-Type: text/plain; charset=utf-8', '', 'Voir joint.', '',
			'--zz', 'Content-Type: application/pdf; name="contrat.pdf"', 'Content-Disposition: attachment; filename="contrat.pdf"', 'Content-Transfer-Encoding: base64', '', Buffer.from('%PDF-1.4 faux').toString('base64'), '',
			'--zz', 'Content-Type: image/png', 'Content-Disposition: attachment; filename="logo.png"', 'Content-Transfer-Encoding: base64', '', Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'), '',
			'--zz--', '',
		].join('\r\n');
		const d = await eml.extraire('a.eml', octets(brut));
		expect(d.pieces.map((p) => [p.nom, p.type])).toEqual([['contrat.pdf', 'application/pdf'], ['logo.png', 'image/png']]);
		expect(new TextDecoder().decode(await d.pieces[0]!.contenu())).toBe('%PDF-1.4 faux');
		expect([...(await d.pieces[1]!.contenu())]).toEqual([0x89, 0x50, 0x4e, 0x47]);
		expect(d.pieces.map((p) => p.taille)).toEqual([13, 4]);
		expect(d.pieces.map((p) => p.ecartee)).toEqual([null, null]);
	});

	it('une pièce jointe au-delà de la limite des pièces (abaissée ici) est écartée, avec sa raison', async () => {
		expect(TAILLE_MAX_PIECE).toBe(TAILLE_MAX_PDF);
		const gros = Buffer.alloc(4096, 65).toString('base64').replace(/(.{76})/g, '$1\r\n');
		const brut = ['From: a@exemple.fr', 'Subject: gros', 'Content-Type: multipart/mixed; boundary=zz', '', '--zz', 'Content-Type: text/plain', '', 'x', '--zz', 'Content-Type: application/octet-stream; name="g.bin"', 'Content-Disposition: attachment; filename="g.bin"', 'Content-Transfer-Encoding: base64', '', gros, '--zz--', ''].join('\r\n');
		const d = await extracteurEmail('eml', { pieceMax: 4000 }).extraire('a.eml', octets(brut));
		expect(d.pieces.map((p) => [p.nom, p.ecartee])).toEqual([['g.bin', 'plus de 3,9 Ko']]);
	});

	it('sans en-têtes exploitables : titre = nom du fichier, pas d’exception', async () => {
		const d = await eml.extraire('dossier/Mail brut.eml', octets('\r\njuste du texte\r\n'));
		expect(d.titre).toBe('Mail brut');
		expect(d.date).toBeNull();
		expect(d.auteur).toBeNull();
		expect(d.markdown).toContain('date inconnue — auteur inconnu');
	});
});

describe('.mbox', () => {
	const trois = () =>
		enMbox([
			message({ id: '<a1@x>', sujet: 'Fil A', date: 'Mon, 02 Mar 2026 10:00:00 +0000', corps: 'Premier A' }),
			message({ id: '<b1@x>', sujet: 'Fil B', date: 'Mon, 02 Mar 2026 11:00:00 +0000', corps: 'Premier B' }),
			message({ id: '<a2@x>', sujet: 'Re: Fil A', reponseA: '<a1@x>', de: 'Alice <alice@exemple.fr>', date: 'Tue, 03 Mar 2026 09:00:00 +0000', corps: 'Réponse A\n\nLe 2 mars 2026, Marc a écrit :\n> Premier A' }),
			message({ id: '<c1@x>', sujet: 'Fil C', date: 'Wed, 04 Mar 2026 09:00:00 +0000', corps: 'Premier C' }),
			message({ id: '<b2@y>', sujet: 'TR: RE: fil b', date: 'Wed, 04 Mar 2026 12:00:00 +0000', corps: 'Suite B par sujet' }),
		]);

	it('3 fils : trois documents ; fils reconstitués par In-Reply-To et par sujet', async () => {
		const docs = await mbox.extraireTout!('x.mbox', octets(trois()));
		expect(docs.map((d) => d.titre)).toEqual(['Fil A', 'Fil B', 'Fil C']);
		expect(docs.map((d) => d.markdown.match(/^## /gmu)!.length)).toEqual([2, 2, 1]);
		// clé stable : Message-ID du premier message de chaque fil
		expect(docs.map((d) => d.cle)).toEqual(['<a1@x>', '<b1@x>', '<c1@x>']);
		expect(docs[0]!.markdown).toBe('# Fil A\n\n## 2026-03-02T10:00:00Z — Marc Dupont <marc@exemple.fr>\n\nPremier A\n\n## 2026-03-03T09:00:00Z — Alice <alice@exemple.fr>\n\nRéponse A\n');
		expect(docs[0]).toMatchObject({ format: 'mbox', auteur: 'Marc Dupont <marc@exemple.fr>', date: '2026-03-02' });
	});

	it('extraire : un seul document, fils sous des titres « # sujet »', async () => {
		const d = await mbox.extraire('boite.mbox', octets(trois()));
		expect(d.titre).toBe('boite');
		expect(d.markdown.match(/^# /gm)).toHaveLength(3);
		expect(d.markdown.match(/^## /gmu)).toHaveLength(5);
		expect(d.cle).toBeUndefined();
	});

	it('les pièces jointes suivent leur fil', async () => {
		const pj = ['From: a@exemple.fr', 'Subject: Fil PJ', 'Message-ID: <p@x>', 'Content-Type: multipart/mixed; boundary=zz', '', '--zz', 'Content-Type: text/plain', '', 'avec pj', '--zz', 'Content-Type: application/pdf', 'Content-Disposition: attachment; filename="a.pdf"', 'Content-Transfer-Encoding: base64', '', Buffer.from('pdf').toString('base64'), '--zz--', ''].join('\n');
		const docs = await mbox.extraireTout!('x.mbox', octets(enMbox([message({ id: '<z@x>', sujet: 'Sans pj', corps: 'x' }), pj])));
		expect(docs.map((d) => d.pieces.length)).toEqual([0, 1]);
	});

	it('mboxrd : « >From » rétabli, « From » dans un corps (sans ligne vide avant) ne coupe pas', async () => {
		const m1 = message({ id: '<1@x>', sujet: 'A', corps: 'ligne\r\n>From le début\r\n>>From encore\r\nFrom nous deux sans coupure' });
		const parts = await decouperMbox(octets(enMbox([m1, message({ id: '<2@x>', sujet: 'B', corps: 'b' })])));
		expect(parts).toHaveLength(2);
		const texte = new TextDecoder().decode(parts[0]);
		expect(texte).toContain('\nFrom le début\n');
		expect(texte).toContain('\n>From encore\n');
		expect(texte).toContain('\nFrom nous deux sans coupure');
	});

	it('mboxrd sur les octets : en tête du message, après \\n ou \\r ; ailleurs rien ; rien à rétablir → les mêmes octets, sans copie', () => {
		const de = (t: string) => Uint8Array.from(Buffer.from(t, 'latin1'));
		const vers = (o: Uint8Array) => Buffer.from(o).toString('latin1');
		expect(vers(retablirFrom(de('>From a\n>>From b\r>From c\r\nx >From d\n>Frome e\n>>> f\n>')))).toBe('From a\n>From b\rFrom c\r\nx >From d\n>Frome e\n>>> f\n>');
		const sans = de('a > b\n>> cité\nFrom x\n');
		expect(retablirFrom(sans)).toBe(sans);
	});

	it('CRLF : en-têtes conservés, séparateurs reconnus', async () => {
		const brut = enMbox([message({ id: '<1@x>', sujet: 'Un', corps: 'a' }), message({ id: '<2@x>', sujet: 'Deux', corps: 'b' })]).replace(/\n/g, '\r\n');
		const docs = await mbox.extraireTout!('x.mbox', octets(brut));
		expect(docs.map((d) => d.titre)).toEqual(['Un', 'Deux']);
		expect(docs[0]!.auteur).toBe('Marc Dupont <marc@exemple.fr>');
	});

	it('« From … » dans un corps après ligne vide : seul un vrai séparateur découpe', async () => {
		const m1 = message({ id: '<1@x>', sujet: 'Un', corps: 'début\n\nFrom now on, on fait ainsi.\n\nFrom Marc Mon Mar 2 faux séparateur\nfin' });
		const parts = await decouperMbox(octets(enMbox([m1, message({ id: '<2@x>', sujet: 'Deux', corps: 'b' })])));
		expect(parts).toHaveLength(2);
		expect(new TextDecoder().decode(parts[0])).toContain('From now on, on fait ainsi.');
		const docs = await mbox.extraireTout!('x.mbox', octets(enMbox([m1])));
		expect(docs).toHaveLength(1);
		expect(docs[0]!.markdown).toContain('From now on');
	});

	it('noms de pièces jointes assainis', async () => {
		const brut = ['From: a@exemple.fr', 'Subject: s', 'Content-Type: multipart/mixed; boundary=zz', '', '--zz', 'Content-Type: text/plain', '', 'x', '--zz', 'Content-Type: application/pdf', 'Content-Disposition: attachment; filename="..\\..\\etc\\pass..wd.pdf"', 'Content-Transfer-Encoding: base64', '', Buffer.from('p').toString('base64'), '--zz--', ''].join('\r\n');
		const d = await eml.extraire('a.eml', octets(brut));
		expect(d.pieces[0]!.nom).not.toMatch(/[\\/]|\.\./);
		expect(d.pieces[0]!.nom).toMatch(/pass\.wd\.pdf$/);
		const p2 = await eml.extraire('a.eml', octets(brut.replace(/filename=".*"/, 'filename=".."')));
		expect(p2.pieces[0]!.nom).toBe('piece-jointe-1.pdf');
	});

	it('mbox vide : refus lisible', async () => {
		await expect(mbox.extraireTout!('x.mbox', octets('rien du tout'))).rejects.toThrow(ErreurExtraction);
	});

	it('2 000 messages (~10 Mo) en moins de 5 s', async () => {
		const corps = 'Lorem ipsum dolor sit amet. '.repeat(170);
		const msgs = Array.from({ length: 2000 }, (_, i) => message({ id: `<m${i}@x>`, sujet: `Sujet ${i}`, corps }));
		const brut = octets(enMbox(msgs));
		expect(brut.taille).toBeGreaterThan(9_000_000);
		const t0 = performance.now();
		const docs = await mbox.extraireTout!('gros.mbox', brut);
		expect(docs).toHaveLength(2000);
		expect(performance.now() - t0).toBeLessThan(5000);
	}, 30_000);
});

it('Latin-1 brut dans un .mbox est préservé', async () => {
	const m = ['From: a@exemple.fr', 'Subject: l', 'Content-Type: text/plain; charset=iso-8859-1', 'Content-Transfer-Encoding: 8bit', '', 'été', ''].join('\n');
	const docs = await mbox.extraireTout!('x.mbox', lat1(`From MAILER-DAEMON Mon Mar  2 10:00:00 2026\n${m}`));
	expect(docs[0]!.markdown).toContain('été');
});

describe('pièces jointes : position et verdict pris au balayage', () => {
	it('une pièce trop grosse garde sa position (les suivantes ne se décalent pas) et dit pourquoi elle est écartée', async () => {
		const gros = Buffer.alloc(300, 0x61).toString('base64');
		const petit = Buffer.from('bonjour').toString('base64');
		const brut = [
			'From: a@x', 'Subject: S', 'Message-ID: <s@x>', 'Content-Type: multipart/mixed; boundary=zz', '',
			'--zz', 'Content-Type: text/plain', '', 'Corps.', '',
			'--zz', 'Content-Type: text/plain; name="gros.txt"', 'Content-Disposition: attachment; filename="gros.txt"', 'Content-Transfer-Encoding: base64', '', gros, '',
			'--zz', 'Content-Type: text/plain; name="petit.txt"', 'Content-Disposition: attachment; filename="petit.txt"', 'Content-Transfer-Encoding: base64', '', petit, '',
			'--zz--', '',
		].join('\r\n');
		const doc = await extracteurEmail('eml', { pieceMax: 100 }).extraire('a.eml', octets(brut));
		expect(doc.pieces.map((p) => [p.nom, p.repere.rang, p.ecartee === null])).toEqual([['gros.txt', 0, false], ['petit.txt', 1, true]]);
		expect(doc.pieces[0]!.ecartee).toMatch(/^plus de /u);
	});

	it('une pièce binaire sans extracteur est écartée au balayage ; aucune pièce ne garde son échantillon', async () => {
		const image = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]).toString('base64');
		const texte = Buffer.from('bonjour').toString('base64');
		const brut = [
			'From: a@x', 'Subject: S', 'Message-ID: <s@x>', 'Content-Type: multipart/mixed; boundary=zz', '',
			'--zz', 'Content-Type: text/plain', '', 'Corps.', '',
			'--zz', 'Content-Type: image/png; name="image.png"', 'Content-Disposition: attachment; filename="image.png"', 'Content-Transfer-Encoding: base64', '', image, '',
			'--zz', 'Content-Type: text/plain; name="note.txt"', 'Content-Disposition: attachment; filename="note.txt"', 'Content-Transfer-Encoding: base64', '', texte, '',
			'--zz--', '',
		].join('\r\n');
		const doc = await eml.extraire('a.eml', octets(brut));
		expect(doc.pieces.map((p) => [p.nom, p.ecartee])).toEqual([['image.png', RAISON_NON_CHERCHABLE], ['note.txt', null]]);
		for (const piece of doc.pieces) expect(Object.values(piece).some((v) => v instanceof Uint8Array)).toBe(false);
	});
});
