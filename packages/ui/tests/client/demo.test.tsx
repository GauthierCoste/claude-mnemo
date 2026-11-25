// @vitest-environment happy-dom
import { avertissementNonCherchable, consigneATraiter, estIdMoteur, IDS_MOTEURS, NOMS_MOTEURS } from '@mnemo/commun';
import { ROUTES, type ClaudeDesktopVue, type DocumentVue, type EtatModelesVue, type EntreeServieVue, type LueVue, type ReponseDocuments, type ReponseEcarteesToujours, type ReponseServis, type ReponseTraiter, type DonneesGraphe, type FicheVue, type FilVue, type ReponseLots, type ReponseMoteurs, type ReponseProfils, type ReponseQuotas, type ReponseValidationLot, type SessionTermineeVue, type SessionVue } from '@mnemo/contrat';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ErreurApi } from '../../src/client/api.ts';
import { creerClientDemo } from '../../src/client/demo.ts';
import { CLASSEMENT_VIVANT_DEMO } from '../../src/client/demo-donnees.ts';
import { aujourdhui } from '../../src/client/hooks.ts';
import { Application } from '../../src/composants/Application.tsx';
import { grouperSessions } from '../../src/sessions/groupes.ts';

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('mode démo', () => {
	it('nourrit la coquille sans jeton : racine, pastilles, connexion ouverte', async () => {
		const client = creerClientDemo();
		render(<Application client={client} />);
		expect(await within(screen.getByRole('banner')).findByText('~/Developer')).toBeTruthy();
		const nav = screen.getByRole('navigation');
		await screen.findByText('service connecté');
		expect(within(nav).getByRole('button', { name: /Sessions/ }).textContent).toContain('5');
		expect(screen.getByText('données fictives')).toBeTruthy();
	});

	it('profils (dont un de l’utilisateur) ; une session lue par son id, terminée comprise ; inconnue → 404', async () => {
		const { api } = creerClientDemo();
		const { profils } = await api.lire<ReponseProfils>(ROUTES.profils);
		expect(profils.map((p) => p.nom)).toContain('redaction');
		const { sessions } = await api.lire<{ sessions: SessionVue[] }>(ROUTES.sessions);
		const terminee = sessions.find((s) => s.etat === 'terminee')!;
		expect((await api.lire<{ session: SessionVue }>(ROUTES.session.replace(':id', terminee.id))).session.id).toBe(terminee.id);
		await expect(api.lire(ROUTES.session.replace(':id', 'inconnue'))).rejects.toMatchObject({ statut: 404 });
	});

	it('app Claude : brancher la mémoire, ajouter, modifier (NOM seul garde la valeur), retirer ; jamais de valeur de variable', async () => {
		const { api } = creerClientDemo();
		const avant = await api.lire<ClaudeDesktopVue>(ROUTES.claudeDesktop);
		expect(avant).toMatchObject({ installee: true, mnemo: 'perime' });
		expect(JSON.stringify(avant)).not.toContain('valeur-fictive');
		expect((await api.remplacer<ClaudeDesktopVue>(ROUTES.claudeDesktopMnemo, {})).mnemo).toBe('branche');
		expect((await api.supprimer<ClaudeDesktopVue>(ROUTES.claudeDesktopMnemo)).mnemo).toBe('absent');
		await api.envoyer(ROUTES.claudeDesktopServeurs, { nom: 'outil', commande: 'uvx', args: ['outil-mcp'], env: { JETON: 'x' } });
		await expect(api.envoyer(ROUTES.claudeDesktopServeurs, { nom: 'outil', commande: 'uvx', args: [], env: {} })).rejects.toMatchObject({ statut: 409 });
		// comme le service : « mnemo » réservé quelle que soit la casse, une variable nouvelle a besoin d'une valeur
		await expect(api.envoyer(ROUTES.claudeDesktopServeurs, { nom: 'Mnemo', commande: 'uvx', args: [], env: {} })).rejects.toMatchObject({ statut: 400 });
		await expect(api.envoyer(ROUTES.claudeDesktopServeurs, { nom: 'autre', commande: 'uvx', args: [], env: { JETON: null } })).rejects.toMatchObject({ statut: 400 });
		const renomme = await api.remplacer<ClaudeDesktopVue>(ROUTES.claudeDesktopServeur.replace(':id', 'notes'), { nom: 'notes-2', commande: 'npx', args: [], env: { CLE_API: null } });
		expect(renomme.serveurs.map((x) => x.nom)).toEqual(['notes-2', 'agenda', 'outil']);
		expect(renomme.serveurs[0]!.env).toEqual(['CLE_API']);
		const retire = await api.supprimer<ClaudeDesktopVue>(ROUTES.claudeDesktopServeur.replace(':id', 'agenda'));
		expect(retire.serveurs.map((x) => x.nom)).toEqual(['notes-2', 'outil']);
		await expect(api.supprimer(ROUTES.claudeDesktopServeur.replace(':id', 'agenda'))).rejects.toMatchObject({ statut: 404 });
	});

	it('première session : le message classé (note calibrée, une injection par Mnemo), puis la position et ses pistes ◇ variées, fiches lues', async () => {
		const { api } = creerClientDemo();
		const { servis, lues, injections } = await api.lire<ReponseServis>(ROUTES.servis.replace(':id', '7f3a2c4e-1b9d-4e57-a0c2-5d18e6f0a7b1'));
		const [classee, entree] = servis as [EntreeServieVue, EntreeServieVue];
		expect(classee).toMatchObject({ calibree: true, mesure: 'complets', affinage: 'fait', ids: ['consignes/Migrations réversibles.md'] });
		expect(classee.classement.find((c) => c.auto)).toMatchObject({ id: 'consignes/Migrations réversibles.md', servi: true });
		expect(classee.classement.every((c) => typeof c.p === 'number' && c.signaux !== undefined && c.raison !== undefined)).toBe(true);
		expect(injections).toEqual([expect.objectContaining({ chemin: 'consignes/Migrations réversibles.md', mode: 'auto', p: 0.94 })]);
		expect(entree.ids).toEqual(['projets/erp-saas/Module stocks.md']);
		expect(entree.titres).toEqual({ 'projets/erp-saas/Module stocks.md': 'Module stocks' });
		expect(new Set(entree.cartes.map((c) => c.raison))).toEqual(new Set(['perimetre', 'nommee', 'question', 'liee']));
		expect(entree.cartes.find((c) => c.raison === 'liee')?.depuis).toEqual({ id: 'projets/erp-saas/Module stocks.md', titre: 'Module stocks' });
		expect(lues.length).toBeGreaterThan(0);
		// chaque lue a son heure, la plus récente d'abord ; l'une n'est ni injectée ni proposée (ligne ◈ du panneau)
		expect(lues.map((l) => l.horodatageMs)).toEqual([...lues.map((l) => l.horodatageMs)].sort((a, b) => b - a));
		expect(lues.some((l) => !servis.some((e) => e.ids.includes(l.chemin) || e.cartes.some((c) => c.id === l.chemin) || e.classement.some((c) => c.id === l.chemin)))).toBe(true);
	});

	it('classement vivant : un message qui reclasse (hook puis affiné, même horodatage) et injecte, l’ordre seul ailleurs', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const { api, connexion } = creerClientDemo();
		const recues: EntreeServieVue[] = [];
		connexion.surMessage((m) => m.type === 'servi' && m.entree.session === '7f3a2c4e-1b9d-4e57-a0c2-5d18e6f0a7b1' && recues.push(m.entree));
		await vi.advanceTimersByTimeAsync(12_000);
		expect(recues.map((e) => e.affinage)).toEqual(['en_cours', 'fait', 'en_cours', 'fait']);
		expect(recues[0]!.horodatageMs).toBe(recues[1]!.horodatageMs);
		expect(recues[0]!.classement.map((c) => c.id)).not.toEqual(recues[1]!.classement.map((c) => c.id));
		expect(recues[2]!.classement.find((c) => c.auto)?.id).toBe('projets/erp-saas/Export CSV.md');
		const { sessions } = await api.lire<{ sessions: SessionVue[] }>(ROUTES.sessions);
		const achats = sessions.find((x) => x.objectif === 'Écrire les tests du module achats')!;
		const promesse = api.lire<ReponseServis>(ROUTES.servis.replace(':id', achats.id));
		await vi.advanceTimersByTimeAsync(200);
		const [ordre] = (await promesse).servis;
		expect(ordre).toMatchObject({ calibree: false, mesure: 'ordre' });
		expect(ordre!.classement.every((c) => c.p === null)).toBe(true);
	});

	it('données du classement vivant cohérentes avec les règles du hook : ≥ 90 % ⇔ injectée (2 au plus), pistes nouvelles ≥ 30 % (3 au plus)', () => {
		const { avant, suivants } = CLASSEMENT_VIVANT_DEMO;
		// déjà vues dans la session : les pistes du message de position
		const vues = new Set(['consignes/Migrations réversibles.md', 'projets/erp-saas/Multi-tenant.md', 'stacks/PostgreSQL.md', 'sources/cdc-stocks-v2.md', 'episodes/erp-saas/2026-11-21-schema-des-lots.md']);
		for (const m of [avant, ...suivants]) {
			const autos = m.auto === undefined ? [] : [m.auto];
			for (const lignes of [m.hook, m.affine ?? []]) {
				expect(lignes.filter(([, p]) => p >= 0.9).map(([id]) => id)).toEqual(autos);
			}
			expect(m.pistes.length).toBeLessThanOrEqual(3);
			const attendues = m.hook.filter(([id, p]) => p >= 0.3 && !autos.includes(id) && !vues.has(id)).map(([id]) => id).slice(0, 3);
			expect(m.pistes).toEqual(attendues);
			for (const id of [...m.pistes, ...autos]) vues.add(id);
		}
	});

	it('coupure, réactivation, écartée toujours et rétablie (`&coupure=1`)', async () => {
		const { api } = creerClientDemo({ coupure: true });
		const { sessions } = await api.lire<{ sessions: SessionVue[] }>(ROUTES.sessions);
		expect(sessions[0]!.injectionCoupee?.[0]?.motif).toMatch(/des 100 dernières/u);
		expect(await api.envoyer(ROUTES.injectionAutomatique, { session: sessions[0]!.id })).toEqual({ coupures: [] });
		expect((await api.lire<{ sessions: SessionVue[] }>(ROUTES.sessions)).sessions[0]!.injectionCoupee).toBeUndefined();
		await api.envoyer(ROUTES.ecarteesToujours, { chemin: 'stacks/PostgreSQL.md', session: sessions[0]!.id });
		expect((await api.lire<ReponseEcarteesToujours>(ROUTES.ecarteesToujours)).ecarteesToujours.map((e) => e.chemin)).toEqual(['stacks/PostgreSQL.md']);
		await api.supprimer(ROUTES.ecarteesToujours, { chemin: 'stacks/PostgreSQL.md' });
		expect((await api.lire<ReponseEcarteesToujours>(ROUTES.ecarteesToujours)).ecarteesToujours).toEqual([]);
		await expect(api.supprimer(ROUTES.ecarteesToujours, { chemin: 'stacks/PostgreSQL.md' })).rejects.toMatchObject({ statut: 404 });
	});

	it('données cohérentes : sessions de chaque état, graphe, fiche, fil', async () => {
		const { api } = creerClientDemo();
		const { sessions } = await api.lire<{ sessions: SessionVue[] }>(ROUTES.sessions);
		expect(sessions.map((s) => s.etat).sort()).toEqual(['a_relire', 'a_relire', 'attend', 'attend', 'attend', 'attend', 'attend', 'en_pause', 'en_pause', 'terminee', 'travaille', 'travaille']);
		expect(sessions.filter((s) => s.profil === 'archiviste')).toHaveLength(1);
		// La grille de démonstration : 10 sessions sur 4 dossiers, erp-saas en premier (ordre de création).
		const groupes = grouperSessions(sessions, 'Developer');
		expect(groupes.map((g) => [g.cle, g.sessions.length])).toEqual([['erp-saas', 4], ['api-facturation', 3], ['agent-maison', 1], ['site-vitrine', 2]]);
		expect(sessions.some((s) => !s.terminal)).toBe(true);

		const graphe = await api.lire<DonneesGraphe>(ROUTES.graphe);
		expect(graphe.fiches.length).toBeGreaterThanOrEqual(25);
		expect(graphe.liens.some((l) => l.cible === null)).toBe(true);
		expect(graphe.fiches.find((f) => f.chemin === 'projets/erp-saas/Module stocks.md')).toMatchObject({ etats: ['a_confirmer'], faitsActifs: 4, parent: 'projets/erp-saas/erp-saas.md' });
		expect(graphe.fiches.find((f) => f.chemin === 'projets/erp-saas/achats/Commandes fournisseurs.md')?.parent).toBe('projets/erp-saas/achats/achats.md');

		const fiche = await api.lire<FicheVue>(ROUTES.fiche, { chemin: 'projets/erp-saas/Module stocks.md' });
		expect(fiche.liens.entrants.length).toBeGreaterThan(0);
		expect(fiche.sessions.length).toBeGreaterThan(0);
		const e = (await api.envoyer(ROUTES.brut, { chemin: fiche.chemin, texte: fiche.brut, empreinte: 'perimee' }).catch((x: unknown) => x)) as ErreurApi;
		expect(e.statut).toBe(409);

		const fil = await api.lire<FilVue>(ROUTES.fil, { jour: aujourdhui() });
		expect(fil.commits.length).toBeGreaterThan(0);
		expect(fil.aConfirmer.length).toBeGreaterThan(0);
		expect(fil.montees.length).toBe(2);
	});

	it('moteurs : les quatre du catalogue dans /api/moteurs, chaque profil et chaque session sur un moteur connu, avec un modèle proposé ; Copilot attend son premier message, sans quotas pour Vibe ni Copilot', async () => {
		const { api } = creerClientDemo();
		const { moteurs } = await api.lire<ReponseMoteurs>(ROUTES.moteurs, { poste: '1' });
		expect(moteurs.map((m) => m.id)).toEqual([...IDS_MOTEURS]);
		for (const m of moteurs) {
			expect(m.nom).toBe(NOMS_MOTEURS[m.id]);
			expect(m.poste?.length).toBeGreaterThan(0);
		}
		// les remèdes sont ceux que le service rédige (`remedesDuMoteur`) : `mnemo init <option du moteur>`
		const copilot = moteurs.find((m) => m.id === 'copilot-cli')!;
		expect(copilot.poste!.find((p) => p.cle === 'mcp')?.remede).toEqual({ texte: 'mnemo init --copilot', dans: 'terminal' });
		const { profils } = await api.lire<ReponseProfils>(ROUTES.profils);
		const proposes = (id: string) => moteurs.find((m) => m.id === id)!.modeles;
		for (const p of profils) if (p.modele !== '') expect(proposes(p.moteur)).toContain(p.modele);
		expect(new Set(profils.map((p) => p.moteur))).toEqual(new Set(IDS_MOTEURS));
		const { sessions } = await api.lire<{ sessions: SessionVue[] }>(ROUTES.sessions);
		for (const x of sessions) {
			expect(estIdMoteur(x.moteur ?? 'claude-code')).toBe(true);
			if (x.modele !== undefined) expect(proposes(x.moteur!)).toContain(x.modele);
		}
		const attente = sessions.filter((x) => x.attentePremierMessage !== undefined);
		expect(attente.map((x) => [x.moteur, x.etat, x.terminal, x.attentePremierMessage])).toEqual([['copilot-cli', 'attend', true, 'confiance']]);
		expect(sessions.some((x) => x.moteur === 'mistral-vibe')).toBe(true);
		const quotas = await api.lire<ReponseQuotas>(ROUTES.quotas);
		expect(Object.keys(quotas.moteurs ?? {}).sort()).toEqual(['claude-code', 'codex']);
	});

	it('terminal de GitHub Copilot CLI qui attend son premier message : sa question de confiance, sans aucune marque de Claude Code ; un message tapé la fait commencer', async () => {
		const { api, connexion } = creerClientDemo();
		const recu: string[] = [];
		const recus: SessionVue[] = [];
		connexion.surMessage((m) => void (m.type === 'session' && recus.push(m.session)));
		const id = '6f1b4d8e-9a2c-4e07-b3d5-c8a0e2f4b917';
		connexion.abonner(id, (m) => recu.push(m.type === 'retard' ? 'retard' : m.donnees));
		await new Promise((r) => setTimeout(r, 200));
		expect(recu[0]).toContain('GitHub Copilot CLI');
		expect(recu[0]).toContain('Do you trust the files in this folder?');
		expect(recu[0]).not.toContain('Claude Code');
		expect(recu[0]).not.toContain('? for shortcuts');
		connexion.envoyer({ type: 'entree', session: id, donnees: 'go\r' });
		expect(recus.at(-1)).toMatchObject({ id, etat: 'travaille' });
		expect(recus.at(-1)).not.toHaveProperty('attentePremierMessage');
	});

	it('bilan d’une session GitHub Copilot CLI qui attend son premier message : permis, relancée avec lui, elle attend toujours', async () => {
		const { api } = creerClientDemo();
		const id = '6f1b4d8e-9a2c-4e07-b3d5-c8a0e2f4b917';
		const { session } = await api.envoyer<{ session: SessionVue }>(`/api/sessions/${id}/bilan`);
		expect(session).toMatchObject({ id, etat: 'attend', attentePremierMessage: 'confiance' });
		expect(session.bilanDemandeMs).not.toBeNull();
	});

	it('actions de session : l’état change et un message `session` est diffusé ; nouvelle session → une session', async () => {
		const { api, connexion } = creerClientDemo();
		const recus: SessionVue[] = [];
		connexion.surMessage((m) => void (m.type === 'session' && recus.push(m.session)));
		const pause = '9e02b6f4-8d1a-4c37-b5e9-2a6f0c8d4e13';
		await api.envoyer(`/api/sessions/${pause}/reprise`);
		expect(recus.at(-1)).toMatchObject({ id: pause, etat: 'travaille', terminal: true, dialogueOuvert: false });
		await api.envoyer(`/api/sessions/${pause}/pause`);
		expect(recus.at(-1)).toMatchObject({ id: pause, etat: 'en_pause' });
		await api.envoyer(`/api/sessions/${pause}/abandon`);
		expect(recus.at(-1)).toMatchObject({ id: pause, etat: 'terminee' });
		const r = await api.envoyer<{ session: SessionVue }>(ROUTES.sessions, { profil: 'travail', dossier: 'kit-ui', objectif: 'Essai' });
		expect(r.session).toMatchObject({ dossier: 'kit-ui', objectif: 'Essai', etat: 'travaille' });
		expect(recus.at(-1)?.id).toBe(r.session.id);
		const { sessions: liste } = await api.lire<{ sessions: SessionVue[] }>(ROUTES.sessions);
		expect(liste.some((s) => s.id === r.session.id)).toBe(true);
	});

	it('modèles : vue complète plausible ; niveau, arrêt, démarrage diffusés (`modeles`) ; niveau d’une session diffusé (`session`)', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const { api, connexion } = creerClientDemo();
		const recus: EtatModelesVue[] = [];
		const sessions: SessionVue[] = [];
		connexion.surMessage((m) => {
			if (m.type === 'modeles') recus.push(m.modeles);
			if (m.type === 'session') sessions.push(m.session);
		});
		const etat = await api.lire<EtatModelesVue>(ROUTES.modeles);
		expect(etat).toMatchObject({ installes: true, niveau: 'complets', gardien: 'pret', sens: 'pret', reranker: 'pret', activites: [] });
		expect(etat.pieces).toMatchObject({ sens: { modele: 'bge-m3', editeur: 'BAAI', quantification: 'Q8_0' }, reranker: { modele: 'bge-reranker-v2-m3' }, moteur: { version: 'b11671', plateforme: 'macOS arm64' } });
		expect(await api.remplacer<EtatModelesVue>(ROUTES.modelesNiveau, { niveau: 'sens' })).toMatchObject({ niveau: 'sens', gardien: 'arrete', sens: 'arrete', reranker: 'exclu' });
		expect(recus.at(-1)).toMatchObject({ niveau: 'sens', reranker: 'exclu' });
		expect(await api.envoyer<EtatModelesVue>(ROUTES.modelesDemarrer)).toMatchObject({ gardien: 'demarrage' });
		await vi.advanceTimersByTimeAsync(2000);
		expect(recus.at(-1)).toMatchObject({ gardien: 'pret', sens: 'pret', reranker: 'exclu' });
		// niveau élargi, gardien prêt sans le reranker : « Démarrer » le relance avec les deux (comme le service)
		expect(await api.remplacer<EtatModelesVue>(ROUTES.modelesNiveau, { niveau: 'complets' })).toMatchObject({ gardien: 'pret', sens: 'pret', reranker: 'arrete', inactiviteMinutes: 15 });
		expect(await api.envoyer<EtatModelesVue>(ROUTES.modelesDemarrer)).toMatchObject({ gardien: 'demarrage' });
		await vi.advanceTimersByTimeAsync(2000);
		expect(recus.at(-1)).toMatchObject({ gardien: 'pret', sens: 'pret', reranker: 'pret' });
		expect(await api.envoyer<EtatModelesVue>(ROUTES.modelesArreter)).toMatchObject({ gardien: 'arrete', sens: 'arrete', inactiviteMinutes: null });
		const id = '9e02b6f4-8d1a-4c37-b5e9-2a6f0c8d4e13';
		const r = await api.remplacer<{ session: SessionVue }>(ROUTES.sessionModeles.replace(':id', id), { niveau: 'coupes' });
		expect(r.session).toMatchObject({ id, niveauModeles: 'coupes' });
		expect(sessions.at(-1)).toMatchObject({ id, niveauModeles: 'coupes' });
	});

	it('modèles : `&modeles=` fixe chaque état de départ ; `anime` fait défiler le scénario, arrêté par le premier geste', async () => {
		const etat = (modeles: string) => creerClientDemo({ modeles }).api.lire<EtatModelesVue>(ROUTES.modeles);
		expect(await etat('veille')).toMatchObject({ gardien: 'arrete', sens: 'arrete', activites: [] });
		expect(await etat('chargement')).toMatchObject({ gardien: 'demarrage' });
		expect(await etat('prets')).toMatchObject({ gardien: 'pret', niveau: 'complets', activites: [] });
		expect((await etat('vectorisation')).activites).toMatchObject([{ operation: 'vectorisation', avancement: { faits: 120, total: 800 } }]);
		expect((await etat('recherche')).activites).toMatchObject([{ operation: 'recherche', session: expect.any(String) }]);
		expect(await etat('sens')).toMatchObject({ niveau: 'sens', reranker: 'exclu' });
		expect(await etat('coupes')).toMatchObject({ niveau: 'coupes', sens: 'exclu', reranker: 'exclu' });
		expect(await etat('echec')).toMatchObject({ gardien: 'echec' });
		expect(await etat('inconnu')).toMatchObject({ gardien: 'pret' });
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const { api, connexion } = creerClientDemo({ modeles: 'anime' });
		const recus: EtatModelesVue[] = [];
		connexion.surMessage((m) => {
			if (m.type === 'modeles') recus.push(m.modeles);
		});
		await vi.advanceTimersByTimeAsync(8000);
		expect(recus.map((e) => e.gardien)).toEqual(expect.arrayContaining(['demarrage', 'pret']));
		expect(recus.some((e) => e.activites[0]?.operation === 'vectorisation')).toBe(true);
		await api.remplacer(ROUTES.modelesNiveau, { niveau: 'coupes' });
		const apres = recus.length;
		await vi.advanceTimersByTimeAsync(30_000);
		expect(recus).toHaveLength(apres);
	});

	it('terminal : relecture à l’abonnement, écho de la saisie', async () => {
		const { connexion } = creerClientDemo();
		const recu: string[] = [];
		const id = '0b5f8d21-3a7c-4e96-a2b8-6c4d0e1f9a35';
		connexion.abonner(id, (m) => recu.push(m.type === 'retard' ? 'retard' : `${m.type}:${m.donnees}`));
		await new Promise((r) => setTimeout(r, 200));
		expect(recu[0]).toMatch(/^relecture:.*Refais la page contact/s);
		expect(connexion.envoyer({ type: 'entree', session: id, donnees: 'ok' })).toBe(true);
		expect(recu.slice(1)).toEqual(['sortie:o', 'sortie:k']);
	});
	it('terminal : accueil de claude en couleurs, invite encadrée à la largeur du terminal', async () => {
		vi.useFakeTimers();
		const { connexion } = creerClientDemo();
		const recu: string[] = [];
		const id = '7f3a2c4e-1b9d-4e57-a0c2-5d18e6f0a7b1';
		connexion.abonner(id, (m) => recu.push(m.type === 'retard' ? 'retard' : m.donnees));
		await vi.advanceTimersByTimeAsync(200);
		const ecran = recu[0]!;
		expect(ecran).toContain('Welcome to Claude Code');
		expect(ecran).toMatch(/\x1b\[3\dm/);
		expect(ecran).toContain(`╭${'─'.repeat(78)}╮`);
		expect(ecran).toContain('? for shortcuts');
		// Écran encore vierge : une nouvelle taille le redessine à la nouvelle largeur (relecture).
		expect(connexion.envoyer({ type: 'taille', session: id, colonnes: 120, lignes: 40 })).toBe(true);
		expect(recu[1]).toContain(`╭${'─'.repeat(118)}╮`);
	});

	it('terminal : Entrée → message, réflexion, puis réponse et nouvelle invite ; séquences d’échappement non recopiées', async () => {
		vi.useFakeTimers();
		const { connexion } = creerClientDemo();
		const recu: string[] = [];
		const id = '7f3a2c4e-1b9d-4e57-a0c2-5d18e6f0a7b1';
		connexion.abonner(id, (m) => recu.push(m.type === 'retard' ? 'retard' : m.donnees));
		await vi.advanceTimersByTimeAsync(200);
		recu.length = 0;
		connexion.envoyer({ type: 'entree', session: id, donnees: '\x1b[Ago\x1b' });
		expect(recu).toEqual(['g', 'o']);
		connexion.envoyer({ type: 'entree', session: id, donnees: '\r' });
		expect(recu[2]).toContain('> go');
		expect(recu[2]).toContain('Réflexion');
		await vi.advanceTimersByTimeAsync(2000);
		const fin = recu.join('');
		expect(fin).toContain("D'accord.");
		expect(fin.lastIndexOf('? for shortcuts')).toBeGreaterThan(fin.indexOf("D'accord."));
	});

	describe('Mémoire › Fichiers', () => {
		const STOCKS = 'projets/erp-saas/Module stocks.md';

		it('chaque fiche du graphe se lit ; Module stocks a tout ce que la vue sait montrer', async () => {
			const { api } = creerClientDemo();
			const graphe = await api.lire<DonneesGraphe>(ROUTES.graphe);
			for (const f of graphe.fiches) {
				const vue = await api.lire<FicheVue>(ROUTES.fiche, { chemin: f.chemin });
				expect(vue.titre).toBe(f.titre);
				expect(vue.proprietes.length).toBeGreaterThan(0);
			}
			const stocks = await api.lire<FicheVue>(ROUTES.fiche, { chemin: STOCKS });
			expect(stocks.corps).toMatch(/\| a confirmer/);
			expect(stocks.corps).toMatch(/~~.+~~/);
			expect(stocks.corps).toMatch(/^  > /m);
			expect(stocks.liens.sortants.some((l) => l.chemin === null)).toBe(true);
			expect(stocks.liens.sortants.some((l) => l.chemin !== null)).toBe(true);
			expect(stocks.liens.entrants.length).toBeGreaterThan(0);
			expect(stocks.sessions.length).toBeGreaterThan(0);
		});

		it('`brut` : la fiche change, son empreinte aussi, un message `memoire` est diffusé', async () => {
			const { api, connexion } = creerClientDemo();
			const memoire = vi.fn();
			connexion.surMessage((m) => void (m.type === 'memoire' && memoire()));
			const avant = await api.lire<FicheVue>(ROUTES.fiche, { chemin: STOCKS });
			const texte = avant.brut.replace('Synthèse :', 'Résumé :');
			await api.envoyer(ROUTES.brut, { chemin: STOCKS, texte, empreinte: avant.empreinte });
			const apres = await api.lire<FicheVue>(ROUTES.fiche, { chemin: STOCKS });
			expect(apres.brut).toBe(texte);
			expect(apres.empreinte).not.toBe(avant.empreinte);
			expect(memoire).toHaveBeenCalled();
		});

		it('changement extérieur (`&conflit=1`) : la fiche change sur le disque, `memoire` diffusé, l’ancienne empreinte refusée (409)', async () => {
			vi.useFakeTimers();
			const { api, connexion } = creerClientDemo({ changementExterne: STOCKS });
			const memoire = vi.fn();
			connexion.surMessage((m) => void (m.type === 'memoire' && memoire()));
			const lecture = api.lire<FicheVue>(ROUTES.fiche, { chemin: STOCKS });
			await vi.advanceTimersByTimeAsync(200);
			const avant = await lecture;
			await vi.advanceTimersByTimeAsync(5000);
			expect(memoire).toHaveBeenCalledTimes(1);
			const envoi = api.envoyer(ROUTES.brut, { chemin: STOCKS, texte: avant.brut, empreinte: avant.empreinte }).catch((x: unknown) => x);
			await vi.advanceTimersByTimeAsync(200);
			expect(((await envoi) as ErreurApi).statut).toBe(409);
		});

		it('`deplacer` : la fiche change de dossier ; une fiche de dossier emporte tout son dossier', async () => {
			const { api } = creerClientDemo();
			// comme le service : le nouveau chemin est rendu
			expect(await api.envoyer(ROUTES.deplacer, { id: STOCKS, dossier: 'archives' })).toMatchObject({ statut: 'ecrit', fiche: 'archives/Module stocks.md' });
			const graphe = await api.lire<DonneesGraphe>(ROUTES.graphe);
			expect(graphe.fiches.some((f) => f.chemin === 'archives/Module stocks.md')).toBe(true);
			expect(graphe.fiches.some((f) => f.chemin === STOCKS)).toBe(false);
			expect(await api.envoyer(ROUTES.deplacer, { id: 'projets/erp-saas/erp-saas.md', dossier: 'archives' })).toMatchObject({ statut: 'ecrit', fiche: 'archives/erp-saas/erp-saas.md' });
			const apres = await api.lire<DonneesGraphe>(ROUTES.graphe);
			expect(apres.fiches.some((f) => f.chemin.startsWith('projets/erp-saas/'))).toBe(false);
			const e = (await api.envoyer(ROUTES.deplacer, { id: 'archives/erp-saas/erp-saas.md', dossier: 'archives/erp-saas' }).catch((x: unknown) => x)) as ErreurApi;
			expect(e.statut).toBe(400);
		});
	});

	describe('Fil, tiroir de l’archiviste', () => {
		const jour = () => aujourdhui();
		const STOCKS = 'projets/erp-saas/Module stocks.md';

		it('fil du jour riche : 8 commits (sessions et archiviste), 3 faits à confirmer, 2 montées, à la forme du jalon 6', async () => {
			const { api } = creerClientDemo();
			const fil = await api.lire<FilVue>(ROUTES.fil, { jour: jour() });
			expect(fil.commits).toHaveLength(8);
			expect(fil.tronque).toBe(false);
			expect(fil.commits.filter((c) => c.session === 'a9c3e5d7-2b4f-4618-9e0a-c7b5d3f1e8a2').length).toBeGreaterThanOrEqual(3);
			expect(fil.aConfirmer).toHaveLength(3);
			expect(fil.aConfirmer[0]).toMatchObject({ genre: 'fait', statut: 'a_confirmer' });
			expect(fil.aConfirmer.find((e) => e.chemin === STOCKS)).toMatchObject({ id: `${STOCKS}#^f-0003`, source: 'session 7f3a', categorie: 'decision', date: '2026-11-21' });
			expect(fil.montees).toHaveLength(2);
			expect(fil.montees.find((m) => m.proposition?.regle)?.proposition?.regle).toEqual({ type: 'commandes_interdites', motifs: ['bin/deployer prod*'] });
		});

		it('Confirmer, Rejeter, Corriger, niveau : le fil change et `memoire` est diffusé', async () => {
			const { api, connexion } = creerClientDemo();
			const memoire = vi.fn();
			connexion.surMessage((m) => void (m.type === 'memoire' && memoire()));
			const fil = () => api.lire<FilVue>(ROUTES.fil, { jour: jour() });
			await api.envoyer(ROUTES.proposer, { genre: 'confirmer', fiche: STOCKS, ancre: 'f-0003' });
			expect((await fil()).aConfirmer.map((e) => e.chemin)).not.toContain(STOCKS);
			const archi = 'projets/agent-maison/Architecture.md';
			await api.envoyer(ROUTES.proposer, { genre: 'fait', fiche: archi, texte: 'Découpage en 3 modules.', nature: 'declare', source: { type: 'utilisateur', ref: 'utilisateur' }, remplace: 'f-0001' });
			const fiche = await api.lire<FicheVue>(ROUTES.fiche, { chemin: archi });
			expect(fiche.brut).toContain('~~Découpage en 4 modules');
			expect(fiche.brut).toContain('Découpage en 3 modules. | declare | src: utilisateur');
			const contrat = (await fil()).aConfirmer[0]!;
			await api.envoyer(ROUTES.proposer, { genre: 'rejeter', fiche: contrat.chemin, ancre: 'f-0002' });
			const apres = await fil();
			expect(apres.aConfirmer).toHaveLength(0);
			await api.envoyer(ROUTES.proposer, { genre: 'niveau', fiche: apres.montees[0]!.fiche, retirerProposition: true, source: { type: 'utilisateur', ref: 'utilisateur' } });
			expect((await fil()).montees).toHaveLength(1);
			expect(memoire).toHaveBeenCalledTimes(4);
			expect((await fil()).commits.length).toBe(12);
		});

		it('lots d’informations : doublons (dont une ligne à deux absorbées), suppression, confirmation, lot périmé ; valider (lignes choisies) ou rejeter diffuse `lots`, puis 404 ; périmé → 409, écarté', async () => {
			const { api, connexion } = creerClientDemo();
			const messages: string[] = [];
			connexion.surMessage((m) => void ((m.type === 'lots' || m.type === 'memoire') && messages.push(m.type)));
			const lire = async () => (await api.lire<ReponseLots>(ROUTES.lots)).lots;
			const lots = await lire();
			expect(lots.map((l) => [l.genre, l.lignes.length, l.perime])).toEqual([
				['fusionner', 3, false],
				['supprimer', 1, false],
				['confirmer', 1, false],
				['confirmer', 1, true],
			]);
			// une ligne de fusion qui absorbe deux informations
			expect(lots[0]!.lignes.map((l) => ('absorber' in l.ligne ? l.ligne.absorber.length : 0))).toEqual([1, 1, 2]);
			const doublons = lots[0]!;
			expect(doublons.fiche).toBe(STOCKS);
			await expect(api.envoyer(`/api/lots/${doublons.id}/valider`, { lignes: [] })).rejects.toMatchObject({ statut: 400 });
			const r = await api.envoyer<ReponseValidationLot>(`/api/lots/${doublons.id}/valider`, { lignes: [2, 0] });
			expect(r.lignes).toEqual([0, 2]);
			expect((await api.lire<FilVue>(ROUTES.fil, { jour: jour() })).commits.map((c) => c.message)).toContain(`mnemo: fusionne 2 informations ${STOCKS}`);
			await api.envoyer(`/api/lots/${lots[1]!.id}/rejeter`, {});
			expect((await lire()).map((l) => l.id)).toEqual([lots[2]!.id, lots[3]!.id]);
			await expect(api.envoyer(`/api/lots/${doublons.id}/rejeter`, {})).rejects.toMatchObject({ statut: 404 });
			// lot périmé : 409, et il est écarté
			await expect(api.envoyer(`/api/lots/${lots[3]!.id}/valider`, { lignes: [0] })).rejects.toMatchObject({ statut: 409 });
			expect((await lire()).map((l) => l.id)).toEqual([lots[2]!.id]);
			expect(messages).toEqual(['lots', 'memoire', 'lots', 'lots']);
		});

		it('dépôt : réussi, puis 409 pour le même chemin ; l’archiviste reçoit « Traite le document »', async () => {
			vi.useFakeTimers();
			const { api, connexion } = creerClientDemo();
			await vi.advanceTimersByTimeAsync(200);
			const recu: string[] = [];
			connexion.abonner('a9c3e5d7-2b4f-4618-9e0a-c7b5d3f1e8a2', (m) => recu.push(m.type === 'retard' ? '' : m.donnees));
			const premier = api.deposer('erp-saas/notes.md', new Blob(['x']));
			await vi.advanceTimersByTimeAsync(200);
			expect(await premier).toEqual({ chemin: 'erp-saas/notes.md' });
			expect(recu.join('')).toContain('Traite le document erp-saas/notes.md');
			const second = api.deposer('erp-saas/notes.md', new Blob(['x'])).catch((x: unknown) => x);
			await vi.advanceTimersByTimeAsync(200);
			expect(((await second) as ErreurApi).statut).toBe(409);
		});

		it('dépôt : « ne sera pas cherchable » décidé comme le service, sur les premiers octets (jamais le type MIME)', async () => {
			vi.useFakeTimers();
			const { api } = creerClientDemo();
			// binaire (octet nul) sans type déclaré : averti
			const binaire = api.deposer('erp-saas/compta.xlsx', new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])]));
			// texte déclaré « application/octet-stream » : lu comme du texte, sans avertissement
			const texte = api.deposer('erp-saas/notes.log', new Blob(['Réunion du lundi\n'], { type: 'application/octet-stream' }));
			await vi.advanceTimersByTimeAsync(400);
			expect(await binaire).toEqual({ chemin: 'erp-saas/compta.xlsx', avertissements: [avertissementNonCherchable('erp-saas/compta.xlsx')] });
			expect(await texte).toEqual({ chemin: 'erp-saas/notes.log' });
		});

		it('« Traiter » : l’archiviste reçoit la consigne du service (consigneATraiter de @mnemo/commun)', async () => {
			vi.useFakeTimers();
			const { api, connexion } = creerClientDemo();
			await vi.advanceTimersByTimeAsync(200);
			const recu: string[] = [];
			connexion.abonner('a9c3e5d7-2b4f-4618-9e0a-c7b5d3f1e8a2', (m) => recu.push(m.type === 'retard' ? '' : m.donnees));
			const envoi = api.envoyer<ReponseTraiter>(ROUTES.sourcesTraiter, { chemins: ['sources/claude-code/preferences.md'] });
			await vi.advanceTimersByTimeAsync(200);
			await envoi;
			await vi.advanceTimersByTimeAsync(2000);
			expect(recu.join('')).toContain(consigneATraiter(1, ['sources/claude-code/preferences.md']).slice(0, 60));
		});

		it('archiviste : une suggestion tapée revient en écho, puis sa réponse', async () => {
			vi.useFakeTimers();
			const { connexion } = creerClientDemo();
			await vi.advanceTimersByTimeAsync(200);
			const recu: string[] = [];
			connexion.abonner('a9c3e5d7-2b4f-4618-9e0a-c7b5d3f1e8a2', (m) => recu.push(m.type === 'retard' ? '' : m.donnees));
			connexion.envoyer({ type: 'entree', session: 'a9c3e5d7-2b4f-4618-9e0a-c7b5d3f1e8a2', donnees: "Qu'as-tu appris aujourd'hui ?\r" });
			await vi.advanceTimersByTimeAsync(2000);
			const tout = recu.join('');
			expect(tout).toContain("> Qu'as-tu appris aujourd'hui ?");
			expect(tout).toContain("8 changements aujourd'hui");
		});

		it('historique et documents comme le service : terminées avec leur bilan, retrait (409 pour une active) ; sources avec leur état', async () => {
			const { api } = creerClientDemo();
			const { sessions } = await api.lire<{ sessions: SessionTermineeVue[] }>(ROUTES.historique);
			expect(sessions.map((x) => [x.objectif, x.episode?.titre])).toEqual([['Ranger les composants du kit', 'Composants rangés par famille']]);
			const active = (await api.supprimer(ROUTES.session.replace(':id', '7f3a2c4e-1b9d-4e57-a0c2-5d18e6f0a7b1')).catch((x: unknown) => x)) as ErreurApi;
			expect(active.statut).toBe(409);
			expect(await api.supprimer(ROUTES.session.replace(':id', sessions[0]!.id))).toEqual({ id: sessions[0]!.id });
			expect((await api.lire<{ sessions: SessionTermineeVue[] }>(ROUTES.historique)).sessions).toEqual([]);
			const { documents } = await api.lire<{ documents: DocumentVue[] }>(ROUTES.documents);
			expect(documents[0]).toMatchObject({ chemin: 'sources/claude-code/preferences.md', document: null, aTraiter: true });
			expect(documents.find((d) => d.chemin === 'sources/cdc-stocks-v2.md')).toMatchObject({ document: 'erp-saas/docs/cdc-stocks-v2.pdf', aTraiter: false });
		});

		it('à traiter comme le service : liste complète ; « Traiter » → consigne à l’archiviste ; « Marquer traité » retire la marque, `memoire` diffusé', async () => {
			const { api, connexion } = creerClientDemo();
			const a = await api.lire<ReponseDocuments>(ROUTES.documents);
			expect(a.aTraiter.map((d) => d.chemin)).toEqual(['sources/claude-code/preferences.md', 'sources/claude-code/erp-saas-claude.md']);
			expect(await api.envoyer<ReponseTraiter>(ROUTES.sourcesTraiter, { chemins: ['sources/claude-code/preferences.md', 'sources/cdc-stocks-v2.md'] })).toEqual({ chemins: ['sources/claude-code/preferences.md'], archiviste: 'confie' });
			expect(((await api.envoyer(ROUTES.sourcesTraiter, { chemins: ['sources/cdc-stocks-v2.md'] }).catch((x: unknown) => x)) as ErreurApi).statut).toBe(409);
			// « Tout traiter » : toutes les fiches marquées, sauf celles déjà en cours
			expect(await api.envoyer<ReponseTraiter>(ROUTES.sourcesTraiterToutes, { sauf: ['sources/claude-code/preferences.md'] })).toEqual({ chemins: ['sources/claude-code/erp-saas-claude.md'], archiviste: 'confie' });
			const aucune = { sauf: ['sources/claude-code/preferences.md', 'sources/claude-code/erp-saas-claude.md'] };
			expect(((await api.envoyer(ROUTES.sourcesTraiterToutes, aucune).catch((x: unknown) => x)) as ErreurApi).statut).toBe(409);
			const messages: string[] = [];
			connexion.surMessage((m) => messages.push(m.type));
			expect(await api.envoyer(ROUTES.sourcesMarquerTraite, { chemins: ['sources/claude-code/preferences.md'] })).toEqual({ traites: ['sources/claude-code/preferences.md'] });
			expect(messages).toContain('memoire');
			const b = await api.lire<ReponseDocuments>(ROUTES.documents);
			expect(b.aTraiter.map((d) => d.chemin)).toEqual(['sources/claude-code/erp-saas-claude.md']);
			expect(b.documents.find((d) => d.chemin === 'sources/claude-code/preferences.md')).toMatchObject({ aTraiter: false });
		});

		it('recherche : `{ trouves, avis }` comme le service', async () => {
			const { api } = creerClientDemo();
			const r = await api.lire<{ trouves: unknown[]; avis: object }>(ROUTES.recherche, { q: 'stocks' });
			expect(r.trouves.length).toBeGreaterThan(0);
			expect(r.avis).toEqual({});
		});
	});
});
