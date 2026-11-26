/**
 * Profils du mode démo (`?demo&vue=reglages`) : une imitation en mémoire des routes de gestion des profils du service
 * (détail, enregistrement avec empreinte, duplication, suppression, aperçu), pour voir Réglages › Profils sans service.
 */
import { PROFIL_ARCHIVISTE, PROFIL_TRAVAIL } from '@mnemo/commun';
import type { IdMoteur } from '@mnemo/commun';
import type { ApercuProfilVue, BlocApercuVue, EquipementProfilVue, EvenementHookVue, PluginInstalleVue, ProfilDetailVue, ProfilEditableVue, ReponseEcritureProfil, ReponseProfils, SkillVue } from '@mnemo/contrat';
import { ErreurApi } from './api.ts';

const CONSIGNE_TRAVAIL = 'La mémoire Mnemo de ce dossier contient des informations pertinentes pour ton travail. Mnemo te propose des pistes : lis avec `lire` celles qui servent ta tâche.\nAvant de répondre sur un projet, un client, une personne ou une décision, cherche.';
const CONSIGNE_ARCHIVISTE = 'Tu es l’archiviste de cette mémoire Mnemo.\nTu ranges, fusionnes et vérifies les fiches ; tu ne travailles sur aucun projet.';

const PLUGINS: PluginInstalleVue[] = [
	{
		id: 'superpowers@superpowers-marketplace',
		nom: 'superpowers',
		version: '5.1.0',
		portee: 'utilisateur',
		skills: [
			{ nom: 'brainstorming', description: 'Avant tout travail créatif.' },
			{ nom: 'writing-plans', description: 'Écrire un plan d’implémentation.' },
		],
		hooks: true,
	},
	{ id: 'pdf-viewer@claude-plugins', nom: 'pdf-viewer', version: '1.0.2', portee: 'utilisateur', skills: [{ nom: 'open', description: 'Ouvrir un PDF.' }], hooks: false },
];

const SKILLS_MEMOIRE: SkillVue[] = [
	{ nom: 'devis', description: 'Rédiger un devis au format de la maison.' },
	{ nom: 'relecture', description: 'Relire un courrier avant envoi.' },
];

/** Ce que lit, hors Mnemo, un moteur sans plugins de session (ses skills sont listées dans la consigne), comme le service. */
type ElementApercuVue = NonNullable<BlocApercuVue['elements']>[number];
const HORS_MNEMO_SANS_PLUGINS: Partial<Record<IdMoteur, readonly ElementApercuVue[]>> = {
	codex: [
		{ nom: 'AGENTS.md', detail: 'instructions de l’utilisateur et du projet, lues par Codex', actif: true },
		{ nom: 'Skills de Codex', detail: 'skills du dépôt et de l’utilisateur (~/.agents/skills/), lues par Codex', actif: true },
	],
	'mistral-vibe': [
		{ nom: 'AGENTS.md', detail: 'instructions de l’utilisateur (~/.vibe/AGENTS.md) et du projet, lues par Mistral Vibe', actif: true },
		{ nom: 'Skills de Mistral Vibe', detail: 'skills du projet (.vibe/skills/) et de l’utilisateur (~/.vibe/skills/, ~/.agents/skills/), lues par Mistral Vibe', actif: true },
	],
};

const HOOKS_TOUS: EvenementHookVue[] = ['debut', 'message', 'outil', 'apres_outil', 'arret', 'fin'];

type Etat = { editable: ProfilEditableVue; consigneParDefaut: string; ecrit: boolean; version: number };

export function creerProfilsDemo() {
	const profils = new Map<string, Etat>([
		[PROFIL_TRAVAIL, { editable: { avatar: { forme: 'robot', couleur: 'vert' }, consigne: null, lancement: 'projet', hooks: [...HOOKS_TOUS], skillsMemoire: 'tous', plugins: [], moteur: 'claude-code', modele: '' }, consigneParDefaut: CONSIGNE_TRAVAIL, ecrit: true, version: 1 }],
		[PROFIL_ARCHIVISTE, { editable: { avatar: { forme: 'chouette', couleur: 'violet' }, consigne: null, lancement: 'memoire', hooks: ['debut', 'arret', 'fin'], skillsMemoire: [], plugins: [], moteur: 'claude-code', modele: '' }, consigneParDefaut: CONSIGNE_ARCHIVISTE, ecrit: false, version: 1 }],
		[
			'redaction',
			{
				editable: { avatar: { forme: 'renard', couleur: 'ambre' }, consigne: 'Rédige les courriers aux clients, au ton de la maison.', lancement: 'projet', hooks: [...HOOKS_TOUS], skillsMemoire: ['relecture'], plugins: ['superpowers@superpowers-marketplace', 'ancien@marketplace'], moteur: 'claude-code', modele: '' },
				consigneParDefaut: CONSIGNE_TRAVAIL,
				ecrit: true,
				version: 1,
			},
		],
		[
			'veille-technique',
			{
				editable: { avatar: { forme: 'pingouin', couleur: 'rouge' }, consigne: 'Fais la veille des bibliothèques du projet et résume ce qui change.', lancement: 'projet', hooks: [...HOOKS_TOUS], skillsMemoire: 'tous', plugins: [], moteur: 'mistral-vibe', modele: 'mistral-medium-3.5' },
				consigneParDefaut: CONSIGNE_TRAVAIL,
				ecrit: true,
				version: 1,
			},
		],
		[
			'revue-code',
			{
				editable: { avatar: { forme: 'chat', couleur: 'bleu' }, consigne: 'Relis le code proposé et signale les risques avant toute fusion.', lancement: 'projet', hooks: [...HOOKS_TOUS], skillsMemoire: 'tous', plugins: [], moteur: 'codex', modele: 'gpt-6.2-sol' },
				consigneParDefaut: CONSIGNE_TRAVAIL,
				ecrit: true,
				version: 1,
			},
		],
	]);

	const etat = (nom: string): Etat => {
		const e = profils.get(nom);
		if (!e) throw new ErreurApi(`Profil inconnu : « ${nom} ».`, 404);
		return e;
	};
	const consigne = (e: Etat) => e.editable.consigne ?? e.consigneParDefaut;
	const empreinte = (nom: string, e: Etat) => (e.ecrit ? `${nom}-${e.version}` : null);
	const skillsDuProfil = (nom: string): SkillVue[] => (nom === 'redaction' ? [{ nom: 'signature', description: 'Signer un courrier.' }] : []);
	/** Comme le service : les skills du profil puis celles de la mémoire qu'il retient (le profil gagne à nom égal), les plugins installés qu'il allume, avec Claude Code seulement. */
	const equipement = (nom: string, e: Etat): EquipementProfilVue => {
		const duProfil = skillsDuProfil(nom).map((x) => x.nom);
		const retenues = SKILLS_MEMOIRE.filter((x) => !duProfil.includes(x.nom) && (e.editable.skillsMemoire === 'tous' || e.editable.skillsMemoire.includes(x.nom)));
		return { skills: duProfil.length + retenues.length, plugins: e.editable.moteur === 'claude-code' ? PLUGINS.filter((x) => e.editable.plugins.includes(x.id)).length : 0, hooks: [...e.editable.hooks] };
	};
	const verifierNom = (nom: string) => {
		if (!/^[a-z0-9][a-z0-9-]{0,39}$/u.test(nom)) throw new ErreurApi('Profil refusé : nom refusé : minuscules, chiffres et tirets, 40 caractères au plus, sans tiret au début', 400);
	};

	return {
		liste(): ReponseProfils {
			return {
				profils: [...profils.entries()]
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([nom, e]) => ({
						nom,
						description: consigne(e).split('\n')[0]!,
						lancement: e.editable.lancement,
						lanceur: nom === PROFIL_ARCHIVISTE ? 'propre' : 'dialogue',
						avatar: e.editable.avatar,
						personnalise: e.editable.consigne !== null,
						moteur: e.editable.moteur,
						modele: e.editable.modele,
						equipement: equipement(nom, e),
					})),
				ignores: [],
				avertissements: [],
			};
		},

		detail(nom: string): ProfilDetailVue {
			const e = etat(nom);
			return {
				nom,
				editable: structuredClone(e.editable),
				consigneEffective: consigne(e),
				consigneParDefaut: e.consigneParDefaut,
				supprimable: nom !== PROFIL_TRAVAIL && nom !== PROFIL_ARCHIVISTE,
				lancementModifiable: nom !== PROFIL_ARCHIVISTE,
				empreinte: empreinte(nom, e),
				skillsMemoireDisponibles: SKILLS_MEMOIRE,
				skillsDuProfil: skillsDuProfil(nom),
				pluginsInstalles: PLUGINS,
				avertissements: [],
			};
		},

		enregistrer(nom: string, corps: unknown): ReponseEcritureProfil {
			verifierNom(nom);
			const { editable, empreinte: lue } = corps as { editable: ProfilEditableVue; empreinte: string | null };
			const e = profils.get(nom);
			if ((e === undefined ? null : empreinte(nom, e)) !== lue) throw new ErreurApi('La fiche du profil a changé depuis son ouverture : rechargez-la.', 409);
			if (editable.hooks.length === 0) throw new ErreurApi('Profil refusé : au moins un événement, parmi ceux de Mnemo', 400);
			if (editable.moteur !== 'claude-code' && editable.plugins.length > 0) throw new ErreurApi('Profil refusé : les plugins ne valent que pour Claude Code', 400);
			if (editable.moteur !== 'claude-code' && nom === PROFIL_ARCHIVISTE) throw new ErreurApi('Profil refusé : l’archiviste reste sur Claude Code', 400);
			const garde = editable.consigne !== null && editable.consigne.trim() === (e?.consigneParDefaut ?? CONSIGNE_TRAVAIL).trim() ? { ...editable, consigne: null } : editable;
			if (e !== undefined && JSON.stringify(e.editable) === JSON.stringify(garde) && e.ecrit) return { commit: null };
			profils.set(nom, { editable: structuredClone(garde), consigneParDefaut: e?.consigneParDefaut ?? CONSIGNE_TRAVAIL, ecrit: true, version: (e?.version ?? 0) + 1 });
			return { commit: 'demo0001' };
		},

		dupliquer(source: string, corps: unknown): ReponseEcritureProfil {
			const nom = String((corps as { nom?: unknown }).nom ?? '');
			verifierNom(nom);
			const e = etat(source);
			if (profils.has(nom)) throw new ErreurApi(`Profil refusé : le profil « ${nom} » existe déjà`, 400);
			profils.set(nom, { editable: { ...structuredClone(e.editable), consigne: consigne(e) }, consigneParDefaut: CONSIGNE_TRAVAIL, ecrit: true, version: 1 });
			return { commit: 'demo0002' };
		},

		supprimer(nom: string): ReponseEcritureProfil {
			if (nom === PROFIL_TRAVAIL || nom === PROFIL_ARCHIVISTE) throw new ErreurApi(`Profil refusé : le profil « ${nom} » ne se supprime pas`, 400);
			etat(nom);
			profils.delete(nom);
			return { commit: 'demo0003' };
		},

		apercu(nom: string): ApercuProfilVue {
			const e = etat(nom);
			const d = e.editable;
			const retenue = (s: string) => d.skillsMemoire === 'tous' || d.skillsMemoire.includes(s);
			const horsMnemo = HORS_MNEMO_SANS_PLUGINS[d.moteur];
			const sansPlugins = horsMnemo !== undefined;
			const titreConsigne = d.consigne === null ? 'Consigne du profil (par défaut)' : 'Consigne du profil (personnalisée)';
			// sans plugins (Codex, Mistral Vibe) : la consigne reçue porte la liste des skills, lues par l'outil `lire` (comme le service)
			const listeSkills = SKILLS_MEMOIRE.filter((s) => retenue(s.nom)).map((s) => `- ${s.nom} : ${s.description} (\`skills/${s.nom}/SKILL.md\`)`);
			const texteAvecSkills = [consigne(e).trim(), '', '## Skills de Mnemo', '', 'Ces skills sont dans la mémoire Mnemo, pas sur le disque du projet. Quand l’une s’applique à ta tâche, lis d’abord son `SKILL.md` avec l’outil `lire` de Mnemo (identifiant entre parenthèses), puis suis-la.', '', ...listeSkills, ''].join('\n');
			const blocs: BlocApercuVue[] = [
				sansPlugins
					? { origine: 'profil', titre: `${titreConsigne}, avec la liste des skills`, reglable: true, texte: texteAvecSkills }
					: { origine: 'profil', titre: titreConsigne, reglable: true, texte: `${consigne(e)}\n` },
				{ origine: 'mnemo', titre: 'Instructions du serveur MCP Mnemo', reglable: false, texte: 'Consigne et contexte injectés par la session Mnemo.' },
				{ origine: 'mnemo', titre: 'Hooks de Mnemo', reglable: true, elements: d.hooks.map((h) => ({ nom: h, detail: '', actif: true })) },
				{
					origine: 'memoire',
					titre: sansPlugins ? 'Skills de la mémoire (listées dans la consigne, lues par l’outil lire)' : 'Skills de la mémoire',
					reglable: true,
					elements: SKILLS_MEMOIRE.map((s) => ({ nom: s.nom, detail: retenue(s.nom) ? s.description : `${s.description} — non retenue par le profil`, actif: retenue(s.nom) })),
				},
				...(sansPlugins ? [] : [{ origine: 'plugin', titre: 'Plugins Claude Code', reglable: true, elements: PLUGINS.map((p) => ({ nom: p.id, detail: `version ${p.version}`, actif: d.plugins.includes(p.id) })) } satisfies BlocApercuVue]),
				{
					origine: 'hors_mnemo',
					titre: 'Hors Mnemo',
					reglable: false,
					elements: horsMnemo !== undefined ? [...horsMnemo] : [{ nom: 'CLAUDE.md', detail: 'instructions de l’utilisateur et du projet, lues par Claude Code', actif: true }],
				},
				{ origine: 'systeme', titre: 'Consigne du bilan', reglable: false, texte: 'Mnemo : bilan de fin de session. Rédige l’épisode de cette session avec l’outil proposer, genre « episode »…' },
			];
			const absents = d.plugins.filter((id) => !PLUGINS.some((p) => p.id === id));
			return { blocs, avertissements: absents.map((id) => `Le plugin « ${id} » est listé dans le profil « ${nom} » mais n'est pas installé dans Claude Code.`) };
		},
	};
}
