/**
 * Bouton « Importer la mémoire de Claude Code » de Mémoire › Archiviste (colonne « Enrichir ») : un appel à `amorce` (notes de Claude Code, CLAUDE.md
 * global et des projets), état « Import en cours… » pendant l'appel, puis bilan court en toast et détail dépliable ;
 * une erreur est dite en clair. Rien n'est lancé tout seul.
 */
import { useState, type ReactNode } from 'react';
import { ROUTES, type BilanAmorceVue } from '@mnemo/contrat';
import { useClient } from '../../client/contexte.tsx';
import { lignesAmorce, resumeAmorce } from '../../memoire/amorce.ts';
import { Bouton } from '../commun/Bouton.tsx';
import { useToast } from '../Toast.tsx';
import s from './ImporterMemoireClaude.module.css';

export function ImporterMemoireClaude(): ReactNode {
	const { api } = useClient();
	const toast = useToast();
	const [enCours, setEnCours] = useState(false);
	const [bilan, setBilan] = useState<BilanAmorceVue | null>(null);
	const [erreur, setErreur] = useState<string | null>(null);

	async function importer(): Promise<void> {
		setEnCours(true);
		setErreur(null);
		try {
			const b = await api.envoyer<BilanAmorceVue>(ROUTES.amorce, {});
			setBilan(b);
			toast(resumeAmorce(b));
		} catch (e) {
			const message = e instanceof Error ? e.message : 'erreur inconnue';
			setErreur(message);
			toast(`Import impossible : ${message}`);
		} finally {
			setEnCours(false);
		}
	}

	return (
		<div className={s.import}>
			<Bouton petit onClick={() => void importer()} disabled={enCours}>
				{enCours ? 'Import en cours…' : 'Importer la mémoire de Claude Code'}
			</Bouton>
			{erreur !== null && (
				<span role="alert" className={s.erreur}>
					Import impossible : {erreur}
				</span>
			)}
			{bilan !== null && erreur === null && (
				<details className={s.bilan}>
					<summary>Bilan de l’import</summary>
					<div className={s.detail}>
						<ul>
							{lignesAmorce(bilan).map((l) => (
								<li key={l}>{l}</li>
							))}
						</ul>
						{bilan.ignores.length > 0 && (
							<>
								<p className={s.sousTitre}>Fichiers ignorés ({bilan.ignores.length})</p>
								<ul className={s.ignores}>
									{bilan.ignores.map((i) => (
										<li key={i.chemin}>
											{i.chemin} — {i.raison}
										</li>
									))}
								</ul>
							</>
						)}
					</div>
				</details>
			)}
		</div>
	);
}
