import { nomAffichable, nomDeFichierNouveauValide, TAILLE_MAX_DOCUMENT } from '@mnemo/commun';
import { ROUTES } from '@mnemo/contrat';
import type { ReponseDepotTraiter } from '@mnemo/contrat';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ErreurApi, estAbandon } from '../../client/api.ts';
import { useClient } from '../../client/contexte.tsx';
import { useNomRacine } from '../../client/hooks.ts';
import { PLIAGE_INITIAL } from '../../dossiers/arbre.ts';
import { useTextes } from '../../langue/langue.tsx';
import type { Textes } from '../../langue/textes.ts';
import { ArbreDossiers } from '../commun/ArbreDossiers.tsx';
import { Bouton } from '../commun/Bouton.tsx';
import { cx } from '../commun/classes.ts';
import { useToast } from '../Toast.tsx';
import { useAnnonceEcriture } from '../commun/annonce-ecriture.ts';
import s from './ZoneDepot.module.css';

/** Fichier trop gros pour le service (413 au-delà de `TAILLE_MAX_DOCUMENT`, du contrat) : refusé sans envoi. */
export const tropGros = (nom: string, taille: number, t: Textes): string =>
	t.archiviste.depot.tropGros(nomAffichable(nom), t.commun.formats.taille(taille), t.commun.formats.taille(TAILLE_MAX_DOCUMENT));

/** Taille à partir de laquelle la progression de l'envoi s'affiche. */
export const SEUIL_PROGRESSION = 1024 * 1024;

type Progression = { nom: string; envoyes: number; total: number };

/** « Envoi de x.mbox : 1,2 Go / 3,4 Go (35 %) ». */
export function texteProgression(p: Progression, t: Textes): string {
	const pourcent = p.total > 0 ? Math.floor((p.envoyes / p.total) * 100) : 100;
	const taille = t.commun.formats.taille;
	return t.archiviste.depot.progression(nomAffichable(p.nom), taille(p.envoyes), taille(p.total), pourcent);
}

/** Chemin de dépôt, relatif à la racine du dossier Mnemo : `<dossier>/<nom du fichier>`. */
export function cheminDeDepot(dossier: string, nom: string): string {
	const d = dossier.replace(/^\/+|\/+$/g, '');
	return d ? `${d}/${nom}` : nom;
}

/**
 * Zone de dépôt : glisser-déposer ou « Choisir des fichiers », dans le dossier choisi dans l'arbre (défaut : la
 * racine). Chaque fichier part à `depot`, lu en flux par le navigateur ; un gros fichier montre la progression de son
 * envoi. Le service ne remplace jamais un fichier existant (409) et refuse au-delà de `TAILLE_MAX_DOCUMENT` (10 Go, 413) :
 * son message est affiché tel quel (vérifié avant l'envoi : il arrive intact). « Annuler l'envoi » arrête le fichier en cours
 * et ceux qui restent du lot ; le service retire ce qu'il a reçu. Chaque document déposé a sa fiche « à traiter » ; en fin
 * de lot, une seule consigne nomme les documents déposés (`depotTraiter`).
 * `surEnvoi` : un lot de fichiers commence à partir (vrai) ou a fini (faux).
 */
export function ZoneDepot({ surEnvoi }: { surEnvoi?: (enCours: boolean) => void } = {}): ReactNode {
	const { api } = useClient();
	const toast = useToast();
	const annoncer = useAnnonceEcriture();
	const textes = useTextes();
	const t = textes.archiviste.depot;
	const nomRacine = useNomRacine();
	const [destination, setDestination] = useState('');
	const [pliage, setPliage] = useState(PLIAGE_INITIAL);
	const [survol, setSurvol] = useState(false);
	const [envoi, setEnvoi] = useState(0);
	const [progression, setProgression] = useState<Progression | null>(null);
	const champ = useRef<HTMLInputElement>(null);
	const annulation = useRef<AbortController | null>(null);

	async function deposer(fichiers: readonly File[]): Promise<void> {
		// le calque du tiroir reste affiché tant que l'envoi dure (sa progression s'y lit)
		surEnvoi?.(true);
		const lot = new AbortController();
		annulation.current = lot;
		try {
			await confierLeLot(await deposerChacun(fichiers, lot.signal));
		} finally {
			if (annulation.current === lot) annulation.current = null;
			surEnvoi?.(false);
		}
	}

	async function confierLeLot(documents: readonly string[]): Promise<void> {
		if (documents.length === 0) return;
		try {
			const r = await api.envoyer<ReponseDepotTraiter>(ROUTES.depotTraiter, { chemins: documents });
			// laissé « à traiter » : aucun archiviste ne tourne ; confié, rien n'est dit (son terminal le montre)
			if (r.archiviste === 'en_attente') toast(t.enAttente(r.fiches.length));
		} catch (e) {
			toast(t.consigneNonEnvoyee(e instanceof Error ? e.message : null));
		}
	}

	/** Les chemins déposés, dans l'ordre. */
	async function deposerChacun(fichiers: readonly File[], signal: AbortSignal): Promise<string[]> {
		const deposes: string[] = [];
		for (const fichier of fichiers) {
			if (signal.aborted) return deposes;
			if (!nomDeFichierNouveauValide(fichier.name).ok) {
				toast(t.nomRefuse(nomAffichable(fichier.name)));
				continue;
			}
			const vers = cheminDeDepot(destination, fichier.name);
			if (fichier.size > TAILLE_MAX_DOCUMENT) {
				toast(tropGros(fichier.name, fichier.size, textes));
				continue;
			}
			setEnvoi((n) => n + 1);
			const suivi = fichier.size >= SEUIL_PROGRESSION;
			if (suivi) setProgression({ nom: fichier.name, envoyes: 0, total: fichier.size });
			try {
				const r = suivi
					? await api.deposer(vers, fichier, (envoyes, total) => setProgression({ nom: fichier.name, envoyes, total }), signal)
					: await api.deposer(vers, fichier);
				deposes.push(r?.chemin ?? vers);
				annoncer(t.depose(r?.chemin ?? vers), r);
			} catch (e) {
				if (estAbandon(e)) {
					toast(t.envoiAnnule(nomAffichable(fichier.name)));
					return deposes;
				}
				// le message exact du service : « Le fichier … existe déjà » (409), taille et limite (413), chemin refusé, disque…
				if (e instanceof ErreurApi && e.statut === 409) toast(e.message);
				else toast(t.depotImpossible(e instanceof Error ? e.message : null));
			} finally {
				if (suivi) setProgression(null);
				setEnvoi((n) => n - 1);
			}
		}
		return deposes;
	}

	const surDepot = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		setSurvol(false);
		const fichiers = [...(e.dataTransfer?.files ?? [])];
		if (fichiers.length) void deposer(fichiers);
	};

	return (
		<div
			className={cx(s.zone, survol && s.survol)}
			data-depot
			onDragOver={(e) => {
				e.preventDefault();
				if (!survol) setSurvol(true);
			}}
			onDragLeave={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSurvol(false);
			}}
			onDrop={surDepot}
		>
			<b>{t.deposer}</b>
			<span>{t.types}</span>
			<div className={s.actions}>
				<Bouton petit onClick={() => champ.current?.click()} disabled={envoi > 0}>
					{envoi > 0 ? t.depotEnCours : t.choisir}
				</Bouton>
			</div>
			<div className={s.destination} role="group" aria-label={t.groupeDestination}>
				<ArbreDossiers presentation="cadre" entete={<span>{t.destination(destination || nomRacine)}</span>} choisi={destination} surChoisir={setDestination} pliage={pliage} surPliage={setPliage} details={() => null} />
			</div>
			{progression !== null && (
				<div className={s.progression} role="status" aria-live="polite">
					<progress aria-label={t.envoiDe(nomAffichable(progression.nom))} max={progression.total} value={progression.envoyes} />
					<span>{texteProgression(progression, textes)}</span>
					<Bouton petit onClick={() => annulation.current?.abort()}>
						{t.annulerEnvoi}
					</Bouton>
				</div>
			)}
			<input
				ref={champ}
				type="file"
				multiple
				hidden
				onChange={(e) => {
					const fichiers = [...(e.target.files ?? [])];
					e.target.value = '';
					if (fichiers.length) void deposer(fichiers);
				}}
			/>
		</div>
	);
}
