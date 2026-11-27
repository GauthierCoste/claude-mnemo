// @vitest-environment happy-dom
import { ROUTES, type VueEntrainement } from '@mnemo/contrat';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ErreurApi } from '../../src/client/api.ts';
import { Entrainer } from '../../src/composants/memoire/entrainer/Entrainer.tsx';
import { etapeUtile, jugesDepuisApprentissage, lignesDeNote, suiteDuVerdict } from '../../src/memoire/entrainement.ts';
import { FournisseurNavigation } from '../../src/navigation.tsx';
import { creerFauxClient, rendreAvecClient } from '../aides/faux-client.tsx';

afterEach(cleanup);

const REFUSE = 'Refusé : la note ordonne le classement, sans %';
const DEPART = 'Note de départ, à entraîner : elle ordonne le classement, sans %';

/** Une vue de l'entraînement : rien de préparé, note de départ, Claude trouvé ; `o` la change. */
function vue(o: Partial<Omit<VueEntrainement, 'banc'>> & { banc?: Partial<VueEntrainement['banc']> } = {}): VueEntrainement {
	const { banc, ...reste } = o;
	return {
		note: {
			niveaux: (['complets', 'sens'] as const).map((niveau) => ({ niveau, etat: 'depart', origine: 'depart', date: '2026-11-25T18:00:00.000Z', seuil: null, verdict: DEPART, criteres: [], refus: [] })),
			avant: false,
		},
		// sans apprentissage, tous les messages validés sont nouveaux
		banc: { messages: 0, valides: 0, aJuger: 0, aRelire: 0, aPrejuger: 0, silences: 0, sautes: 0, paires: 0, nouveauxDepuisApprentissage: banc?.valides ?? 0, ...banc },
		tache: null,
		historique: [],
		juge: { disponible: true },
		resultat: null,
		...reste,
	};
}

const RESULTAT: VueEntrainement['resultat'] = {
	date: '2026-11-26T10:00:00.000Z',
	remplace: true,
	messages: 12,
	sessions: 4,
	niveaux: [
		{
			niveau: 'complets',
			accepte: false,
			verdict: REFUSE,
			criteres: ['trop peu de fiches que Mnemo injecterait (note au-dessus de 90 %) : 2, il en faut 25'],
			refus: ['2 injections simulées (au moins 25)'],
			paires: 40,
			fiabilite: [{ de: 0.8, a: 1, paires: 6, pMoyen: 0.86, frequence: 0.5 }],
		},
		{ niveau: 'sens', accepte: true, verdict: 'Accepté : les % sont justes et Mnemo injecte seul au-dessus de 90 %', criteres: [], refus: [], paires: 40, fiabilite: [] },
	],
};

function monter(v: VueEntrainement, envois: Record<string, unknown> = {}) {
	const faux = creerFauxClient({ [ROUTES.entrainement]: v, [ROUTES.entrainementMessage]: { message: null }, ...envois });
	rendreAvecClient(
		<FournisseurNavigation vueInitiale="memoire" ongletMemoireInitial="entrainer">
			<Entrainer />
		</FournisseurNavigation>,
		faux.client,
	);
	return faux;
}

const etape = async (nom: RegExp) => (await screen.findByRole('heading', { name: nom })).closest('li')!;

describe('Mémoire › Entraîner', () => {
	it('rien de préparé : note de départ en une ligne pour les deux niveaux ; Préparer mis en avant ; Juger, Claude et Apprendre indisponibles avec leur raison', async () => {
		monter(vue());
		const ligne = (await screen.findByText('Complets et Sens seul')).closest('li')!;
		expect(ligne.textContent).toContain('De départ');
		expect(ligne.textContent).toContain('Elle ordonne le classement, sans %');
		expect(ligne.textContent).toContain('livrée avec Mnemo');
		const preparer = await etape(/Préparer des messages/);
		expect(preparer.getAttribute('aria-current')).toBe('step');
		expect(within(preparer).getByText('validés sur ~100 conseillés', { exact: false })).toBeTruthy();
		const juger = await etape(/Juger/);
		const boutonJuger = within(juger).getByRole('button', { name: 'Juger' });
		expect(boutonJuger.getAttribute('aria-disabled')).toBe('true');
		expect(document.getElementById(boutonJuger.getAttribute('aria-describedby')!)!.textContent).toBe('Préparer d’abord des messages.');
		expect(within(juger).getByRole('button', { name: 'Pré-juger avec Claude' }).getAttribute('aria-disabled')).toBe('true');
		const apprendre = await etape(/Apprendre/);
		const boutonApprendre = within(apprendre).getByRole('button', { name: 'Apprendre la note' });
		expect(document.getElementById(boutonApprendre.getAttribute('aria-describedby')!)!.textContent).toContain('Aucun jugement validé');
		// ni résultat, ni historique, ni menu sans modèle d'avant
		expect(screen.queryByText('Dernier apprentissage')).toBeNull();
		expect(screen.queryByText('Historique')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Autres actions sur la note' })).toBeNull();
	});

	it('à juger : Juger mis en avant, « Relire (n) », « Accepter les sûres », coût du pré-jugement dit avant', async () => {
		monter(vue({ banc: { messages: 6, valides: 2, aJuger: 4, aRelire: 2, aPrejuger: 2, paires: 6 } }));
		const juger = await etape(/Juger/);
		expect(juger.getAttribute('aria-current')).toBe('step');
		expect(within(juger).getByRole('button', { name: 'Relire (2)' }).getAttribute('aria-disabled')).toBeNull();
		expect(within(juger).getByRole('button', { name: 'Accepter les sûres' })).toBeTruthy();
		expect(juger.textContent).toContain('2 appels à Claude Code, un par message, sur l’abonnement Claude.');
		expect(juger.textContent).toContain('dont 2 pré-jugés par Claude, à relire');
	});

	it('sans juge : Pré-juger indisponible, la raison du service dite', async () => {
		monter(vue({ banc: { messages: 3, aJuger: 3, aPrejuger: 3 }, juge: { disponible: false, raison: 'Claude Code introuvable.' } }));
		const juger = await etape(/Juger/);
		const claude = within(juger).getByRole('button', { name: 'Pré-juger avec Claude' });
		expect(claude.getAttribute('aria-disabled')).toBe('true');
		expect(document.getElementById(claude.getAttribute('aria-describedby')!)!.textContent).toBe('Claude Code introuvable.');
	});

	it('tâche en cours : progression, gestes qui lancent une tâche indisponibles (raison : la tâche), « Arrêter » appelle la route', async () => {
		const faux = monter(vue({ banc: { messages: 6, aJuger: 6, aPrejuger: 6, valides: 0 }, tache: { genre: 'prejuger', fait: 2, total: 6, depuis: '2026-11-26T10:00:00.000Z' } }), {
			[ROUTES.entrainementArreter]: vue({ banc: { messages: 6, aJuger: 6, aPrejuger: 4 } }),
		});
		const barre = await screen.findByRole('progressbar', { name: 'Pré-jugement par Claude' });
		expect(barre.getAttribute('aria-valuenow')).toBe('2');
		expect(barre.getAttribute('aria-valuemax')).toBe('6');
		expect(screen.getByText('2 sur 6', { exact: false })).toBeTruthy();
		const preparer = within(await etape(/Préparer des messages/)).getByRole('button', { name: 'Préparer' });
		expect(preparer.getAttribute('aria-disabled')).toBe('true');
		expect(document.getElementById(preparer.getAttribute('aria-describedby')!)!.textContent).toContain('Pré-jugement par Claude');
		// juger reste permis pendant une tâche
		expect(within(await etape(/Juger/)).getByRole('button', { name: 'Juger' }).getAttribute('aria-disabled')).toBeNull();
		await act(async () => screen.getByRole('button', { name: 'Arrêter' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith(ROUTES.entrainementArreter, undefined);
		await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
	});

	it('la vue diffusée (`entrainement`) remplace la vue lue', async () => {
		const faux = monter(vue());
		await screen.findByText('0 message préparé');
		act(() => faux.connexion.emettre({ type: 'entrainement', etat: vue({ banc: { messages: 5, aJuger: 5, aPrejuger: 5 } }) }));
		expect(await screen.findByText('5 messages préparés')).toBeTruthy();
	});

	it('erreur de la dernière tâche : dite en alerte', async () => {
		monter(vue({ derniereErreur: 'Aucun message nouveau dans le journal des sessions.' }));
		const alerte = await screen.findByRole('alert');
		expect(alerte.textContent).toContain('La dernière tâche a échoué.');
		expect(alerte.textContent).toContain('Aucun message nouveau');
	});

	it('résultat : remplacé, critères manqués en clair, table de fiabilité repliée ; historique avec origine, états, erreur', async () => {
		const note = vue().note.niveaux.map((n) => ({ ...n, etat: 'refuse' as const, origine: 'appris' as const, verdict: REFUSE }));
		monter(
			vue({
				note: { niveaux: note, avant: true },
				banc: { messages: 12, valides: 12, paires: 40, nouveauxDepuisApprentissage: 0 },
				resultat: RESULTAT,
				historique: [
					{ date: '2026-11-26T11:00:00.000Z', origine: 'automatique', verdicts: { complets: 'refuse', sens: 'refuse' }, remplace: false, erreur: 'Le reranker n’a pas répondu.' },
					{ date: '2026-11-26T10:00:00.000Z', origine: 'manuel', verdicts: { complets: 'refuse', sens: 'accepte' }, remplace: true },
				],
			}),
		);
		const resultat = (await screen.findByRole('heading', { name: 'Dernier apprentissage' })).closest('section')!;
		expect(resultat.textContent).toContain('Son modèle a remplacé le modèle d’alors.');
		expect(resultat.textContent).toContain('trop peu de fiches que Mnemo injecterait (note au-dessus de 90 %) : 2, il en faut 25');
		expect(resultat.textContent).toContain('Acceptée');
		const details = resultat.querySelector('details')!;
		expect(details.open).toBe(false);
		expect(within(details).getByText('86 %')).toBeTruthy();
		// le total du titre est celui des lignes (des jugements fiche × message), pas les paires d'apprentissage
		expect(details.querySelector('summary')!.textContent).toBe('Table de fiabilité (6 jugements)');
		const historique = screen.getByRole('heading', { name: 'Historique' }).closest('section')!;
		const lignes = within(historique).getAllByRole('row');
		expect(lignes[1]!.textContent).toContain('Automatique');
		expect(lignes[1]!.textContent).toContain('Gardé (échec)');
		expect(lignes[2]!.textContent).toBe('Le reranker n’a pas répondu.');
		expect(lignes[3]!.textContent).toContain('Manuel');
		expect(lignes[3]!.textContent).toContain('Remplacé');
		// tout est jugé, l'apprentissage date d'avant : rien de neuf, Préparer est mis en avant, la carte Apprendre le dit
		expect((await etape(/Préparer des messages/)).getAttribute('aria-current')).toBe('step');
		expect((await etape(/Apprendre/)).textContent).toContain('Aucun message jugé depuis le dernier apprentissage');
	});

	it('résultat refusé partout qui remplace : dit « toujours refusé », pas un succès', async () => {
		monter(vue({ resultat: { ...RESULTAT, niveaux: RESULTAT!.niveaux.map((n) => ({ ...n, accepte: false })) } }));
		const resultat = (await screen.findByRole('heading', { name: 'Dernier apprentissage' })).closest('section')!;
		expect(resultat.textContent).toContain('Toujours refusé : ce modèle remplace celui d’alors, sans % non plus, et ordonne le classement.');
		expect(resultat.textContent).not.toContain('Son modèle a remplacé');
	});

	it('résultat gardé : le verdict en clair de chaque niveau (il diffère de la note actuelle)', async () => {
		monter(vue({ resultat: { ...RESULTAT, remplace: false } }));
		const resultat = (await screen.findByRole('heading', { name: 'Dernier apprentissage' })).closest('section')!;
		expect(resultat.textContent).toContain('Le modèle d’alors a été gardé.');
		expect(resultat.textContent).toContain('La note ordonne le classement, sans %');
		expect(resultat.textContent).toContain('Les % sont justes et Mnemo injecte seul au-dessus de 90 %');
	});

	it('Préparer envoie le nombre choisi ; hors bornes, rien n’est envoyé et la règle est dite', async () => {
		const faux = monter(vue(), { [ROUTES.entrainementPreparer]: vue({ tache: { genre: 'preparer', fait: 0, total: 12, depuis: '2026-11-26T10:00:00.000Z' } }) });
		const carte = await etape(/Préparer des messages/);
		const champ = within(carte).getByRole('spinbutton', { name: 'Nombre de messages à préparer' });
		fireEvent.change(champ, { target: { value: '500' } });
		await act(async () => within(carte).getByRole('button', { name: 'Préparer' }).click());
		expect(faux.api.envoyer).not.toHaveBeenCalled();
		expect(carte.textContent).toContain('De 1 à 200 messages.');
		fireEvent.change(champ, { target: { value: '12' } });
		await act(async () => within(carte).getByRole('button', { name: 'Préparer' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith(ROUTES.entrainementPreparer, { nombre: 12 });
		expect(await screen.findByRole('progressbar', { name: 'Préparation des messages' })).toBeTruthy();
	});

	it('refus du service (409) : dit dans la carte du geste', async () => {
		monter(vue({ banc: { messages: 2, valides: 2, paires: 3 } }), {
			[ROUTES.entrainementApprendre]: () => {
				throw new ErreurApi('Une tâche est déjà en cours (préparer des messages) : attendre sa fin ou l’arrêter.', 409);
			},
		});
		const carte = await etape(/Apprendre/);
		await act(async () => within(carte).getByRole('button', { name: 'Apprendre la note' }).click());
		expect((await within(carte).findByRole('alert')).textContent).toContain('Une tâche est déjà en cours');
	});

	it('« Accepter les sûres » : le nombre validé, puis « Annuler » appelle la route', async () => {
		const faux = monter(vue({ banc: { messages: 4, aJuger: 4, aRelire: 2 } }), { [ROUTES.entrainementAccepterSures]: { acceptes: 1 }, [ROUTES.entrainementAnnuler]: { indice: 2 } });
		const carte = await etape(/Juger/);
		await act(async () => within(carte).getByRole('button', { name: 'Accepter les sûres' }).click());
		expect((await within(carte).findByRole('status')).textContent).toContain('1 message validé avec les propositions sûres.');
		await act(async () => within(carte).getByRole('button', { name: 'Annuler' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith(ROUTES.entrainementAnnuler);
		await waitFor(() => expect(within(carte).queryByRole('status')).toBeNull());
	});

	it('« Revenir au modèle d’avant » : dans le menu ⋯, avec son effet ; appelle la route', async () => {
		const faux = monter(vue({ note: { ...vue().note, avant: true } }), { [ROUTES.entrainementRevenir]: vue() });
		const menu = await screen.findByRole('button', { name: 'Autres actions sur la note' });
		await act(async () => menu.click());
		const item = screen.getByRole('menuitem', { name: /Revenir au modèle d’avant/ });
		expect(item.textContent).toContain('Remet le modèle remplacé par le dernier apprentissage.');
		await act(async () => item.click());
		expect(faux.api.envoyer).toHaveBeenCalledWith(ROUTES.entrainementRevenir, undefined);
		await waitFor(() => expect(screen.queryByRole('button', { name: 'Autres actions sur la note' })).toBeNull());
	});

	it('double clic sur « Préparer » : une seule demande, aucun refus affiché', async () => {
		let finir!: (v: VueEntrainement) => void;
		const faux = monter(vue(), { [ROUTES.entrainementPreparer]: () => new Promise<VueEntrainement>((r) => (finir = r)) });
		const carte = await etape(/Préparer des messages/);
		const bouton = within(carte).getByRole('button', { name: 'Préparer' });
		await act(async () => {
			bouton.click();
			bouton.click();
		});
		expect(faux.api.envoyer).toHaveBeenCalledTimes(1);
		await act(async () => finir(vue({ tache: { genre: 'preparer', fait: 0, total: 30, depuis: '2026-11-26T10:00:00.000Z' } })));
		expect(await screen.findByRole('progressbar', { name: 'Préparation des messages' })).toBeTruthy();
		expect(within(carte).queryByRole('alert')).toBeNull();
	});

	it('une tâche vite finie : sa fin diffusée avant la réponse n’est pas écrasée par la tâche « en cours » de la réponse', async () => {
		let finir!: (v: VueEntrainement) => void;
		const faux = monter(vue({ banc: { messages: 2, aJuger: 2, aPrejuger: 2 } }), { [ROUTES.entrainementPrejuger]: () => new Promise<VueEntrainement>((r) => (finir = r)) });
		const bouton = within(await etape(/Juger/)).getByRole('button', { name: 'Pré-juger avec Claude' });
		await act(async () => bouton.click());
		act(() => faux.connexion.emettre({ type: 'entrainement', etat: vue({ banc: { messages: 2, aJuger: 2, aRelire: 2 } }) }));
		await act(async () => finir(vue({ banc: { messages: 2, aJuger: 2, aPrejuger: 2 }, tache: { genre: 'prejuger', fait: 0, total: 2, depuis: '2026-11-26T10:00:00.000Z' } })));
		expect(screen.queryByRole('progressbar')).toBeNull();
		expect(screen.getByRole('button', { name: 'Relire (2)' })).toBeTruthy();
	});

	it('reconnexion : l’état est relu (une tâche finie pendant la coupure ne reste pas affichée)', async () => {
		let lue = vue({ banc: { messages: 2, aJuger: 2, aPrejuger: 2 }, tache: { genre: 'prejuger', fait: 1, total: 2, depuis: '2026-11-26T10:00:00.000Z' } });
		const faux = monter(vue(), { [ROUTES.entrainement]: () => structuredClone(lue) });
		await screen.findByRole('progressbar');
		lue = vue({ banc: { messages: 2, aJuger: 2, aRelire: 2 } });
		act(() => faux.connexion.passerA('reconnexion'));
		act(() => faux.connexion.passerA('ouverte'));
		await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
		expect(screen.getByRole('button', { name: 'Relire (2)' })).toBeTruthy();
	});

	it('tout est jugé : « Pré-juger avec Claude » renvoie à la raison de « Juger », sans coût affiché', async () => {
		monter(vue({ banc: { messages: 3, valides: 3, paires: 5 } }));
		const juger = await etape(/Juger/);
		const claude = within(juger).getByRole('button', { name: 'Pré-juger avec Claude' });
		expect(claude.getAttribute('aria-disabled')).toBe('true');
		expect(document.getElementById(claude.getAttribute('aria-describedby')!)!.textContent).toBe('Tous les messages préparés sont jugés.');
		expect(juger.textContent).not.toContain('propositions');
		expect(juger.textContent).not.toContain('appel');
	});

	it('« Juger » ouvre l’écran de jugement dans la page ; Échap y revient', async () => {
		monter(vue({ banc: { messages: 1, aJuger: 1 } }));
		const juger = within(await etape(/Juger/)).getByRole('button', { name: 'Juger' });
		await act(async () => juger.click());
		expect(await screen.findByRole('heading', { name: 'Rien à juger' })).toBeTruthy();
		act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
		expect(await screen.findByRole('heading', { name: 'Note de confiance' })).toBeTruthy();
		// le focus revient au geste principal de l'étape utile
		await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('list', { name: 'Étapes de l’entraînement' })).getByRole('button', { name: 'Juger' })));
	});

	it('retour de l’écran de jugement quand tout est jugé : le focus sur « Apprendre la note »', async () => {
		// un message à juger ; une fois répondu, tout est jugé : l'étape utile devient « Apprendre »
		let etat = vue({ banc: { messages: 2, valides: 1, aJuger: 1, paires: 3 } });
		const message = { indice: 1, message: 'Message fictif', precedent: null, candidates: [{ chemin: 'a.md', titre: 'a', ligne: '', synthese: '', proposition: null, jugement: null }], valide: false, silence: false, saute: false, aRelire: false, restants: 1 };
		monter(etat, {
			[ROUTES.entrainement]: () => etat,
			[ROUTES.entrainementMessage]: (_params: unknown, corps: unknown) => {
				if (corps === undefined) return { message };
				etat = vue({ banc: { messages: 2, valides: 2, aJuger: 0, paires: 4 } });
				return { suivant: null };
			},
		});
		const juger = within(await etape(/Juger/)).getByRole('button', { name: 'Juger' });
		await act(async () => juger.click());
		const valider = await screen.findByRole('button', { name: 'Valider' });
		await act(async () => valider.click());
		const revenir = await screen.findByRole('button', { name: 'Revenir à l’entraînement' });
		await act(async () => revenir.click());
		await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Apprendre la note' })));
	});
});

describe('règles de la page Entraîner', () => {
	it('verdict sans son premier mot ; niveaux regroupés seulement s’ils disent la même chose', () => {
		expect(suiteDuVerdict(REFUSE)).toBe('La note ordonne le classement, sans %');
		expect(suiteDuVerdict('sans deux-points')).toBe('sans deux-points');
		const n = vue().note.niveaux;
		expect(lignesDeNote(n).map((l) => l.niveaux)).toEqual([['complets', 'sens']]);
		expect(lignesDeNote([n[0]!, { ...n[1]!, etat: 'refuse', verdict: REFUSE }]).map((l) => l.niveaux)).toEqual([['complets'], ['sens']]);
	});

	it('étape utile : préparer, juger, apprendre (messages jugés depuis le dernier apprentissage), puis préparer encore', () => {
		const b = vue().banc;
		expect(etapeUtile({ banc: b })).toBe(1);
		expect(etapeUtile({ banc: { ...b, messages: 3, aJuger: 1 } })).toBe(2);
		expect(etapeUtile({ banc: { ...b, messages: 3, valides: 3, paires: 5, nouveauxDepuisApprentissage: 3 } })).toBe(3);
		expect(etapeUtile({ banc: { ...b, messages: 3, valides: 3, paires: 5, nouveauxDepuisApprentissage: 1 } })).toBe(3);
		// appris sur 2 messages retenus de 3 validés (le jeu en écarte un) : rien de nouveau, Apprendre n'est plus mis en avant
		expect(etapeUtile({ banc: { ...b, messages: 3, valides: 3, paires: 5, nouveauxDepuisApprentissage: 0 } })).toBe(1);
	});

	it('carte Apprendre : les messages jugés depuis le dernier apprentissage, dits seulement après un apprentissage', () => {
		expect(jugesDepuisApprentissage(vue({ banc: { valides: 3, nouveauxDepuisApprentissage: 3 } }))).toBeNull();
		const appris = vue({ banc: { valides: 3, nouveauxDepuisApprentissage: 0 }, resultat: { ...RESULTAT!, messages: 2 } });
		expect(jugesDepuisApprentissage(appris)).toBe('Aucun message jugé depuis le dernier apprentissage');
		expect(jugesDepuisApprentissage({ ...appris, banc: { ...appris.banc, nouveauxDepuisApprentissage: 2 } })).toBe('2 messages jugés depuis le dernier apprentissage');
		// un essai en échec n'est pas un apprentissage
		const echec = vue({ historique: [{ date: '2026-11-26T10:00:00.000Z', origine: 'automatique', verdicts: { complets: 'depart', sens: 'depart' }, remplace: false, erreur: 'panne' }] });
		expect(jugesDepuisApprentissage(echec)).toBeNull();
	});
});
