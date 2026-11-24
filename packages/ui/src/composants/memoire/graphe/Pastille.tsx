import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../../commun/classes.ts';
import s from './Pastille.module.css';

/** Pastille lumineuse à la couleur d'un nœud (`--c`) ; en anneau pour un lien cassé. */
export function Pastille(p: { couleur: string; anneau?: boolean }): ReactNode {
	return <i className={cx(s.pastille, p.anneau && s.anneau)} style={{ '--c': p.couleur } as CSSProperties} aria-hidden="true" />;
}
