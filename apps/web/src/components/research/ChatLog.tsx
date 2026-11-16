"use client";

import type { ReactNode } from "react";
import { BenefitResults } from "./BenefitResults";
import { FoldedTopic } from "./FoldedTopic";
import { GuideCard } from "./GuideCard";
import { LinkCard } from "./LinkCard";
import { MessageBubble } from "./MessageBubble";
import { ModelChips } from "./ModelChips";
import { PhotoBubble } from "./PhotoBubble";
import { ProductCards } from "./ProductCards";
import { Thinking } from "./Thinking";
import {
  altNames,
  benefitsOf,
  checkedUrls,
  chipsOf,
  guideOf,
  linkOf,
  photoIdOf,
  productsOf,
  tagLabel,
  textOf,
  type BenefitItem,
  type ChipView,
  type FoldPlan,
  type ThinkingKind,
} from "@/lib/researchChatView";
import type { ChatMessage, PhotoView, SlotMap } from "@/lib/researchClient";

export interface ChatActions {
  pickChip: (chip: ChipView) => void;
  own: () => void;
  pickProduct: (name: string) => void;
  noAlts: () => void;
  checkLink: (url: string) => void;
  removePhoto: (photo: PhotoView) => void;
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
  children?: ReactNode;
}) {
  const names = altNames(slots);
  const checked = checkedUrls(slots);
  const altsLocked = slots.alts?.status === "skipped";

  const renderOne = (message: ChatMessage) => {
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
    const chips = chipsOf(body);
    const products = productsOf(body);
    const benefits = benefitsOf(body);
    const link = linkOf(body);
    const guide = guideOf(body);
    const slotDone = (slot: string | null | undefined) => (slot ? Boolean(slots[slot as keyof SlotMap]) : false);
    return (
      <MessageBubble
        key={message.seq}
        role={message.role}
        tag={message.role === "volunteer" ? null : tagLabel(message)}
        text={benefits ? benefits.headline : text}
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
