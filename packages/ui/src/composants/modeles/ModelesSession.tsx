/**
 * Niveau des modèles pour une session, aligné à droite de « Injecté dans la session » : un texte nu à gauche de l'icône, sans
 * cadre. Ce qui est en cours, avec un reflet : l'activité de la session (« Recherche… », prioritaire), l'étape du calcul du
 * message (« reranker… », « affinage 10/30… »), l'affinage du classement. Au repos, atténué : l'état du classement
 * (« ordre seul », sa raison en info-bulle et dans le menu ; « calibré » ; « injection coupée »). Un clic ouvre le menu : comme partout, complets, sens seul, coupés ; un niveau plus
 * large que celui de partout est désactivé, avec son motif. Rien tant que l'état des modèles n'est pas connu ou qu'ils ne sont pas
 * installés.
 */
import { libelleEtapeCalcul, NIVEAUX_MODELES, niveauEffectif, plusLarge, type NiveauModeles } from '@mnemo/commun';
import type { ReactNode } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useEtapeSession, useModeles, useNiveauModelesSession } from '../../client/hooks.ts';
import { cx } from '../commun/classes.ts';
import { useToast } from '../Toast.tsx';
import { IconeModeles } from './IconeModeles.tsx';
import { DETAILS_SESSION, NOMS_NIVEAUX, libelleActivite } from './libelles.ts';
import { GroupeMenu, ItemMenu, MenuModeles } from './MenuModeles.tsx';
import s from './Modeles.module.css';

/** Texte du bouton : rien pour le cas courant (complets), un mot sinon ; la place est comptée à côté du titre. */
const TEXTES: Record<NiveauModeles, string> = { complets: '', sens: 'Sens', coupes: 'Coupés' };

/**
 * L'état du classement du dernier message, dit par le bouton : affinage en cours, ordre seul (sa raison ; null : notes
 * calibrées) ; `repos` : le texte au repos (« ordre seul », « calibré », « injection coupée »).
 */
export type EtatClassementSession = { affinage: boolean; ordreSeul: string | null; repos?: string };

const TITRE_AFFINAGE = "Le reranker affine le classement en arrière-plan ; les lignes glisseront à leur nouvelle place. Rien n'est injecté après coup.";

export function ModelesSession(p: { session: string; niveau: NiveauModeles | null; classement?: EtatClassementSession }): ReactNode {
	const { etat: e } = useModeles(true);
	const etape = useEtapeSession(p.session);
	const changer = useNiveauModelesSession();
	const toast = useToast();
	if (e?.installes !== true) {
		// modèles inconnus ou non installés : pas de menu, mais l'état du classement reste dit
		const ordre = p.classement?.ordreSeul ?? null;
		if (p.classement?.affinage === true)
			return (
				<span className={s.etatSeul} title={TITRE_AFFINAGE}>
					<span className={s.reflet}>affinage…</span>
				</span>
			);
		return ordre === null ? null : (
			<span className={s.etatSeul} title={ordre}>
				ordre seul
			</span>
		);
	}
	const propre = p.niveau;
	const effectif = niveauEffectif(e.niveau, propre);
	const activite = e.activites.findLast((a) => a.session === p.session);
	const affinage = p.classement?.affinage === true;
	const ordreSeul = p.classement?.ordreSeul ?? null;
	// ce qui est en cours d'abord (en texte, point animé), puis l'état du classement, puis le niveau
	const enCours = activite !== undefined ? libelleActivite(activite) : etape !== null ? libelleEtapeCalcul(etape) : affinage ? 'affinage…' : null;
	const texte = enCours ?? p.classement?.repos ?? (ordreSeul !== null ? 'ordre seul' : TEXTES[effectif]);
	const niveauDit = propre === null ? `Modèles de cette session : comme partout (${NOMS_NIVEAUX[e.niveau]})` : `Modèles de cette session : ${NOMS_NIVEAUX[propre]}`;
	const titre = [niveauDit, ...(activite === undefined && affinage ? [TITRE_AFFINAGE] : []), ...(ordreSeul !== null ? [ordreSeul] : [])].join('\n');
	const choisir = (niveau: NiveauModeles | null) =>
		void changer(p.session, niveau).catch((erreur: unknown) => toast(erreur instanceof ErreurApi ? erreur.message : 'Action impossible.'));
	return (
		<MenuModeles
			libelle={[niveauDit, ...(enCours !== null ? [enCours] : []), ...(ordreSeul !== null ? ['ordre seul'] : [])].join(' – ')}
			titre={titre}
			classeBouton={cx(s.boutonSession, effectif === 'coupes' && s.eteint, propre !== null && s.propre)}
			alignement="droite"
			contenuBouton={
				<>
					{/* le texte à gauche de l'icône : il s'étend vers la gauche, l'icône ne bouge pas ; un reflet tant que c'est en cours */}
					{texte !== '' && <span className={cx(s.texte, enCours !== null && s.reflet)}>{texte}</span>}
					<span className={s.icone}>
						<IconeModeles coupes={effectif === 'coupes'} taille={13} />
						{enCours !== null && <span className={cx(s.point, s.actif)} aria-hidden="true" />}
					</span>
				</>
			}
			entete={
				<>
					<div className={s.entete}>Modèles de cette session</div>
					<dl className={s.etats}>
						<dt>Sens</dt>
						<dd>{effectif === 'coupes' ? 'non utilisé' : 'utilisé'}</dd>
						<dt>Reclassement</dt>
						<dd>{effectif === 'complets' ? 'utilisé' : 'non utilisé'}</dd>
						<dt>En cours</dt>
						<dd>{enCours === null ? 'rien' : activite !== undefined || etape !== null ? enCours : 'affinage du classement'}</dd>
						{ordreSeul !== null && (
							<>
								<dt>Classement</dt>
								<dd>ordre seul, sans %</dd>
							</>
						)}
					</dl>
					{ordreSeul !== null && <p className={s.note}>{ordreSeul}</p>}
				</>
			}
			pied={<p className={s.note}>Ne change que cette session : les modèles restent en marche pour les autres. Pour libérer la mémoire, choisissez le niveau partout.</p>}
		>
			{(fermer) => (
				<>
					<div className={s.separateur} role="separator" />
					<GroupeMenu titre="Niveau pour cette session">
						<ItemMenu
							coche={propre === null}
							libelle={`Comme partout (${NOMS_NIVEAUX[e.niveau]})`}
							detail="Suit le niveau choisi dans la barre du haut"
							surChoix={() => {
								choisir(null);
								fermer();
							}}
						/>
						{NIVEAUX_MODELES.map((n) => {
							// plus large que le niveau de partout : il permettrait un modèle que la machine exclut
							const bloque = plusLarge(n, e.niveau);
							return (
								<ItemMenu
									key={n}
									coche={propre === n}
									libelle={NOMS_NIVEAUX[n]}
									detail={bloque ? `Indisponible : limité partout à « ${NOMS_NIVEAUX[e.niveau]} »` : DETAILS_SESSION[n]}
									desactive={bloque}
									surChoix={() => {
										choisir(n);
										fermer();
									}}
								/>
							);
						})}
					</GroupeMenu>
				</>
			)}
		</MenuModeles>
	);
}
