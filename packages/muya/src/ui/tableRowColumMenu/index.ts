import type { VNode } from 'snabbdom';
import type TableBodyCell from '../../block/gfm/table/cell';
import type TableInner from '../../block/gfm/table/table';

import type { Muya } from '../../index';
import type { MenuItem } from './config';
import { h, patch } from '../../utils/snabbdom';
import BaseFloat from '../baseFloat';
import { toolList } from './config';
import './index.css';
import { removalLabel } from './scope';

const defaultOptions = {
    placement: 'bottom-end' as const,
    offsetOptions: {
        mainAxis: 0,
        crossAxis: 0,
        alignmentAxis: 0,
    },
    showArrow: false,
};

interface ITableInfo {
    barType: 'bottom' | 'right';
}

export class TableRowColumMenu extends BaseFloat {
    static pluginName = 'tableBarTools';
    public override capturesContentKeydown = true;
    private _oldVNode: VNode | null = null;
    private _tableInfo: ITableInfo | null = null;
    private _block: TableBodyCell | null = null;
    private _tableBarContainer: HTMLDivElement = document.createElement('div');

    constructor(muya: Muya, options = {}) {
        const name = 'mu-table-bar-tools';
        const opts = Object.assign({}, defaultOptions, options);
        super(muya, name, opts);

        this.floatBox!.classList.add('mu-table-bar-tools');
        this.container!.appendChild(this._tableBarContainer);
        this.listen();
    }

    override listen() {
        super.listen();
        const { eventCenter } = this.muya;
        eventCenter.subscribe(
            'muya-table-bar',
            ({ reference, tableInfo, block }) => {
                if (reference) {
                    this._tableInfo = tableInfo;
                    this._block = block;
                    this.show(reference);
                    this.render();
                }
                else {
                    this.hide();
                }
            },
        );
    }

    render() {
        const { _tableInfo: tableInfo, _oldVNode: oldVNode, _tableBarContainer: tableBarContainer } = this;
        const { i18n } = this.muya;
        const renderArray: MenuItem[] = toolList[tableInfo!.barType];
        const children = renderArray.map((item) => {
            const label = item.action === 'remove'
                ? removalLabel(this._block!, item.target as 'row' | 'column', i18n) : i18n.t(item.label);

            const selector = 'li.item';

            return h(
                selector,
                {
                    attrs: { role: 'menuitem', tabindex: '0', title: label },
                    dataset: {
                        label: item.action,
                    },
                    on: {
                        keydown: (event: KeyboardEvent) => {
                            if (event.key === 'Enter' || event.key === ' ') this.selectItem(event, item);
                            if (event.key === 'Escape') this.hide();
                        },
                        click: (event) => {
                            this.selectItem(event, item);
                        },
                    },
                },
                label,
            );
        });

        const translatedHint = i18n.t('Table Delete Hint');
        const hint = translatedHint === 'Table Delete Hint'
            ? 'Text selection deletes text. Cell selection clears content first; deleting again can remove structure. This menu removes entire rows or columns. Undo is available.'
            : translatedHint;
        const vnode = h('ul', { attrs: { role: 'menu' } }, [...children, h('li.scope-hint', hint)]);

        if (oldVNode)
            patch(oldVNode, vnode);
        else
            patch(tableBarContainer, vnode);

        this._oldVNode = vnode;
    }

    selectItem(event: Event, item: MenuItem) {
        event.preventDefault();
        event.stopPropagation();

        const { table, row } = this._block!;
        const rowCount = (table.firstChild as TableInner).offset(row);
        const columnCount = row.offset(this._block!);
        const { location, action, target } = item;

        if (action === 'insert') {
            let cursorBlock = null;

            if (target === 'row') {
                const offset = location === 'previous' ? rowCount : rowCount + 1;
                cursorBlock = table.insertRow(offset);
            }
            else {
                const offset = location === 'left' ? columnCount : columnCount + 1;
                cursorBlock = table.insertColumn(offset);
            }

            if (cursorBlock)
                cursorBlock.setCursor(0, 0);
        }
        else {
            // After a row/column delete, the caret used to live inside a
            // now-detached cell. The table
            // mutators now return a surviving neighbour cell's content so we
            // can re-anchor the caret on a still-attached cell.
            const cursorBlock = target === 'row'
                ? table.removeRow(rowCount)
                : table.removeColumn(columnCount);

            if (cursorBlock)
                cursorBlock.setCursor(0, 0);
        }

        this.hide();
    }
}
