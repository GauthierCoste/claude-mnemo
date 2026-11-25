import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trouverRacine } from '../../src/adaptateurs/cli/racine.ts';
import { compterGestes } from '../../src/domaine/gestes.ts';
import { etatParesseux } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { ENV_TEST } from '../aides/env-test.ts';
import { gestesEnTexte, lireCasContexte, lireOptionsContexte } from '../../src/adaptateurs/cli/banc-contexte.ts';
import { ecranDeJugement } from '../../src/adaptateurs/cli/banc-juger.ts';
import type { CasContexte } from '../../src/application/banc-contexte.ts';
import { prochaine } from '../../src/application/banc-juger.ts';

const JUGE: CasContexte = {
	nom: 'abcdef12 #3',
	position: 'projets/Vitrail',
	message: 'et pour la cuisson des grisailles ?',
	premier: false,
	attendues: [],
	interdites: [],
	silence: false,
	session: 'abcdef1234',
	rang: 3,
	precedent: 'parle-moi du chantier de vitrail',
	candidates: [
		{
			chemin: 'pratiques/cuisson-grisailles.md',
			titre: 'Cuisson des grisailles',
			ligne: 'Températures et durées de cuisson.',
			listes: ['sens', 'reranker'],
			signaux: { seule: { logit: 2.5, cosinus: 0.71, cosinusRelatif: 0.12, bm25Relatif: 1 } },
		},
	],
	jugements: {},
};

describe('banc-contexte.json', () => {
	it('relit à l’identique un cas jugé (session, rang, message d’avant, candidates, signaux, jugements)', () => {
		const avecJugement = { ...JUGE, jugements: { 'pratiques/cuisson-grisailles.md': 'pertinente' as const }, saute: true };
		expect(lireCasContexte(JSON.stringify([avecJugement]))).toEqual([avecJugement]);
	});

	it('relit l’heure du message, la date d’extraction, les modèles, les injections à la main, l’empreinte et le hors pile', () => {
		const complet: CasContexte = {
			...JUGE,
			horodatageMs: 1_700_000_000_000,
			extraitLe: '2026-11-25T10:00:00.000Z',
			modeles: { sens: true, reranker: false },
			injectionsManuelles: [{ chemin: 'pratiques/four.md', messages: 2 }],
			candidates: [{ ...JUGE.candidates![0]!, empreinte: 'abc123', horsPile: true }],
		};
		expect(lireCasContexte(JSON.stringify([complet]))).toEqual([complet]);
	});

	it('signaux : signal de session et a priori relus s’ils sont là, bm25 relatif null relu null ; absents : rien d’ajouté', () => {
		const signaux = { seule: { logit: null, cosinus: 0.7, cosinusRelatif: 0.1, bm25Relatif: null, signalSession: 0.25, apriori: -0.3 } };
		const avec = { ...JUGE, candidates: [{ ...JUGE.candidates![0]!, signaux }] };
		expect(lireCasContexte(JSON.stringify([avec]))).toEqual([avec]);
		// un fichier d'avant : ni signal de session ni a priori, bm25 relatif toujours un nombre
		expect(lireCasContexte(JSON.stringify([JUGE]))[0]!.candidates![0]!.signaux.seule).toEqual({ logit: 2.5, cosinus: 0.71, cosinusRelatif: 0.12, bm25Relatif: 1 });
	});

	it('un ancien cas étiqueté reste lisible, sans champ ajouté', () => {
		const ancien = { nom: 'n', position: 'p', message: 'm', premier: true, attendues: ['A.md'], interdites: [], silence: false };
		expect(lireCasContexte(JSON.stringify([ancien]))).toEqual([ancien]);
	});

	it('jugement inconnu : erreur lisible', () => {
		expect(() => lireCasContexte(JSON.stringify([{ ...JUGE, jugements: { 'a.md': 'peut-être' } }]))).toThrow('jugement inconnu');
	});
});

describe('options de mnemo banc contexte', () => {
	it('--extraire avec ou sans session, --nombre', () => {
		expect(lireOptionsContexte(['--extraire'])).toMatchObject({ extraire: true, session: null, nombre: null });
		expect(lireOptionsContexte(['--extraire', 'abc', '--nombre', '120'])).toMatchObject({ extraire: true, session: 'abc', nombre: 120 });
		expect(lireOptionsContexte(['--juger'])).toMatchObject({ juger: true });
		expect(lireOptionsContexte(['--extraire', '--par-session', '10'])).toMatchObject({ parSession: 10 });
		expect(lireOptionsContexte(['--completer'])).toMatchObject({ completer: true });
		expect(lireOptionsContexte([])).toMatchObject({ empreintes: 'exclure' });
		expect(lireOptionsContexte(['--empreintes', 'garder'])).toMatchObject({ empreintes: 'garder' });
		expect(lireOptionsContexte(['--gestes', '--json'])).toMatchObject({ gestes: true, json: true });
	});

	it('combinaisons refusées', () => {
		expect(() => lireOptionsContexte(['--juger', '--extraire'])).toThrow('ne vont pas ensemble');
		expect(() => lireOptionsContexte(['--nombre', '3'])).toThrow('--nombre');
		expect(() => lireOptionsContexte(['--extraire', '--nombre', 'x'])).toThrow('Nombre');
		expect(() => lireOptionsContexte(['--juger', '--json'])).toThrow('--json');
		expect(() => lireOptionsContexte(['--inconnue'])).toThrow('Option inconnue');
		expect(() => lireOptionsContexte(['--completer', '--extraire'])).toThrow('ne vont pas ensemble');
		expect(() => lireOptionsContexte(['--completer', '--par-session', '3'])).toThrow('--par-session');
		expect(() => lireOptionsContexte(['--empreintes', 'oublier'])).toThrow('exclure');
		expect(() => lireOptionsContexte(['--gestes', '--juger'])).toThrow('--gestes');
	});
});

describe('écran de jugement', () => {
	it('montre la progression, le message et celui d’avant, puis titre, chemin et première ligne ; jamais une note ni un rang', () => {
		const ecran = ecranDeJugement([JUGE], prochaine([JUGE])!, { couleurs: false });
		expect(ecran).toContain('0 / 1 messages jugés · fiche 1 / 1');
		expect(ecran).toContain('session abcdef12 · message porteur n° 3 · position projets/Vitrail');
		expect(ecran).toContain("Message d'avant : parle-moi du chantier de vitrail");
		expect(ecran).toContain('et pour la cuisson des grisailles ?');
		expect(ecran).toContain('Cuisson des grisailles');
		expect(ecran).toContain('pratiques/cuisson-grisailles.md');
		expect(ecran).toContain('Températures et durées de cuisson.');
		expect(ecran).toContain('o oui · n non · i indécis');
		expect(ecran).not.toMatch(/2\.5|0\.71|reranker|logit/u);
	});

	it('un long message est coupé à l’écran, le reste compté', () => {
		const long = { ...JUGE, message: 'x'.repeat(2000) };
		expect(ecranDeJugement([long], prochaine([long])!, { couleurs: false })).toContain('(500 caractères de plus)');
	});
});

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
