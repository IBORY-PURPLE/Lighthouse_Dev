"use client";

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

/**
 * 사진 올리기 창(끌어 놓기·파일 고르기). 구매 인증용 사진만 받는다. 사진을 지금 묻는 중이면 [휴대폰으로 찍기]가 함께 나온다(QR 창).
 * 창이 열리면 파일 입력으로 초점이 가고, Esc나 [닫기]로 닫으면 호출한 버튼으로 돌아간다.
 */
export function AttachSheet({
  uploading,
  full,
  phoneVisible,
  onFiles,
  onPhone,
  onClose,
}: {
  uploading: boolean;
  full: boolean;
  /** 사진 칸 질문이 지금 질문일 때만 [휴대폰으로 찍기]를 보인다. */
  phoneVisible: boolean;
  onFiles: (files: File[]) => void;
  onPhone: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const take = (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (files.length > 0) onFiles(files);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    take(event.dataTransfer.files);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="vc-attach" role="dialog" aria-label="사진 올리기" onKeyDown={onKeyDown}>
      <div
        className={`vc-drop${over ? " vc-drop--over" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <p className="vc-drop-title">사진을 여기에 끌어 놓으세요</p>
        <p className="vc-drop-note">직접 찍은 착용 사진이나 실제 가지고 있는 모습이면 돼요. 상세 페이지 캡처는 받지 않아요.</p>
        <label className={`vc-btn${full || uploading ? " vc-btn--off" : ""}`}>
          파일 고르기
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="vc-file"
            disabled={full || uploading}
            onChange={(event) => {
              take(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        {phoneVisible && (
          <button type="button" className="vc-btn" aria-disabled={full || uploading ? true : undefined} onClick={() => !full && !uploading && onPhone()}>
            휴대폰으로 찍기
          </button>
        )}
        {full && <p className="vc-drop-note">사진은 3장까지 올릴 수 있어요.</p>}
      </div>
      <button type="button" className="vc-btn vc-btn--ghost" onClick={onClose}>
        닫기
      </button>
    </div>
  );
}
