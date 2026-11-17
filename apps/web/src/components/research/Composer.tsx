"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, type FormEvent, type KeyboardEvent } from "react";
import { Icon } from "./Icon";

export interface ComposerHandle {
  focus: () => void;
}

/**
 * 봉사자 입력창. 히어로와 대화 하단 고정이 같은 DOM이고 variant 클래스만 바뀐다(입력 중인 글이 유지된다).
 * Enter로 보내고 Shift+Enter로 줄을 바꾼다(한글 조합 중 Enter는 보내지 않는다). 마이크는 없다(D안).
 */
export const Composer = forwardRef<
  ComposerHandle,
  {
    variant: "hero" | "docked";
    value: string;
    placeholder: string;
    attachVisible: boolean;
    attachOpen: boolean;
    readOnly?: boolean;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onToggleAttach: () => void;
    attachButtonRef?: React.Ref<HTMLButtonElement>;
  }
>(function Composer(
  { variant, value, placeholder, attachVisible, attachOpen, readOnly, onChange, onSubmit, onToggleAttach, attachButtonRef },
  ref,
) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => areaRef.current?.focus() }), []);

  // 글이 길어지면 칸이 따라 늘어난다(최대 160px).
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 160)}px`;
  }, [value, variant]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const empty = value.trim() === "";
  return (
    <form className={`vc-composer vc-composer--${variant}`} onSubmit={submit} aria-label="답 입력">
      <label htmlFor="vc-composer-input" className="vol-sr">
        답을 적어 주세요
      </label>
      <textarea
        ref={areaRef}
        id="vc-composer-input"
        className="vc-composer-input"
        rows={1}
        value={value}
        placeholder={placeholder}
        maxLength={1000}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="vc-composer-tools">
        {attachVisible && (
          <button
            ref={attachButtonRef}
            type="button"
            className="vc-icon-btn"
            aria-label="사진 올리기"
            aria-haspopup="dialog"
            aria-expanded={attachOpen}
            onClick={onToggleAttach}
          >
            <Icon name="plus" />
          </button>
        )}
        <span className="vc-composer-gap" />
        <button type="submit" className="vc-send" aria-label="답 보내기" aria-disabled={empty ? true : undefined}>
          <Icon name="send" />
        </button>
      </div>
    </form>
  );
});
