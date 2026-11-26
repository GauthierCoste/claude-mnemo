/**
 * Formulaire d'ajout ou de modification d'un serveur MCP de l'app Claude : nom, commande, arguments (un par ligne),
 * variables (`NOM=valeur`, une par ligne). En modification, les valeurs existantes ne sont jamais montrées (le service ne
 * les donne pas) : `NOM` seul garde la valeur actuelle, une ligne effacée retire la variable. Une saisie non enregistrée est
 * signalée par `surModifie` : l'onglet Réglages retient alors la sortie des Réglages, et ce formulaire propose de l'enregistrer,
 * de l'abandonner ou de rester (sauf quand les réglages ont aussi une saisie : l'onglet annonce alors les deux).
 */
import type { ServeurMcpEcriture, ServeurMcpVue } from '@mnemo/contrat';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useNavigation } from '../../../navigation.tsx';
import { demandeDe, SAISIE_VIDE, saisieDe, type SaisieServeur } from '../../../reglages/serveur-mcp.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import d from '../champs/Saisie.module.css';
import s from './AppClaude.module.css';

export function FormulaireServeur(p: {
	/** Absent : ajout. */
	serveur?: ServeurMcpVue;
	envoi: boolean;
	/** Rend le motif d'un refus, ou null une fois enregistré (le formulaire est alors fermé par son parent). */
	enregistrer(demande: ServeurMcpEcriture): Promise<string | null>;
	annuler(): void;
	surModifie?(modifie: boolean): void;
	/** Une autre saisie non enregistrée (les réglages) : la sortie retenue est alors annoncée par l'onglet, pour les deux. */
	autreBrouillon?: boolean;
}): ReactNode {
	const id = useId();
	const [depart] = useState<SaisieServeur>(() => (p.serveur ? saisieDe(p.serveur) : SAISIE_VIDE));
	const [saisie, setSaisie] = useState(depart);
	const [erreur, setErreur] = useState<string | null>(null);
	const modifie = JSON.stringify(saisie) !== JSON.stringify(depart);
	const modification = p.serveur !== undefined;
	const titre = modification ? `Modifier le serveur « ${p.serveur!.nom} »` : 'Ajouter un serveur MCP';

	const nav = useNavigation();
	const { surModifie } = p;
	useEffect(() => surModifie?.(modifie), [surModifie, modifie]);

	const changer = (champ: keyof SaisieServeur) => (e: { target: { value: string } }) => setSaisie((x) => ({ ...x, [champ]: e.target.value }));
	const enregistrer = async (): Promise<boolean> => {
		const lue = demandeDe(saisie, p.serveur?.env ?? []);
		if (!lue.ok) {
			setErreur(lue.motif);
			return false;
		}
		setErreur(null);
		const motif = await p.enregistrer(lue.demande);
		setErreur(motif);
		return motif === null;
	};
	const enregistrerPuisPartir = async () => {
		if (await enregistrer()) nav.poursuivreSortie();
		else nav.annulerSortie();
	};

	return (
		<form
			className={s.formulaire}
			aria-label={titre}
			onSubmit={(e) => {
				e.preventDefault();
				void enregistrer();
			}}
		>
			<h4 className={s.titreFormulaire}>{titre}</h4>
			<label className={s.champ}>
				<span className={d.libelle}>Nom</span>
				<input className={d.champTexte} spellCheck={false} autoComplete="off" value={saisie.nom} onChange={changer('nom')} />
			</label>
			<label className={s.champ}>
				<span className={d.libelle}>Commande</span>
				<input className={d.champTexte} spellCheck={false} autoComplete="off" placeholder="npx, uvx, chemin d’un exécutable…" value={saisie.commande} onChange={changer('commande')} />
			</label>
			<label className={s.champ}>
				<span className={d.libelle}>Arguments</span>
				<span className={d.discret}>Un par ligne.</span>
				<textarea className={d.texteLong} rows={3} spellCheck={false} value={saisie.args} onChange={changer('args')} />
			</label>
			<label className={s.champ}>
				<span className={d.libelle}>Variables</span>
				<span id={`${id}-variables`} className={d.discret}>
					{modification
						? 'NOM=valeur, une par ligne. Les valeurs enregistrées ne sont jamais montrées : NOM seul garde la valeur actuelle, une ligne effacée retire la variable.'
						: 'NOM=valeur, une par ligne.'}
				</span>
				<textarea className={d.texteLong} rows={3} spellCheck={false} autoComplete="off" aria-describedby={`${id}-variables`} value={saisie.env} onChange={changer('env')} />
			</label>
			{nav.sortieRetenue && modifie && !p.autreBrouillon && (
				<div className={d.avis} role="alert">
					<p>Serveur MCP non enregistré : l’enregistrer avant de quitter les Réglages ?</p>
					<div className={d.actions}>
						<Bouton genre="primaire" disabled={p.envoi} onClick={() => void enregistrerPuisPartir()}>
							Enregistrer
						</Bouton>
						<Bouton disabled={p.envoi} onClick={nav.poursuivreSortie}>
							Abandonner
						</Bouton>
						<Bouton disabled={p.envoi} onClick={nav.annulerSortie}>
							Rester
						</Bouton>
					</div>
				</div>
			)}
			{erreur !== null && (
				<p className={d.erreur} role="alert">
					{erreur}
				</p>
			)}
			<div className={d.actions}>
				<Bouton type="submit" petit genre="primaire" disabled={p.envoi || saisie.nom.trim() === '' || saisie.commande.trim() === ''}>
					{modification ? 'Enregistrer' : 'Ajouter'}
				</Bouton>
				<Bouton petit disabled={p.envoi} onClick={p.annuler}>
					Annuler
				</Bouton>
			</div>
		</form>
	);
}
