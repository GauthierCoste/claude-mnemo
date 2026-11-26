/**
 * Le terminal de l'archiviste, ou ce qui le remplace : « Lancer l'archiviste » (aucun ne tourne ; mode dégradé : la commande
 * à coller), « Reprendre » (en pause, ou arrêté), ou un mot s'il tourne sans terminal dans Mnemo. Partagé par le tiroir
 * (⌥A) et la page Mémoire › Archiviste, et les suggestions qui s'écrivent dans ce terminal.
 *
 * Un seul affichage à la fois : le terminal (un xterm abonné au flux de la session) n'est monté que dans la page quand
 * elle est affichée tiroir fermé, sinon dans le tiroir (`terminalDansLaPage`). Deux xterm sur le même flux auraient chacun
 * leur taille, et le PTY n'en a qu'une : on n'en garde jamais deux. Passer de l'un à l'autre remonte un xterm, qui repart
 * de la relecture du tampon (remise à zéro d'abord : écran jamais doublé).
 */
import { ROUTES, type ReponseLancement, type SessionVue } from '@mnemo/contrat';
import { useState, type ReactNode } from 'react';
import { PROFIL_ARCHIVISTE } from '@mnemo/commun';
import { ErreurApi } from '../../client/api.ts';
import { useClient } from '../../client/contexte.tsx';
import { avecId } from '../../client/hooks.ts';
import type { Navigation } from '../../navigation.tsx';
import { Terminal } from '../../terminal/Terminal.tsx';
import { Bouton } from '../commun/Bouton.tsx';
import { copierTexte } from '../commun/copier.ts';
import { useToast } from '../Toast.tsx';
import s from './CentreArchiviste.module.css';

export const SUGGESTIONS = ['Range les documents déposés', "Qu'as-tu appris aujourd'hui ?", 'Y a-t-il des contradictions à trancher ?'] as const;

/** Session archiviste vivante (non terminée), la plus récemment active. */
export function archivisteVivant(sessions: readonly SessionVue[]): SessionVue | null {
	const vivants = sessions.filter((x) => x.profil === PROFIL_ARCHIVISTE && x.etat !== 'terminee');
	return vivants.sort((a, b) => b.majMs - a.majMs)[0] ?? null;
}

/** Vrai quand la page Mémoire › Archiviste est affichée, tiroir fermé : le terminal est dans la page, pas dans le tiroir. */
export function terminalDansLaPage(nav: Pick<Navigation, 'vue' | 'ongletMemoire' | 'tiroirOuvert'>): boolean {
	return nav.vue === 'memoire' && nav.ongletMemoire === 'archiviste' && !nav.tiroirOuvert;
}

export function CentreArchiviste(p: {
	archiviste: SessionVue | null;
	/** Faux : le terminal n'est pas monté ici (affiché ailleurs, ou pas encore vu) ; `ailleurs` le remplace. */
	monter: boolean;
	actif: boolean;
	compact: boolean;
	ailleurs?: ReactNode;
	/** Avant la requête de lancement (le message `session` peut arriver avant la réponse), puis `false` en cas d'échec. */
	surLancement?(enCours: boolean): void;
}): ReactNode {
	const { api } = useClient();
	const toast = useToast();
	const [lancement, setLancement] = useState(false);
	const [manuel, setManuel] = useState<string | null>(null);
	const a = p.archiviste;

	async function lancer(): Promise<void> {
		setLancement(true);
		p.surLancement?.(true);
		try {
			const r = await api.envoyer<ReponseLancement>(ROUTES.sessions, { profil: PROFIL_ARCHIVISTE, dossier: '' });
			// refus : 400 `{ erreur }`, rendu par `ErreurApi`
			if (r.manuel !== undefined) {
				setManuel(r.manuel);
				p.surLancement?.(false);
			}
		} catch (e) {
			p.surLancement?.(false);
			toast(e instanceof ErreurApi ? e.message : "Lancement de l'archiviste impossible.");
		} finally {
			setLancement(false);
		}
	}

	async function reprendre(id: string): Promise<void> {
		try {
			await api.envoyer(avecId(ROUTES.reprise, id), undefined);
		} catch (e) {
			toast(e instanceof ErreurApi ? e.message : 'Reprise impossible.');
		}
	}

	if (a?.terminal) {
		// Agrandi ou réduit, au même endroit : le même élément, jamais recréé (même abonnement, même historique). Passé de la
		// page au tiroir ou l'inverse, il est démonté ici et remonté là-bas : un nouvel xterm, qui relit le tampon du service.
		return (
			<div className={s.terminal} data-zone="terminal">
				{p.monter ? <Terminal session={a.id} actif={p.actif} compact={p.compact} surFocus={() => {}} /> : p.ailleurs}
			</div>
		);
	}
	if (a?.etat === 'en_pause' || a?.etat === 'a_relire') {
		return (
			<div className={s.absent}>
				<p>{a.etat === 'en_pause' ? "L'archiviste est en pause." : "L'archiviste s'est arrêté."}</p>
				<Bouton genre="primaire" data-focus-initial onClick={() => void reprendre(a.id)}>
					Reprendre
				</Bouton>
			</div>
		);
	}
	if (a) {
		return (
			<div className={s.absent}>
				<p>L'archiviste tourne sans terminal dans Mnemo.</p>
			</div>
		);
	}
	return (
		<div className={s.absent}>
			<p>Aucun archiviste ne tourne.</p>
			<Bouton genre="primaire" data-focus-initial onClick={() => void lancer()} disabled={lancement}>
				Lancer l'archiviste
			</Bouton>
			{manuel !== null && (
				<div className={s.manuel}>
					<span>Terminaux indisponibles : à lancer à la main.</span>
					<code>{manuel}</code>
					<Bouton petit onClick={() => copierTexte(manuel, toast, 'Commande copiée')}>
						Copier
					</Bouton>
				</div>
			)}
		</div>
	);
}

/** Suggestions (`.asug`) : chaque texte s'écrit dans le terminal de l'archiviste, suivi d'Entrée. */
export function Suggestions(p: { archiviste: SessionVue | null; surEnvoi?(): void }): ReactNode {
	const { connexion } = useClient();
	const toast = useToast();
	const a = p.archiviste;
	function suggerer(texte: string): void {
		if (!a?.terminal) return;
		if (!connexion.envoyer({ type: 'entree', session: a.id, donnees: `${texte}\r` })) {
			toast('Service injoignable : suggestion non envoyée.');
			return;
		}
		p.surEnvoi?.();
	}
	return (
		<div className={s.suggestions}>
			{SUGGESTIONS.map((t) => (
				<Bouton key={t} className={s.suggestion} onClick={() => suggerer(t)} disabled={!a?.terminal}>
					{t}
				</Bouton>
			))}
		</div>
	);
}
