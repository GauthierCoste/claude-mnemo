import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contenuEnMemoire } from '../../src/application/contenu.ts';
import type { CibleExtraction } from '../../src/application/ports.ts';
import { extractionIsolee, TROP_LOURD } from '../../src/infra/extraction-isolee.ts';

const cible = (extra: Partial<CibleExtraction> = {}): CibleExtraction => ({ fiche: 'sources/a.md', fil: null, piece: null, positionPiece: null, titre: 'Doc', date: null, auteur: 'clé ghp_abcdefghijklmnopqrstuvwxyz0123456789', typeSource: 'contrat', resume: null, ...extra });
const octets = (t: string) => contenuEnMemoire(new TextEncoder().encode(t));
const FIXTURES = join(import.meta.dirname, '../fixtures/documents');

describe('extraction isolée (fil d\'exécution borné)', () => {
	it('extrait et découpe dans un fil à part ; métadonnées masquées et comptées', async () => {
		const [r] = await extractionIsolee().extraire('docs/a.md', octets('# A\n\n## Partie\n\nLe tapir mange.\n\npassword: hunter2secret\n'), [cible()]);
		expect(r).toMatchObject({ ok: true, secrets: 2 });
		if (!r!.ok) return;
		expect(r!.passages[0]).toMatchObject({ typeSource: 'contrat', titres: ['A', 'Partie'] });
		expect(r!.passages[0]!.texte).toContain('Le tapir mange.');
		expect(JSON.stringify(r)).not.toMatch(/hunter2secret|ghp_abc/u);
		expect(r!.sections[r!.passages[0]!.section]).toContain('## Partie');
	});

	it('PDF dans le fil ; PDF corrompu → motif, jamais d\'exception', async () => {
		const pdf = contenuEnMemoire(new Uint8Array(await readFile(join(FIXTURES, 'contrat.pdf'))));
		const [bon] = await extractionIsolee().extraire('docs/c.pdf', pdf, [cible()]);
		expect(bon!.ok).toBe(true);
		const corrompu = contenuEnMemoire(new Uint8Array(await readFile(join(FIXTURES, 'corrompu.pdf'))));
		const [mauvais] = await extractionIsolee().extraire('docs/x.pdf', corrompu, [cible()]);
		expect(mauvais).toMatchObject({ ok: false });
		expect((mauvais as { motif: string }).motif).toMatch(/PDF/u);
	});

	// Node n'arrête pas toujours proprement un fil qui dépasse son tas (V8 peut abattre tout le processus) : sur les machines de
	// CI, plus serrées, ce cas tue le processus de test. Gardé sur la machine de développement ; voir le risque dans decisions.md.
	it.skipIf(process.env.CI)('mémoire dépassée → « document trop lourd à extraire » pour chaque cible ; le processus continue', async () => {
		const gros = octets(`# G\n\n${'ligne courte\n'.repeat(2_000_000)}`);
		const r = await extractionIsolee({ memoireMo: 32 }).extraire('docs/g.md', gros, [cible(), cible({ fiche: 'sources/b.md' })]);
		expect(r).toEqual([{ ok: false, motif: TROP_LOURD }, { ok: false, motif: TROP_LOURD }]);
	});

	it('délai dépassé → arrêté, « document trop lourd à extraire »', async () => {
		const r = await extractionIsolee({ delaiMs: 1 }).extraire('docs/a.md', octets('# A\n\ntexte\n'), [cible()]);
		expect(r).toEqual([{ ok: false, motif: TROP_LOURD }]);
	});

	it('decouper : le fichier neuf découpé en parties dans le fil', async () => {
		const r = await extractionIsolee().decouper('docs/a.md', octets('# A\n\n## Partie\n\nLe tapir mange.\n'));
		expect(r).toMatchObject({ ok: true, format: 'markdown', autresPieces: [], parties: [{ fil: null, piece: null, titre: 'A', secrets: 0 }] });
	});

	it('fil impossible à créer (exception immédiate) → motif lisible, jamais d\'exception', async () => {
		const [r] = await extractionIsolee({ script: new URL('https://exemple.fr/x.js') }).extraire('docs/a.md', octets('# A\n'), [cible()]);
		expect(r).toEqual({ ok: false, motif: expect.stringMatching(/^extraction impossible : /u) });
	});

	it('ce que le fil écrit sur stdout/stderr est lu et jeté : il finit, rien ne bloque', async () => {
		const bavard = new URL(
			'data:text/javascript,import{parentPort}from"node:worker_threads";for(let i=0;i<2000;i++){console.log("x".repeat(10000));console.error("y".repeat(10000))}parentPort.postMessage({type:"resultat",resultat:{decoupe:{ok:false,motif:"fini"},aExtraire:[]}})',
		);
		expect(await extractionIsolee({ script: bavard }).decouper('docs/a.md', octets('# A\n'))).toEqual({ ok: false, motif: 'fini' });
	});
});
