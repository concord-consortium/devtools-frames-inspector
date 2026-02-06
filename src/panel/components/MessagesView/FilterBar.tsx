// FilterBar component for Messages view

import { observer } from 'mobx-react-lite';
import { store } from '../../store';

export const FilterBar = observer(() => {
  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    store.setFilter(e.target.value);
  };

  return (
    <div className="filter-bar">
      <input
        type="text"
        className="filter-input"
        placeholder="Filter (e.g., type:resize, -origin:react)"
        value={store.filterText}
        onChange={handleFilterChange}
      />
    </div>
  );
});
