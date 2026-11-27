/**
 * Groupe « À traiter » de Mémoire › Archiviste : les fiches sources marquées `a_traiter` (import de la mémoire de Claude Code,
 * dépôts), chacune avec ses actions. « Traiter » envoie à l'archiviste la consigne de l'import pour ce document (le service
 * le reprend ou le lance s'il ne tourne pas) : la ligne passe « en cours » jusqu'à ce que l'archiviste retire la marque.
 * « Marquer traité » retire la marque sans rien créer : la ligne disparaît. « Ouvrir » lit la fiche dans Fichiers.
 * Suivent les dossiers non rattachés (aucune fiche ne les couvre), chacun avec son texte rédigé par le service : « Traiter »
 * demande à l'archiviste de poser leur lien. « Tout traiter », en tête : une consigne pour toutes les fiches à traiter du
 * service, affichées ou non (`total`), sauf celles déjà en cours, et une pour tous les dossiers qui ne sont pas en cours ;
 * inactif quand il n'en reste aucun.
 */
import { ROUTES, type DocumentVue, type DossierNonRattacheVue, type ReponseMarquerTraite, type ReponseTraiter } from '@mnemo/contrat';
import { useEffect, useState, type ReactNode } from 'react';
import { useClient } from '../../client/contexte.tsx';
import { useTextes } from '../../langue/langue.tsx';
import { Bouton } from '../commun/Bouton.tsx';
import { cx } from '../commun/classes.ts';
import { DePlus } from '../commun/DePlus.tsx';
import { copierTexte } from '../commun/copier.ts';
import { Puce } from '../commun/Puce.tsx';
import { useNavigationMemoire } from '../memoire/navigation-memoire.tsx';
import { useToast } from '../Toast.tsx';
import { useAnnonceEcriture } from '../commun/annonce-ecriture.ts';
import s from './SourcesATraiter.module.css';

const ATTRIBUT = 'data-a-traiter';

/**
 * Amène en vue la ligne « à traiter » de cette fiche et donne le focus à son action (« Traiter », ou la ligne si elle est
 * en cours) ; faux si la ligne n'est pas affichée.
 */
export function allerALAction(chemin: string): boolean {
	const ligne = [...document.querySelectorAll<HTMLElement>(`[${ATTRIBUT}]`)].find((e) => e.getAttribute(ATTRIBUT) === chemin);
	if (!ligne) return false;
	ligne.scrollIntoView?.({ block: 'nearest' });
	const action = ligne.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? ligne;
	action.focus({ preventScroll: true });
	return true;
}

/** Délai au-delà duquel une ligne « en cours » sans nouvelles redevient actionnable. */
export const EN_COURS_MS = 10 * 60_000;

/** `total` : fiches à traiter, listées ou non ; « Tout voir » (`surToutVoir`) demande la liste entière ; `dossiers` : les dossiers non rattachés. */
export function SourcesATraiter(p: { documents: readonly DocumentVue[]; total: number; surToutVoir(): void; dossiers: readonly DossierNonRattacheVue[] }): ReactNode {
	const { api } = useClient();
	const toast = useToast();
	const annoncer = useAnnonceEcriture();
	const t = useTextes().archiviste.sources;
	const memoire = useNavigationMemoire();
	/** Envoyées à l'archiviste, avec l'heure d'envoi : « en cours » tant que la marque reste, `EN_COURS_MS` au plus. */
	const [envois, setEnvois] = useState<ReadonlyMap<string, number>>(() => new Map());
	/** Marquées traitées : retirées sans attendre la relecture. */
	const [retirees, setRetirees] = useState<ReadonlySet<string>>(() => new Set());
	const [occupees, setOccupees] = useState<ReadonlySet<string>>(() => new Set());
	const [toutesOccupees, setToutesOccupees] = useState(false);
	/** Mode dégradé : les commandes qui lancent ou reprennent l'archiviste avec chaque consigne du dernier geste, à copier dans l'ordre. */
	const [manuels, setManuels] = useState<readonly string[]>([]);

	// La liste du service fait foi : ce qui n'y est plus sort des deux états (une fiche remarquée revient comme neuve). Une
	// liste coupée ne dit rien des fiches qu'elle ne montre pas : leurs envois restent, jusqu'à `EN_COURS_MS`.
	const listeEntiere = p.documents.length >= p.total;
	useEffect(() => {
		const presents = new Set([...p.documents.map((d) => d.chemin), ...p.dossiers.map((d) => d.dossier)]);
		setRetirees((x) => ([...x].every((c) => presents.has(c)) ? x : new Set([...x].filter((c) => presents.has(c)))));
		if (listeEntiere) setEnvois((x) => ([...x.keys()].every((c) => presents.has(c)) ? x : new Map([...x].filter(([c]) => presents.has(c)))));
	}, [p.documents, p.dossiers, listeEntiere]);

	// Sans nouvelles au bout du délai : la plus ancienne ligne « en cours » redevient actionnable, puis la suivante.
	useEffect(() => {
		if (envois.size === 0) return;
		const premier = Math.min(...envois.values());
		const minuteur = setTimeout(() => setEnvois((x) => new Map([...x].filter(([, t]) => Date.now() - t < EN_COURS_MS))), Math.max(0, premier + EN_COURS_MS - Date.now()));
		return () => clearTimeout(minuteur);
	}, [envois]);

	const lignes = p.documents.filter((d) => !retirees.has(d.chemin));
	if (lignes.length === 0 && p.dossiers.length === 0) return null;
	const enCours = new Set(envois.keys());
	const dossiersConnus = new Set(p.dossiers.map((d) => d.dossier));

	const ajouter = (ensemble: ReadonlySet<string>, chemins: readonly string[]) => new Set([...ensemble, ...chemins]);
	const retirer = (ensemble: ReadonlySet<string>, chemins: readonly string[]) => new Set([...ensemble].filter((c) => !chemins.includes(c)));

	/**
	 * Envoie une consigne à l'archiviste : `lignes` sont occupées le temps de la réponse, les fiches ou dossiers rendus passent
	 * « en cours » ; une commande du mode dégradé s'ajoute à celles du même geste (`geste` les efface au début).
	 */
	async function envoyer(lignesOccupees: readonly string[], requete: () => Promise<ReponseTraiter>): Promise<void> {
		setOccupees((x) => ajouter(x, lignesOccupees));
		try {
			const r = await requete();
			const maintenant = Date.now();
			setEnvois((x) => new Map([...x, ...r.chemins.map((c) => [c, maintenant] as const)]));
			const commande = r.archiviste === 'manuel' ? r.manuel : undefined;
			if (commande !== undefined) setManuels((x) => [...x, commande]);
			toast(t.archiviste[r.archiviste] ?? r.archiviste);
		} catch (e) {
			toast(t.traitementImpossible(e instanceof Error ? e.message : null));
		} finally {
			setOccupees((x) => retirer(x, lignesOccupees));
		}
	}

	const traiterFiches = (chemins: readonly string[]) => envoyer(chemins, () => api.envoyer<ReponseTraiter>(ROUTES.sourcesTraiter, { chemins }));
	const traiterDossiers = (dossiers: readonly string[]) => envoyer(dossiers, () => api.envoyer<ReponseTraiter>(ROUTES.dossiersTraiter, { chemins: dossiers }));
	/** Toutes les fiches à traiter du service, affichées ou non, sauf celles en cours ou dont l'envoi attend sa réponse. */
	const traiterToutesLesFiches = async () => {
		setToutesOccupees(true);
		try {
			await envoyer(aEnvoyer, () => api.envoyer<ReponseTraiter>(ROUTES.sourcesTraiterToutes, { sauf: [...new Set([...enCours, ...occupees])].filter((c) => !dossiersConnus.has(c)) }));
		} finally {
			setToutesOccupees(false);
		}
	};

	async function marquerTraite(chemin: string): Promise<void> {
		setOccupees((x) => ajouter(x, [chemin]));
		try {
			const r = await api.envoyer<ReponseMarquerTraite>(ROUTES.sourcesMarquerTraite, { chemins: [chemin] });
			setRetirees((x) => ajouter(x, [chemin]));
			annoncer(t.marque, r);
		} catch (e) {
			toast(t.marqueNonRetiree(e instanceof Error ? e.message : null));
		} finally {
			setOccupees((x) => retirer(x, [chemin]));
		}
	}

	const libre = (c: string) => !enCours.has(c) && !occupees.has(c);
	const aEnvoyer = lignes.map((d) => d.chemin).filter(libre);
	const dossiersAEnvoyer = p.dossiers.map((d) => d.dossier).filter(libre);
	const affichees = new Set([...p.documents.map((d) => d.chemin), ...p.dossiers.map((d) => d.dossier)]);
	const enCoursNonAffichees = [...enCours].filter((c) => !affichees.has(c)).length;
	const nonAfficheesALancer = Math.max(0, p.total - p.documents.length - enCoursNonAffichees);
	const fichesALancer = !toutesOccupees && (aEnvoyer.length > 0 || nonAfficheesALancer > 0);
	/** Un geste de l'utilisateur : les commandes d'un geste précédent sont effacées avant ses envois. */
	const geste = (actions: () => Promise<void>) => {
		setManuels([]);
		void actions();
	};
	const toutTraiter = async () => {
		if (fichesALancer) await traiterToutesLesFiches();
		if (dossiersAEnvoyer.length > 0) await traiterDossiers(dossiersAEnvoyer);
	};
	return (
		<section className={s.groupe} aria-labelledby="titre-a-traiter">
			<div className={s.entete}>
				<span id="titre-a-traiter" className={s.lbl}>
					{t.titre}
				</span>
				<Puce ton="avertissement">{p.total - (p.documents.length - lignes.length) + p.dossiers.length}</Puce>
				<span className={s.espace} />
				<Bouton petit onClick={() => geste(toutTraiter)} disabled={!fichesALancer && dossiersAEnvoyer.length === 0}>
					{t.toutTraiter}
				</Bouton>
			</div>
			{manuels.map((manuel) => (
				<div key={manuel} className={s.manuel} role="group" aria-label={t.commande}>
					<span>{t.archiviste.manuel}.</span>
					<code>{manuel}</code>
					<Bouton petit onClick={() => copierTexte(manuel, toast, t.commandeCopiee)}>
						{t.copier}
					</Bouton>
				</div>
			))}
			<ul className={s.liste} aria-label={t.titre}>
				{lignes.map((d) => {
					const envoye = enCours.has(d.chemin);
					const occupe = occupees.has(d.chemin);
					return (
						<li key={d.chemin} className={cx(s.ligne, envoye && s.enCours)} {...{ [ATTRIBUT]: d.chemin }} tabIndex={-1} aria-busy={occupe} aria-label={d.titre}>
							<span className={s.titre} title={d.chemin}>
								<bdi>{d.titre}</bdi>
								<span className={s.fichier}>{d.document ?? d.chemin}</span>
							</span>
							{envoye && <Puce ton="succes">{t.enCours}</Puce>}
							<div className={s.actions}>
								<Bouton petit genre="primaire" onClick={() => geste(() => traiterFiches([d.chemin]))} disabled={envoye || occupe}>
									{t.traiter}
								</Bouton>
								<Bouton petit onClick={() => void marquerTraite(d.chemin)} disabled={occupe}>
									{t.marquerTraite}
								</Bouton>
								<Bouton petit onClick={() => memoire.ouvrirFiche(d.chemin)}>{t.ouvrir}</Bouton>
							</div>
						</li>
					);
				})}
				{p.dossiers.map((d) => {
					const envoye = enCours.has(d.dossier);
					const occupe = occupees.has(d.dossier);
					return (
						<li key={`dossier:${d.dossier}`} className={cx(s.ligne, envoye && s.enCours)} aria-busy={occupe} aria-label={d.texte}>
							<span className={s.titre} title={d.dossier}>
								<bdi>{d.texte}</bdi>
							</span>
							{envoye && <Puce ton="succes">{t.enCours}</Puce>}
							<div className={s.actions}>
								<Bouton petit genre="primaire" onClick={() => geste(() => traiterDossiers([d.dossier]))} disabled={envoye || occupe}>
									{t.traiter}
								</Bouton>
							</div>
						</li>
					);
				})}
			</ul>
			<DePlus nombre={p.total - p.documents.length} surToutVoir={p.surToutVoir} />
		</section>
	);
}
