/**
 * Équipement d'un agent, en inventaire : ses skills propres (toujours équipées), les skills de la mémoire (à équiper une à
 * une, ou toutes, y compris les futures), puis les plugins Claude Code (grisés avec un autre moteur ; un plugin retenu mais
 * plus installé reste à retirer). Une case = icône, nom, description, type. Le crayon ✎ d'une skill de l'agent ou de la
 * mémoire ouvre son éditeur ; les skills de plugin n'en ont pas. « + Nouvelle skill » en fin d'inventaire. Après une écriture
 * de skill, le focus va sur sa case dès qu'elle est relue (sur l'inventaire si elle n'existe plus).
 */
import type { PluginInstalleVue, ProfilDetailVue, ProfilEditableVue, SkillVue } from '@mnemo/contrat';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTextes } from '../../../langue/langue.tsx';
import type { Textes } from '../../../langue/textes.ts';
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
	const id = useId();
	const t = useTextes().agents.equipement;
	return (
		<li className={s.caseW}>
			<button
				type="button"
				role="checkbox"
				className={s.case}
				aria-checked={p.equipee}
				aria-label={p.nom}
				aria-disabled={p.raison !== undefined || undefined}
				aria-describedby={[`${id}-desc`, `${id}-type`, p.raison?.id].filter((x) => x !== undefined).join(' ')}
				title={p.description}
				onClick={() => p.raison === undefined && p.surBascule()}
			>
				<span className={s.ic} aria-hidden="true">
					{p.icone}
				</span>
				<span className={s.nomCase}>{p.nom}</span>
				<span id={`${id}-desc`} className={s.desc}>
					{p.description}
				</span>
				<span id={`${id}-type`} className={s.type}>
					{p.type}
				</span>
			</button>
			{p.surEditer !== undefined && (
				<button type="button" className={s.crayon} aria-label={t.modifierSkill(p.nom)} title={t.modifierSkill(p.nom)} onClick={p.surEditer}>
					✎
				</button>
			)}
		</li>
	);
}

const descriptionPlugin = (x: PluginInstalleVue, t: Textes['agents']['equipement']): string =>
	[t.pluginVersion(x.version, x.portee), x.skills.length > 0 ? t.pluginSkills(x.skills.map((k) => k.nom).join(', ')) : '', x.hooks ? t.pluginHooks : ''].filter((x) => x !== '').join(' · ');

export function BlocEquipement(p: {
	editable: ProfilEditableVue;
	detail: ProfilDetailVue;
	surChange(m: Partial<ProfilEditableVue>): void;
	surEditerSkill(nom: string, profil: string | null): void;
	surNouvelleSkill(): void;
	/** Après une écriture de skill : la case à focaliser (`nom` null : l'inventaire). */
	focus: { nom: string | null } | null;
	surFocusFait(): void;
}): ReactNode {
	const e = p.editable;
	const d = p.detail;
	const id = useId();
	const t = useTextes().agents.equipement;
	const inventaire = useRef<HTMLUListElement>(null);
	const { focus, surFocusFait } = p;
	useEffect(() => {
		const liste = inventaire.current;
		if (focus === null || liste === null) return;
		const cible = focus.nom === null ? liste : [...liste.querySelectorAll<HTMLElement>('[role="checkbox"]')].find((x) => x.getAttribute('aria-label') === focus.nom);
		// la skill écrite n'est pas encore relue : sa case viendra avec le détail suivant
		if (cible === undefined) return;
		cible.focus();
		surFocusFait();
	}, [focus, d, surFocusFait]);
	const { skills, plugins } = compterEquipement(e, d);
	const n = skills + plugins;
	const disponibles = d.skillsMemoireDisponibles.map((x) => x.nom);
	const ordrePlugins = d.pluginsInstalles.map((x) => x.id);
	const installes = new Set(ordrePlugins);
	const absents = e.plugins.filter((x) => !installes.has(x));
	const sansPlugins = e.moteur !== 'claude-code';
	const raisonPropre = { id: `${id}-propre`, texte: t.raisonPropre };
	const raisonPlugins = { id: `${id}-plugins`, texte: t.raisonPlugins };
	const icone = (x: SkillVue) => x.icone ?? ICONE_SKILL;
	return (
		<Bloc titre={t.titre} sous={t.sous(n)}>
			<div className={s.toutes}>
				<Bascule actif={e.skillsMemoire === 'tous'} surChangement={(actif) => p.surChange({ skillsMemoire: actif ? 'tous' : [...disponibles] })}>
					{t.toutes}
				</Bascule>
			</div>
			<ul ref={inventaire} className={s.inventaire} aria-label={t.inventaire} tabIndex={-1}>
				{d.skillsDuProfil.map((x) => (
					<Case
						key={`profil:${x.nom}`}
						icone={icone(x)}
						nom={x.nom}
						description={x.description}
						type={t.typeSkillAgent}
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
						type={t.typeSkill}
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
						description={descriptionPlugin(x, t)}
						type={t.typePlugin}
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
							description={t.nonInstalle}
							type={t.typePlugin}
							equipee
							surBascule={() => p.surChange({ plugins: e.plugins.filter((y) => y !== x) })}
						/>
					))}
				<li className={s.caseW}>
					<button type="button" className={`${s.case} ${s.nouvelle}`} onClick={p.surNouvelleSkill}>
						<span className={s.ic} aria-hidden="true">
							＋
						</span>
						<span className={s.nomCase}>{t.nouvelleSkill}</span>
						<span className={s.desc}>{t.nouvelleSkillDesc}</span>
					</button>
				</li>
			</ul>
			{d.skillsDuProfil.length > 0 && (
				<p id={raisonPropre.id} className={s.effet}>
					{t.skillsAgentEquipees}
				</p>
			)}
			{sansPlugins && d.pluginsInstalles.length > 0 && (
				<p id={raisonPlugins.id} className={s.effet}>
					{raisonPlugins.texte}
				</p>
			)}
			{d.skillsMemoireDisponibles.length === 0 && <p className={s.effet}>{t.aucuneSkill}</p>}
		</Bloc>
	);
}
