import { getColumnLabel } from './field-info';

describe('getColumnLabel', () => {
  it('returns the label for a top-level field', () => {
    expect(getColumnLabel('messageType')).toBe('Type');
  });

  it('prepends "Target" for target-prefixed fields', () => {
    expect(getColumnLabel('target.document.origin')).toBe('Target Document Origin');
  });

  it('prepends "Source" for source-prefixed fields', () => {
    expect(getColumnLabel('source.ownerElement.src')).toBe('Source Iframe Src');
  });

  it('returns the raw ID when no label is found', () => {
    expect(getColumnLabel('unknownField')).toBe('unknownField');
  });
});
