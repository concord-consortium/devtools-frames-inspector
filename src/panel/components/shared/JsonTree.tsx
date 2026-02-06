// JSON tree viewer component

import { useState } from 'react';

interface JsonValueProps {
  value: unknown;
  keyName?: string | number | null;
}

export const JsonValue = ({ value, keyName = null }: JsonValueProps) => {
  const [collapsed, setCollapsed] = useState(false);

  if (value === null) {
    return (
      <div>
        {keyName !== null && <span className="json-key">"{keyName}"</span>}
        {keyName !== null && ': '}
        <span className="json-null">null</span>
      </div>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <div>
        {keyName !== null && <span className="json-key">"{keyName}"</span>}
        {keyName !== null && ': '}
        <span className="json-boolean">{String(value)}</span>
      </div>
    );
  }

  if (typeof value === 'number') {
    return (
      <div>
        {keyName !== null && <span className="json-key">"{keyName}"</span>}
        {keyName !== null && ': '}
        <span className="json-number">{value}</span>
      </div>
    );
  }

  if (typeof value === 'string') {
    const escaped = value.replace(/"/g, '\\"');
    return (
      <div>
        {keyName !== null && <span className="json-key">"{keyName}"</span>}
        {keyName !== null && ': '}
        <span className="json-string">"{escaped}"</span>
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div>
        <span
          className={`json-toggle ${collapsed ? 'collapsed' : ''}`}
          onClick={() => setCollapsed(!collapsed)}
        >
          {keyName !== null && <span className="json-key">"{keyName}"</span>}
          {keyName !== null && ': '}
          Array({value.length})
        </span>
        {!collapsed && (
          <div className="json-children">
            {value.map((item, i) => (
              <JsonValue key={i} value={item} keyName={i} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    return (
      <div>
        <span
          className={`json-toggle ${collapsed ? 'collapsed' : ''}`}
          onClick={() => setCollapsed(!collapsed)}
        >
          {keyName !== null && <span className="json-key">"{keyName}"</span>}
          {keyName !== null && ': '}
          {'{...}'}
        </span>
        {!collapsed && (
          <div className="json-children">
            {keys.map(k => (
              <JsonValue key={k} value={(value as Record<string, unknown>)[k]} keyName={k} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return <div>{String(value)}</div>;
};

export const JsonTree = ({ data }: { data: unknown }) => {
  return (
    <div className="json-tree">
      <JsonValue value={data} />
    </div>
  );
};
