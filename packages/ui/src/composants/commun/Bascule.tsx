import type { ReactNode } from 'react';
import s from './Bascule.module.css';
import { cx } from './classes.ts';

/** Interrupteur, en `button role="switch"`. */
export function Bascule(p: { actif: boolean; surChangement(actif: boolean): void; children: ReactNode; title?: string }): ReactNode {
	return (
		<button type="button" role="switch" aria-checked={p.actif} className={s.bascule} onClick={() => p.surChangement(!p.actif)} title={p.title}>
			<span className={cx(s.glissiere, p.actif && s.on)} aria-hidden="true" />
			{p.children}
		</button>
	);
}
