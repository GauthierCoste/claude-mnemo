/**
 * Bouton à état des modèles locaux (barre de titre, entre les quotas et l'Archiviste) : icône, point d'état et texte en direct
 * (« Modèles prêts », « Vectorisation 120/800 », « Recherche… »). Un clic ouvre le panneau : état de chaque pièce et activités
 * en cours (en-tête), puis le menu (niveau partout : complets, sens seul, coupés ; démarrer ou arrêter), puis le délai d'arrêt.
 * Absent tant que les modèles ne sont pas installés.
 */
import { NIVEAUX_MODELES, type NiveauModeles } from '@mnemo/commun';
import type { EtatModelesVue, ReponseArretModeles } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useModeles, useReglages } from '../../client/hooks.ts';
import { aDemarrer } from '../../modeles/etat.ts';
import { useNavigation } from '../../navigation.tsx';
import { cx } from '../commun/classes.ts';
import { useToast } from '../Toast.tsx';
import { IconeModeles } from './IconeModeles.tsx';
import { DETAILS_NIVEAUX, NOMS_NIVEAUX, libelleActivite, lignesPieces, resume } from './libelles.ts';
import { GroupeMenu, ItemMenu, MenuModeles } from './MenuModeles.tsx';
import r from '../commun/Reflet.module.css';
import s from './Modeles.module.css';

export const ENCORE_EN_CHARGEMENT = 'Des modèles chargent encore : réessayez dans un instant.';
const COUPES_PARTOUT = 'Les modèles sont coupés partout';

export function BoutonModeles(): ReactNode {
	const modeles = useModeles(true);
	const { sessionPremierPlan } = useNavigation();
	const toast = useToast();
	const e = modeles.etat;
	if (e?.installes !== true) return null;
	const { texte, point } = resume(e);
	const coupes = e.niveau === 'coupes';
	const agir = (geste: () => Promise<void>) =>
		void geste().catch((erreur: unknown) => toast(erreur instanceof ErreurApi ? erreur.message : 'Action impossible.'));
	/** Un arrêt qui a trouvé des modèles encore en chargement (geste « Arrêter », ou niveau qui en retire un) : le dire. */
	const direArret = (arret: ReponseArretModeles['arret'] | null) => {
		if (arret !== null && typeof arret === 'object') toast(ENCORE_EN_CHARGEMENT);
	};
	const choisirNiveau = (n: NiveauModeles) => agir(async () => direArret(await modeles.changerNiveau(n)));
	return (
		<MenuModeles
			libelle={`Modèles locaux : ${texte}`}
			classeBouton={cx(s.bouton, coupes && s.eteint)}
			alignement="droite"
			contenuBouton={
				<>
					<span className={s.icone}>
						<IconeModeles coupes={coupes} />
						{point !== null && <span className={cx(s.point, s[point])} aria-hidden="true" />}
					</span>
					{/* une activité ou un chargement en cours : le même reflet que le bouton des modèles d'une session */}
					<span className={cx(s.texte, point === 'actif' && r.reflet)}>{texte}</span>
				</>
			}
			entete={<EtatPieces e={e} sessionAffichee={sessionPremierPlan} />}
			pied={<NoteInactivite minutes={e.inactiviteMinutes} />}
		>
			{(fermer) => (
				<>
					<div className={s.separateur} role="separator" />
					<GroupeMenu titre="Partout">
						{NIVEAUX_MODELES.map((n) => (
							<ItemMenu key={n} coche={e.niveau === n} libelle={NOMS_NIVEAUX[n]} detail={DETAILS_NIVEAUX[n]} surChoix={() => choisirNiveau(n)} />
						))}
					</GroupeMenu>
					<div className={s.separateur} role="separator" />
					{aDemarrer(e) ? (
						<ItemMenu
							libelle="Démarrer maintenant"
							desactive={coupes}
							detail={coupes ? COUPES_PARTOUT : undefined}
							surChoix={() => {
								agir(modeles.demarrer);
								fermer();
							}}
						/>
					) : (
						<ItemMenu
							libelle="Arrêter maintenant"
							surChoix={() => {
								agir(async () => direArret(await modeles.arreter()));
								fermer();
							}}
						/>
					)}
				</>
			)}
		</MenuModeles>
	);
}

/** En-tête du panneau (hors du menu) : chaque pièce, puis les appels en cours, avec leur session et leur dossier. */
function EtatPieces(p: { e: EtatModelesVue; sessionAffichee: string | null }): ReactNode {
	return (
		<>
			<div className={s.entete}>Modèles locaux</div>
			<ul className={s.pieces}>
				{lignesPieces(p.e).map((x) => (
					<li key={x.role} title={x.titre}>
						<span className={s.role}>{x.role}</span>
						<span className={s.etatPiece}>{x.etat}</span>
						{x.modele !== '' && <span className={s.modele}>{x.modele}</span>}
						{x.detail !== '' && <span className={s.detail}>{x.detail}</span>}
					</li>
				))}
			</ul>
			{p.e.activites.length > 0 && (
				<ul className={s.activites}>
					{p.e.activites.map((a, i) => (
						<li key={i}>
							<span className={cx(s.point, s.actif)} aria-hidden="true" />
							{libelleActivite(a)}
							{a.session !== null && a.session === p.sessionAffichee && <span className={s.detail}> – cette session</span>}
							{!a.ceDossier && <span className={s.detail}> – autre dossier</span>}
						</li>
					))}
				</ul>
			)}
		</>
	);
}

/**
 * Délai d'arrêt pour inactivité : celui du gardien en marche ; sinon celui des réglages du dossier (lu à l'ouverture du
 * panneau), qu'aura le prochain gardien lancé d'ici. Rien tant qu'aucun n'est connu.
 */
function NoteInactivite(p: { minutes: number | null }): ReactNode {
	return p.minutes !== null ? <TexteInactivite minutes={p.minutes} /> : <InactiviteDesReglages />;
}

function InactiviteDesReglages(): ReactNode {
	const reglages = useReglages();
	const champ = reglages.donnees?.champs.find((c) => c.cle === 'modeles.inactiviteMinutes');
	return typeof champ?.valeur === 'number' ? <TexteInactivite minutes={champ.valeur} /> : null;
}

function TexteInactivite(p: { minutes: number }): ReactNode {
	return <p className={s.note}>Ils démarrent au besoin et s’arrêtent seuls après {p.minutes} min sans requête.</p>;
}
