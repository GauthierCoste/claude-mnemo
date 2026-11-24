/**
 * Carte d'une session dans la grille : barre compacte (point d'état, ⌥n, objectif, durée,
 * ⤢, × « Fermer la session »), la même pour la carte agrandie, puis le terminal ; sans terminal dans le service, un encart avec « Reprendre ici ». Clic → session choisie ;
 * double-clic sur la barre → zoom.
 */
import type { SessionVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { Terminal } from '../../terminal/Terminal.tsx';
import { Bouton } from '../commun/Bouton.tsx';
import { cx } from '../commun/classes.ts';
import s from './CarteSession.module.css';
import { FermerSession } from './FermerSession.tsx';
import { JaugeContexte } from './JaugeContexte.tsx';
import { AvatarSession } from './AvatarSession.tsx';

export type PropsCarte = {
	session: SessionVue;
	/** Rang dans l'ordre affiché (1 = première) : ⌥n jusqu'à 9. */
	rang: number;
	duree: string;
	choisie: boolean;
	zoomee: boolean;
	/** Le service peut ouvrir des terminaux : « Reprendre ici » est proposé. */
	terminauxDisponibles: boolean;
	surChoisir(id: string): void;
	surZoom(id: string): void;
	surReprendre(id: string): void;
};

export function CarteSession(p: PropsCarte): ReactNode {
	const { session } = p;
	const choisir = () => p.surChoisir(session.id);
	return (
		<div className={cx(s.carte, p.choisie && s.foc)} data-session={session.id} onMouseDown={choisir}>
			<div className={s.barre} onDoubleClick={() => p.surZoom(session.id)}>
				<AvatarSession session={session} taille="barre" />
				{p.rang <= 9 && <kbd>⌥{p.rang}</kbd>}
				<span className={s.objectif}>{session.objectif ?? 'Sans objectif'}</span>
				<span>{p.duree}</span>
				<button
					type="button"
					className={s.agrandir}
					title="Agrandir ou réduire"
					aria-label="Agrandir ou réduire"
					aria-keyshortcuts={p.rang <= 9 ? `Alt+${p.rang}` : undefined}
					onClick={(e) => {
						e.stopPropagation();
						p.surZoom(session.id);
					}}
					onDoubleClick={(e) => e.stopPropagation()}
				>
					⤢
				</button>
				<FermerSession session={session} />
				<JaugeContexte session={session.id} />
			</div>
			{session.terminal ? (
				<Terminal session={session.id} actif={p.choisie} compact={!p.zoomee} surFocus={choisir} />
			) : (
				<div className={s.sansTerminal}>
					<p>Session suivie sans terminal dans Mnemo</p>
					{p.terminauxDisponibles && (
						<Bouton petit onClick={() => p.surReprendre(session.id)}>
							Reprendre ici
						</Bouton>
					)}
				</div>
			)}
		</div>
	);
}
