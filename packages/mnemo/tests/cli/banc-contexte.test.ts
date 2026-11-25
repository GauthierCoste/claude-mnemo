import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gestesEnTexte } from '../../src/adaptateurs/cli/banc-contexte.ts';
import { trouverRacine } from '../../src/adaptateurs/cli/racine.ts';
import { compterGestes } from '../../src/domaine/gestes.ts';
import { etatParesseux } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { ENV_TEST } from '../aides/env-test.ts';

const MAIN = join(import.meta.dirname, '../../src/adaptateurs/cli/main.ts');

function mnemo(cwd: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
	return new Promise((resoudre) => {
		execFile(process.execPath, [MAIN, ...args], { cwd, env: { ...ENV_TEST, TMPDIR: cwd } }, (erreur, out, err) => {
			resoudre({ code: erreur ? (erreur.code as number) : 0, out, err });
		});
	});
}

describe('mnemo banc contexte --gestes', () => {
	it('texte : une ligne pour tous les gestes, puis une par fiche, sans aucun texte de message', () => {
		const comptes = compterGestes([
			{ geste: 'ecartee_ici', fiche: 'b.md', nombre: 1 },
			{ geste: 'injectee_main', fiche: 'a.md', nombre: 1 },
			{ geste: 'lue_apres_carte', fiche: 'a.md', nombre: 1 },
		]);
		expect(gestesEnTexte(comptes).split('\n')).toEqual([
			'Gestes : 3 (injectee_main 1, ecartee_ici 1, ecartee_toujours 0, retablie 0, lue_apres_carte 1, injectee_auto 0)',
			'  a.md : 2 (injectee_main 1, lue_apres_carte 1)',
			'  b.md : 1 (ecartee_ici 1)',
		]);
	});

	it('de bout en bout : comptes du journal de la mémoire courante, en texte et en JSON ; option inconnue refusée', async () => {
		const d = await dossierTemporaire();
		expect((await mnemo(d, 'init')).code).toBe(0);
		const memoire = join(d, '_mnemo');
		const racine = trouverRacine(memoire)!;
		const etat = etatParesseux(racine);
		try {
			await etat.creer({ id: 's1', profil: 'dev', dossier: '', position: '', projet: 'divers', objectif: null, etat: 'attend', creeeMs: 1, majMs: 1, arretAttendu: null, bilanDemandeMs: null, commitDebut: null, branche: null, pid: null });
			await etat.noterMessagePorteur('s1', 'un message privé');
			await etat.noterGeste({ geste: 'injectee_main', session: 's1', fiche: 'notes/a.md', empreinte: null, horodatageMs: 1 });
			await etat.noterGeste({ geste: 'ecartee_ici', session: 's1', fiche: 'notes/b.md', empreinte: null, horodatageMs: 2 });
			await etat.noterGeste({ geste: 'ecartee_ici', session: 's1', fiche: 'notes/b.md', empreinte: null, horodatageMs: 3 });
		} finally {
			etat.fermer();
		}
		const texte = await mnemo(memoire, 'banc', 'contexte', '--gestes');
		expect(texte.code).toBe(0);
		expect(texte.out).toContain('Gestes : 3 (injectee_main 1, ecartee_ici 2,');
		expect(texte.out).toContain('  notes/b.md : 2 (ecartee_ici 2)');
		expect(texte.out).not.toContain('un message privé');
		const json = await mnemo(memoire, 'banc', 'contexte', '--gestes', '--json');
		expect(json.code).toBe(0);
		expect(JSON.parse(json.out)).toMatchObject({ total: 3, parGeste: { injectee_main: 1, ecartee_ici: 2 }, parFiche: [{ fiche: 'notes/b.md', total: 2 }, { fiche: 'notes/a.md', total: 1 }] });
		expect((await mnemo(memoire, 'banc', 'contexte', '--gestes', '--bidule')).code).toBe(2);
	}, 60_000);
});
