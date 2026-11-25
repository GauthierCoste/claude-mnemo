// @vitest-environment happy-dom
import type { ClassementVue, EcarteVue, EntreeServieVue, EtatModelesVue } from '@mnemo/contrat';
import { act, cleanup, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClassementEnDirect, SANS_NOTE_DE_SENS } from '../../src/composants/sessions/ClassementEnDirect.tsx';
import { creerFauxClient, rendreAvecClient } from '../aides/faux-client.tsx';
import { vueSelonReranker } from '../aides/modeles.ts';

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

const c = (id: string, titre: string, rang: number, note: number | null, servi = false): ClassementVue => ({ id, titre, note, servi, rang });
const entree = (horodatageMs: number, classement: ClassementVue[]): EntreeServieVue => ({ session: 's1', moment: 'message', horodatageMs, ids: [], texte: '', ms: 1, sens: false, classement, muet: null, cartes: [] });

/** Aujourd'hui à h:m, heure locale. */
const A = (h: number, m: number) => {
	const d = new Date();
	d.setHours(h, m, 0, 0);
	return d.getTime();
};

const PREMIER = entree(1, [c('a.md', 'Alpha', 1, 0.874, true), c('b.md', 'Bêta', 2, 0.5), c('c.md', 'Gamma', 3, 0.3)]);
const SANS_NOTES = entree(1, [c('a.md', 'Alpha', 1, null, true), c('b.md', 'Bêta', 2, null)]);

/** Le composant, avec des entrées qu'on remplace comme le ferait un nouveau `servi`. */
function monter(o: { ecartes?: EcarteVue[]; entrees?: EntreeServieVue[]; modeles?: EtatModelesVue['reranker'] } = {}) {
	let ecartes = o.ecartes ?? [];
	let modeles = o.modeles ?? 'arrete';
	let aServir: string[] = [];
	const faux = creerFauxClient({
		'/api/modeles': () => vueSelonReranker(modeles),
		'/api/modeles/demarrer': () => {
			modeles = 'pret';
			return vueSelonReranker(modeles);
		},
		'/api/sessions/s1/ecartes': (_params: unknown, corps: { id?: string } | undefined) => {
			if (corps?.id) ecartes = [...ecartes, { id: corps.id, titre: corps.id === 'c.md' ? 'Gamma' : corps.id, horodatageMs: 5 }];
			return { ecartes };
		},
		'/api/sessions/s1/a-servir': (_params: unknown, corps: { chemin?: string } | undefined) => {
			if (corps?.chemin) aServir = [...aServir, corps.chemin];
			return { chemins: aServir };
		},
		'DELETE /api/sessions/s1/ecartes': (params: Record<string, string> | undefined) => {
			ecartes = ecartes.filter((e) => e.id !== params?.['id']);
			return { ecartes };
		},
	});
	const ouvrir = vi.fn();
	let remplacer!: (e: EntreeServieVue[]) => void;
	function Banc() {
		const [entrees, setEntrees] = useState<EntreeServieVue[]>(o.entrees ?? [PREMIER]);
		remplacer = setEntrees;
		return <ClassementEnDirect session="s1" entrees={entrees} modifiable surOuvrirFiche={ouvrir} couleur={() => 'var(--dim)'} />;
	}
	rendreAvecClient(<Banc />, faux.client);
	return { faux, ouvrir, remplacer: (e: EntreeServieVue[]) => act(() => remplacer(e)) };
}

const liste = () => screen.getByRole('list', { name: 'Injecté dans la session' });
const lignes = () => within(liste()).getAllByRole('listitem');
const titres = () => lignes().map((l) => l.getAttribute('data-id'));

describe('ClassementEnDirect en cartes', () => {
	const cartes = (e: Partial<EntreeServieVue>) => ({ ...entree(1, []), sens: true, ...e });
	it('◆ la fiche de position injectée en tête, à gauche ; chaque carte avec sa note, fiche nommée comprise, et sa raison si elle apprend quelque chose ; ➤ et ✗ sur les cartes', async () => {
		monter({
			entrees: [
				cartes({
					ids: ['projets/alpha/alpha.md'],
					cartes: [
						{ id: 'a.md', titre: 'Alpha', raison: 'perimetre', note: 0.82 },
						{ id: 'b.md', titre: 'Bêta', raison: 'nommee', note: 0.4 },
						{ id: 'c.md', titre: 'Gamma', raison: 'question', note: 1.3 },
					],
				}),
			],
		});
		await act(async () => {});
		expect(titres()).toEqual(['projets/alpha/alpha.md', 'a.md', 'b.md', 'c.md']);
		const [position] = lignes() as [HTMLElement];
		expect(within(position).getByRole('img', { name: 'Injectée dans la session' }).textContent).toBe('◆');
		expect(within(position).queryByRole('button', { name: /Ne plus suggérer|Injecter/u })).toBeNull();
		// une seule colonne à gauche : ◆, puis la note de chaque carte (une note au-delà de 1 se lit 100 %) ; plus de ◇
		expect(lignes().map((l) => l.firstElementChild?.textContent)).toEqual(['◆', '82\u00a0%', '40\u00a0%', '100\u00a0%']);
		// calcul fait avec le sens : pas de repère « sans note de sens »
		expect(screen.queryByText(SANS_NOTE_DE_SENS)).toBeNull();
		expect(within(liste()).queryByText('◇')).toBeNull();
		// « du périmètre » est le cas par défaut : écrit seulement dans l'info-bulle
		expect(within(liste()).queryByText('du périmètre')).toBeNull();
		expect(within(lignes()[1]!).getByRole('button', { name: 'Alpha' }).getAttribute('title')).toMatch(/^du périmètre, proposée à \d\d:\d\d\na\.md$/u);
		for (const raison of ['nommée', 'question']) expect(within(liste()).getByText(raison)).toBeTruthy();
		expect(within(liste()).getByRole('button', { name: 'Ne plus suggérer Bêta' })).toBeTruthy();
		expect(within(liste()).getByRole('button', { name: 'Injecter Bêta dans la session' })).toBeTruthy();
	});

	it('dernier calcul sans le sens : « — » à la place des notes, et un repère discret le dit à côté du titre', async () => {
		const { remplacer } = monter({
			entrees: [
				cartes({
					sens: false,
					cartes: [
						{ id: 'a.md', titre: 'Alpha', raison: 'perimetre' },
						{ id: 'b.md', titre: 'Bêta', raison: 'nommee' },
					],
				}),
			],
		});
		await act(async () => {});
		expect(lignes().map((l) => l.firstElementChild?.textContent)).toEqual(['—', '—']);
		const repere = screen.getByText(SANS_NOTE_DE_SENS);
		expect(repere.textContent).toBe('sans note de sens');
		expect(repere.getAttribute('title')).toBe("Pas de note : le modèle de sens ne tourne pas, n'a pas répondu à temps, ou ces fiches ne sont pas encore indexées ; les fiches sont proposées sans note.");
		// un calcul plus récent fait avec le sens : le repère s'en va
		remplacer([
			cartes({ sens: false, cartes: [{ id: 'a.md', titre: 'Alpha', raison: 'perimetre' }] }),
			cartes({ horodatageMs: 2, cartes: [{ id: 'b.md', titre: 'Bêta', raison: 'nommee', note: 0.5 }] }),
		]);
		expect(screen.queryByText(SANS_NOTE_DE_SENS)).toBeNull();
		// un message muet (son texte n'est pas noté) : pas de repère, le modèle n'y est pour rien
		remplacer([cartes({ sens: false, muet: 'sans_contenu', cartes: [{ id: 'a.md', titre: 'Alpha', raison: 'liee', depuis: { id: 'p/x.md', titre: 'X' } }] })]);
		expect(lignes().map((l) => l.firstElementChild?.textContent)).toEqual(['—']);
		expect(screen.queryByText(SANS_NOTE_DE_SENS)).toBeNull();
	});

	it('◇ une voisine d’une fiche injectée à la main : raison « liée à <titre> »', async () => {
		monter({ entrees: [cartes({ cartes: [{ id: 'd.md', titre: 'Delta', raison: 'liee', depuis: { id: 'p/avoirs.md', titre: 'Avoirs' } }] })] });
		await act(async () => {});
		expect(within(liste()).getByText('liée à Avoirs')).toBeTruthy();
	});

	it('➤ sur une carte : la demande d’injection au prochain message, allumé tant qu’elle attend', async () => {
		const { faux } = monter({ entrees: [cartes({ cartes: [{ id: 'b.md', titre: 'Bêta', raison: 'nommee' }] })] });
		await act(async () => {});
		const injecter = screen.getByRole('button', { name: 'Injecter Bêta dans la session' });
		expect(injecter.getAttribute('aria-pressed')).toBe('false');
		await act(async () => injecter.click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions/s1/a-servir', { chemin: 'b.md' });
		expect(screen.getByRole('button', { name: 'Injecter Bêta dans la session' }).getAttribute('aria-pressed')).toBe('true');
	});

	it('une fiche lue par la session : une ligne ◈ de la liste, à l’heure de sa lecture, avec ➤ mais sans ✗ ; plus de groupe « Lues par la session »', async () => {
		const faux = creerFauxClient({ '/api/sessions/s1/ecartes': { ecartes: [] }, '/api/sessions/s1/a-servir': { chemins: [] } });
		const ouvrir = vi.fn();
		const entrees = [
			cartes({
				horodatageMs: A(10, 0),
				ids: ['p/Position.md'],
				cartes: [
					{ id: 'a.md', titre: 'Alpha', raison: 'perimetre', note: 0.8 },
					{ id: 'b.md', titre: 'Bêta', raison: 'nommee', note: 0.5 },
				],
			}),
		];
		const lues = [
			{ chemin: 'x/Lue.md', horodatageMs: A(10, 5) },
			{ chemin: 'p/Position.md', horodatageMs: A(10, 3) },
			{ chemin: 'b.md', horodatageMs: A(10, 2) },
			{ chemin: 'x/Ancienne.md', horodatageMs: A(9, 0) },
		];
		rendreAvecClient(<ClassementEnDirect session="s1" entrees={entrees} servies={['p/Position.md']} lues={lues} modifiable surOuvrirFiche={ouvrir} couleur={() => ''} />, faux.client);
		await act(async () => {});
		// à sa place dans le temps : la lue de 10:05 avant les cartes de 10:00, celle de 9:00 après ; pas de doublon
		expect(titres()).toEqual(['p/Position.md', 'x/Lue.md', 'a.md', 'b.md', 'x/Ancienne.md']);
		const lue = lignes()[1]!;
		expect(within(lue).getByRole('img', { name: 'Lue par la session' }).textContent).toBe('◈');
		expect(within(lue).getByRole('button', { name: 'Lue' }).getAttribute('title')).toBe('Lue par la session à 10:05\nx/Lue.md');
		expect(within(lue).getByRole('button', { name: 'Injecter Lue dans la session' })).toBeTruthy();
		// le service n'écarte que ce qu'il a proposé : ✗ masqué et inactif
		// masqué (visibility: hidden), il n'a pas de nom accessible : on le prend par son aria-label
		const croix = lue.querySelector<HTMLButtonElement>('button[aria-label="Ne plus suggérer Lue"]');
		expect(croix?.disabled).toBe(true);
		expect(croix?.style.visibility).toBe('hidden');
		// injectée puis lue : garde ◆, et le dit dans l'info-bulle ; proposée puis lue : garde sa note
		const position = lignes()[0]!;
		expect(within(position).getByRole('img', { name: 'Injectée dans la session' }).textContent).toBe('◆');
		expect(within(position).getByRole('button', { name: 'Position' }).getAttribute('title')).toBe('Injectée entière dans la session, lue aussi à 10:03\np/Position.md');
		const beta = lignes()[3]!;
		expect(beta.firstElementChild?.textContent).toBe('50\u00a0%');
		expect(within(beta).getByRole('button', { name: 'Bêta' }).getAttribute('title')).toMatch(/^nommée, proposée à 10:00, lue aussi à 10:02\nb\.md$/u);
		expect(screen.queryByRole('group', { name: 'Lues par la session' })).toBeNull();
		await act(async () => within(lue).getByRole('button', { name: 'Lue' }).click());
		expect(ouvrir).toHaveBeenCalledWith('x/Lue.md');
	});

	it('✗ sur une carte écarte son id', async () => {
		const { faux } = monter({ entrees: [cartes({ cartes: [{ id: 'b.md', titre: 'Bêta', raison: 'nommee' }] })] });
		await act(async () => {});
		await act(async () => screen.getByRole('button', { name: 'Ne plus suggérer Bêta' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions/s1/ecartes', { id: 'b.md' });
	});

	it('un message muet dit pourquoi rien n’est proposé', async () => {
		monter({ entrees: [cartes({ muet: 'sans_contenu' })] });
		await act(async () => {});
		expect(screen.getByText('Message sans contenu : rien proposé')).toBeTruthy();
		cleanup();
		monter({ entrees: [cartes({ muet: 'balise' })] });
		await act(async () => {});
		expect(screen.getByText('Message système : rien proposé')).toBeTruthy();
	});
});

describe('ClassementEnDirect', () => {
	it('lignes triées par note : le pourcentage tient la colonne de gauche (pas de rang) ; ◆ « Injectée dans la session » ; titre complet, chemin en info-bulle', async () => {
		monter();
		await act(async () => {});
		expect(titres()).toEqual(['a.md', 'b.md', 'c.md']);
		const [a, b, g] = lignes() as [HTMLElement, HTMLElement, HTMLElement];
		// une fiche injectée a ◆ dans la case de la note ; les autres ont leur pourcentage
		expect(a.firstElementChild?.textContent).toBe('◆');
		expect(b.firstElementChild?.textContent).toBe('50\u00a0%');
		expect(g.firstElementChild?.textContent).toBe('30\u00a0%');
		// plus de rang (1, 2, 3) ni de seconde note à droite
		expect(b.textContent?.match(/%/gu)).toHaveLength(1);
		expect(a.textContent).not.toMatch(/^1/u);
		const servie = within(a).getByRole('img', { name: 'Injectée dans la session' });
		expect(servie.getAttribute('title')).toBe('Injectée entière dans la session');
		expect(servie.textContent).toBe('◆');
		expect(within(b).queryByRole('img', { name: 'Injectée dans la session' })).toBeNull();
		expect(a.textContent).not.toContain('servie');
		expect(within(a).getByRole('button', { name: 'Alpha' }).getAttribute('title')).toBe('Injectée entière dans la session\na.md');
		expect(a.getAttribute('data-servie')).toBe('true');
		expect(g.getAttribute('data-servie')).toBe('false');
	});

	it('les fiches notées sous le seuil ne sont pas classées mais comptées dans « Sous le seuil (N) », avec leur note', async () => {
		monter({ entrees: [entree(1, [c('a.md', 'Alpha', 1, 0.874, true), c('z.md', 'Zêta', 2, 0.03)])] });
		await act(async () => {});
		expect(titres()).toEqual(['a.md']);
		const sous = screen.getByRole('group', { name: 'Sous le seuil (1)' });
		expect(within(sous).getByText('Zêta')).toBeTruthy();
		expect(sous.textContent).toContain('3\u00a0%');
	});

	it('clic sur une ligne : ouvre sa fiche', async () => {
		const { ouvrir } = monter();
		await act(async () => within(lignes()[1]!).getByRole('button', { name: 'Bêta' }).click());
		expect(ouvrir).toHaveBeenCalledWith('b.md');
	});

	it('nouveau classement : la liste se réordonne (ordre du DOM), ▲/▼ du changement de rang, puis l’indicateur s’efface', async () => {
		vi.useFakeTimers();
		const { remplacer } = monter();
		await act(async () => {});
		remplacer([entree(2, [c('c.md', 'Gamma', 1, 0.9, true), c('a.md', 'Alpha', 2, 0.6, true), c('d.md', 'Delta', 3, 0.2), c('b.md', 'Bêta', 4, 0.1)]), PREMIER]);
		expect(titres()).toEqual(['c.md', 'a.md', 'd.md', 'b.md']);
		const [g, a, d, b] = lignes() as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
		// annoncés par un texte (masqué à l'écran), le symbole seul étant caché aux lecteurs d'écran
		expect(within(g).getByText('monte de 2 rangs')).toBeTruthy();
		expect(within(a).getByText('descend de 1 rang')).toBeTruthy();
		expect(within(b).getByText('descend de 2 rangs')).toBeTruthy();
		expect(within(g).getByText('▲2').getAttribute('aria-hidden')).toBe('true');
		expect(d.getAttribute('data-nouvelle')).toBe('true');
		expect(within(d).queryByText(/monte|descend/u)).toBeNull();
		await act(async () => vi.advanceTimersByTime(5000));
		expect(within(liste()).queryAllByText(/monte|descend/u)).toEqual([]);
	});

	it('▲/▼ sans colonne réservée : présent quelques secondes après un nouveau calcul, absent avant et après (le titre garde la largeur)', async () => {
		vi.useFakeTimers();
		const { remplacer } = monter();
		await act(async () => {});
		const colonnes = () => lignes().map((l) => l.querySelectorAll('[data-delta]').length);
		expect(colonnes()).toEqual([0, 0, 0]);
		remplacer([entree(2, [c('c.md', 'Gamma', 1, 0.9), c('a.md', 'Alpha', 2, 0.6, true), c('b.md', 'Bêta', 3, 0.1)])]);
		// les fiches injectées (◆, ici Alpha) restent en tête de la liste : Gamma passe de la 3e à la 2e place
		expect(titres()).toEqual(['a.md', 'c.md', 'b.md']);
		expect(lignes()[1]!.querySelector('[data-delta]')!.textContent).toContain('▲1');
		await act(async () => vi.advanceTimersByTime(5000));
		expect(colonnes()).toEqual([0, 0, 0]);
	});

	it('glissement : part de la place réelle des lignes, relevée après chaque rendu (pas seulement au changement d’ordre)', async () => {
		vi.useFakeTimers();
		const places = new Map<string, number>([['a.md', 0], ['b.md', 20], ['c.md', 40]]);
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
			// premier reclassement (même ordre de lignes) : ▲/▼ paraissent, un titre passe sur deux lignes, les places changent
			remplacer([entree(2, [c('a.md', 'Alpha', 1, 0.874, true), c('b.md', 'Bêta', 2, 0.5), c('c.md', 'Gamma', 3, 0.3)])]);
			places.set('b.md', 30).set('c.md', 60);
			await act(async () => vi.advanceTimersByTime(5000)); // l'indicateur s'efface : un rendu, places relevées
			animations.length = 0;
			// nouvel ordre : Gamma monte en tête
			places.set('c.md', 0).set('a.md', 20).set('b.md', 50);
			remplacer([entree(3, [c('c.md', 'Gamma', 1, 0.9), c('a.md', 'Alpha', 2, 0.6, true), c('b.md', 'Bêta', 3, 0.1)])]);
			const gamma = animations.find((x) => x.id === 'c.md');
			// depuis 60 (sa place réelle avant), pas 40 (celle relevée au premier rendu)
			expect(gamma?.depart).toBe('translateY(60px)');
		} finally {
			if (descripteur) Object.defineProperty(HTMLElement.prototype, 'offsetTop', descripteur);
			HTMLElement.prototype.animate = animer;
		}
	});

	it('✗ « ne plus suggérer » : appelle la route, la ligne passe dans « Écartées (1) » ; Rétablir la ramène', async () => {
		const { faux } = monter();
		await act(async () => {});
		const gamma = lignes()[2]!;
		const croix = within(gamma).getByRole('button', { name: 'Ne plus suggérer Gamma' });
		await act(async () => croix.click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions/s1/ecartes', { id: 'c.md' });
		expect(titres()).toEqual(['a.md', 'b.md']);
		// dernière ligne écartée : le focus va à la précédente
		expect(document.activeElement).toBe(within(lignes()[1]!).getByRole('button', { name: 'Bêta' }));
		const ecartees = screen.getByRole('group', { name: 'Écartées (1)' });
		expect(within(ecartees).getByText('Gamma')).toBeTruthy();
		await act(async () => within(ecartees).getByRole('button', { name: 'Rétablir Gamma' }).click());
		expect(faux.api.supprimer).toHaveBeenCalledWith('/api/sessions/s1/ecartes', { id: 'c.md' });
		expect(titres()).toEqual(['a.md', 'b.md', 'c.md']);
		expect(screen.queryByRole('group', { name: /Écartées/u })).toBeNull();
	});

	it('✗ au milieu : le focus va à la ligne suivante ; ✗ sur la seule ligne : au titre de la section', async () => {
		monter();
		await act(async () => {});
		await act(async () => within(lignes()[1]!).getByRole('button', { name: 'Ne plus suggérer Bêta' }).click());
		expect(document.activeElement).toBe(within(lignes()[1]!).getByRole('button', { name: 'Gamma' }));
		cleanup();
		monter({ entrees: [entree(1, [c('a.md', 'Alpha', 1, 0.8)])] });
		await act(async () => {});
		await act(async () => within(lignes()[0]!).getByRole('button', { name: 'Ne plus suggérer Alpha' }).click());
		expect(document.activeElement?.textContent).toBe('Injecté dans la session');
	});

	it('notes indisponibles, modèles arrêtés : « — » à la place du pourcentage, une ligne et « Démarrer » (geste explicite) ; non installés : sans bouton ; notes présentes : rien', async () => {
		const { faux } = monter({ entrees: [SANS_NOTES] });
		await act(async () => {});
		expect(lignes().map((l) => l.firstElementChild?.textContent)).toEqual(['◆', '—']);
		const avis = await screen.findByText('Notes indisponibles : modèles arrêtés');
		expect(avis).toBeTruthy();
		await act(async () => screen.getByRole('button', { name: 'Démarrer' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/modeles/demarrer', undefined);
		expect(screen.queryByText('Notes indisponibles : modèles arrêtés')).toBeNull();
		expect(screen.getByText('Modèles démarrés : les notes viendront au prochain message.')).toBeTruthy();
		cleanup();
		monter({ entrees: [SANS_NOTES], modeles: 'absent' });
		expect(await screen.findByText('Notes indisponibles : modèles non installés')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Démarrer' })).toBeNull();
		cleanup();
		monter();
		await act(async () => {});
		expect(screen.queryByText(/Notes indisponibles/u)).toBeNull();
	});

	it('message `ecartes` du service (autre fenêtre ou fin de session) : pris en compte', async () => {
		const { faux } = monter();
		await act(async () => {});
		await act(async () => faux.connexion.emettre({ type: 'ecartes', session: 's1', ecartes: [{ id: 'a.md', titre: 'Alpha', horodatageMs: 1 }] }));
		expect(titres()).toEqual(['b.md', 'c.md']);
		await act(async () => faux.connexion.emettre({ type: 'ecartes', session: 'autre', ecartes: [] }));
		expect(titres()).toEqual(['b.md', 'c.md']);
	});

	it('aucun classement : un mot, pas de liste', async () => {
		const faux = creerFauxClient({ '/api/sessions/s1/ecartes': { ecartes: [] } });
		rendreAvecClient(<ClassementEnDirect session="s1" entrees={[]} modifiable surOuvrirFiche={() => {}} couleur={() => ''} />, faux.client);
		await act(async () => {});
		expect(screen.queryByRole('list', { name: 'Injecté dans la session' })).toBeNull();
		expect(screen.getByText('Aucune fiche pour l’instant.')).toBeTruthy();
	});
});
