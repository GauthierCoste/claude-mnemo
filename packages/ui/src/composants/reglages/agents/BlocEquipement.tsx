/**
 * Équipement d'un agent, en inventaire : ses skills propres (toujours équipées), les skills de la mémoire (à équiper une à
 * une, ou toutes, y compris les futures), puis les plugins Claude Code (grisés avec un autre moteur ; un plugin retenu mais
 * plus installé reste à retirer). Une case = icône, nom, description, type. Le crayon ✎ d'une skill de l'agent ou de la
 * mémoire ouvre son éditeur ; les skills de plugin n'en ont pas. « + Nouvelle skill » en fin d'inventaire.
 */
import type { PluginInstalleVue, ProfilDetailVue, ProfilEditableVue, SkillVue } from '@mnemo/contrat';
import { useId, type ReactNode } from 'react';
import { basculer, basculerSkill, compterEquipement, retient } from '../../../reglages/equipement.ts';
import { Bascule } from '../../commun/Bascule.tsx';
import s from './Agents.module.css';
import { Bloc } from './Bloc.tsx';

const ICONE_SKILL = '✨';
const ICONE_PLUGIN = '🧩';

/** Une case d'inventaire, et son crayon s'il y en a un. */
function Case(p: {
	icone: string;
	nom: string;
	description: string;
	type: string;
	equipee: boolean;
	/** Pourquoi la case ne se coche pas (dit sous l'inventaire, relié par `aria-describedby`) ; absent : elle se coche. */
	raison?: { id: string; texte: string };
	surBascule(): void;
	surEditer?: () => void;
}): ReactNode {
	return (
		<li className={s.caseW}>
			<button
				type="button"
				role="checkbox"
				className={s.case}
				aria-checked={p.equipee}
				aria-label={p.nom}
				aria-disabled={p.raison !== undefined || undefined}
				aria-describedby={p.raison?.id}
				title={p.raison === undefined ? p.description : `${p.description}\n${p.raison.texte}`}
				onClick={() => p.raison === undefined && p.surBascule()}
			>
				<span className={s.ic} aria-hidden="true">
					{p.icone}
				</span>
				<span className={s.nomCase}>{p.nom}</span>
				<span className={s.desc}>{p.description}</span>
				<span className={s.type}>{p.type}</span>
			</button>
			{p.surEditer !== undefined && (
				<button type="button" className={s.crayon} aria-label={`Modifier la skill ${p.nom}`} title={`Modifier la skill ${p.nom}`} onClick={p.surEditer}>
					✎
				</button>
			)}
		</li>
	);
}

const descriptionPlugin = (x: PluginInstalleVue): string =>
	[`version ${x.version}, ${x.portee}`, x.skills.length > 0 ? `skills : ${x.skills.map((k) => k.nom).join(', ')}` : '', x.hooks ? 'a ses propres hooks' : ''].filter((t) => t !== '').join(' · ');

export function BlocEquipement(p: {
	editable: ProfilEditableVue;
	detail: ProfilDetailVue;
	surChange(m: Partial<ProfilEditableVue>): void;
	surEditerSkill(nom: string, profil: string | null): void;
	surNouvelleSkill(): void;
}): ReactNode {
	const e = p.editable;
	const d = p.detail;
	const id = useId();
	const { skills, plugins } = compterEquipement(e, d);
	const n = skills + plugins;
	const disponibles = d.skillsMemoireDisponibles.map((x) => x.nom);
	const ordrePlugins = d.pluginsInstalles.map((x) => x.id);
	const installes = new Set(ordrePlugins);
	const absents = e.plugins.filter((x) => !installes.has(x));
	const sansPlugins = e.moteur !== 'claude-code';
	const raisonPropre = { id: `${id}-propre`, texte: 'Skill propre à cet agent : toujours équipée.' };
	const raisonPlugins = { id: `${id}-plugins`, texte: 'Les plugins sont propres à Claude Code.' };
	const icone = (x: SkillVue) => x.icone ?? ICONE_SKILL;
	return (
		<Bloc titre="Équipement" sous={`skills et plugins : des savoir-faire chargés dans chaque session · ${n} équipé${n > 1 ? 's' : ''}`}>
			<div className={s.toutes}>
				<Bascule actif={e.skillsMemoire === 'tous'} surChangement={(actif) => p.surChange({ skillsMemoire: actif ? 'tous' : [...disponibles] })}>
					Toutes les skills de la mémoire, y compris les futures
				</Bascule>
			</div>
			<ul className={s.inventaire} aria-label="Inventaire">
				{d.skillsDuProfil.map((x) => (
					<Case
						key={`profil:${x.nom}`}
						icone={icone(x)}
						nom={x.nom}
						description={x.description}
						type="skill de l’agent"
						equipee
						raison={raisonPropre}
						surBascule={() => {}}
						{...(x.origine !== undefined ? { surEditer: () => p.surEditerSkill(x.nom, d.nom) } : {})}
					/>
				))}
				{d.skillsMemoireDisponibles.map((x) => (
					<Case
						key={`memoire:${x.nom}`}
						icone={icone(x)}
						nom={x.nom}
						description={x.description}
						type="skill"
						equipee={retient(e.skillsMemoire, x.nom)}
						surBascule={() => p.surChange({ skillsMemoire: basculerSkill(e.skillsMemoire, x.nom, !retient(e.skillsMemoire, x.nom), disponibles) })}
						{...(x.origine !== undefined ? { surEditer: () => p.surEditerSkill(x.nom, null) } : {})}
					/>
				))}
				{d.pluginsInstalles.map((x) => (
					<Case
						key={`plugin:${x.id}`}
						icone={ICONE_PLUGIN}
						nom={x.nom}
						description={descriptionPlugin(x)}
						type="plugin"
						equipee={!sansPlugins && e.plugins.includes(x.id)}
						{...(sansPlugins ? { raison: raisonPlugins } : {})}
						surBascule={() => p.surChange({ plugins: basculer(e.plugins, x.id, !e.plugins.includes(x.id), ordrePlugins) })}
					/>
				))}
				{!sansPlugins &&
					absents.map((x) => (
						<Case
							key={`absent:${x}`}
							icone={ICONE_PLUGIN}
							nom={x}
							description="non installé : décocher pour le retirer"
							type="plugin"
							equipee
							surBascule={() => p.surChange({ plugins: e.plugins.filter((y) => y !== x) })}
						/>
					))}
				<li className={s.caseW}>
					<button type="button" className={`${s.case} ${s.nouvelle}`} onClick={p.surNouvelleSkill}>
						<span className={s.ic} aria-hidden="true">
							＋
						</span>
						<span className={s.nomCase}>Nouvelle skill</span>
						<span className={s.desc}>un savoir-faire à toi</span>
					</button>
				</li>
			</ul>
			{d.skillsDuProfil.length > 0 && (
				<p id={raisonPropre.id} className={s.effet}>
					Les skills de l’agent sont toujours équipées.
				</p>
			)}
			{sansPlugins && d.pluginsInstalles.length > 0 && (
				<p id={raisonPlugins.id} className={s.effet}>
					{raisonPlugins.texte}
				</p>
			)}
			{d.skillsMemoireDisponibles.length === 0 && <p className={s.effet}>Aucune skill dans _mnemo/skills/.</p>}
		</Bloc>
	);
}
