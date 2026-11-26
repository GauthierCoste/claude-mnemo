/**
 * Les autres serveurs MCP de l'app Claude (Réglages › Branchements › App Claude) : une ligne chacun (initiale, nom, commande
 * et arguments en une ligne, noms des variables), Modifier et Retirer (retrait confirmé sous la ligne), puis le formulaire
 * d'ajout ou de modification. Un serveur décrit autrement que par une commande (`modifiable` faux) est en lecture seule :
 * il peut seulement être retiré.
 */
import { ROUTES, type ClaudeDesktopVue, type ServeurMcpEcriture, type ServeurMcpVue } from '@mnemo/contrat';
import { useState, type ReactNode } from 'react';
import { useClient } from '../../../client/contexte.tsx';
import { avecId } from '../../../client/hooks.ts';
import { ligneDeCommande } from '../../../reglages/serveur-mcp.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import c from '../Cartes.module.css';
import type { Ecrire } from './AppClaude.tsx';
import { FormulaireServeur } from './FormulaireServeur.tsx';
import s from './AppClaude.module.css';

/** Formulaire ouvert : ajout, ou modification du serveur nommé. */
type Edition = { genre: 'ajout' } | { genre: 'modification'; serveur: ServeurMcpVue };

/** Ce que la ligne dit d'un serveur, sous son nom ; `complet` : l'infobulle, qui dit aussi pourquoi un serveur est en lecture seule. */
function detailDe(x: ServeurMcpVue, complet = false): string {
	if (!x.modifiable) return `${x.commande === '' ? '' : `${x.commande} · `}lecture seule${complet ? ' : décrit autrement que par une commande, Mnemo ne le modifie pas, il peut seulement le retirer' : ''}`;
	return `${ligneDeCommande(x)}${x.env.length > 0 ? ` · variables : ${x.env.join(', ')}` : ''}`;
}

export function ServeursMcp(p: { serveurs: ServeurMcpVue[]; envoi: boolean; ecrire: Ecrire; surModifie?(modifie: boolean): void; autreBrouillon?: boolean }): ReactNode {
	const { api } = useClient();
	const [edition, setEdition] = useState<Edition | null>(null);
	const [aRetirer, setARetirer] = useState<string | null>(null);
	const [erreur, setErreur] = useState<string | null>(null);

	const fermer = () => {
		setEdition(null);
		p.surModifie?.(false);
	};
	const ouvrir = (e: Edition) => {
		setErreur(null);
		setARetirer(null);
		setEdition(e);
	};
	const demanderRetrait = (nom: string) => {
		setErreur(null);
		setARetirer(nom);
	};
	const retirer = async (nom: string) => {
		const motif = await p.ecrire(() => api.supprimer<ClaudeDesktopVue>(avecId(ROUTES.claudeDesktopServeur, nom)));
		setErreur(motif);
		if (motif === null) setARetirer(null);
	};
	const enregistrer = async (demande: ServeurMcpEcriture): Promise<string | null> => {
		const ecrit =
			edition?.genre === 'modification'
				? () => api.remplacer<ClaudeDesktopVue>(avecId(ROUTES.claudeDesktopServeur, edition.serveur.nom), demande)
				: () => api.envoyer<ClaudeDesktopVue>(ROUTES.claudeDesktopServeurs, demande);
		const motif = await p.ecrire(ecrit);
		if (motif === null) fermer();
		return motif;
	};

	return (
		<>
			{p.serveurs.length > 0 && (
				<ul className={`${c.lignes} ${s.serveurs}`} aria-label="Serveurs MCP">
					{p.serveurs.map((x) => (
						<li key={x.nom} className={c.prise} aria-label={x.nom}>
							<span className={c.logo} aria-hidden="true">
								{x.nom.charAt(0).toLocaleUpperCase('fr')}
							</span>
							<span className={c.ident}>
								<span className={c.nom}>{x.nom}</span>
								<code className={s.commande} title={detailDe(x, true)}>
									{detailDe(x)}
								</code>
							</span>
							<span className={c.droite}>
								{x.modifiable && (
									<Bouton petit disabled={p.envoi || edition !== null} onClick={() => ouvrir({ genre: 'modification', serveur: x })}>
										Modifier
									</Bouton>
								)}
								{aRetirer !== x.nom && (
									<Bouton petit disabled={p.envoi || edition !== null} onClick={() => demanderRetrait(x.nom)}>
										Retirer…
									</Bouton>
								)}
							</span>
							{aRetirer === x.nom && (
								<div className={`${c.sousLigne} ${c.avis}`} role="alert">
									<p>Retirer le serveur « {x.nom} » de l’app Claude ? Sa configuration (variables comprises) est effacée du fichier.</p>
									<div className={c.actions}>
										<Bouton petit disabled={p.envoi} onClick={() => void retirer(x.nom)}>
											Retirer
										</Bouton>
										<Bouton petit genre="primaire" disabled={p.envoi} onClick={() => setARetirer(null)}>
											Garder
										</Bouton>
									</div>
								</div>
							)}
						</li>
					))}
				</ul>
			)}
			{erreur !== null && (
				<p className={c.erreur} role="alert">
					{erreur}
				</p>
			)}
			{edition === null ? (
				<p className={s.ajouter}>
					<Bouton petit disabled={p.envoi} onClick={() => ouvrir({ genre: 'ajout' })}>
						+ Ajouter un serveur
					</Bouton>
				</p>
			) : (
				<FormulaireServeur
					key={edition.genre === 'modification' ? `modifier:${edition.serveur.nom}` : 'ajout'}
					{...(edition.genre === 'modification' ? { serveur: edition.serveur } : {})}
					envoi={p.envoi}
					enregistrer={enregistrer}
					annuler={fermer}
					{...(p.surModifie ? { surModifie: p.surModifie } : {})}
					autreBrouillon={p.autreBrouillon ?? false}
				/>
			)}
		</>
	);
}
