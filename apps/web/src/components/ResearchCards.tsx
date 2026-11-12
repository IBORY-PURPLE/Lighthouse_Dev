"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  addAlt,
  allowedPhotoKinds,
  benefitShortcuts,
  refShortcuts,
  removeAlt,
  RESEARCH_CARDS,
  RESEARCH_COPY,
  RESEARCH_LIMITS,
  setPhotoDescription,
  siteNameOf,
  toggleChecked,
  withPurchase,
  type CardId,
  type LinkRef,
  type PhotoKind,
  type ResearchItem,
  type ResearchLink,
  type ResearchResponse,
  type ResearchShortcut,
  type ResearchState,
} from "@/lib/research";

// 리서치 챗의 카드 7장 본문(가운데 스크롤 영역). 질문 머리는 ResearchChat이 그린다.
// AI 제안은 늘 "AI 제안 · 확인 필요" 상자 안에 둬서 봉사자 입력과 구분한다.

export type HelpStatus = "loading" | "failed" | undefined;

/** 사진 카드가 컨테이너에서 받는 동작. */
export interface PhotoActions {
  uploading: boolean;
  describingIndex: number | null;
  onFiles: (files: File[], kind: PhotoKind) => void;
  onRemove: (index: number) => void;
  onDescribe: (index: number) => void;
}

export interface CardBodyProps {
  id: CardId;
  state: ResearchState;
  update: (change: (current: ResearchState) => ResearchState) => void;
  help: ResearchResponse | null;
  helpStatus: HelpStatus;
  /** 요청의 브랜드·품목. 직접 찾기 바로가기의 검색어. */
  subject: string;
  retry: () => void;
  photo: PhotoActions;
  /** 상태 알림(StatusRegion)에 한 줄을 알린다. */
  onStatus: (message: string) => void;
}

// 공용 문구에 없는 카드별 안내(찾는 중·못 찾음). 말투는 해요체.
export const SEARCH_COPY = {
  model: { searching: RESEARCH_COPY.model.searching, failed: RESEARCH_COPY.model.failed },
  alts: {
    searching: "비슷한 기종을 찾는 중이에요.",
    failed: "AI가 비슷한 기종을 찾지 못했어요. 쇼핑몰에서 직접 확인해 주세요.",
  },
  benefits: { searching: "혜택 관련 페이지를 찾는 중이에요.", failed: RESEARCH_COPY.benefits.notFound },
  refs: { searching: "참고 글을 찾는 중이에요.", failed: RESEARCH_COPY.refs.notFound },
} as const;

export const RETRY_LABEL = "다시 찾기";
const FIXED_NOTE = "시연용 고정 후보";
const SOURCE_LABEL = "출처 보기";
const PHOTO_DESCRIBING = "사진 설명을 만드는 중이에요.";
const AI_QUESTION_TITLE = "AI 질문";

export { AI_QUESTION_TITLE, PHOTO_DESCRIBING };

function AiBox({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  const titleId = `${testId}-title`;
  return (
    <section className="rc-ai" data-testid={testId} aria-labelledby={titleId}>
      <div className="rc-ai-head">
        <h3 id={titleId} className="rc-ai-title">
          <span className="rc-ai-kicker">{RESEARCH_COPY.aiBoxTitle}</span>
          {title}
        </h3>
        <span className="vol-chip vol-chip--outline">{RESEARCH_COPY.aiBoxMark}</span>
      </div>
      {children}
    </section>
  );
}

function Searching({ text }: { text: string }) {
  return (
    <div className="rc-searching" data-testid="ai-searching">
      <p className="rc-ai-text">{text}</p>
      <span className="rc-skeleton" aria-hidden="true" />
      <span className="rc-skeleton rc-skeleton--short" aria-hidden="true" />
    </div>
  );
}

function Shortcuts({ items, heading }: { items: ResearchShortcut[]; heading?: string }) {
  return (
    <div className="rc-shortcuts" data-testid="shortcuts">
      {heading && <p className="rc-ai-sub">{heading}</p>}
      <div className="rc-shortcut-row">
        {items.map((shortcut) => (
          <a
            key={shortcut.url}
            className="vol-btn vol-btn--secondary vol-btn--small"
            href={shortcut.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {shortcut.label}
          </a>
        ))}
      </div>
    </div>
  );
}

function RetryButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      className="vol-btn vol-btn--secondary vol-btn--small rc-retry"
      aria-disabled={disabled ? true : undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      {RETRY_LABEL}
    </button>
  );
}

/** 후보 칩 상자(카드 1·4). 칩을 누르면 onPick. */
function CandidateBox({
  title,
  kind,
  help,
  helpStatus,
  subject,
  retry,
  isPicked,
  onPick,
}: {
  title: string;
  kind: "model" | "alts";
  help: ResearchResponse | null;
  helpStatus: HelpStatus;
  subject: string;
  retry: () => void;
  isPicked: (item: ResearchItem) => boolean;
  onPick: (item: ResearchItem) => void;
}) {
  const copy = SEARCH_COPY[kind];
  const loading = helpStatus === "loading" || (help === null && helpStatus !== "failed");
  const items: ResearchItem[] = help && (help.kind === "model" || help.kind === "alts") ? help.items : [];
  const hasFixed = items.some((item) => item.origin === "fixed");
  return (
    <AiBox title={title} testId={`ai-${kind}`}>
      {loading ? (
        <Searching text={copy.searching} />
      ) : items.length === 0 ? (
        <>
          <p className="rc-ai-text" data-testid="ai-failed">
            {copy.failed}
          </p>
          <Shortcuts items={benefitShortcuts(subject)} />
        </>
      ) : (
        <>
          {hasFixed && <p className="rc-ai-sub">{FIXED_NOTE}</p>}
          <ul className="rc-chips">
            {items.map((item) => {
              const picked = isPicked(item);
              return (
                <li key={item.name} className="rc-chip-item">
                  <button
                    type="button"
                    className="rc-chip"
                    data-testid="candidate-chip"
                    aria-pressed={picked}
                    onClick={() => onPick(item)}
                  >
                    <span className="rc-chip-name">{item.name}</span>
                    {item.note && <span className="rc-chip-note">{item.note}</span>}
                  </button>
                  {item.url && (
                    <a
                      className="rc-source"
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${item.name} ${SOURCE_LABEL}`}
                    >
                      {SOURCE_LABEL}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {!loading && <RetryButton onClick={retry} disabled={false} />}
    </AiBox>
  );
}

/** 힌트 상자(카드 2·5). 힌트가 없으면(실패·기본 질문) 상자를 그리지 않는다. */
function HintBox({ title, help }: { title: string; help: ResearchResponse | null }) {
  const hints = help && (help.kind === "pros" || help.kind === "altReason") ? help.hints : [];
  if (hints.length === 0) return null;
  return (
    <AiBox title={title} testId="ai-hints">
      <ul className="rc-hints">
        {hints.map((hint) => (
          <li key={hint}>{hint}</li>
        ))}
      </ul>
    </AiBox>
  );
}

/** 링크 줄(카드 6·7): 제목, 사이트 이름, 열기, 확인했어요 체크. 체크한 것만 결과에 들어간다. */
function LinkRows({
  links,
  checked,
  onToggle,
}: {
  links: ResearchLink[];
  checked: LinkRef[];
  onToggle: (link: LinkRef) => void;
}) {
  return (
    <ul className="rc-links">
      {links.map((link, index) => {
        const titleId = `rc-link-title-${index}`;
        const isChecked = checked.some((entry) => entry.url === link.url);
        return (
          <li key={link.url} className="rc-link" data-testid="link-row">
            <p id={titleId} className="rc-link-title">
              {link.title}
            </p>
            <p className="rc-link-site">{siteNameOf(link.url)}</p>
            <div className="rc-link-actions">
              <a
                className="vol-btn vol-btn--secondary vol-btn--small"
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-describedby={titleId}
              >
                {RESEARCH_COPY.benefits.open}
              </a>
              <label className="rc-check">
                <input
                  type="checkbox"
                  checked={isChecked}
                  aria-describedby={titleId}
                  onChange={() => onToggle({ title: link.title, url: link.url })}
                />
                {RESEARCH_COPY.benefits.check}
              </label>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function TextAnswer({
  id,
  label,
  placeholder,
  value,
  max,
  visibleLabel,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  max: number;
  visibleLabel?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="rc-answer">
      <label htmlFor={id} className={visibleLabel ? "vol-label rc-label" : "vol-sr"}>
        {label}
      </label>
      <textarea
        id={id}
        className="vol-input vol-textarea"
        value={value}
        maxLength={max}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

const cardName = (id: CardId) => RESEARCH_CARDS.find((card) => card.id === id)?.name ?? "";

function ModelCard({ state, update, help, helpStatus, subject, retry }: CardBodyProps) {
  const purchaseOptions = [
    { value: "bought", label: RESEARCH_COPY.model.bought },
    { value: "research", label: RESEARCH_COPY.model.research },
  ] as const;
  return (
    <>
      <CandidateBox
        title={RESEARCH_COPY.model.candidatesTitle}
        kind="model"
        help={help}
        helpStatus={helpStatus}
        subject={subject}
        retry={retry}
        isPicked={(item) => state.model.trim() === item.name}
        onPick={(item) =>
          update((current) => ({ ...current, model: [...item.name].slice(0, RESEARCH_LIMITS.nameMax).join("") }))
        }
      />
      <div className="rc-answer">
        <label htmlFor="rc-model" className="vol-label rc-label">
          {RESEARCH_COPY.model.inputLabel}
        </label>
        <input
          id="rc-model"
          type="text"
          className="vol-input"
          value={state.model}
          maxLength={RESEARCH_LIMITS.nameMax}
          placeholder={RESEARCH_COPY.model.inputExample}
          onChange={(event) => update((current) => ({ ...current, model: event.target.value }))}
        />
      </div>
      <fieldset className="rc-purchase">
        <legend className="vol-label rc-label">{RESEARCH_COPY.model.purchaseQuestion}</legend>
        {purchaseOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`vol-btn rc-purchase-btn${state.purchase === option.value ? "" : " vol-btn--secondary"}`}
            aria-pressed={state.purchase === option.value}
            onClick={() => update((current) => withPurchase(current, option.value))}
          >
            {option.label}
          </button>
        ))}
      </fieldset>
    </>
  );
}

function ProsCard({ state, update, help }: CardBodyProps) {
  return (
    <>
      <HintBox title={RESEARCH_COPY.pros.hintsTitle} help={help} />
      <TextAnswer
        id="rc-pros"
        label={cardName("pros")}
        placeholder={RESEARCH_COPY.pros.inputExample}
        value={state.pros}
        max={RESEARCH_LIMITS.answerMax}
        onChange={(value) => update((current) => ({ ...current, pros: value }))}
      />
    </>
  );
}

function PhotoCard({ state, update, photo, onStatus }: CardBodyProps) {
  const [kindChoice, setKindChoice] = useState<PhotoKind>("proof");
  const inputRef = useRef<HTMLInputElement>(null);
  const allowed = allowedPhotoKinds(state.purchase);
  const kind: PhotoKind = allowed.includes(kindChoice) ? kindChoice : "detail";
  const full = state.photos.length >= RESEARCH_LIMITS.maxPhotos;
  const kinds: { value: PhotoKind; label: string }[] = [
    { value: "proof", label: RESEARCH_COPY.photo.proof },
    { value: "detail", label: RESEARCH_COPY.photo.detail },
  ];
  const kindLabel = (value: PhotoKind) => (value === "proof" ? RESEARCH_COPY.photo.proof : RESEARCH_COPY.photo.detail);
  return (
    <>
      <div className="rc-kinds" role="group" aria-label={cardName("photo")}>
        {kinds.map((entry) => {
          const disabled = !allowed.includes(entry.value);
          return (
            <button
              key={entry.value}
              type="button"
              className={`vol-btn rc-kind${kind === entry.value ? "" : " vol-btn--secondary"}`}
              aria-pressed={kind === entry.value}
              aria-disabled={disabled ? true : undefined}
              onClick={() => {
                if (disabled) {
                  onStatus(`리서치만 하면 ${RESEARCH_COPY.photo.detail}만 올릴 수 있어요.`);
                  return;
                }
                setKindChoice(entry.value);
              }}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <ul className="rc-thumbs" data-testid="photo-list">
        {state.photos.map((item, index) => (
          <li key={`${index}-${item.thumb.length}`} className="rc-thumb-cell" data-testid="photo-item">
            <span className="rc-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element -- 기기에서 만든 data URL 미리보기라 최적화 대상이 아니다. */}
              <img src={item.thumb} alt={`올린 사진 ${index + 1}`} className="rc-thumb-img" />
              <span className="rc-thumb-tag">{kindLabel(item.kind)}</span>
            </span>
            <button
              type="button"
              className="rc-thumb-remove"
              aria-label={`사진 ${index + 1} 지우기`}
              onClick={() => photo.onRemove(index)}
            >
              지우기
            </button>
          </li>
        ))}
        {!full && (
          <li className="rc-thumb-cell">
            <button
              type="button"
              className="rc-add-photo rc-thumb rc-thumb--add"
              aria-disabled={photo.uploading ? true : undefined}
              onClick={() => {
                if (!photo.uploading) inputRef.current?.click();
              }}
            >
              <span aria-hidden="true" className="rc-add-plus">
                +
              </span>
              {RESEARCH_COPY.photo.upload}
            </button>
          </li>
        )}
      </ul>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-testid="photo-input"
        aria-label={RESEARCH_COPY.photo.upload}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) photo.onFiles(files, kind);
        }}
      />

      {state.photos.length > 0 && (
        <AiBox title={RESEARCH_COPY.photo.descriptionTitle} testId="ai-photo">
          {state.photos.map((item, index) => {
            const describing = photo.describingIndex === index;
            return (
              <div key={`${index}-${item.thumb.length}`} className="rc-describe">
                <label htmlFor={`rc-photo-desc-${index}`} className="vol-label rc-label">
                  {`사진 ${index + 1} 설명`}
                </label>
                <textarea
                  id={`rc-photo-desc-${index}`}
                  className="vol-input vol-textarea rc-textarea--short"
                  value={item.description}
                  maxLength={RESEARCH_LIMITS.descriptionMax}
                  onChange={(event) => update((current) => setPhotoDescription(current, index, event.target.value))}
                />
                <button
                  type="button"
                  className="vol-btn vol-btn--secondary vol-btn--small"
                  aria-disabled={describing ? true : undefined}
                  aria-label={`${RESEARCH_COPY.photo.describe} (사진 ${index + 1})`}
                  onClick={() => {
                    if (!describing) photo.onDescribe(index);
                  }}
                >
                  {describing ? PHOTO_DESCRIBING : RESEARCH_COPY.photo.describe}
                </button>
              </div>
            );
          })}
        </AiBox>
      )}
      <p className="vol-foot">{RESEARCH_COPY.photo.privacy}</p>
    </>
  );
}

function AltsCard({ state, update, help, helpStatus, subject, retry, onStatus }: CardBodyProps) {
  const [draft, setDraft] = useState("");
  const full = state.alts.length >= RESEARCH_LIMITS.maxAlts;
  const submit = () => {
    if (draft.trim() === "") return;
    const next = addAlt(state, draft);
    if (next === state) {
      onStatus(full ? RESEARCH_COPY.alts.limitNote : "이미 넣었거나 기종과 같은 이름이에요.");
      return;
    }
    update((current) => addAlt(current, draft));
    setDraft("");
  };
  return (
    <>
      <CandidateBox
        title={RESEARCH_COPY.alts.candidatesTitle}
        kind="alts"
        help={help}
        helpStatus={helpStatus}
        subject={subject}
        retry={retry}
        isPicked={(item) => state.alts.includes(item.name)}
        onPick={(item) => {
          if (state.alts.includes(item.name)) return;
          if (full) {
            onStatus(RESEARCH_COPY.alts.limitNote);
            return;
          }
          update((current) => addAlt(current, item.name));
        }}
      />
      <ul className="rc-picked" data-testid="alt-list">
        {state.alts.map((alt) => (
          <li key={alt} className="rc-picked-item">
            <span className="rc-picked-name">{alt}</span>
            <button
              type="button"
              className="rc-picked-remove"
              aria-label={`${alt} 빼기`}
              onClick={() => update((current) => removeAlt(current, alt))}
            >
              빼기
            </button>
          </li>
        ))}
      </ul>
      <form
        className="rc-add-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="rc-add-field">
          <label htmlFor="rc-alt" className="vol-label rc-label">
            {RESEARCH_COPY.alts.inputLabel}
          </label>
          <input
            id="rc-alt"
            type="text"
            className="vol-input"
            value={draft}
            maxLength={RESEARCH_LIMITS.nameMax}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <button type="submit" className="vol-btn vol-btn--secondary" aria-disabled={full ? true : undefined}>
          {RESEARCH_COPY.alts.add}
        </button>
      </form>
      <p className="vol-foot">{RESEARCH_COPY.alts.limitNote}</p>
    </>
  );
}

function AltReasonCard({ state, update, help }: CardBodyProps) {
  return (
    <>
      <HintBox title={RESEARCH_COPY.pros.hintsTitle} help={help} />
      <TextAnswer
        id="rc-alt-reason"
        label={cardName("altReason")}
        placeholder={RESEARCH_COPY.altReason.inputExample}
        value={state.altReason}
        max={RESEARCH_LIMITS.answerMax}
        onChange={(value) => update((current) => ({ ...current, altReason: value }))}
      />
    </>
  );
}

/** 링크 상자(카드 6·7). 링크를 못 찾았으면 "직접 확인 필요"와 바로가기를 보인다. */
function LinkBox({
  kind,
  title,
  help,
  helpStatus,
  state,
  update,
  subject,
  retry,
}: CardBodyProps & { kind: "benefits" | "refs"; title: string }) {
  const copy = SEARCH_COPY[kind];
  const loading = helpStatus === "loading" || (help === null && helpStatus !== "failed");
  const links: ResearchLink[] = help && (help.kind === "benefits" || help.kind === "refs") ? help.links : [];
  const digest = help && help.kind === "refs" ? help.digest : [];
  const shortcuts =
    help && (help.kind === "benefits" || help.kind === "refs") && help.shortcuts.length > 0
      ? help.shortcuts
      : kind === "benefits"
        ? benefitShortcuts(subject)
        : refShortcuts(subject);
  const notFound = !loading && links.length === 0 && digest.length === 0;
  return (
    <AiBox title={title} testId={`ai-${kind}`}>
      {loading ? (
        <Searching text={copy.searching} />
      ) : (
        <>
          {digest.length > 0 && (
            <ul className="rc-hints" data-testid="ai-digest">
              {digest.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {links.length > 0 && (
            <LinkRows
              links={links}
              checked={state.checked[kind]}
              onToggle={(link) => update((current) => toggleChecked(current, kind, link))}
            />
          )}
          {notFound ? (
            <>
              <p className="rc-ai-text" data-testid="ai-failed">
                {kind === "benefits" ? RESEARCH_COPY.benefits.notFound : RESEARCH_COPY.refs.notFound}
              </p>
              <Shortcuts items={shortcuts} />
            </>
          ) : (
            <Shortcuts items={shortcuts} />
          )}
          <RetryButton onClick={retry} disabled={false} />
        </>
      )}
    </AiBox>
  );
}

function BenefitsCard(props: CardBodyProps) {
  const { state, update } = props;
  return (
    <>
      <TextAnswer
        id="rc-benefits"
        label={cardName("benefits")}
        placeholder={RESEARCH_COPY.benefits.inputExample}
        value={state.benefits}
        max={RESEARCH_LIMITS.answerMax}
        onChange={(value) => update((current) => ({ ...current, benefits: value }))}
      />
      <LinkBox {...props} kind="benefits" title={RESEARCH_COPY.benefits.linksTitle} />
    </>
  );
}

function RefsCard(props: CardBodyProps) {
  const { state, update } = props;
  return (
    <>
      <LinkBox {...props} kind="refs" title={RESEARCH_COPY.refs.digestTitle} />
      <TextAnswer
        id="rc-refs"
        label={RESEARCH_COPY.refs.inputHint}
        visibleLabel
        placeholder={RESEARCH_COPY.refs.inputHint}
        value={state.refs}
        max={RESEARCH_LIMITS.answerMax}
        onChange={(value) => update((current) => ({ ...current, refs: value }))}
      />
    </>
  );
}

/** 현재 카드의 본문. 한 번에 한 장만 그린다. */
export function ResearchCardBody(props: CardBodyProps) {
  switch (props.id) {
    case "model":
      return <ModelCard {...props} />;
    case "pros":
      return <ProsCard {...props} />;
    case "photo":
      return <PhotoCard {...props} />;
    case "alts":
      return <AltsCard {...props} />;
    case "altReason":
      return <AltReasonCard {...props} />;
    case "benefits":
      return <BenefitsCard {...props} />;
    case "refs":
      return <RefsCard {...props} />;
  }
}
