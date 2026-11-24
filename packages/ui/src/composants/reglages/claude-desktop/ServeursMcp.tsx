/**
 * Section « Autres serveurs MCP » de Réglages › App Claude : la liste (nom, commande et arguments en une ligne, noms des
 * variables), Modifier et Retirer (retrait confirmé dans la page), et le formulaire d'ajout ou de modification. Un serveur
 * décrit autrement que par une commande (`modifiable` faux) est en lecture seule : il peut seulement être retiré.
 */
import { ROUTES, type ClaudeDesktopVue, type ServeurMcpEcriture, type ServeurMcpVue } from '@mnemo/contrat';
import { useState, type ReactNode } from 'react';
import { useClient } from '../../../client/contexte.tsx';
import { avecId } from '../../../client/hooks.ts';
import { ligneDeCommande } from '../../../reglages/serveur-mcp.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import d from '../profils/Profils.module.css';
import type { Ecrire } from './AppClaude.tsx';
import { FormulaireServeur } from './FormulaireServeur.tsx';
import s from './AppClaude.module.css';

/** Formulaire ouvert : ajout, ou modification du serveur nommé. */
type Edition = { genre: 'ajout' } | { genre: 'modification'; serveur: ServeurMcpVue };

export function ServeursMcp(p: { serveurs: ServeurMcpVue[]; envoi: boolean; ecrire: Ecrire; surModifie?(modifie: boolean): void }): ReactNode {
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
		<section className={d.section} aria-labelledby="app-claude-serveurs">
			<h2 id="app-claude-serveurs" className={d.titreSection}>
				Autres serveurs MCP
			</h2>
			{p.serveurs.length === 0 ? (
				<p className={d.discret}>Aucun autre serveur MCP dans l’app Claude.</p>
			) : (
				<ul className={s.serveurs} aria-label="Serveurs MCP">
					{p.serveurs.map((x) => (
						<li key={x.nom} className={s.serveur} aria-label={x.nom}>
							<div className={s.enteteServeur}>
								<span className={s.nomServeur}>{x.nom}</span>
								{!x.modifiable && <span className={s.lectureSeule}>lecture seule</span>}
								<span className={d.actions}>
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
							</div>
							{x.commande !== '' && <code className={s.commande}>{ligneDeCommande(x)}</code>}
							{x.env.length > 0 && <p className={d.discret}>Variables : {x.env.join(', ')}</p>}
							{!x.modifiable && <p className={d.discret}>Décrit autrement que par une commande : Mnemo ne le modifie pas, il peut seulement le retirer.</p>}
							{aRetirer === x.nom && (
								<div className={d.avis} role="alert">
									<p>Retirer le serveur « {x.nom} » de l’app Claude ? Sa configuration (variables comprises) est effacée du fichier.</p>
									<div className={d.actions}>
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
				<p className={d.erreur} role="alert">
					{erreur}
				</p>
			)}
			{edition === null ? (
				<div className={d.actions}>
					<Bouton petit disabled={p.envoi} onClick={() => ouvrir({ genre: 'ajout' })}>
						Ajouter un serveur…
					</Bouton>
				</div>
			) : (
				<FormulaireServeur
					key={edition.genre === 'modification' ? `modifier:${edition.serveur.nom}` : 'ajout'}
					{...(edition.genre === 'modification' ? { serveur: edition.serveur } : {})}
					envoi={p.envoi}
					enregistrer={enregistrer}
					annuler={fermer}
					{...(p.surModifie ? { surModifie: p.surModifie } : {})}
				/>
			)}
		</section>
	);
}
