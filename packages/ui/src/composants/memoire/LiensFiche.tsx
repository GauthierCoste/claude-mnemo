/**
 * Colonne de droite de Mémoire › Fichiers : liens entrants, liens sortants (cible absente en
 * gris, un clic le dit), sessions qui ont utilisé la fiche (un clic ouvre la session dans Sessions ; « N de plus » et « Tout
 * voir » quand la liste est coupée).
 */
import type { CSSProperties, ReactNode } from 'react';
import type { FicheVue } from '@mnemo/contrat';
import { DePlus } from '../commun/DePlus.tsx';
import { useToast } from '../Toast.tsx';
import { useTextes } from '../../langue/langue.tsx';
import s from './LiensFiche.module.css';

type Ligne = { cle: string; libelle: string; chemin: string | null; titre?: string };

function Ligne(p: { couleur: string; titre?: string; surClic(): void; children: ReactNode }): ReactNode {
	return (
		<button type="button" className={s.ml} style={{ '--c': p.couleur } as CSSProperties} title={p.titre} onClick={p.surClic}>
			<i aria-hidden="true" />
			<bdi>{p.children}</bdi>
		</button>
	);
}

/** Une ligne par fiche (deux liens vers la même fiche n'en font qu'une). */
function sansDoublon(lignes: Ligne[]): Ligne[] {
	const vues = new Set<string>();
	return lignes.filter((l) => !vues.has(l.cle) && vues.add(l.cle));
}

export function LiensFiche(p: {
	fiche: FicheVue | undefined;
	/** Sessions à montrer : celles de la fiche, ou toutes après « Tout voir » (`surToutVoir`) ; `fiche.sessionsTotal` les compte. */
	sessions: FicheVue['sessions'];
	surToutVoir(): void;
	couleur(chemin: string): string;
	/** Titre d'une fiche du graphe (son nom de fichier si elle n'y est pas encore). */
	titre(chemin: string): string;
	ouvrir(chemin: string): void;
	ouvrirSession(id: string): void;
}): ReactNode {
	const t = useTextes().memoire.liens;
	const toast = useToast();
	const f = p.fiche;
	const entrants = sansDoublon((f?.liens.entrants ?? []).map((l) => ({ cle: l.chemin, libelle: l.titre, chemin: l.chemin })));
	const sortants = sansDoublon(
		(f?.liens.sortants ?? []).map((l) => {
			const cible = l.ecrit.split('|')[0]!.trim();
			return { cle: l.chemin ?? `?${cible}`, libelle: l.chemin ? p.titre(l.chemin) : cible, chemin: l.chemin };
		}),
	);
	const sessions = p.sessions;

	const lignes = (liste: Ligne[]) =>
		liste.length === 0 ? (
			<p className={s.vide}>{t.aucun}</p>
		) : (
			liste.map((l) => {
				const chemin = l.chemin;
				return (
					<Ligne
						key={l.cle}
						couleur={chemin ? p.couleur(chemin) : 'var(--dim)'}
						titre={chemin ?? undefined}
						surClic={() => (chemin ? p.ouvrir(chemin) : toast(t.ficheAbsente(l.libelle)))}
					>
						{l.libelle}
					</Ligne>
				);
			})
		);

	return (
		<aside className={s.liens} aria-label={t.titre}>
			{f && (
				<>
					<span className={s.lbl}>{t.entrants(entrants.length)}</span>
					{lignes(entrants)}
					<div className={s.sec}>
						<span className={s.lbl}>{t.sortants(sortants.length)}</span>
						{lignes(sortants)}
					</div>
					<div className={s.sec}>
						<span className={s.lbl}>{t.sessions(f.sessionsTotal)}</span>
						{sessions.length === 0 ? (
							<p className={s.vide}>{t.aucune}</p>
						) : (
							sessions.map((x) => (
								<Ligne key={x.id} couleur="var(--blue)" titre={x.id} surClic={() => p.ouvrirSession(x.id)}>
									{x.objectif ?? t.session(x.id.slice(0, 8))}
								</Ligne>
							))
						)}
						<DePlus nombre={f.sessionsTotal - sessions.length} surToutVoir={p.surToutVoir} />
					</div>
				</>
			)}
		</aside>
	);
}
