// @vitest-environment happy-dom
import type { ReponseQuotas } from '@mnemo/contrat';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FournisseurClient } from '../../src/client/contexte.tsx';
import { abonnementsEnCours, Quotas, quotasEnCours, remiseLisible } from '../../src/composants/Quotas.tsx';
import { creerFauxClient } from '../aides/faux-client.tsx';

afterEach(cleanup);

const midi = new Date(2026, 10, 24, 12, 0).getTime();

describe('remiseLisible', () => {
	it("l'heure seule le jour même, le jour de la semaine sinon", () => {
		expect(remiseLisible(new Date(2026, 10, 24, 18, 0).getTime(), midi)).toBe('18:00');
		expect(remiseLisible(new Date(2026, 10, 30, 9, 5).getTime(), midi)).toBe('lun. 09:05');
	});
});

describe('quotasEnCours', () => {
	it('retire une fenêtre passée sa remise à zéro', () => {
		const q = { cinqHeures: { pourcentage: 90, remiseMs: midi - 1 }, semaine: { pourcentage: 61, remiseMs: midi + 1 } };
		expect(quotasEnCours(q, midi)).toEqual({ semaine: q.semaine });
		expect(quotasEnCours(null, midi)).toEqual({});
	});
});

describe('abonnementsEnCours', () => {
	it('Claude puis ChatGPT ; un abonnement sans fenêtre valable est omis', () => {
		const claude = { semaine: { pourcentage: 61, remiseMs: midi + 1 }, releveMs: midi };
		const chatgpt = { cinqHeures: { pourcentage: 5, remiseMs: midi + 1 } };
		expect(abonnementsEnCours({ codex: chatgpt, 'claude-code': claude }, midi).map((a) => [a.libelle, a.quotas])).toEqual([
			['Claude', { semaine: claude.semaine }],
			['ChatGPT', chatgpt],
		]);
		expect(abonnementsEnCours({ 'claude-code': { semaine: { pourcentage: 1, remiseMs: midi - 1 } }, codex: chatgpt }, midi).map((a) => a.libelle)).toEqual(['ChatGPT']);
		expect(abonnementsEnCours({}, midi)).toEqual([]);
	});
});

describe('Quotas dans la barre de titre', () => {
	const dans = (heures: number) => Date.now() + heures * 3_600_000;
	const monter = (reponse: ReponseQuotas) => {
		const faux = creerFauxClient({ '/api/quotas': reponse });
		render(
			<FournisseurClient client={faux.client}>
				<Quotas />
			</FournisseurClient>,
		);
		return faux;
	};
	const libelles = (bouton: HTMLElement) => [...bouton.querySelectorAll('[data-moteur]')].map((e) => e.getAttribute('data-moteur'));

	it('les deux abonnements côte à côte quand les deux sont relevés, chacun avec son libellé', async () => {
		const claude = { cinqHeures: { pourcentage: 42, remiseMs: dans(2) }, releveMs: Date.now() };
		monter({ quotas: claude, moteurs: { 'claude-code': claude, codex: { semaine: { pourcentage: 18, remiseMs: dans(72) } } } });
		const bouton = await screen.findByRole('button', { name: /^Quotas des abonnements/u });
		expect(libelles(bouton)).toEqual(['claude-code', 'codex']);
		expect(bouton.textContent).toBe('ClaudeChatGPT');
		expect(bouton.getAttribute('aria-label')).toMatch(/Claude : 5 heures : 42 %.* ; ChatGPT : semaine : 18 %/u);
	});

	it('seulement celui qui est relevé ; tenu par le message quotasMoteurs', async () => {
		const faux = monter({ quotas: null, moteurs: { codex: { semaine: { pourcentage: 18, remiseMs: dans(72) } } } });
		const bouton = await screen.findByRole('button', { name: /^Quotas des abonnements/u });
		expect(libelles(bouton)).toEqual(['codex']);
		await act(async () => faux.connexion.emettre({ type: 'quotasMoteurs', moteurs: { 'claude-code': { semaine: { pourcentage: 3, remiseMs: dans(5) } } } }));
		expect(libelles(screen.getByRole('button', { name: /^Quotas des abonnements/u }))).toEqual(['claude-code']);
	});

	it('un service sans moteurs : les quotas de Claude seuls ; rien sans relevé', async () => {
		monter({ quotas: { semaine: { pourcentage: 3, remiseMs: dans(5) } } });
		expect(libelles(await screen.findByRole('button', { name: /^Quotas des abonnements/u }))).toEqual(['claude-code']);
		cleanup();
		monter({ quotas: null, moteurs: {} });
		await act(async () => {});
		expect(screen.queryByRole('button', { name: /^Quotas des abonnements/u })).toBeNull();
	});
});
