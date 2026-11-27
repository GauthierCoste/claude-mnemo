/** Panneau Dossier, à gauche de la vue Sessions (arbre des dossiers) : sous le dossier ouvert, ses fichiers modifiés (clic : chemin copié) et « + session ». */
import type { GitDossierVue } from '@mnemo/contrat';
import { useState, type ReactNode } from 'react';
import type { Pliage } from '../../dossiers/arbre.ts';
import { useGitDossier } from '../../client/hooks.ts';
import { ArbreDossiers } from '../commun/ArbreDossiers.tsx';
import { DePlus, useToutPour } from '../commun/DePlus.tsx';
import { cx } from '../commun/classes.ts';
import { copierTexte } from '../commun/copier.ts';
import { useToast } from '../Toast.tsx';
import { useTextes } from '../../langue/langue.tsx';
import s from './PanneauDossier.module.css';

type Props = {
	/** Largeur réglée par le séparateur (px) ; absente : celle de la feuille de style. */
	largeur?: number;
	/** Racine affichée (`~` abrégé). */
	racine: string;
	/** Racine absolue : « Chemin copié » copie un chemin absolu. */
	racineAbsolue: string;
	/** Dossier de la session choisie : ouvert au départ. */
	dossierChoisi: string | null;
	/** Tenu par la vue Sessions : gardé quand le panneau est masqué. */
	pliage: Pliage;
	surPliage(pliage: Pliage): void;
	surChoisirDossier(dossier: string): void;
	surNouvelle(dossier: string): void;
};

export function PanneauDossier(p: Props): ReactNode {
	const toast = useToast();
	const textes = useTextes();
	const t = textes.sessions.panneauDossier;
	// undefined : rien n'a encore été cliqué, le dossier de la session choisie est ouvert
	const [ouvert, setOuvert] = useState<string | null | undefined>(undefined);
	const choisi = ouvert === undefined ? p.dossierChoisi : ouvert;

	const choisir = (chemin: string) => {
		setOuvert(choisi === chemin ? null : chemin);
		p.surChoisirDossier(chemin);
	};

	const details = (chemin: string, git: GitDossierVue | undefined, retrait: number): ReactNode => (
		<>
			{git && <FichiersGit chemin={chemin} git={git} retrait={retrait} copier={(f) => copierTexte([p.racineAbsolue, chemin, f].filter(Boolean).join('/'), toast, t.cheminCopie, textes.coquille.partage.copieImpossible)} />}
			<div className={s.actions} style={{ paddingLeft: 18 + retrait }}>
				<button type="button" className={s.ib} onClick={() => p.surNouvelle(chemin)}>
					{t.nouvelle}
				</button>
			</div>
		</>
	);

	return (
		<aside className={s.panneau} aria-label={t.region} style={p.largeur === undefined ? undefined : { width: p.largeur }}>
			<ArbreDossiers presentation="panneau" entete={<span className={s.lbl}>{p.racine}</span>} choisi={choisi} surChoisir={choisir} pliage={p.pliage} surPliage={p.surPliage} details={details} />
		</aside>
	);
}

/** Fichiers modifiés d'un dossier : `FICHIERS_GIT_MAX`, puis `DePlus` ; « Tout voir » lit la liste entière. */
function FichiersGit(p: { chemin: string; git: NonNullable<GitDossierVue>; retrait: number; copier(fichier: string): void }): ReactNode {
	const { tout, toutVoir } = useToutPour(p.chemin);
	const entiere = useGitDossier(tout ? p.chemin : null, true).donnees;
	const t = useTextes().sessions.panneauDossier;
	const fichiers = (tout ? entiere?.fichiers : undefined) ?? p.git.fichiers;
	return (
		<>
			{fichiers.map((f) => (
				<button key={f.chemin} type="button" className={s.fichier} style={{ paddingLeft: 22 + p.retrait }} title={t.copierChemin(f.chemin)} onClick={() => p.copier(f.chemin)}>
					<span className={cx(s.statut, s[f.statut])}>{f.statut}</span>
					<span className={s.nom}>{f.chemin}</span>
				</button>
			))}
			<div style={{ paddingLeft: 22 + p.retrait }}>
				<DePlus nombre={p.git.modifies - fichiers.length} surToutVoir={toutVoir} />
			</div>
		</>
	);
}
