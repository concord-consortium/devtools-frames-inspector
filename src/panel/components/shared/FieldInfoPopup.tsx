// Field info popup component

import { useCallback, useEffect, useRef, useState } from 'react';
import { FIELD_INFO, FieldInfoEntry } from '../../field-info';

interface PopupState {
  visible: boolean;
  fieldId: string | null;
  x: number;
  y: number;
}

// Global popup state manager
let popupState: PopupState = {
  visible: false,
  fieldId: null,
  x: 0,
  y: 0
};

let popupShowTimeout: ReturnType<typeof setTimeout> | null = null;
let popupHideTimeout: ReturnType<typeof setTimeout> | null = null;
let isMouseOverPopup = false;
let isMouseOverLabel = false;
let currentLabelElement: HTMLElement | null = null;
let updatePopupCallback: ((state: PopupState) => void) | null = null;

function scheduleHide() {
  popupHideTimeout = setTimeout(() => {
    if (!isMouseOverPopup && !isMouseOverLabel) {
      popupState = { ...popupState, visible: false, fieldId: null };
      updatePopupCallback?.(popupState);
    }
  }, 50);
}

export function showFieldInfoPopup(fieldId: string, labelElement: HTMLElement) {
  if (popupHideTimeout) {
    clearTimeout(popupHideTimeout);
    popupHideTimeout = null;
  }
  if (popupShowTimeout) {
    clearTimeout(popupShowTimeout);
  }

  if (popupState.fieldId === fieldId) {
    return;
  }

  isMouseOverLabel = true;
  currentLabelElement = labelElement;

  popupShowTimeout = setTimeout(() => {
    const rect = labelElement.getBoundingClientRect();
    popupState = {
      visible: true,
      fieldId,
      x: rect.right,
      y: rect.bottom
    };
    updatePopupCallback?.(popupState);
  }, 200);
}

export function hideFieldInfoPopupOnLeave() {
  isMouseOverLabel = false;
  if (popupShowTimeout) {
    clearTimeout(popupShowTimeout);
    popupShowTimeout = null;
  }
  scheduleHide();
}

// The popup component
export const FieldInfoPopup = () => {
  const [state, setState] = useState<PopupState>(popupState);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    updatePopupCallback = setState;
    return () => {
      updatePopupCallback = null;
    };
  }, []);

  // Update position when popup becomes visible
  useEffect(() => {
    if (state.visible && popupRef.current && currentLabelElement) {
      const labelRect = currentLabelElement.getBoundingClientRect();
      const popupRect = popupRef.current.getBoundingClientRect();

      let left = labelRect.right - popupRect.width;
      let top: number;

      if (labelRect.bottom + popupRect.height <= window.innerHeight) {
        top = labelRect.bottom;
      } else {
        top = labelRect.top - popupRect.height;
      }

      popupRef.current.style.left = Math.max(0, left) + 'px';
      popupRef.current.style.top = Math.max(0, top) + 'px';
    }
  }, [state.visible, state.fieldId]);

  const handleMouseEnter = () => {
    isMouseOverPopup = true;
    if (popupHideTimeout) {
      clearTimeout(popupHideTimeout);
      popupHideTimeout = null;
    }
  };

  const handleMouseLeave = () => {
    isMouseOverPopup = false;
    scheduleHide();
  };

  if (!state.visible || !state.fieldId) {
    return null;
  }

  const fieldInfo = FIELD_INFO[state.fieldId];
  if (!fieldInfo) {
    return null;
  }

  return (
    <div
      ref={popupRef}
      className="field-info-popup visible"
      style={{ left: state.x, top: state.y }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="field-description">{fieldInfo.description}</div>
      {fieldInfo.technical && (
        <div className="field-technical">{fieldInfo.technical}</div>
      )}
      {fieldInfo.filter && (
        <div className="field-filter">
          Filter: <code>{fieldInfo.filter}</code>
        </div>
      )}
    </div>
  );
};

// Label component that shows popup on hover
export const FieldLabel = ({ fieldId, label }: { fieldId: string; label: string }) => {
  const handleMouseEnter = (e: React.MouseEvent<HTMLSpanElement>) => {
    showFieldInfoPopup(fieldId, e.currentTarget);
  };

  const handleMouseLeave = () => {
    hideFieldInfoPopupOnLeave();
  };

  return (
    <span
      className="has-info"
      data-field-id={fieldId}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {label}
    </span>
  );
};
