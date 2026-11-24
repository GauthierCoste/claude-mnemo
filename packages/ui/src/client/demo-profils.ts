/**
 * Profils du mode démo (`?demo&vue=reglages`) : une imitation en mémoire des routes de gestion des profils du service
 * (détail, enregistrement avec empreinte, duplication, suppression, aperçu), pour voir Réglages › Profils sans service.
 */
import { PROFIL_ARCHIVISTE, PROFIL_TRAVAIL } from '@mnemo/commun';
import type { ApercuProfilVue, BlocApercuVue, EvenementHookVue, PluginInstalleVue, ProfilDetailVue, ProfilEditableVue, ReponseEcritureProfil, ReponseProfils, SkillVue } from '@mnemo/contrat';
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

const HOOKS_TOUS: EvenementHookVue[] = ['debut', 'message', 'outil', 'apres_outil', 'arret', 'fin'];

type Etat = { editable: ProfilEditableVue; consigneParDefaut: string; ecrit: boolean; version: number };

export function creerProfilsDemo() {
	const profils = new Map<string, Etat>([
		[PROFIL_TRAVAIL, { editable: { avatar: { forme: 'robot', couleur: 'vert' }, consigne: null, lancement: 'projet', hooks: [...HOOKS_TOUS], skillsMemoire: 'tous', plugins: [] }, consigneParDefaut: CONSIGNE_TRAVAIL, ecrit: true, version: 1 }],
		[PROFIL_ARCHIVISTE, { editable: { avatar: { forme: 'chouette', couleur: 'violet' }, consigne: null, lancement: 'memoire', hooks: ['debut', 'arret', 'fin'], skillsMemoire: [], plugins: [] }, consigneParDefaut: CONSIGNE_ARCHIVISTE, ecrit: false, version: 1 }],
		[
			'redaction',
			{
				editable: { avatar: { forme: 'renard', couleur: 'ambre' }, consigne: 'Rédige les courriers aux clients, au ton de la maison.', lancement: 'projet', hooks: [...HOOKS_TOUS], skillsMemoire: ['relecture'], plugins: ['superpowers@superpowers-marketplace', 'ancien@marketplace'] },
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
				skillsDuProfil: nom === 'redaction' ? [{ nom: 'signature', description: 'Signer un courrier.' }] : [],
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
			const blocs: BlocApercuVue[] = [
				{ origine: 'profil', titre: d.consigne === null ? 'Consigne du profil (par défaut)' : 'Consigne du profil (personnalisée)', reglable: true, texte: `${consigne(e)}\n` },
				{ origine: 'mnemo', titre: 'Instructions du serveur MCP Mnemo', reglable: false, texte: 'Consigne et contexte injectés par la session Mnemo.' },
				{ origine: 'mnemo', titre: 'Hooks de Mnemo', reglable: true, elements: d.hooks.map((h) => ({ nom: h, detail: '', actif: true })) },
				{ origine: 'memoire', titre: 'Skills de la mémoire', reglable: true, elements: SKILLS_MEMOIRE.map((s) => ({ nom: s.nom, detail: retenue(s.nom) ? s.description : `${s.description} — non retenue par le profil`, actif: retenue(s.nom) })) },
				{ origine: 'plugin', titre: 'Plugins Claude Code', reglable: true, elements: PLUGINS.map((p) => ({ nom: p.id, detail: `version ${p.version}`, actif: d.plugins.includes(p.id) })) },
				{ origine: 'hors_mnemo', titre: 'Hors Mnemo', reglable: false, elements: [{ nom: 'CLAUDE.md', detail: 'instructions de l’utilisateur et du projet, lues par Claude Code', actif: true }] },
				{ origine: 'systeme', titre: 'Consigne du bilan', reglable: false, texte: 'Mnemo : bilan de fin de session. Rédige l’épisode de cette session avec l’outil proposer, genre « episode »…' },
			];
			const absents = d.plugins.filter((id) => !PLUGINS.some((p) => p.id === id));
			return { blocs, avertissements: absents.map((id) => `Le plugin « ${id} » est listé dans le profil « ${nom} » mais n'est pas installé dans Claude Code.`) };
		},
	};
}
