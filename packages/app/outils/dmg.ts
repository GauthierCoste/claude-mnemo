/**
 * Image disque de l'app (`pnpm construire-app --dmg`) : `dist/Mnemo-<version>-<arch>.dmg`, volume « Mnemo <version> » qui
 * contient `Mnemo.app` et un lien vers `/Applications` (glisser l'une sur l'autre installe). Faite par `hdiutil`, outil
 * système de macOS (accepté pour cette construction propre à macOS), compressée (UDZO), sans autre outil externe.
 * L'app y entre telle quelle (déplacée dans un dossier de préparation puis remise en place) : sa signature est gardée.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { ErreurConstruction } from './erreur.ts';

/** `Mnemo-1.5.0-arm64.dmg`. */
export function nomDmg(nom: string, version: string, arch: string): string {
	return `${nom}-${version}-${arch}.dmg`;
}

/** Arguments de `hdiutil create` : volume nommé, dossier source, image compressée, remplacée si elle existe. */
export function argumentsHdiutil(volume: string, source: string, dmg: string): string[] {
	return ['create', '-volname', volume, '-srcfolder', source, '-fs', 'HFS+', '-format', 'UDZO', '-ov', '-quiet', dmg];
}

/** Crée `dmg` à partir du paquet `app` (`…/Mnemo.app`, laissé en place à la fin). */
export function creerDmg(app: string, dmg: string, volume: string): void {
	const preparation = mkdtempSync(join(dirname(app), '.dmg-'));
	const dedans = join(preparation, basename(app));
	renameSync(app, dedans);
	try {
		symlinkSync('/Applications', join(preparation, 'Applications'));
		rmSync(dmg, { force: true });
		execFileSync('hdiutil', argumentsHdiutil(volume, preparation, dmg), { stdio: ['ignore', 'ignore', 'pipe'] });
	} catch (e) {
		const sortie = (e as { stderr?: Buffer }).stderr?.toString('utf8').trim();
		throw new ErreurConstruction(`hdiutil n’a pas créé ${dmg}${sortie ? ` : ${sortie}` : ` (${e instanceof Error ? e.message : String(e)})`}.`);
	} finally {
		renameSync(dedans, app);
		rmSync(preparation, { recursive: true, force: true });
	}
}
