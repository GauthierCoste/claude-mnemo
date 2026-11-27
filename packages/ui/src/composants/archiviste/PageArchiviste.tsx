/**
 * Mémoire › Archiviste : une seule page pour enrichir la mémoire et arbitrer. Trois colonnes, chacune défilant seule
 * (empilées en fenêtre étroite) :
 * - « À faire » : à arbitrer (propositions du fil, lots d'informations de l'archiviste), à traiter (sources marquées `a_traiter`), chacun avec ses actions sur
 *   place ; groupes vides masqués, « Rien à faire. » sinon. Le service n'expose pas de contradictions : pas de groupe ;
 * - le terminal de l'archiviste (le même flux que le tiroir, un seul affichage à la fois : voir `CentreArchiviste`) et les
 *   suggestions ; sans archiviste, « Lancer l'archiviste » ou « Reprendre » ;
 * - « Enrichir » : déposer des fichiers, importer la mémoire de Claude Code, documents récents, puis « Appris aujourd'hui ».
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useAujourdhui, useDocuments, useFil, useSessions } from '../../client/hooks.ts';
import type { AFaire } from '../../memoire/a-faire.ts';
import { useTextes } from '../../langue/langue.tsx';
import { useNavigation } from '../../navigation.tsx';
import { Bouton } from '../commun/Bouton.tsx';
import { Separateur } from '../commun/Separateur.tsx';
import { largeurMaxPanneau, useTailleGardee } from '../commun/taille-gardee.ts';
import { ApprisAujourdhui } from './ApprisAujourdhui.tsx';
import { archivisteVivant, CentreArchiviste, Suggestions, terminalDansLaPage } from './CentreArchiviste.tsx';
import { DocumentsRecents } from './DocumentsRecents.tsx';
import { ImporterMemoireClaude } from './ImporterMemoireClaude.tsx';
import s from './PageArchiviste.module.css';
import { Propositions } from './Propositions.tsx';
import { SourcesATraiter } from './SourcesATraiter.tsx';
import { ZoneDepot } from './ZoneDepot.tsx';

/** Largeurs des colonnes latérales, réglées par leur séparateur et gardées dans ce navigateur. */
const LARGEUR_A_FAIRE = { cle: 'mnemo.archiviste.largeurAFaire', defaut: 340, min: 220 };
const LARGEUR_ENRICHIR = { cle: 'mnemo.archiviste.largeurEnrichir', defaut: 380, min: 240 };

export function PageArchiviste(p: { visible: boolean; aFaire: AFaire }): ReactNode {
	const t = useTextes().archiviste.page;
	const nav = useNavigation();
	const largeurMax = largeurMaxPanneau(LARGEUR_ENRICHIR.min);
	const largeurAFaire = useTailleGardee(LARGEUR_A_FAIRE, largeurMax);
	const largeurEnrichir = useTailleGardee(LARGEUR_ENRICHIR, largeurMax);
	const archiviste = archivisteVivant(useSessions());
	const fil = useFil(useAujourdhui());
	// « Tout voir » sous une des deux listes : une seule lecture, entière, pour les deux
	const [tout, setTout] = useState(false);
	const documents = useDocuments(tout);
	const toutVoir = () => setTout(true);
	// liste et total d'une même réponse : celle de `tout` une fois arrivée, sinon celle d'« À faire »
	const entiere = tout ? documents.donnees : undefined;
	const aTraiter = entiere?.aTraiter ?? p.aFaire.aTraiter;
	const totalATraiter = entiere?.totalATraiter ?? p.aFaire.totalATraiter;
	const ici = p.visible && terminalDansLaPage(nav);
	return (
		<div className={s.page} style={{ '--l-a-faire': `${largeurAFaire.valeur}px`, '--l-enrichir': `${largeurEnrichir.valeur}px` } as CSSProperties}>
			<section className={s.colonne} aria-labelledby="titre-a-faire">
				<h2 id="titre-a-faire" className={s.titre}>
					{t.aFaire}
				</h2>
				{p.aFaire.avertissements.map((a) => (
					<p key={a} role="note" className={s.avertissement}>
						{a}
					</p>
				))}
				{p.aFaire.total === 0 && p.aFaire.avertissements.length === 0 ? (
					<p className={s.vide}>{t.rienAFaire}</p>
				) : (
					<div className={s.groupes}>
						<Propositions propositions={p.aFaire.propositions} lots={p.aFaire.lots} rechargerLots={p.aFaire.rechargerLots} fil={fil.donnees} />
						<SourcesATraiter documents={aTraiter} total={totalATraiter} surToutVoir={toutVoir} dossiers={p.aFaire.dossiers} />
					</div>
				)}
			</section>
			<Separateur
				bord
				className={s.poignee}
				orientation="vertical"
				label={t.largeurAFaire}
				valeur={largeurAFaire.valeur}
				min={LARGEUR_A_FAIRE.min}
				max={largeurMax}
				sens={1}
				surChanger={largeurAFaire.regler}
				surDefaut={largeurAFaire.reinitialiser}
			/>
			<section className={s.centre} aria-label={t.terminal}>
				<CentreArchiviste
					archiviste={archiviste}
					monter={ici}
					actif={ici}
					compact={false}
					ailleurs={
						<div className={s.ailleurs}>
							<p>{t.terminalAilleurs}</p>
							<Bouton petit onClick={() => nav.ouvrirTiroir(false)}>
								{t.afficherIci}
							</Bouton>
						</div>
					}
				/>
				<Suggestions archiviste={archiviste} />
			</section>
			<Separateur
				bord
				className={s.poignee}
				orientation="vertical"
				label={t.largeurEnrichir}
				valeur={largeurEnrichir.valeur}
				min={LARGEUR_ENRICHIR.min}
				max={largeurMax}
				// la poignée est à gauche de la colonne : aller vers la gauche l'élargit
				sens={-1}
				surChanger={largeurEnrichir.regler}
				surDefaut={largeurEnrichir.reinitialiser}
			/>
			<section className={s.colonne} aria-labelledby="titre-enrichir">
				<h2 id="titre-enrichir" className={s.titre}>
					{t.enrichir}
				</h2>
				<div className={s.groupes}>
					<ZoneDepot />
					<ImporterMemoireClaude />
					<DocumentsRecents documents={documents.donnees?.documents} total={documents.donnees?.totalDocuments ?? null} erreur={documents.erreur} surToutVoir={toutVoir} />
					<ApprisAujourdhui />
				</div>
			</section>
		</div>
	);
}
