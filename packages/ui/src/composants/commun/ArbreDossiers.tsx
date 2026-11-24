/** Arbre des dossiers de la racine, le même pour le panneau Dossier, la Nouvelle session et la zone de dépôt. */
import type { GitDossierVue, SessionVue } from '@mnemo/contrat';
import { useEffect, type ReactNode } from 'react';
import { useGitDossier, useNiveauxDossiers, useNomRacine, useSessions } from '../../client/hooks.ts';
import { basculer, lignesArbre, toutDeplier, toutReplier, type LigneArbre, type Pliage } from '../../dossiers/arbre.ts';
import { pliageArbre } from '../../raccourcis.ts';
import { sessionsVisibles } from '../../sessions/groupes.ts';
import { Point } from '../sessions/Point.tsx';
import s from './ArbreDossiers.module.css';
import { BoutonsArbre } from './BoutonsArbre.tsx';
import { cx } from './classes.ts';

/**
 * Puce git : « branche | n modif. » ou « branche | à jour », sans branche si la tête est détachée ; rien pendant le
 * chargement ni hors dépôt. Aucune branche n'est supposée par défaut : toutes sont nommées.
 */
export function texteGit(git: GitDossierVue | undefined): string | null {
	if (git === undefined || git === null) return null;
	const etat = git.modifies === 0 ? 'à jour' : `${git.modifies} modif.`;
	return git.branche === null ? etat : `${git.branche} | ${etat}`;
}

/** `panneau` : l'arbre remplit le panneau Dossier ; `cadre` : une boîte qui défile (dialogue, zone de dépôt). */
export const PRESENTATIONS_ARBRE = ['panneau', 'cadre'] as const;
export type PresentationArbre = (typeof PRESENTATIONS_ARBRE)[number];
const PRESENTATION: Record<PresentationArbre, string | undefined> = { panneau: undefined, cadre: s.cadre };

type Props = {
	presentation: PresentationArbre;
	/** En tête de l'arbre, avant « Tout replier » et « Tout déplier ». */
	entete: ReactNode;
	/** Dossier mis en avant ; son chemin se déplie de lui-même et `details` s'affiche sous lui. */
	choisi: string | null;
	surChoisir(chemin: string): void;
	pliage: Pliage;
	surPliage(pliage: Pliage): void;
	details(chemin: string, git: GitDossierVue | undefined, retrait: number): ReactNode;
};

/** Retrait de l'arbre : 14 px par niveau. */
const RETRAIT = 14;

export function ArbreDossiers(p: Props): ReactNode {
	const nomRacine = useNomRacine();
	const sessions = sessionsVisibles(useSessions());
	const { niveaux, suivre } = useNiveauxDossiers();
	const ouverts = [...sessions.map((x) => x.dossier), ...(p.choisi === null ? [] : [p.choisi])];
	const { lignes, niveauxVisibles } = lignesArbre({ niveaux, nomRacine, pliage: p.pliage, ouverts });
	// la racine a pour chemin « » : une jointure la confondrait avec une liste vide
	const visibles = JSON.stringify(niveauxVisibles);
	useEffect(() => suivre(JSON.parse(visibles) as string[]), [suivre, visibles]);

	return (
		<div
			className={cx(s.arbre, PRESENTATION[p.presentation])}
			onKeyDown={(e) => {
				const pliage = pliageArbre(e);
				if (pliage === null) return;
				e.preventDefault();
				p.surPliage(pliage === 'replier' ? toutReplier(niveaux) : toutDeplier(niveaux));
			}}
		>
			<div className={s.entete}>
				{p.entete}
				<BoutonsArbre surReplier={() => p.surPliage(toutReplier(niveaux))} surDeplier={() => p.surPliage(toutDeplier(niveaux))} />
			</div>
			{lignes.map((l) => (
				<LigneDossier
					key={l.chemin}
					ligne={l}
					sessions={sessions.filter((x) => x.dossier === l.chemin)}
					choisi={p.choisi === l.chemin}
					surChoisir={p.surChoisir}
					surBasculer={(deplie) => p.surPliage(basculer(p.pliage, l.chemin, deplie))}
					details={p.details}
				/>
			))}
		</div>
	);
}

function LigneDossier(p: {
	ligne: LigneArbre;
	sessions: readonly SessionVue[];
	choisi: boolean;
	surChoisir(chemin: string): void;
	surBasculer(deplie: boolean): void;
	details: Props['details'];
}): ReactNode {
	const { ligne: l } = p;
	const git = useGitDossier(l.dossier?.git === true && (p.choisi || p.sessions.length > 0) ? l.chemin : null);
	const puce = texteGit(git.donnees);
	const retrait = l.profondeur * RETRAIT;
	const erreur = l.dossier?.erreur ?? l.erreurNiveau;
	return (
		<>
			<div className={s.ligne} style={{ paddingLeft: retrait }} data-dossier={l.chemin}>
				{l.deplie === null ? (
					<span className={s.replier} aria-hidden="true" />
				) : (
					<button
						type="button"
						className={s.replier}
						aria-label={`${l.deplie ? 'Replier' : 'Déplier'} ${l.chemin || l.nom}`}
						aria-expanded={l.deplie}
						onClick={() => p.surBasculer(l.deplie === true)}
					>
						{l.deplie ? '▾' : '▸'}
					</button>
				)}
				<button type="button" className={cx(s.dossier, p.choisi && s.on)} title={l.chemin || undefined} aria-pressed={p.choisi} onClick={() => p.surChoisir(l.chemin)}>
					<b>{l.nom}</b>
					{l.dossier?.marque === true && (
						<span className={s.marque} title="Projet" aria-hidden="true">
							◆
						</span>
					)}
					<span className={s.points}>
						{p.sessions.map((x) => (
							<Point key={x.id} etat={x.etat} petit />
						))}
					</span>
					<span className={s.espace} />
					{puce && (
						<span className={s.git} title={git.donnees ? `branche ${git.donnees.branche ?? '(détachée)'}, ${git.donnees.modifies} fichiers modifiés` : undefined}>
							{puce}
						</span>
					)}
				</button>
			</div>
			{erreur !== null && (
				<p className={s.erreur} style={{ paddingLeft: retrait + 22 }}>
					{erreur}
				</p>
			)}
			{p.choisi && p.details(l.chemin, git.donnees, retrait)}
		</>
	);
}
