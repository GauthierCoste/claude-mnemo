import type { ReactNode, RefObject } from 'react';
import { toucheCommande } from '../raccourcis.ts';
import { Quotas } from './Quotas.tsx';
import { BoutonModeles } from './modeles/BoutonModeles.tsx';
import s from './BarreTitre.module.css';

/**
 * Barre de titre (`.title`) : logo de Mnemo, racine du dossier Mnemo, champ de la palette (aligné à gauche, après la racine ; la
 * palette s'y pose, `champPalette`) ; à droite, les quotas des abonnements (Claude, ChatGPT), le bouton des modèles locaux, puis celui de l'archiviste.
 */
export function BarreTitre(p: {
	racine: string | null;
	fictif: boolean;
	tiroirOuvert: boolean;
	/**
	 * Un dialogue de l'archiviste attend l'utilisateur (`SessionVue.dialogueOuvert`) : son pouls passe en couleur
	 * d'avertissement, sans texte visible (décision de Gauthier) ; le nom accessible du bouton le dit.
	 */
	archivisteAttend: boolean;
	champPalette?: RefObject<HTMLButtonElement | null>;
	surPalette(): void;
	surArchiviste(): void;
}): ReactNode {
	return (
		<header className={s.titre}>
			{/* chemin relatif à la base de l'application (`public/icone.svg`, comme le manifeste) */}
			<img className={s.marque} src={`${import.meta.env.BASE_URL}icone.svg`} alt="Mnemo" width={28} height={28} />
			{p.racine !== null && <span className={s.racine}>{p.racine}</span>}
			{p.fictif && <span className={s.fictif}>données fictives</span>}
			<button ref={p.champPalette} type="button" className={s.commande} onClick={p.surPalette} aria-keyshortcuts={[...new Set(['Meta', toucheCommande().aria])].map((touche) => `${touche}+K`).join(' ')}>
				<span>Chercher une session, un fichier, une fiche...</span>
				<kbd>{`${toucheCommande().libelle}K`}</kbd>
			</button>
			<div className={s.droite}>
				<Quotas />
				<BoutonModeles />
				<button
					type="button"
					className={s.archiviste}
					onClick={p.surArchiviste}
					aria-keyshortcuts="Alt+A"
					aria-expanded={p.tiroirOuvert}
					aria-label={p.archivisteAttend ? 'Archiviste, attend ta réponse' : undefined}
					title={p.archivisteAttend ? 'L’archiviste attend ta réponse' : undefined}
				>
					<span className={s.pouls} data-attend={p.archivisteAttend ? 'true' : undefined} aria-hidden="true" />
					Archiviste
					<kbd>⌥A</kbd>
				</button>
			</div>
		</header>
	);
}
