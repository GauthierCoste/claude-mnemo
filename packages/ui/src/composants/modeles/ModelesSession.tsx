/**
 * Niveau des modèles pour une session, aligné à droite de « Injecté dans la session » : icône et niveau effectif, ou l'activité
 * de la session en cours (« Recherche… »). Un clic ouvre le menu : comme partout, complets, sens seul, coupés ; un niveau plus
 * large que celui de partout est désactivé, avec son motif. Rien tant que l'état des modèles n'est pas connu ou qu'ils ne sont pas
 * installés.
 */
import { NIVEAUX_MODELES, niveauEffectif, plusLarge, type NiveauModeles } from '@mnemo/commun';
import type { ReactNode } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useModeles, useNiveauModelesSession } from '../../client/hooks.ts';
import { cx } from '../commun/classes.ts';
import { useToast } from '../Toast.tsx';
import { IconeModeles } from './IconeModeles.tsx';
import { DETAILS_SESSION, NOMS_NIVEAUX, libelleActivite } from './libelles.ts';
import { GroupeMenu, ItemMenu, MenuModeles } from './MenuModeles.tsx';
import s from './Modeles.module.css';

/** Texte du bouton : rien pour le cas courant (complets), un mot sinon ; la place est comptée à côté du titre. */
const TEXTES: Record<NiveauModeles, string> = { complets: '', sens: 'Sens', coupes: 'Coupés' };

export function ModelesSession(p: { session: string; niveau: NiveauModeles | null }): ReactNode {
	const { etat: e } = useModeles(true);
	const changer = useNiveauModelesSession();
	const toast = useToast();
	if (e?.installes !== true) return null;
	const propre = p.niveau;
	const effectif = niveauEffectif(e.niveau, propre);
	const activite = e.activites.findLast((a) => a.session === p.session);
	const texte = activite !== undefined ? libelleActivite(activite) : TEXTES[effectif];
	const titre = propre === null ? `Modèles de cette session : comme partout (${NOMS_NIVEAUX[e.niveau]})` : `Modèles de cette session : ${NOMS_NIVEAUX[propre]}`;
	const choisir = (niveau: NiveauModeles | null) =>
		void changer(p.session, niveau).catch((erreur: unknown) => toast(erreur instanceof ErreurApi ? erreur.message : 'Action impossible.'));
	return (
		<MenuModeles
			libelle={activite === undefined ? titre : `${titre} – ${libelleActivite(activite)}`}
			titre={titre}
			classeBouton={cx(s.boutonSession, effectif === 'coupes' && s.eteint, propre !== null && s.propre)}
			alignement="droite"
			contenuBouton={
				<>
					<span className={s.icone}>
						<IconeModeles coupes={effectif === 'coupes'} taille={13} />
						{activite !== undefined && <span className={cx(s.point, s.actif)} aria-hidden="true" />}
					</span>
					{texte !== '' && <span className={s.texte}>{texte}</span>}
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
						<dd>{activite !== undefined ? libelleActivite(activite) : 'rien'}</dd>
					</dl>
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
