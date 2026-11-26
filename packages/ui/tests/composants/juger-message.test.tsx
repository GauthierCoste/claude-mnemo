// @vitest-environment happy-dom
import { ROUTES, type CandidateAJugerVue, type DemandeReponseMessage, type VueEntrainement, type VueMessageAJuger } from '@mnemo/contrat';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErreurApi } from '../../src/client/api.ts';
import { FournisseurClient } from '../../src/client/contexte.tsx';
import { JugerMessage } from '../../src/composants/memoire/entrainer/JugerMessage.tsx';
import { apresCeluiCi, choixDeDepart, demandeSilence, demandeValider, progression, sansReponse } from '../../src/memoire/jugement.ts';
import { FournisseurNavigation, type Vue } from '../../src/navigation.tsx';
import { creerFauxClient } from '../aides/faux-client.tsx';

afterEach(cleanup);

const fiche = (chemin: string, o: Partial<CandidateAJugerVue> = {}): CandidateAJugerVue => ({
	chemin,
	titre: chemin.replace(/\.md$/, ''),
	ligne: `Première ligne de ${chemin}`,
	synthese: `Synthèse de ${chemin}`,
	proposition: null,
	jugement: null,
	...o,
});

/** Un message à juger : trois fiches sans réponse, deux autres messages à juger après lui. */
function message(indice: number, o: Partial<VueMessageAJuger> = {}): VueMessageAJuger {
	return { indice, message: `Message fictif ${indice}`, precedent: null, candidates: [fiche('a.md'), fiche('b.md'), fiche('c.md')], valide: false, silence: false, saute: false, aRelire: false, restants: 3, ...o };
}

const ETAT: VueEntrainement = {
	note: { niveaux: [], avant: false },
	banc: { messages: 3, valides: 0, aJuger: 3, aRelire: 0, aPrejuger: 0, silences: 0, sautes: 0, paires: 0 },
	tache: null,
	historique: [],
	juge: { disponible: true },
	resultat: null,
};

type Options = {
	/** Les messages lus, par indice ; le premier est le prochain. */
	messages?: VueMessageAJuger[];
	/** Réponse à un message : l'indice suivant (null : fin), ou une erreur levée. */
	repondre?: (d: DemandeReponseMessage) => number | null;
	annuler?: () => { indice: number };
	vue?: Vue;
};

function monter(o: Options = {}) {
	const messages = o.messages ?? [message(0)];
	const surFermer = vi.fn();
	const faux = creerFauxClient({
		[ROUTES.entrainement]: ETAT,
		[ROUTES.entrainementMessage]: (params: Record<string, string> | undefined, corps: unknown) => {
			if (corps !== undefined) return { suivant: (o.repondre ?? (() => null))(corps as DemandeReponseMessage) };
			const indice = params?.['indice'];
			return { message: indice === undefined ? (messages[0] ?? null) : (messages.find((m) => m.indice === Number(indice)) ?? null) };
		},
		[ROUTES.entrainementAnnuler]: () => (o.annuler ?? (() => ({ indice: 0 })))(),
	});
	render(
		<FournisseurClient client={faux.client}>
			<FournisseurNavigation vueInitiale={o.vue ?? 'memoire'} ongletMemoireInitial="entrainer">
				<JugerMessage surFermer={surFermer} />
			</FournisseurNavigation>
		</FournisseurClient>,
	);
	return { faux, surFermer };
}

const fiches = () => within(screen.getByRole('list', { name: 'Fiches proposées pour ce message' })).getAllByRole('listitem');
const groupe = (titre: string) => screen.getByRole('radiogroup', { name: titre });
const coche = (titre: string) => (within(groupe(titre)).getAllByRole('radio') as HTMLInputElement[]).find((r) => r.checked)?.value ?? null;
const touche = (key: string, cible: EventTarget = document.activeElement ?? document.body) => act(() => void cible.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
const envois = (faux: ReturnType<typeof creerFauxClient>) => faux.api.envoyer.mock.calls.filter(([chemin]) => chemin === ROUTES.entrainementMessage).map(([, corps]) => corps as DemandeReponseMessage);

describe('écran de jugement', () => {
	it('le message, celui d’avant atténué, les fiches dans l’ordre reçu : titre, ligne, synthèse dépliable, trois choix ; jugements déjà donnés pré-remplis', async () => {
		monter({ messages: [message(4, { precedent: 'On part sur un schéma par client ?', candidates: [fiche('c.md'), fiche('a.md', { jugement: 'non_pertinente' }), fiche('b.md')] })] });
		expect(await screen.findByText('Message fictif 4')).toBeTruthy();
		expect(screen.getByText('Message d’avant')).toBeTruthy();
		expect(screen.getByText('On part sur un schéma par client ?')).toBeTruthy();
		expect(fiches().map((li) => li.getAttribute('data-fiche'))).toEqual(['c.md', 'a.md', 'b.md']);
		const premiere = fiches()[0]!;
		expect(premiere.textContent).toContain('Première ligne de c.md');
		expect(within(premiere).getByText('Synthèse').closest('details')!.open).toBe(false);
		expect(within(groupe('c')).getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual(['Utile', 'Pas utile', 'Je ne sais pas']);
		expect(coche('a')).toBe('non_pertinente');
		expect(coche('c')).toBeNull();
		expect(screen.getByText('Message 1 – 2 autres à juger')).toBeTruthy();
	});

	it('proposition du juge : son choix pré-sélectionné, marqué « Claude », raison et confiance dites ; changeable', async () => {
		const proposition = { jugement: 'pertinente' as const, confiance: 0.96, raison: 'La fiche décrit ce choix.' };
		const { faux } = monter({ messages: [message(2, { aRelire: true, candidates: [fiche('a.md', { proposition }), fiche('b.md')] })] });
		await screen.findByText('Message fictif 2');
		expect(coche('a')).toBe('pertinente');
		const utile = within(groupe('a')).getByRole('radio', { name: 'Utile' }).closest('label')!;
		expect(utile.textContent).toContain('Claude');
		expect(utile.getAttribute('title')).toBe('Claude propose « Utile » (sûr à 96 %) : La fiche décrit ce choix.');
		expect(document.getElementById(groupe('a').getAttribute('aria-describedby')!)!.textContent).toContain('sûr à 96 %');
		// la proposition validée telle quelle : envoyée comme jugement
		await act(async () => screen.getByRole('button', { name: 'Valider' }).click());
		expect(envois(faux)).toEqual([{ indice: 2, jugements: { 'a.md': 'pertinente' }, resteNonUtile: true }]);
		cleanup();
		// changée : le choix de l'utilisateur part, la marque reste sur la proposition
		const autre = monter({ messages: [message(2, { candidates: [fiche('a.md', { proposition })] })] });
		await screen.findByText('Message fictif 2');
		await act(async () => within(groupe('a')).getByRole('radio', { name: 'Pas utile' }).click());
		expect(coche('a')).toBe('non_pertinente');
		expect(within(groupe('a')).getByRole('radio', { name: 'Utile' }).closest('label')!.textContent).toContain('Claude');
		await act(async () => screen.getByRole('button', { name: 'Valider' }).click());
		expect(envois(autre.faux)[0]!.jugements).toEqual({ 'a.md': 'non_pertinente' });
	});

	it('« Le reste n’est pas utile » : coché par défaut, dit combien de fiches il touche ; décoché sans réponse, Valider indisponible avec sa raison', async () => {
		const { faux } = monter({ repondre: () => 1, messages: [message(0), message(1)] });
		await screen.findByText('Message fictif 0');
		const reste = screen.getByRole('checkbox', { name: /Le reste n’est pas utile/ }) as HTMLInputElement;
		expect(reste.checked).toBe(true);
		expect(document.getElementById(reste.getAttribute('aria-describedby')!)!.textContent).toBe('3 fiches sans réponse');
		await act(async () => within(groupe('b')).getByRole('radio', { name: 'Utile' }).click());
		expect(document.getElementById(reste.getAttribute('aria-describedby')!)!.textContent).toBe('2 fiches sans réponse');
		await act(async () => within(groupe('b')).getByRole('radio', { name: 'Je ne sais pas' }).click());
		await act(async () => reste.click());
		await act(async () => screen.getByRole('button', { name: 'Valider' }).click());
		expect(envois(faux)).toEqual([{ indice: 0, jugements: { 'b.md': 'indecise' }, resteNonUtile: false }]);
		// le suivant : tout sans réponse, reste décoché → rien à valider
		await screen.findByText('Message fictif 1');
		await act(async () => (screen.getByRole('checkbox', { name: /Le reste n’est pas utile/ }) as HTMLInputElement).click());
		const valider = screen.getByRole('button', { name: 'Valider' });
		expect(valider.getAttribute('aria-disabled')).toBe('true');
		expect(document.getElementById(valider.getAttribute('aria-describedby')!)!.textContent).toContain('Réponds pour une fiche au moins');
		await act(async () => valider.click());
		expect(envois(faux)).toHaveLength(1);
	});

	it('clavier : ↓/↑ change de fiche, o / n / i jugent et passent à la suivante, Entrée valide, Échap revient', async () => {
		const { faux, surFermer } = monter({ repondre: () => 1, messages: [message(0), message(1)] });
		await screen.findByText('Message fictif 0');
		// la première fiche a le focus
		await waitFor(() => expect(fiches()[0]!.contains(document.activeElement)).toBe(true));
		touche('o');
		expect(coche('a')).toBe('pertinente');
		expect(fiches()[1]!.contains(document.activeElement)).toBe(true);
		touche('ArrowUp');
		expect(fiches()[0]!.contains(document.activeElement)).toBe(true);
		touche('ArrowDown');
		touche('n');
		touche('i');
		expect([coche('a'), coche('b'), coche('c')]).toEqual(['pertinente', 'non_pertinente', 'indecise']);
		// la dernière garde le focus, sur le choix fait
		expect(document.activeElement).toBe(within(groupe('c')).getByRole('radio', { name: 'Je ne sais pas' }));
		await act(async () => touche('Enter'));
		await waitFor(() => expect(envois(faux)).toEqual([{ indice: 0, jugements: { 'a.md': 'pertinente', 'b.md': 'non_pertinente', 'c.md': 'indecise' }, resteNonUtile: true }]));
		await screen.findByText('Message fictif 1');
		// Entrée sur un bouton : le bouton garde la sienne (rien n'est validé à sa place)
		touche('Enter', screen.getByRole('button', { name: 'Passer' }));
		expect(envois(faux)).toHaveLength(1);
		touche('Escape');
		expect(surFermer).toHaveBeenCalledTimes(1);
	});

	it('clavier : rien n’est pris dans un champ de saisie, ni quand la vue Mémoire est cachée', async () => {
		const { surFermer } = monter({ vue: 'sessions' });
		await screen.findByText('Message fictif 0');
		touche('o', document.body);
		touche('Escape', document.body);
		expect(coche('a')).toBeNull();
		expect(surFermer).not.toHaveBeenCalled();
		cleanup();
		const affiche = monter();
		await screen.findByText('Message fictif 0');
		const champ = document.createElement('input');
		document.body.append(champ);
		touche('o', champ);
		touche('Escape', champ);
		expect(coche('a')).toBeNull();
		expect(affiche.surFermer).not.toHaveBeenCalled();
		champ.remove();
	});

	it('clavier : rien n’est pris quand le focus est hors de l’écran (palette, modale, tiroir) ; Échap non plus', async () => {
		const { surFermer } = monter();
		await screen.findByText('Message fictif 0');
		const palette = document.createElement('div');
		palette.setAttribute('role', 'dialog');
		const bouton = document.createElement('button');
		palette.append(bouton);
		document.body.append(palette);
		touche('o', bouton);
		touche('Enter', palette);
		touche('Escape', palette);
		expect(coche('a')).toBeNull();
		expect(surFermer).not.toHaveBeenCalled();
		palette.remove();
		// sans focus (sur la page) : pris
		touche('o', document.body);
		expect(coche('a')).toBe('pertinente');
	});

	it('double Entrée : un seul envoi ; à la fin, Entrée ne renvoie pas le message déjà répondu', async () => {
		const { faux } = monter({ repondre: () => null });
		await screen.findByText('Message fictif 0');
		await waitFor(() => expect(fiches()[0]!.contains(document.activeElement)).toBe(true));
		const radio = document.activeElement!;
		await act(async () => {
			radio.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			radio.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		});
		expect(await screen.findByRole('heading', { name: 'Tout est jugé' })).toBeTruthy();
		touche('Enter', document.body);
		touche('o', document.body);
		await act(async () => {});
		expect(envois(faux)).toHaveLength(1);
	});

	it('« Rien d’utile ici » : indisponible si une fiche est marquée Utile ; refusé par le service (409), dit à côté de l’action', async () => {
		const { faux } = monter({
			repondre: (d) => {
				if (d.silence === true) throw new ErreurApi("« Rien d'utile ici » est refusé : une fiche de ce message est jugée utile.", 409);
				return null;
			},
		});
		await screen.findByText('Message fictif 0');
		await act(async () => within(groupe('a')).getByRole('radio', { name: 'Utile' }).click());
		const rien = screen.getByRole('button', { name: 'Rien d’utile ici' });
		expect(rien.getAttribute('aria-disabled')).toBe('true');
		expect(document.getElementById(rien.getAttribute('aria-describedby')!)!.textContent).toContain('une fiche est marquée « Utile »');
		await act(async () => within(groupe('a')).getByRole('radio', { name: 'Je ne sais pas' }).click());
		await act(async () => screen.getByRole('button', { name: 'Rien d’utile ici' }).click());
		expect(envois(faux)).toEqual([{ indice: 0, jugements: { 'a.md': 'indecise' }, resteNonUtile: true, silence: true }]);
		const barre = screen.getByRole('button', { name: 'Rien d’utile ici' }).parentElement!.parentElement!;
		expect((await within(barre).findByRole('alert')).textContent).toContain('est refusé');
		// le message reste, rien n'est perdu
		expect(coche('a')).toBe('indecise');
	});

	it('« Passer » : le message mis de côté, le suivant lu par son indice', async () => {
		const { faux } = monter({ repondre: () => 7, messages: [message(0), message(7)] });
		await screen.findByText('Message fictif 0');
		await act(async () => screen.getByRole('button', { name: 'Passer' }).click());
		expect(envois(faux)).toEqual([{ indice: 0, jugements: {}, resteNonUtile: false, passer: true }]);
		expect(await screen.findByText('Message fictif 7')).toBeTruthy();
		expect(faux.api.lire).toHaveBeenCalledWith(ROUTES.entrainementMessage, { indice: '7' });
		expect(screen.getByText('Message 2 – 2 autres à juger')).toBeTruthy();
	});

	it('« Annuler le dernier » : absent avant une réponse ; après, rouvre le message rétabli', async () => {
		const { faux } = monter({ repondre: () => 1, annuler: () => ({ indice: 0 }), messages: [message(0), message(1)] });
		await screen.findByText('Message fictif 0');
		expect(screen.queryByRole('button', { name: 'Annuler le dernier' })).toBeNull();
		await act(async () => screen.getByRole('button', { name: 'Valider' }).click());
		await screen.findByText('Message fictif 1');
		await act(async () => screen.getByRole('button', { name: 'Annuler le dernier' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith(ROUTES.entrainementAnnuler);
		expect(await screen.findByText('Message fictif 0')).toBeTruthy();
		expect(faux.api.lire).toHaveBeenCalledWith(ROUTES.entrainementMessage, { indice: '0' });
		expect(screen.queryByRole('button', { name: 'Annuler le dernier' })).toBeNull();
		expect(screen.getByText('Message 1 – 2 autres à juger')).toBeTruthy();
	});

	it('fin : après la dernière réponse, « Tout est jugé » et le retour à la page (focus dessus) ; « Annuler le dernier » reste possible', async () => {
		const { surFermer } = monter({ repondre: () => null });
		await screen.findByText('Message fictif 0');
		await act(async () => screen.getByRole('button', { name: 'Valider' }).click());
		expect(await screen.findByRole('heading', { name: 'Tout est jugé' })).toBeTruthy();
		expect(screen.getByText(/apprendre la note/)).toBeTruthy();
		const retour = screen.getByRole('button', { name: 'Revenir à l’entraînement' });
		await waitFor(() => expect(document.activeElement).toBe(retour));
		expect(screen.getByRole('button', { name: 'Annuler le dernier' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Retour' })).toBeNull();
		await act(async () => retour.click());
		expect(surFermer).toHaveBeenCalled();
	});

	it('rien à juger dès l’ouverture : « Rien à juger »', async () => {
		monter({ messages: [] });
		expect(await screen.findByRole('heading', { name: 'Rien à juger' })).toBeTruthy();
	});
});

describe('règles de l’écran de jugement', () => {
	it('choix de départ, fiches sans réponse, demandes, progression', () => {
		const m = message(3, { candidates: [fiche('a.md', { jugement: 'indecise', proposition: { jugement: 'pertinente', confiance: 0.9, raison: '' } }), fiche('b.md', { proposition: { jugement: 'non_pertinente', confiance: 0.8, raison: '' } }), fiche('c.md')] });
		const choix = choixDeDepart(m.candidates);
		expect(choix).toEqual({ 'a.md': 'indecise', 'b.md': 'non_pertinente' });
		expect(sansReponse(m.candidates, choix)).toBe(1);
		expect(demandeValider(m, { ...choix, 'z.md': 'pertinente' }, true)).toEqual({ indice: 3, jugements: choix, resteNonUtile: true });
		expect(demandeSilence(m, choix)).toMatchObject({ silence: true });
		expect(apresCeluiCi({ restants: 1, valide: false, silence: false, saute: false })).toBe(0);
		expect(apresCeluiCi({ restants: 1, valide: true, silence: false, saute: false })).toBe(1);
		expect(progression(1, { restants: 1, valide: false, silence: false, saute: false })).toBe('Message 1 – le dernier à juger');
		expect(progression(2, { restants: 3, valide: false, silence: false, saute: false })).toBe('Message 2 – 2 autres à juger');
		expect(progression(2, { restants: 2, valide: false, silence: false, saute: false })).toBe('Message 2 – 1 autre à juger');
	});
});
