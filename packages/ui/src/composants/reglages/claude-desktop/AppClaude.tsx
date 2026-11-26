/**
 * Réglages › Branchements, groupe « App Claude » : la configuration MCP de l'app Claude (Claude Desktop). Une ligne
 * « Mémoire Mnemo » (un interrupteur pour la brancher ou la débrancher ; entrée périmée : la mettre à jour ou la retirer),
 * puis une ligne par autre serveur MCP (modifier, retirer) et « + Ajouter un serveur ». Les valeurs des variables ne viennent
 * jamais du service. Un changement ne vaut qu'au redémarrage de l'app Claude : chaque écriture réussie le rappelle. App
 * absente : seulement le dire ; fichier illisible : l'erreur et le chemin, rien d'autre (le service refuse alors toute écriture).
 */
import { ROUTES, type ClaudeDesktopVue } from '@mnemo/contrat';
import { useState, type ReactNode } from 'react';
import { ErreurApi } from '../../../client/api.ts';
import { useClient } from '../../../client/contexte.tsx';
import { useClaudeDesktop } from '../../../client/hooks.ts';
import { Bascule } from '../../commun/Bascule.tsx';
import { Bouton } from '../../commun/Bouton.tsx';
import c from '../Cartes.module.css';
import { ServeursMcp } from './ServeursMcp.tsx';
import s from './AppClaude.module.css';

/** Une écriture : rend le motif d'un refus, ou null quand elle a réussi (la vue rendue par le service est alors montrée). */
export type Ecrire = (appel: () => Promise<ClaudeDesktopVue>) => Promise<string | null>;

const ETATS: Record<ClaudeDesktopVue['mnemo'], string> = {
	absent: 'Pas branchée : l’app Claude ne voit pas la mémoire.',
	branche: 'Claude lit et écrit la mémoire.',
	perime: 'Son entrée ne correspond plus à cette installation (autre Node, autre emplacement de Mnemo ou autre dossier).',
};

/**
 * `surModifie` : prévenu quand un formulaire de serveur a des modifications non enregistrées (changement d'onglet ou sortie
 * retenus) ; `autreBrouillon` : les réglages en ont aussi, la sortie retenue est alors annoncée par l'onglet.
 */
export function AppClaude(p: { surModifie?(modifie: boolean): void; autreBrouillon?: boolean }): ReactNode {
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
			// le cache suit : rouvert plus tard, le groupe ne montre pas d'abord la configuration d'avant l'écriture
			ressource.recharger();
			return null;
		} catch (e) {
			return e instanceof ErreurApi ? e.message : 'Écriture impossible.';
		} finally {
			setEnvoi(false);
		}
	};

	return (
		<section className={c.groupe} aria-labelledby="titre-app-claude">
			<h3 id="titre-app-claude" className={c.titreGroupe}>
				App Claude
			</h3>
			{vue === undefined ? (
				<p className={ressource.erreur === null ? c.discret : c.erreur} role={ressource.erreur === null ? undefined : 'alert'}>
					{ressource.erreur ?? 'Lecture de la configuration de l’app Claude…'}
				</p>
			) : !vue.installee ? (
				<p className={c.discret} role="status">
					L’app Claude n’est pas installée sur ce poste.
				</p>
			) : vue.erreur !== undefined ? (
				<div className={s.illisible} role="alert">
					<p>{vue.erreur}</p>
					<p>
						Fichier : <code>{vue.fichier}</code>
					</p>
					<p className={c.discret}>Mnemo ne réécrit jamais un fichier qu’il ne sait pas lire : à corriger, puis rouvrir les Réglages.</p>
				</div>
			) : (
				<>
					{fait && (
						<p className={c.avis} role="status">
							Redémarrer l’app Claude pour prendre ce changement en compte.
						</p>
					)}
					<MemoireMnemo
						etat={vue.mnemo}
						envoi={envoi}
						ecrire={ecrire}
						brancher={() => api.remplacer<ClaudeDesktopVue>(ROUTES.claudeDesktopMnemo, {})}
						debrancher={() => api.supprimer<ClaudeDesktopVue>(ROUTES.claudeDesktopMnemo)}
					/>
					<ServeursMcp serveurs={vue.serveurs} envoi={envoi} ecrire={ecrire} {...(p.surModifie ? { surModifie: p.surModifie } : {})} autreBrouillon={p.autreBrouillon ?? false} />
					<p className={`${c.discret} ${s.fichier}`}>
						Fichier : <code>{vue.fichier}</code>
					</p>
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
	const agir = async (appel: () => Promise<ClaudeDesktopVue>) => setErreur(await p.ecrire(appel));
	return (
		<ul className={c.lignes} aria-label="Mémoire Mnemo dans l’app Claude">
			<li className={c.prise} aria-label="Mémoire Mnemo">
				<span className={`${c.logo} ${s.mnemo}`} aria-hidden="true">
					◆
				</span>
				<span className={c.ident}>
					<span className={c.nom}>Mémoire Mnemo</span>
					<span className={c.detailLigne}>{ETATS[p.etat]}</span>
				</span>
				<span className={c.droite}>
					{p.etat === 'perime' ? (
						<>
							<Bouton petit genre="primaire" disabled={p.envoi} onClick={() => void agir(p.brancher)}>
								Mettre à jour
							</Bouton>
							{/* entrée d'un autre Node, d'un autre emplacement ou d'un autre dossier : on peut aussi la retirer sans la réécrire */}
							<Bouton petit disabled={p.envoi} onClick={() => void agir(p.debrancher)}>
								Débrancher
							</Bouton>
						</>
					) : (
						<Bascule actif={p.etat === 'branche'} disabled={p.envoi} surChangement={(oui) => void agir(oui ? p.brancher : p.debrancher)}>
							<span className={c.horsEcran}>Mémoire Mnemo branchée</span>
						</Bascule>
					)}
				</span>
				{erreur !== null && (
					<p className={`${c.sousLigne} ${c.erreur}`} role="alert">
						{erreur}
					</p>
				)}
			</li>
		</ul>
	);
}
