import { describe, it, expect } from 'vitest';
import { removalLabel } from '../scope';
import type Cell from '../../../block/gfm/table/cell';
import type I18n from '../../../i18n';
import { zhCN } from '../../../locales/zh-CN';

describe('table removal scope', () => {
    it('names the entire row or column and the affected cell count', () => {
        const cell = { rowOffset: 1, columnOffset: 2, table: { rowCount: 4, columnCount: 3 } } as unknown as Cell;
        const i18n = { t: (key: string) => zhCN.resource[key] || key } as I18n;
        expect(removalLabel(cell, 'row', i18n)).toBe('删除第 2 行（整行，共 3 个单元格）');
        expect(removalLabel(cell, 'column', i18n)).toBe('删除第 3 列（整列，共 4 个单元格）');
    });
});
