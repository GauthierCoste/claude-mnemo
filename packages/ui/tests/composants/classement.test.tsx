// @vitest-environment happy-dom
import type { ClassementVue, CoupureInjectionVue, EcarteVue, EcarteeToujoursVue, EntreeServieVue, EtatModelesVue, InjectionVue, LueVue, SuggestionEcarteeToujoursVue } from '@mnemo/contrat';
import { act, cleanup, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErreurApi } from '../../src/client/api.ts';
import { ClassementEnDirect } from '../../src/composants/sessions/ClassementEnDirect.tsx';
import { FournisseurToast } from '../../src/composants/Toast.tsx';
import { creerFauxClient, rendreAvecClient } from '../aides/faux-client.tsx';
import { vueSelonReranker } from '../aides/modeles.ts';

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

const signaux = { cosinus: 0.7, cosinusRelatif: 0.2, bm25Relatif: 0.1, signalSession: 0 };
/** Une ligne du classement vivant (note calibrée `p`, ou null en ordre seul). */
const v = (id: string, titre: string, rang: number, p: number | null, o: Partial<ClassementVue> = {}): ClassementVue => ({ id, titre, note: p, servi: false, rang, p, signaux, raison: 'proche', ...o });
/** Une entrée classée ; `calibree` : la note est apprise et acceptée (des %). */
const entree = (horodatageMs: number, classement: ClassementVue[], o: Partial<EntreeServieVue> = {}): EntreeServieVue => ({
	session: 's1',
	moment: 'message',
	horodatageMs,
	ids: [],
	texte: '',
	ms: 1,
	sens: true,
	classement,
	muet: null,
	cartes: [],
	calibree: true,
	...o,
});

/** Aujourd'hui à h:m, heure locale. */
const A = (h: number, m: number) => {
	const d = new Date();
	d.setHours(h, m, 0, 0);
	return d.getTime();
};

const POSITION = 'projets/alpha/alpha.md';
/** La fiche de position injectée, Gamma injectée par Mnemo (94 %), puis le classement : Bêta 92 %, Delta 50 %, Epsilon 30 %. */
const CALIBRE = entree(A(14, 34), [v('g.md', 'Gamma', 1, 0.94, { servi: true, auto: true }), v('b.md', 'Bêta', 2, 0.92, { piste: true }), v('d.md', 'Delta', 3, 0.5, { raison: 'perimetre' }), v('e.md', 'Epsilon', 4, 0.3)], {
	ids: [POSITION, 'g.md'],
	titres: { [POSITION]: 'Alpha', 'g.md': 'Gamma' },
});

type Options = {
	ecartes?: EcarteVue[];
	entrees?: EntreeServieVue[];
	modeles?: EtatModelesVue['reranker'];
	lues?: LueVue[];
	injections?: InjectionVue[];
	coupures?: CoupureInjectionVue[];
	suggestions?: SuggestionEcarteeToujoursVue[];
	toujours?: EcarteeToujoursVue[];
	modifiable?: boolean;
	reactiver?: () => unknown;
};

/** Le composant, avec des entrées qu'on remplace comme le ferait un nouveau `servi`. */
function monter(o: Options = {}) {
	let ecartes = o.ecartes ?? [];
	let modeles = o.modeles ?? 'pret';
	let aServir: string[] = [];
	let toujours = o.toujours ?? [];
	const faux = creerFauxClient({
		'/api/modeles': () => vueSelonReranker(modeles),
		'/api/modeles/demarrer': () => {
			modeles = 'pret';
			return vueSelonReranker(modeles);
		},
		'/api/sessions/s1/ecartes': (_params: unknown, corps: { id?: string } | undefined) => {
			if (corps?.id) ecartes = [...ecartes, { id: corps.id, titre: corps.id === 'e.md' ? 'Epsilon' : corps.id, horodatageMs: 5 }];
			return { ecartes };
		},
		'DELETE /api/sessions/s1/ecartes': (params: Record<string, string> | undefined) => {
			ecartes = ecartes.filter((e) => e.id !== params?.['id']);
			return { ecartes };
		},
		'/api/sessions/s1/a-servir': (_params: unknown, corps: { chemin?: string } | undefined) => {
			if (corps?.chemin) aServir = [...aServir, corps.chemin];
			return { chemins: aServir };
		},
		'/api/ecartees-toujours': (_params: unknown, corps: { chemin?: string } | undefined) => {
			if (corps?.chemin) toujours = [...toujours, { chemin: corps.chemin, titre: corps.chemin, horodatageMs: 9 }];
			return { ecarteesToujours: toujours };
		},
		'/api/injection-automatique': o.reactiver ?? { coupures: [] },
	});
	const ouvrir = vi.fn();
	let remplacer!: (e: EntreeServieVue[]) => void;
	function Banc() {
		const [entrees, setEntrees] = useState<EntreeServieVue[]>(o.entrees ?? [CALIBRE]);
		remplacer = setEntrees;
		return (
			<ClassementEnDirect
				session="s1"
				entrees={entrees}
				modifiable={o.modifiable ?? true}
				position="projets/alpha"
				lues={o.lues ?? []}
				injections={o.injections ?? []}
				coupures={o.coupures ?? []}
				suggestions={o.suggestions ?? []}
				surOuvrirFiche={ouvrir}
				couleur={() => 'var(--dim)'}
			/>
		);
	}
	rendreAvecClient(
		<FournisseurToast>
			<Banc />
		</FournisseurToast>,
		faux.client,
	);
	return { faux, ouvrir, remplacer: (e: EntreeServieVue[]) => act(() => remplacer(e)) };
}

const liste = () => screen.getByRole('list', { name: 'Injecté dans la session' });
const lignes = () => within(liste()).getAllByRole('listitem');
const titres = () => lignes().map((l) => l.getAttribute('data-id'));
const note = (l: HTMLElement) => l.firstElementChild?.textContent;

describe('ClassementEnDirect : classement vivant', () => {
	it('◆ en tête, de la plus ancienne à la plus récente, avec comment : « du dossier », « auto 94 % » ; puis le classement par % décroissant', async () => {
		monter();
		await act(async () => {});
		expect(titres()).toEqual([POSITION, 'g.md', 'b.md', 'd.md', 'e.md']);
		const [position, auto, beta, delta] = lignes() as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
		expect(note(position)).toBe('◆');
		expect(position.textContent).toContain('du dossier');
		expect(auto.textContent).toContain('auto 94 %');
		expect(note(beta)).toBe('92 %');
		expect(note(delta)).toBe('50 %');
		// dessous le titre : la raison, et « piste » pour une fiche envoyée en piste
		expect(beta.textContent).toContain('proche du message – piste');
		expect(delta.textContent).toContain('du périmètre');
		expect(delta.textContent).not.toContain('piste');
	});

	it('info-bulle d’une fiche injectée par Mnemo : sa note pour ce message et le seuil ; à la main : « à la main »', async () => {
		monter({ injections: [{ chemin: POSITION, mode: 'main', horodatageMs: A(14, 31) }] });
		await act(async () => {});
		const auto = lignes()[1]!;
		expect(within(auto).getByRole('img', { name: 'Injectée dans la session' }).getAttribute('title')).toBe('Injectée par Mnemo : 94 % pour ce message (seuil 90 %), entière, au message de 14:34');
		expect(lignes()[0]!.textContent).toContain('à la main');
		// une fiche injectée par Mnemo s'écarte (l'écart compte au suivi), sans ➤
		expect(within(auto).getByRole('button', { name: 'Écarter Gamma' })).toBeTruthy();
		expect(within(auto).queryByRole('button', { name: /^Injecter/u })).toBeNull();
		expect(within(lignes()[0]!).queryByRole('button', { name: /^Écarter/u })).toBeNull();
	});

	it('pas de % sans calibration : ◇ et « ordre seul » (raison au survol) ; une entrée ancienne aussi', async () => {
		monter({ entrees: [entree(1, [v('b.md', 'Bêta', 1, null), v('d.md', 'Delta', 2, null)], { calibree: false })] });
		await act(async () => {});
		expect(lignes().map(note)).toEqual(['◇', '◇']);
		expect(liste().textContent).not.toMatch(/%/u);
		expect(screen.getByText('ordre seul').getAttribute('title')).toMatch(/^Ordre seul : aucune note apprise et validée/u);
		expect(screen.queryByText(/seuil d’injection/u)).toBeNull();
		cleanup();
		// entrée d'avant le classement vivant : une note du reranker, sans `calibree`
		monter({ entrees: [{ session: 's1', moment: 'message', horodatageMs: 1, ids: [], texte: '', ms: 1, sens: true, classement: [{ id: 'b.md', titre: 'Bêta', note: 0.8, servi: false, rang: 1 }], muet: null, cartes: [] }] });
		await act(async () => {});
		expect(lignes().map(note)).toEqual(['◇']);
		expect(screen.getByText('ordre seul')).toBeTruthy();
	});

	it('repère du seuil d’injection : avant la première note sous le seuil ; une fiche au-dessus non injectée le dit au survol', async () => {
		monter();
		await act(async () => {});
		const items = [...liste().children];
		const seuil = items.findIndex((li) => li.textContent === 'seuil d’injection 90 %');
		expect(items[seuil - 1]!.getAttribute('data-id')).toBe('b.md');
		expect(items[seuil + 1]!.getAttribute('data-id')).toBe('d.md');
		expect(within(lignes()[2]!).getByRole('button', { name: 'Bêta' }).getAttribute('title')).toMatch(/Au-dessus du seuil sans être injectée/u);
	});

	it('pas de ligne qui rappelle le message ; « affinage… » à droite du filet seulement pendant l’affinage', async () => {
		const { remplacer } = monter({ entrees: [{ ...CALIBRE, affinage: 'en_cours', texte: 'Le message classé' }] });
		await act(async () => {});
		expect(screen.getByText('affinage…')).toBeTruthy();
		expect(liste().textContent).not.toContain('Le message classé');
		remplacer([{ ...CALIBRE, affinage: 'fait' }]);
		expect(screen.queryByText('affinage…')).toBeNull();
		expect(screen.queryByText('ordre seul')).toBeNull();
	});

	it('glissement à l’affinage : la même entrée rediffusée avec d’autres rangs réordonne la liste, ▲/▼ quelques secondes', async () => {
		vi.useFakeTimers();
		const { remplacer } = monter({ entrees: [{ ...CALIBRE, affinage: 'en_cours' }] });
		await act(async () => {});
		remplacer([entree(CALIBRE.horodatageMs, [CALIBRE.classement[0]!, v('d.md', 'Delta', 2, 0.93), v('b.md', 'Bêta', 3, 0.6), v('e.md', 'Epsilon', 4, 0.3)], { ids: CALIBRE.ids, affinage: 'fait' })]);
		expect(titres()).toEqual([POSITION, 'g.md', 'd.md', 'b.md', 'e.md']);
		expect(within(lignes()[2]!).getByText('monte de 1 rang')).toBeTruthy();
		expect(within(lignes()[3]!).getByText('▼1').getAttribute('aria-hidden')).toBe('true');
		await act(async () => vi.advanceTimersByTime(5000));
		expect(within(liste()).queryAllByText(/monte|descend/u)).toEqual([]);
	});

	it('glissement : part de la place réelle des lignes (FLIP)', async () => {
		vi.useFakeTimers();
		const places = new Map<string, number>([['b.md', 40], ['d.md', 60], ['e.md', 80]]);
		const descripteur = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
		Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
			configurable: true,
			get(this: HTMLElement) {
				return places.get(this.dataset['id'] ?? '') ?? 0;
			},
		});
		const animations: { id: string; depart: string }[] = [];
		const animer = HTMLElement.prototype.animate;
		HTMLElement.prototype.animate = function (this: HTMLElement, images: Keyframe[]) {
			animations.push({ id: this.dataset['id'] ?? '', depart: String(images[0]!['transform']) });
			return {} as Animation;
		} as typeof HTMLElement.prototype.animate;
		try {
			const { remplacer } = monter();
			await act(async () => {});
			places.set('e.md', 40).set('b.md', 60).set('d.md', 80);
			remplacer([entree(CALIBRE.horodatageMs, [CALIBRE.classement[0]!, v('e.md', 'Epsilon', 2, 0.95), v('b.md', 'Bêta', 3, 0.6), v('d.md', 'Delta', 4, 0.3)], { ids: CALIBRE.ids })]);
			expect(animations.find((x) => x.id === 'e.md')?.depart).toBe('translateY(40px)');
			// pendant le glissement : fond opaque, celle qui monte au-dessus de celle qui descend ; marques levées à la fin
			const ligne = (id: string) => lignes().find((l) => l.getAttribute('data-id') === id)!;
			expect(ligne('e.md').dataset['glisse']).toBe('monte');
			expect(ligne('d.md').dataset['glisse']).toBe('descend');
			await act(async () => vi.advanceTimersByTime(300));
			expect(ligne('e.md').dataset['glisse']).toBeUndefined();
		} finally {
			if (descripteur) Object.defineProperty(HTMLElement.prototype, 'offsetTop', descripteur);
			HTMLElement.prototype.animate = animer;
		}
	});

	it('« Plus tôt dans la session » : pistes anciennes absentes du classement et fiches lues (◈), plus récentes d’abord, sans %', async () => {
		const ancienne = entree(A(14, 20), [], { cartes: [{ id: 'p.md', titre: 'Pi', raison: 'perimetre', note: 0.7 }] });
		monter({ entrees: [ancienne, CALIBRE], lues: [{ chemin: 'l.md', horodatageMs: A(14, 25) }] });
		await act(async () => {});
		expect(screen.getByText('Plus tôt dans la session')).toBeTruthy();
		expect(titres().slice(-2)).toEqual(['l.md', 'p.md']);
		const [lue, piste] = lignes().slice(-2) as [HTMLElement, HTMLElement];
		expect(within(lue).getByRole('img', { name: 'Lue par la session' }).textContent).toBe('◈');
		expect(lue.textContent).toContain('lue par la session à 14:25');
		expect(piste.textContent).toContain('piste du message de 14:20');
		expect(piste.textContent).not.toMatch(/%/u);
	});

	it('✗ ouvre un menu à deux choix ; « Pas pour cette session » : la ligne passe dans « Écartées (1) », Rétablir la ramène', async () => {
		const { faux } = monter();
		await act(async () => {});
		await act(async () => within(lignes()[4]!).getByRole('button', { name: 'Écarter Epsilon' }).click());
		const menu = screen.getByRole('menu', { name: 'Écarter Epsilon' });
		expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
			'Pas pour cette sessionNi proposée ni injectée par Mnemo dans cette session. Se rétablit depuis « Écartées ».',
			'Ne plus jamais suggérerDans aucune session, ni par Mnemo ni en piste. Se rétablit depuis la fiche, page Mémoire.',
		]);
		await act(async () => within(menu).getAllByRole('menuitem')[0]!.click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions/s1/ecartes', { id: 'e.md' });
		expect(titres()).not.toContain('e.md');
		// dernière ligne écartée : le focus va à la précédente
		expect(document.activeElement).toBe(within(lignes()[3]!).getByRole('button', { name: 'Delta' }));
		const ecartees = screen.getByRole('group', { name: 'Écartées (1)' });
		await act(async () => within(ecartees).getByRole('button', { name: 'Rétablir Epsilon' }).click());
		expect(faux.api.supprimer).toHaveBeenCalledWith('/api/sessions/s1/ecartes', { id: 'e.md' });
		expect(titres()).toContain('e.md');
	});

	it('« Ne plus jamais suggérer » : écartée toujours (avec la session), la ligne disparaît, un avis dit où la rétablir', async () => {
		const { faux } = monter();
		await act(async () => {});
		await act(async () => within(lignes()[3]!).getByRole('button', { name: 'Écarter Delta' }).click());
		await act(async () => screen.getByRole('menuitem', { name: /^Ne plus jamais suggérer/u }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/ecartees-toujours', { chemin: 'd.md', session: 's1' });
		expect(titres()).not.toContain('d.md');
		expect(screen.getByText(/plus jamais suggérée\. Se rétablit depuis la fiche, page Mémoire\./u)).toBeTruthy();
		// le focus va à la ligne suivante
		expect(document.activeElement).toBe(within(lignes()[3]!).getByRole('button', { name: 'Epsilon' }));
	});

	it('une fiche lue d’elle-même : « Pas pour cette session » indisponible, avec son motif ; « Ne plus jamais suggérer » permis', async () => {
		monter({ lues: [{ chemin: 'l.md', horodatageMs: A(14, 25) }] });
		await act(async () => {});
		await act(async () => within(lignes().at(-1)!).getByRole('button', { name: 'Écarter l' }).click());
		const [ici, jamais] = screen.getAllByRole('menuitem') as [HTMLElement, HTMLElement];
		expect(ici.getAttribute('aria-disabled')).toBe('true');
		expect(ici.textContent).toContain("la session l'a lue d'elle-même");
		expect(jamais.getAttribute('aria-disabled')).toBeNull();
	});

	it('➤ : la demande d’injection au prochain message, allumé tant qu’elle attend', async () => {
		const { faux } = monter();
		await act(async () => {});
		await act(async () => within(lignes()[3]!).getByRole('button', { name: 'Injecter Delta dans la session' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions/s1/a-servir', { chemin: 'd.md' });
		expect(within(lignes()[3]!).getByRole('button', { name: 'Injecter Delta dans la session' }).getAttribute('aria-pressed')).toBe('true');
		expect(lignes()[3]!.textContent).toContain('injectée au prochain message');
	});

	it('injection coupée : dite avec son motif, les % restent, le seuil est « coupé », « Réactiver » appelle la route', async () => {
		const coupure: CoupureInjectionVue = { niveau: 'complets', injections: 100, ecartees: 31, depuisMs: 1, motif: '31 des 100 dernières fiches injectées par Mnemo ont été écartées' };
		const { faux } = monter({ coupures: [coupure] });
		await act(async () => {});
		const etat = screen.getAllByRole('status').find((x) => x.textContent?.includes('Injection automatique coupée') === true)!;
		expect(etat.textContent).toContain('Injection automatique coupée (modèles complets) : justesse récente insuffisante.');
		expect(etat.textContent).toContain('31 des 100 dernières fiches injectées par Mnemo ont été écartées.');
		expect(note(lignes()[2]!)).toBe('92 %');
		expect([...liste().children].some((li) => li.textContent === 'seuil 90\u00a0% – coupé')).toBe(true);
		expect(within(lignes()[2]!).getByRole('button', { name: 'Bêta' }).getAttribute('title')).toMatch(/l'injection automatique est coupée : ➤/u);
		await act(async () => within(etat).getByRole('button', { name: 'Réactiver' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/injection-automatique', { session: 's1' });
	});

	it('injection coupée en ordre seul : pas de « Les % restent » (il n’y en a pas) ; Réactiver refusé (suivi illisible) : le motif du service en toast', async () => {
		const coupure: CoupureInjectionVue = { niveau: 'complets', injections: 100, ecartees: 31, depuisMs: 1, motif: 'm' };
		monter({
			coupures: [coupure],
			entrees: [entree(1, [v('b.md', 'Bêta', 1, null)], { calibree: false })],
			reactiver: () => {
				throw new ErreurApi('Suivi des injections illisible : réessayez.', 503);
			},
		});
		await act(async () => {});
		const etat = screen.getAllByRole('status').find((x) => x.textContent?.includes('Injection automatique coupée') === true)!;
		expect(etat.textContent).not.toContain('Les % restent');
		expect(etat.textContent).toContain('➤ pour injecter à la main.');
		await act(async () => within(etat).getByRole('button', { name: 'Réactiver' }).click());
		expect(await screen.findByText('Suivi des injections illisible : réessayez.')).toBeTruthy();
	});

	it('« piste » seulement pour une piste de ce message : une fiche proposée en carte plus tôt dans la session ne la porte pas', async () => {
		const ancienne = entree(A(14, 20), [], { cartes: [{ id: 'd.md', titre: 'Delta', raison: 'perimetre' }] });
		monter({ entrees: [ancienne, CALIBRE] });
		await act(async () => {});
		const delta = lignes().find((l) => l.getAttribute('data-id') === 'd.md')!;
		expect(delta.textContent).not.toContain('piste');
		expect(lignes().find((l) => l.getAttribute('data-id') === 'b.md')!.textContent).toContain('– piste');
	});

	it('suggestion des 3 sessions : « Ne plus suggérer » écarte toujours ; « Garder » la retire', async () => {
		const { faux } = monter({ suggestions: [{ chemin: 'x.md', sessions: 3, jours: 9 }] });
		await act(async () => {});
		const suggestion = screen.getByRole('group', { name: 'Suggestion' });
		expect(suggestion.textContent).toContain('x écartée dans 3 sessions : ne plus la suggérer ?');
		await act(async () => within(suggestion).getByRole('button', { name: 'Ne plus suggérer' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/ecartees-toujours', { chemin: 'x.md', session: 's1' });
		expect(screen.queryByRole('group', { name: 'Suggestion' })).toBeNull();
		cleanup();
		monter({ suggestions: [{ chemin: 'y.md', sessions: 4, jours: 2 }] });
		await act(async () => {});
		await act(async () => within(screen.getByRole('group', { name: 'Suggestion' })).getByRole('button', { name: 'Garder' }).click());
		expect(screen.queryByRole('group', { name: 'Suggestion' })).toBeNull();
	});

	it('fiche écartée toujours ailleurs : absente de la liste', async () => {
		monter({ toujours: [{ chemin: 'b.md', titre: 'Bêta', horodatageMs: 1 }] });
		await act(async () => {});
		expect(titres()).toEqual([POSITION, 'g.md', 'd.md', 'e.md']);
	});

	it('les fiches notées sous le seuil d’affichage sont comptées dans « Sous le seuil (N) », avec leur note', async () => {
		monter({ entrees: [entree(1, [v('b.md', 'Bêta', 1, 0.8), v('z.md', 'Zêta', 2, 0.03)])] });
		await act(async () => {});
		expect(titres()).toEqual(['b.md']);
		const sous = screen.getByRole('group', { name: 'Sous le seuil (1)' });
		expect(sous.textContent).toContain('Zêta');
		expect(sous.textContent).toContain('3 %');
	});

	it('clic sur une ligne : ouvre sa fiche', async () => {
		const { ouvrir } = monter();
		await act(async () => within(lignes()[3]!).getByRole('button', { name: 'Delta' }).click());
		expect(ouvrir).toHaveBeenCalledWith('d.md');
	});

	it('calcul sans le sens, modèles arrêtés : une ligne et « Démarrer » ; avec le sens : rien', async () => {
		const { faux } = monter({ entrees: [entree(1, [v('b.md', 'Bêta', 1, null)], { sens: false, calibree: false })], modeles: 'arrete' });
		expect(await screen.findByText('Notes indisponibles : modèles arrêtés')).toBeTruthy();
		await act(async () => screen.getByRole('button', { name: 'Démarrer' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/modeles/demarrer', undefined);
		expect(screen.getByText('Modèles démarrés : les notes viendront au prochain message.')).toBeTruthy();
		cleanup();
		monter({ modeles: 'arrete' });
		await act(async () => {});
		expect(screen.queryByText(/Notes indisponibles/u)).toBeNull();
	});

	it('un message muet dit pourquoi rien n’est proposé', async () => {
		monter({ entrees: [entree(1, [], { muet: 'balise' })] });
		await act(async () => {});
		expect(screen.getByText('Message système : rien proposé')).toBeTruthy();
	});

	it('message `ecartes` du service (autre fenêtre) : pris en compte', async () => {
		const { faux } = monter();
		await act(async () => {});
		await act(async () => faux.connexion.emettre({ type: 'ecartes', session: 's1', ecartes: [{ id: 'b.md', titre: 'Bêta', horodatageMs: 1 }] }));
		expect(titres()).not.toContain('b.md');
	});

	it('session terminée : ni ➤ ni ✗ ni « Réactiver »', async () => {
		monter({ modifiable: false, coupures: [{ niveau: 'sens', injections: 100, ecartees: 30, depuisMs: 1, motif: 'm' }] });
		await act(async () => {});
		expect(within(liste()).queryAllByRole('button', { name: /^(Injecter|Écarter)/u })).toEqual([]);
		expect(screen.queryByRole('button', { name: 'Réactiver' })).toBeNull();
	});

	it('aucun classement : un mot, pas de liste', async () => {
		monter({ entrees: [] });
		await act(async () => {});
		expect(screen.queryByRole('list', { name: 'Injecté dans la session' })).toBeNull();
		expect(screen.getByText('Aucune fiche pour l’instant.')).toBeTruthy();
	});
});
