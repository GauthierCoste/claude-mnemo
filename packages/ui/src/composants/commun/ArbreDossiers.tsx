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
import { ChevronArbre, GuidesArbre, IconeDossier, margeArbre, RETRAIT_ARBRE } from './ElementsArbre.tsx';

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

/**
 * Traits de guide d'une ligne de profondeur `profondeur` : un par dossier qui la contient (la racine, puis chaque
 * ascendant) ; vrai pour ceux qui contiennent aussi le dossier `choisi`.
 */
function niveauxDe(chemin: string, profondeur: number, choisi: string | null): boolean[] {
	const morceaux = chemin === '' ? [] : chemin.split('/');
	return Array.from({ length: profondeur }, (_, k) => {
		if (choisi === null) return false;
		const ascendant = morceaux.slice(0, k).join('/');
		return ascendant === '' || choisi === ascendant || choisi.startsWith(`${ascendant}/`);
	});
}

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
					niveaux={niveauxDe(l.chemin, l.profondeur, p.choisi)}
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
	/** Traits de guide de la ligne (`niveauxDe`). */
	niveaux: readonly boolean[];
	surChoisir(chemin: string): void;
	surBasculer(deplie: boolean): void;
	details: Props['details'];
}): ReactNode {
	const { ligne: l } = p;
	const git = useGitDossier(l.dossier?.git === true && (p.choisi || p.sessions.length > 0) ? l.chemin : null);
	const puce = texteGit(git.donnees);
	const marge = margeArbre(l.profondeur);
	// le contenu du dossier choisi (fichiers modifiés, actions) est au niveau de ses enfants
	const retrait = (l.profondeur + 1) * RETRAIT_ARBRE;
	const ouvert = l.deplie === true || p.choisi;
	const erreur = l.dossier?.erreur ?? l.erreurNiveau;
	return (
		<>
			<div className={s.ligne} style={{ paddingLeft: marge }} data-dossier={l.chemin}>
				<GuidesArbre niveaux={p.niveaux} debut={0} />
				{l.deplie !== null && (
					<button
						type="button"
						className={s.replier}
						style={{ left: marge - 22 }}
						aria-label={`${l.deplie ? 'Replier' : 'Déplier'} ${l.chemin || l.nom}`}
						aria-expanded={l.deplie}
						onClick={() => p.surBasculer(l.deplie === true)}
					>
						<ChevronArbre ouvert={l.deplie} />
					</button>
				)}
				<button type="button" className={cx(s.dossier, p.choisi && s.on)} title={l.chemin || undefined} aria-pressed={p.choisi} onClick={() => p.surChoisir(l.chemin)}>
					<IconeDossier ouvert={ouvert} />
					<b className={cx(!ouvert && s.ferme)}>{l.nom}</b>
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
				<p className={s.erreur} style={{ paddingLeft: marge + 4 }}>
					{erreur}
				</p>
			)}
			{p.choisi && (
				<div className={s.details}>
					<GuidesArbre niveaux={[...p.niveaux, true]} debut={0} />
					{p.details(l.chemin, git.donnees, retrait)}
				</div>
			)}
		</>
	);
}
