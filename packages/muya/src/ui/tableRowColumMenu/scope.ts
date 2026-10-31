import type Cell from '../../block/gfm/table/cell';
import type I18n from '../../i18n';

export const removalLabel = (cell: Cell, target: 'row' | 'column', i18n: I18n): string => {
    const index = (target === 'row' ? cell.rowOffset : cell.columnOffset) + 1;
    const count = target === 'row' ? cell.table.columnCount : cell.table.rowCount;
    const key = target === 'row' ? 'Remove Row Scope' : 'Remove Column Scope';
    const translated = i18n.t(key);
    const template = translated === key ? `${i18n.t(target === 'row' ? 'Remove Row' : 'Remove Column')} {index} ({count})` : translated;
    return template
        .replace('{index}', String(index)).replace('{count}', String(count));
};
