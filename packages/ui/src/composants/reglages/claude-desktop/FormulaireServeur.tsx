/**
 * Formulaire d'ajout ou de modification d'un serveur MCP de l'app Claude : nom, commande, arguments (un par ligne),
 * variables (`NOM=valeur`, une par ligne). En modification, les valeurs existantes ne sont jamais montrées (le service ne
 * les donne pas) : `NOM` seul garde la valeur actuelle, une ligne effacée retire la variable. Quitter les Réglages avec une
 * saisie non enregistrée est retenu : un avertissement propose de l'enregistrer, de l'abandonner ou de rester.
 */
import type { ServeurMcpEcriture, ServeurMcpVue } from '@mnemo/contrat';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useNavigation } from '../../../navigation.tsx';
import { demandeDe, SAISIE_VIDE, saisieDe, type SaisieServeur } from '../../../reglages/serveur-mcp.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import d from '../profils/Profils.module.css';
import s from './AppClaude.module.css';

export function FormulaireServeur(p: {
	/** Absent : ajout. */
	serveur?: ServeurMcpVue;
	envoi: boolean;
	/** Rend le motif d'un refus, ou null une fois enregistré (le formulaire est alors fermé par son parent). */
	enregistrer(demande: ServeurMcpEcriture): Promise<string | null>;
	annuler(): void;
	surModifie?(modifie: boolean): void;
}): ReactNode {
	const id = useId();
	const [depart] = useState<SaisieServeur>(() => (p.serveur ? saisieDe(p.serveur) : SAISIE_VIDE));
	const [saisie, setSaisie] = useState(depart);
	const [erreur, setErreur] = useState<string | null>(null);
	const modifie = JSON.stringify(saisie) !== JSON.stringify(depart);
	const modification = p.serveur !== undefined;
	const titre = modification ? `Modifier le serveur « ${p.serveur!.nom} »` : 'Ajouter un serveur MCP';

	const nav = useNavigation();
	const modifieCourant = useRef(modifie);
	modifieCourant.current = modifie;
	const { surModifie } = p;
	useEffect(() => surModifie?.(modifie), [surModifie, modifie]);
	const { definirGardeSortie } = nav;
	useEffect(() => {
		definirGardeSortie(() => modifieCourant.current);
		return () => definirGardeSortie(null);
	}, [definirGardeSortie]);

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
			<h3 className={s.titreFormulaire}>{titre}</h3>
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
				<textarea className={d.consigne} rows={3} spellCheck={false} value={saisie.args} onChange={changer('args')} />
			</label>
			<label className={s.champ}>
				<span className={d.libelle}>Variables</span>
				<span id={`${id}-variables`} className={d.discret}>
					{modification
						? 'NOM=valeur, une par ligne. Les valeurs enregistrées ne sont jamais montrées : NOM seul garde la valeur actuelle, une ligne effacée retire la variable.'
						: 'NOM=valeur, une par ligne.'}
				</span>
				<textarea className={d.consigne} rows={3} spellCheck={false} autoComplete="off" aria-describedby={`${id}-variables`} value={saisie.env} onChange={changer('env')} />
			</label>
			{nav.sortieRetenue && (
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
