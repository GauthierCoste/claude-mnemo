// @vitest-environment happy-dom
import type { NiveauModeles } from '@mnemo/commun';
import type { ActiviteModeleVue, EntreeServieVue, EtatModelesVue } from '@mnemo/contrat';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { FournisseurClient } from '../../src/client/contexte.tsx';
import { BoutonModeles, ENCORE_EN_CHARGEMENT } from '../../src/composants/modeles/BoutonModeles.tsx';
import { ModelesSession } from '../../src/composants/modeles/ModelesSession.tsx';
import { ClassementEnDirect } from '../../src/composants/sessions/ClassementEnDirect.tsx';
import { FournisseurToast } from '../../src/composants/Toast.tsx';
import { FournisseurNavigation, useNavigation } from '../../src/navigation.tsx';
import { creerFauxClient } from '../aides/faux-client.tsx';
import { vueModeles } from '../aides/modeles.ts';

afterEach(cleanup);

const activite = (operation: ActiviteModeleVue['operation'], e: Partial<ActiviteModeleVue> = {}): ActiviteModeleVue => ({ operation, session: null, ceDossier: true, depuisMs: 1, avancement: null, ...e });

/** La session choisie dans Sessions, comme le fait la vue (« cette session » du menu global). */
function SessionChoisie(p: { id: string }): ReactNode {
	const { definirSessionPremierPlan } = useNavigation();
	useEffect(() => definirSessionPremierPlan(p.id), [p.id, definirSessionPremierPlan]);
	return null;
}

function monter(ui: ReactNode, vue: EtatModelesVue, routes: Record<string, unknown> = {}) {
	const faux = creerFauxClient({ '/api/modeles': vue, ...routes });
	render(
		<FournisseurClient client={faux.client}>
			<FournisseurNavigation>
				<FournisseurToast>{ui}</FournisseurToast>
			</FournisseurNavigation>
		</FournisseurClient>,
	);
	return faux;
}

const boutonGlobal = () => screen.findByRole('button', { name: /^Modèles locaux/u });
async function ouvrir(bouton: Promise<HTMLElement>): Promise<HTMLElement> {
	const b = await bouton;
	await act(async () => fireEvent.click(b));
	return screen.getByRole('menu');
}

describe('bouton global des modèles', () => {
	it.each<[string, Partial<EtatModelesVue>]>([
		['Modèles en veille', { gardien: 'arrete', sens: 'arrete', reranker: 'arrete' }],
		['Chargement…', { gardien: 'demarrage', sens: 'arrete', reranker: 'arrete' }],
		['Modèles prêts', {}],
		['Sens seul prêt', { niveau: 'sens', reranker: 'exclu' }],
		['Sens seul en veille', { niveau: 'sens', gardien: 'arrete', sens: 'arrete', reranker: 'exclu' }],
		['Modèles coupés', { niveau: 'coupes', gardien: 'arrete', sens: 'exclu', reranker: 'exclu' }],
		['Modèles en échec', { gardien: 'echec', sens: 'arrete', reranker: 'arrete' }],
		['Vectorisation 120/800', { activites: [activite('vectorisation', { avancement: { faits: 120, total: 800 } })] }],
		['Vectorisation… +1', { activites: [activite('recherche'), activite('vectorisation', { avancement: { faits: 64, total: null } })] }],
		['Injection…', { activites: [activite('injection', { session: 's1' })] }],
	])('« %s » : texte et nom accessible qui donne l’état', async (texte, e) => {
		monter(<BoutonModeles />, vueModeles(e));
		const bouton = await boutonGlobal();
		expect(bouton.getAttribute('aria-label')).toBe(`Modèles locaux : ${texte}`);
		expect(bouton.textContent).toBe(texte);
	});

	it('absent tant que les modèles ne sont pas installés', async () => {
		const faux = monter(<BoutonModeles />, vueModeles({ installes: false, sens: 'absent', reranker: 'absent', pieces: { sens: null, reranker: null, moteur: null } }));
		await act(async () => {});
		expect(faux.api.lire).toHaveBeenCalledWith('/api/modeles');
		expect(screen.queryByRole('button', { name: /^Modèles locaux/u })).toBeNull();
	});

	it('menu : chaque pièce (état, modèle, détail, moteur), une pièce absente « non installé », les activités avec leur session et leur dossier', async () => {
		const vue = vueModeles({
			reranker: 'absent',
			pieces: { ...vueModeles().pieces, reranker: null },
			activites: [activite('recherche', { session: 's1' }), activite('vectorisation', { ceDossier: false, avancement: { faits: 3, total: 10 } })],
		});
		monter(
			<>
				<SessionChoisie id="s1" />
				<BoutonModeles />
			</>,
			vue,
		);
		const menu = await ouvrir(boutonGlobal());
		const pieces = within(menu).getAllByRole('listitem').slice(0, 3);
		expect(pieces.map((x) => x.textContent)).toEqual([
			'Sensprêtbge-m3BAAI – Q8_0 – 605,2 Mo – aa473d51',
			'Reclassementnon installé',
			'Moteurllama.cpp b11671macOS arm64 – local, 127.0.0.1',
		]);
		const activites = within(menu).getAllByRole('listitem').slice(3);
		expect(activites.map((x) => x.textContent)).toEqual(['Recherche… – cette session', 'Vectorisation 3/10 – autre dossier']);
		expect(menu.textContent).not.toContain('·');
	});

	it('niveaux : le niveau de la machine coché ; un autre choisi appelle la route', async () => {
		const faux = monter(<BoutonModeles />, vueModeles(), { 'PUT /api/modeles/niveau': vueModeles({ niveau: 'sens', reranker: 'exclu' }) });
		const menu = await ouvrir(boutonGlobal());
		const choix = within(menu).getAllByRole('menuitemradio');
		expect(choix.map((x) => [x.textContent?.split(':')[0]?.replace(/^[●○]/u, ''), x.getAttribute('aria-checked')])).toEqual([
			['CompletsSens et reclassement ', 'true'],
			['Sens seulSans reclassement ', 'false'],
			['CoupésMots seuls ', 'false'],
		]);
		// le focus va au choix coché à l'ouverture ; flèches entre les items
		expect(document.activeElement).toBe(choix[0]);
		await act(async () => fireEvent.keyDown(menu, { key: 'ArrowDown' }));
		expect(document.activeElement).toBe(choix[1]);
		await act(async () => fireEvent.click(choix[1]!));
		expect(faux.api.remplacer).toHaveBeenCalledWith('/api/modeles/niveau', { niveau: 'sens' });
		expect((await boutonGlobal()).textContent).toBe('Sens seul prêt');
	});

	it('Échap ferme le menu et rend le focus au bouton', async () => {
		monter(<BoutonModeles />, vueModeles());
		const menu = await ouvrir(boutonGlobal());
		await act(async () => fireEvent.keyDown(menu, { key: 'Escape' }));
		expect(screen.queryByRole('menu')).toBeNull();
		expect(document.activeElement).toBe(await boutonGlobal());
	});

	it('en veille : « Démarrer maintenant » appelle la route ; coupés : désactivé, avec son motif visible', async () => {
		const faux = monter(<BoutonModeles />, vueModeles({ gardien: 'arrete', sens: 'arrete', reranker: 'arrete' }), { '/api/modeles/demarrer': vueModeles({ gardien: 'demarrage' }) });
		let menu = await ouvrir(boutonGlobal());
		await act(async () => fireEvent.click(within(menu).getByRole('menuitem', { name: 'Démarrer maintenant' })));
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/modeles/demarrer', undefined);
		cleanup();
		monter(<BoutonModeles />, vueModeles({ niveau: 'coupes', gardien: 'arrete', sens: 'exclu', reranker: 'exclu' }));
		menu = await ouvrir(boutonGlobal());
		const demarrer = within(menu).getByRole('menuitem', { name: /Démarrer maintenant/u }) as HTMLButtonElement;
		expect(demarrer.disabled).toBe(true);
		expect(demarrer.textContent).toContain('Les modèles sont coupés partout');
	});

	it('prêts : « Arrêter maintenant » ; des modèles encore en chargement : un toast le dit', async () => {
		const faux = monter(<BoutonModeles />, vueModeles(), { '/api/modeles/arreter': { ...vueModeles({ gardien: 'arrete' }), arret: { enChargement: 1 } } });
		const menu = await ouvrir(boutonGlobal());
		await act(async () => fireEvent.click(within(menu).getByRole('menuitem', { name: 'Arrêter maintenant' })));
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/modeles/arreter', undefined);
		expect(await screen.findByText(ENCORE_EN_CHARGEMENT)).toBeTruthy();
	});
});

describe('bouton de session', () => {
	const boutonSession = () => screen.findByRole('button', { name: /^Modèles de cette session/u });

	it('libellé : le niveau effectif (rien pour complets), ou l’activité de la session', async () => {
		const cas: [Partial<EtatModelesVue>, NiveauModeles | null, string, string][] = [
			[{}, null, 'Modèles de cette session : comme partout (Complets)', ''],
			[{ niveau: 'sens', reranker: 'exclu' }, null, 'Modèles de cette session : comme partout (Sens seul)', 'Sens'],
			[{}, 'coupes', 'Modèles de cette session : Coupés', 'Coupés'],
			// le plus restrictif des deux
			[{ niveau: 'coupes', sens: 'exclu', reranker: 'exclu' }, 'sens', 'Modèles de cette session : Sens seul', 'Coupés'],
			[{ activites: [activite('recherche', { session: 'autre' }), activite('injection', { session: 's1' })] }, null, 'Modèles de cette session : comme partout (Complets) – Injection…', 'Injection…'],
		];
		for (const [e, propre, nom, texte] of cas) {
			monter(<ModelesSession session="s1" niveau={propre} />, vueModeles(e));
			const bouton = await boutonSession();
			expect(bouton.getAttribute('aria-label')).toBe(nom);
			expect(bouton.textContent).toBe(texte);
			cleanup();
		}
	});

	it('menu : un niveau plus large que celui de partout est désactivé, son motif visible ; un choix appelle la route de la session', async () => {
		const faux = monter(<ModelesSession session="s1" niveau={null} />, vueModeles({ niveau: 'sens', reranker: 'exclu' }), { 'PUT /api/sessions/s1/modeles': { session: {} } });
		const menu = await ouvrir(boutonSession());
		const choix = within(menu).getAllByRole('menuitemradio') as HTMLButtonElement[];
		expect(choix.map((x) => x.disabled)).toEqual([false, true, false, false]);
		expect(choix[0]!.getAttribute('aria-checked')).toBe('true');
		expect(choix[0]!.textContent).toContain('Comme partout (Sens seul)');
		expect(choix[1]!.textContent).toContain('Indisponible : limité partout à « Sens seul »');
		expect(within(menu).getByText('Reclassement').nextElementSibling?.textContent).toBe('non utilisé');
		await act(async () => fireEvent.click(choix[3]!));
		expect(faux.api.remplacer).toHaveBeenCalledWith('/api/sessions/s1/modeles', { niveau: 'coupes' });
		expect(screen.queryByRole('menu')).toBeNull();
		await ouvrir(boutonSession());
		await act(async () => fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitemradio')[0]!));
		expect(faux.api.remplacer).toHaveBeenLastCalledWith('/api/sessions/s1/modeles', { niveau: null });
	});
});

describe('« Injecté dans la session » sans notes : la raison selon le niveau', () => {
	const c = (id: string, rang: number) => ({ id, titre: id, note: null, servi: false, rang });
	const SANS_NOTES: EntreeServieVue = { session: 's1', moment: 'message', horodatageMs: 1, ids: [], texte: '', ms: 1, sens: false, classement: [c('a.md', 1), c('b.md', 2)], muet: null, cartes: [] };

	async function classement(vue: EtatModelesVue, niveau: NiveauModeles | null): Promise<string | null> {
		monter(<ClassementEnDirect session="s1" entrees={[SANS_NOTES]} modifiable niveauModeles={niveau} surOuvrirFiche={() => {}} couleur={() => ''} />, vue, {
			'/api/sessions/s1/ecartes': { ecartes: [] },
			'/api/sessions/s1/a-servir': { chemins: [] },
		});
		await act(async () => {});
		const avis = screen.queryByText(/^Notes indisponibles/u)?.textContent ?? null;
		cleanup();
		return avis;
	}

	it('coupés partout, ou pour la session ; sens seul pour la session : dit, sans « Démarrer » ; arrêtés : « Démarrer »', async () => {
		const coupes = vueModeles({ niveau: 'coupes', gardien: 'arrete', sens: 'exclu', reranker: 'exclu' });
		expect(await classement(coupes, null)).toBe('Notes indisponibles : modèles coupés');
		expect(await classement(vueModeles(), 'coupes')).toBe('Notes indisponibles : modèles coupés pour cette session');
		expect(await classement(vueModeles(), 'sens')).toBe('Notes indisponibles : sens seul pour cette session');
		expect(await classement(vueModeles({ niveau: 'sens', reranker: 'exclu' }), null)).toBe('Notes indisponibles : sens seul');
		// arrêtés : le bouton reste, la session en sens seul comprise (le sens est permis, il ne tourne pas)
		expect(await classement(vueModeles({ gardien: 'arrete', sens: 'arrete', reranker: 'arrete' }), 'sens')).toBe('Notes indisponibles : modèles arrêtésDémarrer');
		expect(await classement(vueModeles(), null)).toBeNull();
	});
});
