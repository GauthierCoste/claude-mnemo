/**
 * Onglet App Claude de la vue Réglages : la configuration MCP de l'app Claude (Claude Desktop). Section « Mémoire Mnemo »
 * (brancher, débrancher, mettre à jour l'entrée de Mnemo) et section « Autres serveurs MCP » (ajouter, modifier, retirer).
 * Les valeurs des variables ne viennent jamais du service. Un changement ne vaut qu'au redémarrage de l'app Claude : chaque
 * écriture réussie le rappelle. App absente : seulement le dire ; fichier illisible : l'erreur et le chemin, rien d'autre
 * (le service refuse alors toute écriture).
 */
import { ROUTES, type ClaudeDesktopVue } from '@mnemo/contrat';
import { useState, type ReactNode } from 'react';
import { ErreurApi } from '../../../client/api.ts';
import { useClient } from '../../../client/contexte.tsx';
import { useClaudeDesktop } from '../../../client/hooks.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import d from '../profils/Profils.module.css';
import { ServeursMcp } from './ServeursMcp.tsx';
import s from './AppClaude.module.css';

/** Une écriture : rend le motif d'un refus, ou null quand elle a réussi (la vue rendue par le service est alors montrée). */
export type Ecrire = (appel: () => Promise<ClaudeDesktopVue>) => Promise<string | null>;

const ETATS: Record<ClaudeDesktopVue['mnemo'], { texte: string; bouton: string }> = {
	absent: { texte: 'La mémoire Mnemo n’est pas branchée sur l’app Claude.', bouton: 'Brancher la mémoire' },
	branche: { texte: 'La mémoire Mnemo est branchée sur l’app Claude.', bouton: 'Débrancher' },
	perime: {
		texte: 'La mémoire Mnemo est branchée, mais son entrée ne correspond plus à cette installation (autre Node, autre emplacement de Mnemo ou autre dossier).',
		bouton: 'Mettre à jour',
	},
};

/** `surModifie` : prévenu quand un formulaire de serveur a des modifications non enregistrées (changement d'onglet retenu). */
export function AppClaude(p: { surModifie?(modifie: boolean): void }): ReactNode {
	const { api } = useClient();
	const ressource = useClaudeDesktop();
	const [ecrite, setEcrite] = useState<ClaudeDesktopVue | null>(null);
	const [envoi, setEnvoi] = useState(false);
	const [fait, setFait] = useState(false);
	const vue = ecrite ?? ressource.donnees;

	const ecrire: Ecrire = async (appel) => {
		setEnvoi(true);
		setFait(false);
		try {
			setEcrite(await appel());
			setFait(true);
			// le cache suit : rouvert plus tard, l'onglet ne montre pas d'abord la configuration d'avant l'écriture
			ressource.recharger();
			return null;
		} catch (e) {
			return e instanceof ErreurApi ? e.message : 'Écriture impossible.';
		} finally {
			setEnvoi(false);
		}
	};

	if (vue === undefined) {
		return (
			<section className={d.droite} aria-label="App Claude">
				<p className={ressource.erreur === null ? d.discret : d.erreur} role={ressource.erreur === null ? undefined : 'alert'}>
					{ressource.erreur ?? 'Lecture de la configuration de l’app Claude…'}
				</p>
			</section>
		);
	}

	return (
		<section className={d.droite} aria-label="App Claude">
			<p className={d.discret}>
				Les serveurs MCP de l’app Claude (Claude Desktop) : la mémoire de ce dossier, et les autres.
				{vue.installee && vue.erreur === undefined && (
					<>
						{' '}
						Fichier : <code>{vue.fichier}</code>
					</>
				)}
			</p>
			{!vue.installee ? (
				<p className={d.avis} role="status">
					L’app Claude n’est pas installée sur ce poste.
				</p>
			) : vue.erreur !== undefined ? (
				<div className={s.illisible} role="alert">
					<p>{vue.erreur}</p>
					<p>
						Fichier : <code>{vue.fichier}</code>
					</p>
					<p className={d.discret}>Mnemo ne réécrit jamais un fichier qu’il ne sait pas lire : corrige-le, puis rouvre cet onglet.</p>
				</div>
			) : (
				<>
					{fait && (
						<p className={d.avis} role="status">
							Redémarre l’app Claude pour prendre ce changement en compte.
						</p>
					)}
					<MemoireMnemo
						etat={vue.mnemo}
						envoi={envoi}
						ecrire={ecrire}
						brancher={() => api.remplacer<ClaudeDesktopVue>(ROUTES.claudeDesktopMnemo, {})}
						debrancher={() => api.supprimer<ClaudeDesktopVue>(ROUTES.claudeDesktopMnemo)}
					/>
					<ServeursMcp serveurs={vue.serveurs} envoi={envoi} ecrire={ecrire} {...(p.surModifie ? { surModifie: p.surModifie } : {})} />
				</>
			)}
		</section>
	);
}

function MemoireMnemo(p: {
	etat: ClaudeDesktopVue['mnemo'];
	envoi: boolean;
	ecrire: Ecrire;
	brancher(): Promise<ClaudeDesktopVue>;
	debrancher(): Promise<ClaudeDesktopVue>;
}): ReactNode {
	const [erreur, setErreur] = useState<string | null>(null);
	const { texte, bouton } = ETATS[p.etat];
	const agir = async () => setErreur(await p.ecrire(p.etat === 'branche' ? p.debrancher : p.brancher));
	return (
		<section className={d.section} aria-labelledby="app-claude-mnemo">
			<h2 id="app-claude-mnemo" className={d.titreSection}>
				Mémoire Mnemo
			</h2>
			<div className={s.etat}>
				<p className={s.texteEtat}>
					<span className={s.pastille} data-etat={p.etat} aria-hidden="true" />
					{texte}
				</p>
				<Bouton petit genre={p.etat === 'branche' ? 'normal' : 'primaire'} disabled={p.envoi} onClick={() => void agir()}>
					{bouton}
				</Bouton>
				{/* entrée d'un autre Node, d'un autre emplacement ou d'un autre dossier : on peut aussi la retirer sans la réécrire */}
				{p.etat === 'perime' && (
					<Bouton petit disabled={p.envoi} onClick={() => void (async () => setErreur(await p.ecrire(p.debrancher)))()}>
						Débrancher
					</Bouton>
				)}
			</div>
			{erreur !== null && (
				<p className={d.erreur} role="alert">
					{erreur}
				</p>
			)}
		</section>
	);
}
