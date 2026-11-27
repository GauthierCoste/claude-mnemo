/**
 * Formulaire d'ajout ou de modification d'un serveur MCP de l'app Claude : nom, commande, arguments (un par ligne),
 * variables (`NOM=valeur`, une par ligne). En modification, les valeurs existantes ne sont jamais montrées (le service ne
 * les donne pas) : `NOM` seul garde la valeur actuelle, une ligne effacée retire la variable. Une saisie non enregistrée est
 * signalée par `surModifie` : l'onglet Réglages retient alors la sortie des Réglages, et ce formulaire propose de l'enregistrer,
 * de l'abandonner ou de rester (sauf quand les réglages ont aussi une saisie : l'onglet annonce alors les deux).
 */
import type { ServeurMcpEcriture, ServeurMcpVue } from '@mnemo/contrat';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useLangue } from '../../../langue/langue.tsx';
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
	const { t } = useLangue();
	const f = t.reglages.appClaude.formulaire;
	const [depart] = useState<SaisieServeur>(() => (p.serveur ? saisieDe(p.serveur) : SAISIE_VIDE));
	const [saisie, setSaisie] = useState(depart);
	const [erreur, setErreur] = useState<string | null>(null);
	const modifie = JSON.stringify(saisie) !== JSON.stringify(depart);
	const modification = p.serveur !== undefined;
	const titre = modification ? f.modifier(p.serveur!.nom) : f.ajouter;

	const nav = useNavigation();
	const { surModifie } = p;
	useEffect(() => surModifie?.(modifie), [surModifie, modifie]);

	const changer = (champ: keyof SaisieServeur) => (e: { target: { value: string } }) => setSaisie((x) => ({ ...x, [champ]: e.target.value }));
	const enregistrer = async (): Promise<boolean> => {
		const lue = demandeDe(saisie, p.serveur?.env ?? [], t);
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
				<span className={d.libelle}>{f.nom}</span>
				<input className={d.champTexte} spellCheck={false} autoComplete="off" value={saisie.nom} onChange={changer('nom')} />
			</label>
			<label className={s.champ}>
				<span className={d.libelle}>{f.commande}</span>
				<input className={d.champTexte} spellCheck={false} autoComplete="off" placeholder={f.exempleCommande} value={saisie.commande} onChange={changer('commande')} />
			</label>
			<label className={s.champ}>
				<span className={d.libelle}>{f.arguments}</span>
				<span className={d.discret}>{f.unParLigne}</span>
				<textarea className={d.texteLong} rows={3} spellCheck={false} value={saisie.args} onChange={changer('args')} />
			</label>
			<label className={s.champ}>
				<span className={d.libelle}>{f.variables}</span>
				<span id={`${id}-variables`} className={d.discret}>
					{modification ? f.aideVariablesModification : f.aideVariables}
				</span>
				<textarea className={d.texteLong} rows={3} spellCheck={false} autoComplete="off" aria-describedby={`${id}-variables`} value={saisie.env} onChange={changer('env')} />
			</label>
			{nav.sortieRetenue && modifie && !p.autreBrouillon && (
				<div className={d.avis} role="alert">
					<p>{f.sortie}</p>
					<div className={d.actions}>
						<Bouton genre="primaire" disabled={p.envoi} onClick={() => void enregistrerPuisPartir()}>
							{t.commun.actions.enregistrer}
						</Bouton>
						<Bouton disabled={p.envoi} onClick={nav.poursuivreSortie}>
							{t.reglages.gestes.abandonner}
						</Bouton>
						<Bouton disabled={p.envoi} onClick={nav.annulerSortie}>
							{t.reglages.gestes.rester}
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
					{modification ? t.commun.actions.enregistrer : f.ajouterBouton}
				</Bouton>
				<Bouton petit disabled={p.envoi} onClick={p.annuler}>
					{t.commun.actions.annuler}
				</Bouton>
			</div>
		</form>
	);
}
