import { useState, type ReactNode } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useClient } from '../../client/contexte.tsx';
import { ROUTES, type FilVue, type LotVue, type ResultatEcriture } from '@mnemo/contrat';
import { demandePour, type Choix, type Proposition } from '../../archiviste/propositions.ts';
import { titreFiche } from '../../sessions/servis.ts';
import { Bouton } from '../commun/Bouton.tsx';
import { cx } from '../commun/classes.ts';
import { Puce } from '../commun/Puce.tsx';
import { useToast } from '../Toast.tsx';
import { useAnnonceEcriture } from '../commun/annonce-ecriture.ts';
import { LotAValider } from './LotAValider.tsx';
import s from './Propositions.module.css';
import { avertissementsDe } from '@mnemo/commun';

/** Résultat de `proposer` (application/commun.ts, jalon 6) ; `refuse` arrive en 400. */

const FAIT: Record<string, string> = { confirmer: 'Confirmé', rejeter: 'Rejeté', corriger: 'Modifié' };
const NIVEAU: Record<string, string> = { confirmer: 'Niveau appliqué', rejeter: 'Proposition rejetée' };
const MODIFICATION: Record<string, string> = { confirmer: 'Modification appliquée', rejeter: 'Modification rejetée' };
const TOASTS: Record<Proposition['genre'], Record<string, string>> = { a_confirmer: FAIT, montee: NIVEAU, modification: MODIFICATION };
const CLASSES: Record<Proposition['genre'], string | undefined> = { a_confirmer: s.aConfirmer, montee: s.niveau, modification: s.modification };
const ETIQUETTES: Record<Proposition['genre'], string> = { a_confirmer: 'À confirmer', montee: 'Niveau', modification: 'Modification' };

/**
 * Groupe « À arbitrer » de Mémoire › Archiviste : Confirmer, Modifier (un fait : le texte corrigé
 * le remplace), Rejeter. Une proposition tranchée reste grisée jusqu'à la relecture du fil qui suit l'écriture (message
 * `memoire`) : c'est le service qui la fait disparaître. Puis les lots d'informations proposés par l'archiviste
 * (`LotAValider`). Sans proposition ni lot, rien n'est rendu (groupe masqué).
 */
export function Propositions(p: { propositions: readonly Proposition[]; lots: readonly LotVue[]; rechargerLots(): void; fil: FilVue | undefined }): ReactNode {
	const { api } = useClient();
	const toast = useToast();
	const annoncer = useAnnonceEcriture();
	const [enCours, setEnCours] = useState<ReadonlySet<string>>(() => new Set());
	/** Propositions tranchées, avec le fil affiché au moment du choix : grisées tant que ce fil est celui affiché. */
	const [tranchees, setTranchees] = useState<ReadonlyMap<string, FilVue | undefined>>(() => new Map());
	const [correction, setCorrection] = useState<{ cle: string; texte: string } | null>(null);

	const occupee = (cle: string) => enCours.has(cle) || (tranchees.has(cle) && tranchees.get(cle) === p.fil);

	async function trancher(prop: Proposition, choix: Choix): Promise<void> {
		let corps: unknown;
		try {
			corps = demandePour(prop, choix);
		} catch (e) {
			toast(e instanceof Error ? e.message : String(e));
			return;
		}
		const filAuChoix = p.fil;
		setEnCours((x) => new Set(x).add(prop.cle));
		try {
			const r = await api.envoyer<ResultatEcriture | null>(ROUTES.proposer, corps);
			const statut = r?.statut ?? 'ecrit';
			// Une correction à fort enjeu (montant, échéance, périmètre) revient « à confirmer » : l'utilisateur en est l'auteur,
			// il la confirme donc aussitôt.
			const confirmation =
				typeof choix === 'object' && r?.statut === 'ecrit' && r.aConfirmer && r.ancre ? await api.envoyer<ResultatEcriture | null>(ROUTES.proposer, { genre: 'confirmer', fiche: r.fiche, ancre: r.ancre }) : null;
			if (statut === 'ecrit' || statut === 'repetition') {
				setTranchees((x) => new Map(x).set(prop.cle, filAuChoix));
				if (typeof choix === 'object') setCorrection(null);
				const nom = typeof choix === 'object' ? 'corriger' : choix;
				annoncer(TOASTS[prop.genre][nom] ?? 'Écrit', ...[r, confirmation].flatMap((x) => (x === null ? [] : [avertissementsDe(x)])));
			} else if (statut === 'doublon') toast('Déjà en mémoire sous cette forme');
			else if (statut === 'proches') toast('Des éléments très proches existent déjà : rien n’a été écrit.');
			else toast(`Réponse inattendue du service : ${statut}`);
		} catch (e) {
			toast(e instanceof ErreurApi || e instanceof Error ? e.message : 'Écriture impossible.');
		} finally {
			setEnCours((x) => {
				const suivant = new Set(x);
				suivant.delete(prop.cle);
				return suivant;
			});
		}
	}

	if (p.propositions.length === 0 && p.lots.length === 0) return null;
	return (
		<section className={s.panneau} aria-label="À arbitrer">
			<div className={s.entete}>
				<span className={s.lbl}>À arbitrer</span>
				<Puce ton="avertissement">{p.propositions.length + p.lots.length}</Puce>
			</div>
			{p.propositions.map((prop) => {
				const occupe = occupee(prop.cle);
				const corrige = correction?.cle === prop.cle ? correction : null;
				return (
					<article key={prop.cle} className={cx(s.proposition, occupe && s.off)} aria-busy={occupe} aria-label={prop.texte}>
						<span className={cx(s.genre, CLASSES[prop.genre])}>
							{ETIQUETTES[prop.genre]} | {titreFiche(prop.fiche)}
						</span>
						<span className={s.texte}>{prop.texte}</span>
						<span className={s.detail}>{prop.detail}</span>
						{corrige ? (
							<form
								className={s.correction}
								onSubmit={(e) => {
									e.preventDefault();
									void trancher(prop, { corriger: corrige.texte });
								}}
							>
								<textarea
									aria-label="Correction"
									value={corrige.texte}
									rows={3}
									autoFocus
									disabled={occupe}
									onChange={(e) => setCorrection({ cle: prop.cle, texte: e.target.value })}
									onKeyDown={(e) => {
										if (e.key === 'Enter' && !e.shiftKey) {
											e.preventDefault();
											e.currentTarget.form?.requestSubmit();
										}
									}}
								/>
								<div className={s.actions}>
									<Bouton petit genre="primaire" type="submit" disabled={occupe || !corrige.texte.trim()}>
										Enregistrer
									</Bouton>
									<Bouton petit onClick={() => setCorrection(null)} disabled={occupe}>
										Annuler
									</Bouton>
								</div>
							</form>
						) : (
							<div className={s.actions}>
								<Bouton petit onClick={() => void trancher(prop, 'confirmer')} disabled={occupe}>
									Confirmer
								</Bouton>
								{prop.genre === 'a_confirmer' && (
									<Bouton petit onClick={() => setCorrection({ cle: prop.cle, texte: prop.texte })} disabled={occupe}>
										Modifier
									</Bouton>
								)}
								{(prop.genre !== 'montee' || prop.vise?.proposee) && (
									<Bouton petit onClick={() => void trancher(prop, 'rejeter')} disabled={occupe}>
										Rejeter
									</Bouton>
								)}
							</div>
						)}
					</article>
				);
			})}
			{/* un lot reproposé (autres lignes) repart de zéro : cases toutes cochées, « Revoir » replié */}
			{p.lots.map((lot) => (
				<LotAValider key={`${lot.id}:${lot.proposeMs}`} lot={lot} surDecide={p.rechargerLots} />
			))}
		</section>
	);
}
