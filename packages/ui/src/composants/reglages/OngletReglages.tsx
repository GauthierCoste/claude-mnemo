/**
 * Onglet Réglages de la vue Réglages : les sections à gauche (Branchements, Mémoire, Système), la section choisie à droite.
 * Branchements : les moteurs et leur liaison à Mnemo, puis l'app Claude (sans réglage à enregistrer : chaque geste écrit tout
 * de suite). Mémoire (cartes Rappel, Recherche et Confiance) et Système : les réglages du dossier (`ReglagesVue` : `.mnemo/reglages.json`,
 * et les règles de `SCHEMA.md`), enregistrés ensemble par un seul pied Annuler / Enregistrer, validés par le service (tout ou
 * rien). Les trois sections restent montées (cachées hors de la section choisie) : une saisie survit au changement de section.
 * Une pastille ambre sur Branchements quand un moteur attend un geste. Changer d'onglet avec une saisie non enregistrée
 * (réglages ou serveur MCP) est retenu par la vue Réglages ; quitter les Réglages l'est ici : un avertissement propose
 * d'enregistrer, d'abandonner ou de rester. Avec les deux saisies, un seul avertissement les nomme, Branchements montré :
 * « Enregistrer les réglages » laisse le serveur à enregistrer (la sortie reste retenue), « Tout abandonner » perd les deux.
 * Libellés, explications et choix des réglages du service : dans la langue de l'interface (`reglages/libelles.ts`). La langue
 * enregistrée (`interface.langue`) s'applique tout de suite : la vue rendue par le service remplace celle du cache, que
 * `LangueFournie` lit.
 */
import type { ReglagesVue } from '@mnemo/contrat';
import { ROUTES } from '@mnemo/contrat';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useCacheRessources, useClient } from '../../client/contexte.tsx';
import { useMoteurs, useReglages } from '../../client/hooks.ts';
import { publierRessource } from '../../client/ressources.ts';
import { useTextes } from '../../langue/langue.tsx';
import { attendUnGeste } from '../../moteurs/circuit.ts';
import { useNavigation } from '../../navigation.tsx';
import { appliquerAccent } from '../../reglages/accent.ts';
import { enSaisie, enValeur, modifications, type Saisie } from '../../reglages/brouillon.ts';
import { cartesReglages, champsNonDisposes, sectionDuChamp } from '../../reglages/disposition.ts';
import { champsTraduits } from '../../reglages/libelles.ts';
import { oublierSectionDemandee, sectionDemandeeALire, type SectionReglages } from '../../reglages/onglet-retenu.ts';
import { Bouton } from '../commun/Bouton.tsx';
import { raccourciAlt } from '../../raccourcis.ts';
import { CarteReglages, type Saisies } from './CarteReglages.tsx';
import { AppClaude } from './claude-desktop/AppClaude.tsx';
import { EtatService } from './EtatService.tsx';
import { Moteurs } from './moteurs/Moteurs.tsx';
import c from './Cartes.module.css';
import d from './Panneau.module.css';
import r from './Reglages.module.css';

const SECTIONS: readonly SectionReglages[] = ['branchements', 'memoire', 'systeme'];

const saisiesDe = (vue: ReglagesVue | undefined): Record<string, Saisie> => Object.fromEntries((vue?.champs ?? []).map((x) => [x.cle, enSaisie(x, x.valeur)]));

/** `surModifie` : prévenu quand une saisie diffère (ou plus) de ce qui est enregistré (changement d'onglet retenu). */
export function OngletReglages(p: { surModifie(modifie: boolean): void }): ReactNode {
	const { api } = useClient();
	const cache = useCacheRessources();
	const t = useTextes();
	const o = t.reglages.onglet;
	const ressource = useReglages();
	const [enregistree, setEnregistree] = useState<ReglagesVue | null>(null);
	const vue = enregistree ?? ressource.donnees;
	const champs = useMemo(() => champsTraduits(vue?.champs ?? [], t), [vue, t]);
	const cartes = useMemo(() => cartesReglages(t), [t]);
	// « Voir dans Réglages » d'une autre vue : la section demandée ouverte d'emblée
	const [section, setSection] = useState<SectionReglages>(() => sectionDemandeeALire() ?? 'branchements');
	useEffect(() => oublierSectionDemandee(), []);
	const geste = useMoteurs(true).donnees?.moteurs.some(attendUnGeste) ?? false;

	const [saisies, setSaisies] = useState(() => saisiesDe(vue));
	// réglages lus, relus ou enregistrés : la saisie repart de ce que le service a gardé
	const [base, setBase] = useState(vue);
	if (base !== vue) {
		setBase(vue);
		setSaisies(saisiesDe(vue));
	}
	const [envoi, setEnvoi] = useState(false);
	const [erreur, setErreur] = useState<string | null>(null);
	const [serveurModifie, setServeurModifie] = useState(false);
	const aEnvoyer = vue === undefined ? {} : modifications(vue.champs, saisies);
	const reglagesModifies = Object.keys(aEnvoyer).length > 0;
	const modifie = reglagesModifies || serveurModifie;

	// modifications non enregistrées : changer d'onglet ou quitter les Réglages est retenu
	const nav = useNavigation();
	const modifieCourant = useRef(modifie);
	modifieCourant.current = modifie;
	const { surModifie } = p;
	useEffect(() => surModifie(modifie), [surModifie, modifie]);
	const { definirGardeSortie } = nav;
	useEffect(() => {
		definirGardeSortie(() => modifieCourant.current);
		return () => definirGardeSortie(null);
	}, [definirGardeSortie]);
	// sortie retenue pour un serveur MCP en cours de saisie : sa section est montrée, avec son avertissement (ou celui des deux)
	useEffect(() => {
		if (nav.sortieRetenue && serveurModifie) setSection('branchements');
	}, [nav.sortieRetenue, serveurModifie]);

	// la couleur principale choisie s'applique tout de suite (aperçu) ; sans enregistrement, la page retrouve celle du service
	const accentSaisi = saisies['interface.accent'];
	const accentEnregistre = vue?.champs.find((x) => x.cle === 'interface.accent')?.valeur;
	useEffect(() => {
		if (accentEnregistre === undefined) return;
		appliquerAccent(document.documentElement, typeof accentSaisi === 'string' ? accentSaisi : accentEnregistre);
		return () => appliquerAccent(document.documentElement, accentEnregistre);
	}, [accentSaisi, accentEnregistre]);

	const enregistrer = async (): Promise<boolean> => {
		setEnvoi(true);
		setErreur(null);
		try {
			const rendue = await api.remplacer<ReglagesVue>(ROUTES.reglages, { valeurs: aEnvoyer });
			setEnregistree(rendue);
			// le cache des réglages suit, sans relecture : la couleur principale et la langue de toute l'interface changent tout de suite
			publierRessource(cache, 'reglages', rendue);
			return true;
		} catch (e) {
			setErreur(e instanceof ErreurApi ? e.message : o.erreur);
			return false;
		} finally {
			setEnvoi(false);
		}
	};
	// réglages enregistrés : partir, sauf si un serveur MCP reste en saisie (la sortie reste retenue, son formulaire le propose)
	const enregistrerPuisPartir = async () => {
		if (!(await enregistrer())) nav.annulerSortie();
		else if (!serveurModifie) nav.poursuivreSortie();
	};

	const surSaisie = useCallback((cle: string, v: Saisie) => setSaisies((x) => ({ ...x, [cle]: v })), []);
	const s: Saisies = {
		champs,
		saisies,
		surSaisie,
		valeurDe: (cle) => {
			const champ = vue?.champs.find((x) => x.cle === cle);
			const saisie = saisies[cle];
			if (champ === undefined || saisie === undefined) return undefined;
			const v = enValeur(champ, saisie);
			return typeof v === 'number' ? v : undefined;
		},
	};
	const marque = (cle: SectionReglages): ReactNode => {
		if (cle === 'branchements')
			return geste ? (
				<>
					<span className={r.pastille} aria-hidden="true" title={o.geste} />
					<span className={c.horsEcran}>{o.gesteHorsEcran}</span>
				</>
			) : null;
		return Object.keys(aEnvoyer).some((x) => sectionDuChamp(x) === cle) ? <span className={d.badge}>{o.modifie}</span> : null;
	};
	const libelles = (cles: string[]) => cles.map((cle) => champs.find((x) => x.cle === cle)?.libelle ?? cle).join(', ');
	const chargement = <p className={vue === undefined && ressource.erreur !== null ? c.erreur : c.discret}>{ressource.erreur ?? o.chargement}</p>;
	const port = vue?.champs.find((x) => x.cle === 'service.port')?.valeur;

	return (
		<div className={d.page}>
			<nav className={d.liste} aria-label={t.reglages.vue.sections}>
				<ul className={d.lignes}>
					{SECTIONS.map((cle) => (
						<li key={cle}>
							<button type="button" className={d.ligne} aria-current={cle === section ? 'true' : undefined} onClick={() => setSection(cle)}>
								<span className={d.identite}>
									<span className={d.nom}>
										{o.sections[cle].titre}
										{marque(cle)}
									</span>
									<span className={d.description}>{o.sections[cle].sous}</span>
								</span>
							</button>
						</li>
					))}
				</ul>
				<p className={d.discret}>
					{o.fichiers(<code>.mnemo/reglages.json</code>, <code>SCHEMA.md</code>, <kbd>{raccourciAlt(',')}</kbd>)}
				</p>
			</nav>
			<div className={c.contenu}>
				{vue !== undefined && vue.avertissements.length > 0 && (
					<ul className={c.avis} aria-label={o.avertissements}>
						{vue.avertissements.map((a) => (
							<li key={a}>{a}</li>
						))}
					</ul>
				)}
				{vue !== undefined && vue.enAttente.length > 0 && (
					<p className={c.avis} role="status">
						{o.redemarrage(libelles(vue.enAttente))}
					</p>
				)}
				<div className={c.seule} hidden={section !== 'branchements'}>
					<section className={c.carte} aria-labelledby="titre-branchements">
						<h2 id="titre-branchements" className={c.titreCarte}>
							{o.sections.branchements.titre}
						</h2>
						<p className={c.sous}>{o.branchements}</p>
						<Moteurs />
						<AppClaude surModifie={setServeurModifie} autreBrouillon={reglagesModifies} />
					</section>
				</div>
				<div className={c.duo} hidden={section !== 'memoire'}>
					{vue === undefined
						? chargement
						: cartes.memoire.map((carte) => <CarteReglages key={carte.cle} carte={carte} s={s} {...(carte.cle === 'rappel' ? { enPlus: champsNonDisposes(champs) } : {})} />)}
				</div>
				<div className={c.seule} hidden={section !== 'systeme'}>
					{vue === undefined
						? chargement
						: cartes.systeme.map((carte) => (
								<CarteReglages
									key={carte.cle}
									carte={carte}
									s={s}
									etatService={<EtatService port={port === undefined ? undefined : String(port)} portEnAttente={vue.enAttente.includes('service.port')} />}
								/>
							))}
				</div>
				{(section !== 'branchements' || reglagesModifies || erreur !== null) && (
					<footer className={c.pied}>
						{nav.sortieRetenue && reglagesModifies && (
							<div className={c.avis} role="alert">
								{serveurModifie ? (
									<p>{o.sortieDouble}</p>
								) : (
									<p>{o.sortie}</p>
								)}
								<div className={c.actions}>
									<Bouton genre="primaire" disabled={envoi} onClick={() => void enregistrerPuisPartir()}>
										{serveurModifie ? o.enregistrerReglages : t.commun.actions.enregistrer}
									</Bouton>
									<Bouton disabled={envoi} onClick={nav.poursuivreSortie}>
										{serveurModifie ? t.reglages.gestes.toutAbandonner : t.reglages.gestes.abandonner}
									</Bouton>
									<Bouton disabled={envoi} onClick={nav.annulerSortie}>
										{t.reglages.gestes.rester}
									</Bouton>
								</div>
							</div>
						)}
						{erreur !== null && (
							<p className={c.erreur} role="alert">
								{erreur}
							</p>
						)}
						<div className={c.actions}>
							{reglagesModifies ? (
								<p className={c.etat}>{o.nonEnregistre}</p>
							) : (
								enregistree !== null && (
									<p className={c.statut} role="status">
										{o.enregistre}
									</p>
								)
							)}
							<Bouton disabled={!reglagesModifies || envoi} onClick={() => setSaisies(saisiesDe(vue))}>
								{t.commun.actions.annuler}
							</Bouton>
							<Bouton genre="primaire" disabled={!reglagesModifies || envoi} onClick={() => void enregistrer()}>
								{t.commun.actions.enregistrer}
							</Bouton>
						</div>
					</footer>
				)}
			</div>
		</div>
	);
}
