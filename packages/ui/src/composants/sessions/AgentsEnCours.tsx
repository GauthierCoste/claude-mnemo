/**
 * Agents en cours (barre du haut de la vue Sessions, juste à gauche des bascules Dossier et Contexte) : un avatar miniature
 * par profil qui a au moins une session vivante (archiviste compris), pour voir d'un coup d'œil qui travaille. Seuls les
 * agents en cours sont montrés : un profil sans session ne dit rien et prendrait la place des bascules.
 *
 * Sur chaque avatar, l'état le plus urgent de ses sessions (attend une réponse > travaille > au repos), lisible sans la
 * couleur : attend, une pastille ambre cerclée d'un anneau (comme le bouton Archiviste) ; travaille, une pastille qui pulse
 * (fixe en mouvement réduit) ; au repos, une pastille creuse. Plusieurs sessions : leur nombre en exposant. Nom accessible et
 * infobulle neutres : « travail : 2 sessions, 1 travaille, 1 attend une réponse ». Un clic va à la session la plus urgente
 * (`surAgent` : choisie, zoomée si la grille l'est ; l'archiviste ouvre son tiroir).
 *
 * Ordre stable : celui des profils (Réglages › Profils), l'archiviste en dernier. Au plus `AGENTS_VISIBLES` avatars, puis
 * « +N » ; la rangée disparaît (container query de la barre) avant de pousser les bascules.
 */
import { PROFIL_ARCHIVISTE } from '@mnemo/commun';
import type { SessionVue } from '@mnemo/contrat';
import type { CSSProperties, ReactNode } from 'react';
import { useProfils } from '../../client/hooks.ts';
import { AvatarProfil, JETONS_COULEUR } from '../commun/AvatarProfil.tsx';
import { useAvatarsDeProfils } from '../commun/avatar-de-profil.ts';
import s from './AgentsEnCours.module.css';

export const AGENTS_VISIBLES = 5;

export type EtatAgent = 'attend' | 'travaille' | 'repos';

export type Agent = {
	profil: string;
	etat: EtatAgent;
	sessions: number;
	travaillent: number;
	attendent: number;
	repos: number;
	/** La session la plus urgente (attend, puis travaille, puis la plus récemment active). */
	session: string;
};

const URGENCE: Record<EtatAgent, number> = { attend: 0, travaille: 1, repos: 2 };
const etatDe = (x: Pick<SessionVue, 'etat'>): EtatAgent => (x.etat === 'attend' ? 'attend' : x.etat === 'travaille' ? 'travaille' : 'repos');

/** Un agent par profil ayant une session vivante (non terminée), dans l'ordre de `profils`, l'archiviste en dernier. */
export function agentsEnCours(sessions: readonly Pick<SessionVue, 'id' | 'profil' | 'etat' | 'majMs'>[], profils: readonly string[]): Agent[] {
	const parProfil = new Map<string, Pick<SessionVue, 'id' | 'profil' | 'etat' | 'majMs'>[]>();
	for (const x of sessions) if (x.etat !== 'terminee') parProfil.set(x.profil, [...(parProfil.get(x.profil) ?? []), x]);
	const rang = (profil: string) => (profil === PROFIL_ARCHIVISTE ? Infinity : profils.includes(profil) ? profils.indexOf(profil) : profils.length);
	return [...parProfil]
		.sort(([a], [b]) => rang(a) - rang(b) || (a < b ? -1 : a > b ? 1 : 0))
		.map(([profil, liste]) => {
			const tete = [...liste].sort((a, b) => URGENCE[etatDe(a)] - URGENCE[etatDe(b)] || b.majMs - a.majMs)[0]!;
			const compte = (e: EtatAgent) => liste.filter((x) => etatDe(x) === e).length;
			return { profil, etat: etatDe(tete), sessions: liste.length, travaillent: compte('travaille'), attendent: compte('attend'), repos: compte('repos'), session: tete.id };
		});
}

/** « travail : 2 sessions, 1 travaille, 1 attend une réponse » (registre neutre). */
export function libelleAgent(a: Agent): string {
	const parties = [
		`${a.sessions} session${a.sessions > 1 ? 's' : ''}`,
		...(a.travaillent > 0 ? [`${a.travaillent} ${a.travaillent > 1 ? 'travaillent' : 'travaille'}`] : []),
		...(a.attendent > 0 ? [`${a.attendent} ${a.attendent > 1 ? 'attendent' : 'attend'} une réponse`] : []),
		...(a.repos > 0 ? [`${a.repos} au repos`] : []),
	];
	return `${a.profil} : ${parties.join(', ')}`;
}

export function AgentsEnCours(p: { sessions: readonly SessionVue[]; surAgent(session: string, profil: string): void }): ReactNode {
	const profils = useProfils().donnees?.profils;
	const avatarDe = useAvatarsDeProfils();
	const agents = agentsEnCours(p.sessions, (profils ?? []).map((x) => x.nom));
	if (agents.length === 0) return null;
	const visibles = agents.slice(0, agents.length > AGENTS_VISIBLES ? AGENTS_VISIBLES - 1 : AGENTS_VISIBLES);
	const caches = agents.slice(visibles.length);
	return (
		<ul className={s.agents} aria-label="Agents en cours">
			{visibles.map((a) => {
				const avatar = avatarDe(a.profil);
				const libelle = libelleAgent(a);
				return (
					<li key={a.profil}>
						<button
							type="button"
							className={s.agent}
							data-etat={a.etat}
							aria-label={libelle}
							title={`${libelle}\nAller à la session ${a.etat === 'attend' ? 'qui attend' : a.etat === 'travaille' ? 'qui travaille' : 'la plus récente'}`}
							style={{ '--profil': JETONS_COULEUR[avatar.couleur] } as CSSProperties}
							onClick={() => p.surAgent(a.session, a.profil)}
						>
							<span className={s.tuile} aria-hidden="true">
								<AvatarProfil avatar={avatar} taille={16} sansFond />
							</span>
							<span className={s.pastille} aria-hidden="true" />
							{a.sessions > 1 && (
								<span className={s.nombre} aria-hidden="true">
									{a.sessions}
								</span>
							)}
						</button>
					</li>
				);
			})}
			{caches.length > 0 && (
				<li className={s.plus} title={caches.map(libelleAgent).join('\n')}>
					<span aria-hidden="true">+{caches.length}</span>
					<span className={s.masque}>{`Et ${caches.length} autres : ${caches.map(libelleAgent).join(' ; ')}`}</span>
				</li>
			)}
		</ul>
	);
}
