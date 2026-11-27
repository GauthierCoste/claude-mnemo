import { PROFIL_ARCHIVISTE } from '@mnemo/commun';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { raccourciAlt, toucheCommande } from '../raccourcis.ts';
import { useTextes } from '../langue/langue.tsx';
import { Quotas } from './Quotas.tsx';
import { AvatarProfil, JETONS_COULEUR } from './commun/AvatarProfil.tsx';
import { useAvatarsDeProfils } from './commun/avatar-de-profil.ts';
import { LogoMnemo } from './commun/LogoMnemo.tsx';
import { BoutonModeles } from './modeles/BoutonModeles.tsx';
import s from './BarreTitre.module.css';

/**
 * Barre de titre (`.title`) : logo de Mnemo (à la couleur principale), champ de la palette (aligné à gauche, après le logo ; la
 * palette s'y pose, `champPalette`) ; le dossier Mnemo est dans la barre d'état, en bas, pas ici (décision de Gauthier) ; à droite, les quotas des abonnements (Claude, ChatGPT), le bouton des modèles locaux, puis celui de l'archiviste.
 */
export function BarreTitre(p: {
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
	const avatar = useAvatarsDeProfils()(PROFIL_ARCHIVISTE);
	const t = useTextes().coquille.barreTitre;
	return (
		<header className={s.titre}>
			{/* en ligne, à la couleur principale (réglage `interface.accent`) */}
			<LogoMnemo className={s.marque} taille={28} />
			{p.fictif && <span className={s.fictif}>{t.fictif}</span>}
			<button ref={p.champPalette} type="button" className={s.commande} onClick={p.surPalette} aria-keyshortcuts={[...new Set(['Meta', toucheCommande().aria])].map((touche) => `${touche}+K`).join(' ')}>
				<span>{t.chercher}</span>
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
					aria-label={p.archivisteAttend ? t.archivisteAttendNom : undefined}
					title={p.archivisteAttend ? t.archivisteAttendBulle : undefined}
				>
					{/* l'avatar de l'archiviste (Réglages › Agents) et, en coin, son pouls ; ambre cerclé quand il attend une réponse */}
					<span className={s.avatarArchiviste} style={{ '--profil': JETONS_COULEUR[avatar.couleur] } as CSSProperties} aria-hidden="true">
						<AvatarProfil avatar={avatar} taille={16} sansFond />
						<span className={s.pouls} data-attend={p.archivisteAttend ? 'true' : undefined} />
					</span>
					{t.archiviste}
					<kbd>{raccourciAlt('A')}</kbd>
				</button>
			</div>
		</header>
	);
}
