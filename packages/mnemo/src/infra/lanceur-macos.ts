import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { icnsDepuisPng } from './icns.ts';
import type { TypeIcns } from './icns.ts';
import { DOSSIER_LOCAL } from '../domaine/dossier-memoire.ts';

/**
 * Lanceur macOS de Mnemo : un paquet d'application minimal, `~/Applications/Mnemo.app` (`Info.plist`, un exécutable, une
 * icône, un lien vers Node). Son exécutable est un petit script Node (pas de shell) qui lance `mnemo ouvrir <dossier>` avec
 * le Node et le `main.ts` de sa création, journal dans `.mnemo/service.log`. Créé et retiré seulement à la demande
 * (`mnemo lanceur`) ; rien n'est inscrit au démarrage de la session macOS.
 */

/** Identifiant du paquet : ce qui distingue notre `Mnemo.app` d'une autre application du même nom. */
export const IDENTIFIANT_LANCEUR = 'local.mnemo.lanceur';
const EXECUTABLE = 'mnemo-lanceur';
/** Lien vers Node dans le paquet : la ligne `#!` ne tient pas un chemin à espace (`~/Library/Application Support/fnm/…`). */
const INTERPRETE = 'node';
const ICONE = 'Mnemo';

export type Lanceur = {
	/** Dossier Mnemo ouvert par le lanceur. */
	racine: string;
	/** Node et `main.ts` appelés (chemins absolus, ceux du moment de la création). */
	node: string;
	main: string;
	/** PATH donné au service (celui du terminal qui crée le lanceur : une application lancée du Finder n'a qu'un PATH minimal). */
	path: string;
	/** `MNEMO_PORT` à reprendre, s'il était posé. */
	port?: string;
	version: string;
	/** PNG de l'icône par type `.icns` ; vide : pas d'icône. */
	icones: { type: TypeIcns; png: Buffer }[];
};

const echapperXml = (t: string): string => t.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');

function infoPlist(l: Lanceur): string {
	const cle = (k: string, v: string) => `\t<key>${k}</key>\n\t<string>${echapperXml(v)}</string>`;
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
		'<plist version="1.0">',
		'<dict>',
		cle('CFBundleName', 'Mnemo'),
		cle('CFBundleDisplayName', 'Mnemo'),
		cle('CFBundleIdentifier', IDENTIFIANT_LANCEUR),
		cle('CFBundleExecutable', EXECUTABLE),
		...(l.icones.length > 0 ? [cle('CFBundleIconFile', ICONE)] : []),
		cle('CFBundlePackageType', 'APPL'),
		cle('CFBundleInfoDictionaryVersion', '6.0'),
		cle('CFBundleShortVersionString', l.version),
		cle('CFBundleVersion', l.version),
		cle('LSMinimumSystemVersion', '11.0'),
		// le lanceur ne fait qu'ouvrir la fenêtre de Mnemo : pas d'icône à lui dans le Dock
		'\t<key>LSUIElement</key>\n\t<true/>',
		cle('MnemoDossier', l.racine),
		'</dict>',
		'</plist>',
		'',
	].join('\n');
}

/** L'exécutable : Node lit ce script ; toutes les valeurs y sont écrites en JSON (aucune interprétation par un shell). */
function script(l: Lanceur, interprete: string): string {
	const j = JSON.stringify;
	const env = l.port === undefined ? `{ ...process.env, PATH: ${j(l.path)} }` : `{ ...process.env, PATH: ${j(l.path)}, MNEMO_PORT: ${j(l.port)} }`;
	return `#!${interprete}
// Lanceur de Mnemo, écrit par « mnemo lanceur » : ouvre Mnemo pour le dossier ci-dessous, et démarre son service s'il ne
// tourne pas. Node et le code de Mnemo sont pris là où ils étaient à sa création : s'ils changent de place, relancez
// « mnemo lanceur ». Messages et erreurs : .mnemo/service.log du dossier.
const { spawnSync } = process.getBuiltinModule('node:child_process');
const { openSync } = process.getBuiltinModule('node:fs');
const racine = ${j(l.racine)};
let journal = 'ignore';
try {
	journal = openSync(${j(join(l.racine, DOSSIER_LOCAL, 'service.log'))}, 'a', 0o600);
} catch {
	// dossier absent ou illisible : « mnemo ouvrir » le dira (sans journal)
}
const r = spawnSync(process.execPath, [${j(l.main)}, ${j('ouvrir')}, racine], { stdio: ['ignore', journal, journal], env: ${env} });
process.exitCode = r.status ?? 1;
`;
}

/** Le `Mnemo.app` de ce dossier est-il le nôtre (créé par `mnemo lanceur`) ? */
function estLeNotre(app: string): boolean {
	try {
		return readFileSync(join(app, 'Contents', 'Info.plist'), 'utf8').includes(`<string>${IDENTIFIANT_LANCEUR}</string>`);
	} catch {
		return false;
	}
}

/** Écrit le lanceur dans `applications` (créé s'il manque). `remplace` : un lanceur précédent (le nôtre) a été remplacé. */
export function ecrireLanceur(applications: string, l: Lanceur): { app: string; remplace: boolean } | { refus: string } {
	const app = join(applications, 'Mnemo.app');
	const interprete = join(app, 'Contents', 'MacOS', INTERPRETE);
	if (/\s/u.test(interprete)) return { refus: `Le lanceur ne peut pas être créé dans ${app} : la ligne « #! » de son exécutable ne tient pas un chemin qui contient une espace.` };
	const existe = existsSync(app);
	if (existe && !estLeNotre(app)) return { refus: `${app} existe et n'a pas été créé par « mnemo lanceur » : laissé en place.` };
	mkdirSync(applications, { recursive: true });
	// construit à côté, puis mis en place d'un coup
	const provisoire = join(applications, `.Mnemo.app.${process.pid}.${randomBytes(4).toString('hex')}`);
	try {
		mkdirSync(join(provisoire, 'Contents', 'MacOS'), { recursive: true });
		writeFileSync(join(provisoire, 'Contents', 'Info.plist'), infoPlist(l));
		const executable = join(provisoire, 'Contents', 'MacOS', EXECUTABLE);
		symlinkSync(l.node, join(provisoire, 'Contents', 'MacOS', INTERPRETE));
		writeFileSync(executable, script(l, interprete), { mode: 0o755 });
		chmodSync(executable, 0o755);
		if (l.icones.length > 0) {
			mkdirSync(join(provisoire, 'Contents', 'Resources'));
			writeFileSync(join(provisoire, 'Contents', 'Resources', `${ICONE}.icns`), icnsDepuisPng(l.icones));
		}
		if (existe) rmSync(app, { recursive: true, force: true });
		renameSync(provisoire, app);
	} catch (erreur) {
		rmSync(provisoire, { recursive: true, force: true });
		throw erreur;
	}
	return { app, remplace: existe };
}

/** Retire `Mnemo.app` de `applications` s'il est le nôtre. */
export function retirerLanceur(applications: string): { retire: string } | { absent: string } | { refus: string } {
	const app = join(applications, 'Mnemo.app');
	if (!existsSync(app)) return { absent: app };
	if (!estLeNotre(app)) return { refus: `${app} n'a pas été créé par « mnemo lanceur » : laissé en place.` };
	rmSync(app, { recursive: true, force: true });
	return { retire: app };
}
