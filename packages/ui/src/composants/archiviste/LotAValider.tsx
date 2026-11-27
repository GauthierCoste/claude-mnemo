import { avertissementsDe, type AvecAvertissements } from '@mnemo/commun';
import { ROUTES, type DemandeValidationLot, type GenreLotVue, type InformationDuLotVue, type LigneDeLotVue, type LotVue, type ReponseRejetLot, type ReponseValidationLot } from '@mnemo/contrat';
import { useId, useState, type ReactNode } from 'react';
import { compteEnMots, compteLot, etiquetteLot, intituleLot, lireInformation, resumeChangement, titreDuLot } from '../../archiviste/lots.ts';
import { ErreurApi } from '../../client/api.ts';
import { useClient } from '../../client/contexte.tsx';
import { avecId, useGraphe } from '../../client/hooks.ts';
import { useTextes } from '../../langue/langue.tsx';
import { TEXTES, type Textes } from '../../langue/textes.ts';
import { rendreEnLigne } from '../../memoire/rendu-fiche.tsx';
import { resoudreLien } from '../../memoire/resoudre-lien.ts';
import { Bouton } from '../commun/Bouton.tsx';
import { cx } from '../commun/classes.ts';
import { Puce } from '../commun/Puce.tsx';
import { useAnnonceEcriture } from '../commun/annonce-ecriture.ts';
import { useNavigationMemoire } from '../memoire/navigation-memoire.tsx';
import { useToast } from '../Toast.tsx';
import s from './Propositions.module.css';

/** Refus 409 de `lotValider` (une information visée a changé, le service a écarté le lot), en français : le texte des tests. */
export const FICHE_CHANGEE = TEXTES.fr.archiviste.lots.ficheChangee;

/** Note d'un lot périmé, encore en attente (rien ne le repropose seul), en français : le texte des tests. */
export const LOT_PERIME = TEXTES.fr.archiviste.lots.perime;

type TextesLots = Textes['archiviste']['lots'];

/**
 * Un lot d'informations proposé par l'archiviste, dans « À arbitrer » : intitulé (« 3 doublons proposés dans Module
 * stocks »), motif, puis **Tout valider**, **Revoir** (déplie les lignes cochables, une par information, avec ce qui
 * change) et **Rejeter**. Valider envoie les indices des lignes cochées (toutes pour « Tout valider ») ; le service applique
 * en un commit. Un lot tranché reste grisé jusqu'à la relecture des lots (`surDecide`, puis message `lots`), qui le fait
 * disparaître. Un lot reproposé est un autre composant (clé : id et date de proposition) : ses cases repartent cochées.
 */
export function LotAValider(p: { lot: LotVue; surDecide(): void }): ReactNode {
	const { lot } = p;
	const { api } = useClient();
	const toast = useToast();
	const annoncer = useAnnonceEcriture();
	const t = useTextes().archiviste.lots;
	const idLignes = useId();
	const [revoir, setRevoir] = useState(false);
	const [decoches, setDecoches] = useState<ReadonlySet<number>>(() => new Set());
	const [enCours, setEnCours] = useState(false);
	/** Le lot tranché, tel qu'affiché au moment du choix : grisé tant que c'est lui qui est affiché. */
	const [tranche, setTranche] = useState<LotVue | null>(null);
	const occupe = enCours || tranche === lot;
	// une ligne déjà appliquée (confirmée, supprimée, fusionnée sans le lot) n'a rien à valider : jamais envoyée
	const aAppliquer = lot.lignes.filter((l) => !l.deja).map((l) => l.indice);
	const cochees = aAppliquer.filter((i) => !decoches.has(i));
	const intitule = intituleLot(lot, t);

	/** `action` rend le succès à annoncer et les avertissements de la réponse. */
	async function decider(action: () => Promise<{ succes: string; avertissements: AvecAvertissements }>): Promise<void> {
		setEnCours(true);
		try {
			const { succes, avertissements } = await action();
			setTranche(lot);
			annoncer(succes, avertissements);
		} catch (e) {
			// 409 : lot écarté (une information a changé, à faire reproposer) ou retiré (déjà appliqué, fiche disparue : son motif
			// le dit, « lot retiré », sans rien à reproposer)
			if (e instanceof ErreurApi && e.statut === 409) toast(e.message.includes('lot retiré') ? e.message : t.ficheChangee);
			else toast(e instanceof Error ? e.message : t.ecritureImpossible);
		} finally {
			setEnCours(false);
		}
		// le service diffuse `lots` après chaque décision ; relire aussi d'ici (lot écarté sur 409, déjà décidé sur 404)
		p.surDecide();
	}

	const valider = (lignes: number[]) =>
		decider(async () => {
			const r = await api.envoyer<ReponseValidationLot>(avecId(ROUTES.lotValider, lot.id), { lignes } satisfies DemandeValidationLot);
			return { succes: t.valide(r.lignes.length), avertissements: avertissementsDe(r) };
		});

	const rejeter = () =>
		decider(async () => {
			await api.envoyer<ReponseRejetLot>(avecId(ROUTES.lotRejeter, lot.id), {});
			return { succes: t.rejete, avertissements: {} };
		});

	const basculer = (indice: number, coche: boolean) =>
		setDecoches((x) => {
			const suivant = new Set(x);
			if (coche) suivant.delete(indice);
			else suivant.add(indice);
			return suivant;
		});

	return (
		<article className={cx(s.proposition, occupe && s.off)} aria-busy={occupe} aria-label={intitule}>
			<span className={cx(s.genre, s.lot)}>
				{etiquetteLot(lot.genre, t)} | {titreDuLot(lot)}
			</span>
			<span className={s.texte}>{intitule}</span>
			<span className={s.detail}>{lot.motif}</span>
			{lot.perime && (
				<span className={s.detail} role="note">
					{t.perime}
				</span>
			)}
			<div className={s.actions}>
				<Bouton petit genre="primaire" onClick={() => void valider(aAppliquer)} disabled={occupe || lot.perime || aAppliquer.length === 0}>
					{t.toutValider}
				</Bouton>
				<Bouton petit onClick={() => setRevoir((x) => !x)} aria-expanded={revoir} aria-controls={idLignes}>
					{revoir ? t.replier : t.revoir}
				</Bouton>
				<Bouton petit onClick={() => void rejeter()} disabled={occupe}>
					{t.rejeter}
				</Bouton>
			</div>
			{revoir && (
				<form
					id={idLignes}
					className={s.revue}
					onSubmit={(e) => {
						e.preventDefault();
						void valider(cochees);
					}}
				>
					<LignesDuLot lot={lot} decoches={decoches} desactive={occupe || lot.perime} surCocher={basculer} />
					<div className={s.actions}>
						<Bouton petit genre="primaire" type="submit" disabled={occupe || lot.perime || cochees.length === 0}>
							{t.valider(compteEnMots(lot.genre, compteLot(lot, cochees), t))}
						</Bouton>
					</div>
				</form>
			)}
		</article>
	);
}

/** Rôle d'une information visée par une ligne, pour « Détail » : la gardée puis les absorbées d'une fusion ; la visée sinon. */
function role(genre: GenreLotVue, i: number, t: TextesLots): string {
	if (genre === 'fusionner') return i === 0 ? t.roles.gardee : t.roles.absorbee;
	return genre === 'supprimer' ? t.roles.supprimee : t.roles.aConfirmer;
}

/** Lignes écrites d'une information, telles quelles (« Détail »). */
function Ecrit(p: { info: InformationDuLotVue; role: string }): ReactNode {
	const t = useTextes().archiviste.lots;
	return (
		<div className={s.information}>
			<span className={s.role}>{p.role}</span>
			{p.info.lignes.length === 0 ? (
				<span className={s.brut}>{t.absenteDeLaFiche(p.info.ancre)}</span>
			) : (
				p.info.lignes.map((x, i) => (
					<span key={i} className={s.brut}>
						{x}
					</span>
				))
			)}
		</div>
	);
}

/**
 * Les lignes du lot dans « Revoir », compactes : une par information (case, catégorie, énoncé avec ses liens), puis ce qui
 * change en une ou deux lignes courtes ; les lignes écrites, avant et après, sous « Détail ». Les liens `[[…]]` sont
 * résolus sur le graphe (lu seulement quand « Revoir » est ouvert).
 */
function LignesDuLot(p: { lot: LotVue; decoches: ReadonlySet<number>; desactive: boolean; surCocher(indice: number, coche: boolean): void }): ReactNode {
	const t = useTextes().archiviste.lots;
	const graphe = useGraphe();
	const memoire = useNavigationMemoire();
	const fiches = graphe.donnees?.fiches ?? [];
	const enLigne = (texte: string) => rendreEnLigne(texte, (ecrit) => resoudreLien(ecrit, fiches), memoire.ouvrirFiche);
	return (
		<fieldset className={s.lignes}>
			<legend className={s.legende}>{t.lignesAAppliquer}</legend>
			{p.lot.lignes.map((l) => (
				<LigneDuLot key={l.indice} ligne={l} genre={p.lot.genre} cochee={!p.decoches.has(l.indice)} desactive={p.desactive} surCocher={(c) => p.surCocher(l.indice, c)} enLigne={enLigne} />
			))}
		</fieldset>
	);
}

function LigneDuLot(p: { ligne: LigneDeLotVue; genre: GenreLotVue; cochee: boolean; desactive: boolean; surCocher(coche: boolean): void; enLigne(texte: string): ReactNode[] }): ReactNode {
	const { ligne } = p;
	const t = useTextes().archiviste.lots;
	const idTexte = useId();
	const visee = ligne.avant[0] ? lireInformation(ligne.avant[0]) : null;
	const texte = visee?.texte ?? t.absente(ligne.avant[0]?.ancre ?? t.ligne(ligne.indice + 1));
	return (
		<div className={s.ligne}>
			<div className={s.case}>
				<input type="checkbox" checked={p.cochee && !ligne.deja} disabled={p.desactive || ligne.deja} aria-labelledby={idTexte} onChange={(e) => p.surCocher(e.target.checked)} />
				<span className={s.enonce}>
					{visee?.categorie != null && (
						<Puce className={s.categorie}>
							<bdi>{visee.categorie}</bdi>
						</Puce>
					)}
					<span id={idTexte}>{visee?.barre ? <s>{p.enLigne(texte)}</s> : p.enLigne(texte)}</span>
				</span>
			</div>
			{ligne.deja && (
				<span className={s.changement} role="note">
					{t.deja[p.genre]}
				</span>
			)}
			{!ligne.deja && resumeChangement(ligne, p.genre, t).map((x, i) => (
				<span key={i} className={s.changement}>
					{p.enLigne(x)}
				</span>
			))}
			{ligne.motif !== null && (
				<span className={s.changement} role="note">
					{ligne.motif}
				</span>
			)}
			<details className={s.ecrit}>
				<summary>{t.detail}</summary>
				<span className={s.etape}>{t.avant}</span>
				{ligne.avant.map((info, i) => (
					<Ecrit key={info.ancre} info={info} role={role(p.genre, i, t)} />
				))}
				<span className={s.etape}>{t.apres}</span>
				{ligne.apres ? <Ecrit info={ligne.apres} role={p.genre === 'fusionner' ? t.roles.gardee : t.roles.confirmee} /> : <span className={s.role}>{t.informationRetiree}</span>}
			</details>
		</div>
	);
}
