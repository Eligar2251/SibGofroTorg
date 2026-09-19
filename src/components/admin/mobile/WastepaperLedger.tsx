"use client";

import { Children, createContext, isValidElement, useContext, type ReactNode, type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from "react";
import { useIsMobile } from "@/hooks/use-is-mobile";

// One source of data and actions, two independent DOM layouts:
// a desktop table or a phone ledger of labelled cards (no squeezed table).
const LedgerContext = createContext<{ mobile: boolean; labels: ReactNode[] }>({ mobile: false, labels: [] });
function childrenOf(node: ReactNode): ReactNode[] {
  return isValidElement<{ children?: ReactNode }>(node) ? Children.toArray(node.props.children) : [];
}
export function WpTable({ children, ...props }: HTMLAttributes<HTMLTableElement>) {
  const mobile = useIsMobile();
  const head = Children.toArray(children).find(node => isValidElement(node) && node.type === WpHead);
  const labels = childrenOf(head).flatMap(childrenOf).map(node => childrenOf(node));
  return <LedgerContext.Provider value={{ mobile, labels }}>
    {mobile ? <div className="wpa-ledger">{children}</div> : <table {...props}>{children}</table>}
  </LedgerContext.Provider>;
}
export function WpHead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return useContext(LedgerContext).mobile ? null : <thead {...props} />;
}
export function WpBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return useContext(LedgerContext).mobile ? <div className="wpa-ledger__list">{props.children}</div> : <tbody {...props} />;
}
export function WpHeading(props: ThHTMLAttributes<HTMLTableCellElement>) { return <th {...props} />; }
export function WpRow({ children, onActivate, title, ...props }: HTMLAttributes<HTMLTableRowElement> & { onActivate?: () => void }) {
  const { mobile, labels } = useContext(LedgerContext);
  if (!mobile) return <tr {...props} title={title} onClick={onActivate}>{children}</tr>;
  return <article className="wpa-ledger__card">
    {onActivate && <button className="wpa-ledger__expand" type="button" onClick={onActivate}>{title || "Подробнее"}</button>}
    <dl>{Children.toArray(children).map((cell, index) => {
      if (!isValidElement<TdHTMLAttributes<HTMLTableCellElement>>(cell)) return cell;
      return <div className="wpa-ledger__field" key={cell.key ?? index}>
        {!cell.props.colSpan && labels[index] && <dt>{labels[index]}</dt>}
        <dd style={{ color: cell.props.style?.color, fontWeight: cell.props.style?.fontWeight }}>{cell.props.children}</dd>
      </div>;
    })}</dl>
  </article>;
}
export function WpCell(props: TdHTMLAttributes<HTMLTableCellElement>) { return <td {...props} />; }
