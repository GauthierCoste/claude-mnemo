import { citerCmd, citerPosix, citerPowerShell } from '../citer.ts';
import type { IdMoteur } from './moteur.ts';

/** Shell qui lance la commande d'un hook installé pour tout le poste : POSIX (`sh -c`), PowerShell ou `cmd.exe`. */
export type ShellDeHook = 'posix' | 'powershell' | 'cmd';

const CITER: Record<ShellDeHook, (chemin: string) => string> = { posix: citerPosix, powershell: citerPowerShell, cmd: citerCmd };

/**
 * Commande d'un hook de Mnemo installé pour tout le poste chez `moteur` : `<node> <main.ts> hook <args> --moteur <moteur>`,
 * chemins cités pour le shell, derrière une garde qui sort d'emblée (code 0) hors d'une session de Mnemo de ce moteur
 * (`MNEMO_MOTEUR`, posée au lancement de la session) : un Node désinstallé ou un dépôt déplacé ne fait pas échouer chaque
 * événement des autres sessions du moteur. Les arguments sont des mots simples, jamais cités.
 */
export function commandeGardee(moteur: IdMoteur, shell: ShellDeHook, node: string, main: string, args: readonly string[]): string {
	const citer = CITER[shell];
	const suite = ['hook', ...args, '--moteur', moteur].join(' ');
	if (shell === 'posix') return `[ "$MNEMO_MOTEUR" = ${moteur} ] || exit 0; ${citer(node)} ${citer(main)} ${suite}`;
	if (shell === 'powershell') return `if ($env:MNEMO_MOTEUR -ne '${moteur}') { exit 0 }; & ${citer(node)} ${citer(main)} ${suite}`;
	return `if "%MNEMO_MOTEUR%"=="${moteur}" ${citer(node)} ${citer(main)} ${suite}`;
}

const echapperRegex = (texte: string): string => texte.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * Une commande de hook posée par Mnemo pour `moteur` (n'importe quelle installation, avec ou sans garde) :
 * `… adaptateurs/cli/main.ts['"] hook <événement> [--notification] --moteur <moteur>`, ancré en fin de commande ; jamais celle
 * d'un autre outil.
 */
export function estCommandeDeHookMnemo(commande: string, moteur: IdMoteur): boolean {
	return new RegExp(`adaptateurs[\\\\/]cli[\\\\/]main\\.ts['"]?[ \\t]+hook[ \\t]+[a-z_]+(?:[ \\t]+--notification)?[ \\t]+--moteur[ \\t]+${echapperRegex(moteur)}[ \\t]*$`, 'u').test(commande);
}

/** Une commande de Mnemo qui lance ce Node et ce `main.ts` (cette installation), cités pour l'un des shells. */
export function lanceCeNodeEtCeMain(commande: string, node: string, main: string): boolean {
	return Object.values(CITER).some((citer) => commande.includes(`${citer(node)} ${citer(main)} hook `));
}
