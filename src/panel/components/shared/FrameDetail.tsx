// Shared FrameDetail component - renders Frame info for both message detail and hierarchy views

import { observer } from 'mobx-react-lite';
import type { Frame } from '../../models/Frame';
import type { FrameDocument } from '../../models/FrameDocument';
import type { OwnerElement } from '../../models/OwnerElement';
import { store } from '../../store';
import { FIELD_INFO } from '../../field-info';
import { FieldLabel } from './FieldInfoPopup';

const Field = ({ id, children }: { id: string; children: React.ReactNode }) => {
  const fieldInfo = FIELD_INFO[id];
  const label = fieldInfo ? fieldInfo.label : id;

  return (
    <tr>
      <th>
        {fieldInfo ? (
          <FieldLabel fieldId={id} label={label} />
        ) : (
          label
        )}
      </th>
      <td>{children}</td>
    </tr>
  );
};

interface FrameDetailProps {
  frame: Frame | undefined;
  document?: FrameDocument | undefined;
  ownerElement?: OwnerElement | undefined;
  sourceType?: string | undefined;
}

export const FrameDetail = observer(({ frame, document: docOverride, ownerElement: ownerOverride, sourceType }: FrameDetailProps) => {
  const doc = docOverride ?? frame?.currentDocument;
  const owner = ownerOverride ?? frame?.currentOwnerElement;

  return (
    <>
      {sourceType && (
        <Field id="sourceType">{store.getDirectionIcon(sourceType)} {sourceType}</Field>
      )}
      {frame && (
        <Field id="frameId">{`frame[${frame.frameId}]`}</Field>
      )}
      {doc?.url && (
        <Field id="document.url">{doc.url}</Field>
      )}
      {doc?.origin && (
        <Field id="document.origin">{doc.origin}</Field>
      )}
      {doc?.title && (
        <Field id="document.title">{doc.title}</Field>
      )}
      {frame && frame.parentFrameId !== -1 && (
        <Field id="parentFrameId">{`frame[${frame.parentFrameId}]`}</Field>
      )}
      {owner && (
        <>
          {owner.domPath && (
            <Field id="ownerElement.domPath">{owner.domPath}</Field>
          )}
          {owner.src && (
            <Field id="ownerElement.src">{owner.src}</Field>
          )}
          {owner.id && (
            <Field id="ownerElement.id">{owner.id}</Field>
          )}
        </>
      )}
    </>
  );
});
