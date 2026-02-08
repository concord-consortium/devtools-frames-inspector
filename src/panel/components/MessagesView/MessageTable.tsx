// MessageTable component for Messages view

import { observer } from 'mobx-react-lite';
import { store } from '../../store';
import { ALL_COLUMNS } from '../../types';
import { getColumnLabel } from '../../field-info';
import { Message } from '../../Message';

// Column header with resize handle
const ColumnHeader = observer(({ columnId }: { columnId: string }) => {
  const column = ALL_COLUMNS.find(c => c.id === columnId);
  if (!column) return null;

  const handleClick = (e: React.MouseEvent) => {
    // Don't sort if clicking on resize handle
    if ((e.target as HTMLElement).classList.contains('column-resize-handle')) {
      return;
    }
    store.setSort(columnId);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    showColumnMenu(e.clientX, e.clientY);
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startColumnResize(columnId, e.clientX);
  };

  const sortClass =
    store.sortColumn === columnId
      ? store.sortDirection === 'asc'
        ? 'sort-asc'
        : 'sort-desc'
      : '';

  return (
    <th
      data-column={columnId}
      style={{ width: store.columnWidths[columnId] + 'px' }}
      className={sortClass}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {getColumnLabel(column.id)}
      <div
        className="column-resize-handle"
        onMouseDown={handleResizeMouseDown}
      />
    </th>
  );
});

// Column resize state (module-level for event handlers)
let resizingColumnId: string | null = null;
let resizeStartX = 0;
let resizeStartWidth = 0;

function startColumnResize(columnId: string, clientX: number) {
  resizingColumnId = columnId;
  resizeStartX = clientX;
  resizeStartWidth = store.columnWidths[columnId];
  document.body.style.cursor = 'col-resize';
}

// Global mouse handlers for column resize
if (typeof document !== 'undefined') {
  document.addEventListener('mousemove', (e) => {
    if (!resizingColumnId) return;
    const diff = e.clientX - resizeStartX;
    const newWidth = Math.max(40, resizeStartWidth + diff);
    store.setColumnWidth(resizingColumnId, newWidth);
  });

  document.addEventListener('mouseup', () => {
    if (resizingColumnId) {
      document.body.style.cursor = '';
      resizingColumnId = null;
    }
  });
}

// Column menu helper
function showColumnMenu(x: number, y: number) {
  const menu = document.getElementById('column-menu');
  if (!menu) return;

  menu.innerHTML = '';

  ALL_COLUMNS.forEach(col => {
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.innerHTML = `
      <label>
        <input type="checkbox" ${store.visibleColumns[col.id] ? 'checked' : ''}>
        ${getColumnLabel(col.id)}
      </label>
    `;

    const input = item.querySelector('input')!;
    input.addEventListener('change', (e) => {
      store.setColumnVisible(col.id, (e.target as HTMLInputElement).checked);
    });

    menu.appendChild(item);
  });

  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.add('visible');
}

// Cell menu helper
let cellMenuContext: { msg: Message; colId: string } | null = null;

function showCellMenu(e: React.MouseEvent, msg: Message, colId: string) {
  e.preventDefault();
  cellMenuContext = { msg, colId };

  const menu = document.getElementById('cell-menu');
  if (!menu) return;

  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.classList.add('visible');
}

// Set up filter-by-value handler (once)
if (typeof document !== 'undefined') {
  const filterByValue = document.getElementById('filter-by-value');
  if (filterByValue) {
    filterByValue.addEventListener('click', () => {
      if (!cellMenuContext) return;

      const { msg, colId } = cellMenuContext;
      let filterStr = '';

      switch (colId) {
        case 'messageType':
          filterStr = `type:${msg.messageType || ''}`;
          break;
        case 'target.document.origin':
          filterStr = `target:${store.getCellValue(msg, colId)}`;
          break;
        case 'source.document.origin':
          filterStr = `source:${store.getCellValue(msg, colId)}`;
          break;
        case 'direction':
        case 'sourceType':
          filterStr = `sourceType:${msg.sourceType}`;
          break;
        default:
          filterStr = store.getCellValue(msg, colId);
      }

      store.setFilter(filterStr);
    });
  }

  // Hide menus on click outside
  document.addEventListener('click', () => {
    document.getElementById('column-menu')?.classList.remove('visible');
    document.getElementById('cell-menu')?.classList.remove('visible');
  });
}

// Message row component
const MessageRow = observer(({ message }: { message: Message }) => {
  const isSelected = message.id === store.selectedMessageId;

  const handleClick = () => {
    store.selectMessage(message.id);
  };

  return (
    <tr
      data-id={message.id}
      className={isSelected ? 'selected' : ''}
      onClick={handleClick}
    >
      {ALL_COLUMNS.map(col => {
        if (!store.visibleColumns[col.id]) return null;

        const value = store.getCellValue(message, col.id);
        const dirClass = col.id === 'direction' ? `dir-${message.sourceType}` : '';

        return (
          <td
            key={col.id}
            data-column={col.id}
            className={dirClass}
            onContextMenu={(e) => showCellMenu(e, message, col.id)}
          >
            {value}
          </td>
        );
      })}
    </tr>
  );
});

// Main table component
export const MessageTable = observer(() => {
  const visibleColumnIds = ALL_COLUMNS.filter(c => store.visibleColumns[c.id]).map(c => c.id);

  return (
    <div className="table-pane">
      <table id="message-table">
        <thead>
          <tr>
            {visibleColumnIds.map(colId => (
              <ColumnHeader key={colId} columnId={colId} />
            ))}
          </tr>
        </thead>
        <tbody>
          {store.filteredMessages.map(msg => (
            <MessageRow key={msg.id} message={msg} />
          ))}
        </tbody>
      </table>
    </div>
  );
});
