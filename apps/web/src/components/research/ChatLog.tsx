"use client";

import { Fragment, type ReactNode } from "react";
import { BenefitResults } from "./BenefitResults";
import { FoldedTopic } from "./FoldedTopic";
import { GuideCard } from "./GuideCard";
import { LinkCard } from "./LinkCard";
import { MessageBubble } from "./MessageBubble";
import { ModelChips } from "./ModelChips";
import { PhotoBubble } from "./PhotoBubble";
import { ProductCards } from "./ProductCards";
import { RequestBrief } from "./RequestBrief";
import { Thinking } from "./Thinking";
import {
  altNames,
  bodyKind,
  mergeBenefitRuns,
  checkedUrls,
  chipsOf,
  guideOf,
  linkOf,
  photoIdOf,
  productsOf,
  shortcutsOf,
  tagLabel,
  textOf,
  type BenefitItem,
  type ChipView,
  type FoldPlan,
  type ThinkingKind,
} from "@/lib/researchChatView";
import type { ChatMessage, PhotoView, SlotMap } from "@/lib/researchClient";
import type { BriefStep } from "@/lib/volunteerView";

export interface ChatActions {
  pickChip: (chip: ChipView) => void;
  own: () => void;
  pickProduct: (name: string) => void;
  noAlts: () => void;
  checkLink: (url: string) => void;
  removePhoto: (photo: PhotoView) => void;
}

/** 이용자 요청 카드(brief 메시지 자리에 그린다). done이면 버튼 없이 전부 펼쳐 보인다. */
export interface BriefView {
  steps: BriefStep[];
  done: boolean;
  onDone: () => void;
}

export interface OptimisticMessage {
  key: string;
  text: string;
}

/** 대화 목록. role="log"라 새 메시지는 조용히 읽힌다. 초점은 입력창에 그대로 둔다. */
export function ChatLog({
  messages,
  photos,
  slots,
  fold,
  foldOpen,
  onToggleFold,
  optimistic,
  thinking,
  uploadingThumb,
  actions,
  brief,
  children,
}: {
  messages: ChatMessage[];
  photos: PhotoView[];
  slots: SlotMap;
  fold: FoldPlan;
  foldOpen: boolean;
  onToggleFold: () => void;
  optimistic: OptimisticMessage[];
  thinking: { kind: ThinkingKind; startedAt: number } | null;
  uploadingThumb: string | null;
  actions: ChatActions;
  brief?: BriefView;
  children?: ReactNode;
}) {
  const names = altNames(slots);
  const checked = checkedUrls(slots);
  const altsLocked = slots.alts?.status === "skipped";

  // 연달아 온 혜택 메시지는 첫 메시지 하나에 모아 카드를 한 장씩 넘겨 본다(뒤 메시지는 그리지 않는다).
  const benefitRuns = mergeBenefitRuns(messages);

  const renderOne = (message: ChatMessage) => {
    const run = benefitRuns.get(message.seq);
    if (run === null) return null;
    const body = message.body;
    const text = textOf(body);
    const photoId = photoIdOf(body);
    if (photoId !== null) {
      const index = photos.findIndex((photo) => photo.id === photoId);
      return (
        <MessageBubble key={message.seq} role="volunteer">
          <PhotoBubble photo={index === -1 ? null : photos[index]} index={index + 1} onRemove={actions.removePhoto} />
        </MessageBubble>
      );
    }
    // 이용자 요청 카드는 이용자가 말한 글이라 AI 말풍선(.vc-row--ai) 안에 넣지 않고, 안내 말풍선 바로 아래 따로 그린다.
    if (brief && bodyKind(body) === "brief") {
      return (
        <Fragment key={message.seq}>
          <MessageBubble role={message.role} tag={tagLabel(message)} text={text} />
          <div className="vc-row vc-brief-row vc-enter">
            <RequestBrief steps={brief.steps} done={brief.done} onDone={brief.onDone} />
          </div>
        </Fragment>
      );
    }
    const isQuestion = message.role === "ai" && message.tag === "question";
    const chips = chipsOf(body);
    const products = productsOf(body);
    const benefits = run ?? null;
    const link = linkOf(body);
    const guide = guideOf(body);
    const shortcuts = shortcutsOf(body);
    const slotDone = (slot: string | null | undefined) => (slot ? Boolean(slots[slot as keyof SlotMap]) : false);
    return (
      <MessageBubble
        key={message.seq}
        role={message.role}
        tag={message.role === "volunteer" ? null : tagLabel(message)}
        text={benefits ? benefits.headline : text}
        id={isQuestion ? `vc-q-${message.seq}` : undefined}
        tabIndex={isQuestion ? -1 : undefined}
      >
        {chips && (
          <ModelChips
            caption={chips.caption}
            chips={chips.chips}
            ownLabel={chips.ownLabel}
            disabled={slotDone(chips.chips[0]?.slot)}
            onPick={actions.pickChip}
            onOwn={actions.own}
          />
        )}
        {products && (
          <ProductCards
            items={products.items}
            picked={names}
            maxPicks={2}
            locked={altsLocked}
            noneLabel={products.noneLabel}
            ownLabel={products.ownLabel}
            onPick={actions.pickProduct}
            onNone={actions.noAlts}
            onOwn={actions.own}
          />
        )}
        {benefits && (
          <BenefitResults
            items={benefits.items}
            checked={checked}
            onCheck={(item: BenefitItem) => actions.checkLink(item.url)}
          />
        )}
        {link && (
          <LinkCard url={link.url} note={link.note} checked={checked.has(link.url)} onCheck={() => actions.checkLink(link.url)} />
        )}
        {guide && <GuideCard queries={guide.queries} checks={guide.checks} steps={guide.steps} />}
        {shortcuts.length > 0 && (
          <div className="vc-shortcuts" role="group" aria-label="쇼핑몰에서 직접 찾기">
            {shortcuts.map((item) => (
              <a key={item.url} className="vc-btn vc-btn--small" href={item.url} target="_blank" rel="noopener noreferrer">
                {item.label}
                <span className="vol-sr"> 새 탭</span>
              </a>
            ))}
          </div>
        )}
      </MessageBubble>
    );
  };

  const visible = fold.foldedCount > 0 ? messages.filter((message) => message.seq > fold.foldedUpTo) : messages;
  const hidden = fold.foldedCount > 0 ? messages.filter((message) => message.seq <= fold.foldedUpTo) : [];

  return (
    <div className="vc-log" role="log" aria-label="대화" data-testid="chat-log">
      {fold.foldedCount > 0 && (
        <>
          <FoldedTopic summary={fold.summary} open={foldOpen} controls="vc-folded-list" onToggle={onToggleFold} />
          {foldOpen && (
            <div id="vc-folded-list" className="vc-folded-list">
              {hidden.map(renderOne)}
            </div>
          )}
        </>
      )}
      {visible.map(renderOne)}
      {optimistic.map((item) => (
        <MessageBubble key={item.key} role="volunteer" text={item.text} pending />
      ))}
      {uploadingThumb && (
        <MessageBubble role="volunteer">
          <PhotoBubble photo={{ id: "uploading", thumb: uploadingThumb }} index={photos.length + 1} uploading />
        </MessageBubble>
      )}
      {thinking && <Thinking key={`${thinking.kind}-${thinking.startedAt}`} kind={thinking.kind} startedAt={thinking.startedAt} />}
      {children}
    </div>
  );
}
